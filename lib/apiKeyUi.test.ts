import { describe, expect, it } from 'vitest';
import { describeApiError, formatRelativeTime, getApiKeyStatus } from './apiKeyUi';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');

describe('getApiKeyStatus', () => {
  it('flags revoked keys regardless of expiry', () => {
    expect(getApiKeyStatus({ status: 'revoked', expires_at: null }, NOW)).toMatchObject({
      state: 'revoked', label: 'Revoked', tone: 'danger',
    });
  });

  it('flags expired keys', () => {
    expect(getApiKeyStatus({ status: 'active', expires_at: '2026-10-01T00:00:00.000Z' }, NOW)).toMatchObject({
      state: 'expired', label: 'Expired', tone: 'danger',
    });
  });

  it('warns when a key expires within a week', () => {
    expect(getApiKeyStatus({ status: 'active', expires_at: '2026-10-28T12:00:00.000Z' }, NOW)).toMatchObject({
      state: 'expiring', label: 'Expires in 4d', tone: 'warning', daysLeft: 4,
    });
  });

  it('treats far-future and never-expiring keys as active', () => {
    expect(getApiKeyStatus({ status: 'active', expires_at: '2027-10-24T12:00:00.000Z' }, NOW).state).toBe('active');
    expect(getApiKeyStatus({ status: 'active', expires_at: null }, NOW).state).toBe('active');
  });
});

describe('formatRelativeTime', () => {
  it('formats recent and older timestamps', () => {
    expect(formatRelativeTime(null, NOW)).toBe('Never');
    expect(formatRelativeTime('2026-10-24T11:59:30.000Z', NOW)).toBe('Just now');
    expect(formatRelativeTime('2026-10-24T11:55:00.000Z', NOW)).toBe('5m ago');
    expect(formatRelativeTime('2026-10-24T09:00:00.000Z', NOW)).toBe('3h ago');
    expect(formatRelativeTime('2026-10-21T12:00:00.000Z', NOW)).toBe('3d ago');
  });
});

describe('describeApiError', () => {
  it('maps known server codes to actionable hints', () => {
    expect(describeApiError('ctrader_not_connected', 400)).toContain('Connect it once');
    expect(describeApiError('expired_token', 401)).toContain('expired');
    expect(describeApiError('locked_by_rule', 403)).toContain('Do not retry');
    expect(describeApiError('idempotency_conflict', 409)).toContain('fresh UUID');
    expect(describeApiError('not_found', 404)).toContain('not found');
  });

  it('falls back to HTTP status hints and a generic message', () => {
    expect(describeApiError(undefined, 401)).toContain('not recognised');
    expect(describeApiError(undefined, 503)).toContain('temporarily unavailable');
    expect(describeApiError('something_new', 400)).toBe('Request failed (something_new).');
    expect(describeApiError(null, undefined)).toBe('Request failed. See the response for details.');
  });
});
