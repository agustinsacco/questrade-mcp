// Child process for the cross-process test: get a valid token, print it.
import { TokenManager } from '../../src/auth/TokenManager.js';

const [file, loginUrl] = process.argv.slice(2);
const tokens = await new TokenManager(undefined, { file, loginUrl }).getValidToken();
process.stdout.write(tokens.access_token);
