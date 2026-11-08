import { TokenProvider } from './tokens.js';
import { readHidden } from './secrets-cli.js';
import { HOST } from '../cli.js';
import { QuestradeAuthError } from '../questrade/errors.js';

/**
 * Pull the refresh token out of whatever was pasted: the bare token, or a
 * URL / text containing `refresh_token=...`.
 */
export function extractRefreshToken(text) {
  const value = String(text ?? '').replace(/\x1b\[20[01]~/g, '').trim();
  const fromParam = value.match(/refresh_token=([^&\s"']+)/)?.[1];
  const token = fromParam ? decodeURIComponent(fromParam) : value.replace(/^["']|["']$/g, '');
  if (!token) throw new QuestradeAuthError('Nothing was pasted.', { code: 'NO_INPUT' });
  if (!/^[A-Za-z0-9._~-]{10,}$/.test(token)) {
    throw new QuestradeAuthError("That doesn't look like a Questrade refresh token (letters and digits, no spaces).", { code: 'BAD_INPUT' });
  }
  return token;
}

/**
 * `questrade-mcp login`: store a newly generated refresh token. The token is
 * read with echo off (or from stdin), exchanged at once (which validates it)
 * and never printed. Returns an exit code.
 */
export async function runLoginCli({ config, input = process.stdin, out = process.stdout, err = process.stderr, fetchImpl } = {}) {
  out.write(
    [
      `Questrade sign-in for ${HOST}. Credentials go to ${config.credentialsFile} (mode 600).`,
      '1. Log in at https://my.questrade.com and open App Hub → API Centre (activate API access the first time).',
      '2. Open your personal app (or register one), click "New manual authorization", then "Generate new token".',
      '3. Copy the token and paste it here. It is not shown, and it can be used only once.',
      '',
    ].join('\n'),
  );
  try {
    const token = extractRefreshToken(await readHidden('Refresh token: ', { input, output: err }));
    await new TokenProvider(config, { fetchImpl }).signIn(token);
    out.write('Signed in. Running servers pick up the token on their next call; while one runs it keeps the token fresh.\n');
    return 0;
  } catch (error) {
    err.write(`${error.message}\n`);
    return 1;
  }
}
