import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * /api/ctrader/callback
 *
 * cTrader ID redirects back to this URL after the user authorises.
 * We simply forward the ?code= to the SPA root so the React app
 * (App.tsx) can intercept it and call /api/ctrader/exchange.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  const code = req.query.code as string | undefined;
  const target = code ? `/?code=${encodeURIComponent(code)}` : '/';

  res.setHeader('Location', target);
  res.status(302).end();
}
