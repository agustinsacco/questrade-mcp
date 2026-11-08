/**
 * What Questrade's public API cannot do, and how this server handles it.
 * Surfaced in qt_get_context, the questrade://limitations resource and tool
 * descriptions, so the model does not promise data it cannot get.
 */
export const LIMITATIONS = {
  summary: [
    'Read-only by design: no tool places, changes or cancels orders. Questrade only grants trading to partner apps.',
    'Activities, executions and orders are fetched in 30-day windows (Questrade allows about a month per request); long ranges cost one request per window and are cached briefly.',
    'Positions carry no currency of their own; this server adds it from symbol details.',
    'No cost basis per tax lot, no realized gains report and no tax slips (T5, T3, T5008): use Questrade\'s statements for tax filing. qt_run_report works from activities, positions and balances.',
    'Quotes follow the account\'s market-data subscription: without real-time data they can be delayed (the quote\'s delay field says by how much).',
    'Candles: at most 2000 per request, so the interval must suit the range (one minute candles cover about 5 trading days).',
    'No streaming (quotes or order notifications) and no watchlists: the API does not expose watchlists.',
    'A manually generated refresh token expires after 7 days if unused, and each refresh token works once; the server rotates and stores it, and keeps it alive while it runs.',
  ],
};

export const LIMITATIONS_MARKDOWN = `# Questrade API: what is and is not possible

${LIMITATIONS.summary.map((s) => `- ${s}`).join('\n')}
`;
