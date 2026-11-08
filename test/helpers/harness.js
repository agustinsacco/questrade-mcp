import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { loadConfig } from '../../src/config.js';
import { QuestradeContext } from '../../src/context.js';
import { createServer } from '../../src/server.js';
import { writeCredentialFile } from '../../src/auth/credentials.js';

export const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

export function tempCredentials(values = { QUESTRADE_REFRESH_TOKEN: 'seed-refresh-token-0001' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'questrade-mcp-test-'));
  const file = path.join(dir, 'credentials.env');
  if (values) writeCredentialFile(file, values);
  return { dir, file };
}

/**
 * Connect a real MCP client to a real server instance over the in-process
 * Streamable HTTP handler, backed by the fake Questrade.
 */
export async function connect(fake, { env = {}, credentials } = {}) {
  const { file } = credentials || tempCredentials({ QUESTRADE_REFRESH_TOKEN: fake ? fake.issueRefreshToken() : 'seed-refresh-token-0001' });
  const config = loadConfig({ QUESTRADE_CREDENTIALS_FILE: file, QUESTRADE_LOGIN_URL: fake?.loginUrl, QUESTRADE_MCP_MAX_RETRIES: '1', ...env });
  const ctx = new QuestradeContext({ config, env: {}, logger: silentLogger });
  const handler = createMcpHandler(() => createServer(ctx));
  const transport = new StreamableHTTPClientTransport(new URL('http://questrade.test/mcp'), { fetch: (url, init) => handler.fetch(new Request(url, init)) });
  const client = new Client({ name: 'questrade-mcp-tests', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.[0]?.text ?? '';
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { isError: Boolean(result.isError), text, json };
  };
  return {
    client,
    ctx,
    file,
    call,
    close: async () => {
      await client.close();
      await handler.close();
    },
  };
}
