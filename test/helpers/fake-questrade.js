import http from 'http';

/**
 * A stand-in for Questrade's login server and API. Like the real one, each
 * refresh token can be exchanged once, and only the latest access token is
 * accepted.
 */
export async function startFakeQuestrade({ initialRefreshToken = 'seed-refresh-token-0001' } = {}) {
    const state = { exchanges: 0, validRefresh: new Set([initialRefreshToken]), accessToken: null, n: 0 };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const send = (status, body) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(body));
        };
        if (req.method === 'POST' && url.pathname === '/oauth2/token') {
            const token = url.searchParams.get('refresh_token');
            if (url.searchParams.get('grant_type') !== 'refresh_token' || !state.validRefresh.delete(token)) return send(400, { error: 'invalid_grant' });
            state.exchanges += 1;
            state.n += 1;
            const refresh = `refresh-token-${String(state.n).padStart(4, '0')}`;
            state.validRefresh.add(refresh);
            state.accessToken = `access-token-${String(state.n).padStart(4, '0')}`;
            return send(200, { access_token: state.accessToken, refresh_token: refresh, api_server: `${state.base}/`, expires_in: 1800, token_type: 'Bearer' });
        }
        if (req.headers.authorization !== `Bearer ${state.accessToken}` || !state.accessToken) return send(401, { code: 1017, message: 'Access token is invalid' });
        if (url.pathname === '/v1/accounts') {
            return send(200, { accounts: [{ type: 'TFSA', number: '12345678', status: 'Active', isPrimary: true, clientAccountType: 'Individual' }], userId: 1 });
        }
        return send(404, { code: 1001, message: 'Not found' });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    state.base = `http://127.0.0.1:${server.address().port}`;
    return {
        state,
        loginUrl: `${state.base}/oauth2/token`,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}
