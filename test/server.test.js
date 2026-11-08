import test from 'node:test';
import assert from 'node:assert/strict';
import { startFakeQuestrade } from './helpers/fake-questrade.js';
import { connect, tempCredentials } from './helpers/harness.js';

let fake;
let h;
test.before(async () => {
  fake = await startFakeQuestrade();
  h = await connect(fake);
});
test.after(async () => {
  await h.close();
  await fake.close();
});

const requests = (path) => fake.state.requests.filter((r) => r.path === path);

test('catalog: 19 read-only tools with titles, two resources, three prompts', async () => {
  const { tools } = await h.client.listTools();
  assert.equal(tools.length, 19);
  for (const t of tools) {
    assert.match(t.name, /^qt_[a-z_]+$/);
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.equal(t.annotations.destructiveHint, false, t.name);
    assert.ok(t.annotations.title && t.description.length > 40, t.name);
  }
  const { resources } = await h.client.listResources();
  assert.deepEqual(resources.map((r) => r.uri).sort(), ['questrade://guide', 'questrade://limitations']);
  const guide = (await h.client.readResource({ uri: 'questrade://guide' })).contents[0].text;
  assert.match(guide, /^# Questrade portfolio/);
  assert.match(guide, /node \S*bin\/questrade-mcp\.js login/);
  assert.ok(!guide.includes('<package>'));
  const { prompts } = await h.client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name).sort(), ['dividend_report', 'portfolio_review', 'research_symbol']);
  assert.match(h.client.getInstructions(), /^Questrade brokerage, read-only\. Call qt_get_context first/);
});

test('context: accounts, server time, and no silent default with two accounts', async () => {
  const r = await h.call('qt_get_context');
  assert.equal(r.isError, false);
  assert.equal(r.json.auth.mode, 'oauth');
  assert.ok(!r.text.includes('access-token-'), 'no token values');
  assert.deepEqual(r.json.accounts.map((a) => a.number), ['11111111', '22222222']);
  assert.equal(r.json.defaultAccountId, null);
  assert.match(r.json.defaultAccountNote, /2 accounts, so pass accountId .*11111111 \(TFSA Individual\)/);
  const balances = await h.call('qt_get_balances', {});
  assert.equal(balances.isError, true);
  assert.match(balances.text, /pass accountId/);
});

test('context without credentials explains sign-in', async () => {
  const bare = await connect(fake, { credentials: tempCredentials(null) });
  try {
    const r = await bare.call('qt_get_context');
    assert.equal(r.json.auth.mode, 'none');
    assert.match(r.json.setup, /questrade-mcp\.js login/);
    const p = await bare.call('qt_list_positions', { accountId: '11111111' });
    assert.equal(p.isError, true);
    assert.match(p.text, /No Questrade refresh token is configured/);
  } finally {
    await bare.close();
  }
});

test('positions: currency from symbol details, weights and totals per currency, sorting, paging', async () => {
  const r = await h.call('qt_list_positions', { accountId: '22222222' });
  assert.deepEqual(r.json.totals, { CAD: { marketValue: 1550, totalCost: 1500, openPnl: 50, dayPnl: 50, positions: 1 }, USD: { marketValue: 1000, totalCost: 750, openPnl: 250, dayPnl: -5, positions: 1 } });
  assert.deepEqual(r.json.items.map((p) => [p.symbol, p.currency, p.weightPct]), [['XEQT.TO', 'CAD', 100], ['AAPL', 'USD', 100]]);
  assert.equal(r.json.items[1].openPnlPct, 33.33);
  const byPnl = await h.call('qt_list_positions', { accountId: '11111111', sort: 'openPnl_asc', pageSize: 1 });
  assert.equal(byPnl.json.items[0].symbol, 'BNS.TO');
  assert.equal(byPnl.json.nextPage, 2);
  assert.equal(byPnl.json.totals.CAD.marketValue, 3800, 'totals cover every position, not just the page');
});

