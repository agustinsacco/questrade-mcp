import * as z from 'zod';
import { addTo, paginateArray, round, shape } from '../format.js';
import { QuestradeError } from '../questrade/errors.js';
import { dateOf, formatQt, resolveRange } from '../questrade/time.js';
import { READ, accountId, defineTool, detail, endDate, matches, page, pageSize, startDate } from './common.js';

const RANGE_NOTE = 'Default range: the last 30 days. Any range works (split into 30-day requests and cached briefly).';

function rangeOut({ start, end }) {
  return { startTime: formatQt(start), endTime: formatQt(end) };
}

const pnl = (p, key) => p[key] ?? p[key.replace(/Pnl$/, 'PnL')];

/** Positions with currency and description from symbol details, plus per-currency totals and weights. */
export async function loadPositions(ctx, account) {
  const data = await ctx.cache.get(`positions:${account}`, () => ctx.client.get(`/v1/accounts/${encodeURIComponent(account)}/positions`));
  const positions = data.positions || [];
  const symbols = await ctx.symbolsById(positions.map((p) => p.symbolId)).catch(() => new Map());
  const rows = positions.map((p) => {
    const s = symbols.get(p.symbolId) || {};
    const cost = typeof p.totalCost === 'number' ? p.totalCost : undefined;
    const open = pnl(p, 'openPnl');
    return {
      symbol: p.symbol,
      symbolId: p.symbolId,
      description: s.description,
      currency: s.currency,
      securityType: s.securityType,
      quantity: p.openQuantity,
      averageEntryPrice: p.averageEntryPrice,
      currentPrice: p.currentPrice,
      marketValue: p.currentMarketValue,
      totalCost: cost,
      openPnl: open,
      openPnlPct: cost && typeof open === 'number' ? round((open / cost) * 100) : undefined,
      dayPnl: pnl(p, 'dayPnl'),
      closedPnl: pnl(p, 'closedPnl'),
      closedQuantity: p.closedQuantity || undefined,
      isRealTime: p.isRealTime,
      isUnderReorg: p.isUnderReorg || undefined,
    };
  });
  const totals = {};
  for (const r of rows) {
    const cur = r.currency || 'unknown';
    addTo(totals, cur, 'marketValue', r.marketValue);
    addTo(totals, cur, 'totalCost', r.totalCost);
    addTo(totals, cur, 'openPnl', r.openPnl);
    addTo(totals, cur, 'dayPnl', r.dayPnl);
    addTo(totals, cur, 'positions', 1);
  }
  for (const r of rows) {
    const t = totals[r.currency || 'unknown']?.marketValue;
    if (t && typeof r.marketValue === 'number') r.weightPct = round((r.marketValue / t) * 100);
  }
  for (const t of Object.values(totals)) for (const k of Object.keys(t)) t[k] = round(t[k]);
  return { rows, totals };
}

export async function loadActivities(ctx, account, range) {
  const rows = await ctx.fetchRange('activities', account, range);
  return rows.map((a) => ({
    date: dateOf(a.tradeDate) || dateOf(a.transactionDate),
    transactionDate: dateOf(a.transactionDate),
    settlementDate: dateOf(a.settlementDate),
    type: a.type,
    action: a.action,
    symbol: a.symbol,
    symbolId: a.symbolId || undefined,
    description: a.description,
    currency: a.currency,
    quantity: a.quantity,
    price: a.price,
    grossAmount: a.grossAmount,
    commission: a.commission,
    netAmount: a.netAmount,
  }));
}

const SUMMARY_ACTIVITY = ['date', 'type', 'action', 'symbol', 'description', 'currency', 'quantity', 'price', 'netAmount'];
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

