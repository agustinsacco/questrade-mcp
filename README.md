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

## Token refresh lifecycle

Questrade access tokens are short-lived and refresh tokens may rotate when they
are exchanged. This server handles both cases:

1. It refreshes on startup/first API call when the access token is unavailable
   or expired.
2. It refreshes automatically every 25 minutes while the MCP process remains
   alive.
3. It atomically writes the newly returned refresh token to the credential file.
4. It retries transient network/server failures and shares one refresh request
   between concurrent callers.
5. A separate cron job is **not required** when the MCP host keeps the process
   alive. A supervisor, scheduled job, or equivalent fallback is needed only
   when the MCP process is routinely stopped or restarted.

If a refresh token is revoked or expired, automatic refresh cannot recover it;
a new token must be provisioned locally.

## Run

```bash
node src/main.js
```

The server communicates over stdin/stdout using MCP JSON-RPC. Diagnostics are
written to stderr.

## Security model

The server is read-only. It does not expose order placement, cancellation,
watchlist writes, custom-index writes, or a tool that accepts credentials.
Keep the credential file outside the repository and restrict its permissions.
Review API permissions and revoke access when the integration is no longer
needed.

## License

MIT
