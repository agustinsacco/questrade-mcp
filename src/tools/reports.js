import * as z from 'zod';
import { round, shape, windowRows } from '../format.js';
import { formatQt, resolveRange } from '../questrade/time.js';
import { READ, accountId, defineTool, endDate, startDate } from './common.js';
import { loadActivities, loadPositions } from './accounts.js';

export const REPORTS = ['portfolio_summary', 'allocation', 'dividend_income', 'activity_summary'];

const BASIS = {
  portfolio_summary: "Questrade's live balances. combined figures express each whole account in CAD and in USD at Questrade's rate, so they add up across accounts.",
  allocation: 'Live positions; currency and security type come from symbol details. Weights are within each currency (no FX conversion).',
  dividend_income: "Account activities whose type contains 'Dividend', net amounts (after any withholding tax), by trade date.",
  activity_summary: 'Account activities grouped by type and currency; net amounts as Questrade records them (deposits positive, withdrawals and fees negative).',
};

/**
 * Sum numeric fields into groups. `key` returns the group's identity fields
 * (e.g. { type, currency }); the result is rows of identity + sums.
 */
function group(rows, key, sums) {
  const map = new Map();
  for (const r of rows) {
    const id = key(r);
    const k = JSON.stringify(id);
    const g = map.get(k) || { ...id, ...Object.fromEntries(Object.keys(sums).map((f) => [f, 0])) };
    for (const [field, value] of Object.entries(sums)) g[field] += value(r) || 0;
    map.set(k, g);
  }
  return [...map.values()].map((g) => {
    for (const f of Object.keys(sums)) g[f] = round(g[f]);
    return shape(g);
  });
}

async function targetAccounts(ctx, explicit) {
  const { accounts } = await ctx.listAccounts();
  if (explicit) return [accounts.find((a) => a.number === String(explicit)) || { number: String(explicit) }];
  return accounts.filter((a) => !a.status || a.status === 'Active');
}

