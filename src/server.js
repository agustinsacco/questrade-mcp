import fs from 'node:fs';
import * as z from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { registerContextTools } from './tools/context.js';
import { registerAccountTools } from './tools/accounts.js';
import { registerMarketTools } from './tools/market.js';
import { registerAnalysisTools } from './tools/analysis.js';
import { registerReportTools } from './tools/reports.js';
import { HOST, PACKAGE_DIR, cli } from './cli.js';
import { LIMITATIONS_MARKDOWN } from './limitations.js';

export const SERVER_NAME = 'questrade-mcp';
export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** The questrade-portfolio skill without its frontmatter, with this machine's CLI path filled in. */
export function guideMarkdown() {
  const text = fs.readFileSync(new URL('../skills/questrade-portfolio/SKILL.md', import.meta.url), 'utf8').replace(/^---\n[\s\S]*?\n---\n+/, '');
  return text
    .replaceAll('node <package>/bin/questrade-mcp.js', cli())
    .replaceAll('<package>', PACKAGE_DIR);
}

export const INSTRUCTIONS = `Questrade brokerage, read-only. Call qt_get_context first; if credentials are missing or rejected the user signs in with ${cli('login')} in a terminal on ${HOST}. Full guide: the questrade://guide resource.
- Read-only: no tool places, changes or cancels orders.
- Call qt_get_context first: it shows the accounts and the default one. Account tools take an optional accountId; with several accounts and no default they ask for one.
- Lists are paginated (page/pageSize, or offset/limit for reports and candles). Ask for small pages, follow nextPage/nextOffset only when needed, and prefer detail="summary".
- Symbols: pass a symbolId or the exact ticker ("XEQT.TO" for the TSX, "AAPL" for the US). qt_search_symbols finds them.
- Dates: YYYY-MM-DD (Toronto days) or ISO date-times with an offset. Activity, execution and order lists default to the last 30 days and accept any range.
- qt_run_report computes portfolio_summary, allocation, dividend_income and activity_summary across accounts; every report states its basis.
- Never ask the user to paste a token into the chat. The user signs in in a terminal on ${HOST}: ${cli('login')}. You may run ${cli('check')} yourself to verify; it prints no secrets.`;

/**
 * Build one MCP server instance over the shared QuestradeContext. Cheap:
 * under HTTP this runs per request, under stdio once per connection.
 */
export function createServer(ctx) {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION, title: 'Questrade' }, { instructions: INSTRUCTIONS });

  registerContextTools(server, ctx);
  registerAccountTools(server, ctx);
  registerMarketTools(server, ctx);
  registerAnalysisTools(server, ctx);
  registerReportTools(server, ctx);

  server.registerResource(
    'limitations',
    'questrade://limitations',
    { title: "What Questrade's API cannot do", description: "Gaps in Questrade's API and how this server handles them", mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: LIMITATIONS_MARKDOWN }] }),
  );
  server.registerResource(
    'guide',
    'questrade://guide',
    {
      title: 'How to use this server and sign in',
      description: 'Usage guide for agents: first steps, the sign-in command the user runs, tool map and rules (the questrade-portfolio skill)',
      mimeType: 'text/markdown',
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: guideMarkdown() }] }),
  );

  registerPrompts(server);
  return server;
}

function registerPrompts(server) {
  const user = (text) => ({ messages: [{ role: 'user', content: { type: 'text', text } }] });

  server.registerPrompt(
    'portfolio_review',
    { title: 'Portfolio review', description: 'Review all accounts: equity, allocation, concentration and recent activity' },
    () =>
      user(
        'Review my Questrade portfolio. Use qt_run_report portfolio_summary for equity by account, allocation for what I hold across accounts (top 15 by value), and activity_summary for this year. Point out concentration (any position over 10% of its currency), cash drag, large unrealized losses and anything unusual. Keep each report call to limit 15 unless I ask for more.',
      ),
  );

  server.registerPrompt(
    'dividend_report',
    {
      title: 'Dividend report',
      description: 'Dividends received in a year, by symbol and month',
      argsSchema: z.object({ year: z.string().regex(/^\d{4}$/).describe('Year, YYYY') }),
    },
    ({ year }) =>
      user(
        `Summarize the dividends I received in ${year}: run qt_run_report dividend_income with startDate ${year}-01-01 and endDate ${year}-12-31. Show totals per currency, the top payers and the monthly pattern, and compare with current positions (qt_run_report allocation) to spot holdings that stopped paying.`,
      ),
  );

  server.registerPrompt(
    'research_symbol',
    {
      title: 'Research a symbol',
      description: 'Fundamentals, price history and technicals for one symbol, and whether I hold it',
      argsSchema: z.object({ symbol: z.string().describe('Ticker, e.g. XEQT.TO or AAPL') }),
    },
    ({ symbol }) =>
      user(
        `Research ${symbol}: find it with qt_search_symbols if the ticker is ambiguous, then use qt_get_symbols (fundamentals), qt_get_quotes, qt_get_candles (1 year daily, limit 0) and qt_analyze_technicals. Tell me whether I hold it (qt_run_report allocation) and summarize. This is information, not advice; no orders can be placed.`,
      ),
  );
}
