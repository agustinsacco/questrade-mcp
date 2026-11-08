# Questrade MCP

A read-only Model Context Protocol server for [Questrade](https://www.questrade.com).
It covers Questrade's whole read API: accounts, balances, positions, activities,
executions, orders, symbols, quotes, option chains with Greeks, candles and
markets. It adds technical analysis and portfolio reports across accounts, and
keeps responses small enough that a model can page through years of activity
without flooding its context.

> Not affiliated with Questrade. Read-only by design: no tool places, changes
> or cancels orders.

## What it can do

| Area | Tools | What you get |
|---|---|---|
| Context | `qt_get_context`, `qt_list_accounts` | sign-in state and command, accounts, default account, server time |
| Balances | `qt_get_balances` | cash, market value, equity, buying power; per currency and combined; start of day |
| Positions | `qt_list_positions` | quantity, cost, price, value, open/day P&L, currency, weight; totals per currency |
| Activity | `qt_list_activities` | trades, dividends, deposits, withdrawals, interest, fees, FX; any date range; filters; totals |
| Fills and orders | `qt_list_executions`, `qt_list_orders`, `qt_get_order` | fills with commission and fees; order history and one order in full |
| Symbols and quotes | `qt_search_symbols`, `qt_get_symbols`, `qt_get_quotes`, `qt_list_markets` | tickers to IDs, fundamentals (P/E, EPS, yield, 52-week range), live quotes with change, market hours |
| Options | `qt_get_option_chain`, `qt_get_option_quotes` | expiries, strikes near the money, IV and Greeks |
| Price history | `qt_get_candles` | stats, ASCII chart and OHLCV rows, 1 minute to 1 year candles |
| Analysis | `qt_compare_symbols`, `qt_analyze_technicals`, `qt_screen_watchlist` | % change and drawdown, RSI, SMA 50/200, VWAP, Bollinger Bands, screens |
| Reports | `qt_run_report` | portfolio summary, allocation, dividend income, activity summary (below) |

19 tools, 2 resources (`questrade://guide`, `questrade://limitations`) and 3
prompts (`portfolio_review`, `dividend_report`, `research_symbol`). Every
tool, parameter and default is listed in **[docs/TOOLS.md](docs/TOOLS.md)**,
which is generated from the server.

### Reports

`qt_run_report` works across all active accounts (or one), and every result
states its basis:

| Report | Source | Period |
|---|---|---|
| `portfolio_summary` | live balances; each account's total in CAD and USD at Questrade's rate | now |
| `allocation` | live positions combined by symbol, weights within each currency, by security type | now |
| `dividend_income` | dividend activities by symbol and by month | any range (default year to date) |
| `activity_summary` | activities by type and currency, net deposits per account, commissions | any range (default year to date) |

### How it handles Questrade's API

| Questrade behaviour | Handling |
|---|---|
| Activities allow about a month per request | Any range is split into 30-day requests, back to back with no overlap, and cached briefly |
| Times need an ISO offset and Questrade works in Eastern time | Tools take `YYYY-MM-DD` (a Toronto day) or a full date-time; offsets follow DST |
| Positions carry no currency | Added from symbol details, so totals and weights never mix CAD and USD |
| Tools take numeric symbol IDs | Tools also accept exact tickers (`XEQT.TO`, `AAPL`); unknown ones get a pointer to `qt_search_symbols` |
| Candles stop at 2000 per request | Defaults per interval stay under it; a warning says when a range was cut |
| Each refresh token works once | Rotation is shared safely between processes (see [Sign in](#sign-in)) |
| Rate limits (`X-RateLimit-Reset`) | 429s wait for the reset (at most 10 s) and retry; 5xx and network errors back off |

### What Questrade's API cannot do

See `questrade://limitations`:

- **No trading** for personal apps (and this server never trades).
- No tax lots, realized gains or tax slips: use Questrade's statements for tax
  filing.
- No watchlists and no streaming through this server.
- Quotes follow the account's market-data subscription and can be delayed.

## Install

Node.js 20 or later. Agents get two things on top of the server:
- the **`questrade-portfolio` skill** (`skills/questrade-portfolio/SKILL.md`),
  which covers first steps, sign-in, the tools and the rules;
- the **sign-in command**, which the server puts into its connector
  description, `qt_get_context` (`auth.signIn`) and every auth error, with this
  machine's real path and host name.

### pi / Phosphor: one command

```bash
pi install npm:@saccolabs/questrade-mcp          # from npm
pi install git:github.com/agustinsacco/questrade-mcp   # or straight from GitHub
```

pi installs the npm dependencies. The package's extension registers the
`questrade` MCP server for every session (codemode exposure), and the skill
joins every session's skill index. Phosphor can also install it from
Settings → Skills & extensions. Until someone signs in, each new session
shows:

```
Questrade is not signed in on <host>. In a terminal there, run: node <package>/bin/questrade-mcp.js login
```

A `questrade` entry in `mcp.json` takes precedence over the package's
registration.

### Claude Code, Claude Desktop, Cursor: no clone needed

The package is on npm as
[`@saccolabs/questrade-mcp`](https://www.npmjs.com/package/@saccolabs/questrade-mcp).
`npx` downloads and runs it:

```bash
claude mcp add --scope user questrade -- npx -y @saccolabs/questrade-mcp
```

Other clients take the same command in their config:

```json
{ "mcpServers": { "questrade": { "command": "npx", "args": ["-y", "@saccolabs/questrade-mcp"] } } }
```

Then sign in, in a terminal on the same machine:

```bash
npx -y @saccolabs/questrade-mcp login
```

Every other command works the same way (`npx -y @saccolabs/questrade-mcp check`,
`… setup`). When the server runs through npx, its sign-in messages show the
npx command too. These clients don't install the `questrade-portfolio` skill. They get the
same guide from the `questrade://guide` resource, and the start-here tool points
to it. `npx -y @saccolabs/questrade-mcp setup` adds the server and a copy of the
skill to Claude Code in one step.

### From a clone: `setup`

```bash
git clone https://github.com/agustinsacco/questrade-mcp && cd questrade-mcp && npm install
node bin/questrade-mcp.js setup
```

`setup` looks for pi and Claude Code, shows each change and asks first:
- **pi:** `pi install <this folder>`.
- **Claude Code:** `claude mcp add --scope user questrade …`, plus a link at
  `~/.claude/skills/questrade-portfolio`.

It then runs `login` and `check`. Re-running it skips whatever is already set
up, and `--yes` accepts every step without asking. For other clients (Claude
Desktop, Cursor, …) it prints the config entry to add:

```json
{ "mcpServers": { "questrade": { "command": "node", "args": ["/path/to/questrade-mcp/bin/questrade-mcp.js"] } } }
```

Clients without skills can read the same guide from the `questrade://guide`
resource. Credentials stay on the machine that runs the server, so sign in on
each machine where it runs.

## Sign in

```bash
node bin/questrade-mcp.js login
```

1. Log in at https://my.questrade.com and open App Hub → API Centre. Activate
   API access the first time.
2. Open your personal app (register one if needed), click **New manual
   authorization**, then **Generate new token**.
3. Paste the token at the hidden prompt. It is never printed.

`login` exchanges the token right away, so a mistyped or already-used token is
caught immediately. Tokens are stored outside the repository in
`~/.config/questrade-mcp/credentials.env`, mode `600` (override with
`QUESTRADE_CREDENTIALS_FILE`). Running servers pick up a new token on their
next call. Other commands:
- `check` verifies the login and lists the accounts.
- `secrets list` shows which keys are set, never their values.
- `logout` forgets the tokens. To revoke access on Questrade's side too,
  remove the authorization in the API Centre.

See [`credentials.env.example`](credentials.env.example).

**Token lifecycle.** Access tokens last about 30 minutes, and each refresh token
works once:
- Every server process reads the current access token from the credentials
  file.
- A refresh runs under a lock file and re-reads the file first, so when
  several processes (one per agent session) need a new token at once, only one
  spends the refresh token and the rest reuse its result.
- A 401 on a token another process already replaced reuses the new one.
- While a server runs it refreshes every 25 minutes, which keeps the chain
  alive. A manually generated token expires after 7 days if unused, so after a
  longer stretch with no server running, sign in again.
- Writes are atomic (temp file, fsync, rename, chmod 600).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `QUESTRADE_ACCOUNT_ID` | auto | Default account. Otherwise the only active account; with several, tools ask for `accountId` |
| `QUESTRADE_MCP_TOOLSETS` | all | Comma list: `context,accounts,market,analysis,reports` |
| `QUESTRADE_MCP_MAX_RESPONSE_CHARS` | 60000 | Hard cap per tool result (trailing list items are dropped, with a note) |
| `QUESTRADE_MCP_MAX_RANGE_DAYS` | 3660 | Longest activity/execution/order range one call may fetch |
| `QUESTRADE_MCP_CACHE_TTL_MS` | 60000 | Cache for account data, ranges and candles |
| `QUESTRADE_MCP_MAX_CONCURRENCY` | 4 | Concurrent Questrade requests |
| `QUESTRADE_MCP_TIMEOUT_MS` / `QUESTRADE_MCP_MAX_RETRIES` | 30000 / 3 | Per request |
| `QUESTRADE_MCP_NO_KEEPALIVE` | off | Skip the 25-minute refresh while the server runs |
| `QUESTRADE_MCP_LOG_LEVEL` | info | `debug`, `info`, `warn`, `error`, `silent` (stderr only) |
| `QUESTRADE_MCP_HTTP_HOST` / `_PORT` / `_PATH` | 127.0.0.1 / 8788 / /mcp | HTTP transport |
| `QUESTRADE_MCP_ALLOWED_HOSTS` | loopback | Host/Origin allow-list for HTTP |
| `QUESTRADE_MCP_HTTP_TOKEN` | — | Bearer token for HTTP (credentials file); required off loopback |
| `QUESTRADE_CREDENTIALS_FILE` | `~/.config/questrade-mcp/credentials.env` | Credentials file (`QUESTRADE_TOKEN_FILE`, the 1.x name, still works) |

## Use it

Ask things like "what's my allocation across TFSA and RRSP?", "how much did I
get in dividends last year, by month?", "show my trades in XEQT this year",
or "compare XEQT.TO, VFV.TO and AAPL over 3 years". The prompts give ready-made
versions: `portfolio_review`, `dividend_report` (year) and `research_symbol`
(symbol).

### Streamable HTTP (one server for several clients)

```bash
node bin/questrade-mcp.js serve --http                      # http://127.0.0.1:8788/mcp
QUESTRADE_MCP_HTTP_HOST=100.x.y.z QUESTRADE_MCP_ALLOWED_HOSTS=myhost,100.x.y.z node bin/questrade-mcp.js serve --http
```

Off loopback the server refuses to start without `QUESTRADE_MCP_HTTP_TOKEN`,
and clients send `Authorization: Bearer <token>`. Host and Origin headers are
validated against DNS rebinding. `GET /healthz` reports liveness.

## Response design

- **Pagination everywhere.** Lists use `page`/`pageSize` (default 20, max
  100); reports and candles use `offset`/`limit`. Every response says
  `hasMore` and gives `nextPage`/`nextOffset`.
- **Summary by default.** `detail: "summary"` returns key fields and clips
  long text; `"full"` returns every field Questrade sends.
- **Compact JSON.** Nulls, empty strings and empty lists are dropped.
- **A hard budget.** Results above `QUESTRADE_MCP_MAX_RESPONSE_CHARS` are
  trimmed, never silently.
- **Totals cover all rows** even when only a page of rows is returned.
- **Errors are tool results** (`isError: true`) whose text names the fix:
  Questrade's own message and code, the account choices when one is needed,
  unknown tickers, auth problems with the command to run.

## MCP practices followed

- Official TypeScript SDK v2 (`@modelcontextprotocol/server`), spec 2026-07-28,
  serving 2025-era clients from the same factory over stdio and Streamable HTTP.
- Zod input schemas with per-field descriptions and bounds; arguments are
  validated before handlers run.
- Tool annotations on every tool: `readOnlyHint: true`,
  `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`.
- Server `instructions`, resources for the guide and limitations, and
  user-invoked prompts.
- stdout carries only JSON-RPC; logs go to stderr with secrets redacted.
- Toolsets for least privilege; no tool accepts or reveals credentials.

## Security

- Read-only: no order placement, cancellation or any other write.
- Credentials live only in the mode-600 credentials file on the machine that
  runs the server. They are never in MCP arguments, logs or tool results.
  `login` and `secrets set` read them with echo off.
- Agents are told never to ask for a token in the chat, and never to run
  `login` themselves.
- HTTP binds to loopback unless a bearer token is set.

## Development

```bash
npm test          # unit + end-to-end over both transports against a fake Questrade (no network)
npm run smoke     # live, with your credentials: every tool once, against the default account
npm run docs      # regenerate docs/TOOLS.md (a test fails when it is out of date)
npm run inspect   # MCP Inspector
```

The fake Questrade (`test/helpers/fake-questrade.js`) behaves like the real
one where it matters:
- one-use refresh tokens, and only the latest access token works;
- the 31-day activity limit (error 1003);
- `{ code, message }` errors and rate limits.

The token tests run six real processes at once to prove only one spends the
refresh token.

### Releasing

CI (`.github/workflows/ci.yml`) runs the tests on Node 20, 22 and 24 for every
push and pull request. When a push to `master` has a `package.json` version
that isn't on npm yet, and the tests pass, CI publishes it with provenance,
then tags `v<version>` and creates a GitHub release. To release:

```bash
npm version minor --no-git-tag-version   # or patch / major
npm run docs                             # TOOLS.md records the version
git commit -am "x.y.z: what changed" && git push
```

A version with a hyphen, such as `1.2.0-beta.1`, goes to the `next` dist-tag.
CI publishes through npm trusted publishing (`npm trust github`) or, failing
that, the `NPM_TOKEN` repository secret.

### Migrating from 1.x

2.0 matches [wave-mcp](https://github.com/agustinsacco/wave-mcp): the same
SDK, CLI, install paths and response design. Tool names follow its
`list_`/`get_` convention:

| 1.x | 2.0 |
|---|---|
| `qt_get_accounts` | `qt_list_accounts` (or `qt_get_context`) |
| `qt_get_positions` | `qt_list_positions` |
| `qt_get_transactions` | `qt_list_activities` |
| `qt_get_orders` | `qt_list_orders` |
| `qt_lookup_symbol` | `qt_search_symbols` |
| `qt_get_quotes`, `qt_get_candles`, `qt_get_balances`, `qt_compare_symbols`, `qt_analyze_technicals`, `qt_screen_watchlist` | same names; symbols may also be tickers |

Account tools no longer fall back silently to the first account: set
`QUESTRADE_ACCOUNT_ID` or pass `accountId`. Times may be plain dates.
`src/main.js` is now `bin/questrade-mcp.js`, and the credentials file gains
the current access token, so several processes can share it.

## Related

[wave-mcp](https://github.com/agustinsacco/wave-mcp), an MCP server for Wave
accounting, works the same way: it installs the same way, signs in the same
way, and has the same CLI and response design.

## License

MIT
