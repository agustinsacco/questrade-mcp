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
- Safe with several server processes at once (one per agent session)
- `login` command: paste a new token in a terminal; it is never shown
- No credential-update tool exposed through MCP
- A pi package: one `pi install` adds the server and an agent skill

## Requirements

- Node.js 20+
- A Questrade API refresh token
- An MCP-compatible host

## Install

### pi / Phosphor (recommended)

```bash
pi install git:github.com/agustinsacco/questrade-mcp
```

pi installs the npm dependencies. The package's extension registers the
`questrade` MCP server for every session (codemode exposure), and the
`questrade-portfolio` skill joins every session's skill index. The skill
teaches agents the tools, symbol IDs, time formats and the sign-in rules.
Phosphor can also install it from Settings → Skills & extensions.

Until someone signs in, each new session shows:

```
Questrade is not signed in on <host>. In a terminal there, run: node <package>/bin/questrade-mcp.js login
```

A `questrade` entry in `mcp.json` takes precedence over the package's
registration.

### Any other MCP client

```bash
git clone https://github.com/agustinsacco/questrade-mcp && cd questrade-mcp && npm install
```

Point the client at `node /path/to/questrade-mcp/bin/questrade-mcp.js`, using
stdio. For example, in Claude Code:

```bash
claude mcp add --scope user questrade -- node /path/to/questrade-mcp/bin/questrade-mcp.js
ln -sfn "$PWD/skills/questrade-portfolio" ~/.claude/skills/questrade-portfolio   # optional: the skill
```

## Sign in

1. Log in at https://my.questrade.com and open App Hub → API Centre. Activate
   API access the first time.
2. Open your personal app (register one if needed), click **New manual
   authorization**, then **Generate new token**.
3. In a terminal on the machine that runs the server:

   ```bash
   node bin/questrade-mcp.js login    # paste the token; it is not shown
   node bin/questrade-mcp.js check    # optional: confirms Questrade accepts it
   ```

`login` exchanges the token right away, so a mistyped or already-used token is
caught immediately. It stores the result in a credentials file outside the
repository, with permissions `600`:

```text
~/.config/questrade-mcp/credentials.env
```

Override the location with `QUESTRADE_TOKEN_FILE`. Running servers pick up a
new token on their next call. `logout` removes the tokens from this machine.
To revoke access on Questrade's side too, remove the authorization in the API
Centre.

Never put the token in MCP arguments, source code, logs or chat transcripts.
Agents are told to ask the user to run `login` and never to accept a token in
the chat. Writing the file by hand still works:

```dotenv
QUESTRADE_REFRESH_TOKEN=your-refresh-token
```

## Token refresh lifecycle

Questrade access tokens are short-lived and refresh tokens may rotate when they
are exchanged. This server handles both cases:

1. It refreshes on the first API call when the access token is missing or
   about to expire.
2. It refreshes automatically every 25 minutes while the MCP process remains
   alive.
3. It atomically writes the new refresh token, the access token and its expiry
   to the credentials file.
4. It retries transient network and server failures, and shares one refresh
   request between concurrent callers.
5. **Several processes share the file safely.** Agent hosts often run one
   server per session, and a refresh token works only once. Every process
   reads the current access token from the file. A refresh runs under a lock
   file (`credentials.env.lock`) and re-reads the file first, so only one
   process spends the refresh token and the rest reuse its result. A 401 on a
   token another process has already replaced reuses the new one instead of
   refreshing again.
6. A separate cron job is **not required** when the MCP host keeps a process
   alive. A supervisor, scheduled job or equivalent fallback is needed only
   when no MCP process runs for days. A manually generated token expires
   after 7 days if unused.

If a refresh token is revoked or expired, automatic refresh cannot recover it;
generate a new one and run `login` again. Tool errors say so, with the exact
command and host.

## Run

```bash
node bin/questrade-mcp.js          # or: npm start
```

The server communicates over stdin/stdout using MCP JSON-RPC. Diagnostics are
written to stderr. `node bin/questrade-mcp.js help` lists the commands.

## Tests

```bash
npm test
```

The tests run offline against a fake Questrade login server and API. They
cover token rotation across several real processes, the sign-in commands, the
pi extension and the MCP server over stdio.

## Security model

The server is read-only. It does not expose order placement, cancellation,
watchlist writes, custom-index writes, or a tool that accepts credentials.
Every tool carries the MCP `readOnlyHint` annotation.
Keep the credential file outside the repository and restrict its permissions.
Review API permissions and revoke access when the integration is no longer
needed.

## License

MIT
