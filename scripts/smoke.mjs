#!/usr/bin/env node
/**
 * Live smoke test with real credentials, through the real stdio binary.
 * Read-only (as is every tool): calls each tool once against the default
 * account (QUESTRADE_ACCOUNT_ID, or the first account) and prints timings and
 * response sizes, never the data.
 *
 *   npm run smoke
 */
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const client = new Client({ name: 'questrade-mcp-smoke', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('../bin/questrade-mcp.js', import.meta.url).pathname], env: { ...process.env }, stderr: 'inherit' }));

let failures = 0;
async function call(name, args = {}) {
  const started = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text || '';
  if (r.isError) failures++;
  console.log(`${r.isError ? 'FAIL' : 'ok  '} ${name.padEnd(24)} ${String(Date.now() - started).padStart(5)} ms ${String(text.length).padStart(6)} chars${r.isError ? `  ${text.slice(0, 200)}` : ''}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const context = await call('qt_get_context');
if (context?.auth?.mode !== 'oauth') {
  console.log('\nNot signed in:', context?.setup);
  process.exit(1);
}
const accountId = context.defaultAccountId || context.accounts?.[0]?.number;
await call('qt_list_accounts');
await call('qt_get_balances', { accountId, includeStartOfDay: true });
const positions = await call('qt_list_positions', { accountId, pageSize: 5 });
await call('qt_list_activities', { accountId, pageSize: 5 });
await call('qt_list_activities', { accountId, startDate: `${new Date().getFullYear() - 1}-01-01`, type: 'Dividend', pageSize: 5 });
await call('qt_list_executions', { accountId, pageSize: 5 });
const orders = await call('qt_list_orders', { accountId, pageSize: 5, startDate: `${new Date().getFullYear() - 1}-01-01` });
if (orders?.items?.[0]?.id) await call('qt_get_order', { accountId, orderId: orders.items[0].id });

const symbol = positions?.items?.[0]?.symbol || 'AAPL';
await call('qt_search_symbols', { query: symbol.replace(/\..*$/, '') });
await call('qt_get_symbols', { symbols: [symbol] });
await call('qt_get_quotes', { symbols: [symbol] });
await call('qt_list_markets');
const chain = await call('qt_get_option_chain', { symbol: 'AAPL' });
if (chain?.items?.[0]?.expiryDate) {
  const strikes = await call('qt_get_option_chain', { symbol: 'AAPL', expiryDate: chain.items[0].expiryDate, pageSize: 4 });
  const ids = (strikes?.items || []).flatMap((s) => [s.callSymbolId, s.putSymbolId]).filter(Boolean).slice(0, 4);
  if (ids.length) await call('qt_get_option_quotes', { optionIds: ids });
}
await call('qt_get_candles', { symbol, limit: 5 });
await call('qt_get_candles', { symbol, interval: 'FiveMinutes', limit: 0 });
await call('qt_compare_symbols', { symbols: [symbol, 'AAPL'], chart: false });
await call('qt_analyze_technicals', { symbol });
await call('qt_screen_watchlist', { symbols: [symbol, 'AAPL'], criteria: { maxRsi: 70 } });
for (const report of ['portfolio_summary', 'allocation', 'dividend_income', 'activity_summary']) await call('qt_run_report', { report, limit: 5 });

await client.close();
console.log(failures ? `\n${failures} failure(s)` : '\nAll calls succeeded.');
process.exit(failures ? 1 : 0);
