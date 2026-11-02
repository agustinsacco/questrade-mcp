import http from 'http';

/**
 * Minimal stand-in for Questrade's login and API servers, with the behaviour
 * that matters for token handling: a refresh token works once, and issuing a
 * new access token invalidates the previous one.
 */
export async function startFakeQuestrade({ expiresIn = 1800, refreshToken = 'r0' } = {}) {
    const state = { refreshToken, accessToken: null, issued: 0, rejectedRefreshes: 0 };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const send = (status, body) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(body));
        };
        if (req.method === 'POST' && url.pathname === '/oauth2/token') {
            if (url.searchParams.get('refresh_token') !== state.refreshToken) {
                state.rejectedRefreshes++;
                return send(400, { error: 'invalid_grant' });
            }
            state.issued++;
            state.refreshToken = `r${state.issued}`;
            state.accessToken = `a${state.issued}`;
            return send(200, {
                access_token: state.accessToken,
                refresh_token: state.refreshToken,
                api_server: `${origin}/`,
                expires_in: expiresIn,
                token_type: 'Bearer'
            });
        }
        if (url.pathname === '/v1/time') {
            return req.headers.authorization === `Bearer ${state.accessToken}`
                ? send(200, { time: new Date().toISOString() })
                : send(401, { code: 1017, message: 'Access token is invalid' });
        }
        send(404, {});
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    return { origin, state, close: () => new Promise((resolve) => server.close(resolve)) };
}
