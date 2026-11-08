import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatQt, offsetMinutes, parseBound, resolveRange, windows } from '../src/questrade/time.js';
import { paginateArray, toText, windowRows } from '../src/format.js';
import { loadConfig } from '../src/config.js';
import { redact } from '../src/log.js';
import { fromResponse } from '../src/questrade/errors.js';
import questradeExtension, { nodeCommand, signInNotice } from '../extensions/questrade.js';
import { detect, runSetupCli } from '../src/setup-cli.js';
import { guideMarkdown } from '../src/server.js';

const ROOT = new URL('..', import.meta.url).pathname;
const DAY = 86_400_000;

test('time: plain dates are Toronto days, with the right offset on each side of DST', () => {
  assert.equal(formatQt(parseBound('2026-01-15')), '2026-01-15T00:00:00-05:00');
  assert.equal(formatQt(parseBound('2026-07-15', { end: true })), '2026-07-15T23:59:59-04:00');
  assert.equal(formatQt(parseBound('2026-03-08')), '2026-03-08T00:00:00-05:00', 'DST starts at 2am that day');
  assert.equal(formatQt(parseBound('2026-03-09')), '2026-03-09T00:00:00-04:00');
  assert.equal(offsetMinutes(Date.parse('2026-11-08T12:00:00Z')), -300);
  assert.equal(parseBound('2026-01-02T09:30:00-05:00'), Date.parse('2026-01-02T14:30:00Z'));
  assert.throws(() => parseBound('2026-02-30'), /not a real calendar date/);
  assert.throws(() => parseBound('2026-01-02T09:30:00'), /with an offset/);
});

test('time: ranges default to the last 30 days, refuse inversions and caps, and split without overlap', () => {
  const now = Date.parse('2026-11-08T17:00:00Z');
  const r = resolveRange({}, { now });
  assert.equal(r.end - r.start, 30 * DAY);
  assert.throws(() => resolveRange({ startDate: '2026-02-01', endDate: '2026-01-01' }), /after endDate/);
  assert.throws(() => resolveRange({ startDate: '2000-01-01', endDate: '2026-01-01' }, { maxDays: 3660 }), /more than 3660 days/);
  const w = windows(parseBound('2026-01-01'), parseBound('2026-12-31', { end: true }));
  assert.equal(w.length, 13);
  for (let i = 0; i < w.length; i++) {
    assert.ok(w[i][1] - w[i][0] <= 30 * DAY);
    if (i) assert.equal(w[i][0] - w[i - 1][1], 1000, 'back to back, one second apart');
  }
  assert.equal(w.at(-1)[1], parseBound('2026-12-31', { end: true }));
});

test('format: paging envelopes and the response budget', () => {
  assert.deepEqual(paginateArray([1, 2, 3], { page: 2, pageSize: 2 }), { items: [3], page: 2, pageSize: 2, totalCount: 3, totalPages: 2, hasMore: false });
  assert.equal(windowRows([1, 2, 3], { offset: 0, limit: 2 }).nextOffset, 2);
  const big = { items: Array.from({ length: 200 }, (_, i) => ({ i, pad: 'x'.repeat(100) })) };
  const text = toText(big, 4000);
  assert.ok(text.length <= 4000);
  assert.match(JSON.parse(text).truncated.reason, /smaller pageSize/);
  assert.match(JSON.parse(toText({ blob: 'y'.repeat(9000) }, 4000)).reason, /narrow the request/);
});

test('config, errors and logs', () => {
  assert.throws(() => loadConfig({ QUESTRADE_MCP_TOOLSETS: 'context,trading' }), /Unknown QUESTRADE_MCP_TOOLSETS value\(s\): trading/);
  assert.equal(loadConfig({ QUESTRADE_TOKEN_FILE: '/x/legacy.env' }).credentialsFile, '/x/legacy.env', '1.x variable still works');
  assert.equal(loadConfig({ QUESTRADE_CREDENTIALS_FILE: '/x/new.env', QUESTRADE_TOKEN_FILE: '/x/legacy.env' }).credentialsFile, '/x/new.env');
  const e = fromResponse(400, { code: 1003, message: 'Argument length exceeds imposed limit' }, 'GET /v1/accounts/1/activities');
  assert.match(e.message, /Argument length exceeds imposed limit \[1003\]\. The request is too large/);
  assert.equal(fromResponse(429, {}, 'GET /x').retryable, true);
  assert.equal(redact('Authorization: Bearer abcdefghijkl refresh_token=zzzzzzzzzzzz'), 'Authorization: Bearer [redacted] refresh_token=[redacted]');
});

test('pi package: the extension registers the server and a sign-in notice; manifest and skill', () => {
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
  assert.equal(nodeCommand('/usr/local/bin/pi'), 'node', 'a compiled pi binary is not Node');
  assert.match(signInNotice({ QUESTRADE_CREDENTIALS_FILE: '/nonexistent/credentials.env' }), /not signed in on .+ run: node \S*questrade-mcp\.js login/);

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.pi, { extensions: ['./extensions/questrade.js'], skills: ['./skills'] });
  assert.ok(pkg.keywords.includes('pi-package'));
  for (const dir of ['bin', 'extensions', 'skills', 'src']) assert.ok(pkg.files.includes(dir), dir);
  const skill = fs.readFileSync(path.join(ROOT, 'skills/questrade-portfolio/SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: questrade-portfolio\ndescription: .{50,1024}\n---\n/);
  const guide = guideMarkdown();
  assert.ok(!guide.includes('<package>') && !guide.startsWith('---'));
});

test('setup: detects existing pi/Claude setups and changes nothing without --yes', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'questrade-setup-'));
  const env = { PATH: '/nonexistent', HOME: home };
  assert.deepEqual([detect({ env, home }).pi.installed, detect({ env, home }).claude.installed], [false, false]);
  fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
  fs.writeFileSync(path.join(home, '.pi', 'agent', 'settings.json'), JSON.stringify({ packages: ['git:github.com/someone/questrade-mcp@v2'] }));
  assert.deepEqual([detect({ env, home }).pi.server, detect({ env, home }).pi.skill], ['package', 'package']);
  let text = '';
  const out = { write: (s) => (text += s) };
  const code = await runSetupCli({ env, home, out, err: out, input: { isTTY: false }, login: false });
  assert.equal(code, 0);
  assert.match(text, /pi not found; skipped[\s\S]*claude not found; skipped[\s\S]*"questrade"[\s\S]*questrade:\/\/guide[\s\S]*questrade-mcp\.js login/);
  assert.deepEqual(fs.readdirSync(home).sort(), ['.pi']);
});