export function registerAccountTools(server, ctx) {
  defineTool(server, ctx, {
    name: 'qt_get_balances',
    title: 'Get account balances',
    toolset: 'accounts',
    annotations: READ,
    description:
      'Cash, market value, total equity, buying power and maintenance excess for one account. perCurrency shows the CAD and USD sides separately; combined expresses the whole account in each currency. startOfDay adds the same figures as of the market open.',
    input: z.object({
      accountId,
      includeStartOfDay: z.boolean().default(false).describe('Also return start-of-day balances'),
    }),
    handler: async ({ accountId: a, includeStartOfDay }) => {
      const account = await ctx.resolveAccountId(a);
      const b = await ctx.cache.get(`balances:${account}`, () => ctx.client.get(`/v1/accounts/${encodeURIComponent(account)}/balances`));
      return shape({
        accountId: account,
        perCurrency: b.perCurrencyBalances,
        combined: b.combinedBalances,
        ...(includeStartOfDay ? { startOfDay: { perCurrency: b.sodPerCurrencyBalances, combined: b.sodCombinedBalances } } : {}),
      }, 'full');
    },
  });

  defineTool(server, ctx, {
    name: 'qt_list_positions',
    title: 'List positions',
    toolset: 'accounts',
    annotations: READ,
    description:
      'Holdings in one account: quantity, average cost, price, market value, open and day P&L, and each position\'s weight within its currency. totals (per currency) always cover every position, not just this page. For all accounts at once use qt_run_report allocation.',
    input: z.object({
      accountId,
      search: z.string().optional().describe('Filter by symbol or description (contains, case-insensitive)'),
      sort: z.enum(['marketValue_desc', 'symbol', 'openPnl_desc', 'openPnl_asc', 'openPnlPct_desc', 'openPnlPct_asc']).default('marketValue_desc'),
      page,
      pageSize: pageSize(100, 50),
    }),
    handler: async ({ accountId: a, search, sort, page: p, pageSize: size }) => {
      const account = await ctx.resolveAccountId(a);
      const { rows, totals } = await loadPositions(ctx, account);
      const filtered = rows.filter((r) => matches(search, r.symbol, r.description));
      const [field, dir] = sort === 'symbol' ? ['symbol', 'asc'] : sort.split('_');
      const val = (r) => r[field] ?? (dir === 'asc' ? Infinity : -Infinity);
      filtered.sort((x, y) => (field === 'symbol' ? String(x.symbol).localeCompare(String(y.symbol)) : dir === 'asc' ? val(x) - val(y) : val(y) - val(x)));
      return { accountId: account, totals, ...paginateArray(filtered.map((r) => shape(r)), { page: p, pageSize: size }) };
    },
  });

  defineTool(server, ctx, {
    name: 'qt_list_activities',
    title: 'List account activities',
    toolset: 'accounts',
    annotations: READ,
    description:
      `Account activity: trades, dividends, deposits, withdrawals, interest, fees, transfers and FX conversions, newest first. Filter by type, action, symbol or text. totals (count and net amount by type and currency) cover every matching activity, not just this page. ${RANGE_NOTE}`,
    input: z.object({
      accountId,
      startDate: startDate.optional(),
      endDate: endDate.optional(),
      type: z.string().optional().describe('Activity type contains, e.g. Trades, Dividends, Deposits, Withdrawals, Interest, Fees'),
      action: z.string().optional().describe('Exact action, e.g. Buy, Sell, DIV, CON (contribution)'),
      symbol: z.string().optional().describe('Exact symbol, e.g. XEQT.TO'),
      search: z.string().optional().describe('Text in the description (contains, case-insensitive)'),
      sort: z.enum(['date_desc', 'date_asc']).default('date_desc'),
      detail,
      page,
      pageSize: pageSize(100, 20),
    }),
    handler: async ({ accountId: a, startDate: s, endDate: e, type, action, symbol, search, sort, detail: d, page: p, pageSize: size }) => {
      const account = await ctx.resolveAccountId(a);
      const range = resolveRange({ startDate: s, endDate: e }, { maxDays: ctx.config.maxRangeDays });
      const all = await loadActivities(ctx, account, range);
      const rows = all.filter(
        (r) =>
          matches(type, r.type) &&
          (!action || String(r.action).toLowerCase() === action.toLowerCase()) &&
          (!symbol || String(r.symbol).toUpperCase() === symbol.toUpperCase()) &&
          matches(search, r.description),
      );
      const order = sort === 'date_asc' ? 1 : -1;
      rows.sort((x, y) => order * String(x.date).localeCompare(String(y.date)));
      const totals = {};
      for (const r of rows) {
        const key = `${r.type || 'Other'} ${r.currency || ''}`.trim();
        addTo(totals, key, 'count', 1);
        addTo(totals, key, 'netAmount', r.netAmount);
      }
      for (const t of Object.values(totals)) t.netAmount = round(t.netAmount);
      const items = rows.map((r) => shape(d === 'full' ? r : pick(r, SUMMARY_ACTIVITY), d));
      return { accountId: account, range: rangeOut(range), totals, ...paginateArray(items, { page: p, pageSize: size }) };
    },
  });

  defineTool(server, ctx, {
    name: 'qt_list_executions',
    title: 'List executions (fills)',
    toolset: 'accounts',
    annotations: READ,
    description: `Trade executions (fills) with price, quantity, commission and fees, newest first. Filter by symbol, side or orderId. ${RANGE_NOTE}`,
    input: z.object({
      accountId,
      startDate: startDate.optional(),
      endDate: endDate.optional(),
      symbol: z.string().optional().describe('Exact symbol, e.g. AAPL'),
      side: z.string().optional().describe('Buy, Sell, Short, Cov, …'),
      orderId: z.number().int().optional(),
      page,
      pageSize: pageSize(100, 20),
    }),
    handler: async ({ accountId: a, startDate: s, endDate: e, symbol, side, orderId, page: p, pageSize: size }) => {
      const account = await ctx.resolveAccountId(a);
      const range = resolveRange({ startDate: s, endDate: e }, { maxDays: ctx.config.maxRangeDays });
      const seen = new Set();
      const rows = (await ctx.fetchRange('executions', account, range))
        .filter((x) => (x.id ? !seen.has(x.id) && seen.add(x.id) : true))
        .filter((x) => (!symbol || String(x.symbol).toUpperCase() === symbol.toUpperCase()) && (!side || String(x.side).toLowerCase() === side.toLowerCase()) && (!orderId || x.orderId === orderId))
        .map((x) => ({
          time: x.timestamp ?? x.timestam,
          symbol: x.symbol,
          symbolId: x.symbolId,
          side: x.side,
          quantity: x.quantity,
          price: x.price,
          totalCost: x.totalCost,
          commission: x.commission,
          fees: round((x.executionFee || 0) + (x.secFee || 0) + (x.canadianExecutionFee || 0) + (x.orderPlacementCommission || 0)) || undefined,
          venue: x.venue,
          id: x.id,
          orderId: x.orderId,
        }))
        .sort((x, y) => String(y.time).localeCompare(String(x.time)));
      return { accountId: account, range: rangeOut(range), ...paginateArray(rows.map((r) => shape(r)), { page: p, pageSize: size }) };
    },
  });

  defineTool(server, ctx, {
    name: 'qt_list_orders',
    title: 'List orders',
    toolset: 'accounts',
    annotations: READ,
    description: `Orders (read-only history): open, filled, cancelled, rejected. Filter by state or symbol; newest first. ${RANGE_NOTE}`,
    input: z.object({
      accountId,
      state: z.enum(['All', 'Open', 'Closed']).default('All'),
      startDate: startDate.optional(),
      endDate: endDate.optional(),
      symbol: z.string().optional().describe('Exact symbol'),
      detail,
      page,
      pageSize: pageSize(100, 20),
    }),
    handler: async ({ accountId: a, state, startDate: s, endDate: e, symbol, detail: d, page: p, pageSize: size }) => {
      const account = await ctx.resolveAccountId(a);
      const range = resolveRange({ startDate: s, endDate: e }, { maxDays: ctx.config.maxRangeDays });
      const seen = new Set();
      const rows = (await ctx.fetchRange('orders', account, range, { stateFilter: state }))
        .filter((o) => !seen.has(o.id) && seen.add(o.id))
        .filter((o) => !symbol || String(o.symbol).toUpperCase() === symbol.toUpperCase())
        .sort((x, y) => String(y.creationTime).localeCompare(String(x.creationTime)));
      return { accountId: account, range: rangeOut(range), ...paginateArray(rows.map((o) => (d === 'full' ? shape(o, 'full') : orderSummary(o))), { page: p, pageSize: size }) };
    },
  });

  defineTool(server, ctx, {
    name: 'qt_get_order',
    title: 'Get one order',
    toolset: 'accounts',
    annotations: READ,
    description: 'Every field of one order (legs, routes, commissions, timestamps). Its fills: qt_list_executions with orderId.',
    input: z.object({ accountId, orderId: z.number().int().positive() }),
    handler: async ({ accountId: a, orderId }) => {
      const account = await ctx.resolveAccountId(a);
      const data = await ctx.client.get(`/v1/accounts/${encodeURIComponent(account)}/orders/${orderId}`);
      const order = data.orders?.[0];
      if (!order) throw new QuestradeError(`Order ${orderId} was not found in account ${account}.`, { code: 'NOT_FOUND' });
      return shape({ accountId: account, ...order }, 'full');
    },
  });
}

function orderSummary(o) {
  return shape({
    id: o.id,
    symbol: o.symbol,
    side: o.side,
    type: o.type,
    state: o.state,
    totalQuantity: o.totalQuantity,
    filledQuantity: o.filledQuantity,
    limitPrice: o.limitPrice,
    stopPrice: o.stopPrice,
    avgExecPrice: o.avgExecPrice,
    timeInForce: o.timeInForce,
    creationTime: o.creationTime,
    updateTime: o.updateTime,
    commission: o.comissionCharged ?? o.commissionCharged,
    legs: o.legs?.length ? o.legs.length : undefined,
  });
}
