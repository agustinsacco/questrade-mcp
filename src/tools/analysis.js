import * as z from 'zod';
import { BollingerBands, RSI, SMA, VWAP } from 'technicalindicators';
import { round } from '../format.js';
import { comparisonChart } from '../charts.js';
import { READ, defineTool, endDate, interval, startDate, symbolRef, symbolRefs } from './common.js';
import { candleStats, loadCandles } from './market.js';

const last = (arr) => (arr.length ? arr[arr.length - 1] : null);

/** RSI 14, SMA 50/200, VWAP and Bollinger Bands (20, 2) from candles. */
export function technicals(candles) {
  const closes = candles.map((c) => c.close);
  const price = last(closes);
  const rsi = last(RSI.calculate({ values: closes, period: 14 }));
  const sma50 = last(SMA.calculate({ values: closes, period: 50 }));
  const sma200 = last(SMA.calculate({ values: closes, period: 200 }));
  const bb = last(BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 }));
  const vwap = last(VWAP.calculate({ high: candles.map((c) => c.high), low: candles.map((c) => c.low), close: closes, volume: candles.map((c) => c.volume) }));
  return {
    price,
    candles: candles.length,
    rsi14: rsi === null ? null : round(rsi),
    sma50: sma50 === null ? null : round(sma50),
    sma200: sma200 === null ? null : round(sma200),
    vwap: vwap === null ? null : round(vwap),
    bollingerBands: bb ? { upper: round(bb.upper), middle: round(bb.middle), lower: round(bb.lower) } : null,
    signals: {
      isOversold: rsi !== null && rsi < 30,
      isOverbought: rsi !== null && rsi > 70,
      isAbove50Sma: sma50 !== null && price > sma50,
      isAbove200Sma: sma200 !== null && price > sma200,
      isPiercingLowerBB: bb !== null && price <= bb.lower,
      isAboveUpperBB: bb !== null && price >= bb.upper,
      isBelowVwap: vwap !== null && price < vwap,
    },
    ...(candles.length < 200 ? { note: `Only ${candles.length} candles: SMA 200 needs 200 (use a longer range or a smaller interval).` } : {}),
  };
}

function maxDrawdownPct(candles) {
  let peak = -Infinity;
  let worst = 0;
  for (const c of candles) {
    peak = Math.max(peak, c.close);
    worst = Math.min(worst, (c.close - peak) / peak);
  }
  return round(worst * 100);
}

const range = { startDate: startDate.optional(), endDate: endDate.optional(), interval };

export function registerAnalysisTools(server, ctx) {
  defineTool(server, ctx, {
    name: 'qt_compare_symbols',
    title: 'Compare symbols',
    toolset: 'analysis',
    annotations: READ,
    description: 'Compare up to 10 symbols over the same range: % change, high, low, maximum drawdown and a normalized % change chart. Default range: 1 year of daily candles.',
    input: z.object({ symbols: symbolRefs(10), ...range, chart: z.boolean().default(true) }),
    handler: async ({ symbols, startDate: s, endDate: e, interval: iv, chart }) => {
      const ids = await ctx.resolveSymbolIds(symbols);
      const details = await ctx.symbolsById(ids).catch(() => new Map());
      const series = await Promise.all(ids.map(async (id) => ({ id, symbol: details.get(id)?.symbol || `#${id}`, ...(await loadCandles(ctx, id, { startDate: s, endDate: e, interval: iv })) })));
      const items = series.map(({ id, symbol, candles }) => {
        const st = candleStats(candles);
        return { symbol, symbolId: id, currency: details.get(id)?.currency, changePct: st.changePct, firstClose: st.firstClose, lastClose: st.lastClose, high: st.high, low: st.low, maxDrawdownPct: candles.length ? maxDrawdownPct(candles) : undefined, candles: st.count };
      });
      items.sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
      return { interval: iv, items, ...(chart ? { chart: `\n${comparisonChart(series)}`, chartOrder: series.map((x) => x.symbol) } : {}) };
    },
  });

  defineTool(server, ctx, {
    name: 'qt_analyze_technicals',
    title: 'Analyze technicals',
    toolset: 'analysis',
    annotations: READ,
    description: 'Technical indicators for one symbol: RSI 14, SMA 50 and 200, VWAP, Bollinger Bands (20, 2) and signals (oversold, above SMA 200, …). Default range: 1 year of daily candles (about 250, enough for SMA 200).',
    input: z.object({ symbol: symbolRef, ...range }),
    handler: async ({ symbol, startDate: s, endDate: e, interval: iv }) => {
      const [id] = await ctx.resolveSymbolIds([symbol]);
      const { candles } = await loadCandles(ctx, id, { startDate: s, endDate: e, interval: iv });
      if (!candles.length) return { symbolId: id, error: 'No candles in this range.' };
      return { symbolId: id, interval: iv, ...technicals(candles) };
    },
  });

  defineTool(server, ctx, {
    name: 'qt_screen_watchlist',
    title: 'Screen symbols by technicals',
    toolset: 'analysis',
    annotations: READ,
    description: 'Screen up to 50 symbols against technical criteria (RSI bounds, above SMA 50/200, piercing the lower Bollinger Band, below VWAP). Returns the matches with their indicators, and why the others failed.',
    input: z.object({
      symbols: symbolRefs(50),
      ...range,
      criteria: z
        .object({
          maxRsi: z.number().min(0).max(100).optional(),
          minRsi: z.number().min(0).max(100).optional(),
          mustBeAbove50Sma: z.boolean().optional(),
          mustBeAbove200Sma: z.boolean().optional(),
          mustBePiercingLowerBB: z.boolean().optional(),
          mustBeBelowVwap: z.boolean().optional(),
        })
        .default({}),
    }),
    handler: async ({ symbols, startDate: s, endDate: e, interval: iv, criteria }) => {
      const ids = await ctx.resolveSymbolIds(symbols);
      const details = await ctx.symbolsById(ids).catch(() => new Map());
      const matched = [];
      const rejected = [];
      for (const id of ids) {
        const symbol = details.get(id)?.symbol || `#${id}`;
        try {
          const { candles } = await loadCandles(ctx, id, { startDate: s, endDate: e, interval: iv });
          if (!candles.length) {
            rejected.push({ symbol, reason: 'no candles' });
            continue;
          }
          const t = technicals(candles);
          const fails = [];
          if (criteria.maxRsi !== undefined && !(t.rsi14 !== null && t.rsi14 <= criteria.maxRsi)) fails.push(`RSI ${t.rsi14} > ${criteria.maxRsi}`);
          if (criteria.minRsi !== undefined && !(t.rsi14 !== null && t.rsi14 >= criteria.minRsi)) fails.push(`RSI ${t.rsi14} < ${criteria.minRsi}`);
          if (criteria.mustBeAbove50Sma && !t.signals.isAbove50Sma) fails.push('not above SMA 50');
          if (criteria.mustBeAbove200Sma && !t.signals.isAbove200Sma) fails.push('not above SMA 200');
          if (criteria.mustBePiercingLowerBB && !t.signals.isPiercingLowerBB) fails.push('not at the lower band');
          if (criteria.mustBeBelowVwap && !t.signals.isBelowVwap) fails.push('not below VWAP');
          if (fails.length) rejected.push({ symbol, reason: fails.join('; ') });
          else matched.push({ symbol, symbolId: id, ...t });
        } catch (error) {
          rejected.push({ symbol, reason: error.message });
        }
      }
      return { interval: iv, criteria, matched, rejected };
    },
  });
}
