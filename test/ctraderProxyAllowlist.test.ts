import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));

import { BROWSER_PROXY_PAYLOAD_TYPES, PT as SERVER_PT } from '../api/ctrader/trade';
import { PT as CLIENT_PT } from '../services/ctraderService';

// Official ProtoOA payload ids from OpenApiModelMessages.proto.
const READ_ONLY_PROXY_IDS: Record<string, number> = {
  ASSET_LIST_REQ: 2112,
  SYMBOL_BY_ID_REQ: 2116,
  SYMBOLS_FOR_CONVERSION_REQ: 2118,
  DEAL_LIST_REQ: 2133,
  GET_TICKDATA_REQ: 2145,
  ASSET_CLASS_LIST_REQ: 2153,
  SYMBOL_CATEGORY_REQ: 2160,
  MARGIN_CALL_LIST_REQ: 2167,
  ORDER_LIST_REQ: 2175,
  GET_DYNAMIC_LEVERAGE_REQ: 2177,
  DEAL_LIST_BY_POSITION_ID_REQ: 2179,
  ORDER_DETAILS_REQ: 2181,
  ORDER_LIST_BY_POSITION_ID_REQ: 2183,
  DEAL_OFFSET_LIST_REQ: 2185,
  GET_POSITION_UNREALIZED_PNL_REQ: 2187,
};

describe('cTrader browser proxy allowlist', () => {
  it('allows every payload type the client sends through authenticatedRequest', () => {
    const source = readFileSync(resolve(process.cwd(), 'services/ctraderService.ts'), 'utf8');
    const proxied = [
      ...new Set(
        [...source.matchAll(/authenticatedRequest\(\s*[^,]+,\s*PT\.([A-Z0-9_]+)/g)].map(match => match[1])
      ),
    ];

    expect(proxied.length).toBeGreaterThan(0);
    for (const name of proxied) {
      const clientValue = CLIENT_PT[name as keyof typeof CLIENT_PT];
      const serverValue = SERVER_PT[name as keyof typeof SERVER_PT];
      expect(clientValue, `client PT.${name}`).toBeDefined();
      expect(serverValue, `server PT.${name}`).toBe(clientValue);
      expect(BROWSER_PROXY_PAYLOAD_TYPES.has(clientValue), `proxy allowlist missing ${name}`).toBe(true);
    }
  });

  it('defines and allows official ids for read-only history and symbol lookups', () => {
    for (const [name, id] of Object.entries(READ_ONLY_PROXY_IDS)) {
      expect(CLIENT_PT[name as keyof typeof CLIENT_PT], `client PT.${name}`).toBe(id);
      expect(SERVER_PT[name as keyof typeof SERVER_PT], `server PT.${name}`).toBe(id);
      expect(BROWSER_PROXY_PAYLOAD_TYPES.has(id), `proxy allowlist missing ${name} (${id})`).toBe(true);
    }
  });

  it('never allows auth, token, or logout operations through the browser proxy', () => {
    // APPLICATION_AUTH_REQ, ACCOUNT_AUTH_REQ, ACCOUNT_LOGOUT_REQ,
    // REFRESH_TOKEN_REQ, GET_ACCOUNTS_BY_TOKEN_REQ
    for (const forbidden of [2100, 2102, 2162, 2173, 2149]) {
      expect(BROWSER_PROXY_PAYLOAD_TYPES.has(forbidden), `forbidden payload type ${forbidden}`).toBe(false);
    }
  });
});
