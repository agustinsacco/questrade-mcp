import http from 'node:http';

/**
 * A stand-in for Questrade's login server and REST API, on a real loopback
 * port (so child processes can use it too). Like the real one:
 *  - each refresh token can be exchanged once; only the latest access token works;
 *  - activities refuse ranges over 31 days (code 1003);
 *  - errors are { code, message }.
 * `state.requests` logs every API call for assertions.
 */
export const ACCOUNTS = [
  { type: 'TFSA', number: '11111111', status: 'Active', isPrimary: true, isBilling: true, clientAccountType: 'Individual' },
  { type: 'Margin', number: '22222222', status: 'Active', isPrimary: false, isBilling: false, clientAccountType: 'Individual' },
];

export const SYMBOLS = [
  { symbol: 'XEQT.TO', symbolId: 101, description: 'ISHARES CORE EQUITY ETF PORTFOLIO', securityType: 'Stock', listingExchange: 'TSX', currency: 'CAD', prevDayClosePrice: 30, highPrice52: 32, lowPrice52: 25, dividend: 0.5, yield: 1.7, pe: null, hasOptions: false, isTradable: true, isQuotable: true },
  { symbol: 'AAPL', symbolId: 8049, description: 'APPLE INC', securityType: 'Stock', listingExchange: 'NASDAQ', currency: 'USD', prevDayClosePrice: 200, highPrice52: 240, lowPrice52: 160, eps: 6.2, pe: 31, dividend: 1, yield: 0.5, hasOptions: true, isTradable: true, isQuotable: true },
  { symbol: 'AAPL.TO', symbolId: 9001, description: 'APPLE INC CDR', securityType: 'Stock', listingExchange: 'NEO', currency: 'CAD', prevDayClosePrice: 25, hasOptions: false, isTradable: true, isQuotable: true },
  { symbol: 'BNS.TO', symbolId: 202, description: 'BANK OF NOVA SCOTIA', securityType: 'Stock', listingExchange: 'TSX', currency: 'CAD', prevDayClosePrice: 70, dividend: 1.1, yield: 6, hasOptions: true, isTradable: true, isQuotable: true },
];

const POSITIONS = {
  11111111: [
    { symbol: 'XEQT.TO', symbolId: 101, openQuantity: 100, currentMarketValue: 3100, currentPrice: 31, averageEntryPrice: 28, totalCost: 2800, openPnl: 300, dayPnl: 100, closedPnl: 0, isRealTime: false },
    { symbol: 'BNS.TO', symbolId: 202, openQuantity: 10, currentMarketValue: 700, currentPrice: 70, averageEntryPrice: 75, totalCost: 750, openPnl: -50, dayPnl: 0, closedPnl: 0, isRealTime: false },
  ],
  22222222: [
    { symbol: 'AAPL', symbolId: 8049, openQuantity: 5, currentMarketValue: 1000, currentPrice: 200, averageEntryPrice: 150, totalCost: 750, openPnl: 250, dayPnl: -5, closedPnl: 0, isRealTime: false },
    { symbol: 'XEQT.TO', symbolId: 101, openQuantity: 50, currentMarketValue: 1550, currentPrice: 31, averageEntryPrice: 30, totalCost: 1500, openPnl: 50, dayPnl: 50, closedPnl: 0, isRealTime: false },
  ],
};

const t = (date) => `${date}T00:00:00.000000-05:00`;
const activity = (date, type, action, symbol, netAmount, extra = {}) => ({
  tradeDate: t(date), transactionDate: t(date), settlementDate: t(date), action, symbol, symbolId: SYMBOLS.find((s) => s.symbol === symbol)?.symbolId ?? 0,
  description: `${type} ${symbol || ''}`.trim(), currency: extra.currency || 'CAD', quantity: extra.quantity || 0, price: extra.price || 0,
  grossAmount: extra.grossAmount ?? netAmount, commission: extra.commission || 0, netAmount, type,
});
export const ACTIVITIES = {
  11111111: [
    activity('2026-01-05', 'Deposits', 'CON', '', 7000),
    activity('2026-01-06', 'Trades', 'Buy', 'XEQT.TO', -2800, { quantity: 100, price: 28, commission: -4.95 }),
    activity('2026-02-20', 'Dividends', 'DIV', 'BNS.TO', 11),
    activity('2026-03-30', 'Dividends', 'DIV', 'XEQT.TO', 12.5),
    activity('2026-04-15', 'Fees and rebates', 'FCH', '', -2),
  ],
  22222222: [
    activity('2026-02-02', 'Deposits', 'DEP', '', 1000, { currency: 'USD' }),
    activity('2026-02-15', 'Dividends', 'DIV', 'AAPL', 1.25, { currency: 'USD' }),
  ],
};

