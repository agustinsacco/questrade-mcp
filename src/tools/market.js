import * as z from 'zod';
import { paginateArray, round, shape, windowRows } from '../format.js';
import { QuestradeError } from '../questrade/errors.js';
import { DATE_RE, formatQt, resolveRange } from '../questrade/time.js';
import { priceChart } from '../charts.js';
import { READ, defineTool, detail, endDate, interval, page, pageSize, startDate, symbolRef, symbolRefs } from './common.js';

const SYMBOL_SUMMARY = [
  'symbol', 'symbolId', 'description', 'securityType', 'listingExchange', 'currency', 'prevDayClosePrice', 'highPrice52', 'lowPrice52',
  'averageVol3Months', 'eps', 'pe', 'dividend', 'yield', 'exDate', 'dividendDate', 'marketCap', 'industrySector', 'industryGroup', 'hasOptions', 'isTradable',
];
const QUOTE_SUMMARY = ['symbol', 'symbolId', 'lastTradePrice', 'bidPrice', 'askPrice', 'bidSize', 'askSize', 'volume', 'openPrice', 'highPrice', 'lowPrice', 'lastTradeTime', 'delay', 'isHalted'];
const OPTION_QUOTE_SUMMARY = ['symbol', 'symbolId', 'underlying', 'bidPrice', 'askPrice', 'lastTradePrice', 'volume', 'openInterest', 'volatility', 'delta', 'gamma', 'theta', 'vega', 'rho', 'delay', 'isHalted'];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

/** Default history per candle size when startDate is omitted (about 2000 candles or fewer). */
const DEFAULT_DAYS = { OneDay: 365, OneWeek: 5 * 365, OneMonth: 10 * 365, OneYear: 30 * 365, TwoHours: 60, FourHours: 120 };
export const defaultDaysFor = (iv) => DEFAULT_DAYS[iv] ?? 5;

/** Candles for one symbol over a range (Questrade caps a response at 2000). */
export async function loadCandles(ctx, symbolId, { startDate: s, endDate: e, interval: iv }) {
  const range = resolveRange({ startDate: s, endDate: e }, { defaultDays: defaultDaysFor(iv), maxDays: 50 * 365 });
  const key = `candles:${symbolId}:${range.start}:${range.end}:${iv}`;
  const data = await ctx.cache.get(key, () => ctx.client.get(`/v1/markets/candles/${symbolId}`, { startTime: formatQt(range.start), endTime: formatQt(range.end), interval: iv }));
  return { range, candles: data.candles || [] };
}

export function candleStats(candles) {
  if (!candles.length) return { count: 0 };
  const first = candles[0];
  const last = candles[candles.length - 1];
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  return {
    count: candles.length,
    from: first.start,
    to: last.end,
    firstClose: first.close,
    lastClose: last.close,
    change: round(last.close - first.open),
    changePct: first.open ? round(((last.close - first.open) / first.open) * 100) : undefined,
    high: Math.max(...highs),
    low: Math.min(...lows),
    averageVolume: Math.round(candles.reduce((n, c) => n + (c.volume || 0), 0) / candles.length),
  };
}

