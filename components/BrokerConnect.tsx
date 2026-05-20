import React, { useState, useEffect, useRef } from 'react';
import { 
  Globe, 
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Shield,
  RefreshCw,
  Plus,
  TrendingUp,
  TrendingDown,
  X,
  DollarSign
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { UserProfile } from '../types';

interface BrokerConnectProps {
  isDarkMode: boolean;
  userProfile: UserProfile;
  onUpdateProfile: (profile: UserProfile) => Promise<void>;
}

interface BrokerStatus {
  connected: boolean;
  balance?: number;
  equity?: number;
  server?: string;
  login?: string;
  error?: string;
}

interface Position {
  ticket: number;
  symbol: string;
  type: string;
  volume: number;
  price_open: number;
  price_current: number;
  profit: number;
  sl: number;
  tp: number;
}

const BrokerConnect: React.FC<BrokerConnectProps> = ({ isDarkMode, userProfile }) => {
  const [server, setServer] = useState(userProfile?.broker_server || '');
  const [login, setLogin] = useState(userProfile?.broker_login || '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<BrokerStatus>({ connected: false });
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<'connect' | 'trading'>('connect');
  const [positions, setPositions] = useState<Position[]>([]);
  const [symbol, setSymbol] = useState('EURUSD');
  const [volume, setVolume] = useState('0.01');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [orderError, setOrderError] = useState('');
  const [orderSuccess, setOrderSuccess] = useState('');
  const intervalRef = useRef<number | null>(null);

  const attemptAutoLogin = async (pwd: string) => {
    if (!server || !login || !pwd) return;
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/mt5/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server, login, password: pwd })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to connect');
      }

      setStatus({
        connected: true,
        balance: data.balance,
        equity: data.equity,
        server: data.server,
        login: data.login
      });

      await supabase
        .from('profiles')
        .update({
          broker_server: server,
          broker_login: login,
          mt_terminal_status: 'connected',
          mt_terminal_connected_at: new Date().toISOString()
        })
        .eq('id', userProfile.accountName);
    } catch (err: any) {
      setError(err.message || 'Could not connect to MT5');
      setStatus({ connected: false, error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const fetchPositions = async () => {
    if (!status.connected) return;
    try {
      const res = await fetch('/api/mt5/positions');
      const data = await res.json();
      if (data.positions) {
        setPositions(data.positions);
      }
    } catch (err) {
      console.error('Failed to fetch positions:', err);
    }
  };

  const refreshStatus = async () => {
    try {
      const res = await fetch('/api/mt5/status');
      const data = await res.json();
      if (data.connected) {
        setStatus({
          connected: true,
          balance: data.balance,
          equity: data.equity,
          server: data.server,
          login: String(data.login)
        });
      }
    } catch (err) {
      console.error('Failed to refresh status:', err);
    }
  };

  useEffect(() => {
    if (status.connected && activeTab === 'trading') {
      fetchPositions();
      refreshStatus();
      intervalRef.current = window.setInterval(() => {
        fetchPositions();
        refreshStatus();
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [status.connected, activeTab]);

  const handleConnect = async () => {
    const pwdToUse = password;
    if (!server || !login || !pwdToUse) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/mt5/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server, login, password: pwdToUse })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to connect');
      }

      setStatus({
        connected: true,
        balance: data.balance,
        equity: data.equity,
        server: data.server,
        login: data.login
      });

      await supabase
        .from('profiles')
        .update({
          broker_server: server,
          broker_login: login,
          mt_terminal_status: 'connected',
          mt_terminal_connected_at: new Date().toISOString()
        })
        .eq('id', userProfile.accountName);
    } catch (err: any) {
      setError(err.message || 'Could not connect to MT5');
      setStatus({ connected: false, error: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!status.connected) {
      setServer(userProfile?.broker_server || '');
      setLogin(userProfile?.broker_login || '');
    }
  }, [status.connected, userProfile?.broker_server, userProfile?.broker_login]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/mt5/sync', { method: 'POST' });
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    setStatus({ connected: false });
    setPassword('');
    setPositions([]);
  };

  const handleOpenPosition = async (direction: 'BUY' | 'SELL') => {
    setOrderError('');
    setOrderSuccess(`${direction} opening...`);

    try {
      const res = await fetch('/api/mt5/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.toUpperCase(),
          volume: parseFloat(volume) || 0.01,
          direction,
          sl: sl ? parseFloat(sl) : 0,
          tp: tp ? parseFloat(tp) : 0
        })
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to open position');
      }

      setOrderSuccess(`${direction} ${symbol} opened @ ${data.price?.toFixed(5) || 'market'}`);
      setTimeout(() => setOrderSuccess(''), 2000);
      fetchPositions();
    } catch (err: any) {
      setOrderError(err.message);
      setOrderSuccess('');
    }
  };

  const handleClosePosition = async (ticket: number) => {
    setOrderError('');
    setOrderSuccess(`Closing #${ticket}...`);

    try {
      const res = await fetch('/api/mt5/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket })
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to close position');
      }

      setOrderSuccess(`Position #${ticket} closed`);
      setTimeout(() => setOrderSuccess(''), 2000);
      fetchPositions();
    } catch (err: any) {
      setOrderError(err.message);
      setOrderSuccess('');
    }
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-8 bg-[#000000]">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 text-[#FF4F01]">
            <div className="p-2 rounded-lg bg-[#FF4F01]/10">
              <Globe size={24} />
            </div>
            <h1 className="text-2xl font-black tracking-tight">Broker Sync</h1>
          </div>
          <p className={`text-sm ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
            Connect your MT4/MT5 terminal to automatically sync trades.
          </p>
        </div>

        {!status.connected ? (
          <div className={`rounded-3xl border p-6 ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'} shadow-xl`}>
            <div className="space-y-6">
              <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  <Shield size={16} className="text-[#FF4F01]" />
                  Before Connecting
                </h3>
                <ol className={`text-sm space-y-1 ${isDarkMode ? 'text-zinc-400' : 'text-slate-600'}`}>
                  <li>1. Make sure Python is installed on your computer</li>
                  <li>2. Run <code className="px-1 py-0.5 rounded bg-[#FF4F01]/20 text-[#FF4F01]">pip install MetaTrader5</code> in terminal</li>
                  <li>3. Open MT5 and login to your demo/live account</li>
                  <li>4. Return here and enter your credentials below</li>
                </ol>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Server</label>
                  <input
                    type="text"
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    placeholder="e.g., MetaQuotes-Demo"
                    list="servers"
                    className={`w-full px-4 py-3 rounded-xl border ${isDarkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-slate-50 border-slate-200'} focus:outline-none focus:border-[#FF4F01]`}
                  />
                  <datalist id="servers">
                    <option value="MetaQuotes-Demo" />
                    <option value="ICMarkets-Demo" />
                    <option value="OANDA-Demo" />
                    <option value="fxpro-Demo" />
                  </datalist>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Account Number</label>
                  <input
                    type="text"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    placeholder="Your MT5 account number"
                    className={`w-full px-4 py-3 rounded-xl border ${isDarkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-slate-50 border-slate-200'} focus:outline-none focus:border-[#FF4F01]`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Investor Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your investor (read-only) password"
                    className={`w-full px-4 py-3 rounded-xl border ${isDarkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-slate-50 border-slate-200'} focus:outline-none focus:border-[#FF4F01]`}
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 text-rose-500 text-sm">
                  <AlertTriangle size={16} />
                  {error}
                </div>
              )}

              <button
                onClick={handleConnect}
                disabled={loading || !server || !login || !password}
                className="w-full py-3 px-6 rounded-xl bg-[#FF4F01] text-white font-semibold hover:bg-[#FF4F01]/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading && <Loader2 size={18} className="animate-spin" />}
                Connect Terminal
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Status Card */}
            <div className={`rounded-3xl border p-6 ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'} shadow-xl`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/10">
                    <CheckCircle2 size={20} className="text-green-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Connected</h3>
                    <p className={`text-sm ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                      {status.server} • #{status.login}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleDisconnect}
                  className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-zinc-800' : 'hover:bg-slate-100'}`}
                >
                  <XCircle size={18} />
                </button>
              </div>

              {/* Account Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                  <p className={`text-sm ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Balance</p>
                  <p className="text-2xl font-bold">${status.balance?.toFixed(2)}</p>
                </div>
                <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                  <p className={`text-sm ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Equity</p>
                  <p className="text-2xl font-bold">${status.equity?.toFixed(2)}</p>
                </div>
              </div>

              {/* Tab Switcher */}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setActiveTab('trading')}
                  className={`flex-1 py-2 px-4 rounded-xl font-medium transition ${
                    activeTab === 'trading'
                      ? 'bg-[#FF4F01] text-white'
                      : isDarkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-50 text-slate-600'
                  }`}
                >
                  Trading
                </button>
                <button
                  onClick={() => setActiveTab('connect')}
                  className={`flex-1 py-2 px-4 rounded-xl font-medium transition ${
                    activeTab === 'connect'
                      ? 'bg-[#FF4F01] text-white'
                      : isDarkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-50 text-slate-600'
                  }`}
                >
                  Sync
                </button>
              </div>
            </div>

            {/* Trading Tab */}
            {activeTab === 'trading' && (
              <div className="space-y-4">
                {/* Quick Order Form */}
                <div className={`rounded-3xl border p-6 ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'} shadow-xl`}>
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Plus size={18} className="text-[#FF4F01]" />
                    Quick Order
                  </h3>

                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">Symbol</label>
                      <input
                        type="text"
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value)}
                        placeholder="EURUSD"
                        className={`w-full px-3 py-2 rounded-lg border text-sm ${
                          isDarkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-slate-50 border-slate-200'
                        } focus:outline-none focus:border-[#FF4F01]`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Volume</label>
                      <input
                        type="text"
                        value={volume}
                        onChange={(e) => setVolume(e.target.value)}
                        placeholder="0.01"
                        className={`w-full px-3 py-2 rounded-lg border text-sm ${
                          isDarkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-slate-50 border-slate-200'
                        } focus:outline-none focus:border-[#FF4F01]`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">SL (optional)</label>
                      <input
                        type="text"
                        value={sl}
                        onChange={(e) => setSl(e.target.value)}
                        placeholder="0"
                        className={`w-full px-3 py-2 rounded-lg border text-sm ${
                          isDarkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-slate-50 border-slate-200'
                        } focus:outline-none focus:border-[#FF4F01]`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">TP (optional)</label>
                      <input
                        type="text"
                        value={tp}
                        onChange={(e) => setTp(e.target.value)}
                        placeholder="0"
                        className={`w-full px-3 py-2 rounded-lg border text-sm ${
                          isDarkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-slate-50 border-slate-200'
                        } focus:outline-none focus:border-[#FF4F01]`}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => handleOpenPosition('BUY')}
                      disabled={!!orderSuccess || !!orderError}
                      className="flex-1 py-3 px-4 rounded-xl bg-green-500 text-white font-semibold hover:bg-green-600 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <TrendingUp size={18} />
                      BUY
                    </button>
                    <button
                      onClick={() => handleOpenPosition('SELL')}
                      disabled={!!orderSuccess || !!orderError}
                      className="flex-1 py-3 px-4 rounded-xl bg-rose-500 text-white font-semibold hover:bg-rose-600 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <TrendingDown size={18} />
                      SELL
                    </button>
                  </div>

                  {orderError && (
                    <div className="mt-3 flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 text-rose-500 text-sm">
                      <AlertTriangle size={14} />
                      {orderError}
                    </div>
                  )}

                  {orderSuccess && (
                    <div className="mt-3 flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-500 text-sm">
                      <CheckCircle2 size={14} />
                      {orderSuccess}
                    </div>
                  )}
                </div>

                {/* Positions List */}
                <div className={`rounded-3xl border p-6 ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'} shadow-xl`}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold flex items-center gap-2">
                      <DollarSign size={18} className="text-[#FF4F01]" />
                      Open Positions ({positions.length})
                    </h3>
                    <button
                      onClick={fetchPositions}
                      className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-zinc-800' : 'hover:bg-slate-100'}`}
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>

                  {positions.length === 0 ? (
                    <p className={`text-sm ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                      No open positions
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {positions.map((pos) => (
                        <div
                          key={pos.ticket}
                          className={`flex items-center justify-between p-3 rounded-xl ${
                            isDarkMode ? 'bg-zinc-800' : 'bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`font-medium ${pos.type === 'BUY' ? 'text-green-500' : 'text-rose-500'}`}>
                              {pos.type}
                            </span>
                            <span className="font-medium">{pos.symbol}</span>
                            <span className={`text-sm ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                              {pos.volume}
                            </span>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className={`text-sm ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                                {pos.price_open.toFixed(5)}
                              </p>
                              <p className={`font-medium ${pos.profit >= 0 ? 'text-green-500' : 'text-rose-500'}`}>
                                ${pos.profit.toFixed(2)}
                              </p>
                            </div>
                            <button
                              onClick={() => handleClosePosition(pos.ticket)}
                              disabled={!!orderSuccess || !!orderError}
                              className="p-2 rounded-lg bg-rose-500/20 text-rose-500 hover:bg-rose-500/30 disabled:opacity-50"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sync Tab */}
            {activeTab === 'connect' && (
              <div className="space-y-4">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="w-full py-3 px-6 rounded-xl bg-[#FF4F01] text-white font-semibold hover:bg-[#FF4F01]/90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <RefreshCw size={18} className={syncing ? 'animate-spin' : ''} />
                  {syncing ? 'Syncing...' : 'Sync Trades'}
                </button>

                <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                  <p className={`text-sm ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                    <strong>Note:</strong> MT5 terminal must remain running with your account logged in.
                    Trades are automatically synced when you click "Sync Trades" or you can setup periodic sync in settings.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BrokerConnect;