const EXECUTIONS = {
  11111111: [{ symbol: 'XEQT.TO', symbolId: 101, quantity: 100, side: 'Buy', price: 28, id: 501, orderId: 900, timestamp: '2026-01-06T10:00:00.000000-05:00', venue: 'TSX', totalCost: 2800, commission: 4.95, executionFee: 0.1, secFee: 0, canadianExecutionFee: 0 }],
  22222222: [],
};
const ORDERS = {
  11111111: [{ id: 900, symbol: 'XEQT.TO', symbolId: 101, totalQuantity: 100, openQuantity: 0, filledQuantity: 100, side: 'Buy', type: 'Limit', limitPrice: 28, state: 'Executed', timeInForce: 'Day', creationTime: '2026-01-06T09:59:00.000000-05:00', updateTime: '2026-01-06T10:00:00.000000-05:00', comissionCharged: 4.95, legs: [] }],
  22222222: [],
};

const BALANCES = {
  11111111: { perCurrencyBalances: [{ currency: 'CAD', cash: 1000, marketValue: 3800, totalEquity: 4800, buyingPower: 1000, maintenanceExcess: 1000, isRealTime: false }], combinedBalances: [{ currency: 'CAD', cash: 1000, marketValue: 3800, totalEquity: 4800 }, { currency: 'USD', cash: 730, marketValue: 2774, totalEquity: 3504 }], sodPerCurrencyBalances: [], sodCombinedBalances: [] },
  22222222: { perCurrencyBalances: [], combinedBalances: [{ currency: 'CAD', cash: 100, marketValue: 2920, totalEquity: 3020 }, { currency: 'USD', cash: 73, marketValue: 2131, totalEquity: 2204 }], sodPerCurrencyBalances: [], sodCombinedBalances: [] },
};

const CHAIN = {
  options: [
    { expiryDate: '2026-12-18T00:00:00.000000-05:00', optionExerciseType: 'American', chainPerRoot: [{ root: 'AAPL', multiplier: 100, chainPerStrikePrice: [150, 180, 190, 200, 210, 220, 250].map((k, i) => ({ strikePrice: k, callSymbolId: 70000 + i, putSymbolId: 71000 + i })) }] },
    { expiryDate: '2027-01-15T00:00:00.000000-05:00', optionExerciseType: 'American', chainPerRoot: [{ root: 'AAPL', multiplier: 100, chainPerStrikePrice: [{ strikePrice: 200, callSymbolId: 72000, putSymbolId: 72001 }] }] },
  ],
};

/** Daily candles: close rises 1 per day from 100, so stats are easy to check. */
function candles(start, end) {
  const out = [];
  let price = 100;
  for (let d = Date.parse(start); d <= Date.parse(end); d += 86_400_000) {
    const day = new Date(d).toISOString().slice(0, 10);
    out.push({ start: t(day), end: t(day), open: price, high: price + 2, low: price - 1, close: price + 1, volume: 1000 });
    price += 1;
  }
  return out.slice(0, 2000);
}

