import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const readNvidiaKey = () => {
  try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    const contents = fs.readFileSync(envPath, 'utf8');
    const match = contents.match(/^NVIDIA_API_KEY=(?:"([^"]+)"|([^"\r\n]+))/m);
    return match?.[1] || match?.[2] || '';
  } catch {
    return '';
  }
};

const readFmpKey = () => {
  try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    const contents = fs.readFileSync(envPath, 'utf8');
    const match = contents.match(/^(?:FMP_API_KEY|VITE_FMP_API_KEY)=(?:"([^"]+)"|([^"\r\n]+))/m);
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
          const apiKey = readFmpKey() || process.env.FMP_API_KEY || process.env.VITE_FMP_API_KEY;

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

      server.middlewares.use('/api/mt5/positions', async (req, res) => {
        try {
          const data = await runPythonScript('mt5.py', ['positions']);

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            positions: data.positions || [],
            count: data.positions?.length || 0,
          }));
        } catch (error) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 400;
          res.end(JSON.stringify({ error: error.message }));
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
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
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
