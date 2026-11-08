---
name: questrade-portfolio
description: Read a Questrade brokerage portfolio through the `questrade` MCP server. Covers accounts, positions, balances, activity (trades, dividends, deposits, fees), order history, quotes, candles, symbol comparison and technical screens. Use when the user asks about their Questrade accounts, holdings, cash or trades, or wants market data or technicals for a symbol. Also use when a questrade tool says no token is configured or the token was rejected; it explains the sign-in command the user runs in a terminal.
---

# Questrade portfolio

The `questrade` MCP server comes from the questrade-mcp package. In pi it is
the codemode namespace `mcp__questrade`. Its CLI is `bin/questrade-mcp.js` in
the package root, two directories above this skill's folder. For example, if
this file is `/opt/questrade-mcp/skills/questrade-portfolio/SKILL.md`, the CLI
is `node /opt/questrade-mcp/bin/questrade-mcp.js`.

**Read-only.** No tool places, changes or cancels orders, and Questrade only
grants trading to partner apps anyway. Never suggest that a trade was made.

## Start here

1. `qt_get_accounts` lists the accounts: `number`, `type` (TFSA, RRSP, Margin,
   …) and status.
2. Pass `accountId` (the account `number`) to `qt_get_positions`,
   `qt_get_balances`, `qt_get_orders` and `qt_get_transactions`. Without it they
   use the **first** account, which is wrong when there are several.
3. Quotes, candles and technicals take numeric **symbol IDs**, not tickers.
   Get them from `qt_lookup_symbol` (`prefix: "XEQT"`). Pick the right listing:
   `.TO` is the TSX, no suffix is usually US.

## Tools

| Tool | Use for | Notes |
|---|---|---|
| `qt_get_accounts` | account list | |
| `qt_get_positions` | holdings with quantity, average cost, market value, open and day P&L | |
| `qt_get_balances` | cash, market value, total equity, buying power | combined balance in one currency |
| `qt_get_transactions` | activity: trades, dividends, deposits, withdrawals, fees, interest | splits long ranges into 30-day requests; keep ranges to what the question needs |
| `qt_get_orders` | order history | `stateFilter`: All, Open or Closed |
| `qt_lookup_symbol` | ticker → symbol ID | |
| `qt_get_quotes` | live quotes | up to 50 symbol IDs |
| `qt_get_candles` | price history with an ASCII chart | at most 2000 candles per request: match `interval` to the range |
| `qt_compare_symbols` | normalized performance chart of several symbols | |
| `qt_analyze_technicals` | RSI 14, SMA 50/200, VWAP, Bollinger Bands | needs enough candles: 200+ daily candles for SMA 200 |
| `qt_screen_watchlist` | filter symbols by RSI, SMA 200, lower band, VWAP | |

Times are ISO 8601 **with an offset**, e.g. `2026-01-02T00:00:00-05:00`.
Questrade rejects times without one. Market data follows the user's
Questrade data subscription; quotes can be delayed.

## Signing in (the user does this, never the chat)

The server stores its tokens in `~/.config/questrade-mcp/credentials.env`,
mode 600, on the machine that runs it. Override the path with
`QUESTRADE_TOKEN_FILE`.

When a tool says **no Questrade refresh token is configured**, or Questrade
**rejected the stored refresh token**, the error message includes the exact
command and host. Pass it on:

1. The user logs in at my.questrade.com and goes to App Hub → API Centre, then
   the personal app → "New manual authorization" → "Generate new token".
2. In a terminal **on the machine that runs the server**, they run the
   following and paste the token there. The token is hidden and never shown.

   ```bash
   node <package>/bin/questrade-mcp.js login
   ```

3. Running servers pick up the new token on their next call. No restart is
   needed.

Rules:
- Never ask for a token in the chat, and never accept one pasted there. If the
  user pastes one anyway, tell them it's spent: generate a new one and use
  `login`.
- Never run `login` or `logout` yourself.
- You may run `node <package>/bin/questrade-mcp.js check`. It shows whether a
  token is stored and whether Questrade accepts it, and never prints the
  token.

How tokens work: a refresh token works **once**, and each refresh returns the
next one. The server stores the new one straight away, keeps it fresh every
25 minutes while it runs, and shares it safely between several server
processes. A manually generated token expires after 7 days if unused. After a
long stretch with no server running, the stored token can lapse, and the user
signs in again.