export async function startFakeQuestrade({ initialRefreshToken = 'seed-refresh-token-0001' } = {}) {
  const state = { exchanges: 0, validRefresh: new Set([initialRefreshToken]), accessToken: null, n: 0, requests: [], failNext: [] };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = '';
    for await (const chunk of req) body += chunk;
    const send = (status, payload, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(payload));
    };
    if (req.method === 'POST' && url.pathname === '/oauth2/token') {
      const token = url.searchParams.get('refresh_token');
      if (url.searchParams.get('grant_type') !== 'refresh_token' || !state.validRefresh.delete(token)) return send(400, { error: 'invalid_grant' });
      state.exchanges += 1;
      state.n += 1;
      const refresh = `refresh-token-${String(state.n).padStart(4, '0')}`;
      state.validRefresh.add(refresh);
      state.accessToken = `access-token-${String(state.n).padStart(4, '0')}`;
      return send(200, { access_token: state.accessToken, refresh_token: refresh, api_server: `${state.base}/`, expires_in: 1800, token_type: 'Bearer' });
    }
    state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: body ? JSON.parse(body) : undefined });
    if (!state.accessToken || req.headers.authorization !== `Bearer ${state.accessToken}`) return send(401, { code: 1017, message: 'Access token is invalid' });
    const fail = state.failNext.shift();
    if (fail) return send(fail.status, fail.body || { code: 1006, message: 'Rate limit exceeded' }, fail.headers);

    const p = url.pathname;
    const q = url.searchParams;
    const acct = p.match(/^\/v1\/accounts\/(\d+)\/(\w+)(?:\/(\d+))?$/);
    const inRange = (time) => {
      const x = Date.parse(time);
      return x >= Date.parse(q.get('startTime')) && x <= Date.parse(q.get('endTime'));
    };
    if (p === '/v1/time') return send(200, { time: '2026-11-08T12:00:00.000000-05:00' });
    if (p === '/v1/accounts') return send(200, { accounts: ACCOUNTS, userId: 3000124 });
    if (acct) {
      const [, id, kind, sub] = acct;
      if (!ACCOUNTS.some((a) => a.number === id)) return send(400, { code: 1002, message: 'Invalid account number' });
      if (kind === 'positions') return send(200, { positions: POSITIONS[id] });
      if (kind === 'balances') return send(200, BALANCES[id]);
      if (['activities', 'executions', 'orders'].includes(kind) && !sub) {
        if (Date.parse(q.get('endTime')) - Date.parse(q.get('startTime')) > 31 * 86_400_000) return send(400, { code: 1003, message: 'Argument length exceeds imposed limit' });
      }
      if (kind === 'activities') return send(200, { activities: ACTIVITIES[id].filter((a) => inRange(a.tradeDate)) });
      if (kind === 'executions') return send(200, { executions: EXECUTIONS[id].filter((x) => inRange(x.timestamp)) });
      if (kind === 'orders' && sub) return send(200, { orders: ORDERS[id].filter((o) => String(o.id) === sub) });
      if (kind === 'orders') return send(200, { orders: ORDERS[id].filter((o) => inRange(o.creationTime)) });
    }
    if (p === '/v1/symbols') {
      const ids = q.get('ids')?.split(',').map(Number);
      const names = q.get('names')?.split(',');
      return send(200, { symbols: SYMBOLS.filter((s) => ids?.includes(s.symbolId) || names?.includes(s.symbol)) });
    }
    if (p === '/v1/symbols/search') {
      const prefix = (q.get('prefix') || '').toUpperCase();
      return send(200, { symbols: SYMBOLS.filter((s) => s.symbol.startsWith(prefix) || s.description.includes(prefix)).slice(Number(q.get('offset') || 0)) });
    }
    if (p === '/v1/symbols/8049/options') return send(200, CHAIN);
    if (p === '/v1/markets') return send(200, { markets: [{ name: 'TSX', currency: 'CAD', startTime: '2026-11-09T09:30:00.000000-05:00', endTime: '2026-11-09T16:00:00.000000-05:00', tradingVenues: ['TSX'] }] });
    if (p === '/v1/markets/quotes') {
      const ids = (q.get('ids') || '').split(',').map(Number);
      return send(200, { quotes: SYMBOLS.filter((s) => ids.includes(s.symbolId)).map((s) => ({ symbol: s.symbol, symbolId: s.symbolId, lastTradePrice: s.prevDayClosePrice * 1.1, bidPrice: s.prevDayClosePrice, askPrice: s.prevDayClosePrice * 1.2, volume: 5000, delay: 0, isHalted: false, tier: ' ' })) });
    }
    if (p === '/v1/markets/quotes/options' && req.method === 'POST') {
      const ids = JSON.parse(body).optionIds;
      return send(200, { optionQuotes: ids.map((id) => ({ symbol: `OPT${id}`, symbolId: id, underlying: 'AAPL', bidPrice: 4.9, askPrice: 5, volatility: 30, delta: 0.5, gamma: 0.01, theta: -0.02, vega: 0.1, rho: 0.04, openInterest: 100, delay: 0 })) });
    }
    const candle = p.match(/^\/v1\/markets\/candles\/(\d+)$/);
    if (candle) return send(200, { candles: candles(q.get('startTime'), q.get('endTime')) });
    return send(404, { code: 1001, message: `No route ${p}` });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.base = `http://127.0.0.1:${server.address().port}`;
  let issued = 0;
  return {
    state,
    loginUrl: `${state.base}/oauth2/token`,
    /** A new valid refresh token, as if the user generated one in the API Centre. */
    issueRefreshToken: () => {
      const token = `issued-refresh-token-${String(++issued).padStart(4, '0')}`;
      state.validRefresh.add(token);
      return token;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
