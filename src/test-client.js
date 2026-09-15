import { TokenManager } from "./auth/TokenManager.js";
import { QuestradeClient } from "./api/QuestradeClient.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storageDir = path.join(__dirname, "../data");

const tokenManager = new TokenManager(storageDir);
const client = new QuestradeClient(tokenManager);

async function test() {
    try {
        console.log("Fetching accounts...");
        const accounts = await client.getAccounts();
        console.log("Accounts found:", JSON.stringify(accounts, null, 2));
    } catch (error) {
        console.error("Test failed:", error.message);
    }
}

test();
