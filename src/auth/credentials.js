import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * The credentials file (KEY=value lines, mode 600) is the one source of truth
 * shared by every copy of the server on the machine: several agent sessions
 * each run their own process. Writes are atomic (temp file, fsync, rename)
 * and keep keys this module does not manage.
 */
export function credentialsFile(env = process.env) {
    return env.QUESTRADE_TOKEN_FILE || path.join(os.homedir(), '.config', 'questrade-mcp', 'credentials.env');
}

export function readCredentials(file) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return { exists: false, values: {}, text: '' };
        throw error;
    }
    const values = {};
    for (const raw of text.split(/\r?\n/)) {
        const match = raw.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!match) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        values[match[1]] = value;
    }
    return { exists: true, values, text };
}

export function writeCredentials(file, updates) {
    for (const value of Object.values(updates)) {
        if (typeof value === 'string' && /[\r\n]/.test(value)) throw new Error('Credential values cannot contain newlines.');
    }
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const current = readCredentials(file);
    const pending = new Map(Object.entries(updates));
    const lines = [];
    for (const raw of current.text.split(/\r?\n/)) {
        const key = raw.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
        if (key && pending.has(key)) {
            const value = pending.get(key);
            pending.delete(key);
            if (value) lines.push(`${key}=${value}`);
        } else if (raw !== '' || lines.length) lines.push(raw);
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const [key, value] of pending) if (value) lines.push(`${key}=${value}`);
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    const fd = fs.openSync(temp, 'w', 0o600);
    try {
        fs.writeFileSync(fd, `${lines.join('\n')}\n`, 'utf8');
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cross-process lock (an O_EXCL lock file next to the credentials). Held
 * while a refresh token is exchanged, so only one process ever spends it.
 * A lock older than staleMs (its holder died) is broken.
 */
export async function withFileLock(lockPath, fn, { timeoutMs = 30_000, staleMs = 60_000, pollMs = 50 } = {}) {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + timeoutMs;
    let fd;
    for (;;) {
        try {
            fd = fs.openSync(lockPath, 'wx', 0o600);
            fs.writeSync(fd, `${process.pid}\n`);
            break;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            try {
                if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) {
                    fs.rmSync(lockPath, { force: true });
                    continue;
                }
            } catch {
                continue; // released between open and stat
            }
            if (Date.now() > deadline) throw new Error(`Timed out waiting for the credentials lock ${lockPath}`);
            await sleep(pollMs);
        }
    }
    try {
        return await fn();
    } finally {
        fs.closeSync(fd);
        fs.rmSync(lockPath, { force: true });
    }
}
