import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchPublicEconomicCalendar } from '../lib/economicCalendar.js';

const getSingle = (value: string | string[] | undefined) => (
  Array.isArray(value) ? value[0] : value
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const from = getSingle(req.query?.from);
    const to = getSingle(req.query?.to);
    const payload = await fetchPublicEconomicCalendar({ from, to });
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch economic calendar data',
    });
  }
}
