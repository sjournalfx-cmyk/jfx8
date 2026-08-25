import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_lib/auth.js';
import { rateLimit } from './_lib/rateLimit.js';
import { applyCorsHeaders } from './_lib/cors.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCorsHeaders(res, req.headers);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Require an authenticated Supabase user so the paid Whisper quota cannot be abused.
  const auth = await requireUser(req.headers);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  // Per-user rate limit so one account cannot burn the paid Whisper quota.
  const rl = rateLimit(`transcribe:${auth.userId}`, 20, 60_000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(Math.ceil((rl.retryAfterMs ?? 0) / 1000)));
    res.status(429).json({ error: 'Rate limit exceeded. Please slow down and try again in a moment.' });
    return;
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_AUDIO_BYTES) {
    res.status(413).json({ error: 'Audio upload too large' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OpenAI API key not configured on server' });
    return;
  }

  try {
    const upstreamRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': req.headers['content-type'] || 'multipart/form-data',
      },
      body: req as any,
    });

    const data = await upstreamRes.text();
    res.status(upstreamRes.status).send(data);
  } catch (err: any) {
    console.error('OpenAI Transcribe Proxy Error:', err);
    res.status(500).json({ error: err.message || 'Transcription proxy failed' });
  }
}
