import { TokenProvider } from './auth/tokens.js';
import { QuestradeClient } from './questrade/client.js';
import { QuestradeError } from './questrade/errors.js';
import { formatQt, windows } from './questrade/time.js';
import { createLogger } from './log.js';
import { loadConfig } from './config.js';

/** Small TTL cache with in-flight de-duplication. */
export class TtlCache {
  constructor(ttlMs, { maxEntries = 100 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map();
  }
  async get(key, load) {
    const hit = this.map.get(key);
    if (hit && (hit.pending || Date.now() - hit.at < this.ttlMs)) return hit.pending || hit.value;
    const pending = load();
    this.map.set(key, { pending, at: Date.now() });
    try {
      const value = await pending;
      if (this.ttlMs > 0) this.map.set(key, { value, at: Date.now() });
      else this.map.delete(key);
      while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value);
      return value;
    } catch (error) {
      this.map.delete(key);
      throw error;
    }
  }
  clear() {
    this.map.clear();
  }
}

/**
 * Shared, long-lived state for one process: config, credentials, the
 * Questrade client and caches. MCP server instances (one per stdio
 * connection, or one per HTTP request) are cheap and close over this.
 */
export class QuestradeContext {
  constructor({ config = loadConfig(), env = process.env, fetchImpl = globalThis.fetch, logger } = {}) {
    this.config = config;
    this.logger = logger || createLogger(config.logLevel);
    this.tokens = new TokenProvider(config, { env, fetchImpl, logger: this.logger });
    this.client = new QuestradeClient({ config, tokens: this.tokens, logger: this.logger, fetchImpl });
    this.cache = new TtlCache(config.cacheTtlMs);
    // Symbol details barely change; keep them longer.
    this.symbolCache = new Map();
  }

  async listAccounts() {
    return this.cache.get('accounts', async () => {
      const data = await this.client.get('/v1/accounts');
      return { accounts: data.accounts || [], userId: data.userId };
    });
  }

  /**
   * Which account a call targets: explicit argument, then QUESTRADE_ACCOUNT_ID
   * (env or credentials file), then the only active account. With several
   * accounts and no default, the error lists them (never silently the first).
   */
  async resolveAccountId(explicit) {
    if (explicit) return String(explicit);
    if (this.config.accountId) return this.config.accountId;
    const fromFile = this.tokens.load().accountId;
    if (fromFile) return fromFile;
    const { accounts } = await this.listAccounts();
    const active = accounts.filter((a) => !a.status || a.status === 'Active');
    if (active.length === 1) return active[0].number;
    const choices = (active.length ? active : accounts)
      .slice(0, 12)
      .map((a) => `${a.number} (${[a.type, a.clientAccountType].filter(Boolean).join(' ')})`)
      .join('; ');
    throw new QuestradeError(
      `This login has ${accounts.length} accounts, so pass accountId (or set QUESTRADE_ACCOUNT_ID). Choices: ${choices || 'none found'}.`,
      { code: 'ACCOUNT_REQUIRED' },
    );
  }

  /** Symbol details by ID, cached for the life of the process (batched 100 per request). */
  async symbolsById(ids) {
    const want = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const missing = want.filter((id) => !this.symbolCache.has(id));
    for (let i = 0; i < missing.length; i += 100) {
      const batch = missing.slice(i, i + 100);
      const data = await this.client.get('/v1/symbols', { ids: batch.join(',') });
      for (const s of data.symbols || []) this.symbolCache.set(s.symbolId, s);
    }
    return new Map(want.filter((id) => this.symbolCache.has(id)).map((id) => [id, this.symbolCache.get(id)]));
  }

  /**
   * Turn symbol references (numeric IDs or tickers such as "XEQT.TO" or
   * "AAPL") into IDs. Tickers must match exactly, as Questrade writes them:
   * TSX listings end in .TO, US listings have no suffix.
   */
  async resolveSymbolIds(refs) {
    const ids = [];
    const names = [];
    for (const r of refs) {
      if (typeof r === 'number' || /^\d+$/.test(String(r))) ids.push(Number(r));
      else names.push(String(r).trim().toUpperCase());
    }
    if (names.length) {
      const data = await this.cache.get(`names:${names.join(',')}`, () => this.client.get('/v1/symbols', { names: names.join(',') }));
      const found = new Map((data.symbols || []).map((s) => [String(s.symbol).toUpperCase(), s]));
      const unknown = names.filter((n) => !found.has(n));
      if (unknown.length) {
        throw new QuestradeError(`Unknown symbol(s): ${unknown.join(', ')}. Use qt_search_symbols to find the exact ticker (TSX listings end in .TO) or its symbolId.`, { code: 'NOT_FOUND' });
      }
      for (const s of found.values()) {
        this.symbolCache.set(s.symbolId, s);
        ids.push(s.symbolId);
      }
    }
    return [...new Set(ids)];
  }

  /**
   * Fetch a dated account list (activities, executions, orders) over any
   * range: Questrade accepts about a month per request, so the range is split
   * into 30-day windows. Results are cached per account and range.
   */
  async fetchRange(kind, accountId, { start, end }, extra = {}) {
    const key = `${kind}:${accountId}:${start}:${end}:${JSON.stringify(extra)}`;
    return this.cache.get(key, async () => {
      const parts = await Promise.all(
        windows(start, end).map(([s, e]) => this.client.get(`/v1/accounts/${encodeURIComponent(accountId)}/${kind}`, { startTime: formatQt(s), endTime: formatQt(e), ...extra })),
      );
      return parts.flatMap((p) => p[kind] || []);
    });
  }
}
