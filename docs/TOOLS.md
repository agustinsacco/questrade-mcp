# Questrade: tools, resources and prompts

Generated from questrade-mcp 2.0.0 by `npm run docs`; do not edit by hand.

19 tools in 5 toolsets (19 read, 0 write), 2 resources and 3 prompts.
Limit the toolsets with `QUESTRADE_MCP_TOOLSETS` (comma-separated).

## Tools

### context

| Tool | Kind | What it does |
|---|---|---|
| [`qt_get_context`](#qt_get_context) | read | Start here. Returns how credentials are configured (and the exact sign-in command when they are missing), the accounts this login reaches, which one is the default, Questrade's server time and what the API cannot do. |
| [`qt_list_accounts`](#qt_list_accounts) | read | List the Questrade accounts this login reaches: number (the accountId other tools take), type (TFSA, RRSP, FHSA, Margin, Cash…), client type and status. |

### accounts

| Tool | Kind | What it does |
|---|---|---|
| [`qt_get_balances`](#qt_get_balances) | read | Cash, market value, total equity, buying power and maintenance excess for one account. perCurrency shows the CAD and USD sides separately; combined expresses the whole account in each currency. startOfDay adds the same figures as of the market open. |
| [`qt_list_positions`](#qt_list_positions) | read | Holdings in one account: quantity, average cost, price, market value, open and day P&L, and each position's weight within its currency. totals (per currency) always cover every position, not just this page. |
| [`qt_list_activities`](#qt_list_activities) | read | Account activity: trades, dividends, deposits, withdrawals, interest, fees, transfers and FX conversions, newest first. |
| [`qt_list_executions`](#qt_list_executions) | read | Trade executions (fills) with price, quantity, commission and fees, newest first. |
| [`qt_list_orders`](#qt_list_orders) | read | Orders (read-only history): open, filled, cancelled, rejected. |
| [`qt_get_order`](#qt_get_order) | read | Every field of one order (legs, routes, commissions, timestamps). |

### market

| Tool | Kind | What it does |
|---|---|---|
| [`qt_search_symbols`](#qt_search_symbols) | read | Find symbols by ticker prefix or a word in the company/fund name, e.g. "XEQT" or "shopify". |
| [`qt_get_symbols`](#qt_get_symbols) | read | Details for up to 50 symbols: description, exchange, currency, previous close, 52-week range, average volume, EPS, P/E, dividend, yield, ex-date, market cap, sector and whether it has options. |
| [`qt_get_quotes`](#qt_get_quotes) | read | Level 1 quotes for up to 100 symbols: last, bid/ask, size, day range, volume and change from the previous close. delay > 0 means the account's data subscription delays this market. |
| [`qt_list_markets`](#qt_list_markets) | read | Markets Questrade supports (TSX, TSXV, NYSE, NASDAQ, …) with today's regular and extended hours and currency. |
| [`qt_get_option_chain`](#qt_get_option_chain) | read | Option chain for an underlying. Without expiryDate: the expiry dates (with strike counts). |
| [`qt_get_option_quotes`](#qt_get_option_quotes) | read | Quotes for up to 100 option symbolIds (from qt_get_option_chain): bid/ask, last, volume, open interest, implied volatility and the Greeks (delta, gamma, theta, vega, rho). |
| [`qt_get_candles`](#qt_get_candles) | read | Price history for one symbol: summary stats (change, high, low, average volume), an ASCII chart of closes and OHLCV rows newest first (limit/offset). |

### analysis

| Tool | Kind | What it does |
|---|---|---|
| [`qt_compare_symbols`](#qt_compare_symbols) | read | Compare up to 10 symbols over the same range: % change, high, low, maximum drawdown and a normalized % change chart. |
| [`qt_analyze_technicals`](#qt_analyze_technicals) | read | Technical indicators for one symbol: RSI 14, SMA 50 and 200, VWAP, Bollinger Bands (20, 2) and signals (oversold, above SMA 200, …). |
| [`qt_screen_watchlist`](#qt_screen_watchlist) | read | Screen up to 50 symbols against technical criteria (RSI bounds, above SMA 50/200, piercing the lower Bollinger Band, below VWAP). |

### reports

| Tool | Kind | What it does |
|---|---|---|
| [`qt_run_report`](#qt_run_report) | read | Portfolio reports computed from live Questrade data, across all active accounts unless accountId is given. portfolio_summary: equity, cash and market value per account and in total. allocation: positions combined across accounts by symbol, with weights and a breakdown by security type. dividend_income: dividends by symbol and by month (startDate/endDate; default year to date). activity_summary: activity by type and currency, net deposits per account and commissions (default year to date). |

## Tool reference

### qt_get_context

**Get Questrade connection context** · toolset `context` · read

Start here. Returns how credentials are configured (and the exact sign-in command when they are missing), the accounts this login reaches, which one is the default, Questrade's server time and what the API cannot do. Works without credentials and then explains how to sign in.

No parameters.

### qt_list_accounts

**List accounts** · toolset `context` · read

List the Questrade accounts this login reaches: number (the accountId other tools take), type (TFSA, RRSP, FHSA, Margin, Cash…), client type and status.

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `status` | "Active" \| "all" |  | "all" | Active only, or every account |
| `page` | integer |  | 1 | 1-based; use nextPage. min 1 |
| `pageSize` | integer |  | 20 | Items per page (max 50). min 1, max 50 |

### qt_get_balances

**Get account balances** · toolset `accounts` · read

Cash, market value, total equity, buying power and maintenance excess for one account. perCurrency shows the CAD and USD sides separately; combined expresses the whole account in each currency. startOfDay adds the same figures as of the market open.

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `accountId` | string |  |  | Account number from qt_get_context or qt_list_accounts; defaults to QUESTRADE_ACCOUNT_ID or the only account |
| `includeStartOfDay` | boolean |  | false | Also return start-of-day balances |

### qt_list_positions

**List positions** · toolset `accounts` · read

Holdings in one account: quantity, average cost, price, market value, open and day P&L, and each position's weight within its currency. totals (per currency) always cover every position, not just this page. For all accounts at once use qt_run_report allocation.

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `accountId` | string |  |  | Account number from qt_get_context or qt_list_accounts; defaults to QUESTRADE_ACCOUNT_ID or the only account |
| `search` | string |  |  | Filter by symbol or description (contains, case-insensitive) |
| `sort` | "marketValue_desc" \| "symbol" \| "openPnl_desc" \| "openPnl_asc" \| "openPnlPct_desc" \| "openPnlPct_asc" |  | "marketValue_desc" |  |
| `page` | integer |  | 1 | 1-based; use nextPage. min 1 |
| `pageSize` | integer |  | 50 | Items per page (max 100). min 1, max 100 |

### qt_list_activities

**List account activities** · toolset `accounts` · read

Account activity: trades, dividends, deposits, withdrawals, interest, fees, transfers and FX conversions, newest first. Filter by type, action, symbol or text. totals (count and net amount by type and currency) cover every matching activity, not just this page. Default range: the last 30 days. Any range works (split into 30-day requests and cached briefly).

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `accountId` | string |  |  | Account number from qt_get_context or qt_list_accounts; defaults to QUESTRADE_ACCOUNT_ID or the only account |
| `startDate` | string |  |  | Start: YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `endDate` | string |  |  | End (inclusive): YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `type` | string |  |  | Activity type contains, e.g. Trades, Dividends, Deposits, Withdrawals, Interest, Fees |
| `action` | string |  |  | Exact action, e.g. Buy, Sell, DIV, CON (contribution) |
| `symbol` | string |  |  | Exact symbol, e.g. XEQT.TO |
| `search` | string |  |  | Text in the description (contains, case-insensitive) |
| `sort` | "date_desc" \| "date_asc" |  | "date_desc" |  |
| `detail` | "summary" \| "full" |  | "summary" | summary: key fields, long text clipped. full: every field Questrade returns |
| `page` | integer |  | 1 | 1-based; use nextPage. min 1 |
| `pageSize` | integer |  | 20 | Items per page (max 100). min 1, max 100 |

### qt_list_executions

**List executions (fills)** · toolset `accounts` · read

Trade executions (fills) with price, quantity, commission and fees, newest first. Filter by symbol, side or orderId. Default range: the last 30 days. Any range works (split into 30-day requests and cached briefly).

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `accountId` | string |  |  | Account number from qt_get_context or qt_list_accounts; defaults to QUESTRADE_ACCOUNT_ID or the only account |
| `startDate` | string |  |  | Start: YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `endDate` | string |  |  | End (inclusive): YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `symbol` | string |  |  | Exact symbol, e.g. AAPL |
| `side` | string |  |  | Buy, Sell, Short, Cov, … |
| `orderId` | integer |  |  | min -9007199254740991 |
| `page` | integer |  | 1 | 1-based; use nextPage. min 1 |
| `pageSize` | integer |  | 20 | Items per page (max 100). min 1, max 100 |

### qt_list_orders

**List orders** · toolset `accounts` · read

Orders (read-only history): open, filled, cancelled, rejected. Filter by state or symbol; newest first. Default range: the last 30 days. Any range works (split into 30-day requests and cached briefly).

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `accountId` | string |  |  | Account number from qt_get_context or qt_list_accounts; defaults to QUESTRADE_ACCOUNT_ID or the only account |
| `state` | "All" \| "Open" \| "Closed" |  | "All" |  |
| `startDate` | string |  |  | Start: YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `endDate` | string |  |  | End (inclusive): YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `symbol` | string |  |  | Exact symbol |
| `detail` | "summary" \| "full" |  | "summary" | summary: key fields, long text clipped. full: every field Questrade returns |
| `page` | integer |  | 1 | 1-based; use nextPage. min 1 |
| `pageSize` | integer |  | 20 | Items per page (max 100). min 1, max 100 |

### qt_get_order

**Get one order** · toolset `accounts` · read

Every field of one order (legs, routes, commissions, timestamps). Its fills: qt_list_executions with orderId.

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `accountId` | string |  |  | Account number from qt_get_context or qt_list_accounts; defaults to QUESTRADE_ACCOUNT_ID or the only account |
| `orderId` | integer | yes |  |  |

### qt_search_symbols

**Search symbols** · toolset `market` · read

Find symbols by ticker prefix or a word in the company/fund name, e.g. "XEQT" or "shopify". Returns symbolId (what quotes, candles and analysis take), exchange and currency. TSX listings end in .TO; filter by exchange or currency to pick the right listing.

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `query` | string | yes |  | Ticker prefix or a word in the description |
| `exchange` | string |  |  | Only this listing exchange, e.g. TSX, NASDAQ, NYSE, TSXV, NEO |
| `currency` | "CAD" \| "USD" |  |  |  |
| `securityType` | string |  |  | e.g. Stock, Option, Bond, MutualFund, Index |
| `offset` | integer |  | 0 | Skip this many of Questrade's results; use nextOffset. min 0 |

### qt_get_symbols

**Get symbol details** · toolset `market` · read

Details for up to 50 symbols: description, exchange, currency, previous close, 52-week range, average volume, EPS, P/E, dividend, yield, ex-date, market cap, sector and whether it has options.

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `symbols` | integer or string[] | yes |  | symbolIds or exact tickers (1–50). 1+ items, up to 50 items |
| `detail` | "summary" \| "full" |  | "summary" | summary: key fields, long text clipped. full: every field Questrade returns |

### qt_get_quotes

**Get quotes** · toolset `market` · read

Level 1 quotes for up to 100 symbols: last, bid/ask, size, day range, volume and change from the previous close. delay > 0 means the account's data subscription delays this market.

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `symbols` | integer or string[] | yes |  | symbolIds or exact tickers (1–100). 1+ items, up to 100 items |
| `detail` | "summary" \| "full" |  | "summary" | summary: key fields, long text clipped. full: every field Questrade returns |

### qt_list_markets

**List markets and trading hours** · toolset `market` · read

Markets Questrade supports (TSX, TSXV, NYSE, NASDAQ, …) with today's regular and extended hours and currency.

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `detail` | "summary" \| "full" |  | "summary" | summary: key fields, long text clipped. full: every field Questrade returns |

### qt_get_option_chain

**Get option chain** · toolset `market` · read

Option chain for an underlying. Without expiryDate: the expiry dates (with strike counts). With expiryDate: strikes with call and put symbolIds, by default the ones nearest the last price; pass minStrike/maxStrike for others. Quotes and Greeks: qt_get_option_quotes with those IDs.

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `symbol` | integer or string | yes |  | symbolId (number) or exact ticker, e.g. "XEQT.TO" (TSX) or "AAPL" (US) |
| `expiryDate` | string |  |  | Expiry date, YYYY-MM-DD (from the list this tool returns without it) |
| `minStrike` | number |  |  |  |
| `maxStrike` | number |  |  |  |
| `page` | integer |  | 1 | 1-based; use nextPage. min 1 |
| `pageSize` | integer |  | 20 | Items per page (max 100). min 1, max 100 |

### qt_get_option_quotes

**Get option quotes and Greeks** · toolset `market` · read

Quotes for up to 100 option symbolIds (from qt_get_option_chain): bid/ask, last, volume, open interest, implied volatility and the Greeks (delta, gamma, theta, vega, rho).

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `optionIds` | integer[] | yes |  | 1+ items, up to 100 items |
| `detail` | "summary" \| "full" |  | "summary" | summary: key fields, long text clipped. full: every field Questrade returns |

### qt_get_candles

**Get price history (candles)** · toolset `market` · read

Price history for one symbol: summary stats (change, high, low, average volume), an ASCII chart of closes and OHLCV rows newest first (limit/offset). Questrade returns at most 2000 candles per request, so match interval to the range. Default range by interval: 1 year of daily, 5 years of weekly, 5 days of intraday.

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `symbol` | integer or string | yes |  | symbolId (number) or exact ticker, e.g. "XEQT.TO" (TSX) or "AAPL" (US) |
| `startDate` | string |  |  | Start: YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `endDate` | string |  |  | End (inclusive): YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `interval` | "OneMinute" \| "TwoMinutes" \| "ThreeMinutes" \| "FourMinutes" \| "FiveMinutes" \| "TenMinutes" \| "FifteenMinutes" \| "TwentyMinutes" \| … |  | "OneDay" | Candle size; Questrade returns at most 2000 candles per request |
| `chart` | boolean |  | true | Include an ASCII chart of closes |
| `limit` | integer |  | 30 | OHLCV rows to return, newest first (0 = stats and chart only). min 0, max 500 |
| `offset` | integer |  | 0 | Rows to skip; use nextOffset. min 0 |

### qt_compare_symbols

**Compare symbols** · toolset `analysis` · read

Compare up to 10 symbols over the same range: % change, high, low, maximum drawdown and a normalized % change chart. Default range: 1 year of daily candles.

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `symbols` | integer or string[] | yes |  | symbolIds or exact tickers (1–10). 1+ items, up to 10 items |
| `startDate` | string |  |  | Start: YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `endDate` | string |  |  | End (inclusive): YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `interval` | "OneMinute" \| "TwoMinutes" \| "ThreeMinutes" \| "FourMinutes" \| "FiveMinutes" \| "TenMinutes" \| "FifteenMinutes" \| "TwentyMinutes" \| … |  | "OneDay" | Candle size; Questrade returns at most 2000 candles per request |
| `chart` | boolean |  | true |  |

### qt_analyze_technicals

**Analyze technicals** · toolset `analysis` · read

Technical indicators for one symbol: RSI 14, SMA 50 and 200, VWAP, Bollinger Bands (20, 2) and signals (oversold, above SMA 200, …). Default range: 1 year of daily candles (about 250, enough for SMA 200).

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `symbol` | integer or string | yes |  | symbolId (number) or exact ticker, e.g. "XEQT.TO" (TSX) or "AAPL" (US) |
| `startDate` | string |  |  | Start: YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `endDate` | string |  |  | End (inclusive): YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `interval` | "OneMinute" \| "TwoMinutes" \| "ThreeMinutes" \| "FourMinutes" \| "FiveMinutes" \| "TenMinutes" \| "FifteenMinutes" \| "TwentyMinutes" \| … |  | "OneDay" | Candle size; Questrade returns at most 2000 candles per request |

### qt_screen_watchlist

**Screen symbols by technicals** · toolset `analysis` · read

Screen up to 50 symbols against technical criteria (RSI bounds, above SMA 50/200, piercing the lower Bollinger Band, below VWAP). Returns the matches with their indicators, and why the others failed.

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `symbols` | integer or string[] | yes |  | symbolIds or exact tickers (1–50). 1+ items, up to 50 items |
| `startDate` | string |  |  | Start: YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `endDate` | string |  |  | End (inclusive): YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `interval` | "OneMinute" \| "TwoMinutes" \| "ThreeMinutes" \| "FourMinutes" \| "FiveMinutes" \| "TenMinutes" \| "FifteenMinutes" \| "TwentyMinutes" \| … |  | "OneDay" | Candle size; Questrade returns at most 2000 candles per request |
| `criteria` | object {maxRsi, minRsi, mustBeAbove50Sma, mustBeAbove200Sma, mustBePiercingLowerBB, mustBeBelowVwap} |  | {} |  |

### qt_run_report

**Run a portfolio report** · toolset `reports` · read

Portfolio reports computed from live Questrade data, across all active accounts unless accountId is given. portfolio_summary: equity, cash and market value per account and in total. allocation: positions combined across accounts by symbol, with weights and a breakdown by security type. dividend_income: dividends by symbol and by month (startDate/endDate; default year to date). activity_summary: activity by type and currency, net deposits per account and commissions (default year to date). Rows are paginated with limit/offset; totals always cover every row; each report states its basis.

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `report` | "portfolio_summary" \| "allocation" \| "dividend_income" \| "activity_summary" | yes |  |  |
| `accountId` | string |  |  | Account number from qt_get_context or qt_list_accounts; defaults to QUESTRADE_ACCOUNT_ID or the only account |
| `startDate` | string |  |  | Start: YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `endDate` | string |  |  | End (inclusive): YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00 |
| `limit` | integer |  | 25 | Rows to return. min 1, max 200 |
| `offset` | integer |  | 0 | Rows to skip; use nextOffset. min 0 |

## Resources

| URI | What it is |
|---|---|
| `questrade://limitations` | Gaps in Questrade's API and how this server handles them |
| `questrade://guide` | Usage guide for agents: first steps, the sign-in command the user runs, tool map and rules (the questrade-portfolio skill) |

## Prompts

| Prompt | Arguments | What it does |
|---|---|---|
| `portfolio_review` |  | Review all accounts: equity, allocation, concentration and recent activity |
| `dividend_report` | year | Dividends received in a year, by symbol and month |
| `research_symbol` | symbol | Fundamentals, price history and technicals for one symbol, and whether I hold it |
