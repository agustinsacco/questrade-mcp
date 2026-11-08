import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { loadConfig } from '../src/config.js';
import { QuestradeContext } from '../src/context.js';
import { serveHttp } from '../src/http.js';
import { writeCredentialFile } from '../src/auth/credentials.js';
import { startFakeQuestrade } from './helpers/fake-questrade.js';
import { silentLogger, tempCredentials } from './helpers/harness.js';

const BIN = new URL('../bin/questrade-mcp.js', import.meta.url).pathname;

test('stdio: the real binary handshakes, lists tools and picks up a login made while it runs', async (t) => {
  const fake = await startFakeQuestrade();
  const { file } = tempCredentials(null);
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [BIN],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, QUESTRADE_CREDENTIALS_FILE: file, QUESTRADE_LOGIN_URL: fake.loginUrl, QUESTRADE_MCP_LOG_LEVEL: 'silent' },
    }),
  );
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  assert.equal(client.getServerVersion().name, 'questrade-mcp');
  assert.match(client.getInstructions(), /qt_get_context/);
  assert.equal((await client.listTools()).tools.length, 19);
  const before = await client.callTool({ name: 'qt_get_context', arguments: {} });
  assert.equal(JSON.parse(before.content[0].text).auth.mode, 'none');
  writeCredentialFile(file, { QUESTRADE_REFRESH_TOKEN: 'seed-refresh-token-0001' });
  const after = await client.callTool({ name: 'qt_list_accounts', arguments: {} });
  assert.deepEqual(JSON.parse(after.content[0].text).items.map((a) => a.number), ['11111111', '22222222']);
});

async function httpServer(t, values, env = {}) {
  const fake = await startFakeQuestrade();
  const { file } = tempCredentials(values === undefined ? { QUESTRADE_REFRESH_TOKEN: fake.issueRefreshToken() } : values);
  const config = loadConfig({ QUESTRADE_CREDENTIALS_FILE: file, QUESTRADE_LOGIN_URL: fake.loginUrl, QUESTRADE_MCP_HTTP_PORT: '0', ...env });
  const ctx = new QuestradeContext({ config, env: {}, logger: silentLogger });
  const handle = await serveHttp(ctx, { port: 0 });
  t.after(async () => {
    await handle.close();
    await fake.close();
  });
  return { url: `http://127.0.0.1:${handle.port}`, ctx };
}

test('http: loopback by default, healthz, and a working MCP session', async (t) => {
  const { url } = await httpServer(t);
  const health = await (await fetch(`${url}/healthz`)).json();
  assert.equal(health.name, 'questrade-mcp');
  const client = new Client({ name: 'http-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
  t.after(() => client.close());
  const r = await client.callTool({ name: 'qt_list_accounts', arguments: {} });
  assert.equal(JSON.parse(r.content[0].text).totalCount, 2);
});

test('http: refuses a public bind without a token, and requires the bearer token when set', async (t) => {
  const fake = await startFakeQuestrade();
  t.after(() => fake.close());
  const { file } = tempCredentials(null);
  const ctx = new QuestradeContext({ config: loadConfig({ QUESTRADE_CREDENTIALS_FILE: file }), env: {}, logger: silentLogger });
  await assert.rejects(serveHttp(ctx, { host: '0.0.0.0', port: 0 }), /Refusing to listen on 0\.0\.0\.0 without QUESTRADE_MCP_HTTP_TOKEN/);

  const { url } = await httpServer(t, { QUESTRADE_REFRESH_TOKEN: 'seed-refresh-token-0001', QUESTRADE_MCP_HTTP_TOKEN: 'test-http-token-123' });
  const denied = await fetch(`${url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
  assert.equal(denied.status, 401);
  const client = new Client({ name: 'http-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: 'Bearer test-http-token-123' } } }));
  t.after(() => client.close());
  assert.equal((await client.listTools()).tools.length, 19);
});
