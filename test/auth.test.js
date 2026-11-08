import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PassThrough } from 'stream';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readCredentials, writeCredentials } from '../src/auth/credentials.js';
import { TokenError, TokenManager } from '../src/auth/TokenManager.js';
import { extractRefreshToken, runCheck, runLogin, runLogout } from '../src/login-cli.js';
import questradeExtension, { nodeCommand, signInNotice } from '../extensions/questrade.js';
import { startFakeQuestrade } from './helpers/fake-questrade.js';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qt-mcp-')), 'credentials.env');
const sink = () => {
    const s = { text: '', write: (chunk) => (s.text += chunk) };
    return s;
};
const piped = (text) => {
    const stream = new PassThrough();
    stream.end(text);
    return stream;
};

test('credentials: atomic write, mode 600, keeps other keys, empty value removes a key', () => {
    const file = tmpFile();
    fs.writeFileSync(file, '# mine\nOTHER=keep\nQUESTRADE_REFRESH_TOKEN=old\n');
    writeCredentials(file, { QUESTRADE_REFRESH_TOKEN: 'new', QUESTRADE_ACCESS_TOKEN: 'acc' });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(file, 'utf8'), '# mine\nOTHER=keep\nQUESTRADE_REFRESH_TOKEN=new\nQUESTRADE_ACCESS_TOKEN=acc\n');
    writeCredentials(file, { QUESTRADE_ACCESS_TOKEN: '' });
    assert.deepEqual(readCredentials(file).values, { OTHER: 'keep', QUESTRADE_REFRESH_TOKEN: 'new' });
    assert.throws(() => writeCredentials(file, { X: 'a\nb' }), /newlines/);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['credentials.env'], 'no temp files left');
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
        const file = tmpFile();
        writeCredentials(file, { QUESTRADE_REFRESH_TOKEN: 'seed-refresh-token-0001' });
        const children = Array.from({ length: 6 }, () => run(process.execPath, [path.join(ROOT, 'test/helpers/get-token.js'), file, fake.loginUrl]));
        const tokens = (await Promise.all(children)).map((r) => r.stdout);
        assert.equal(fake.state.exchanges, 1);
        assert.deepEqual(new Set(tokens), new Set(['access-token-0001']));
        const { values } = readCredentials(file);
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
        const file = tmpFile();
        writeCredentials(file, { QUESTRADE_REFRESH_TOKEN: 'seed-refresh-token-0001' });
        const a = new TokenManager(undefined, { file, loginUrl: fake.loginUrl });
        const b = new TokenManager(undefined, { file, loginUrl: fake.loginUrl });
        const first = await a.getValidToken();
        const second = await b.forceRefresh(first.access_token); // b's call was rejected: refresh
        assert.equal(fake.state.exchanges, 2);
        const again = await a.forceRefresh(first.access_token); // a was rejected with the old token: reuse b's
        assert.equal(again.access_token, second.access_token);
        assert.equal(fake.state.exchanges, 2);
        await a.forceRefresh(); // no argument: always refresh
        assert.equal(fake.state.exchanges, 3);
    } finally {
        await fake.close();
    }
});

test('tokens: missing and spent refresh tokens say how to sign in', async () => {
    const fake = await startFakeQuestrade();
    try {
        const file = tmpFile();
        const tm = new TokenManager(undefined, { file, loginUrl: fake.loginUrl });
        await assert.rejects(tm.getValidToken(), (e) => e instanceof TokenError && /No Questrade refresh token is configured on .+ in a terminal on .+: node \S*questrade-mcp\.js login/.test(e.message));
        writeCredentials(file, { QUESTRADE_REFRESH_TOKEN: 'already-used-token-123' });
        await assert.rejects(tm.getValidToken(), /rejected the stored refresh token .*New manual authorization.*questrade-mcp\.js login/);
        assert.equal(readCredentials(file).values.QUESTRADE_REFRESH_TOKEN, 'already-used-token-123', 'a failed exchange changes nothing');
    } finally {
        await fake.close();
    }
});

