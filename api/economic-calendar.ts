import type { VercelRequest, VercelResponse } from '@vercel/node';
import { spawn } from 'child_process';
import path from 'path';

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
    const tz = getSingle(req.query?.tz);

    const scriptPath = path.join(process.cwd(), 'scripts', 'get_forexfactory_calendar.py');
    const args = [scriptPath];
    if (from) args.push('--start', from);
    if (to) args.push('--end', to);
    if (tz) args.push('--tz', tz);

    const python = spawn('python', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (d) => { stdout += d.toString(); });
    python.stderr.on('data', (d) => { stderr += d.toString(); });

    python.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        res.status(500).json({ error: stderr.trim() || 'Scraper failed to run' });
        return;
      }
      try {
        const payload = JSON.parse(stdout.trim());
        res.status(200).json(payload);
      } catch {
        res.status(500).json({ error: 'Failed to parse economic calendar JSON response' });
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch economic calendar data',
    });
  }
}