export function registerMarketTools(server, ctx) {
  defineTool(server, ctx, {
    name: 'qt_search_symbols',
    title: 'Search symbols',
    toolset: 'market',
    annotations: READ,
    description:
      'Find symbols by ticker prefix or a word in the company/fund name, e.g. "XEQT" or "shopify". Returns symbolId (what quotes, candles and analysis take), exchange and currency. TSX listings end in .TO; filter by exchange or currency to pick the right listing.',
    input: z.object({
      query: z.string().min(1).describe('Ticker prefix or a word in the description'),
      exchange: z.string().optional().describe('Only this listing exchange, e.g. TSX, NASDAQ, NYSE, TSXV, NEO'),
      currency: z.enum(['CAD', 'USD']).optional(),
      securityType: z.string().optional().describe('e.g. Stock, Option, Bond, MutualFund, Index'),
      offset: z.number().int().min(0).default(0).describe("Skip this many of Questrade's results; use nextOffset"),
    }),
    handler: async ({ query, exchange, currency, securityType, offset }) => {
      const data = await ctx.cache.get(`search:${query}:${offset}`, () => ctx.client.get('/v1/symbols/search', { prefix: query, offset }));
      const found = data.symbols || data.symbol || [];
      const rows = found.filter(
        (s) =>
          (!exchange || String(s.listingExchange).toUpperCase() === exchange.toUpperCase()) &&
          (!currency || s.currency === currency) &&
          (!securityType || String(s.securityType).toLowerCase() === securityType.toLowerCase()),
      );
      return {
        items: rows.map((s) => shape(pick(s, ['symbol', 'symbolId', 'description', 'securityType', 'listingExchange', 'currency', 'isTradable', 'isQuotable']))),
        returnedByQuestrade: found.length,
        ...(found.length ? { nextOffset: offset + found.length } : {}),
      };
    },
  });

  defineTool(server, ctx, {
    name: 'qt_get_symbols',
    title: 'Get symbol details',
    toolset: 'market',
    annotations: READ,
    description:
      'Details for up to 50 symbols: description, exchange, currency, previous close, 52-week range, average volume, EPS, P/E, dividend, yield, ex-date, market cap, sector and whether it has options.',
    input: z.object({ symbols: symbolRefs(50), detail }),
    handler: async ({ symbols, detail: d }) => {
      const ids = await ctx.resolveSymbolIds(symbols);
      const map = await ctx.symbolsById(ids);
      return { items: ids.map((id) => map.get(id)).filter(Boolean).map((s) => shape(d === 'full' ? s : pick(s, SYMBOL_SUMMARY), d)) };
    },
  });

  defineTool(server, ctx, {
    name: 'qt_get_quotes',
    title: 'Get quotes',
    toolset: 'market',
    annotations: READ,
    description:
      "Level 1 quotes for up to 100 symbols: last, bid/ask, size, day range, volume and change from the previous close. delay > 0 means the account's data subscription delays this market.",
    input: z.object({ symbols: symbolRefs(100), detail }),
    handler: async ({ symbols, detail: d }) => {
      const ids = await ctx.resolveSymbolIds(symbols);
      const [data, details] = await Promise.all([ctx.client.get('/v1/markets/quotes', { ids: ids.join(',') }), ctx.symbolsById(ids).catch(() => new Map())]);
      const items = (data.quotes || []).map((q) => {
        const prev = details.get(q.symbolId)?.prevDayClosePrice;
        const last = q.lastTradePrice ?? q.lastTradePriceTrHrs;
        const change = typeof prev === 'number' && typeof last === 'number' && prev ? { prevDayClosePrice: prev, change: round(last - prev), changePct: round(((last - prev) / prev) * 100) } : {};
        return shape({ ...(d === 'full' ? q : pick(q, QUOTE_SUMMARY)), ...change }, d);
      });
      return { items };
    },
  });

  defineTool(server, ctx, {
    name: 'qt_list_markets',
    title: 'List markets and trading hours',
    toolset: 'market',
    annotations: READ,
    description: "Markets Questrade supports (TSX, TSXV, NYSE, NASDAQ, …) with today's regular and extended hours and currency.",
    input: z.object({ detail }),
    handler: async ({ detail: d }) => {
      const data = await ctx.cache.get('markets', () => ctx.client.get('/v1/markets'));
      const items = (data.markets || []).map((m) => shape(d === 'full' ? m : pick(m, ['name', 'currency', 'startTime', 'endTime', 'extendedStartTime', 'extendedEndTime']), d));
      return { items };
    },
  });

  defineTool(server, ctx, {
    name: 'qt_get_option_chain',
    title: 'Get option chain',
    toolset: 'market',
    annotations: READ,
    description:
      'Option chain for an underlying. Without expiryDate: the expiry dates (with strike counts). With expiryDate: strikes with call and put symbolIds, by default the ones nearest the last price; pass minStrike/maxStrike for others. Quotes and Greeks: qt_get_option_quotes with those IDs.',
    input: z.object({
      symbol: symbolRef,
      expiryDate: z.string().regex(DATE_RE, 'YYYY-MM-DD').optional().describe('Expiry date, YYYY-MM-DD (from the list this tool returns without it)'),
      minStrike: z.number().optional(),
      maxStrike: z.number().optional(),
      page,
      pageSize: pageSize(100, 20),
    }),
    handler: async ({ symbol, expiryDate, minStrike, maxStrike, page: p, pageSize: size }) => {
      const [id] = await ctx.resolveSymbolIds([symbol]);
      const data = await ctx.cache.get(`chain:${id}`, () => ctx.client.get(`/v1/symbols/${id}/options`));
      const expiries = data.options || [];
      if (!expiryDate) {
        const items = expiries.map((x) =>
          shape({
            expiryDate: String(x.expiryDate).slice(0, 10),
            exerciseType: x.optionExerciseType,
            roots: x.chainPerRoot?.map((r) => r.root),
            strikes: x.chainPerRoot?.reduce((n, r) => n + (r.chainPerStrikePrice?.length || 0), 0),
          }),
        );
        return { underlyingId: id, note: 'Pass expiryDate to see strikes.', ...paginateArray(items, { page: p, pageSize: size }) };
      }
      const chain = expiries.find((x) => String(x.expiryDate).slice(0, 10) === expiryDate);
      if (!chain) throw new QuestradeError(`No ${expiryDate} expiry for this symbol. Call qt_get_option_chain without expiryDate to list them.`, { code: 'NOT_FOUND' });
      let strikes = (chain.chainPerRoot || []).flatMap((r) =>
        (r.chainPerStrikePrice || []).map((s) => ({ strikePrice: s.strikePrice, callSymbolId: s.callSymbolId, putSymbolId: s.putSymbolId, root: r.root, multiplier: r.multiplier })),
      );
      strikes.sort((x, y) => x.strikePrice - y.strikePrice);
      let around;
      if (minStrike === undefined && maxStrike === undefined) {
        const q = (await ctx.client.get('/v1/markets/quotes', { ids: String(id) })).quotes?.[0];
        around = q?.lastTradePrice ?? q?.lastTradePriceTrHrs;
        if (typeof around === 'number') {
          const nearest = [...strikes].sort((x, y) => Math.abs(x.strikePrice - around) - Math.abs(y.strikePrice - around)).slice(0, size);
          const keep = new Set(nearest);
          strikes = strikes.filter((s) => keep.has(s));
          return { underlyingId: id, expiryDate, lastPrice: around, note: `The ${size} strikes nearest the last price; pass minStrike/maxStrike for others.`, items: strikes };
        }
      }
      strikes = strikes.filter((s) => (minStrike === undefined || s.strikePrice >= minStrike) && (maxStrike === undefined || s.strikePrice <= maxStrike));
      return { underlyingId: id, expiryDate, ...paginateArray(strikes, { page: p, pageSize: size }) };
    },
  });

  defineTool(server, ctx, {
    name: 'qt_get_option_quotes',
    title: 'Get option quotes and Greeks',
    toolset: 'market',
    annotations: READ,
    description: 'Quotes for up to 100 option symbolIds (from qt_get_option_chain): bid/ask, last, volume, open interest, implied volatility and the Greeks (delta, gamma, theta, vega, rho).',
    input: z.object({ optionIds: z.array(z.number().int().positive()).min(1).max(100), detail }),
    handler: async ({ optionIds, detail: d }) => {
      const data = await ctx.client.post('/v1/markets/quotes/options', { optionIds });
      return { items: (data.optionQuotes || []).map((q) => shape(d === 'full' ? q : pick(q, OPTION_QUOTE_SUMMARY), d)) };
    },
  });

  defineTool(server, ctx, {
    name: 'qt_get_candles',
    title: 'Get price history (candles)',
    toolset: 'market',
    annotations: READ,
    description:
      'Price history for one symbol: summary stats (change, high, low, average volume), an ASCII chart of closes and OHLCV rows newest first (limit/offset). Questrade returns at most 2000 candles per request, so match interval to the range. Default range by interval: 1 year of daily, 5 years of weekly, 5 days of intraday.',
    input: z.object({
      symbol: symbolRef,
      startDate: startDate.optional(),
      endDate: endDate.optional(),
      interval,
      chart: z.boolean().default(true).describe('Include an ASCII chart of closes'),
      limit: z.number().int().min(0).max(500).default(30).describe('OHLCV rows to return, newest first (0 = stats and chart only)'),
      offset: z.number().int().min(0).default(0).describe('Rows to skip; use nextOffset'),
    }),
    handler: async ({ symbol, startDate: s, endDate: e, interval: iv, chart, limit, offset }) => {
      const [id] = await ctx.resolveSymbolIds([symbol]);
      const { range, candles } = await loadCandles(ctx, id, { startDate: s, endDate: e, interval: iv });
      const rows = candles.map((c) => [c.end ?? c.start, c.open, c.high, c.low, c.close, c.volume]).reverse();
      return {
        symbolId: id,
        interval: iv,
        range: { startTime: formatQt(range.start), endTime: formatQt(range.end) },
        stats: candleStats(candles),
        ...(candles.length >= 2000 ? { warning: 'Questrade returned its 2000-candle maximum: the range was cut short. Use a larger interval or a shorter range.' } : {}),
        ...(chart && candles.length ? { chart: `\n${priceChart(candles)}` } : {}),
        columns: ['end', 'open', 'high', 'low', 'close', 'volume'],
        ...windowRows(rows, { offset, limit }),
      };
    },
  });
}
