# Questrade MCP

A read-only Model Context Protocol (MCP) server for the Questrade API.
It exposes account, portfolio, market-data, transaction, technical-analysis,
and order-history tools over MCP stdio transport.

> Trading and order submission are intentionally not implemented.
> This project is not affiliated with Questrade.

## Features

- Account list, positions, balances, and activity history
- Symbol search and historical candles
- Real-time read-only quotes
- Read-only order history
- Symbol comparison and local technical indicators
- Automatic OAuth refresh-token rotation
- In-process refresh keep-alive
- Atomic credential-file updates
- No credential-update tool exposed through MCP

## Requirements

- Node.js 20+
- A Questrade API refresh token
- An MCP-compatible host

## Install

```bash
npm install
```

## Credentials

Create a credentials file outside this repository with permissions `600`:

```dotenv
QUESTRADE_REFRESH_TOKEN=your-refresh-token
QUESTRADE_API_SERVER=https://api01.iq.questrade.com/
```

By default the server reads:

```text
~/.config/questrade-mcp/credentials.env
```

Override the location with `QUESTRADE_TOKEN_FILE`. Never commit this file or
place credentials in MCP arguments, source code, logs, or chat transcripts.

The server rewrites this file after each refresh and adds the current access
token and its expiry. To provision a new refresh token, replace the whole file
with the two lines above.

## Token refresh lifecycle

Questrade access tokens last 30 minutes. Each refresh token works once, and
exchanging it returns a new refresh token and a new access token, which
invalidates the previous access token. This server handles that as follows:

1. It refreshes on the first API call when no valid access token is stored.
2. It checks every 25 minutes while the MCP process is alive and refreshes
   when the access token has expired.
3. It atomically writes the new refresh token, access token, and expiry to the
   credential file.
4. It retries transient network/server failures and shares one refresh request
   between concurrent callers.

### Multiple processes

MCP hosts often start one server process per session, so several processes
may share the credential file. They share one token chain instead of
invalidating each other's tokens:

- A process whose access token expired or was rejected first uses the access
  token in the credential file if another process has already refreshed.
- Refreshes take an exclusive lock file (`credentials.env.lock`) and always
  use the refresh token currently in the file. A lock left by a crashed
  process is taken over.
- If Questrade rejects the refresh token, the server re-reads the file once in
  case something else replaced it.

### Keeping the token alive between sessions

The server only refreshes while an MCP process is running. If none runs for
longer than the refresh token's lifetime (about three days for Questrade), the
token expires and automatic refresh cannot recover it; a new token must be
provisioned locally. The same applies if the token is revoked.

If your MCP host does not keep the server running, schedule `npm run test:auth`
with cron, a systemd user timer, launchd, or similar, for example every 12
hours. It refreshes the token when the stored access token has expired and is
safe to run while MCP processes are active:

```cron
0 */12 * * * cd /path/to/questrade-mcp && npm run -s test:auth
```

This project does not install a scheduled job.

## Run

```bash
node src/main.js
```

The server communicates over stdin/stdout using MCP JSON-RPC. Diagnostics are
written to stderr.

## Test

```bash
npm test
```

The tests run against a local fake of Questrade's token and API servers and
never contact Questrade.

## Security model

The server is read-only. It does not expose order placement, cancellation,
watchlist writes, custom-index writes, or a tool that accepts credentials.
Keep the credential file outside the repository and restrict its permissions.
Review API permissions and revoke access when the integration is no longer
needed.

## License

MIT
