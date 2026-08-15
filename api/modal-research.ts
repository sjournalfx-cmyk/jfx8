import { Readable } from 'node:stream';
import { requireUser } from './_lib/auth';
import { rateLimit } from './_lib/rateLimit';
import { applyCorsHeaders } from './_lib/cors';

type VercelRequest = {
  method?: string;
  body?: any;
  headers: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => void;
  json: (body: any) => void;
  send: (body: any) => void;
  end: (body?: any) => void;
  write: (chunk: any) => void;
  flushHeaders?: () => void;
};

const MODAL_CHAT_URL = 'https://api.us-west-2.modal.direct/v1/chat/completions';

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

  // Require an authenticated Supabase user so this paid proxy cannot be abused.
  const auth = await requireUser(req.headers);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  // Per-user rate limit so one account cannot burn the paid Modal quota.
  const rl = rateLimit(`modal:${auth.userId}`, 60, 60_000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(Math.ceil((rl.retryAfterMs ?? 0) / 1000)));
    res.status(429).json({ error: 'Rate limit exceeded. Please slow down and try again in a moment.' });
    return;
  }

  const apiKey = process.env.MODAL_RESEARCH_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Modal API key is not configured on the server' });
    return;
  }

  // Clamp request size / token budget to limit abuse of the paid quota.
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const maxTokens = Number(body.max_tokens);
  if (Number.isFinite(maxTokens) && maxTokens > 4096) {
    body.max_tokens = 4096;
  }
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > 512 * 1024) {
    res.status(413).json({ error: 'Request body too large' });
    return;
  }

  try {
    const upstream = await fetch(MODAL_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (['content-length', 'connection', 'transfer-encoding', 'content-encoding'].includes(lower)) {
        return;
      }
      res.setHeader(key, value);
    });

    if (!upstream.body) {
      const text = await upstream.text();
      res.send(text);
      return;
    }

    if (req.body?.stream && 'fromWeb' in Readable) {
      res.flushHeaders?.();
      Readable.fromWeb(upstream.body as any).pipe(res as any);
      return;
    }

    const text = await upstream.text();
    res.send(text);
  } catch (error) {
    console.error('Modal proxy error:', error);
    res.status(500).json({
      error: 'Failed to proxy request to Modal',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
