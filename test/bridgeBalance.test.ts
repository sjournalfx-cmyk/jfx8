import { describe, it, expect } from 'vitest';
import {
  parseStoredBridgeBalance,
  resolveBridgeBackedBalance,
  BRIDGE_BALANCE_MAX_AGE_MS,
  type StoredBridgeBalance,
} from '../lib/bridgeBalance';

const fresh = (balance: number): StoredBridgeBalance => ({
  v: 1,
  balance,
  capturedAt: new Date().toISOString(),
});

const aged = (balance: number, daysAgo: number): StoredBridgeBalance => ({
  v: 1,
  balance,
  capturedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
});

const baseProfile = {
  name: 'Test',
  accountName: 'Acc',
  initialBalance: 1000,
  currency: 'USD',
  currencySymbol: '$',
  onboarded: true,
} as any;

describe('parseStoredBridgeBalance', () => {
  it('parses current object shape', () => {
    const r = parseStoredBridgeBalance(fresh(5000));
    expect(r).toEqual({ balance: 5000, ageMs: expect.any(Number) });
    expect(r!.ageMs).toBeLessThan(1000);
  });

  it('treats legacy bare numbers as infinitely stale', () => {
    const r = parseStoredBridgeBalance(4200);
    expect(r).toEqual({ balance: 4200, ageMs: Infinity });
  });

  it('returns null for garbage', () => {
    expect(parseStoredBridgeBalance(null)).toBeNull();
    expect(parseStoredBridgeBalance(NaN)).toBeNull();
    expect(parseStoredBridgeBalance({ balance: 'x' })).toBeNull();
  });
});

describe('resolveBridgeBackedBalance', () => {
  const manual = (pnl = 0) => baseProfile.initialBalance + pnl;

  it('demo mode always returns manual balance', () => {
    const r = resolveBridgeBackedBalance({
      userProfile: baseProfile,
      totalPnL: 200,
      eaSession: { data: { account: { balance: 999999 } } } as any,
      lastKnownBridgeBalance: fresh(888888),
      isBridgeOnline: true,
      isDemoMode: true,
    });
    expect(r).toBe(manual(200));
  });

  it('no bridge source → manual balance even if a stale snapshot exists', () => {
    const r = resolveBridgeBackedBalance({
      userProfile: baseProfile, // not eaConnected
      totalPnL: -100,
      lastKnownBridgeBalance: fresh(999999),
      eaSession: null,
      isBridgeOnline: false,
    });
    expect(r).toBe(manual(-100));
  });

  it('live bridge with session balance → session wins', () => {
    const r = resolveBridgeBackedBalance({
      userProfile: { ...baseProfile, eaConnected: true, syncMethod: 'EA_CONNECT' },
      totalPnL: 50,
      eaSession: { data: { account: { balance: 12345.67 } } } as any,
      lastKnownBridgeBalance: fresh(1),
      isBridgeOnline: true,
    });
    expect(r).toBe(12345.67);
  });

  it('offline but connected → fresh stored snapshot', () => {
    const r = resolveBridgeBackedBalance({
      userProfile: { ...baseProfile, eaConnected: true, syncMethod: 'EA_CONNECT' },
      totalPnL: 50,
      eaSession: null,
      lastKnownBridgeBalance: fresh(7777),
      isBridgeOnline: false,
    });
    expect(r).toBe(7777);
  });

  it(`stored snapshot older than ${BRIDGE_BALANCE_MAX_AGE_MS / 86400000}d falls back to session then manual`, () => {
    const opts = {
      userProfile: { ...baseProfile, eaConnected: true, syncMethod: 'EA_CONNECT' },
      totalPnL: 0,
      lastKnownBridgeBalance: aged(555555, 10),
      isBridgeOnline: false,
    };
    // No session either → manual
    expect(resolveBridgeBackedBalance({ ...opts, eaSession: null })).toBe(manual(0));
    // Session exists → session value used over expired snapshot
    const withSession = resolveBridgeBackedBalance({
      ...opts,
      eaSession: { data: { account: { balance: 3000 } } } as any,
    });
    expect(withSession).toBe(3000);
  });

  it('legacy bare-number snapshot never overrides (infinitely old)', () => {
    const r = resolveBridgeBackedBalance({
      userProfile: { ...baseProfile, eaConnected: true, syncMethod: 'EA_CONNECT' },
      totalPnL: 0,
      eaSession: null,
      lastKnownBridgeBalance: 31337,
      isBridgeOnline: false,
    });
    expect(r).toBe(manual(0));
  });

  it('supports legacy number passed while online via session anyway', () => {
    const r = resolveBridgeBackedBalance({
      userProfile: { ...baseProfile, eaConnected: true, syncMethod: 'EA_CONNECT' },
      totalPnL: 0,
      eaSession: { data: { account: { balance: 8000 } } } as any,
      lastKnownBridgeBalance: 2,
      isBridgeOnline: true,
    });
    expect(r).toBe(8000);
  });
});
