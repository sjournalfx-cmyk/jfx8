import { describe, it, expect } from 'vitest';
import {
  JFX_TOKEN_PATTERN,
  extractRawApiKey,
  isJfxApiKey,
  stripAuthScheme,
  parseIsDemo,
  hasTradeScope,
  toVolumeCents,
  chooseCtraderAccount,
  findAltAccountForHost,
  isFallbackWorthyCtraderError,
} from '../api/_lib/jfxApiKey';

const GOOD = 'jfx_pat_abcdefgh_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';

describe('jfxApiKey shared auth', () => {
  it('validates token format', () => {
    expect(JFX_TOKEN_PATTERN.test(GOOD)).toBe(true);
    expect(isJfxApiKey(GOOD)).toBe(true);
    expect(isJfxApiKey('jfx_pat_short_x')).toBe(false);
    expect(isJfxApiKey('')).toBe(false);
    expect(isJfxApiKey('Bearer ' + GOOD)).toBe(false); // must strip first
    expect(isJfxApiKey(stripAuthScheme('Bearer ' + GOOD))).toBe(true);
  });

  it('extracts from X-API-Key, Authorization Bearer, and X-Access-Token', () => {
    expect(extractRawApiKey({ 'x-api-key': GOOD })).toBe(GOOD);
    expect(extractRawApiKey({ authorization: `Bearer ${GOOD}` })).toBe(GOOD);
    expect(extractRawApiKey({ Authorization: GOOD })).toBe(GOOD);
    expect(extractRawApiKey({ 'X-API-KEY': `Token ${GOOD} ` })).toBe(GOOD);
    expect(extractRawApiKey({ 'x-access-token': GOOD })).toBe(GOOD);
    // X-API-Key wins when both present
    expect(extractRawApiKey({ 'x-api-key': GOOD, authorization: 'Bearer other' })).toBe(GOOD);
    expect(extractRawApiKey({})).toBe('');
  });

  it('parses isDemo without the Boolean("false") trap', () => {
    expect(parseIsDemo(true, false)).toBe(true);
    expect(parseIsDemo(false, true)).toBe(false);
    expect(parseIsDemo('false', true)).toBe(false);
    expect(parseIsDemo('False', true)).toBe(false);
    expect(parseIsDemo('0', true)).toBe(false);
    expect(parseIsDemo('live', true)).toBe(false);
    expect(parseIsDemo('true', false)).toBe(true);
    expect(parseIsDemo('1', false)).toBe(true);
    expect(parseIsDemo('demo', false)).toBe(true);
    expect(parseIsDemo(undefined, true)).toBe(true);
    expect(parseIsDemo(undefined, false)).toBe(false);
    expect(parseIsDemo('', true)).toBe(true);
    expect(parseIsDemo(0, true)).toBe(false);
    expect(parseIsDemo(1, false)).toBe(true);
  });

  it('implies trades:read from trades:write', () => {
    expect(hasTradeScope(['trades:write'], 'trades:read')).toBe(true);
    expect(hasTradeScope(['trades:write'], 'trades:write')).toBe(true);
    expect(hasTradeScope(['trades:read'], 'trades:write')).toBe(false);
    expect(hasTradeScope([], 'trades:read')).toBe(false);
    expect(hasTradeScope(undefined, 'trades:read')).toBe(false);
  });

  it('converts lots to cTrader cents', () => {
    expect(toVolumeCents(0.01)).toBe(100000);
    expect(toVolumeCents(0.05)).toBe(500000);
    expect(() => toVolumeCents(0)).toThrow();
    expect(() => toVolumeCents(NaN)).toThrow();
  });

  it('picks demo/live-aware accounts and self-heals mismatches', () => {
    const accounts = [
      { ctidTraderAccountId: 1, isLive: false },
      { ctidTraderAccountId: 2, isLive: true },
    ];
    expect(chooseCtraderAccount(accounts, true, null).accountId).toBe(1);
    expect(chooseCtraderAccount(accounts, false, null).accountId).toBe(2);
    const explicit = chooseCtraderAccount(accounts, true, 2);
    expect(explicit.accountId).toBe(2);
    expect(explicit.mismatch).toBe(true);
    expect(findAltAccountForHost(accounts, true, 2)?.ctidTraderAccountId).toBe(1);
    expect(findAltAccountForHost(accounts, false, 1)?.ctidTraderAccountId).toBe(2);
  });

  it('flags retryable cTrader mint errors for service-token fallback', () => {
    expect(isFallbackWorthyCtraderError('Access denied')).toBe(true);
    expect(isFallbackWorthyCtraderError('CH_ACCESS_DENIED')).toBe(true);
    expect(isFallbackWorthyCtraderError('invalid_grant expired')).toBe(true);
    expect(isFallbackWorthyCtraderError('some random network timeout')).toBe(false);
  });
});
