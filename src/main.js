import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TokenManager } from "./auth/TokenManager.js";
import { QuestradeClient } from "./api/QuestradeClient.js";
import { AccountTools } from "./tools/AccountTools.js";
import { MarketTools } from "./tools/MarketTools.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { HOST, cli } from "./cli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storageDir = path.join(__dirname, "../data");

const tokenManager = new TokenManager(storageDir);
const client = new QuestradeClient(tokenManager);
const accountTools = new AccountTools(client);
const marketTools = new MarketTools(client);

// Start background keep-alive
tokenManager.startKeepAlive();

const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));

const INSTRUCTIONS = [
    `Read-only Questrade brokerage data; no tool places, changes or cancels orders. If a tool says no token is configured or the token was rejected, the user signs in by running \`${cli("login")}\` in a terminal on ${HOST}; never ask for the token in the chat.`,
    "Start with qt_get_accounts and pass accountId to account tools when there are several accounts (they default to the first).",
    "Quotes, candles and technicals take numeric symbol IDs: get them from qt_lookup_symbol. Times are ISO 8601 with an offset, e.g. 2026-01-02T00:00:00-05:00. Candles: at most 2000 per request, so match the interval to the range.",
].join("\n");

const server = new Server({
    name: "questrade-mcp",
    version,
}, {
    capabilities: {
        tools: {},
    },
    instructions: INSTRUCTIONS,
});

// Every tool only reads; hosts use these hints to skip write confirmations.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({ ...tool, annotations: READ_ONLY })),
}));

const TOOLS = [
        {
            name: "qt_get_accounts",
            description: "Get all Questrade accounts",
            inputSchema: { type: "object", properties: {} }
        },
        {
            name: "qt_get_positions",
            description: "Get current positions for an account",
            inputSchema: {
                type: "object",
                properties: { accountId: { type: "string" } }
            }
        },
        {
            name: "qt_get_balances",
            description: "Get account balances",
            inputSchema: {
                type: "object",
                properties: { accountId: { type: "string" } }
            }
        },
        {
            name: "qt_get_quotes",
            description: "Get read-only real-time quotes for one or more symbol IDs.",
            inputSchema: {
                type: "object",
                properties: { symbolIds: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 50 } },
                required: ["symbolIds"]
            }
        },
        {
            name: "qt_get_orders",
            description: "Get read-only orders for an account, optionally filtered by state and date range.",
            inputSchema: {
                type: "object",
                properties: {
                    accountId: { type: "string" },
                    stateFilter: { type: "string", enum: ["All", "Open", "Closed"] },
                    startTime: { type: "string" },
                    endTime: { type: "string" }
                }
            }
        },
        {
            name: "qt_lookup_symbol",
            description: "Search for a stock symbol ID",
            inputSchema: {
                type: "object",
                properties: { prefix: { type: "string" } },
                required: ["prefix"]
            }
        },
        {
            name: "qt_get_candles",
            description: "Get historical candle data with ASCII chart",
            inputSchema: {
                type: "object",
                properties: {
                    symbolId: { type: "number" },
                    startTime: { type: "string" },
                    endTime: { type: "string" },
                    interval: { type: "string", enum: ["OneMinute", "FiveMinutes", "FifteenMinutes", "HalfHour", "OneHour", "OneDay", "OneWeek", "OneMonth"] }
                },
                required: ["symbolId", "startTime", "endTime"]
            }
        },
        {
            name: "qt_get_transactions",
            description: "Get historical transactions/activities for an account",
            inputSchema: {
                type: "object",
                properties: {
                    accountId: { type: "string" },
                    startTime: { type: "string" },
                    endTime: { type: "string" }
                },
                required: ["startTime", "endTime"]
            }
        },
        {
            name: "qt_compare_symbols",
            description: "Compare performance of multiple symbols with normalized chart",
            inputSchema: {
                type: "object",
                properties: {
                    symbolIds: { type: "array", items: { type: "number" } },
                    startTime: { type: "string" },
                    endTime: { type: "string" },
                    interval: { type: "string", enum: ["OneMinute", "FiveMinutes", "FifteenMinutes", "HalfHour", "OneHour", "OneDay", "OneWeek", "OneMonth"] }
                },
                required: ["symbolIds", "startTime", "endTime"]
            }
        },
        {
            name: "qt_analyze_technicals",
            description: "Calculate technical indicators (RSI, SMAs, VWAP, Bollinger Bands) for a given symbol over a timeframe.",
            inputSchema: {
                type: "object",
                properties: {
                    symbolId: { type: "number" },
                    startTime: { type: "string" },
                    endTime: { type: "string" },
                    interval: { type: "string", enum: ["OneMinute", "FiveMinutes", "FifteenMinutes", "HalfHour", "OneHour", "OneDay", "OneWeek", "OneMonth"] }
                },
                required: ["symbolId", "startTime", "endTime"]
            }
        },
        {
            name: "qt_screen_watchlist",
            description: "Screen a list of symbols against technical criteria (e.g. maxRsi, mustBeAbove200Sma).",
            inputSchema: {
                type: "object",
                properties: {
                    symbolIds: { type: "array", items: { type: "number" } },
                    startTime: { type: "string" },
                    endTime: { type: "string" },
                    interval: { type: "string", enum: ["OneMinute", "FiveMinutes", "FifteenMinutes", "HalfHour", "OneHour", "OneDay", "OneWeek", "OneMonth"] },
                    criteria: {
                        type: "object",
                        properties: {
                            maxRsi: { type: "number" },
                            minRsi: { type: "number" },
                            mustBeAbove200Sma: { type: "boolean" },
                            mustBePiercingLowerBB: { type: "boolean" },
                            mustBeBelowVwap: { type: "boolean" }
                        }
                    }
                },
                required: ["symbolIds", "startTime", "endTime"]
            }
        },
];

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        const { name, arguments: args } = request.params;
        let result;

        switch (name) {
            case "qt_get_accounts": result = await accountTools.getAccounts(); break;
            case "qt_get_positions": result = await accountTools.getPositions(args); break;
            case "qt_get_balances": result = await accountTools.getBalances(args); break;
            case "qt_get_orders": result = await accountTools.getOrders(args); break;
            case "qt_get_transactions": result = await accountTools.getTransactions(args); break;
            case "qt_get_quotes": result = await marketTools.getQuotes(args); break;
            case "qt_lookup_symbol": result = await marketTools.lookupSymbol(args); break;
            case "qt_get_candles": result = await marketTools.getCandles(args); break;
            case "qt_compare_symbols": result = await marketTools.compareSymbols(args); break;
            case "qt_analyze_technicals": result = await marketTools.analyzeTechnicals(args); break;
            case "qt_screen_watchlist": result = await marketTools.screenWatchlist(args); break;
            default: throw new Error(`Unknown tool: ${name}`);
        }

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
        // Questrade explains rejections in the body ({ code, message }).
        const detail = error.response?.data?.message;
        return {
            content: [{ type: "text", text: `Error: ${error.message}${detail ? `: ${detail}` : ""}` }],
            isError: true
        };
    }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Questrade MCP server running...");
