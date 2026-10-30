import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * /api/ctrader/callback
 *
 * cTrader ID redirects back to this URL after the user authorises.
 * We simply forward the ?code= to the SPA root so the React app
 * (App.tsx) can intercept it and call /api/ctrader/exchange.
 */
const NATIVE_STATE = 'jfx-native';
const NATIVE_DEEP_LINK = 'site.jfxjournal.app://ctrader';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  const isNativeState = state === NATIVE_STATE || state?.startsWith('jfx-native');

  if (isNativeState && code) {
    res.setHeader('Location', `${NATIVE_DEEP_LINK}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
    res.status(302).end();
    return;
  }

  const target = code
    ? `/?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`
    : '/';

  res.setHeader('Location', target);
  res.status(302).end();
}
