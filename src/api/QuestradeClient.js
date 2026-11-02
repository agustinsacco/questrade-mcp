import axios from 'axios';

export class QuestradeClient {
    constructor(tokenManager) {
        this.tokenManager = tokenManager;
        this.client = axios.create();

        this.client.interceptors.request.use(async (config) => {
            const tokenData = await this.tokenManager.getValidToken();
            config.headers.Authorization = `Bearer ${tokenData.access_token}`;
            config.baseURL = tokenData.api_server;
            return config;
        });

        this.client.interceptors.response.use(
            (response) => response,
            async (error) => {
                const originalRequest = error.config;
                if (error.response?.status === 401 && !originalRequest._retry) {
                    originalRequest._retry = true;
                    const rejectedToken = String(originalRequest.headers?.Authorization || '').replace(/^Bearer /, '');
                    // Surface refresh failures (e.g. an expired refresh token) instead of the bare 401.
                    const newToken = await this.tokenManager.forceRefresh(rejectedToken);
                    originalRequest.headers.Authorization = `Bearer ${newToken.access_token}`;
                    originalRequest.baseURL = newToken.api_server;
                    return this.client(originalRequest);
                }
                return Promise.reject(error);
            }
        );
    }

    async getAccounts() {
        const res = await this.client.get('/v1/accounts');
        return res.data;
    }

    async getPositions(accountId) {
        const res = await this.client.get(`/v1/accounts/${accountId}/positions`);
        return res.data;
    }

    async getBalances(accountId) {
        const res = await this.client.get(`/v1/accounts/${accountId}/balances`);
        return res.data;
    }

    async searchSymbol(prefix) {
        const res = await this.client.get('/v1/symbols/search', { params: { prefix } });
        return res.data;
    }

    async getQuotes(symbolIds) {
        const res = await this.client.get('/v1/markets/quotes', { params: { ids: symbolIds.join(',') } });
        return res.data;
    }

    async getSymbols(symbolIds) {
        const res = await this.client.get('/v1/symbols', { params: { ids: symbolIds.join(',') } });
        return res.data;
    }

    async getActivities(accountId, startTime, endTime) {
        const res = await this.client.get(`/v1/accounts/${accountId}/activities`, { params: { startTime, endTime } });
        return res.data;
    }

    async getCandles(symbolId, startTime, endTime, interval) {
        const res = await this.client.get(`/v1/markets/candles/${symbolId}`, { params: { startTime, endTime, interval } });
        return res.data;
    }

    async getOrders(accountId, stateFilter = 'All', startTime, endTime) {
        const res = await this.client.get(`/v1/accounts/${accountId}/orders`, { params: { stateFilter, startTime, endTime } });
        return res.data;
    }
}
