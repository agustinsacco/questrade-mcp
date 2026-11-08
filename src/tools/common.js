import * as z from 'zod';
import { toText } from '../format.js';
import { QuestradeError } from '../questrade/errors.js';

// ------------------------------------------------------------ shared argument schemas

export const accountId = z
  .string()
  .regex(/^\d+$/, 'An account number, e.g. 26598145')
  .optional()
  .describe('Account number from qt_get_context or qt_list_accounts; defaults to QUESTRADE_ACCOUNT_ID or the only account');

export const page = z.number().int().min(1).default(1).describe('1-based; use nextPage');
export const pageSize = (max = 100, dflt = 20) =>
  z.number().int().min(1).max(max).default(dflt).describe(`Items per page (max ${max})`);

export const detail = z
  .enum(['summary', 'full'])
  .default('summary')
  .describe('summary: key fields, long text clipped. full: every field Questrade returns');

const dateOrTime = (what) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2}))?$/, 'Use YYYY-MM-DD or an ISO date-time with an offset')
    .describe(`${what}: YYYY-MM-DD (a Toronto day) or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00`);
export const startDate = dateOrTime('Start');
export const endDate = dateOrTime('End (inclusive)');

/** A symbol: numeric symbolId, or the exact ticker ("XEQT.TO", "AAPL"). */
export const symbolRef = z
  .union([z.number().int().positive(), z.string().min(1).max(30)])
  .describe('symbolId (number) or exact ticker, e.g. "XEQT.TO" (TSX) or "AAPL" (US)');
export const symbolRefs = (max) => z.array(symbolRef).min(1).max(max).describe(`symbolIds or exact tickers (1–${max})`);

export const INTERVALS = [
  'OneMinute',
  'TwoMinutes',
  'ThreeMinutes',
  'FourMinutes',
  'FiveMinutes',
  'TenMinutes',
  'FifteenMinutes',
  'TwentyMinutes',
  'HalfHour',
  'OneHour',
  'TwoHours',
  'FourHours',
  'OneDay',
  'OneWeek',
  'OneMonth',
  'OneYear',
];
export const interval = z.enum(INTERVALS).default('OneDay').describe('Candle size; Questrade returns at most 2000 candles per request');

// ------------------------------------------------------------ annotations

/** Every tool only reads; openWorldHint because results come from Questrade's live systems. */
export const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

// ------------------------------------------------------------ registration

/**
 * Register one tool, honouring toolsets. The handler returns a plain object;
 * it is serialized here under the response budget, and any thrown error
 * becomes an isError result carrying an actionable message.
 */
export function defineTool(server, ctx, { name, title, description, toolset, annotations, input, handler }) {
  if (!ctx.config.toolsets.includes(toolset)) return false;
  server.registerTool(
    name,
    {
      title,
      description,
      annotations: { title, ...annotations },
      ...(input ? { inputSchema: input } : {}),
    },
    async (args) => {
      const started = Date.now();
      try {
        const result = await handler(args ?? {});
        ctx.logger.debug(`${name} ok in ${Date.now() - started} ms`);
        return { content: [{ type: 'text', text: toText(result, ctx.config.maxResponseChars) }] };
      } catch (error) {
        const message = error instanceof QuestradeError ? error.message : `Unexpected error in ${name}: ${error?.message || error}`;
        if (!(error instanceof QuestradeError)) ctx.logger.error(`${name}: ${error?.stack || error}`);
        else ctx.logger.debug(`${name} failed: ${error.code}`);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );
  return true;
}

/** Strip keys whose value is undefined, so optional args are truly omitted. */
export function defined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/** Case-insensitive "contains" over several fields. */
export function matches(text, ...fields) {
  if (!text) return true;
  const needle = text.toLowerCase();
  return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(needle));
}
