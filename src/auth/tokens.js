import { readCredentialFile, withFileLock, writeCredentialFile } from './credentials.js';
import { DEFAULT_API_SERVER } from '../config.js';
import { HOST, LOGIN_HINT, cli } from '../cli.js';
import { QuestradeAuthError, QuestradeError } from '../questrade/errors.js';

const MARGIN_MS = 2 * 60 * 1000;
const KEEPALIVE_MS = 25 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Questrade access tokens last about 30 minutes and each refresh token can be
 * exchanged only once. Agent hosts often run several copies of this server at
 * the same time (one per session), so the whole token state lives in the
 * credentials file:
 *
 *   QUESTRADE_REFRESH_TOKEN, QUESTRADE_API_SERVER,
 *   QUESTRADE_ACCESS_TOKEN, QUESTRADE_ACCESS_TOKEN_EXPIRES_AT
 *
 * Every process reads the current access token from the file. A refresh runs
 * under a cross-process lock and re-reads the file first, so when several
 * processes need a new token at once only one spends the refresh token and
 * the rest reuse its result.
 */
export class TokenProvider {
  constructor(config, { env = process.env, fetchImpl = globalThis.fetch, logger, now = () => Date.now() } = {}) {
    this.config = config;
    this.file = config.credentialsFile;
    this.lockPath = `${this.file}.lock`;
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.now = now;
    this.pending = null;
  }

  load() {
    const { values } = readCredentialFile(this.file);
    const expires = Date.parse(values.QUESTRADE_ACCESS_TOKEN_EXPIRES_AT || '');
    return {
      mode: values.QUESTRADE_REFRESH_TOKEN ? 'oauth' : 'none',
      refreshToken: values.QUESTRADE_REFRESH_TOKEN || '',
      accessToken: values.QUESTRADE_ACCESS_TOKEN || '',
      expiresAt: Number.isFinite(expires) ? expires : 0,
      apiServer: values.QUESTRADE_API_SERVER || DEFAULT_API_SERVER,
      accountId: values.QUESTRADE_ACCOUNT_ID || undefined,
      httpToken: values.QUESTRADE_MCP_HTTP_TOKEN || this.env.QUESTRADE_MCP_HTTP_TOKEN || undefined,
    };
  }

  isFresh(c) {
    return Boolean(c.accessToken) && this.now() < c.expiresAt - MARGIN_MS;
  }

  /** Safe to show: never includes token values. */
  describe() {
    const c = this.load();
    return {
      mode: c.mode,
      credentialsFile: this.file,
      accessTokenExpiresAt: c.accessToken && c.expiresAt ? new Date(c.expiresAt).toISOString() : undefined,
      autoRefresh: c.mode === 'oauth',
      apiServer: c.mode === 'oauth' ? c.apiServer : undefined,
      signIn: `${cli('login')}  (the user runs it in a terminal on ${HOST}; never ask for tokens in the chat)`,
    };
  }

  setupHint() {
    return `No Questrade refresh token is configured on ${HOST}. ${LOGIN_HINT} It is stored in ${this.file} (mode 600).`;
  }

  /**
   * A valid access token and the API server to use it with.
   * @param {{ rejectedToken?: string }} opts  the token Questrade just
   *   rejected (HTTP 401): refresh, unless another process already stored a
   *   different one.
   */
  async getAccess({ rejectedToken } = {}) {
    const c = this.load();
    if (c.mode === 'none') throw new QuestradeAuthError(this.setupHint());
    if (!rejectedToken && this.isFresh(c)) return { accessToken: c.accessToken, apiServer: c.apiServer };
    return this.refresh({ rejectedToken });
  }

  refresh({ rejectedToken, force = false } = {}) {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        return await withFileLock(this.lockPath, async () => {
          const c = this.load(); // another process may have refreshed while we waited
          if (c.mode === 'none') throw new QuestradeAuthError(this.setupHint());
          const stale = force || (rejectedToken !== undefined && c.accessToken === rejectedToken);
          if (this.isFresh(c) && !stale) return { accessToken: c.accessToken, apiServer: c.apiServer };
          const saved = this.save(await this.exchange(c.refreshToken), c.apiServer);
          this.logger?.debug('Questrade token refreshed');
          return saved;
        });
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }

  /** Store a refresh token the user just generated (`login`). Spends it at once, which also validates it. */
  async signIn(refreshToken) {
    return withFileLock(this.lockPath, async () => this.save(await this.exchange(refreshToken, { fresh: true }), this.load().apiServer));
  }

  /** Exchange a refresh token (spending it) for an access token and the next refresh token. */
  async exchange(refreshToken, { fresh = false } = {}) {
    const url = new URL(this.config.loginUrl);
    url.searchParams.set('grant_type', 'refresh_token');
    url.searchParams.set('refresh_token', refreshToken);
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await this.fetchImpl(url, { method: 'POST', signal: AbortSignal.timeout(this.config.requestTimeoutMs) });
      } catch (error) {
        if (attempt < this.config.maxRetries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new QuestradeError(`Could not reach Questrade's login server (${error.cause?.code || error.name}). Try again shortly.`, { code: 'NETWORK', retryable: true });
      }
      if (response.status === 400 || response.status === 401) {
        throw new QuestradeAuthError(
          fresh
            ? 'Questrade rejected that token: it is mistyped, expired or already used. Generate a new one and try again.'
            : `Questrade rejected the stored refresh token (expired, revoked or already used). ${LOGIN_HINT}`,
          { code: 'TOKEN_REJECTED', status: response.status },
        );
      }
      if (response.status >= 500 && attempt < this.config.maxRetries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.access_token || !body?.refresh_token) {
        throw new QuestradeError(`Questrade's login server answered HTTP ${response.status} without a token. Try again shortly.`, { code: 'QUESTRADE_UNAVAILABLE', status: response.status });
      }
      return body;
    }
  }

  save(tokens, previousServer) {
    const apiServer = tokens.api_server || previousServer || DEFAULT_API_SERVER;
    const expiresAt = this.now() + (Number(tokens.expires_in) || 1800) * 1000;
    writeCredentialFile(this.file, {
      QUESTRADE_REFRESH_TOKEN: tokens.refresh_token,
      QUESTRADE_API_SERVER: apiServer,
      QUESTRADE_ACCESS_TOKEN: tokens.access_token,
      QUESTRADE_ACCESS_TOKEN_EXPIRES_AT: new Date(expiresAt).toISOString(),
    });
    return { accessToken: tokens.access_token, apiServer };
  }

  /** Remove the tokens from this machine (keeps other keys). */
  forget() {
    writeCredentialFile(this.file, { QUESTRADE_REFRESH_TOKEN: '', QUESTRADE_ACCESS_TOKEN: '', QUESTRADE_ACCESS_TOKEN_EXPIRES_AT: '' });
  }

  /**
   * Keep the refresh-token chain alive while the process runs: a manually
   * generated token lapses if unused for days. With several processes, only
   * the first to find the token near expiry refreshes.
   */
  startKeepAlive() {
    const timer = setInterval(async () => {
      if (this.load().mode === 'none') return;
      try {
        await this.getAccess();
      } catch (error) {
        this.logger?.warn(`Keep-alive refresh failed: ${error.message}`);
      }
    }, KEEPALIVE_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}
