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
const harvestCore = await import('./api/_lib/harvestCore.js');
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
      // The dev server is a single process, so these maps prevent concurrent
      // browser requests from consuming the same rotating cTrader refresh
      // token. Production uses the database-backed lease in its API route.
      const ctraderAccessCache = new Map();
      const ctraderRefreshInFlight = new Map();
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
            clientId: readCtraderEnv('CTRADER_CLIENT_ID') || readCtraderEnv('VITE_CTRADER_CLIENT_ID') || '',
            clientSecret: readCtraderEnv('CTRADER_CLIENT_SECRET') || '',
            // cTrader rotates refresh tokens on every mint — persist the
            // latest one so subsequent runs (and the Vercel cron) keep working.
            loadRotatedToken: async () => {
              const { data } = await supabase.from('service_config').select('value').eq('key', 'ctrader_service_refresh_token').maybeSingle();
              return data?.value || null;
            },
            saveRotatedToken: async (token) => {
              await supabase.from('service_config').upsert({ key: 'ctrader_service_refresh_token', value: token }, { onConflict: 'key' });
            },
          });

          const timeframes = (readCtraderEnv('HARVEST_TIMEFRAMES') || 'M1,M5,M15,M30,H1,H4,D1').split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
          const batchSize = Math.max(1, Number(readCtraderEnv('HARVEST_BATCH_SIZE') || 5));
          const MAX_BARS = 2000;
          // Overfetch: cTrader sometimes returns one fewer bar than requested;
          // capToNewest below discards the surplus. See api/candles/harvest.ts.
          const FETCH_COUNT = MAX_BARS + 100;

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
              const incoming = await fetchTrendbarsServer(session, target, job.timeframe, { count: FETCH_COUNT });
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
        const state = requestUrl.searchParams.get('state');
        const target = code ? `/?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}` : '/';
        res.statusCode = 302;
        res.setHeader('Location', target);
        res.end();
      });

      server.middlewares.use('/api/ctrader/exchange', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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

        const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
        const jwt = String(authHeader).replace(/^Bearer\s+/i, '').trim();
        const supabaseUrl = readCtraderEnv('SUPABASE_URL') || process.env.VITE_SUPABASE_URL || '';
        const anonKey = readCtraderEnv('SUPABASE_ANON_KEY') || process.env.VITE_SUPABASE_ANON_KEY || '';
        let verifiedUserId = null;
        try {
          const client = supabaseJs.createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
          const { data, error } = await client.auth.getUser(jwt);
          if (!error && data?.user?.id) verifiedUserId = data.user.id;
        } catch {}
        if (!verifiedUserId) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: 'Invalid or expired session' }));
          return;
        }

        const cid = readCtraderEnv('CTRADER_CLIENT_ID') || readCtraderEnv('VITE_CTRADER_CLIENT_ID');
        const csec = readCtraderEnv('CTRADER_CLIENT_SECRET');

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

          console.log('[cTrader] token response', tokenRes.status, body?.errorCode || 'ok');

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

          if (!body.accessToken || !body.refreshToken) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: 'cTrader exchange returned an incomplete token response' }));
            return;
          }

          // Keep cTrader credentials server-side. The database write is
          // required before acknowledging a connection because cTrader
          // refresh tokens are single-use after their next rotation.
          const surl = readCtraderEnv('SUPABASE_URL') || process.env.VITE_SUPABASE_URL || '';
          const skey = readCtraderEnv('SUPABASE_SERVICE_ROLE_KEY') || '';
          if (!surl || !skey) {
            res.statusCode = 503;
            res.end(JSON.stringify({ error: 'Supabase service configuration is required to save the cTrader connection.' }));
            return;
          }
          const expiresIn = Number(body.expiresIn || body.expires_in);
          const accessTokenExpiresAt = new Date(Date.now() + (Number.isFinite(expiresIn) ? Math.max(60, expiresIn) : 300) * 1000).toISOString();
          const tokenRecord = JSON.stringify({
            user_id: verifiedUserId,
            refresh_token: String(body.refreshToken),
            access_token: String(body.accessToken),
            access_token_expires_at: accessTokenExpiresAt,
            updated_at: new Date().toISOString(),
          });
          const dbHeaders = { 'Content-Type': 'application/json', apikey: skey, Authorization: `Bearer ${skey}` };
          try {
            const upsert = await fetch(`${surl}/rest/v1/user_ctrader_tokens`, {
              method: 'POST', headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates' }, body: tokenRecord,
            });
            if (!upsert.ok) {
              const patch = await fetch(`${surl}/rest/v1/user_ctrader_tokens?user_id=eq.${verifiedUserId}`, {
                method: 'PATCH', headers: dbHeaders, body: tokenRecord,
              });
              if (!patch.ok) throw new Error(`token persistence failed (HTTP ${patch.status})`);
            }
            ctraderAccessCache.set(verifiedUserId, { accessToken: String(body.accessToken), expiresAt: Date.parse(accessTokenExpiresAt) });
            void fetch(`${surl}/rest/v1/service_config`, {
              method: 'POST',
              headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates' },
              body: JSON.stringify({ key: `ctrader_refresh_${verifiedUserId}`, value: String(body.refreshToken) }),
            }).catch(() => {});
          } catch (err) {
            console.warn('[cTrader dev] DB persist exception:', err);
            res.statusCode = 503;
            res.end(JSON.stringify({ error: 'Could not securely save the cTrader connection. Please try again.' }));
            return;
          }

          res.setHeader('Set-Cookie', `jfx_ctrader_refresh=${encodeURIComponent(String(body.refreshToken))}; Path=/; HttpOnly; SameSite=Lax`);

          res.end(JSON.stringify({ ok: true }));
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

        const cid = readCtraderEnv('CTRADER_CLIENT_ID') || readCtraderEnv('VITE_CTRADER_CLIENT_ID');
        const csec = readCtraderEnv('CTRADER_CLIENT_SECRET');
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
              const cid = readCtraderEnv('CTRADER_CLIENT_ID') || readCtraderEnv('VITE_CTRADER_CLIENT_ID');
              const csec = readCtraderEnv('CTRADER_CLIENT_SECRET');
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
      // /api/ctrader/trade — local dev mirror of api/ctrader/trade.ts (API-key auth + live execution)
      // -----------------------------------------------------------------------
      server.middlewares.use('/api/ctrader/trade', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Access-Token');
        if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

        const TOKEN_PATTERN = /^jfx_pat_[a-z0-9]{8}_[A-Za-z0-9]{32}$/;
        const PT_DEV = { APPLICATION_AUTH_REQ: 2100, ACCOUNT_AUTH_REQ: 2102, NEW_ORDER_REQ: 2106, CANCEL_ORDER_REQ: 2108, AMEND_ORDER_REQ: 2109, AMEND_POSITION_SLTP_REQ: 2110, CLOSE_POSITION_REQ: 2111, SYMBOLS_LIST_REQ: 2114, TRADER_REQ: 2121, RECONCILE_REQ: 2124, SUBSCRIBE_SPOTS_REQ: 2127, UNSUBSCRIBE_SPOTS_REQ: 2129, SPOT_EVENT: 2131, GET_TRENDBARS_REQ: 2137, EXPECTED_MARGIN_REQ: 2139, CASH_FLOW_HISTORY_LIST_REQ: 2143, GET_ACCOUNTS_BY_TOKEN_REQ: 2149, GET_CTID_PROFILE_BY_TOKEN_REQ: 2151, HEARTBEAT_EVENT: 51, ERROR_RES: 2142 };
        const toVolumeCentsDev = (v) => v >= 500 ? Math.round(v * 100) : Math.round(v * 10000000);
        const hashTokenDev = (raw) => { try { const c = _require('crypto'); return c.createHash('sha256').update(raw).digest('hex'); } catch { return raw; } };
        const openCtraderSessionDev = (host, clientId, clientSecret, ctidTraderAccountId, accessToken, timeoutMs = 25000) => new Promise((resolve, reject) => {
          let ws; try { ws = new (_require('ws'))(`wss://${host}:5036`); } catch (e) { return reject(e); }
          const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error(`Connection timeout to ${host}`)); }, timeoutMs);
          let msgId = 0; const pending = new Map(); const eventListeners = new Set();
          const send = (payloadType, payload) => new Promise((res2, rej2) => {
            const clientMsgId = `dev_${++msgId}_${Date.now()}`; pending.set(clientMsgId, { resolve: res2, reject: rej2 }); ws.send(JSON.stringify({ clientMsgId, payloadType, payload }));
          });
          ws.on('message', (data) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.clientMsgId && pending.has(msg.clientMsgId)) {
                const p = pending.get(msg.clientMsgId); pending.delete(msg.clientMsgId);
                if (msg.payloadType === PT_DEV.ERROR_RES) p.reject(new Error(msg.payload?.description || msg.payload?.errorCode || 'cTrader Error')); else p.resolve(msg.payload);
              }
              for (const listener of eventListeners) {
                try { listener(msg.payloadType, msg.payload || {}); } catch {}
              }
            } catch {}
          });
          ws.on('error', (err) => { clearTimeout(timer); reject(err); });
          ws.on('open', async () => {
            try { await send(PT_DEV.APPLICATION_AUTH_REQ, { clientId, clientSecret }); if (ctidTraderAccountId && ctidTraderAccountId > 0) await send(PT_DEV.ACCOUNT_AUTH_REQ, { ctidTraderAccountId, accessToken }); clearTimeout(timer); resolve({ send, onEvent: (listener) => { eventListeners.add(listener); return () => eventListeners.delete(listener); }, heartbeat: () => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ clientMsgId: `heartbeat_${Date.now()}`, payloadType: PT_DEV.HEARTBEAT_EVENT, payload: {} })); }, close: () => { try { ws.close(); } catch {} } }); } catch (err) { clearTimeout(timer); try { ws.close(); } catch {} reject(err); }
          });
        });
        const mintAccessTokenDev = async (clientId, clientSecret, refreshToken) => {
          const u = new URL('https://openapi.ctrader.com/apps/token');
          u.searchParams.set('grant_type', 'refresh_token'); u.searchParams.set('refresh_token', refreshToken); u.searchParams.set('client_id', clientId); u.searchParams.set('client_secret', clientSecret);
          const r = await fetch(u.toString(), { headers: { Accept: 'application/json' } }); const b = await r.json().catch(() => ({}));
          if (!r.ok || b.errorCode || !b.accessToken) throw new Error(b.description || b.errorCode || `cTrader refresh failed (HTTP ${r.status})`);
          return {
            accessToken: String(b.accessToken),
            refreshToken: b.refreshToken ? String(b.refreshToken) : null,
            expiresInSeconds: Number.isFinite(Number(b.expiresIn || b.expires_in)) ? Math.max(60, Number(b.expiresIn || b.expires_in)) : 300,
          };
        };

        let rawBody = '';
        try {
          await new Promise((resolve) => {
            if (req.method === 'GET' || req.method === 'HEAD') return resolve();
            req.on('data', (c) => { rawBody += c; });
            req.on('end', resolve);
            req.on('error', resolve);
            setTimeout(resolve, 2000);
          });
        } catch {}
        let body = {};
        try {
          const cleanRaw = rawBody.replace(/^\uFEFF/, '').trim();
          if (cleanRaw) body = JSON.parse(cleanRaw);
        } catch (e) {
          console.warn('[cTrader dev] JSON parse failed on rawBody:', rawBody, e?.message);
        }
        // Also merge query string for GET
        try {
          const qUrl = new URL(req.url || '', 'http://127.0.0.1');
          for (const [k, v] of qUrl.searchParams) if (!(k in body)) body[k] = v;
        } catch {}

        const authHeader = (req.headers['x-api-key'] || req.headers['authorization'] || req.headers['x-access-token'] || '');
        const rawKey = String(authHeader).replace(/^(Bearer|Token|ApiKey|APIKey)\s+/i, '').trim();
        const action = String(body.action || (req.method === 'GET' ? 'get_positions' : 'open')).toLowerCase();
        const isReadAction = action === 'get_positions' || action === 'positions' || action === 'get_accounts' || action === 'accounts' || action === 'check_auth' || action === 'auth_status' || req.method === 'GET';

        const clientId = readCtraderEnv('CTRADER_CLIENT_ID') || readCtraderEnv('VITE_CTRADER_CLIENT_ID');
        const clientSecret = readCtraderEnv('CTRADER_CLIENT_SECRET');
        const supabaseUrl = readCtraderEnv('SUPABASE_URL') || process.env.VITE_SUPABASE_URL || '';
        const serviceKey = readCtraderEnv('SUPABASE_SERVICE_ROLE_KEY') || '';
        const anonKey = readCtraderEnv('SUPABASE_ANON_KEY') || process.env.VITE_SUPABASE_ANON_KEY || '';

        if (!clientId || !clientSecret) { res.statusCode = 503; res.end(JSON.stringify({ error: 'cTrader credentials not configured on server' })); return; }

        let accessToken = '';
        let authenticatedUserId = null;
        let keyId = null;
        let defaultAccountId = null;
        let defaultIsDemo = true;
        let isBrowserSession = false;

        // Match production: a browser request must prove its Supabase session,
        // never merely claim a user id in a query parameter or JWT payload.
        let browserUserId = null;
        if (!TOKEN_PATTERN.test(rawKey) && rawKey && supabaseUrl && anonKey) {
          try {
            const client = supabaseJs.createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
            const { data, error } = await client.auth.getUser(rawKey);
            if (!error && data?.user?.id) browserUserId = data.user.id;
          } catch {}
        }

        if (TOKEN_PATTERN.test(rawKey) || browserUserId) {
          if (!supabaseUrl || !serviceKey) { res.statusCode = 503; res.end(JSON.stringify({ error: 'Database service not configured' })); return; }
          const keyHash = hashTokenDev(rawKey);
          let apiKey = browserUserId ? { id: null, user_id: browserUserId, scopes: ['trades:read', 'trades:write'] } : null;
          if (!browserUserId) {
            try {
              const qr = await fetch(`${supabaseUrl}/rest/v1/api_keys?key_hash=eq.${keyHash}&select=id,user_id,scopes,expires_at`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
              const rows = await qr.json().catch(() => []);
              apiKey = Array.isArray(rows) ? rows[0] : null;
            } catch {}
          }
          if (!apiKey) { res.statusCode = 401; res.end(JSON.stringify({ error: 'invalid_api_key', message: 'API key not recognised. Copy the full key from Settings → Developer Tools (it starts with jfx_pat_) and send it as X-API-Key or Authorization: Bearer.' })); return; }
          if (!browserUserId && apiKey.expires_at && new Date(apiKey.expires_at).getTime() <= Date.now()) { res.statusCode = 401; res.end(JSON.stringify({ error: 'expired_api_key', message: 'This API key has expired. Create a new one in Settings → Developer Tools.' })); return; }
          const scopes = apiKey.scopes || [];
          const requiredScope = isReadAction ? 'trades:read' : 'trades:write';
          if (!browserUserId && !scopes.includes(requiredScope) && !scopes.includes('trades:write')) {
            res.statusCode = 403; res.end(JSON.stringify({ error: 'insufficient_scope', need: requiredScope, have: scopes, message: requiredScope === 'trades:write' ? 'This key lacks trades:write. Recreate it in Settings → Developer Tools with trades:write enabled.' : 'This key lacks the required scope.', hint: requiredScope === 'trades:write' ? 'Recreate the key in Settings → Developer Tools with trades:write enabled' : 'Requires trades:read (or trades:write)' })); return;
          }
          authenticatedUserId = apiKey.user_id; keyId = apiKey.id; isBrowserSession = Boolean(browserUserId);
          // rate limit: 429 only on explicit deny; transport errors are 503 (never silent 429 confusion)
          if (keyId) try {
            const rl = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_api_key_rate_limit`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, body: JSON.stringify({ p_user_id: authenticatedUserId, p_key_id: keyId }) });
            if (!rl.ok) { res.statusCode = 503; res.end(JSON.stringify({ error: 'rate_limiter_unavailable', message: 'Rate-limiter check failed on the server. Try again shortly.' })); return; }
            const allowed = await rl.json().catch(() => true);
            if (allowed === false) { res.setHeader('Retry-After', '60'); res.statusCode = 429; res.end(JSON.stringify({ error: 'rate_limited', message: 'Too many requests for this key. Wait 60s and retry.', retry_after: 60 })); return; }
          } catch { res.statusCode = 503; res.end(JSON.stringify({ error: 'rate_limiter_unavailable', message: 'Rate-limiter check failed on the server. Try again shortly.' })); return; }
          // lookup refresh token
          let userRefreshToken = '';
          let storedToken = null;
          try {
            const tr = await fetch(`${supabaseUrl}/rest/v1/user_ctrader_tokens?user_id=eq.${authenticatedUserId}&select=refresh_token,default_account_id,is_demo,access_token,access_token_expires_at`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
            if (tr.ok) {
              const rows = await tr.json().catch(() => []);
              const ut = Array.isArray(rows) ? rows[0] : null;
              storedToken = ut;
              if (ut?.refresh_token) { userRefreshToken = ut.refresh_token; defaultAccountId = ut.default_account_id ? Number(ut.default_account_id) : null; defaultIsDemo = ut.is_demo !== undefined ? (String(ut.is_demo).toLowerCase() !== 'false' && Boolean(ut.is_demo)) : true; }
            }
          } catch {}
          const tokenCacheKey = String(authenticatedUserId);
          const cachedAccess = ctraderAccessCache.get(tokenCacheKey);
          const persistedAccessExpiry = Date.parse(storedToken?.access_token_expires_at || '');
          if (cachedAccess?.expiresAt > Date.now() + 60_000) {
            accessToken = cachedAccess.accessToken;
          } else if (storedToken?.access_token && Number.isFinite(persistedAccessExpiry) && persistedAccessExpiry > Date.now() + 60_000) {
            accessToken = String(storedToken.access_token);
            ctraderAccessCache.set(tokenCacheKey, { accessToken, expiresAt: persistedAccessExpiry });
          }
          if (!accessToken && !userRefreshToken) {
            try {
              const cr = await fetch(`${supabaseUrl}/rest/v1/service_config?key=eq.ctrader_refresh_${authenticatedUserId}&select=value`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
              if (cr.ok) { const rows = await cr.json().catch(() => []); userRefreshToken = Array.isArray(rows) ? String(rows[0]?.value || '') : ''; }
            } catch {}
          }
          if (!accessToken) {
            if (!userRefreshToken) { res.statusCode = 400; res.end(JSON.stringify({ error: 'ctrader_not_connected', message: 'Your JFX API key is valid, but your cTrader account has not been connected yet. Please connect cTrader once on the Connect & Import page.' })); return; }
            let refreshPromise = ctraderRefreshInFlight.get(tokenCacheKey);
            if (!refreshPromise) {
              refreshPromise = (async () => {
                const minted = await mintAccessTokenDev(clientId, clientSecret, userRefreshToken);
                if (!minted.refreshToken) throw new Error('cTrader refresh returned no replacement refresh token');
                const expiresAt = Date.now() + minted.expiresInSeconds * 1000;
                const record = JSON.stringify({ user_id: authenticatedUserId, refresh_token: minted.refreshToken, access_token: minted.accessToken, access_token_expires_at: new Date(expiresAt).toISOString(), updated_at: new Date().toISOString() });
                const dbHeaders = { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
                const upsert = await fetch(`${supabaseUrl}/rest/v1/user_ctrader_tokens`, { method: 'POST', headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates' }, body: record });
                if (!upsert.ok) {
                  const patch = await fetch(`${supabaseUrl}/rest/v1/user_ctrader_tokens?user_id=eq.${authenticatedUserId}`, { method: 'PATCH', headers: dbHeaders, body: record });
                  if (!patch.ok) throw new Error(`token persistence failed (HTTP ${patch.status})`);
                }
                ctraderAccessCache.set(tokenCacheKey, { accessToken: minted.accessToken, expiresAt });
                void fetch(`${supabaseUrl}/rest/v1/service_config`, { method: 'POST', headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key: `ctrader_refresh_${authenticatedUserId}`, value: minted.refreshToken }) }).catch(() => {});
                return minted.accessToken;
              })();
              ctraderRefreshInFlight.set(tokenCacheKey, refreshPromise);
            }
            try {
              accessToken = await refreshPromise;
            } catch (err) {
              const message = String(err?.message || 'Invalid session');
              res.statusCode = 502;
              res.end(JSON.stringify({ error: 'ctrader_auth_failed', message: `Failed to authenticate with cTrader: ${message}. Please reconnect cTrader on the Connect & Import page.` }));
              return;
            } finally {
              if (ctraderRefreshInFlight.get(tokenCacheKey) === refreshPromise) ctraderRefreshInFlight.delete(tokenCacheKey);
            }
          }
        } else if (rawKey) {
          accessToken = rawKey;
        } else {
          res.statusCode = 401; res.end(JSON.stringify({ error: 'missing_api_key', message: 'Missing X-API-Key or Authorization header. Send X-API-Key: jfx_pat_... or Authorization: Bearer jfx_pat_...' })); return;
        }

        let accountId = Number(body.ctidTraderAccountId || defaultAccountId);
        const _isDemoRaw = body.isDemo !== undefined ? body.isDemo : defaultIsDemo;
        const isDemo = (() => { if (typeof _isDemoRaw === 'boolean') return _isDemoRaw; if (typeof _isDemoRaw === 'number') return _isDemoRaw !== 0; const s = String(_isDemoRaw).trim().toLowerCase(); if (['true','1','yes','y','demo','paper'].includes(s)) return true; if (['false','0','no','n','live','real'].includes(s)) return false; return Boolean(defaultIsDemo); })();
        const host = isDemo ? 'demo.ctraderapi.com' : 'live.ctraderapi.com';
        let session = null;
        try {
          if (!accountId) {
            session = await openCtraderSessionDev(host, clientId, clientSecret, 0, accessToken);
            const accListRes = await session.send(PT_DEV.GET_ACCOUNTS_BY_TOKEN_REQ, { accessToken });
            const accounts = accListRes.ctidTraderAccount || [];
            if (accounts.length === 0) { session.close(); res.statusCode = 400; res.end(JSON.stringify({ error: 'No cTrader accounts found for this user' })); return; }
            // Filter by demo/live to avoid "Cannot route request" when token has both
            const filtered = accounts.filter(a => isDemo ? a.isLive === false : a.isLive === true);
            const chosen = filtered.length ? filtered[0] : accounts[0];
            accountId = Number(chosen.ctidTraderAccountId); session.close(); session = null;
          } else {
            // Validate supplied account matches requested host; if mismatch, try to find matching account
            try {
              const tmp = await openCtraderSessionDev(host, clientId, clientSecret, 0, accessToken);
              const accRes = await tmp.send(PT_DEV.GET_ACCOUNTS_BY_TOKEN_REQ, { accessToken });
              tmp.close();
              const all = accRes.ctidTraderAccount || [];
              const target = all.find(a => Number(a.ctidTraderAccountId) === accountId);
              if (target && ((isDemo && target.isLive) || (!isDemo && !target.isLive))) {
                const alt = all.find(a => isDemo ? a.isLive === false : a.isLive === true);
                if (alt) accountId = Number(alt.ctidTraderAccountId);
              }
            } catch {}
          }
          if (action === 'get_accounts' || action === 'accounts') {
            let accounts = [];
            try {
              const tmp = await openCtraderSessionDev(host, clientId, clientSecret, 0, accessToken);
              const accRes = await tmp.send(PT_DEV.GET_ACCOUNTS_BY_TOKEN_REQ, { accessToken });
              tmp.close();
              accounts = accRes.ctidTraderAccount || [];
            } catch {}
            res.statusCode = 200;
            res.end(JSON.stringify({
              ok: true,
              defaultAccountId: accountId,
              isDemo,
              accounts: accounts.map(a => ({
                accountId: Number(a.ctidTraderAccountId),
                traderLogin: a.traderLogin ? Number(a.traderLogin) : undefined,
                broker: a.brokerTitleShort || a.brokerName || a.server || undefined,
                isLive: Boolean(a.isLive),
                isDemo: !a.isLive,
              })),
            }));
            return;
          }
          if (action === 'check_auth' || action === 'auth_status') {
            res.statusCode = 200;
            res.end(JSON.stringify({
              ok: true,
              message: 'cTrader credentials and API key authentication valid (local dev)',
              accountId,
              isDemo,
              userId: authenticatedUserId,
            }));
            return;
          }
          session = await openCtraderSessionDev(host, clientId, clientSecret, accountId, accessToken);
          if (action === 'stream_spots') {
            const symbolIds = Array.isArray(body?.payload?.symbolIds)
              ? [...new Set(body.payload.symbolIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 50)
              : [];
            if (!isBrowserSession || symbolIds.length === 0) {
              session.close();
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'A signed-in web session and at least one valid symbol id are required.' }));
              return;
            }
            await session.send(PT_DEV.SUBSCRIBE_SPOTS_REQ, { ctidTraderAccountId: accountId, symbolId: symbolIds });
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            const writeEvent = (event, payload) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); };
            const removeEventListener = session.onEvent((payloadType, payload) => {
              if (payloadType === PT_DEV.SPOT_EVENT && symbolIds.includes(Number(payload.symbolId))) writeEvent('spot', payload);
            });
            const heartbeat = setInterval(() => { session?.heartbeat(); writeEvent('keepalive', {}); }, 10000);
            const cleanup = () => { clearInterval(heartbeat); removeEventListener(); session?.close(); };
            req.once('close', cleanup);
            res.once('close', cleanup);
            writeEvent('ready', { accountId, isDemo, symbolIds });
            return;
          }
          if (action === 'proxy') {
            const allowedPayloadTypes = new Set([
              PT_DEV.SYMBOLS_LIST_REQ, PT_DEV.TRADER_REQ, PT_DEV.RECONCILE_REQ,
              PT_DEV.GET_TRENDBARS_REQ, PT_DEV.EXPECTED_MARGIN_REQ,
              PT_DEV.CASH_FLOW_HISTORY_LIST_REQ, PT_DEV.GET_CTID_PROFILE_BY_TOKEN_REQ,
              PT_DEV.NEW_ORDER_REQ, PT_DEV.CANCEL_ORDER_REQ, PT_DEV.AMEND_ORDER_REQ,
              PT_DEV.AMEND_POSITION_SLTP_REQ, PT_DEV.CLOSE_POSITION_REQ,
            ]);
            const payloadType = Number(body.payloadType);
            if (!isBrowserSession || !allowedPayloadTypes.has(payloadType)) {
              session.close();
              res.statusCode = 403;
              res.end(JSON.stringify({ error: 'A signed-in web session and supported browser operation are required.' }));
              return;
            }
            if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
              session.close();
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'A cTrader payload object is required.' }));
              return;
            }
            const payload = { ...body.payload };
            delete payload.clientId;
            delete payload.clientSecret;
            delete payload.accessToken;
            payload.ctidTraderAccountId = accountId;
            if (payloadType === PT_DEV.GET_CTID_PROFILE_BY_TOKEN_REQ) payload.accessToken = accessToken;
            const result = await session.send(payloadType, payload);
            session.close();
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, accountId, isDemo, result }));
            return;
          }
          if (isReadAction) {
            const reconcile = await session.send(PT_DEV.RECONCILE_REQ, { ctidTraderAccountId: accountId });
            const rawPositions = reconcile.position || []; const rawOrders = reconcile.order || [];
            const positions = rawPositions.map((pos) => {
              const td = pos.tradeData || pos;
              return { positionId: Number(pos.positionId), symbol: td.symbolName || td.symbol || String(td.symbolId || ''), symbolId: Number(td.symbolId), volumeLots: Number(td.volume ?? 0) / 10000000, tradeSide: td.tradeSide === 1 ? 'buy' : 'sell', openPrice: Number(pos.price ?? td.openPrice ?? 0), currentPrice: Number(pos.currentPrice ?? 0), profit: Number(pos.profit ?? 0) / 100, stopLoss: pos.stopLoss ? Number(pos.stopLoss) : null, takeProfit: pos.takeProfit ? Number(pos.takeProfit) : null, openTimestamp: new Date(Number(td.openTimestamp ?? Date.now())).toISOString() };
            });
            const orders = rawOrders.map((ord) => ({ orderId: Number(ord.orderId), symbol: ord.symbolName || ord.symbol || String(ord.symbolId || ''), symbolId: Number(ord.symbolId), volumeLots: Number(ord.volume ?? 0) / 10000000, tradeSide: ord.tradeSide === 1 ? 'buy' : 'sell', orderType: ord.orderType === 1 ? 'market' : ord.orderType === 2 ? 'limit' : ord.orderType === 3 ? 'stop' : 'stop_limit', limitPrice: ord.limitPrice ? Number(ord.limitPrice) : null, stopPrice: ord.stopPrice ? Number(ord.stopPrice) : null, stopLoss: ord.stopLoss ? Number(ord.stopLoss) : null, takeProfit: ord.takeProfit ? Number(ord.takeProfit) : null }));
            session.close(); res.statusCode = 200; res.end(JSON.stringify({ ok: true, accountId, isDemo, positions, orders })); return;
          }
          if (action === 'open' || action === 'new_order' || action === 'order' || action === 'buy' || action === 'sell') {
            if ((action === 'buy' || action === 'sell') && !body.side && !body.tradeSide) body.side = action;
            const rawSymbol = body.symbol || body.pair || body.instrument || body.ticker;
            let symbolId = Number(body.symbolId);
            if (!symbolId && rawSymbol) {
              const symbolsRes = await session.send(PT_DEV.SYMBOLS_LIST_REQ, { ctidTraderAccountId: accountId });
              const cleanName = String(rawSymbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
              const match = (symbolsRes.symbol || []).find((s) => String(s.symbolName || s.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === cleanName || String(s.symbolName || s.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(cleanName));
              if (match?.symbolId) symbolId = Number(match.symbolId); else { session.close(); res.statusCode = 400; res.end(JSON.stringify({ error: `Symbol '${rawSymbol}' not found on account ${accountId}` })); return; }
            }
            if (!symbolId) { session.close(); res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing symbol or symbolId' })); return; }
            const rawSide = String(body.side || body.tradeSide || 'buy').toLowerCase(); const tradeSide = rawSide === 'sell' ? 2 : 1;
            const rawType = String(body.orderType || 'market').toLowerCase(); let orderType = 1; if (rawType === 'limit') orderType = 2; else if (rawType === 'stop') orderType = 3; else if (rawType === 'stop_limit') orderType = 4;
            const volumeLots = Number(body.volume || body.volumeLots || 0.01); const volumeCents = toVolumeCentsDev(volumeLots);
            const payload = { ctidTraderAccountId: accountId, symbolId, orderType, tradeSide, volume: volumeCents };
            if (body.limitPrice) payload.limitPrice = Number(body.limitPrice); if (body.stopPrice) payload.stopPrice = Number(body.stopPrice); if (body.stopLoss) payload.stopLoss = Number(body.stopLoss); if (body.takeProfit) payload.takeProfit = Number(body.takeProfit); if (body.comment) payload.comment = String(body.comment);
            const result = await session.send(PT_DEV.NEW_ORDER_REQ, payload); session.close(); res.statusCode = 200; res.end(JSON.stringify({ ok: true, message: 'Order submitted', accountId, isDemo, result })); return;
          }
          if (action === 'close_all') {
            const rec = await session.send(PT_DEV.RECONCILE_REQ, { ctidTraderAccountId: accountId });
            const positions = rec.position || [];
            const closed = [];
            const errors = [];
            for (const pos of positions) {
              const pId = Number(pos.positionId);
              const vol = Number(pos?.tradeData?.volume || pos?.volume || 10000000);
              try {
                const resClose = await session.send(PT_DEV.CLOSE_POSITION_REQ, { ctidTraderAccountId: accountId, positionId: pId, volume: vol });
                closed.push({ positionId: pId, result: resClose });
              } catch (err) {
                errors.push({ positionId: pId, error: err?.message || String(err) });
              }
            }
            session.close();
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, message: `Closed ${closed.length} position(s)`, closedCount: closed.length, closed, errors }));
            return;
          }
          if (action === 'close' || action === 'close_position') {
            const positionId = Number(body.positionId); if (!positionId) { session.close(); res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing positionId' })); return; }
            let volumeCents; if (body.volume || body.volumeLots) volumeCents = toVolumeCentsDev(Number(body.volume || body.volumeLots)); else { const rec = await session.send(PT_DEV.RECONCILE_REQ, { ctidTraderAccountId: accountId }); const pos = (rec.position || []).find((p) => Number(p.positionId) === positionId); volumeCents = Number(pos?.tradeData?.volume || pos?.volume || 10000000); }
            const result = await session.send(PT_DEV.CLOSE_POSITION_REQ, { ctidTraderAccountId: accountId, positionId, volume: volumeCents }); session.close(); res.statusCode = 200; res.end(JSON.stringify({ ok: true, message: 'Position closed', result })); return;
          }
          if (action === 'modify_position' || action === 'modify_sltp') {
            const positionId = Number(body.positionId); if (!positionId) { session.close(); res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing positionId' })); return; }
            const payload = { ctidTraderAccountId: accountId, positionId, guaranteedStopLoss: false }; if (body.stopLoss !== undefined) payload.stopLoss = Number(body.stopLoss); if (body.takeProfit !== undefined) payload.takeProfit = Number(body.takeProfit);
            const result = await session.send(PT_DEV.AMEND_POSITION_SLTP_REQ, payload); session.close(); res.statusCode = 200; res.end(JSON.stringify({ ok: true, message: 'Position SL/TP modified', result })); return;
          }
          if (action === 'modify_order' || action === 'amend_order') {
            const orderId = Number(body.orderId); if (!orderId) { session.close(); res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing orderId' })); return; }
            const payload = { ctidTraderAccountId: accountId, orderId }; if (body.volume || body.volumeLots) payload.volume = toVolumeCentsDev(Number(body.volume || body.volumeLots)); if (body.limitPrice) payload.limitPrice = Number(body.limitPrice); if (body.stopPrice) payload.stopPrice = Number(body.stopPrice); if (body.stopLoss !== undefined) payload.stopLoss = Number(body.stopLoss); if (body.takeProfit !== undefined) payload.takeProfit = Number(body.takeProfit);
            const result = await session.send(PT_DEV.AMEND_ORDER_REQ, payload); session.close(); res.statusCode = 200; res.end(JSON.stringify({ ok: true, message: 'Pending order modified', result })); return;
          }
          if (action === 'cancel_order' || action === 'cancel') {
            const orderId = Number(body.orderId); if (!orderId) { session.close(); res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing orderId' })); return; }
            const result = await session.send(PT_DEV.CANCEL_ORDER_REQ, { ctidTraderAccountId: accountId, orderId }); session.close(); res.statusCode = 200; res.end(JSON.stringify({ ok: true, message: 'Pending order cancelled', result })); return;
          }
          session.close(); res.statusCode = 400; res.end(JSON.stringify({ error: `Unknown action '${action}'` }));
        } catch (err) { if (session) try { session.close(); } catch {} res.statusCode = 500; res.end(JSON.stringify({ error: err?.message || 'Trading request failed' })); }
      });


      // -----------------------------------------------------------------------
      // /api/ctrader/refresh — server-side token refresh
      // -----------------------------------------------------------------------
      server.middlewares.use('/api/ctrader/refresh', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
        const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
        const jwt = String(authHeader).replace(/^Bearer\s+/i, '').trim();
        const supabaseUrl = readCtraderEnv('SUPABASE_URL') || process.env.VITE_SUPABASE_URL || '';
        const anonKey = readCtraderEnv('SUPABASE_ANON_KEY') || process.env.VITE_SUPABASE_ANON_KEY || '';
        try {
          const client = supabaseJs.createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
          const { data, error } = await client.auth.getUser(jwt);
          if (error || !data?.user) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Invalid or expired session' }));
            return;
          }
          // The web client restores connections through /api/ctrader/trade,
          // which serializes the single-use cTrader token rotation. Do not
          // consume an httpOnly cookie here and desynchronize its DB record.
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: 'Unable to verify session' }));
        }
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
      // jfx-mobile/ is a SEPARATE git repo (see AGENTS.md §1) that happens to
      // live inside this working directory. Vitest's default glob was picking
      // up its suites and failing them against this repo's jsdom setup, so a
      // green `npx vitest run` here was never actually green. Scope this repo
      // to its own sources.
      exclude: ['**/node_modules/**', '**/dist/**', 'jfx-mobile/**'],
    },
    build: {
      rollupOptions: {
        output: {
          // Group third-party libraries into stable vendor chunks. A function
          // (instead of the object form) lets each package land in exactly one
          // group, which avoids the vendor-tiptap <-> vendor-ui cycle Rollup
          // reported when transitively shared deps were assigned twice.
          manualChunks(id) {
            // Vite's dynamic-import preload helper is used by the entry while
            // the lazy AI chunk happens to also use it. Pin it to the entry's
            // vendor chunk so first paint does not preload the AI/OpenUI chunk.
            if (id.includes('vite/preload-helper')) return 'vendor-react';
            if (!id.includes('node_modules')) return undefined;
            if (/node_modules\/(react|react-dom|scheduler|use-sync-external-store)\//.test(id)) return 'vendor-react';
            // Shared utilities are used by the entry and by lazy chart/AI
            // chunks; pin them to the already-preloaded UI chunk so the entry
            // does not drag the whole recharts graph into first paint.
            if (/node_modules\/(clsx|tailwind-merge|class-variance-authority)\//.test(id)) return 'vendor-ui';
            if (/node_modules\/(lightweight-charts|recharts|d3-[\w-]+|victory-vendor)\//.test(id)) return 'vendor-charts';
            if (/node_modules\/(@tiptap|prosemirror-[\w-]+)\//.test(id)) return 'vendor-tiptap';
            if (/node_modules\/@supabase\//.test(id)) return 'vendor-supabase';
            if (/node_modules\/posthog-js\//.test(id)) return 'vendor-posthog';
            if (/node_modules\/(@xenova|mermaid)\//.test(id)) return 'vendor-heavy-media';
            if (/node_modules\/(openai|@google\/generative-ai)\//.test(id)) return 'vendor-ai';
            if (/node_modules\/(@openuidev|zod)\//.test(id)) return 'vendor-openui';
            if (/node_modules\/(@dnd-kit|motion|framer-motion|lucide-react|@tabler\/icons-react)\//.test(id)) return 'vendor-ui';
            return undefined;
          },
        },
      },
      chunkSizeWarningLimit: 900,
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
