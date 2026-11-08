#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig, TOOLSETS } from '../src/config.js';
import { QuestradeContext } from '../src/context.js';
import { createServer, VERSION } from '../src/server.js';
import { serveHttp } from '../src/http.js';
import { runSecretsCli } from '../src/auth/secrets-cli.js';
import { runLoginCli } from '../src/auth/login-cli.js';
import { runSetupCli } from '../src/setup-cli.js';

const HELP = `questrade-mcp ${VERSION}: read-only MCP server for Questrade

Usage:
  questrade-mcp [serve]            Serve MCP over stdio (default)
  questrade-mcp serve --http       Serve MCP over Streamable HTTP
        [--host 127.0.0.1] [--port 8788] [--path /mcp]
  questrade-mcp setup [--yes] [--no-login]
                                   First-time setup: register the server and the
                                   questrade-portfolio skill with pi/Phosphor and Claude Code,
                                   then sign in. Asks before each change
  questrade-mcp login              Paste a refresh token generated in Questrade's API Centre
                                   (input hidden); it is exchanged at once and stored
  questrade-mcp logout             Forget the stored tokens
  questrade-mcp check              Verify credentials and list the accounts
  questrade-mcp secrets set <KEY>  Save one credential; secrets are read with echo off
                                   (or from stdin), never from arguments
  questrade-mcp secrets list       Show which keys are set (never values)
  questrade-mcp secrets unset <KEY>
                                   Remove a key
  questrade-mcp --version | --help

Credentials file: $QUESTRADE_CREDENTIALS_FILE or ~/.config/questrade-mcp/credentials.env (mode 600)
  QUESTRADE_REFRESH_TOKEN          From "questrade-mcp login"; rotates on every refresh
  QUESTRADE_ACCOUNT_ID             Default account (optional)

Settings (env): QUESTRADE_ACCOUNT_ID, QUESTRADE_MCP_TOOLSETS=${TOOLSETS.join(',')},
  QUESTRADE_MCP_MAX_RESPONSE_CHARS, QUESTRADE_MCP_MAX_RANGE_DAYS, QUESTRADE_MCP_MAX_CONCURRENCY,
  QUESTRADE_MCP_LOG_LEVEL, QUESTRADE_MCP_HTTP_HOST/PORT/PATH, QUESTRADE_MCP_ALLOWED_HOSTS,
  QUESTRADE_MCP_HTTP_TOKEN (credentials file)
`;

// `questrade-mcp secrets list | head` closes the pipe early; that is not an error.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      http: { type: 'boolean' },
      host: { type: 'string' },
      port: { type: 'string' },
      path: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      'no-login': { type: 'boolean' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.version) return void process.stdout.write(`${VERSION}\n`);
  if (values.help || positionals[0] === 'help') return void process.stdout.write(HELP);
  const command = positionals[0] || 'serve';
  const config = loadConfig();
  const ctx = new QuestradeContext({ config });

  if (command === 'serve') {
    const stopKeepAlive = config.keepAlive ? ctx.tokens.startKeepAlive() : () => {};
    if (values.http) {
      const handle = await serveHttp(ctx, {
        host: values.host || config.http.host,
        port: values.port ? Number(values.port) : config.http.port,
        path: values.path || config.http.path,
      });
      const stop = async () => {
        stopKeepAlive();
        await handle.close();
        process.exit(0);
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      return;
    }
    const handle = serveStdio(() => createServer(ctx));
    const stop = () => {
      stopKeepAlive();
      void handle.close().finally(() => process.exit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    ctx.logger.info(`questrade-mcp ${VERSION} on stdio (auth: ${ctx.tokens.describe().mode})`);
    return;
  }

  if (command === 'check') return check(ctx);

  if (command === 'secrets') {
    process.exitCode = await runSecretsCli(positionals.slice(1), { file: config.credentialsFile });
    return;
  }

  if (command === 'login') {
    process.exitCode = await runLoginCli({ config });
    if (process.exitCode === 0) await check(new QuestradeContext({ config }));
    return;
  }

  if (command === 'setup') {
    process.exitCode = await runSetupCli({
      yes: values.yes,
      login: !values['no-login'],
      runLogin: async ({ interactive }) => {
        if (new QuestradeContext({ config }).tokens.describe().mode !== 'none') return 'done';
        if (!interactive) return 'skipped';
        process.stdout.write('\nSign in to Questrade\n');
        return (await runLoginCli({ config })) === 0 ? 'done' : 'skipped';
      },
      runCheck: async () => {
        const fresh = new QuestradeContext({ config });
        if (fresh.tokens.describe().mode === 'none') return;
        process.stdout.write('\n');
        await check(fresh).catch((error) => process.stdout.write(`Check failed: ${error.message}\n`));
      },
    });
    return;
  }

  if (command === 'logout') {
    ctx.tokens.forget();
    process.stdout.write(`Removed the Questrade tokens from ${config.credentialsFile}. To revoke access on Questrade's side too, remove the authorization in the API Centre.\n`);
    return;
  }

  process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
  process.exitCode = 2;
}

async function check(ctx) {
  const auth = ctx.tokens.describe();
  process.stdout.write(`Credentials: ${auth.mode} (${auth.credentialsFile})${auth.autoRefresh ? ', auto-refresh on' : ''}\n`);
  if (auth.mode === 'none') {
    process.stdout.write(`${ctx.tokens.setupHint()}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    const [{ accounts, userId }, time] = await Promise.all([ctx.listAccounts(), ctx.client.get('/v1/time')]);
    process.stdout.write(`Questrade: OK (user ${userId ?? '?'}, server time ${time.time})\n`);
    for (const a of accounts) process.stdout.write(`Account: ${a.number}  ${[a.type, a.clientAccountType].filter(Boolean).join(' ')}${a.status && a.status !== 'Active' ? ` (${a.status})` : ''}${a.isPrimary ? ' (primary)' : ''}\n`);
    try {
      process.stdout.write(`Default account: ${await ctx.resolveAccountId()}\n`);
    } catch (error) {
      process.stdout.write(`Default account: none (${error.message})\n`);
    }
    process.stdout.write(`Access token valid until ${ctx.tokens.describe().accessTokenExpiresAt}\n`);
  } catch (error) {
    process.stdout.write(`Questrade: ${error.message}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`questrade-mcp: ${error.message}\n`);
  process.exit(1);
});

