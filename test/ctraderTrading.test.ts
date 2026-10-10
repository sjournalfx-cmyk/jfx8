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
  readyState: number = 0;
  binaryType: string = 'blob';
  close = vi.fn();
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: any) => void) | null = null;

  static sentMessages: Array<{ payloadType: number; payload: any }> = [];
  static mockResponses: Record<number, any> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.lastInstance = this;
    setTimeout(() => {
      this.readyState = 1;
      if (this.onopen) this.onopen();
    }, 2);
  }

  send(msgStr: string) {
    const msg = JSON.parse(msgStr);
    const payloadType = msg.payloadType;
    const clientMsgId = msg.clientMsgId;

    MockWebSocket.sentMessages.push({ payloadType, payload: msg.payload });

    const responsePayload = MockWebSocket.mockResponses[payloadType] ?? {};
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

  static lastInstance: MockWebSocket | null = null;
}

vi.stubGlobal('WebSocket', MockWebSocket);

function latestProxyPayload() {
  const fetchMock = globalThis.fetch as any;
  const [, init] = fetchMock.mock.calls.at(-1);
  return JSON.parse(String(init.body));
}

describe('cTrader Trade Operations', () => {
  beforeEach(() => {
    MockWebSocket.lastInstance = null;
    MockWebSocket.sentMessages = [];
    MockWebSocket.mockResponses = {
      [2100]: {}, // APPLICATION_AUTH_REQ
      [2102]: {}, // ACCOUNT_AUTH_REQ
      [2106]: { orderId: 9001 }, // NEW_ORDER_REQ
      [2108]: { orderId: 9001 }, // CANCEL_ORDER_REQ
      [2109]: { orderId: 9001 }, // AMEND_ORDER_REQ
      [2110]: { positionId: 5001 }, // AMEND_POSITION_SLTP_REQ
      [2111]: { positionId: 5001 }, // CLOSE_POSITION_REQ
    };
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body || '{}'));
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

  it('opens a market BUY order with SL and TP', async () => {
    const res = await ctraderService.createNewOrder(1001, 1, 'buy', 0.05, {
      stopLoss: 1.0750,
      takeProfit: 1.0950,
      isDemo: true,
      comment: 'AI Test Trade',
    });

    expect(res).toEqual({ orderId: 9001 });

    const request = latestProxyPayload();
    expect(request).toMatchObject({ action: 'proxy', ctidTraderAccountId: 1001, payloadType: 2106 });
    expect(request.payload.symbolId).toBe(1);
    expect(request.payload.tradeSide).toBe(1); // 1 = BUY
    expect(request.payload.orderType).toBe(1); // 1 = MARKET
    expect(request.payload.volume).toBe(500000); // 0.05 lots = 500,000 cent-units
    expect(request.payload.stopLoss).toBe(1.0750);
    expect(request.payload.takeProfit).toBe(1.0950);
    expect(request.payload.comment).toBe('AI Test Trade');
  });

  it('opens a limit SELL order', async () => {
    await ctraderService.createNewOrder(1001, 2, 'sell', 0.1, {
      limitPrice: 1.2850,
      stopLoss: 1.2900,
      isDemo: true,
    });

    const request = latestProxyPayload();
    expect(request.payload.tradeSide).toBe(2); // 2 = SELL
    expect(request.payload.orderType).toBe(2); // 2 = LIMIT
    expect(request.payload.volume).toBe(1000000); // 0.1 lots = 1,000,000 cent-units
    expect(request.payload.limitPrice).toBe(1.2850);
    expect(request.payload.stopLoss).toBe(1.2900);
  });

  it('closes a position (partial or full)', async () => {
    const res = await ctraderService.closePosition(1001, 5001, 0.02, true);
    expect(res).toEqual({ positionId: 5001 });

    const request = latestProxyPayload();
    expect(request).toMatchObject({ action: 'proxy', ctidTraderAccountId: 1001, payloadType: 2111 });
    expect(request.payload.positionId).toBe(5001);
    expect(request.payload.volume).toBe(200000); // 0.02 lots = 200,000 cent-units
  });

  it('modifies SL and TP on an active position (amendPositionSltp)', async () => {
    const res = await ctraderService.amendPositionSltp(1001, 5001, {
      stopLoss: 1.0780,
      takeProfit: 1.0980,
      isDemo: true,
    });
    expect(res).toEqual({ positionId: 5001 });

    const request = latestProxyPayload();
    expect(request.payload.positionId).toBe(5001);
    expect(request.payload.stopLoss).toBe(1.0780);
    expect(request.payload.takeProfit).toBe(1.0980);
    expect(request.payload.guaranteedStopLoss).toBe(false);
  });

  it('modifies a pending order (amendOrder)', async () => {
    const res = await ctraderService.amendOrder(1001, 9001, {
      limitPrice: 1.0820,
      stopLoss: 1.0760,
      takeProfit: 1.0960,
      isDemo: true,
    });
    expect(res).toEqual({ orderId: 9001 });

    const request = latestProxyPayload();
    expect(request.payload.orderId).toBe(9001);
    expect(request.payload.limitPrice).toBe(1.0820);
    expect(request.payload.stopLoss).toBe(1.0760);
    expect(request.payload.takeProfit).toBe(1.0960);
  });

  it('cancels a pending order', async () => {
    const res = await ctraderService.cancelOrder(1001, 9001, true);
    expect(res).toEqual({ orderId: 9001 });

    const request = latestProxyPayload();
    expect(request).toMatchObject({ action: 'proxy', ctidTraderAccountId: 1001, payloadType: 2108 });
    expect(request.payload.orderId).toBe(9001);
  });
});
