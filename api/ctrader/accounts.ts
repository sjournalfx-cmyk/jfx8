import type { VercelRequest, VercelResponse } from '@vercel/node';
import WebSocket from 'ws';

// Server-only credentials. The client secret must never be shipped to the browser.
const CLIENT_ID = process.env.CTRADER_CLIENT_ID || '';
const CLIENT_SECRET = process.env.CTRADER_CLIENT_SECRET || '';

// Official cTrader Open API payload types
const PT = {
  APPLICATION_AUTH_REQ: 2100,
  GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ: 2149,
  ERROR_RES: 2142,
};

interface PendingReq {
  resolve: (val: any) => void;
  reject: (err: any) => void;
}

/**
 * Connects to a cTrader Open API proxy (demo or live), authenticates the
 * application, then fetches the account list for the given access token.
 */
function fetchAccountsFromHost(
  host: string,
  accessToken: string,
  clientId: string,
  clientSecret: string,
): Promise<any[]> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(`wss://${host}:5036`);
    } catch {
      resolve([]);
      return;
    }

    const timeout = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      resolve([]);
    }, 15000);

    let settled = false;
    const done = (val: any[]) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        try { ws.close(); } catch { /* ignore */ }
        resolve(val);
      }
    };

    let msgId = 0;
    const pending = new Map<string, PendingReq>();

    const send = (payloadType: number, payload: Record<string, any>): Promise<any> =>
      new Promise((res2, rej2) => {
        const clientMsgId = `srv_${++msgId}`;
        pending.set(clientMsgId, { resolve: res2, reject: rej2 });
        ws.send(JSON.stringify({ clientMsgId, payloadType, payload }));
      });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.clientMsgId && pending.has(msg.clientMsgId)) {
          const p = pending.get(msg.clientMsgId)!;
          pending.delete(msg.clientMsgId);
          if (msg.payloadType === PT.ERROR_RES) {
            p.reject(new Error(msg.payload?.errorCode || 'cTrader error'));
          } else {
            p.resolve(msg.payload);
          }
        }
      } catch { /* ignore parse errors */ }
    });

    ws.on('error', () => done([]));
    ws.on('close', () => done([]));

    ws.on('open', async () => {
      try {
        // 1. Authenticate the application
        await send(PT.APPLICATION_AUTH_REQ, {
          clientId,
          clientSecret,
        });

        // 2. Get accounts by access token (payloadType 2149)
        const accountList = await send(PT.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ, {
          accessToken,
        });

        const raw = accountList?.ctidTraderAccount || [];

        const mapped = raw.map((acc: any) => ({
          ctidTraderAccountId: Number(acc.ctidTraderAccountId),
          login: String(acc.traderLogin ?? acc.login ?? ''),
          server: acc.server || '',
          // Use the native isLive field — do NOT infer from host
          isDemo: !acc.isLive,
          currency: acc.currency || 'USD',
          balance: undefined as number | undefined,
          equity: undefined as number | undefined,
          profit: undefined as number | undefined,
          margin: undefined as number | undefined,
          freeMargin: undefined as number | undefined,
          name: acc.name || `Account #${acc.traderLogin ?? acc.ctidTraderAccountId}`,
          depositAssetId: Number(acc.depositAssetId ?? 0),
        }));

        done(mapped);
      } catch {
        done([]);
      }
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');
  // This is called by the same-origin SPA. Avoid a shared startup dependency
  // here so this Vercel Function can always initialize independently.
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const authHeader = req.headers['authorization'] || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!accessToken) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(500).json({ error: 'cTrader OAuth credentials not configured' });
    return;
  }

  try {
    const demoAccs = await fetchAccountsFromHost('demo.ctraderapi.com', accessToken, CLIENT_ID, CLIENT_SECRET);
    const liveAccs = await fetchAccountsFromHost('live.ctraderapi.com', accessToken, CLIENT_ID, CLIENT_SECRET);

    // Merge and deduplicate by ctidTraderAccountId (both endpoints return all accounts)
    const merged = [...demoAccs, ...liveAccs];
    const seen = new Map<number, any>();
    for (const acc of merged) {
      if (!seen.has(acc.ctidTraderAccountId)) {
        seen.set(acc.ctidTraderAccountId, acc);
      }
    }
    const all = Array.from(seen.values());

    res.status(200).json({ accounts: all });
  } catch (err) {
    console.error('cTrader accounts endpoint error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch accounts',
    });
  }
}
