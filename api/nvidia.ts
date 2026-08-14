import { Readable } from 'node:stream';

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
  res.setHeader('Access-Control-Allow-Origin', '*');
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

  const apiKey = process.env.NVIDIA_API_KEY || process.env.VITE_NVIDIA_API_KEY || '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';
  if (!apiKey) {
    res.status(500).json({ error: 'Missing NVIDIA_API_KEY environment variable' });
    return;
  }

  try {
    const upstream = await fetch(NVIDIA_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body ?? {}),
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
    res.status(500).json({
      error: 'Failed to proxy request to NVIDIA',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
