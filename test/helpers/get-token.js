// Child process for the cross-process test: get a valid token, print it.
import { loadConfig } from '../../src/config.js';
import { TokenProvider } from '../../src/auth/tokens.js';

const [file, loginUrl] = process.argv.slice(2);
const config = loadConfig({ QUESTRADE_CREDENTIALS_FILE: file, QUESTRADE_LOGIN_URL: loginUrl });
const { accessToken } = await new TokenProvider(config).getAccess();
process.stdout.write(accessToken);
