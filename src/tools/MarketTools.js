import { logger } from '../utils/Logger.js';
import { AsciiChartUtil } from '../utils/AsciiChartUtil.js';
import { RSI, SMA, BollingerBands, VWAP } from 'technicalindicators';

export class MarketTools {
    constructor(client) {
        this.client = client;
    }

    async getQuotes(args) {
        if (!Array.isArray(args.symbolIds) || args.symbolIds.length === 0) {
            throw new Error('symbolIds must contain at least one symbol ID.');
        }
        return await this.client.getQuotes(args.symbolIds);
    }

    async lookupSymbol(args) {
        return await this.client.searchSymbol(args.prefix);
    }

    async getCandles(args) {
        const interval = args.interval || 'OneDay';
        const response = await this.client.getCandles(args.symbolId, args.startTime, args.endTime, interval);
        const candles = response.candles || [];
        if (candles.length === 0) return { asciiPlot: 'No data found.' };

        const plot = AsciiChartUtil.generateSingleSeriesPlot(candles);
        return {
            symbolId: args.symbolId,
            granularity: interval,
            data: AsciiChartUtil.formatCompactData(candles),
            asciiPlot: `\n${plot}`
        };
    }

    async compareSymbols(args) {
        const interval = args.interval || 'OneDay';
        const promises = args.symbolIds.map(id => this.client.getCandles(id, args.startTime, args.endTime, interval));
        const responses = await Promise.all(promises);
        const symbolDetails = await this.client.getSymbols(args.symbolIds);
        const names = symbolDetails.symbols.map(s => s.symbol);

        const seriesData = responses.map((res, i) => ({
            symbol: names[i] || `ID ${args.symbolIds[i]}`,
            candles: res.candles || []
        }));

        const plot = AsciiChartUtil.generateMultiSeriesPlot(seriesData.filter(s => s.candles.length > 0));
        return { asciiPlot: `\n${plot}` };
    }

    async analyzeTechnicals(args) {
        const interval = args.interval || 'OneDay';
        const response = await this.client.getCandles(args.symbolId, args.startTime, args.endTime, interval);
        const candles = response.candles || [];
        if (candles.length === 0) return { error: 'No data found for technical analysis.' };

        const closePrices = candles.map(c => c.close);
        const highPrices = candles.map(c => c.high);
        const lowPrices = candles.map(c => c.low);
        const volumes = candles.map(c => c.volume);

        const currentPrice = closePrices[closePrices.length - 1];

        // RSI (14)
        const rsiInput = { values: closePrices, period: 14 };
        const rsiResult = RSI.calculate(rsiInput);
        const currentRSI = rsiResult.length > 0 ? rsiResult[rsiResult.length - 1] : null;

        // SMAs
        const sma50Result = SMA.calculate({ values: closePrices, period: 50 });
        const sma200Result = SMA.calculate({ values: closePrices, period: 200 });
        const currentSMA50 = sma50Result.length > 0 ? sma50Result[sma50Result.length - 1] : null;
        const currentSMA200 = sma200Result.length > 0 ? sma200Result[sma200Result.length - 1] : null;

        // Bollinger Bands (20, 2)
        const bbInput = { period: 20, values: closePrices, stdDev: 2 };
        const bbResult = BollingerBands.calculate(bbInput);
        const currentBB = bbResult.length > 0 ? bbResult[bbResult.length - 1] : null;

        // VWAP
        const vwapInput = { high: highPrices, low: lowPrices, close: closePrices, volume: volumes };
        const vwapResult = VWAP.calculate(vwapInput);
        const currentVWAP = vwapResult.length > 0 ? vwapResult[vwapResult.length - 1] : null;

        return {
            symbolId: args.symbolId,
            price: currentPrice,
            rsi14: currentRSI ? parseFloat(currentRSI.toFixed(2)) : null,
            sma50: currentSMA50 ? parseFloat(currentSMA50.toFixed(2)) : null,
            sma200: currentSMA200 ? parseFloat(currentSMA200.toFixed(2)) : null,
            vwap: currentVWAP ? parseFloat(currentVWAP.toFixed(2)) : null,
            bollingerBands: currentBB ? {
                upper: parseFloat(currentBB.upper.toFixed(2)),
                middle: parseFloat(currentBB.middle.toFixed(2)),
                lower: parseFloat(currentBB.lower.toFixed(2))
            } : null,
            signals: {
                isOversold: currentRSI && currentRSI < 30,
                isAbove200SMA: currentSMA200 && currentPrice > currentSMA200,
                isPiercingLowerBB: currentBB && currentPrice <= currentBB.lower
            }
        };
    }

    async screenWatchlist(args) {
        const { symbolIds, criteria, startTime, endTime, interval } = args;
        const results = [];
        const errors = [];

        for (const symbolId of symbolIds) {
            try {
                const tech = await this.analyzeTechnicals({ symbolId, startTime, endTime, interval });
                if (tech.error) {
                    errors.push({ symbolId, error: tech.error });
                    continue;
                }

                let passed = true;
                if (criteria) {
                    if (criteria.maxRsi !== undefined && (tech.rsi14 === null || tech.rsi14 > criteria.maxRsi)) passed = false;
                    if (criteria.minRsi !== undefined && (tech.rsi14 === null || tech.rsi14 < criteria.minRsi)) passed = false;
                    if (criteria.mustBeAbove200Sma && !tech.signals.isAbove200SMA) passed = false;
                    if (criteria.mustBePiercingLowerBB && !tech.signals.isPiercingLowerBB) passed = false;
                    if (criteria.mustBeBelowVwap && (tech.vwap === null || tech.price >= tech.vwap)) passed = false;
                }

                if (passed) {
                    results.push(tech);
                }
            } catch (e) {
                errors.push({ symbolId, error: e.message });
            }
        }

        return { matchedSymbols: results, errors };
    }
}
