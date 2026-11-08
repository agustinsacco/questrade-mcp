#!/usr/bin/env node
import { runCheck, runLogin, runLogout } from '../src/login-cli.js';
import { TokenError } from '../src/auth/TokenManager.js';
import { cli } from '../src/cli.js';

const COMMANDS = [
    ['', 'run the MCP server on stdio (same as "serve")'],
    ['login', 'store a newly generated Questrade refresh token'],
    ['check', 'show whether a token is stored and Questrade accepts it'],
    ['logout', 'remove the stored tokens from this machine'],
];
const width = Math.max(...COMMANDS.map(([c]) => cli(c).length));
const HELP = `Questrade MCP server (read-only)

Usage:
${COMMANDS.map(([c, text]) => `  ${cli(c).padEnd(width)}  ${text}`).join('\n')}

Environment: QUESTRADE_TOKEN_FILE overrides ~/.config/questrade-mcp/credentials.env
`;

const command = process.argv[2] ?? 'serve';
process.stdout.on('error', (error) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
});

try {
    if (command === 'serve') await import('../src/main.js');
    else if (command === 'login') process.exitCode = await runLogin();
    else if (command === 'check') process.exitCode = await runCheck();
    else if (command === 'logout') process.exitCode = runLogout();
    else if (command === 'help' || command === '--help' || command === '-h') process.stdout.write(HELP);
    else {
        process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
        process.exitCode = 2;
    }
} catch (error) {
    process.stderr.write(`${error instanceof TokenError ? '' : 'Error: '}${error.message}\n`);
    process.exitCode = 1;
}
