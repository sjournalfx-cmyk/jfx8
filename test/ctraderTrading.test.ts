import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ctraderService from '../services/ctraderService';

vi.stubEnv('VITE_CTRADER_CLIENT_ID', 'test_client_id');
vi.stubEnv('VITE_CTRADER_CLIENT_SECRET', 'test_client_secret');

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

describe('cTrader Trade Operations', () => {
  beforeEach(() => {
    ctraderService.__setTokensForTesting({
      accessToken: 'mock_access_token',
      expiresAt: Date.now() + 60000,
    });
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

    const orderReq = MockWebSocket.sentMessages.find(m => m.payloadType === 2106);
    expect(orderReq).toBeDefined();
    expect(orderReq?.payload.ctidTraderAccountId).toBe(1001);
    expect(orderReq?.payload.symbolId).toBe(1);
    expect(orderReq?.payload.tradeSide).toBe(1); // 1 = BUY
    expect(orderReq?.payload.orderType).toBe(1); // 1 = MARKET
    expect(orderReq?.payload.volume).toBe(500000); // 0.05 lots = 500,000 cent-units
    expect(orderReq?.payload.stopLoss).toBe(1.0750);
    expect(orderReq?.payload.takeProfit).toBe(1.0950);
    expect(orderReq?.payload.comment).toBe('AI Test Trade');
  });

  it('opens a limit SELL order', async () => {
    await ctraderService.createNewOrder(1001, 2, 'sell', 0.1, {
      limitPrice: 1.2850,
      stopLoss: 1.2900,
      isDemo: true,
    });

    const orderReq = MockWebSocket.sentMessages.find(m => m.payloadType === 2106);
    expect(orderReq).toBeDefined();
    expect(orderReq?.payload.tradeSide).toBe(2); // 2 = SELL
    expect(orderReq?.payload.orderType).toBe(2); // 2 = LIMIT
    expect(orderReq?.payload.volume).toBe(1000000); // 0.1 lots = 1,000,000 cent-units
    expect(orderReq?.payload.limitPrice).toBe(1.2850);
    expect(orderReq?.payload.stopLoss).toBe(1.2900);
  });

  it('closes a position (partial or full)', async () => {
    const res = await ctraderService.closePosition(1001, 5001, 0.02, true);
    expect(res).toEqual({ positionId: 5001 });

    const closeReq = MockWebSocket.sentMessages.find(m => m.payloadType === 2111);
    expect(closeReq).toBeDefined();
    expect(closeReq?.payload.ctidTraderAccountId).toBe(1001);
    expect(closeReq?.payload.positionId).toBe(5001);
    expect(closeReq?.payload.volume).toBe(200000); // 0.02 lots = 200,000 cent-units
  });

  it('modifies SL and TP on an active position (amendPositionSltp)', async () => {
    const res = await ctraderService.amendPositionSltp(1001, 5001, {
      stopLoss: 1.0780,
      takeProfit: 1.0980,
      isDemo: true,
    });
    expect(res).toEqual({ positionId: 5001 });

    const amendReq = MockWebSocket.sentMessages.find(m => m.payloadType === 2110);
    expect(amendReq).toBeDefined();
    expect(amendReq?.payload.ctidTraderAccountId).toBe(1001);
    expect(amendReq?.payload.positionId).toBe(5001);
    expect(amendReq?.payload.stopLoss).toBe(1.0780);
    expect(amendReq?.payload.takeProfit).toBe(1.0980);
    expect(amendReq?.payload.guaranteedStopLoss).toBe(false);
  });

  it('modifies a pending order (amendOrder)', async () => {
    const res = await ctraderService.amendOrder(1001, 9001, {
      limitPrice: 1.0820,
      stopLoss: 1.0760,
      takeProfit: 1.0960,
      isDemo: true,
    });
    expect(res).toEqual({ orderId: 9001 });

    const amendReq = MockWebSocket.sentMessages.find(m => m.payloadType === 2109);
    expect(amendReq).toBeDefined();
    expect(amendReq?.payload.ctidTraderAccountId).toBe(1001);
    expect(amendReq?.payload.orderId).toBe(9001);
    expect(amendReq?.payload.limitPrice).toBe(1.0820);
    expect(amendReq?.payload.stopLoss).toBe(1.0760);
    expect(amendReq?.payload.takeProfit).toBe(1.0960);
  });

  it('cancels a pending order', async () => {
    const res = await ctraderService.cancelOrder(1001, 9001, true);
    expect(res).toEqual({ orderId: 9001 });

    const cancelReq = MockWebSocket.sentMessages.find(m => m.payloadType === 2108);
    expect(cancelReq).toBeDefined();
    expect(cancelReq?.payload.ctidTraderAccountId).toBe(1001);
    expect(cancelReq?.payload.orderId).toBe(9001);
  });
});
