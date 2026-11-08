import fs from 'fs';
import { TokenError, TokenManager } from './auth/TokenManager.js';
import { QuestradeClient } from './api/QuestradeClient.js';
import { credentialsFile, readCredentials, writeCredentials } from './auth/credentials.js';
import { HOST, cli } from './cli.js';

const TOKEN_KEYS = ['QUESTRADE_REFRESH_TOKEN', 'QUESTRADE_ACCESS_TOKEN', 'QUESTRADE_ACCESS_TOKEN_EXPIRES_AT'];

/**
 * Pull the refresh token out of whatever was pasted: the bare token, or a
 * URL / text containing `refresh_token=...`.
 */
export function extractRefreshToken(text) {
    const value = String(text ?? '').replace(/\x1b\[20[01]~/g, '').trim();
    const fromParam = value.match(/refresh_token=([^&\s"']+)/)?.[1];
    const token = fromParam ? decodeURIComponent(fromParam) : value.replace(/^["']|["']$/g, '');
    if (!token) throw new TokenError('Nothing was pasted.');
    if (!/^[A-Za-z0-9._~-]{10,}$/.test(token)) throw new TokenError("That doesn't look like a Questrade refresh token (letters and digits, no spaces).");
    return token;
}

/** Read one line without echoing it when stdin is a terminal; otherwise read stdin. */
export function readSecret(prompt, { input = process.stdin, out = process.stderr } = {}) {
    if (!input.isTTY) {
        return new Promise((resolve, reject) => {
            let data = '';
            input.setEncoding('utf8');
            input.on('data', (chunk) => (data += chunk));
            input.on('end', () => resolve(data.split(/\r?\n/).find((l) => l.trim()) ?? ''));
            input.on('error', reject);
        });
    }
    out.write(prompt);
    return new Promise((resolve, reject) => {
        let value = '';
        input.setRawMode(true);
        input.setEncoding('utf8');
        input.resume();
        const done = (error) => {
            input.setRawMode(false);
            input.pause();
            input.removeListener('data', onData);
            out.write('\n');
            if (error) reject(error);
            else resolve(value);
        };
        const onData = (chunk) => {
            for (const ch of chunk.replace(/\x1b\[20[01]~/g, '')) {
                if (ch === '\r' || ch === '\n') return done();
                if (ch === '\u0003' || ch === '\u0004') return done(new TokenError('Cancelled.'));
                if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
                else if (ch >= ' ') value += ch;
            }
        };
        input.on('data', onData);
    });
}

function describeAccounts(data) {
    const accounts = data?.accounts ?? [];
    const kinds = accounts.map((a) => [a.type, a.clientAccountType].filter(Boolean).join(' ')).join(', ');
    return `${accounts.length} account(s)${kinds ? `: ${kinds}` : ''}`;
}

/** `questrade-mcp login`: store a newly generated refresh token. The token is never printed. */
export async function runLogin({ env = process.env, input = process.stdin, out = process.stdout, err = process.stderr } = {}) {
    const file = credentialsFile(env);
    out.write(
        [
            `Questrade sign-in for ${HOST}. Credentials go to ${file} (mode 600).`,
            '1. Log in at https://my.questrade.com and open App Hub → API Centre (activate API access the first time).',
            '2. Open your personal app (or register one), click "New manual authorization", then "Generate new token".',
            '3. Copy the token and paste it here. It is not shown, and it can be used only once.',
            '',
        ].join('\n'),
    );
    const token = extractRefreshToken(await readSecret('Refresh token: ', { input, out: err }));
    const tm = new TokenManager(undefined, { file });
    await tm.signIn(token);
    let summary = '';
    try {
        summary = ` Questrade shows ${describeAccounts(await new QuestradeClient(tm).getAccounts())}.`;
    } catch (error) {
        summary = ` (Could not list accounts yet: ${error.message})`;
    }
    out.write(`Signed in.${summary}\nThe server keeps the token fresh while it runs. Running servers pick it up on their next call.\n`);
    return 0;
}

/** `questrade-mcp check`: is a token stored, and does Questrade accept it? Never prints token values. */
export async function runCheck({ env = process.env, out = process.stdout } = {}) {
    const file = credentialsFile(env);
    const { exists, values } = readCredentials(file);
    out.write(`Credentials file: ${file}${exists ? '' : ' (missing)'}\n`);
    if (exists) {
        const mode = fs.statSync(file).mode & 0o777;
        if (mode !== 0o600) out.write(`  Warning: mode is ${mode.toString(8)}; run: chmod 600 ${file}\n`);
    }
    if (!values.QUESTRADE_REFRESH_TOKEN) {
        out.write(`Not signed in. In a terminal on ${HOST}, run: ${cli('login')}\n`);
        return 1;
    }
    const expires = Date.parse(values.QUESTRADE_ACCESS_TOKEN_EXPIRES_AT || '');
    out.write(`Refresh token: set. Access token: ${values.QUESTRADE_ACCESS_TOKEN && expires > Date.now() ? `valid until ${new Date(expires).toISOString()}` : 'none or expired (the next call refreshes it)'}\n`);
    try {
        const tm = new TokenManager(undefined, { file });
        out.write(`Questrade: OK, ${describeAccounts(await new QuestradeClient(tm).getAccounts())}\n`);
        return 0;
    } catch (error) {
        out.write(`Questrade: ${error.message}\n`);
        return 1;
    }
}

/** `questrade-mcp logout`: forget the tokens on this machine. */
export function runLogout({ env = process.env, out = process.stdout } = {}) {
    const file = credentialsFile(env);
    if (!readCredentials(file).exists) {
        out.write('Nothing to remove: no credentials file.\n');
        return 0;
    }
    writeCredentials(file, Object.fromEntries(TOKEN_KEYS.map((k) => [k, ''])));
    out.write(`Removed the Questrade tokens from ${file}. To revoke access on Questrade's side too, remove the authorization in the API Centre.\n`);
    return 0;
}
