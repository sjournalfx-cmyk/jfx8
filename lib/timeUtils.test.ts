import { describe, expect, it } from 'vitest';
import { getSastHourFromTrade } from './timeUtils';

describe('getSastHourFromTrade', () => {
  it('prefers openTime over the legacy time field for hourly analytics', () => {
    const hour = getSastHourFromTrade({
      date: '2026-05-02',
      time: '10:30',
      openTime: '2026-05-02T10:00:00+02:00',
      closeTime: '2026-05-02T10:30:00+02:00',
    });

    expect(hour).toBe(10);
  });

  it('falls back to time when openTime is unavailable', () => {
    const hour = getSastHourFromTrade({
      date: '2026-05-02',
      time: '14:45',
    });

    expect(hour).toBe(14);
  });
});
