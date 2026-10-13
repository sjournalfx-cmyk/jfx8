import { Readable } from 'node:stream';
import { requireUser } from './auth.js';
import { rateLimit } from './rateLimit.js';
import { applyCorsHeaders } from './cors.js';

type VercelRequest = { method?: string; body?: any; headers: Record<string, string | string[] | undefined>; };
type VercelResponse = { status: (code: number) => VercelResponse; setHeader: (n: string, v: string) => void; json: (b: any) => void; send: (b: any) => void; end: (b?: any) => void; write: (c: any) => void; flushHeaders?: () => void; };

const ZEN_CHAT_URL = 'https://opencode.ai/zen/v1/chat/completions';
const ZEN_RESPONSES_URL = 'https://opencode.ai/zen/v1/responses';

const RESPONSES_MODELS = new Set(['muse-spark-1.3-contributor-free','muse-spark-1.2-contributor-free']);

// Zen free models are gated to OpenCode binary only -> remap to working free NVIDIA equivalents
const ZEN_FREE_REMAP: Record<string,string> = {
  'big-pickle': 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'mimo-v2.5-free': 'meta/llama-3.2-11b-vision-instruct',
  'ling-3.0-flash-fin-free': 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'nemotron-3-ultra-free': 'nvidia/nemotron-3-super-120b-a12b',
  'nemotron-3.5-lightning-free': 'nvidia/nemotron-3.5-lightning-30b-a3b',
  'muse-spark-1.3-contributor-free': 'openai/gpt-oss-20b',
  'muse-spark-1.2-contributor-free': 'openai/gpt-oss-20b',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCorsHeaders(res, req.headers);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const auth = await requireUser(req.headers);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  const rl = await rateLimit(`zen:${auth.userId}`, 60, 60_000);
  if (rl.unavailable) { res.status(503).json({ error: 'Rate limiter unavailable' }); return; }
  if (!rl.allowed) { res.setHeader('Retry-After', String(Math.ceil((rl.retryAfterMs ?? 0)/1000))); res.status(429).json({ error: 'Rate limit exceeded' }); return; }

  const apiKey = process.env.OPENCODE_ZEN_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'Zen API key not configured' }); return; }

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  let model: string = String(body.model || '');
  // Remap gated free models to working NVIDIA free models
  if (ZEN_FREE_REMAP[model]) {
    const mapped = ZEN_FREE_REMAP[model];
    body.model = mapped;
    model = mapped;
    // For remapped models use NVIDIA directly
    const nvidiaKey = process.env.NVIDIA_API_KEY;
    if (nvidiaKey) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 55000);
      try {
        const upstream = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${nvidiaKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        res.status(upstream.status);
        upstream.headers.forEach((v,k)=>{ if(['content-length','connection','transfer-encoding','content-encoding'].includes(k.toLowerCase())) return; res.setHeader(k,v); });
        if (!upstream.body) { res.send(await upstream.text()); return; }
        if (body.stream && 'fromWeb' in Readable) { res.flushHeaders?.(); Readable.fromWeb(upstream.body as any).pipe(res as any); return; }
        res.send(await upstream.text()); return;
      } catch (e:any) { clearTimeout(timer); if (controller.signal.aborted) { res.status(504).json({error:'NVIDIA timeout'}); return; } throw e; }
    }
  }
  const isResponses = RESPONSES_MODELS.has(model);

  // For responses API, translate chat messages to responses input
  let upstreamBody: any = body;
  let upstreamUrl = ZEN_CHAT_URL;
  if (isResponses) {
    const input = (body.messages || []).map((m: any) => `${m.role}: ${m.content}`).join('\n');
    upstreamBody = { model, input, stream: !!body.stream, max_output_tokens: body.max_tokens || 800 };
    upstreamUrl = ZEN_RESPONSES_URL;
  }

  const UPSTREAM_TIMEOUT_MS = 55000;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(upstreamBody),
        signal: controller.signal,
      });
    } catch (e: any) {
      if (controller.signal.aborted) { res.status(504).json({ error: 'Zen timeout' }); return; }
      throw e;
    } finally { clearTimeout(timer); }

    // For responses streaming, pass through as-is (client handles both formats)
    res.status(upstream.status);
    upstream.headers.forEach((v, k) => {
      if (['content-length','connection','transfer-encoding','content-encoding'].includes(k.toLowerCase())) return;
      res.setHeader(k, v);
    });
    if (!upstream.body) { res.send(await upstream.text()); return; }
    if (body.stream && 'fromWeb' in Readable) { res.flushHeaders?.(); Readable.fromWeb(upstream.body as any).pipe(res as any); return; }
    res.send(await upstream.text());
  } catch (e: any) {
    console.error('Zen proxy error', e);
    res.status(500).json({ error: 'Zen proxy failed', details: String(e?.message || e) });
  }
}
