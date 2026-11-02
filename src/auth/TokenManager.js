import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';

const SECRETS_PATH = process.env.QUESTRADE_TOKEN_FILE || path.join(os.homedir(), '.config', 'questrade-mcp', 'credentials.env');
const LOCK_PATH = `${SECRETS_PATH}.lock`;
const DEFAULT_API_SERVER = 'https://api01.iq.questrade.com/';
const NO_TOKEN_MESSAGE = 'No Questrade refresh token configured locally.';

// Treat access tokens as expired this long before Questrade does.
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;
// A refresh takes at most ~33 s (3 attempts with a 10 s timeout plus backoff),
// so a lock older than this belongs to a hung or crashed process.
const LOCK_STALE_MS = 60 * 1000;
const LOCK_WAIT_MS = 90 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Manages Questrade OAuth tokens for this process.
 *
 * Several processes (one MCP server per agent session, scripts, scheduled
 * jobs) may share one credential file. Questrade refresh tokens are single-use
 * and a refresh invalidates the previously issued access token, so every
 * process must use the same token chain:
 *
 * - The current access token, its expiry, and the latest refresh token all
 *   live in the credential file. A process whose cached access token expired
 *   or was rejected first checks the file, because another process may
 *   already have refreshed.
 * - Refreshes happen while holding an exclusive lock file next to the
 *   credential file, and always use the refresh token currently on disk.
 */
export class TokenManager {
    constructor(storageDir) {
        this.storageDir = storageDir;
        this.refreshPromise = null;
        this.cachedTokens = null;
        fs.mkdirSync(path.dirname(SECRETS_PATH), { recursive: true, mode: 0o700 });
    }

    async getValidToken() {
        if (this.refreshPromise) return await this.refreshPromise;
        if (this.cachedTokens && !this.needsRefresh(this.cachedTokens)) return this.cachedTokens;
        const onDisk = this.loadTokens();
        if (!onDisk) throw new Error(NO_TOKEN_MESSAGE);
        if (!this.needsRefresh(onDisk)) {
            this.cachedTokens = onDisk;
            return onDisk;
        }
        return await this.refresh();
    }

    /**
     * Get a token after the API rejected `rejectedAccessToken`. Uses a newer
     * access token from the credential file when another process has one,
     * and refreshes otherwise.
     */
    async forceRefresh(rejectedAccessToken = this.cachedTokens?.access_token) {
        return await this.refresh(rejectedAccessToken);
    }

    refresh(rejectedAccessToken) {
        if (!this.refreshPromise) {
            this.refreshPromise = this.withCredentialLock(() => this.refreshLocked(rejectedAccessToken))
                .finally(() => { this.refreshPromise = null; });
        }
        return this.refreshPromise;
    }

    async refreshLocked(rejectedAccessToken) {
        let triedRefreshToken = null;
        let lastError = null;
        // Two passes: if Questrade rejects the refresh token, re-read the file
        // once in case something that does not take the lock (an older version
        // of this server, or a manual re-provision) replaced it.
        for (let pass = 0; pass < 2; pass++) {
            const tokens = this.loadTokens();
            if (!tokens) throw new Error(NO_TOKEN_MESSAGE);
            if (!this.needsRefresh(tokens) && tokens.access_token !== rejectedAccessToken) {
                this.cachedTokens = tokens;
                return tokens;
            }
            if (tokens.refresh_token === triedRefreshToken) break;
            triedRefreshToken = tokens.refresh_token;
            try {
                const response = await this.refreshToken(tokens.refresh_token);
                this.saveToken(response, tokens.api_server);
                return this.cachedTokens;
            } catch (error) {
                if (!this.isRejectedGrant(error)) throw error;
                lastError = error;
            }
        }
        throw new Error(
            `Questrade rejected the stored refresh token (HTTP ${lastError.status}). ` +
            'It has expired, was revoked, or was already used; provision a new token in the credential file.'
        );
    }

    isRejectedGrant(error) {
        return error?.status >= 400 && error?.status < 500;
    }

    loadTokens() {
        if (!fs.existsSync(SECRETS_PATH)) return null;
        try {
            const values = {};
            for (const line of fs.readFileSync(SECRETS_PATH, 'utf8').split(/\r?\n/)) {
                const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
                if (match) values[match[1]] = match[2];
            }
            if (!values.QUESTRADE_REFRESH_TOKEN) return null;
            return {
                access_token: values.QUESTRADE_ACCESS_TOKEN || '',
                refresh_token: values.QUESTRADE_REFRESH_TOKEN,
                api_server: values.QUESTRADE_API_SERVER || DEFAULT_API_SERVER,
                expiry_timestamp: Number(values.QUESTRADE_ACCESS_TOKEN_EXPIRES_AT) || 0
            };
        } catch {
            return null;
        }
    }

