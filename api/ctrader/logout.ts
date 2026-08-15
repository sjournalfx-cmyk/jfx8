import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders } from '../_lib/cors';

const REFRESH_COOKIE = 'jfx_ctrader_refresh';

export default function handler(req: VercelRequest, res: VercelResponse) {
  applyCorsHeaders(res, req.headers);
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
