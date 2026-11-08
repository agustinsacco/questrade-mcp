import os from 'os';
import { fileURLToPath } from 'url';

/**
 * The exact command for this checkout's CLI, e.g.
 * `node ~/src/questrade-mcp/bin/questrade-mcp.js login`, so messages an agent
 * passes on work as-is on this machine.
 */
const BIN = fileURLToPath(new URL('../bin/questrade-mcp.js', import.meta.url));
const HOME = os.homedir();

export const HOST = os.hostname();

export function cli(args = '') {
    let p = HOME && BIN.startsWith(`${HOME}/`) ? `~/${BIN.slice(HOME.length + 1)}` : BIN;
    if (/[\s'"$`\\]/.test(p)) p = `'${BIN.replace(/'/g, `'\\''`)}'`;
    return `node ${p}${args ? ` ${args}` : ''}`;
}

export const LOGIN_HINT =
    `The user generates a new token in Questrade (my.questrade.com → App Hub → API Centre → personal app → New manual authorization → Generate new token), ` +
    `then runs this in a terminal on ${HOST} (not in the chat) and pastes it there: ${cli('login')}`;
