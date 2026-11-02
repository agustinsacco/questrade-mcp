// One "MCP server process": makes API calls through QuestradeClient against the fake server.
import axios from 'axios';
import { TokenManager } from '../src/auth/TokenManager.js';
import { QuestradeClient } from '../src/api/QuestradeClient.js';

const realPost = axios.post.bind(axios);
axios.post = (url, data, config) => realPost(url.replace('https://login.questrade.com', process.env.FAKE_ORIGIN), data, config);

const client = new QuestradeClient(new TokenManager());
const result = { ok: 0, failed: [] };
for (let i = 0; i < Number(process.env.CALLS); i++) {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * Number(process.env.MAX_DELAY_MS || 0)));
    try {
        await client.client.get('/v1/time');
        result.ok++;
    } catch (error) {
        result.failed.push(error.message);
    }
}
process.stdout.write(JSON.stringify(result));
