import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('cTrader route rewrites', () => {
  const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));
  const rewrites: Array<{ source: string; destination: string }> = config.rewrites || [];

  it('keeps the public logout route working without adding a serverless function', () => {
    expect(rewrites).toContainEqual({
      source: '/api/ctrader/logout',
      destination: '/api/ctrader/trade?action=logout',
    });
  });

  it('keeps the candles alias intact', () => {
    expect(rewrites).toContainEqual({
      source: '/api/ctrader/candles',
      destination: '/api/ctrader/trade?action=candles',
    });
  });
});
