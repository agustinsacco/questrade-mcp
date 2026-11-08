import * as z from 'zod';
import { paginateArray, shape } from '../format.js';
import { READ, defineTool, page, pageSize } from './common.js';
import { LIMITATIONS } from '../limitations.js';

const account = (a) => shape({ number: a.number, type: a.type, clientAccountType: a.clientAccountType, status: a.status, isPrimary: a.isPrimary, isBilling: a.isBilling });

export function registerContextTools(server, ctx) {
  defineTool(server, ctx, {
    name: 'qt_get_context',
    title: 'Get Questrade connection context',
    toolset: 'context',
    annotations: READ,
    description:
      'Start here. Returns how credentials are configured (and the exact sign-in command when they are missing), the accounts this login reaches, which one is the default, Questrade\'s server time and what the API cannot do. Works without credentials and then explains how to sign in.',
    handler: async () => {
      const auth = ctx.tokens.describe();
      const out = { server: { readOnly: true, toolsets: ctx.config.toolsets }, auth, limitations: LIMITATIONS.summary };
      if (auth.mode === 'none') return { ...out, setup: ctx.tokens.setupHint() };
      const [{ accounts, userId }, time] = await Promise.all([ctx.listAccounts(), ctx.client.get('/v1/time')]);
      out.userId = userId;
      out.serverTime = time.time;
      out.accounts = accounts.map(account);
      try {
        out.defaultAccountId = await ctx.resolveAccountId();
      } catch (error) {
        out.defaultAccountId = null;
        out.defaultAccountNote = error.message;
      }
      return out;
    },
  });

  defineTool(server, ctx, {
    name: 'qt_list_accounts',
    title: 'List accounts',
    toolset: 'context',
    annotations: READ,
    description: 'List the Questrade accounts this login reaches: number (the accountId other tools take), type (TFSA, RRSP, FHSA, Margin, Cash…), client type and status.',
    input: z.object({
      status: z.enum(['Active', 'all']).default('all').describe('Active only, or every account'),
      page,
      pageSize: pageSize(50, 20),
    }),
    handler: async ({ status, page: p, pageSize: size }) => {
      const { accounts } = await ctx.listAccounts();
      const rows = accounts.filter((a) => status === 'all' || a.status === status).map(account);
      return paginateArray(rows, { page: p, pageSize: size });
    },
  });
}