export function registerReportTools(server, ctx) {
  defineTool(server, ctx, {
    name: 'qt_run_report',
    title: 'Run a portfolio report',
    toolset: 'reports',
    annotations: READ,
    description:
      'Portfolio reports computed from live Questrade data, across all active accounts unless accountId is given. ' +
      'portfolio_summary: equity, cash and market value per account and in total. ' +
      'allocation: positions combined across accounts by symbol, with weights and a breakdown by security type. ' +
      'dividend_income: dividends by symbol and by month (startDate/endDate; default year to date). ' +
      'activity_summary: activity by type and currency, net deposits per account and commissions (default year to date). ' +
      'Rows are paginated with limit/offset; totals always cover every row; each report states its basis.',
    input: z.object({
      report: z.enum(REPORTS),
      accountId,
      startDate: startDate.optional(),
      endDate: endDate.optional(),
      limit: z.number().int().min(1).max(200).default(25).describe('Rows to return'),
      offset: z.number().int().min(0).default(0).describe('Rows to skip; use nextOffset'),
    }),
    handler: async ({ report, accountId: a, startDate: s, endDate: e, limit, offset }) => {
      const accounts = await targetAccounts(ctx, a);
      const head = { report, basis: BASIS[report], accounts: accounts.map((x) => shape({ number: x.number, type: x.type })) };

      if (report === 'portfolio_summary') {
        const rows = [];
        for (const acct of accounts) {
          const b = await ctx.cache.get(`balances:${acct.number}`, () => ctx.client.get(`/v1/accounts/${encodeURIComponent(acct.number)}/balances`));
          for (const c of b.combinedBalances || []) {
            rows.push({ accountId: acct.number, type: acct.type, currency: c.currency, totalEquity: c.totalEquity, cash: c.cash, marketValue: c.marketValue, buyingPower: c.buyingPower });
          }
        }
        const totals = group(rows, (r) => ({ currency: r.currency }), { totalEquity: (r) => r.totalEquity, cash: (r) => r.cash, marketValue: (r) => r.marketValue });
        return { ...head, totals, ...windowRows(rows.map((r) => shape(r)), { offset, limit }) };
      }

      if (report === 'allocation') {
        const positions = [];
        for (const acct of accounts) for (const r of (await loadPositions(ctx, acct.number)).rows) positions.push({ ...r, accountId: acct.number });
        const totals = group(positions, (r) => ({ currency: r.currency || 'unknown' }), { marketValue: (r) => r.marketValue, totalCost: (r) => r.totalCost, openPnl: (r) => r.openPnl });
        const totalOf = (currency) => totals.find((t) => t.currency === (currency || 'unknown'))?.marketValue;
        const withWeight = (r) => ({ ...r, weightPct: totalOf(r.currency) ? round((r.marketValue / totalOf(r.currency)) * 100) : undefined });
        const bySymbol = group(
          positions,
          (r) => ({ symbol: r.symbol, symbolId: r.symbolId, description: r.description, currency: r.currency, securityType: r.securityType }),
          { quantity: (r) => r.quantity, marketValue: (r) => r.marketValue, totalCost: (r) => r.totalCost, openPnl: (r) => r.openPnl },
        ).map((r) => ({ ...withWeight(r), accounts: [...new Set(positions.filter((p) => p.symbolId === r.symbolId).map((p) => p.accountId))] }));
        bySymbol.sort((x, y) => (y.marketValue ?? 0) - (x.marketValue ?? 0));
        const bySecurityType = group(positions, (r) => ({ securityType: r.securityType || 'Other', currency: r.currency }), { marketValue: (r) => r.marketValue }).map(withWeight);
        return { ...head, totals, bySecurityType, ...windowRows(bySymbol, { offset, limit }) };
      }

      const yearStart = `${formatQt(Date.now()).slice(0, 4)}-01-01`;
      const range = resolveRange({ startDate: s ?? yearStart, endDate: e }, { maxDays: ctx.config.maxRangeDays });
      const all = [];
      for (const acct of accounts) for (const r of await loadActivities(ctx, acct.number, range)) all.push({ ...r, accountId: acct.number });
      const period = { startTime: formatQt(range.start), endTime: formatQt(range.end) };

      if (report === 'dividend_income') {
        const divs = all.filter((r) => /dividend/i.test(r.type || ''));
        const totals = group(divs, (r) => ({ currency: r.currency }), { amount: (r) => r.netAmount, payments: () => 1 });
        const byMonth = group(divs, (r) => ({ month: String(r.date).slice(0, 7), currency: r.currency }), { amount: (r) => r.netAmount }).sort((x, y) => x.month.localeCompare(y.month));
        const bySymbol = group(divs, (r) => ({ symbol: r.symbol || r.description?.slice(0, 40), currency: r.currency }), { amount: (r) => r.netAmount, payments: () => 1 }).sort((x, y) => y.amount - x.amount);
        return { ...head, period, totals, byMonth, ...windowRows(bySymbol, { offset, limit }) };
      }

      // activity_summary
      const byType = group(all, (r) => ({ type: r.type || 'Other', currency: r.currency }), { count: () => 1, netAmount: (r) => r.netAmount }).sort((x, y) => Math.abs(y.netAmount ?? 0) - Math.abs(x.netAmount ?? 0));
      const netDeposits = group(
        all.filter((r) => /deposit|withdraw|transfer/i.test(r.type || '')),
        (r) => ({ accountId: r.accountId, currency: r.currency }),
        { net: (r) => r.netAmount },
      );
      const commissions = group(all.filter((r) => r.commission), (r) => ({ currency: r.currency }), { commission: (r) => -Math.abs(r.commission) });
      return { ...head, period, activities: all.length, netDeposits, commissions, ...windowRows(byType, { offset, limit }) };
    },
  });
}
