import { TokenManager } from './auth/TokenManager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storageDir = path.join(__dirname, '../data');

async function check() {
    console.log('--- Questrade Auth Sanity Check ---');
    const tm = new TokenManager(storageDir);

    try {
        const tokens = tm.loadTokens();
        if (!tokens) {
            console.error('❌ Failed to load tokens. file might be missing or corrupted.');
            process.exit(1);
        }

        console.log('✅ Tokens loaded successfully.');
        console.log('   API Server:', tokens.api_server);

        const needsRefresh = tm.needsRefresh(tokens);
        if (needsRefresh) {
            console.log('🔄 Token needs refresh. attempting proactive refresh...');
            const newTokens = await tm.getValidToken();
            console.log('✅ Refresh successful. New server:', newTokens.api_server);
        } else {
            const minutesLeft = Math.floor((tokens.expiry_timestamp - Date.now()) / 60000);
            console.log(`✅ Token is still valid for ${minutesLeft} minutes.`);
        }

        console.log('--- Auth Check PASSED ---');
    } catch (e) {
        console.error('❌ Auth Check FAILED:', e.message);
        process.exit(1);
    }
}

check();