test('activities: long ranges are split into windows of at most 31 days; filters and totals', async () => {
  fake.state.requests.length = 0;
  const r = await h.call('qt_list_activities', { accountId: '11111111', startDate: '2026-01-01', endDate: '2026-04-30' });
  assert.equal(r.isError, false, r.text);
  const calls = requests('/v1/accounts/11111111/activities');
  assert.equal(calls.length, 4);
  for (const c of calls) assert.ok(Date.parse(c.query.endTime) - Date.parse(c.query.startTime) <= 31 * 86_400_000);
  assert.match(calls[0].query.startTime, /^2026-01-01T00:00:00-05:00$/);
  assert.match(calls.at(-1).query.endTime, /^2026-04-30T23:59:59-04:00$/, 'Toronto offset follows DST');
  assert.equal(r.json.totalCount, 5);
  assert.deepEqual(r.json.items.map((i) => i.date), ['2026-04-15', '2026-03-30', '2026-02-20', '2026-01-06', '2026-01-05']);
  assert.deepEqual(r.json.totals['Dividends CAD'], { count: 2, netAmount: 23.5 });
  const divs = await h.call('qt_list_activities', { accountId: '11111111', startDate: '2026-01-01', endDate: '2026-04-30', type: 'dividend', sort: 'date_asc' });
  assert.deepEqual(divs.json.items.map((i) => i.symbol), ['BNS.TO', 'XEQT.TO']);
  assert.equal(requests('/v1/accounts/11111111/activities').length, 4, 'the same range is served from the cache');
  const bad = await h.call('qt_list_activities', { accountId: '11111111', startDate: '2026-02-30' });
  assert.match(bad.text, /not a real calendar date/);
  const inverted = await h.call('qt_list_activities', { accountId: '11111111', startDate: '2026-05-01', endDate: '2026-04-01' });
  assert.match(inverted.text, /startDate is after endDate/);
});

test('executions, orders and one order', async () => {
  const ex = await h.call('qt_list_executions', { accountId: '11111111', startDate: '2026-01-01', endDate: '2026-01-31' });
  assert.deepEqual(ex.json.items.map((x) => [x.symbol, x.quantity, x.commission, x.fees]), [['XEQT.TO', 100, 4.95, 0.1]]);
  const orders = await h.call('qt_list_orders', { accountId: '11111111', startDate: '2026-01-01', endDate: '2026-01-31' });
  assert.deepEqual(orders.json.items.map((o) => [o.id, o.state, o.commission]), [[900, 'Executed', 4.95]]);
  assert.equal(requests('/v1/accounts/11111111/orders').at(-1).query.stateFilter, 'All');
  const one = await h.call('qt_get_order', { accountId: '11111111', orderId: 900 });
  assert.equal(one.json.limitPrice, 28);
  const missing = await h.call('qt_get_order', { accountId: '11111111', orderId: 1 });
  assert.match(missing.text, /Order 1 was not found/);
});

test('symbols: search with filters, details by ticker, unknown ticker, quotes with change', async () => {
  const s = await h.call('qt_search_symbols', { query: 'AAPL', exchange: 'NASDAQ' });
  assert.deepEqual(s.json.items.map((x) => x.symbolId), [8049]);
  assert.equal(s.json.returnedByQuestrade, 2);
  const d = await h.call('qt_get_symbols', { symbols: ['aapl', 101] });
  assert.deepEqual(d.json.items.map((x) => x.symbol).sort(), ['AAPL', 'XEQT.TO']);
  assert.equal(d.json.items.find((x) => x.symbol === 'AAPL').pe, 31);
  assert.equal(requests('/v1/symbols').at(-1).query.names, 'AAPL', 'tickers are upper-cased and resolved by name');
  const unknown = await h.call('qt_get_quotes', { symbols: ['NOPE.TO'] });
  assert.equal(unknown.isError, true);
  assert.match(unknown.text, /Unknown symbol\(s\): NOPE\.TO.*qt_search_symbols/);
  const q = await h.call('qt_get_quotes', { symbols: ['AAPL'] });
  assert.deepEqual([q.json.items[0].prevDayClosePrice, q.json.items[0].changePct], [200, 10]);
  const m = await h.call('qt_list_markets');
  assert.equal(m.json.items[0].name, 'TSX');
  assert.equal(m.json.items[0].tradingVenues, undefined, 'summary omits venue lists');
});

