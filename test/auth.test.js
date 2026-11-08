import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { readCredentialFile, writeCredentialFile } from '../src/auth/credentials.js';
import { TokenProvider } from '../src/auth/tokens.js';
import { extractRefreshToken, runLoginCli } from '../src/auth/login-cli.js';
import { runSecretsCli } from '../src/auth/secrets-cli.js';
import { loadConfig } from '../src/config.js';
import { QuestradeAuthError } from '../src/questrade/errors.js';
import { startFakeQuestrade } from './helpers/fake-questrade.js';
import { tempCredentials } from './helpers/harness.js';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = path.join(ROOT, 'bin/questrade-mcp.js');
const sink = () => {
  const s = { text: '', write: (chunk) => (s.text += chunk) };
  return s;
};
const piped = (text) => {
  const stream = new PassThrough();
  stream.end(text);
  return stream;
};
const provider = (file, loginUrl) => new TokenProvider(loadConfig({ QUESTRADE_CREDENTIALS_FILE: file, QUESTRADE_LOGIN_URL: loginUrl, QUESTRADE_MCP_MAX_RETRIES: '0' }));

test('credentials: atomic write, mode 600, keeps other lines, empty value removes a key', () => {
  const { dir, file } = tempCredentials(null);
  fs.writeFileSync(file, '# mine\nOTHER=keep\nQUESTRADE_REFRESH_TOKEN=old\n');
  writeCredentialFile(file, { QUESTRADE_REFRESH_TOKEN: 'new', QUESTRADE_ACCESS_TOKEN: 'acc' });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, 'utf8'), '# mine\nOTHER=keep\nQUESTRADE_REFRESH_TOKEN=new\nQUESTRADE_ACCESS_TOKEN=acc\n');
  writeCredentialFile(file, { QUESTRADE_ACCESS_TOKEN: '' });
  assert.deepEqual(readCredentialFile(file).values, { OTHER: 'keep', QUESTRADE_REFRESH_TOKEN: 'new' });
  assert.throws(() => writeCredentialFile(file, { X: 'a\nb' }), /newlines/);
  assert.deepEqual(fs.readdirSync(dir), ['credentials.env'], 'no temp files left');
});

