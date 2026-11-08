import os from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * The exact shell command for this checkout's CLI, e.g.
 * `node ~/src/questrade-mcp/bin/questrade-mcp.js login`. Messages that ask
 * the user to run something use it, so an agent in any session can pass on a
 * command that works as-is (the `questrade-mcp` name is only on PATH after
 * npm link).
 */
const BIN = fileURLToPath(new URL('../bin/questrade-mcp.js', import.meta.url));
const HOME = os.homedir();

function binPath() {
  const p = HOME && BIN.startsWith(`${HOME}/`) ? `~/${BIN.slice(HOME.length + 1)}` : BIN;
  return /[\s'"$`\\]/.test(p) ? `'${BIN.replace(/'/g, `'\\''`)}'` : p;
}

export const HOST = os.hostname();

export function cli(args = '') {
  return `node ${binPath()}${args ? ` ${args}` : ''}`;
}

/** "in a terminal on <host> (not in the chat), run: <command>" */
export function runInTerminal(args) {
  return `in a terminal on ${HOST} (not in the chat), run: ${cli(args)}`;
}

export const LOGIN_HINT =
  'The user generates a new token in Questrade (my.questrade.com → App Hub → API Centre → personal app → New manual authorization → Generate new token), ' +
  `then runs this in a terminal on ${HOST} (not in the chat) and pastes it there: ${cli('login')}`;
