import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeQuestrade } from './fake-questrade.js';

const WORKER = fileURLToPath(new URL('./worker.js', import.meta.url));

function tempCredentials(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'questrade-mcp-test-'));
    const file = path.join(dir, 'credentials.env');
    fs.writeFileSync(file, content, { mode: 0o600 });
    return file;
}

function runWorker(env) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [WORKER], { env: { ...process.env, ...env } });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve(JSON.parse(stdout));
            else reject(new Error(`worker exited with ${code}: ${stderr}`));
        });
    });
}

test('concurrent processes share one token chain', async (t) => {
    // 121 s minus the 120 s safety margin: access tokens expire after ~1 s, forcing many refreshes.
    const fake = await startFakeQuestrade({ expiresIn: 121 });
    t.after(fake.close);
    const file = tempCredentials('QUESTRADE_REFRESH_TOKEN=r0\n');
    const env = { QUESTRADE_TOKEN_FILE: file, FAKE_ORIGIN: fake.origin, CALLS: '15', MAX_DELAY_MS: '250' };

    const results = await Promise.all(Array.from({ length: 5 }, () => runWorker(env)));

    assert.deepEqual(results.flatMap((r) => r.failed), []);
    assert.equal(fake.state.rejectedRefreshes, 0);
    assert.ok(fake.state.issued >= 2, `expected several refreshes, got ${fake.state.issued}`);
    assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`^QUESTRADE_REFRESH_TOKEN=${fake.state.refreshToken}$`, 'm'));
    assert.equal(fs.existsSync(`${file}.lock`), false);
});

test('a lock left behind by a dead process is taken over', async (t) => {
    const fake = await startFakeQuestrade();
    t.after(fake.close);
    const file = tempCredentials('QUESTRADE_REFRESH_TOKEN=r0\n');
    const deadPid = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString();
    fs.writeFileSync(`${file}.lock`, `${deadPid}\n`);

    const started = Date.now();
    const result = await runWorker({ QUESTRADE_TOKEN_FILE: file, FAKE_ORIGIN: fake.origin, CALLS: '1' });

    assert.equal(result.ok, 1);
    assert.ok(Date.now() - started < 10_000, 'took over the stale lock without waiting for the timeout');
    assert.equal(fs.existsSync(`${file}.lock`), false);
});

test('a rejected refresh token gives an actionable error', async (t) => {
    const fake = await startFakeQuestrade();
    t.after(fake.close);
    const file = tempCredentials('QUESTRADE_REFRESH_TOKEN=revoked-secret-token\n');

    const result = await runWorker({ QUESTRADE_TOKEN_FILE: file, FAKE_ORIGIN: fake.origin, CALLS: '1' });

    assert.equal(result.ok, 0);
    assert.match(result.failed[0], /rejected the stored refresh token \(HTTP 400\)/);
    assert.ok(!result.failed[0].includes('revoked-secret-token'));
    assert.equal(fake.state.rejectedRefreshes, 1);
});

test('re-reads the file once when the refresh token was replaced without the lock', async () => {
    const file = tempCredentials('QUESTRADE_REFRESH_TOKEN=r0\n');
    process.env.QUESTRADE_TOKEN_FILE = file;
    const { TokenManager } = await import('../src/auth/TokenManager.js');
    const tm = new TokenManager();
    const usedTokens = [];
    tm.refreshToken = async (refreshToken) => {
        usedTokens.push(refreshToken);
        if (usedTokens.length === 1) {
            // Something that does not take the lock redeemed r0 first and stored its replacement.
            fs.writeFileSync(file, 'QUESTRADE_REFRESH_TOKEN=r1\n');
            throw Object.assign(new Error('rejected'), { status: 400 });
        }
        return { access_token: 'a2', refresh_token: 'r2', api_server: 'https://example.invalid/', expires_in: 1800 };
    };

    const tokens = await tm.getValidToken();

    assert.deepEqual(usedTokens, ['r0', 'r1']);
    assert.equal(tokens.access_token, 'a2');
    assert.match(fs.readFileSync(file, 'utf8'), /^QUESTRADE_REFRESH_TOKEN=r2$/m);
});
