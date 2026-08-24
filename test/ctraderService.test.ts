import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ctraderService from '../services/ctraderService';

vi.stubEnv('VITE_CTRADER_CLIENT_ID', 'test_client_id');
vi.stubEnv('VITE_CTRADER_CLIENT_SECRET', 'test_client_secret');

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
    ctraderService.__setTokensForTesting({
      accessToken: 'mock_access_token',
      expiresAt: Date.now() + 60000,
    });
    MockWebSocket.lastInstance = null;
    MockWebSocket.mockResponses = {};
    MockWebSocket.onSendCallback = null;
  });

  afterEach(() => {
    ctraderService.__setTokensForTesting(null);
    ctraderService.disconnect();
  });

  it('verifies isAuthenticated handles missing tokens', () => {
    ctraderService.__setTokensForTesting(null);
    expect(ctraderService.isAuthenticated()).toBe(false);
  });

  it('getAccounts fetches accounts through the server endpoint', async () => {
    const accountsPayload = {
      accounts: [
        {
          ctidTraderAccountId: 1001,
          login: 'login123',
          server: 'demoServer',
          isDemo: true,
          currency: 'USD',
          balance: 500000,
          equity: 501000,
          profit: 1000,
          margin: 200,
          freeMargin: 500800,
          name: 'Demo Account',
          depositAssetId: 1,
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => accountsPayload,
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);

    const accounts = await ctraderService.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].ctidTraderAccountId).toBe(1001);
    expect(accounts[0].login).toBe('login123');
    expect(accounts[0].balance).toBe(500000);

    // The Authorization header must carry the access token.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ctrader/accounts');
    expect((init?.headers as any)?.Authorization).toBe('Bearer mock_access_token');

    vi.stubGlobal('fetch', originalFetch);
  });

  it('getPositions correctly authenticates account and fetches positions', async () => {
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
            executionPrice: 1.2750,
            closePositionDetail: {
              grossProfit: -1500, // cents
              swap: 0,
              entryPrice: 1.2800,
            },
            commission: -200,
            createTimestamp: 1718000000000,
            executionTimestamp: 1718000100000,
          },
          {
            // Position-opening (entry) deal: no closePositionDetail, so it must
            // be excluded from the closed-deal history.
            dealId: 6002,
            orderId: 7002,
            symbol: 'GBPUSD',
            tradeSide: 1, // buy
            filledVolume: 2000000,
            executionPrice: 1.2800,
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
    expect(deals[0].price).toBe(1.2750);
    expect(deals[0].profit).toBe(-15);
  });

  it('handles WebSocket binary blob decoding correctly', async () => {
    MockWebSocket.onSendCallback = (msgStr: string, wsInstance: MockWebSocket) => {
      const msg = JSON.parse(msgStr);
      const payloadType = msg.payloadType;
      const clientMsgId = msg.clientMsgId;

      let resPayload = {};
      if (payloadType === PT.RECONCILE_REQ) {
        resPayload = { position: [] };
      }

      const resObj = {
        clientMsgId,
        payloadType: payloadType + 1,
        payload: resPayload,
      };

      const blob = new Blob([JSON.stringify(resObj)], { type: 'application/json' });
      setTimeout(() => {
        if (wsInstance.onmessage) {
          wsInstance.onmessage({ data: blob } as any);
        }
      }, 1);
    };

    const positions = await ctraderService.getPositions(1001);
    expect(positions).toEqual([]);
  });
});
