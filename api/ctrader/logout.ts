import type { VercelRequest, VercelResponse } from '@vercel/node';

const REFRESH_COOKIE = 'jfx_ctrader_refresh';

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Same-origin session endpoint; keeping it dependency-free prevents an
  // import failure from turning logout into a Vercel function 500.
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  res.setHeader('Set-Cookie', [
    `${REFRESH_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
  ]);
  res.status(200).json({ ok: true });
}
