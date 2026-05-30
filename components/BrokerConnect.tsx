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
  embedded?: boolean;
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

const BrokerConnect: React.FC<BrokerConnectProps> = ({ isDarkMode, userProfile, embedded }) => {
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

  const renderContent = () => (
    <>
      {!status.connected ? (
        <div className="space-y-5">
          {/* Prerequisites */}
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02]">
            <Shield size={14} className="text-zinc-500 mt-0.5 shrink-0" />
            <p className="text-xs text-zinc-500 leading-relaxed">
              Requires Python and <code className="px-1 py-0.5 rounded bg-white/5 text-[#FF4F01] text-[11px]">pip install MetaTrader5</code>.
              Keep MT5 open and logged in.
            </p>
          </div>

          {/* Form */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">Server</label>
              <input
                type="text"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="MetaQuotes-Demo"
                list="servers"
                className="w-full px-4 py-2.5 rounded-xl border border-white/10 bg-black text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#FF4F01]/50 focus:ring-1 focus:ring-[#FF4F01]/20 transition-colors"
              />
              <datalist id="servers">
                <option value="MetaQuotes-Demo" />
                <option value="ICMarkets-Demo" />
                <option value="OANDA-Demo" />
                <option value="fxpro-Demo" />
              </datalist>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">Account</label>
                <input
                  type="text"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="Account number"
                  className="w-full px-4 py-2.5 rounded-xl border border-white/10 bg-black text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#FF4F01]/50 focus:ring-1 focus:ring-[#FF4F01]/20 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Investor password"
                  className="w-full px-4 py-2.5 rounded-xl border border-white/10 bg-black text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#FF4F01]/50 focus:ring-1 focus:ring-[#FF4F01]/20 transition-colors"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-rose-500/10 text-rose-500 text-xs">
              <AlertTriangle size={14} />
              {error}
            </div>
          )}

          <button
            onClick={handleConnect}
            disabled={loading || !server || !login || !password}
            className="w-full py-2.5 rounded-xl bg-[#FF4F01] text-white text-sm font-medium hover:bg-[#FF4F01]/90 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? 'Connecting...' : 'Connect Terminal'}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Status Bar */}
          <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02]">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
              <div>
                <p className="text-xs text-zinc-400">
                  Connected to <span className="text-white">{status.server}</span>
                  <span className="text-zinc-600 mx-1.5">&#183;</span>
                  <span className="text-zinc-500">#{status.login}</span>
                </p>
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              className="text-xs text-zinc-600 hover:text-rose-400 transition-colors"
            >
              Disconnect
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-4">
              <p className="text-xs text-zinc-500 mb-1">Balance</p>
              <p className="text-2xl font-light tracking-tight text-white">
                ${status.balance?.toFixed(2)}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-4">
              <p className="text-xs text-zinc-500 mb-1">Equity</p>
              <p className="text-2xl font-light tracking-tight text-white">
                ${status.equity?.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-white/5">
            <button
              onClick={() => setActiveTab('trading')}
              className={`pb-2.5 px-1 text-xs font-medium transition-all mr-6 ${
                activeTab === 'trading'
                  ? 'text-white border-b-2 border-[#FF4F01]'
                  : 'text-zinc-600 hover:text-zinc-400 border-b-2 border-transparent'
              }`}
            >
              Trading
            </button>
            <button
              onClick={() => setActiveTab('connect')}
              className={`pb-2.5 px-1 text-xs font-medium transition-all ${
                activeTab === 'connect'
                  ? 'text-white border-b-2 border-[#FF4F01]'
                  : 'text-zinc-600 hover:text-zinc-400 border-b-2 border-transparent'
              }`}
            >
              Sync
            </button>
          </div>

          {/* Trading Tab */}
          {activeTab === 'trading' && (
            <div className="space-y-5">
              {/* Quick Order */}
              <div>
                <p className="text-xs text-zinc-500 font-medium mb-3 uppercase tracking-wider">Quick Order</p>
                <div className="grid grid-cols-4 gap-2.5">
                  <div>
                    <input
                      type="text"
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value)}
                      placeholder="EURUSD"
                      className="w-full px-3 py-2 rounded-lg border border-white/10 bg-black text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-[#FF4F01]/50 transition-colors"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      value={volume}
                      onChange={(e) => setVolume(e.target.value)}
                      placeholder="0.01"
                      className="w-full px-3 py-2 rounded-lg border border-white/10 bg-black text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-[#FF4F01]/50 transition-colors"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      value={sl}
                      onChange={(e) => setSl(e.target.value)}
                      placeholder="SL"
                      className="w-full px-3 py-2 rounded-lg border border-white/10 bg-black text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-[#FF4F01]/50 transition-colors"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      value={tp}
                      onChange={(e) => setTp(e.target.value)}
                      placeholder="TP"
                      className="w-full px-3 py-2 rounded-lg border border-white/10 bg-black text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-[#FF4F01]/50 transition-colors"
                    />
                  </div>
                </div>

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleOpenPosition('BUY')}
                    disabled={!!orderSuccess || !!orderError}
                    className="flex-1 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 disabled:opacity-30 transition-colors"
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => handleOpenPosition('SELL')}
                    disabled={!!orderSuccess || !!orderError}
                    className="flex-1 py-2 rounded-lg bg-rose-500/10 text-rose-400 text-xs font-medium hover:bg-rose-500/20 disabled:opacity-30 transition-colors"
                  >
                    Sell
                  </button>
                </div>

                {orderError && (
                  <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 text-rose-500 text-xs">
                    <AlertTriangle size={12} />
                    {orderError}
                  </div>
                )}

                {orderSuccess && (
                  <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-500 text-xs">
                    <CheckCircle2 size={12} />
                    {orderSuccess}
                  </div>
                )}
              </div>

              {/* Positions */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
                    Positions <span className="text-zinc-600">({positions.length})</span>
                  </p>
                  <button
                    onClick={fetchPositions}
                    className="text-zinc-600 hover:text-zinc-400 transition-colors"
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>

                {positions.length === 0 ? (
                  <p className="text-xs text-zinc-600">No open positions</p>
                ) : (
                  <div className="space-y-1">
                    {positions.map((pos) => (
                      <div
                        key={pos.ticket}
                        className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-white/5 hover:bg-white/[0.02] transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-medium tabular-nums ${
                            pos.type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            {pos.type}
                          </span>
                          <span className="text-xs text-white">{pos.symbol}</span>
                          <span className="text-xs text-zinc-600">{pos.volume}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-xs text-zinc-500 tabular-nums">{pos.price_open.toFixed(5)}</p>
                            <p className={`text-xs font-medium tabular-nums ${
                              pos.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}>
                              {pos.profit >= 0 ? '+' : ''}{pos.profit.toFixed(2)}
                            </p>
                          </div>
                          <button
                            onClick={() => handleClosePosition(pos.ticket)}
                            disabled={!!orderSuccess || !!orderError}
                            className="text-zinc-600 hover:text-rose-400 disabled:opacity-30 transition-colors"
                          >
                            <X size={12} />
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
              <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-4">
                <p className="text-xs text-zinc-500 leading-relaxed">
                  MT5 terminal must remain running with your account logged in.
                  Click to pull the latest trades into your journal.
                </p>
              </div>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="w-full py-2.5 rounded-xl border border-white/10 text-xs text-zinc-300 font-medium hover:bg-white/[0.03] disabled:opacity-30 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Syncing...' : 'Sync Trades'}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );

  if (embedded) return renderContent();

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

        {renderContent()}
      </div>
    </div>
  );
};

export default BrokerConnect;
