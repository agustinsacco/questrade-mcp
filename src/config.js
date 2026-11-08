import os from 'node:os';
import path from 'node:path';

export const DEFAULT_LOGIN_URL = 'https://login.questrade.com/oauth2/token';
export const DEFAULT_API_SERVER = 'https://api01.iq.questrade.com/';

export const TOOLSETS = ['context', 'accounts', 'market', 'analysis', 'reports'];

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());

function int(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function list(value) {
  if (!value) return null;
  const items = String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : null;
}

export function defaultCredentialsFile(env = process.env) {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'questrade-mcp', 'credentials.env');
}

/**
 * Non-secret runtime settings. Secrets live in the credentials file (see
 * auth/credentials.js) and never in this object.
 */
export function loadConfig(env = process.env) {
  const toolsets = list(env.QUESTRADE_MCP_TOOLSETS);
  const unknown = toolsets?.filter((t) => t !== 'all' && !TOOLSETS.includes(t)) ?? [];
  if (unknown.length) {
    throw new Error(`Unknown QUESTRADE_MCP_TOOLSETS value(s): ${unknown.join(', ')}. Valid: all, ${TOOLSETS.join(', ')}`);
  }
  return {
    // QUESTRADE_TOKEN_FILE is the 1.x name, still honoured.
    credentialsFile: env.QUESTRADE_CREDENTIALS_FILE || env.QUESTRADE_TOKEN_FILE || defaultCredentialsFile(env),
    loginUrl: env.QUESTRADE_LOGIN_URL || DEFAULT_LOGIN_URL,
    accountId: env.QUESTRADE_ACCOUNT_ID || undefined,
    // Every tool reads; the setting exists so both servers share one interface.
    readOnly: true,
    toolsets: !toolsets || toolsets.includes('all') ? [...TOOLSETS] : toolsets,
    maxConcurrency: int(env.QUESTRADE_MCP_MAX_CONCURRENCY, 4, { max: 10 }),
    requestTimeoutMs: int(env.QUESTRADE_MCP_TIMEOUT_MS, 30_000, { min: 1000 }),
    maxRetries: int(env.QUESTRADE_MCP_MAX_RETRIES, 3, { min: 0, max: 8 }),
    maxResponseChars: int(env.QUESTRADE_MCP_MAX_RESPONSE_CHARS, 60_000, { min: 4000 }),
    maxRangeDays: int(env.QUESTRADE_MCP_MAX_RANGE_DAYS, 3660, { min: 31 }),
    cacheTtlMs: int(env.QUESTRADE_MCP_CACHE_TTL_MS, 60_000, { min: 0 }),
    keepAlive: !truthy(env.QUESTRADE_MCP_NO_KEEPALIVE),
    logLevel: env.QUESTRADE_MCP_LOG_LEVEL || 'info',
    http: {
      host: env.QUESTRADE_MCP_HTTP_HOST || '127.0.0.1',
      port: int(env.QUESTRADE_MCP_HTTP_PORT, 8788, { min: 1, max: 65535 }),
      path: env.QUESTRADE_MCP_HTTP_PATH || '/mcp',
      allowedHosts: list(env.QUESTRADE_MCP_ALLOWED_HOSTS),
    },
  };
}