test('options: expiries first, then the strikes nearest the last price, then quotes with Greeks', async () => {
  const exp = await h.call('qt_get_option_chain', { symbol: 'AAPL' });
  assert.deepEqual(exp.json.items.map((x) => [x.expiryDate, x.strikes]), [['2026-12-18', 7], ['2027-01-15', 1]]);
  const near = await h.call('qt_get_option_chain', { symbol: 'AAPL', expiryDate: '2026-12-18', pageSize: 3 });
  assert.ok(Math.abs(near.json.lastPrice - 220) < 1e-9, 'fake last price is 1.1 x 200');
  assert.deepEqual(near.json.items.map((x) => x.strikePrice), [200, 210, 220], 'the 3 strikes nearest 220, in strike order');
  assert.deepEqual(Object.keys(near.json.items[0]).sort(), ['callSymbolId', 'multiplier', 'putSymbolId', 'root', 'strikePrice']);
  const ranged = await h.call('qt_get_option_chain', { symbol: 'AAPL', expiryDate: '2026-12-18', minStrike: 180, maxStrike: 200 });
  assert.deepEqual(ranged.json.items.map((x) => x.strikePrice), [180, 190, 200]);
  const none = await h.call('qt_get_option_chain', { symbol: 'AAPL', expiryDate: '2030-01-01' });
  assert.match(none.text, /No 2030-01-01 expiry/);
  const quotes = await h.call('qt_get_option_quotes', { optionIds: [70003] });
  assert.deepEqual(requests('/v1/markets/quotes/options').at(-1).body, { optionIds: [70003] });
  assert.equal(quotes.json.items[0].delta, 0.5);
});

test('candles: stats, chart and newest-first rows with offset paging', async () => {
  const r = await h.call('qt_get_candles', { symbol: 101, startDate: '2026-01-01', endDate: '2026-01-10', limit: 3 });
  assert.equal(r.json.stats.count, 10);
  assert.equal(r.json.stats.firstClose, 101);
  assert.equal(r.json.stats.lastClose, 110);
  assert.equal(r.json.stats.changePct, 10);
  assert.match(r.json.chart, /┤/);
  assert.deepEqual(r.json.columns, ['end', 'open', 'high', 'low', 'close', 'volume']);
  assert.deepEqual(r.json.items.map((x) => x[4]), [110, 109, 108]);
  assert.equal(r.json.nextOffset, 3);
  const statsOnly = await h.call('qt_get_candles', { symbol: 101, startDate: '2026-01-01', endDate: '2026-01-10', limit: 0, chart: false });
  assert.deepEqual([statsOnly.json.items.length, statsOnly.json.chart], [0, undefined]);
});

test('analysis: compare, technicals and screen', async () => {
  const cmp = await h.call('qt_compare_symbols', { symbols: ['XEQT.TO', 'AAPL'], startDate: '2026-01-01', endDate: '2026-01-31' });
  assert.equal(cmp.json.items.length, 2);
  assert.equal(cmp.json.items[0].maxDrawdownPct, 0);
  assert.match(cmp.json.chart, /% change/);
  const tech = await h.call('qt_analyze_technicals', { symbol: 'AAPL', startDate: '2025-01-01', endDate: '2026-01-31' });
  assert.equal(tech.json.signals.isAbove200Sma, true);
  assert.equal(tech.json.signals.isOverbought, true);
  const screen = await h.call('qt_screen_watchlist', { symbols: ['AAPL', 'XEQT.TO'], startDate: '2026-01-01', endDate: '2026-03-31', criteria: { maxRsi: 30 } });
  assert.deepEqual(screen.json.matched, []);
  assert.equal(screen.json.rejected.length, 2);
  assert.match(screen.json.rejected[0].reason, /RSI 100 > 30/);
});

