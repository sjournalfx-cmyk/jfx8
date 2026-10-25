import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyNativeOAuthState } from '../_lib/ctraderOAuthState.js';

/**
 * /api/ctrader/callback
 *
 * cTrader ID redirects back to this URL after the user authorises.
 * Web: forward ?code= to the SPA root so App.tsx can exchange it.
 * Native: only a server-signed, unexpired state may redirect to the app's
 * deep link. The old fixed `jfx-native` value is rejected so an attacker
 * cannot replay an authorization code into the app.
 */
const NATIVE_DEEP_LINK = 'site.jfxjournal.app://ctrader';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  if (state && state !== 'jfx-native' && verifyNativeOAuthState(state) && code) {
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