test('login input: bare token, URL with refresh_token=, quotes and bracketed paste', () => {
  assert.equal(extractRefreshToken('  abcDEF123456789xyz\n'), 'abcDEF123456789xyz');
  assert.equal(extractRefreshToken('https://login.questrade.com/oauth2/token?grant_type=refresh_token&refresh_token=abcDEF123456789xyz'), 'abcDEF123456789xyz');
  assert.equal(extractRefreshToken('"abcDEF123456789xyz"'), 'abcDEF123456789xyz');
  assert.equal(extractRefreshToken('\x1b[200~abcDEF123456789xyz\x1b[201~'), 'abcDEF123456789xyz');
  assert.throws(() => extractRefreshToken(''), /Nothing was pasted/);
  assert.throws(() => extractRefreshToken('not a token at all'), /doesn't look like/);
});

test('tokens: several processes needing a refresh at once spend the refresh token only once', async () => {
  const fake = await startFakeQuestrade();
  try {
    const { file } = tempCredentials();
    const children = Array.from({ length: 6 }, () => run(process.execPath, [path.join(ROOT, 'test/helpers/get-token.js'), file, fake.loginUrl]));
    const tokens = (await Promise.all(children)).map((r) => r.stdout);
    assert.equal(fake.state.exchanges, 1);
    assert.deepEqual(new Set(tokens), new Set(['access-token-0001']));
    const { values } = readCredentialFile(file);
    assert.equal(values.QUESTRADE_REFRESH_TOKEN, 'refresh-token-0001', 'the rotated refresh token is stored');
    assert.equal(values.QUESTRADE_API_SERVER, `${fake.state.base}/`);
    assert.ok(Date.parse(values.QUESTRADE_ACCESS_TOKEN_EXPIRES_AT) > Date.now());
    assert.ok(!fs.existsSync(`${file}.lock`));
  } finally {
    await fake.close();
  }
});

test('tokens: a 401 on a token another process already replaced reuses the new one', async () => {
  const fake = await startFakeQuestrade();
  try {
    const { file } = tempCredentials();
    const a = provider(file, fake.loginUrl);
    const b = provider(file, fake.loginUrl);
    const first = await a.getAccess();
    const second = await b.getAccess({ rejectedToken: first.accessToken }); // b's call was rejected: refresh
    assert.equal(fake.state.exchanges, 2);
    const again = await a.getAccess({ rejectedToken: first.accessToken }); // a was rejected with the old token: reuse b's
    assert.equal(again.accessToken, second.accessToken);
    assert.equal(fake.state.exchanges, 2);
    await a.refresh({ force: true });
    assert.equal(fake.state.exchanges, 3);
  } finally {
    await fake.close();
  }
});

test('tokens: missing and spent refresh tokens say how to sign in; describe() never shows tokens', async () => {
  const fake = await startFakeQuestrade();
  try {
    const { file } = tempCredentials(null);
    const p = provider(file, fake.loginUrl);
    assert.equal(p.describe().mode, 'none');
    await assert.rejects(p.getAccess(), (e) => e instanceof QuestradeAuthError && /No Questrade refresh token is configured on .+ in a terminal on .+ \(not in the chat\).*: node \S*questrade-mcp\.js login/.test(e.message));
    writeCredentialFile(file, { QUESTRADE_REFRESH_TOKEN: 'already-used-token-123' });
    await assert.rejects(p.getAccess(), /rejected the stored refresh token .*New manual authorization.*questrade-mcp\.js login/);
    assert.equal(readCredentialFile(file).values.QUESTRADE_REFRESH_TOKEN, 'already-used-token-123', 'a failed exchange changes nothing');
    assert.ok(!JSON.stringify(p.describe()).includes('already-used'));
  } finally {
    await fake.close();
  }
});

test('login stores a token without printing it; check and logout via the real binary', async () => {
  const fake = await startFakeQuestrade();
  try {
    const { file } = tempCredentials(null);
    const config = loadConfig({ QUESTRADE_CREDENTIALS_FILE: file, QUESTRADE_LOGIN_URL: fake.loginUrl });
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, QUESTRADE_CREDENTIALS_FILE: file, QUESTRADE_LOGIN_URL: fake.loginUrl };

    const before = await run(process.execPath, [BIN, 'check'], { env }).catch((e) => e);
    assert.equal(before.code, 1);
    assert.match(before.stdout, /Credentials: none[\s\S]*questrade-mcp\.js login/);

    const out = sink();
    const err = sink();
    assert.equal(await runLoginCli({ config, input: piped('seed-refresh-token-0001\n'), out, err }), 0);
    assert.match(out.text, /Signed in\./);
    assert.ok(!/token-000/.test(out.text + err.text), 'no token values in the output');
    assert.equal(readCredentialFile(file).values.QUESTRADE_REFRESH_TOKEN, 'refresh-token-0001');

    const reuse = sink();
    assert.equal(await runLoginCli({ config, input: piped('seed-refresh-token-0001\n'), out: sink(), err: reuse }), 1);
    assert.match(reuse.text, /already used/);

    const after = await run(process.execPath, [BIN, 'check'], { env });
    assert.match(after.stdout, /Credentials: oauth .*auto-refresh on\nQuestrade: OK \(user 3000124[\s\S]*Account: 11111111  TFSA Individual \(primary\)[\s\S]*Default account: none \(This login has 2 accounts/);
    assert.ok(!/token-000/.test(after.stdout));

    const list = sink();
    await runSecretsCli(['list'], { file, out: list });
    assert.match(list.text, /QUESTRADE_REFRESH_TOKEN\s+set/);
    assert.ok(!/token-000/.test(list.text));

    fs.appendFileSync(file, 'QUESTRADE_ACCOUNT_ID=11111111\n');
    const logout = await run(process.execPath, [BIN, 'logout'], { env });
    assert.match(logout.stdout, /Removed the Questrade tokens/);
    assert.deepEqual(Object.keys(readCredentialFile(file).values).sort(), ['QUESTRADE_ACCOUNT_ID', 'QUESTRADE_API_SERVER']);
  } finally {
    await fake.close();
  }
});
