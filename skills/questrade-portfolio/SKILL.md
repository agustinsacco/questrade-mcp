---
name: questrade-portfolio
description: Questrade brokerage data through the `questrade` MCP server, read-only. Covers accounts, balances, positions, activities (trades, dividends, deposits, fees), executions, orders, quotes, option chains and Greeks, candles, technicals and portfolio reports (allocation, dividend income). Use when the user asks about their Questrade accounts, holdings, cash, trades or dividends, or wants market data for a symbol, or when a questrade tool says no token is configured or the token was rejected. It explains the sign-in command the user runs in a terminal.
---

# Questrade portfolio

The `questrade` MCP server comes from the questrade-mcp package. In pi it is
the codemode namespace `mcp__questrade`. Its CLI is `bin/questrade-mcp.js` in
the package root, two directories above this skill's folder. For example, if
this file is `/opt/questrade-mcp/skills/questrade-portfolio/SKILL.md`, the CLI
is `node /opt/questrade-mcp/bin/questrade-mcp.js`.

**Read-only.** No tool places, changes or cancels orders, and Questrade grants
trading only to partner apps. Never suggest that a trade was made.

## Start here

1. Call `qt_get_context`. It works even before sign-in, and shows:
   - `auth.mode` (`none` means nobody has signed in yet);
   - `auth.signIn`, the exact sign-in command for this machine, with its host;
   - the accounts (`number`, `type` such as TFSA, RRSP, FHSA or Margin), and
     which one is the default.
2. If there are several accounts and no default, pass `accountId` (the account
   `number`) to every account tool. Tools refuse to guess.
3. Symbols: pass a `symbolId` or the exact ticker. TSX listings end in `.TO`
   (`XEQT.TO`), US listings have no suffix (`AAPL`). `qt_search_symbols` finds
   them; filter by `exchange` or `currency` to pick the right listing.

## Tools

| Need | Tool | Notes |
|---|---|---|
| Accounts, default account, sign-in state | `qt_get_context`, `qt_list_accounts` | |
| Cash, equity, buying power | `qt_get_balances` | `perCurrency` = CAD and USD sides; `combined` = whole account in each currency |
| Holdings | `qt_list_positions` | weights and totals per currency; sort by value or P&L |
| Trades, dividends, deposits, fees | `qt_list_activities` | filter by `type`, `action`, `symbol`, `search`; `totals` cover all matches |
| Fills | `qt_list_executions` | commission and fees per fill; filter by `orderId` |
| Orders | `qt_list_orders`, `qt_get_order` | history only |
| Find a symbol | `qt_search_symbols` | |
| Fundamentals | `qt_get_symbols` | P/E, EPS, dividend, yield, 52-week range, sector |
| Quotes | `qt_get_quotes` | up to 100; includes change from the previous close; `delay` > 0 means delayed data |
| Options | `qt_get_option_chain`, then `qt_get_option_quotes` | chain without `expiryDate` lists expiries; quotes include IV and Greeks |
| Price history | `qt_get_candles` | stats, chart and OHLCV rows; `limit: 0` for stats and chart only |
| Compare or screen | `qt_compare_symbols`, `qt_analyze_technicals`, `qt_screen_watchlist` | RSI 14, SMA 50/200, VWAP, Bollinger Bands |
| Across accounts | `qt_run_report` | `portfolio_summary`, `allocation`, `dividend_income`, `activity_summary` |
| Market hours | `qt_list_markets` | |

Conventions:
- **Dates:** `YYYY-MM-DD` (a Toronto day) or an ISO date-time with an offset.
  Activity, execution and order lists default to the **last 30 days**. Any
  range works; the server splits it into the 30-day requests Questrade needs.
- **Paging:** lists take `page`/`pageSize`; reports and candles take
  `offset`/`limit`. Follow `nextPage`/`nextOffset` only when needed.
  `totals` always cover every matching row.
- **Candles:** Questrade returns at most 2000 per request. Defaults: 1 year
  of daily, 5 years of weekly, 5 days of intraday.
- **Money:** amounts are in the row's `currency`. Weights and totals stay
  per currency; nothing is converted.

## Signing in (the user does this, never the chat)

Tokens are stored in `~/.config/questrade-mcp/credentials.env`, mode 600, on
the machine that runs the server.

When `auth.mode` is `none`, or a tool says **no Questrade refresh token is
configured** or Questrade **rejected the stored refresh token**, pass on the
`auth.signIn` command:

1. The user logs in at my.questrade.com, opens App Hub → API Centre, then the
   personal app → "New manual authorization" → "Generate new token".
2. In a terminal **on that host**, they run the following and paste the token
   there. The input is hidden and never shown.

   ```bash
   node <package>/bin/questrade-mcp.js login
   ```

3. Running servers pick up the new token on their next call. No restart is
   needed.

Rules:
- Never ask for a token in the chat, and never accept one pasted there. If the
  user pastes one anyway, tell them it may be spent or exposed: generate a new
  one and use `login`.
- Never run `login`, `logout` or `secrets set` yourself.
- You may run `node <package>/bin/questrade-mcp.js check` and `secrets list`.
  They never print token values.

How tokens work: each refresh token works **once**, and each refresh returns
the next one. The server stores it straight away, shares it safely between
several server processes, and keeps it fresh every 25 minutes while it runs.
A manually generated token expires after 7 days if unused, so after a long
stretch with no server running the user signs in again.

## Answering well

- Say which account(s) and date range an answer covers, and the currency of
  every amount.
- For "how much did I make", separate dividends (`qt_run_report
  dividend_income`), open P&L (`qt_list_positions`) and deposits
  (`activity_summary` → `netDeposits`). Realized gains per tax lot are not
  available (see `questrade://limitations`).
- Market data and technicals are information, not advice.