test('reports: portfolio_summary, allocation, dividend_income and activity_summary across accounts', async () => {
  const sum = await h.call('qt_run_report', { report: 'portfolio_summary' });
  assert.deepEqual(sum.json.totals, [{ currency: 'CAD', totalEquity: 7820, cash: 1100, marketValue: 6720 }, { currency: 'USD', totalEquity: 5708, cash: 803, marketValue: 4905 }]);
  assert.equal(sum.json.totalCount, 4);
  assert.match(sum.json.basis, /combined/);

  const alloc = await h.call('qt_run_report', { report: 'allocation' });
  const xeqt = alloc.json.items.find((x) => x.symbol === 'XEQT.TO');
  assert.deepEqual([xeqt.quantity, xeqt.marketValue, xeqt.accounts], [150, 4650, ['11111111', '22222222']]);
  assert.equal(xeqt.weightPct, 86.92, '4650 of 5350 CAD');
  assert.deepEqual(alloc.json.totals.map((t) => [t.currency, t.marketValue]), [['CAD', 5350], ['USD', 1000]]);

  const div = await h.call('qt_run_report', { report: 'dividend_income', startDate: '2026-01-01', endDate: '2026-12-31' });
  assert.deepEqual(div.json.totals, [{ currency: 'CAD', amount: 23.5, payments: 2 }, { currency: 'USD', amount: 1.25, payments: 1 }]);
  assert.deepEqual(div.json.byMonth.map((m) => m.month), ['2026-02', '2026-02', '2026-03']);
  assert.equal(div.json.items[0].symbol, 'XEQT.TO');

  const act = await h.call('qt_run_report', { report: 'activity_summary', startDate: '2026-01-01', endDate: '2026-12-31' });
  assert.equal(act.json.activities, 7);
  const fees = act.json.items.find((r) => r.type === 'Fees and rebates');
  assert.deepEqual([fees.currency, fees.count, fees.netAmount], ['CAD', 1, -2]);
  assert.deepEqual(act.json.netDeposits, [{ accountId: '11111111', currency: 'CAD', net: 7000 }, { accountId: '22222222', currency: 'USD', net: 1000 }]);
  assert.deepEqual(act.json.commissions, [{ currency: 'CAD', commission: -4.95 }]);
});

test('responses stay under the size budget and say how to page', async () => {
  const small = await connect(fake, { env: { QUESTRADE_MCP_MAX_RESPONSE_CHARS: '4000' } });
  try {
    const r = await small.call('qt_get_candles', { symbol: 101, startDate: '2025-01-01', endDate: '2026-01-01', limit: 500, chart: false });
    assert.ok(r.text.length <= 4000);
    assert.match(r.json.truncated.reason, /smaller pageSize\/limit/);
  } finally {
    await small.close();
  }
});

test('toolsets limit what is registered', async () => {
  const only = await connect(fake, { env: { QUESTRADE_MCP_TOOLSETS: 'context,reports' } });
  try {
    const { tools } = await only.client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['qt_get_context', 'qt_list_accounts', 'qt_run_report']);
  } finally {
    await only.close();
  }
});

test('Questrade errors: rate limits are retried; account errors carry the message', async () => {
  fake.state.failNext.push({ status: 429, headers: { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000)) } });
  const r = await h.call('qt_list_markets', {});
  assert.equal(r.isError, false);
  const bad = await h.call('qt_get_balances', { accountId: '99999999' });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /Questrade rejected GET \/v1\/accounts\/99999999\/balances: Invalid account number \[1002\]/);
});
