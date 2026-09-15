import { logger } from '../utils/Logger.js';

export class AccountTools {
    constructor(client) {
        this.client = client;
    }

    async resolveAccountId(explicitId) {
        if (explicitId) return explicitId;
        const accounts = await this.client.getAccounts();
        if (!accounts.accounts || accounts.accounts.length === 0) throw new Error('No Questrade accounts found.');
        return accounts.accounts[0].number;
    }

    async getAccounts() {
        return await this.client.getAccounts();
    }

    async getPositions(args) {
        const id = await this.resolveAccountId(args.accountId);
        const data = await this.client.getPositions(id);
        return {
            positions: data.positions.map((p) => ({
                symbol: p.symbol,
                qty: p.openQuantity,
                avgPrice: p.averageEntryPrice,
                currPrice: p.currentPrice,
                mktValue: p.currentMarketValue,
                openPnl: p.openPnl,
                dayPnl: p.dayPnl
            }))
        };
    }

    async getBalances(args) {
        const id = await this.resolveAccountId(args.accountId);
        const data = await this.client.getBalances(id);
        const b = data.combinedBalances[0] || {};
        return {
            currency: b.currency,
            cash: b.cash,
            marketValue: b.marketValue,
            totalEquity: b.totalEquity,
            buyingPower: b.buyingPower
        };
    }

    async getOrders(args) {
        const id = await this.resolveAccountId(args.accountId);
        return await this.client.getOrders(id, args.stateFilter || 'All', args.startTime, args.endTime);
    }

    async getTransactions(args) {
        const id = await this.resolveAccountId(args.accountId);
        const start = new Date(args.startTime);
        const end = new Date(args.endTime);
        const MAX_DAYS = 30;
        const allActivities = [];
        let current = new Date(start);

        while (current < end) {
            let chunkEnd = new Date(current);
            chunkEnd.setDate(chunkEnd.getDate() + MAX_DAYS);
            if (chunkEnd > end) chunkEnd = new Date(end);

            const res = await this.client.getActivities(id, current.toISOString(), chunkEnd.toISOString());
            if (res.activities) allActivities.push(...res.activities);

            current = chunkEnd;
            if (current.getTime() <= start.getTime()) current.setTime(current.getTime() + 1000);
        }
        return { activities: allActivities };
    }
}