    saveToken(response, fallbackApiServer) {
        if (!response?.refresh_token || !response?.access_token) {
            throw new Error('Refresh response did not include an access token and a refresh token.');
        }
        const tokens = {
            access_token: response.access_token,
            refresh_token: response.refresh_token,
            api_server: response.api_server || fallbackApiServer || DEFAULT_API_SERVER,
            expiry_timestamp: Date.now() + (response.expires_in || 1800) * 1000 - EXPIRY_MARGIN_MS
        };
        const content = [
            `QUESTRADE_REFRESH_TOKEN=${tokens.refresh_token}`,
            `QUESTRADE_API_SERVER=${tokens.api_server}`,
            `QUESTRADE_ACCESS_TOKEN=${tokens.access_token}`,
            `QUESTRADE_ACCESS_TOKEN_EXPIRES_AT=${tokens.expiry_timestamp}`,
            ''
        ].join('\n');
        const temp = `${SECRETS_PATH}.tmp-${process.pid}`;
        const fd = fs.openSync(temp, 'w', 0o600);
        try {
            fs.writeFileSync(fd, content, { encoding: 'utf8' });
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(temp, SECRETS_PATH);
        fs.chmodSync(SECRETS_PATH, 0o600);
        this.cachedTokens = tokens;
    }

    needsRefresh(tokens) {
        return !tokens.access_token || !tokens.expiry_timestamp || Date.now() >= tokens.expiry_timestamp;
    }

    async withCredentialLock(fn) {
        await this.acquireLock();
        try {
            return await fn();
        } finally {
            this.releaseLock();
        }
    }

    async acquireLock() {
        const deadline = Date.now() + LOCK_WAIT_MS;
        for (;;) {
            try {
                const fd = fs.openSync(LOCK_PATH, 'wx', 0o600);
                try {
                    fs.writeSync(fd, `${process.pid}\n`);
                } finally {
                    fs.closeSync(fd);
                }
                return;
            } catch (error) {
                if (error.code !== 'EEXIST') throw error;
            }
            if (this.isLockStale()) {
                try { fs.unlinkSync(LOCK_PATH); } catch { /* already removed */ }
                continue;
            }
            if (Date.now() >= deadline) throw new Error('Timed out waiting for the Questrade credential lock.');
            await sleep(100 + Math.random() * 150);
        }
    }

    isLockStale() {
        try {
            if (Date.now() - fs.statSync(LOCK_PATH).mtimeMs > LOCK_STALE_MS) return true;
            const pid = Number.parseInt(fs.readFileSync(LOCK_PATH, 'utf8'), 10);
            if (!pid) return false; // the holder has not written its PID yet
            process.kill(pid, 0);
            return false;
        } catch (error) {
            return error.code === 'ESRCH'; // the holder exited without releasing
        }
    }

    releaseLock() {
        try {
            // Only remove our own lock; it may have been broken as stale and re-taken.
            if (Number.parseInt(fs.readFileSync(LOCK_PATH, 'utf8'), 10) === process.pid) fs.unlinkSync(LOCK_PATH);
        } catch { /* already removed */ }
    }

    async refreshToken(refreshToken) {
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await axios.post('https://login.questrade.com/oauth2/token', null, {
                    params: { grant_type: 'refresh_token', refresh_token: refreshToken },
                    timeout: 10000
                });
                return response.data;
            } catch (error) {
                const retryable = !error.response || (error.response.status >= 500 && error.response.status < 600) || error.code === 'ECONNABORTED';
                if (attempt < maxRetries && retryable) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
                else {
                    // Do not propagate the axios error: its config holds the refresh token.
                    const sanitized = new Error(`Questrade token refresh failed: ${error.message}`);
                    sanitized.status = error.response?.status;
                    throw sanitized;
                }
            }
        }
    }

    startKeepAlive() {
        const interval = setInterval(async () => {
            try { await this.getValidToken(); }
            catch (error) { console.error(`[TokenManager] Keep-alive failed: ${error.message}`); }
        }, 25 * 60 * 1000);
        interval.unref?.();
    }
}
