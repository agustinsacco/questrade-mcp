import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { credentialsFile, readCredentials, withFileLock, writeCredentials } from './credentials.js';
import { HOST, LOGIN_HINT } from '../cli.js';

const DEFAULT_SERVER = 'https://api01.iq.questrade.com/';
const MARGIN_MS = 2 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** An auth problem whose message tells the user what to do. */
export class TokenError extends Error {}

/**
 * Questrade access tokens last about 30 minutes, and each refresh token can be
 * exchanged only once. Several copies of this server often run at the same
 * time (one per agent session), so the whole token state lives in the
 * credentials file:
 *
 *   QUESTRADE_REFRESH_TOKEN, QUESTRADE_API_SERVER,
 *   QUESTRADE_ACCESS_TOKEN, QUESTRADE_ACCESS_TOKEN_EXPIRES_AT
 *
 * Every process reads the current access token from the file. A refresh runs
 * under a cross-process lock and re-reads the file first, so when several
 * processes need a new token at once only one spends the refresh token and
 * the others reuse its result.
 */
export class TokenManager {
    constructor(storageDir, { file = credentialsFile(), loginUrl = process.env.QUESTRADE_LOGIN_URL || 'https://login.questrade.com/oauth2/token', now = () => Date.now() } = {}) {
        this.storageDir = storageDir;
        this.file = file;
        this.lockPath = `${file}.lock`;
        this.loginUrl = loginUrl;
        this.now = now;
        this.refreshPromise = null;
        this.cachedTokens = null;
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    }

    loadTokens() {
        let values;
        try {
            values = readCredentials(this.file).values;
        } catch {
            return null;
        }
        if (!values.QUESTRADE_REFRESH_TOKEN) return null;
        const expires = Date.parse(values.QUESTRADE_ACCESS_TOKEN_EXPIRES_AT || '');
        return {
            access_token: values.QUESTRADE_ACCESS_TOKEN || '',
            refresh_token: values.QUESTRADE_REFRESH_TOKEN,
            api_server: values.QUESTRADE_API_SERVER || DEFAULT_SERVER,
            expiry_timestamp: Number.isFinite(expires) ? expires : 0,
        };
    }

    needsRefresh(tokens) {
        return !tokens.access_token || !tokens.expiry_timestamp || this.now() >= tokens.expiry_timestamp - MARGIN_MS;
    }

    noTokenError() {
        return new TokenError(`No Questrade refresh token is configured on ${HOST}. ${LOGIN_HINT}`);
    }

    async getValidToken() {
        if (this.refreshPromise) return await this.refreshPromise;
        const tokens = this.loadTokens();
        if (!tokens) throw this.noTokenError();
        if (!this.needsRefresh(tokens)) return (this.cachedTokens = tokens);
        return await this.refresh();
    }

    /**
     * After Questrade rejected `rejectedAccessToken` (HTTP 401). If another
     * process has already stored a different, valid token, that one is used
     * without spending the refresh token. Without an argument, always refresh.
     */
    async forceRefresh(rejectedAccessToken) {
        return await this.refresh({ force: true, rejected: rejectedAccessToken });
    }

    refresh({ force = false, rejected } = {}) {
        if (this.refreshPromise) return this.refreshPromise;
        this.refreshPromise = (async () => {
            try {
                return await withFileLock(this.lockPath, async () => {
                    const tokens = this.loadTokens(); // another process may have refreshed while we waited
                    if (!tokens) throw this.noTokenError();
                    const stale = force && (rejected === undefined || tokens.access_token === rejected);
                    if (!this.needsRefresh(tokens) && !stale) return (this.cachedTokens = tokens);
                    this.saveToken(await this.exchange(tokens.refresh_token), tokens.api_server);
                    return this.cachedTokens;
                });
            } finally {
                this.refreshPromise = null;
            }
        })();
        return this.refreshPromise;
    }

    /** Store a refresh token the user just generated (used by `questrade-mcp login`). */
    async signIn(refreshToken) {
        return await withFileLock(this.lockPath, async () => {
            const previous = this.loadTokens();
            this.saveToken(await this.exchange(refreshToken, { fresh: true }), previous?.api_server);
            return this.cachedTokens;
        });
    }

    /** Exchange a refresh token (spending it) for an access token and the next refresh token. */
    async exchange(refreshToken, { fresh = false } = {}) {
        const maxRetries = 3;
        for (let attempt = 1; ; attempt++) {
            try {
                const response = await axios.post(this.loginUrl, null, {
                    params: { grant_type: 'refresh_token', refresh_token: refreshToken },
                    timeout: 10000,
                });
                if (!response.data?.access_token || !response.data?.refresh_token) throw new TokenError("Questrade's login server answered without a token.");
                return response.data;
            } catch (error) {
                if (error instanceof TokenError) throw error;
                const status = error.response?.status;
                if (status === 400 || status === 401) {
                    throw new TokenError(
                        fresh
                            ? 'Questrade rejected that token: it is mistyped, expired or already used. Generate a new one and try again.'
                            : `Questrade rejected the stored refresh token (expired, revoked or already used). ${LOGIN_HINT}`,
                    );
                }
                const retryable = !error.response || status >= 500 || error.code === 'ECONNABORTED';
                if (attempt < maxRetries && retryable) {
                    await sleep(1000 * 2 ** (attempt - 1));
                    continue;
                }
                throw new TokenError(`Could not refresh the Questrade token (${status ? `HTTP ${status}` : error.code || error.message}). Try again shortly.`);
            }
        }
    }

    saveToken(tokens, previousServer) {
        if (!tokens?.refresh_token) throw new TokenError('Refresh response did not include a refresh token.');
        const apiServer = tokens.api_server || previousServer || this.cachedTokens?.api_server || DEFAULT_SERVER;
        const expiresAt = new Date(this.now() + (Number(tokens.expires_in) || 1800) * 1000).toISOString();
        writeCredentials(this.file, {
            QUESTRADE_REFRESH_TOKEN: tokens.refresh_token,
            QUESTRADE_API_SERVER: apiServer,
            QUESTRADE_ACCESS_TOKEN: tokens.access_token,
            QUESTRADE_ACCESS_TOKEN_EXPIRES_AT: expiresAt,
        });
        this.cachedTokens = { access_token: tokens.access_token, refresh_token: tokens.refresh_token, api_server: apiServer, expiry_timestamp: Date.parse(expiresAt) };
    }

    startKeepAlive() {
        // Keeps the refresh-token chain alive while the process runs. With
        // several processes, only the first to find the token expired refreshes.
        const interval = setInterval(async () => {
            try {
                await this.getValidToken();
            } catch (error) {
                console.error(`[TokenManager] Keep-alive failed: ${error.message}`);
            }
        }, 25 * 60 * 1000);
        interval.unref?.();
    }
}
