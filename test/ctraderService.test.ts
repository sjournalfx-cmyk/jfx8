import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'mock_session_jwt', user: { id: 'user-1' } } },
      }),
    },
  },
}));

import * as ctraderService from '../services/ctraderService';

vi.stubEnv('VITE_CTRADER_CLIENT_ID', 'test_client_id');

class MockWebSocket {
  url: string;
  readyState: number = 0; // CONNECTING
  binaryType: string = 'blob';
  close = vi.fn();

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: any) => void) | null = null;

  static mockResponses: Record<number, any> = {};
  static onSendCallback: ((msgStr: string, ws: MockWebSocket) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.lastInstance = this;
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 2);
  }

  send(msgStr: string) {
    const msg = JSON.parse(msgStr);
    const payloadType = msg.payloadType;
    const clientMsgId = msg.clientMsgId;

    if (MockWebSocket.onSendCallback) {
      MockWebSocket.onSendCallback(msgStr, this);
      return;
    }

    const responsePayload = MockWebSocket.mockResponses[payloadType];
    if (responsePayload !== undefined) {
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage({
            data: JSON.stringify({
              clientMsgId,
              payloadType: payloadType + 1,
              payload: responsePayload,
            }),
          });
        }
      }, 1);
    }
  }

  static lastInstance: MockWebSocket | null = null;
}

vi.stubGlobal('WebSocket', MockWebSocket);

// cTrader Open API payload types (see services/ctraderService.ts)
const PT = {
  APPLICATION_AUTH_REQ: 2100,
  ACCOUNT_AUTH_REQ: 2102,
  RECONCILE_REQ: 2124,
  DEAL_LIST_REQ: 2133,
};

describe('ctraderService - WebSocket API integration', () => {
  beforeEach(() => {
    MockWebSocket.lastInstance = null;
    MockWebSocket.mockResponses = {};
    MockWebSocket.onSendCallback = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body || '{}'));
      if (request.action === 'get_accounts') {
        return {
          ok: true,
          json: async () => ({
            accounts: [{ accountId: 1001, traderLogin: 123, isDemo: true, broker: 'demoServer' }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ ok: true, result: MockWebSocket.mockResponses[request.payloadType] || {} }),
      };
    }));
  });

  afterEach(() => {
    ctraderService.__setTokensForTesting(null);
    ctraderService.disconnect();
  });

  it('verifies isAuthenticated handles missing tokens', () => {
    ctraderService.__setTokensForTesting(null);
    expect(ctraderService.isAuthenticated()).toBe(false);
  });

  it('getAccounts fetches accounts through the authenticated server proxy', async () => {
    const accounts = await ctraderService.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].ctidTraderAccountId).toBe(1001);
    expect(accounts[0].login).toBe('123');

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ctrader/trade');
    expect((init?.headers as any)?.Authorization).toBe('Bearer mock_session_jwt');
    expect(JSON.parse(String(init?.body))).toEqual({ action: 'get_accounts' });
  });

  it('getPositions sends its cTrader request through the server proxy', async () => {
    MockWebSocket.mockResponses = {
      [PT.APPLICATION_AUTH_REQ]: {}, // APPLICATION_AUTH_REQ -> RES
      [PT.ACCOUNT_AUTH_REQ]: {},     // ACCOUNT_AUTH_REQ -> RES
      [PT.RECONCILE_REQ]: {          // RECONCILE_REQ -> RECONCILE_RES
        position: [
          {
            positionId: 5001,
            price: 1.0850,
            currentPrice: 1.0870,
            profit: 2000,    // 2000 cents = 20.00
            swap: -50,       // -50 cents = -0.50
            commission: -120,// -120 cents = -1.20
            stopLoss: null,
            takeProfit: null,
            tradeData: {
              symbolName: 'EURUSD',
              symbolId: 1,
              volume: 1000000, // 1000000 cents = 0.1 lots
              tradeSide: 1,    // buy
              openTimestamp: 1718000000000,
            },
          },
        ],
      },
    };

    const positions = await ctraderService.getPositions(1001);
    expect(positions).toHaveLength(1);
    expect(positions[0].positionId).toBe(5001);
    expect(positions[0].symbol).toBe('EURUSD');
    expect(positions[0].volume).toBe(0.1);
    expect(positions[0].tradeSide).toBe('buy');
    expect(positions[0].openPrice).toBe(1.0850);
    expect(positions[0].profit).toBe(20);
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      action: 'proxy', ctidTraderAccountId: 1001, payloadType: PT.RECONCILE_REQ,
    });
  });

  it('getClosedDeals correctly fetches deals and maps them', async () => {
    MockWebSocket.mockResponses = {
      [PT.APPLICATION_AUTH_REQ]: {},
      [PT.ACCOUNT_AUTH_REQ]: {},
      [PT.DEAL_LIST_REQ]: { // DEAL_LIST_REQ -> DEAL_LIST_RES
        deal: [
          {
            dealId: 6001,
            orderId: 7001,
            symbol: 'GBPUSD',
            tradeSide: 2, // sell
            filledVolume: 2000000, // 2000000 cents = 0.2 lots
            // Raw ProtoOA price: integer ticks (5-digit GBPUSD) → 1.27500
            executionPrice: 127500,
            closePositionDetail: {
              grossProfit: -1500, // cents
              swap: 0,
              entryPrice: 128000,
              commission: -200,
              createTimestamp: 1718000000000,
              executionTimestamp: 1718000100000,
            },
          },
          {
            // Position-opening (entry) deal: no closePositionDetail, so it must
            // be excluded from the closed-deal history.
            dealId: 6002,
            orderId: 7002,
            symbol: 'GBPUSD',
            tradeSide: 1, // buy
            filledVolume: 2000000,
            executionPrice: 128000,
            commission: -305,
            createTimestamp: 1717999900000,
            executionTimestamp: 1717999900000,
          },
        ],
      },
    };

    const deals = await ctraderService.getClosedDeals(1001);
    expect(deals).toHaveLength(1);
    expect(deals[0].dealId).toBe(6001);
    expect(deals[0].tradeSide).toBe('sell');
    expect(deals[0].volume).toBe(0.2);
    // Digit-normalized from raw ticks (no digits map → 5-digit default for non-JPY)
    expect(deals[0].price).toBe(1.275);
    expect(deals[0].profit).toBe(-15);
  });

  it('does not open a browser WebSocket for broker requests', async () => {
    MockWebSocket.mockResponses = { [PT.RECONCILE_REQ]: { position: [] } };
    const positions = await ctraderService.getPositions(1001);
    expect(positions).toEqual([]);
    expect(MockWebSocket.lastInstance).toBeNull();
  });
});
