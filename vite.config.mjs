import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Static ESM imports so the dev middleware never touches Vite's module runner
// (dynamic import() inside middleware throws "Vite module runner has been closed").
const harvestNet = await import('./api/_lib/harvesterNet.mjs');
const harvestCore = await import('./api/_lib/harvestCore.mjs');
const supabaseJs = await import('@supabase/supabase-js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const _require = createRequire(import.meta.url);

// Server-side NVIDIA key loading for the dev proxy. The key is read from the
// server env only (never a VITE_* var, which Vite would inline into the bundle).
const readNvidiaKey = () => {
  if (process.env.NVIDIA_API_KEY) return process.env.NVIDIA_API_KEY;
  for (const file of ['.env.local', '.env']) {
    try {
      const envPath = path.resolve(process.cwd(), file);
      if (fs.existsSync(envPath)) {
        const contents = fs.readFileSync(envPath, 'utf8');
        const match = contents.match(/^NVIDIA_API_KEY=(?:"([^"]+)"|([^"\r\n]+))/m);
        const key = match?.[1] || match?.[2] || '';
        if (key) return key.trim();
      }
    } catch {}
  }
  return '';
};

const readFmpKey = () => {
  try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    const contents = fs.readFileSync(envPath, 'utf8');
    const match = contents.match(/^FMP_API_KEY=(?:"([^"]+)"|([^"\r\n]+))/m);
    return match?.[1] || match?.[2] || '';
  } catch {
    return '';
  }
};

const readFinnhubKey = () => {
  try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    const contents = fs.readFileSync(envPath, 'utf8');
    const match = contents.match(/^FINNHUB_API_KEY=(?:"([^"]+)"|([^"\r\n]+))/m);
    return match?.[1] || match?.[2] || '';
  } catch {
    return '';
  }
};

const readCtraderEnv = (key) => {
  if (process.env[key]) return process.env[key];
  for (const file of ['.env.local', '.env']) {
    try {
      const envPath = path.resolve(process.cwd(), file);
      if (fs.existsSync(envPath)) {
        const contents = fs.readFileSync(envPath, 'utf8');
        const match = contents.match(new RegExp(`^${key}=("(?:[^"\\\\]|\\\\.)*"|[^"\\r\\n]+)`, 'm'));
        if (match) {
          const val = match[1].trim();
          return val.startsWith('"') && val.endsWith('"') ? val.slice(1, -1) : val;
        }
      }
    } catch {}
  }
  // TEMPORARY: restored at user request until credential rotation. These
  // values are already exposed in git history — rotating the cTrader app and
  // deleting these two lines is the real fix. Never add NEW secrets here.
  if (key === 'VITE_CTRADER_CLIENT_ID') return '35508_t8qthF8Rdq0DzmNlxm4WwT0ZlQUggiQaX8uRm6hmQ9xWFz6vmO';
  if (key === 'VITE_CTRADER_CLIENT_SECRET') return 'B7zkapjST4jMGqXkEeRm8daHKaGdgrsl88mujeJdicx2xaKlcd';
  return '';
};

function runPythonScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'scripts', scriptName);

    const python = spawn('python', [scriptPath, ...args], {
      windowsHide: true,
    });

    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0 && errorOutput) {
        reject(new Error(errorOutput.trim()));
      } else {
        try {
          resolve(JSON.parse(output.trim()));
        } catch (e) {
          reject(new Error('Invalid JSON from Python script'));
        }
      }
    });

    python.on('error', (err) => {
      reject(err);
    });

    setTimeout(() => {
      python.kill();
      reject(new Error('Python script timeout'));
    }, 30000);
  });
}

