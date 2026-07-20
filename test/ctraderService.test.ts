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

describe('ctraderService - WebSocket API integration', () => {
  beforeEach(() => {
    localStorage.setItem('jfx_ctrader_tokens', JSON.stringify({
      accessToken: 'mock_access_token',
      refreshToken: 'mock_refresh_token',
      expiresAt: Date.now() + 60000,
    }));
    MockWebSocket.lastInstance = null;
    MockWebSocket.mockResponses = {};
    MockWebSocket.onSendCallback = null;
  });

  afterEach(() => {
    localStorage.clear();
    ctraderService.disconnect();
  });

  it('verifies isAuthenticated handles missing tokens', () => {
    expect(ctraderService.isAuthenticated()).toBe(false);
  });

  it('getAccounts correctly authenticates and fetches accounts', async () => {
    MockWebSocket.mockResponses = {
      2100: {}, // APPLICATION_AUTH_REQ -> APPLICATION_AUTH_RES
      2102: {  // GET_ACCOUNT_LIST_BY_TOKEN_REQ -> GET_ACCOUNT_LIST_BY_TOKEN_RES
        ctidTraderAccount: [
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
          }
        ]
      }
    };

    const accounts = await ctraderService.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].ctidTraderAccountId).toBe(1001);
    expect(accounts[0].login).toBe('login123');
    expect(accounts[0].balance).toBe(500000);
  });

  it('getPositions correctly authenticates account and fetches positions', async () => {
    MockWebSocket.mockResponses = {
      2104: {}, // ACCOUNT_AUTH_REQ -> ACCOUNT_AUTH_RES
      2108: {  // POSITION_LIST_REQ -> POSITION_LIST_RES
        position: [
          {
            positionId: 5001,
            symbol: 'EURUSD',
            volume: 10000, // 100 units
            tradeSide: 1, // buy
            openPrice: 1.0850,
            currentPrice: 1.0870,
            profit: 20,
            swap: -0.5,
            commission: -1.2,
            openTimestamp: 1718000000000,
          }
        ]
      }
    };

    const positions = await ctraderService.getPositions(1001);
    expect(positions).toHaveLength(1);
    expect(positions[0].positionId).toBe(5001);
    expect(positions[0].volume).toBe(100);
    expect(positions[0].tradeSide).toBe('buy');
    expect(positions[0].openPrice).toBe(1.0850);
  });

  it('getClosedDeals correctly fetches deals and maps them', async () => {
    MockWebSocket.mockResponses = {
      2104: {},
      2110: { // DEAL_LIST_REQ -> DEAL_LIST_RES
        deal: [
          {
            dealId: 6001,
            orderId: 7001,
            symbol: 'GBPUSD',
            tradeSide: 2, // sell
            volume: 20000, // 200 units
            price: 1.2750,
            profit: -15,
            swap: 0,
            commission: -2.0,
            openTimestamp: 1718000000000,
            closeTimestamp: 1718000100000,
          }
        ]
      }
    };

    const deals = await ctraderService.getClosedDeals(1001);
    expect(deals).toHaveLength(1);
    expect(deals[0].dealId).toBe(6001);
    expect(deals[0].tradeSide).toBe('sell');
    expect(deals[0].volume).toBe(200);
  });

  it('handles WebSocket binary blob decoding correctly', async () => {
    MockWebSocket.onSendCallback = (msgStr: string, wsInstance: MockWebSocket) => {
      const msg = JSON.parse(msgStr);
      const payloadType = msg.payloadType;
      const clientMsgId = msg.clientMsgId;

      let resPayload = {};
      if (payloadType === 2102) {
        resPayload = { ctidTraderAccount: [] };
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

    const accounts = await ctraderService.getAccounts();
    expect(accounts).toEqual([]);
  });
});