test('login, check and logout commands never print the token', async () => {
    const fake = await startFakeQuestrade();
    try {
        const file = tmpFile();
        const env = { QUESTRADE_TOKEN_FILE: file };
        let out = sink();
        assert.equal(await runCheck({ env, out }), 1);
        assert.match(out.text, /Not signed in\. In a terminal on .+, run: node \S*questrade-mcp\.js login/);

        process.env.QUESTRADE_LOGIN_URL = fake.loginUrl; // runLogin/runCheck build their own TokenManager
        out = sink();
        const err = sink();
        assert.equal(await runLogin({ env, input: piped('seed-refresh-token-0001\n'), out, err }), 0);
        assert.match(out.text, /Signed in\. Questrade shows 1 account\(s\): TFSA Individual/);
        assert.ok(!/token-000/.test(out.text + err.text), 'no token values in the output');
        assert.equal(readCredentials(file).values.QUESTRADE_REFRESH_TOKEN, 'refresh-token-0001');

        await assert.rejects(runLogin({ env, input: piped('seed-refresh-token-0001\n'), out: sink(), err: sink() }), /already used/);

        out = sink();
        assert.equal(await runCheck({ env, out }), 0);
        assert.match(out.text, /Refresh token: set\. Access token: valid until .*\nQuestrade: OK, 1 account/);
        assert.ok(!/token-000/.test(out.text));

        fs.appendFileSync(file, 'OTHER=keep\n');
        assert.equal(runLogout({ env, out: sink() }), 0);
        assert.deepEqual(Object.keys(readCredentials(file).values), ['QUESTRADE_API_SERVER', 'OTHER']);
    } finally {
        delete process.env.QUESTRADE_LOGIN_URL;
        await fake.close();
    }
});

test('pi package: the extension registers the server and a sign-in notice', () => {
    const calls = [];
    const handlers = [];
    questradeExtension({ registerMcpServer: (name, config) => calls.push([name, config]), on: (event, fn) => handlers.push([event, fn]) });
    assert.equal(calls.length, 1);
    const [name, config] = calls[0];
    assert.equal(name, 'questrade');
    assert.match(config.args[0], /\/bin\/questrade-mcp\.js$/);
    assert.equal(config.exposure, 'codemode');
    assert.match(config.description, /skill questrade-portfolio.*questrade-mcp\.js login/);
    assert.deepEqual(handlers.map(([e]) => e), ['session_start']);
    assert.equal(nodeCommand('/opt/node/bin/node'), '/opt/node/bin/node');
    assert.equal(nodeCommand('/usr/local/bin/pi'), 'node');

    const file = tmpFile();
    assert.match(signInNotice({ QUESTRADE_TOKEN_FILE: file }), /not signed in on .+ run: node \S*questrade-mcp\.js login/);
    writeCredentials(file, { QUESTRADE_REFRESH_TOKEN: 'x' });
    assert.equal(signInNotice({ QUESTRADE_TOKEN_FILE: file }), undefined);

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.deepEqual(pkg.pi, { extensions: ['./extensions/questrade.js'], skills: ['./skills'] });
    assert.ok(pkg.keywords.includes('pi-package'));
    for (const dir of ['bin', 'extensions', 'skills', 'src']) assert.ok(pkg.files.includes(dir), dir);
    const skill = fs.readFileSync(path.join(ROOT, 'skills/questrade-portfolio/SKILL.md'), 'utf8');
    assert.match(skill, /^---\nname: questrade-portfolio\ndescription: .{50,1024}\n---\n/);
});

test('MCP server over stdio: read-only tools, instructions, sign-in error, then data', async () => {
    const fake = await startFakeQuestrade();
    const file = tmpFile();
    const connect = async () => {
        const client = new Client({ name: 'test', version: '1' });
        await client.connect(new StdioClientTransport({
            command: process.execPath,
            args: [path.join(ROOT, 'bin/questrade-mcp.js')],
            env: { PATH: process.env.PATH, HOME: os.homedir(), QUESTRADE_TOKEN_FILE: file, QUESTRADE_LOGIN_URL: fake.loginUrl },
            stderr: 'ignore',
        }));
        return client;
    };
    const client = await connect();
    try {
        const { tools } = await client.listTools();
        assert.equal(tools.length, 11);
        assert.ok(tools.every((t) => t.name.startsWith('qt_') && t.annotations?.readOnlyHint === true));
        assert.match(client.getInstructions(), /Read-only.*questrade-mcp\.js login/);
        const denied = await client.callTool({ name: 'qt_get_accounts', arguments: {} });
        assert.equal(denied.isError, true);
        assert.match(denied.content[0].text, /No Questrade refresh token is configured.*questrade-mcp\.js login/);

        writeCredentials(file, { QUESTRADE_REFRESH_TOKEN: 'seed-refresh-token-0001' }); // the user ran login meanwhile
        const ok = await client.callTool({ name: 'qt_get_accounts', arguments: {} });
        assert.equal(ok.isError, undefined);
        assert.equal(JSON.parse(ok.content[0].text).accounts[0].type, 'TFSA');
    } finally {
        await client.close();
        await fake.close();
    }
});
