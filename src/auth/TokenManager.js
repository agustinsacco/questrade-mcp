import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';

const SECRETS_PATH = process.env.QUESTRADE_TOKEN_FILE || path.join(os.homedir(), '.config', 'questrade-mcp', 'credentials.env');

export class TokenManager {
    constructor(storageDir) {
        this.storageDir = storageDir;
        this.refreshPromise = null;
        this.cachedTokens = null;
        fs.mkdirSync(path.dirname(SECRETS_PATH), { recursive: true, mode: 0o700 });
    }

    async getValidToken() {
        if (this.refreshPromise) return await this.refreshPromise;
        const tokens = this.cachedTokens || this.loadTokens();
        if (!tokens) throw new Error('No Questrade refresh token configured locally.');
        if (this.needsRefresh(tokens)) return await this.performThreadSafeRefresh(tokens.refresh_token);
        return tokens;
    }

    async forceRefresh() {
        const tokens = this.cachedTokens || this.loadTokens();
        if (!tokens) throw new Error('No Questrade refresh token configured locally.');
        return await this.performThreadSafeRefresh(tokens.refresh_token);
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
                access_token: '',
                refresh_token: values.QUESTRADE_REFRESH_TOKEN,
                api_server: values.QUESTRADE_API_SERVER || 'https://api01.iq.questrade.com/',
                expiry_timestamp: 0
            };
        } catch {
            return null;
        }
    }

    saveToken(tokens) {
        if (!tokens?.refresh_token) throw new Error('Refresh response did not include a refresh token.');
        const apiServer = tokens.api_server || this.cachedTokens?.api_server || 'https://api01.iq.questrade.com/';
        const content = `QUESTRADE_REFRESH_TOKEN=${tokens.refresh_token}\nQUESTRADE_API_SERVER=${apiServer}\n`;
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
        const expiry_timestamp = Date.now() + (tokens.expires_in || 1800) * 1000 - 2 * 60 * 1000;
        this.cachedTokens = { ...tokens, api_server: apiServer, expiry_timestamp };
    }

    needsRefresh(tokens) {
        return !tokens.access_token || !tokens.expiry_timestamp || Date.now() >= tokens.expiry_timestamp;
    }

    async performThreadSafeRefresh(refreshToken) {
        if (this.refreshPromise) return await this.refreshPromise;
        this.refreshPromise = (async () => {
            try {
                const response = await this.refreshToken(refreshToken);
                this.saveToken(response);
                return this.cachedTokens;
            } finally {
                this.refreshPromise = null;
            }
        })();
        return await this.refreshPromise;
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
                else throw error;
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
