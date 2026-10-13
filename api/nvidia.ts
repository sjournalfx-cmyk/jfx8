import { Readable } from 'node:stream';
import { requireUser } from './_lib/auth.js';
import { rateLimit } from './_lib/rateLimit.js';
import { applyCorsHeaders } from './_lib/cors.js';
import zenHandler from './_lib/zenHandler.js';

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

const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

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

  // Zen proxy tier. Vercel Hobby caps a deployment at 12 Serverless Functions,
  // so this used to be its own api/zen.ts route and the build failed with
  // `exceeded_serverless_functions_per_deployment`. The handler now lives in
  // api/_lib/zenHandler.ts and is reached as POST /api/nvidia { zen: true }.
  const isZen = typeof req.body === 'object' && req.body !== null
    && !Array.isArray(req.body) && (req.body as any).zen === true;
  if (isZen) {
    return zenHandler(req, res);
  }

  // Require an authenticated Supabase user so this paid proxy cannot be abused.
  const auth = await requireUser(req.headers);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error, code: 'auth_required' });
    return;
  }

  // Per-user rate limit so one account cannot burn the paid NVIDIA quota.
  // Shared across instances via Supabase RPC; degrades to a per-instance
  // guard (not a 503) if Supabase is unreachable, so concurrent users keep
  // working through an outage.
  const rl = await rateLimit(`nvidia:${auth.userId}`, 60, 60_000);
  if (rl.unavailable) {
    res.status(503).json({ error: 'Rate limiter is temporarily unavailable. Please try again shortly.', code: 'rate_limiter_unavailable' });
    return;
  }
  if (rl.degraded) {
    res.setHeader('x-jfx-ratelimit', 'degraded');
  }
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(Math.ceil((rl.retryAfterMs ?? 0) / 1000)));
    res.status(429).json({ error: 'Rate limit exceeded. Please slow down and try again in a moment.', code: 'rate_limited' });
    return;
  }

  // Server-only key. Never fall back to a hardcoded or VITE_* value — VITE_* vars
  // get inlined into the client bundle.
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'NVIDIA API key is not configured on the server', code: 'ai_not_configured' });
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
    res.status(413).json({ error: 'Request body too large', code: 'request_too_large' });
    return;
  }

  const isStream = Boolean(body.stream);

  try {
    const upstream = await fetch(NVIDIA_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      // Bound non-streaming upstreams so one hung request cannot wedge a
      // serverless instance while many users are active. Streams are governed
      // by client timeouts (first-token watchdog + extended totals) and the
      // platform's own maxDuration instead.
      ...(!isStream ? { signal: AbortSignal.timeout(50000) } : {}),
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
    console.error('NVIDIA proxy error:', error);
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    res.status(timedOut ? 504 : 500).json({
      error: timedOut ? 'The AI upstream took too long to respond' : 'Failed to proxy request to NVIDIA',
      code: timedOut ? 'upstream_timeout' : 'proxy_failed',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
