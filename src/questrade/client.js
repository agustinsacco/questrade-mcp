import { QuestradeError, fromResponse } from './errors.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Caps concurrent requests (Questrade meters per second and per hour). */
export class Semaphore {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }
  async run(fn) {
    if (this.active >= this.max) await new Promise((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

/**
 * Questrade REST client (read-only: GET, plus POST for option quotes, which
 * reads). Every call:
 *  - uses the current access token and API server from the token provider;
 *  - on HTTP 401 refreshes once (or picks up another process's new token);
 *  - retries network errors, 5xx and 429 with backoff (429 waits for
 *    X-RateLimit-Reset, at most 10 s). Safe because nothing here writes.
 */
export class QuestradeClient {
  constructor({ config, tokens, logger, fetchImpl = globalThis.fetch }) {
    this.config = config;
    this.tokens = tokens;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.semaphore = new Semaphore(config.maxConcurrency);
  }

  get(path, params) {
    return this.request('GET', path, { params });
  }

  post(path, body) {
    return this.request('POST', path, { body });
  }

  async request(method, path, { params, body } = {}) {
    return this.semaphore.run(async () => {
      let access = await this.tokens.getAccess();
      let refreshed = false;
      for (let attempt = 0; ; attempt++) {
        const url = new URL(path.replace(/^\//, ''), access.apiServer.endsWith('/') ? access.apiServer : `${access.apiServer}/`);
        for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
        let response;
        try {
          response = await this.fetchImpl(url, {
            method,
            headers: { Authorization: `Bearer ${access.accessToken}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(this.config.requestTimeoutMs),
          });
        } catch (error) {
          if (attempt < this.config.maxRetries) {
            await sleep(400 * 2 ** attempt);
            continue;
          }
          const why = error.name === 'TimeoutError' ? `timed out after ${this.config.requestTimeoutMs} ms` : error.cause?.code || error.message;
          throw new QuestradeError(`Could not reach Questrade (${why}). Try again shortly.`, { code: 'NETWORK', retryable: true });
        }
        if (response.status === 401 && !refreshed) {
          refreshed = true;
          access = await this.tokens.getAccess({ rejectedToken: access.accessToken });
          attempt--;
          continue;
        }
        const data = await response.json().catch(() => null);
        if (response.ok) {
          this.logger?.debug(`${method} ${url.pathname} ${response.status} (rate limit remaining ${response.headers.get('x-ratelimit-remaining') ?? '?'})`);
          return data ?? {};
        }
        const error = fromResponse(response.status, data, `${method} ${url.pathname}`);
        if (error.retryable && attempt < this.config.maxRetries) {
          const reset = Number(response.headers.get('x-ratelimit-reset'));
          const wait = response.status === 429 && reset ? Math.min(10_000, Math.max(250, reset * 1000 - Date.now())) : 400 * 2 ** attempt;
          await sleep(wait);
          continue;
        }
        throw error;
      }
    });
  }
}