const mt5PythonPlugin = () => {
  return {
    name: 'mt5-python-plugin',
    configureServer(server) {
      const getFmpErrorMessage = (status, details) => {
        if (status === 401) return 'FMP rejected the API key with 401 Unauthorized. Verify the key is active and has access to this endpoint.';
        if (status === 403 || status === 404) return 'This endpoint requires a paid FMP plan. The free plan provides Quote, Profile, Treasury Rates, and Earnings Calendar.';
        if (status === 429) return 'FMP rate limit reached. Wait a moment and try again.';
        return details?.['Error Message'] || details?.message || `FMP returned HTTP ${status}.`;
      };

      const makeFmpHandler = (endpointUrl) => async (req, res) => {
        try {
          const apiKey = readFmpKey() || process.env.FMP_API_KEY;

          if (!apiKey) {
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Missing FMP_API_KEY environment variable' }));
            return;
          }

          const requestUrl = new URL(req.url || '', 'http://127.0.0.1');
          const params = new URLSearchParams({ apikey: apiKey });
          for (const [key, value] of requestUrl.searchParams) {
            if (key !== 'apikey') params.set(key, value);
          }

          const upstream = await fetch(`${endpointUrl}?${params.toString()}`);
          const payload = await upstream.json();

          res.setHeader('Content-Type', 'application/json');
          res.statusCode = upstream.status;
          res.end(JSON.stringify(upstream.ok ? { data: payload } : { error: getFmpErrorMessage(upstream.status, payload), status: upstream.status, details: payload }));
        } catch (error) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message || 'Failed to fetch FMP data' }));
        }
      };

      // FMP Data Tools routes
      server.middlewares.use('/api/fmp/quote', makeFmpHandler('https://financialmodelingprep.com/stable/quote'));
      server.middlewares.use('/api/fmp/profile', makeFmpHandler('https://financialmodelingprep.com/stable/profile'));
      server.middlewares.use('/api/fmp/earnings-calendar', makeFmpHandler('https://financialmodelingprep.com/stable/earnings-calendar'));
      server.middlewares.use('/api/fmp/treasury-rates', makeFmpHandler('https://financialmodelingprep.com/stable/treasury-rates'));
      server.middlewares.use('/api/fmp/key-metrics', makeFmpHandler('https://financialmodelingprep.com/stable/key-metrics-ttm'));
      server.middlewares.use('/api/fmp/income-statement', makeFmpHandler('https://financialmodelingprep.com/stable/income-statement'));
      server.middlewares.use('/api/fmp/balance-sheet', makeFmpHandler('https://financialmodelingprep.com/stable/balance-sheet-statement'));
      server.middlewares.use('/api/fmp/cash-flow', makeFmpHandler('https://financialmodelingprep.com/stable/cash-flow-statement'));
      server.middlewares.use('/api/fmp/ratios', makeFmpHandler('https://financialmodelingprep.com/stable/ratios-ttm'));
      server.middlewares.use('/api/fmp/financial-growth', makeFmpHandler('https://financialmodelingprep.com/stable/financial-growth'));
      server.middlewares.use('/api/fmp/price-change', makeFmpHandler('https://financialmodelingprep.com/stable/stock-price-change'));
      server.middlewares.use('/api/fmp/dcf', makeFmpHandler('https://financialmodelingprep.com/stable/discounted-cash-flow'));

      // In-memory cache for economic calendar to prevent rate-limiting
      let cachedCalendarEvents = null;
      let lastCalendarFetchTime = 0;
      const CALENDAR_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

      server.middlewares.use('/api/economic-calendar', async (req, res) => {
        try {
          if (req.method !== 'GET' && req.method !== 'OPTIONS') {
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.statusCode = 204;
            res.end();
            return;
          }

          const now = Date.now();
          let allEvents = [];

          // Use cache if fresh
          if (cachedCalendarEvents && (now - lastCalendarFetchTime < CALENDAR_CACHE_TTL)) {
            allEvents = cachedCalendarEvents;
          } else {
            const FF_HEADERS = {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/json, text/plain, */*',
            };

            try {
              const upstream = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
                headers: FF_HEADERS,
              });

              if (upstream.ok) {
                const raw = await upstream.json();
                if (Array.isArray(raw)) {
                  for (const item of raw) {
                    const d = new Date(item.date);
                    if (isNaN(d.getTime())) continue;
                    allEvents.push({
                      event: item.title || '',
                      currency: item.country || '',
                      date: d.toISOString().split('T')[0],
                      time: d.toISOString().split('T')[1].slice(0, 8),
                      impact: (item.impact || 'Low').toLowerCase(),
                      forecast: item.forecast || '',
                      previous: item.previous || '',
                      actual: item.actual || '',
                      source: 'forexfactory-cdn',
                    });
                  }

                  if (allEvents.length > 0) {
                    cachedCalendarEvents = allEvents;
                    lastCalendarFetchTime = now;
                  }
                }
              }
            } catch (fetchErr) {
              console.warn('[EconomicCalendar] CDN fetch warning:', fetchErr.message);
            }

            // If fetch failed or was empty, fall back to stale cache
            if (allEvents.length === 0 && cachedCalendarEvents && cachedCalendarEvents.length > 0) {
              allEvents = cachedCalendarEvents;
            }
          }

          // Filter to requested date range if provided
          const requestUrl = new URL(req.url || '', 'http://127.0.0.1');
          const from = requestUrl.searchParams.get('from');
          const to = requestUrl.searchParams.get('to');

          let filtered = allEvents;
          if (from || to) {
            const rangeFiltered = allEvents.filter(e => {
              if (!e.date) return false;
              if (from && e.date < from) return false;
              if (to && e.date > to) return false;
              return true;
            });
            // If date filter matched events, use them; otherwise return all available weekly events
            if (rangeFiltered.length > 0) {
              filtered = rangeFiltered;
            }
          }

          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({
            data: filtered,
            source: 'ForexFactory CDN',
            cached: cachedCalendarEvents ? true : false,
            timestamp: Date.now()
          }));
        } catch (error) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 500;
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Failed to fetch economic calendar data',
          }));
        }
      });

      // Finnhub Data Tools routes
      const getFinnhubErrorMessage = (status) => {
        if (status === 401) return 'Finnhub rejected the API key with 401 Unauthorized. Verify the key is active.';
        if (status === 403) return 'This endpoint requires a paid Finnhub plan.';
        if (status === 429) return 'Finnhub rate limit reached. Wait a moment and try again.';
        return `Finnhub returned HTTP ${status}.`;
      };

      const makeFinnhubHandler = (endpointUrl) => async (req, res) => {
        try {
          const apiKey = readFinnhubKey();

          if (!apiKey) {
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Missing FINNHUB_API_KEY environment variable' }));
            return;
          }

          const requestUrl = new URL(req.url || '', 'http://127.0.0.1');
          const params = new URLSearchParams();
          for (const [key, value] of requestUrl.searchParams) {
            params.set(key, value);
          }
          params.set('token', apiKey);

          const upstream = await fetch(`${endpointUrl}?${params.toString()}`);
          const payload = await upstream.json();

          res.setHeader('Content-Type', 'application/json');
          res.statusCode = upstream.status;
          res.end(JSON.stringify(upstream.ok ? { data: payload } : { error: getFinnhubErrorMessage(upstream.status), status: upstream.status }));
        } catch (error) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message || 'Failed to fetch Finnhub data' }));
        }
      };

      server.middlewares.use('/api/finnhub/market-news', makeFinnhubHandler('https://finnhub.io/api/v1/news'));
      server.middlewares.use('/api/finnhub/company-news', makeFinnhubHandler('https://finnhub.io/api/v1/company-news'));
      server.middlewares.use('/api/finnhub/insider-transactions', makeFinnhubHandler('https://finnhub.io/api/v1/stock/insider-transactions'));
      server.middlewares.use('/api/finnhub/analyst-recommendations', makeFinnhubHandler('https://finnhub.io/api/v1/stock/recommendation'));
      server.middlewares.use('/api/finnhub/economic-calendar', makeFinnhubHandler('https://finnhub.io/api/v1/calendar/economic'));
      server.middlewares.use('/api/finnhub/sec-filings', makeFinnhubHandler('https://finnhub.io/api/v1/stock/filings'));
      server.middlewares.use('/api/finnhub/earnings-surprises', makeFinnhubHandler('https://finnhub.io/api/v1/stock/earnings'));
      server.middlewares.use('/api/finnhub/peer-companies', makeFinnhubHandler('https://finnhub.io/api/v1/stock/peers'));
      server.middlewares.use('/api/finnhub/market-status', makeFinnhubHandler('https://finnhub.io/api/v1/stock/market-status'));

      server.middlewares.use('/api/mt5/connect', async (req, res) => {
        try {
          const data = await runPythonScript('mt5.py', []);

          if (data.error) {
            throw new Error(data.error);
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            success: true,
            login: data.login,
            server: data.server,
            balance: data.balance,
            equity: data.equity,
            margin: data.margin,
            free_margin: data.free_margin,
            profit: data.profit,
            currency: data.currency,
          }));
        } catch (error) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 400;
          res.end(JSON.stringify({
            success: false,
            error: error.message || 'Could not connect to MT5',
          }));
        }
      });

      server.middlewares.use('/api/mt5/status', async (req, res) => {
        try {
          const data = await runPythonScript('mt5.py', ['status']);

          if (data.error) {
            throw new Error(data.error);
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            connected: true,
            login: data.login,
            server: data.server,
            balance: data.balance,
            equity: data.equity,
            margin: data.margin,
            free_margin: data.free_margin,
            profit: data.profit,
          }));
        } catch (error) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 400;
          res.end(JSON.stringify({
            connected: false,
            error: error.message,
          }));
        }
      });

      const routeCache = new Map();
      const MAX_CACHE_SIZE = 200;
      const CACHE_TTL_MS = 6000;

      const getCachedOrRun = async (cacheKey, runFn) => {
        const cached = routeCache.get(cacheKey);
        const now = Date.now();
        if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
          return cached.data;
        }

        const data = await runFn();
        if (data && !data.error) {
          // Bounded cache eviction if size grows too large
          if (routeCache.size >= MAX_CACHE_SIZE && !routeCache.has(cacheKey)) {
            const firstKey = routeCache.keys().next().value;
            if (firstKey !== undefined) routeCache.delete(firstKey);
          }
          routeCache.set(cacheKey, { timestamp: Date.now(), data });
        }
        return data;
      };

      server.middlewares.use('/api/mt5/positions', async (req, res) => {
        try {
          const cacheKey = '/api/mt5/positions';
          const data = await getCachedOrRun(cacheKey, () => runPythonScript('mt5.py', ['positions']));

          // Map to EAPosition shape expected by EASetup.tsx (open_price not price_open)
          const mapped = (data.positions || []).map(p => ({
            ticket: p.ticket,
            symbol: p.symbol,
            type: p.type,
            volume: p.volume,
            open_price: p.price_open,
            current_price: p.price_current,
            profit: p.profit,
            sl: p.sl,
            tp: p.tp,
            magic: p.magic,
            comment: p.comment,
            time: p.time,
          }));

          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({
            openPositions: mapped,
            positions: mapped,
            count: mapped.length,
          }));
        } catch (error) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 400;
          res.end(JSON.stringify({ error: error.message }));
        }
      });

      // /api/mt5/account — account info in EASetup-compatible shape
      server.middlewares.use('/api/mt5/account', async (req, res) => {
        try {
          const cacheKey = '/api/mt5/account';
          const data = await getCachedOrRun(cacheKey, () => runPythonScript('mt5.py', []));

          if (data.error) throw new Error(data.error);

          const account = {
            login: data.login,
            server: data.server,
            balance: data.balance,
            equity: data.equity,
            margin: data.margin,
            free_margin: data.free_margin,
            profit: data.profit,
            currency: data.currency,
            name: data.name,
            company: data.company,
            is_demo: true,
          };

          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({
            isHeartbeat: true,
            account,
            // Also expose flat fields for BrokerConnect compatibility
            broker_login: String(data.login),
            broker_server: data.server,
            account_name: data.name,
            account_type: data.company,
            balance: data.balance,
            equity: data.equity,
            currency: data.currency,
            broker_sync_enabled: true,
            mt_terminal_status: 'connected',
            last_sync_at: new Date().toISOString(),
          }));
        } catch (error) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 400;
          res.end(JSON.stringify({ connected: false, error: error.message }));
        }
      });

      // /api/mt5/history — closed deals in EASetup-compatible shape
      server.middlewares.use('/api/mt5/history', async (req, res) => {
        try {
          const requestUrl = new URL(req.url || '', 'http://127.0.0.1');
          const fromVal = requestUrl.searchParams.get('from') || '';
          const toVal = requestUrl.searchParams.get('to') || '';

          const cacheKey = `/api/mt5/history?from=${fromVal}&to=${toVal}`;
          const data = await getCachedOrRun(cacheKey, () => {
            const args = [];
            if (fromVal && toVal) {
              args.push(fromVal, toVal);
            }
            return runPythonScript('get_history.py', args);
          });

          const deals = data.deals || [];

          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({
            isHeartbeat: false,
            trades: deals,   // EASetup reads histData.trades
            deals,
          }));
        } catch (error) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 400;
          res.end(JSON.stringify({ trades: [], deals: [], error: error.message }));
        }
      });



      server.middlewares.use('/api/mt5/open', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        try {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          await new Promise((resolve) => req.on('end', resolve));
          const { symbol, volume, direction, sl, tp } = JSON.parse(body);

          const result = await runPythonScript('mt5.py', [
            'open',
            symbol,
            String(volume || 0.01),
            direction || 'BUY',
            String(sl || 0),
            String(tp || 0),
          ]);

          if (result.error) {
            throw new Error(result.error);
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (error) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 400;
          res.end(JSON.stringify({ error: error.message }));
        }
      });

      server.middlewares.use('/api/mt5/close', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        try {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          await new Promise((resolve) => req.on('end', resolve));
          const { ticket } = JSON.parse(body);

          if (!ticket) {
            throw new Error('Ticket required');
          }

          const result = await runPythonScript('mt5.py', ['close', String(ticket)]);

          if (result.error) {
            throw new Error(result.error);
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (error) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 400;
          res.end(JSON.stringify({ error: error.message }));
        }
      });

const readCtraderEnvScoped = (key) => readCtraderEnv(key);

      // -----------------------------------------------------------------------
      // /api/candles — shared candle store (dev middleware mirroring
      // api/candles/index.ts). Reads Supabase directly with the service role
      // key from .env.local. No auth: public read, same as production RLS.
      // -----------------------------------------------------------------------
      server.middlewares.use('/api/candles/harvest', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
        try {
          const { createServiceSession, listSymbols, fetchTrendbarsServer, closeSession } = harvestNet;
          const { mergeBars, capToNewest } = harvestCore;
          const { createClient } = supabaseJs;
          const url = readCtraderEnv('SUPABASE_URL') || process.env.VITE_SUPABASE_URL || '';
          const key = readCtraderEnv('SUPABASE_SERVICE_ROLE_KEY') || '';
          if (!url || !key) { res.statusCode = 503; res.end(JSON.stringify({ error: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local' })); return; }
          const supabase = createClient(url, key);

          // Service-account credentials come from .env.local via readCtraderEnv
          // (vite middleware runs outside Vercel's process.env injection).
          const session = await createServiceSession({
            refreshToken: readCtraderEnv('CTRADER_SERVICE_REFRESH_TOKEN') || '',
            accountId: Number(readCtraderEnv('CTRADER_SERVICE_ACCOUNT_ID') || 0),
            isDemo: readCtraderEnv('CTRADER_SERVICE_IS_DEMO') || 'true',
            clientId: readCtraderEnv('VITE_CTRADER_CLIENT_ID') || process.env.CTRADER_CLIENT_ID || '',
            clientSecret: readCtraderEnv('VITE_CTRADER_CLIENT_SECRET') || process.env.CTRADER_CLIENT_SECRET || '',
          });

          const timeframes = (readCtraderEnv('HARVEST_TIMEFRAMES') || 'M15,H1,H4,D1').split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
          const batchSize = Math.max(1, Number(readCtraderEnv('HARVEST_BATCH_SIZE') || 5));
          const MAX_BARS = 2000;

          let { data: queue } = await supabase.from('harvest_queue')
            .select('id, symbol, symbol_id, digits, timeframe')
            .eq('status', 'pending').order('id', { ascending: true }).limit(batchSize);

          if (!queue || queue.length === 0) {
            const targets = await listSymbols(session);
            const rows = targets.flatMap(t => timeframes.map(tf => ({ symbol: t.symbolName, symbol_id: t.symbolId, digits: t.digits, timeframe: tf })));
            if (rows.length > 0) {
              await supabase.from('harvest_queue').upsert(rows, { onConflict: 'symbol_id,timeframe', ignoreDuplicates: true });
            }
            ({ data: queue } = await supabase.from('harvest_queue')
              .select('id, symbol, symbol_id, digits, timeframe')
              .eq('status', 'pending').order('id', { ascending: true }).limit(batchSize));
          }

          if (!queue || queue.length === 0) {
            closeSession(session);
            res.end(JSON.stringify({ ok: true, processed: 0, remaining: 0, note: 'queue empty or fully seeded' }));
            return;
          }

          let processed = 0;
          const errors = [];
          for (const job of queue) {
            try {
              const target = { symbolName: job.symbol, symbolId: job.symbol_id, digits: job.digits };
              const incoming = await fetchTrendbarsServer(session, target, job.timeframe, { count: MAX_BARS });
              const { data: existingRow } = await supabase.from('candle_series')
                .select('bars').eq('symbol', job.symbol).eq('timeframe', job.timeframe).maybeSingle();
              const merged = capToNewest(mergeBars(Array.isArray(existingRow?.bars) ? existingRow.bars : null, incoming), MAX_BARS);
              const { error: upsertErr } = await supabase.from('candle_series').upsert({
                symbol: job.symbol, timeframe: job.timeframe, bars: merged,
                bar_count: merged.length,
                last_bar_time: merged.length > 0 ? merged[merged.length - 1].time : 0,
                digits: job.digits, updated_at: new Date().toISOString(),
              }, { onConflict: 'symbol,timeframe' });
              if (upsertErr) throw upsertErr;
              await supabase.from('harvest_queue').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', job.id);
              processed++;
            } catch (err) {
              errors.push(`${job.symbol}/${job.timeframe}: ${err?.message || err}`);
              await supabase.from('harvest_queue').update({ status: 'error', updated_at: new Date().toISOString() }).eq('id', job.id);
              break;
            }
          }

          const { count: remaining } = await supabase.from('harvest_queue')
            .select('id', { count: 'exact', head: true }).eq('status', 'pending');

          closeSession(session);
          res.end(JSON.stringify({ ok: errors.length === 0, processed, remaining: remaining ?? 0, errors }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err?.message || String(err) }));
        }
      });

      server.middlewares.use('/api/candles', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'GET') { res.statusCode = 405; res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
        try {
          const requestUrl = new URL(req.url || '', 'http://127.0.0.1');
          const symbol = (requestUrl.searchParams.get('symbol') || '').toUpperCase().replace(/[/_]/g, '');
          const timeframe = (requestUrl.searchParams.get('timeframe') || '').toUpperCase();
          const since = Number(requestUrl.searchParams.get('since') || 0);
          if (!symbol || !timeframe) { res.statusCode = 400; res.end(JSON.stringify({ error: 'symbol and timeframe are required' })); return; }

          const { createClient } = supabaseJs;
          const url = readCtraderEnv('SUPABASE_URL') || process.env.VITE_SUPABASE_URL || '';
          const key = readCtraderEnv('SUPABASE_SERVICE_ROLE_KEY') || process.env.VITE_SUPABASE_ANON_KEY || '';
          if (!url || !key) { res.statusCode = 503; res.end(JSON.stringify({ error: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local' })); return; }
          const supabase = createClient(url, key);

          const { data, error } = await supabase.from('candle_series')
            .select('symbol,timeframe,bars,bar_count,last_bar_time,digits,updated_at')
            .eq('symbol', symbol).eq('timeframe', timeframe).limit(1);
          if (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); return; }
          const row = data?.[0];
          if (!row) { res.statusCode = 404; res.end(JSON.stringify({ error: 'not_found' })); return; }
          const bars = Array.isArray(row.bars) ? (since > 0 ? row.bars.filter(b => Number(b?.time) > since) : row.bars) : [];
          res.setHeader('Cache-Control', 'public, max-age=60');
          res.end(JSON.stringify({
            symbol: row.symbol, timeframe: row.timeframe, bar_count: row.bar_count,
            last_bar_time: row.last_bar_time, digits: row.digits, updated_at: row.updated_at, bars,
          }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err?.message || String(err) }));
        }
      });

      // Redirect cTrader OAuth callback to root so Vite serves the SPA through its normal pipeline
      server.middlewares.use('/api/ctrader/callback', async (req, res) => {
        const requestUrl = new URL(req.url || '', 'http://127.0.0.1');
        const code = requestUrl.searchParams.get('code');
        const target = code ? `/?code=${encodeURIComponent(code)}` : '/';
        res.statusCode = 302;
        res.setHeader('Location', target);
        res.end();
      });

      server.middlewares.use('/api/ctrader/exchange', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        const requestUrl = new URL(req.url || '', 'http://127.0.0.1');
        const code = requestUrl.searchParams.get('code');
        const redirectUri = requestUrl.searchParams.get('redirect_uri');

        if (!code || !redirectUri) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Missing code or redirect_uri' }));
          return;
        }

        const cid = readCtraderEnv('VITE_CTRADER_CLIENT_ID');
        const csec = readCtraderEnv('VITE_CTRADER_CLIENT_SECRET');

        if (!cid || !csec) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'cTrader credentials not found in .env.local' }));
          return;
        }

        try {
          const tokenUrl = new URL('https://openapi.ctrader.com/apps/token');
          tokenUrl.searchParams.set('grant_type', 'authorization_code');
          tokenUrl.searchParams.set('code', code);
          tokenUrl.searchParams.set('redirect_uri', redirectUri);
          tokenUrl.searchParams.set('client_id', cid);
          tokenUrl.searchParams.set('client_secret', csec);

          console.log('[cTrader] exchanging code via', tokenUrl.toString().replace(csec, '***'));

          const tokenRes = await fetch(tokenUrl.toString(), {
            headers: { Accept: 'application/json' },
          });

          const rawText = await tokenRes.text();
          let body;
          try { body = JSON.parse(rawText); } catch { body = {}; }

          console.log('[cTrader] token response', tokenRes.status, body);

          if (!tokenRes.ok) {
            const errMsg = body?.description || body?.error_description || body?.error || rawText;
            console.warn('[cTrader] exchange HTTP error:', tokenRes.status, errMsg);
            res.statusCode = 502;
            res.end(JSON.stringify({ error: errMsg || 'Token exchange failed', status: tokenRes.status, details: body }));
            return;
          }

          // cTrader sometimes returns HTTP 200 with an errorCode field
          if (body.errorCode) {
            const errMsg = body.description || body.errorCode;
            console.warn('[cTrader] exchange errorCode:', body.errorCode, body.description);
            res.statusCode = 400;
            res.end(JSON.stringify({ error: errMsg, errorCode: body.errorCode }));
            return;
          }

          // Mirror the production endpoint: keep the long-lived refresh token
          // in an httpOnly cookie so silent re-auth survives page reloads.
          if (body.refreshToken) {
            res.setHeader('Set-Cookie', `jfx_ctrader_refresh=${encodeURIComponent(String(body.refreshToken))}; Path=/; HttpOnly; SameSite=Lax`);
          }

          res.end(JSON.stringify({
            accessToken: body.accessToken,
            refreshToken: body.refreshToken,
            expiresIn: body.expiresIn,
          }));
        } catch (err) {
          console.error('[cTrader] exchange exception:', err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message || 'Exchange failed' }));
        }
      });

      // -----------------------------------------------------------------------
      // /api/ctrader/accounts — server-side account fetching via Node.js WebSocket
      // Bypasses browser port/TLS restrictions entirely.
      // -----------------------------------------------------------------------
      server.middlewares.use('/api/ctrader/accounts', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

        const authHeader = req.headers['authorization'] || '';
        const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (!accessToken) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: 'Missing Authorization header' }));
          return;
        }

        const cid = readCtraderEnv('VITE_CTRADER_CLIENT_ID');
        const csec = readCtraderEnv('VITE_CTRADER_CLIENT_SECRET');
        if (!cid || !csec) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'cTrader credentials not configured' }));
          return;
        }

        const fetchFromEnv = (host) => new Promise((resolve) => {
          let WebSocketLib;
          try { WebSocketLib = _require('ws'); } catch (e) {
            console.error('[cTrader] Failed to require ws:', e.message);
            resolve([]); return;
          }

          console.log(`[cTrader] Connecting to wss://${host}:5036 ...`);
          const ws = new WebSocketLib(`wss://${host}:5036`);
          const timeout = setTimeout(() => {
            console.warn(`[cTrader] Timeout connecting to ${host}`);
            try { ws.close(); } catch {}
            resolve([]);
          }, 15000);
          let settled = false;
          const done = (val) => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              try { ws.close(); } catch {}
              resolve(val);
            }
          };

          let msgId = 0;
          const pending = new Map();
          const send = (payloadType, payload) => new Promise((res2, rej2) => {
            const clientMsgId = `srv_${++msgId}`;
            pending.set(clientMsgId, { resolve: res2, reject: rej2 });
            const msg = JSON.stringify({ clientMsgId, payloadType, payload });
            console.log(`[cTrader][${host}] SEND payloadType=${payloadType}`);
            ws.send(msg);
          });

          ws.on('message', (data) => {
            try {
              const msg = JSON.parse(data.toString());
              console.log(`[cTrader][${host}] RECV payloadType=${msg.payloadType} clientMsgId=${msg.clientMsgId}`);
              if (msg.clientMsgId && pending.has(msg.clientMsgId)) {
                const p = pending.get(msg.clientMsgId);
                pending.delete(msg.clientMsgId);
                if (msg.payloadType === 2142) p.reject(new Error(msg.payload?.errorCode || 'cTrader error'));
                else p.resolve(msg.payload);
              }
            } catch (e) { console.warn(`[cTrader][${host}] parse error:`, e.message); }
          });

          ws.on('error', (e) => { console.error(`[cTrader][${host}] WS error:`, e.message); done([]); });
          ws.on('close', (code, reason) => { console.log(`[cTrader][${host}] WS closed code=${code} reason=${reason}`); done([]); });
          ws.on('open', async () => {
            console.log(`[cTrader][${host}] WS connected`);
            try {
              const cid = readCtraderEnv('VITE_CTRADER_CLIENT_ID');
              const csec = readCtraderEnv('VITE_CTRADER_CLIENT_SECRET');
              // 1. Authenticate the application
              const appAuthRes = await send(2100, { clientId: cid, clientSecret: csec });
              console.log(`[cTrader][${host}] App auth response:`, JSON.stringify(appAuthRes));
              // 2. Get accounts by token (ProtoOAGetAccountListByAccessTokenReq = 2149)
              const accountList = await send(2149, { accessToken });
              console.log(`[cTrader][${host}] Account list:`, JSON.stringify(accountList));
              const raw = accountList?.ctidTraderAccount || [];
              const isDemo = host.includes('demo');
              const mapped = raw.map((acc) => ({
                ctidTraderAccountId: Number(acc.ctidTraderAccountId),
                login: String(acc.traderLogin ?? acc.login ?? ''),
                server: acc.server || '',
                isDemo: acc.isLive === true ? false : acc.isLive === false ? true : isDemo,
                currency: acc.currency || 'USD',
                balance: Number(acc.balance ?? 0),
                equity: Number(acc.equity ?? 0),
                profit: Number(acc.profit ?? 0),
                margin: Number(acc.margin ?? 0),
                freeMargin: Number(acc.freeMargin ?? 0),
                name: acc.name || `Account #${acc.traderLogin ?? acc.ctidTraderAccountId}`,
                depositAssetId: Number(acc.depositAssetId ?? 0),
              }));
              console.log(`[cTrader][${host}] Mapped ${mapped.length} accounts`);
              done(mapped);
            } catch (e) {
              console.error(`[cTrader][${host}] accounts fetch error:`, e?.message);
              done([]);
            }
          });
        });

        try {
          const demoAccs = await fetchFromEnv('demo.ctraderapi.com');
          const liveAccs = await fetchFromEnv('live.ctraderapi.com');
          const merged = [...demoAccs, ...liveAccs];
          const seen = new Map();
          for (const acc of merged) {
            if (!seen.has(acc.ctidTraderAccountId)) {
              seen.set(acc.ctidTraderAccountId, acc);
            }
          }
          const all = Array.from(seen.values());
          console.log(`[cTrader] /api/ctrader/accounts → ${all.length} accounts (${demoAccs.length} demo, ${liveAccs.length} live)`);
          res.statusCode = 200;
          res.end(JSON.stringify({ accounts: all }));
        } catch (err) {
          console.error('[cTrader] accounts endpoint error:', err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message || 'Failed to fetch accounts' }));
        }
      });

      // -----------------------------------------------------------------------
      // /api/ctrader/refresh — server-side token refresh
      // -----------------------------------------------------------------------
      server.middlewares.use('/api/ctrader/refresh', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

        let rawBody = '';
        req.on('data', (chunk) => { rawBody += chunk; });
        req.on('end', async () => {
          try {
            // Prefer the httpOnly cookie set by /api/ctrader/exchange above,
            // falling back to the JSON body the client sends in dev.
            let refreshToken = '';
            const cookieHeader = req.headers.cookie || '';
            for (const part of cookieHeader.split(';')) {
              const eq = part.indexOf('=');
              if (eq === -1) continue;
              if (part.slice(0, eq).trim() === 'jfx_ctrader_refresh') {
                const rawVal = part.slice(eq + 1).trim();
                try { refreshToken = decodeURIComponent(rawVal); } catch { refreshToken = rawVal; }
              }
            }
            if (!refreshToken) {
              try {
                const parsed = JSON.parse(rawBody || '{}');
                refreshToken = parsed.refresh_token || parsed.refreshToken || '';
              } catch { /* ignore malformed body */ }
            }
            if (!refreshToken) { res.statusCode = 401; res.end(JSON.stringify({ error: 'Missing cTrader session' })); return; }

            const cid = readCtraderEnv('VITE_CTRADER_CLIENT_ID');
            const csec = readCtraderEnv('VITE_CTRADER_CLIENT_SECRET');

            const tokenUrl = new URL('https://openapi.ctrader.com/apps/token');
            tokenUrl.searchParams.set('grant_type', 'refresh_token');
            tokenUrl.searchParams.set('refresh_token', refreshToken);
            tokenUrl.searchParams.set('client_id', cid);
            tokenUrl.searchParams.set('client_secret', csec);

            const tokenRes = await fetch(tokenUrl.toString(), { headers: { Accept: 'application/json' } });
            const data = await tokenRes.json().catch(() => ({}));
            if (!tokenRes.ok || !data.accessToken) {
              console.warn('[cTrader] refresh failed:', tokenRes.status, data?.error || data?.errorCode || '');
              res.statusCode = 502;
              res.end(JSON.stringify({ error: data?.error || 'Refresh failed' }));
              return;
            }

            // Rotate the cookie when cTrader issues a new refresh token.
            if (data.refreshToken) {
              res.setHeader('Set-Cookie', `jfx_ctrader_refresh=${encodeURIComponent(String(data.refreshToken))}; Path=/; HttpOnly; SameSite=Lax`);
            }
            res.statusCode = 200;
            // Respond with both naming conventions so the client and any
            // server-side consumers can read the fields.
            res.end(JSON.stringify({
              access_token: data.accessToken,
              expires_in: data.expiresIn,
              refresh_token: data.refreshToken,
              accessToken: data.accessToken,
              expiresIn: data.expiresIn,
              refreshToken: data.refreshToken,
            }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message || 'Refresh error' }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './test/setup.ts',
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-charts': ['lightweight-charts'],
            'vendor-tiptap': [
              '@tiptap/react',
              '@tiptap/starter-kit',
              '@tiptap/extension-image',
              '@tiptap/extension-link',
              '@tiptap/extension-table',
              '@tiptap/extension-color',
              '@tiptap/extension-text-style',
              '@tiptap/extension-underline',
              '@tiptap/extension-task-list',
              '@tiptap/extension-task-item',
            ],
            'vendor-ui': ['@dnd-kit/core', '@dnd-kit/sortable', 'motion', 'lucide-react'],
            'vendor-ai': ['@google/generative-ai', 'agentation'],
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },
    server: {
      port: 3000,
      host: '127.0.0.1',
      hmr: {
        host: '127.0.0.1',
        protocol: 'ws',
      },
      proxy: {
        '/ctrader-ws/demo': {
          target: 'wss://demo.ctraderapi.com:5036',
          ws: true,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => '/',
        },
        '/ctrader-ws/live': {
          target: 'wss://live.ctraderapi.com:5036',
          ws: true,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => '/',
        },
        '/api/nvidia': {
          target: 'https://integrate.api.nvidia.com',
          changeOrigin: true,
          secure: true,
          rewrite: () => '/v1/chat/completions',
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              const nvidiaKey = readNvidiaKey();
              if (nvidiaKey) {
                proxyReq.setHeader('Authorization', `Bearer ${nvidiaKey}`);
              }
            });
          },
        },
      },
    },
    plugins: [react(), mt5PythonPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'use-sync-external-store/shim': path.resolve(__dirname, 'shims/use-sync-external-store/shim'),
      },
    },
    optimizeDeps: {
      noDiscovery: true,
      entries: ['index.html'],
      include: [
        '@dnd-kit/core',
        '@dnd-kit/sortable',
        '@dnd-kit/utilities',
        '@supabase/supabase-js',
        '@tabler/icons-react',
        '@tiptap/react',
        '@tiptap/starter-kit',
        '@tiptap/extension-bubble-menu',
        '@tiptap/extension-color',
        '@tiptap/extension-image',
        '@tiptap/extension-link',
        '@tiptap/extension-placeholder',
        '@tiptap/extension-table',
        '@tiptap/extension-table-cell',
        '@tiptap/extension-table-header',
        '@tiptap/extension-table-row',
        '@tiptap/extension-task-item',
        '@tiptap/extension-task-list',
        '@tiptap/extension-text-style',
        '@tiptap/extension-underline',
        'agentation',
        'canvas-confetti',
        'clsx',
        'lightweight-charts',
        'lucide-react',
        'mermaid',
        'motion',
        'openai',
        'react',
        'react-dom',
        'react-dom/client',
        'react-joyride',
        'react-markdown',
        'react-window',
        'recharts',
        'remark-gfm',
        'tailwind-merge',
      ],
      exclude: ['@google/generative-ai'],
    },
  };
});
