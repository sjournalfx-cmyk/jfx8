import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Globe, Loader2, AlertTriangle, CheckCircle2, XCircle,
  Shield, RefreshCw, Clock, Wifi, WifiOff, TrendingUp, TrendingDown,
  DollarSign, BarChart3, Activity, Download, PlusCircle, Server, Terminal, Cpu
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { UserProfile, Trade, EASession, EADeal, EAPosition } from '../types';
import { VPS_API_URL, VPS_API_KEY } from '../lib/constants';
import { dataService } from '../services/dataService';
import { normalizeTrade } from '../lib/trade-normalization';
import { getSASTDateTime } from '../lib/timeUtils';
import { useToast } from './ui/Toast';

interface BrokerConnectProps {
  isDarkMode: boolean;
  userProfile: UserProfile;
  onUpdateProfile: (profile: UserProfile) => Promise<void>;
  embedded?: boolean;
  autoConnect?: boolean;
  onDisconnect?: () => void;
  userId: string;
  onTradeAdded?: (trade: Trade) => void;
  onEditTrade?: (trade: Trade) => void;
  trades?: Trade[];
  eaSession?: EASession | null;
}

interface LocalMT5Data {
  account: {
    login: number;
    server: string;
    balance: number;
    equity: number;
    profit: number;
    margin: number;
    free_margin: number;
    currency: string;
    name: string;
    company: string;
  } | null;
  openPositions: EAPosition[];
  trades: EADeal[];
  lastUpdated: Date | null;
}

interface BrokerStatus {
  connected: boolean;
  authFailed?: boolean;
  pendingSync?: boolean;
  server?: string;
  login?: string;
  name?: string;
  accountType?: string;
  accountStatus?: string;
  deposit?: number;
  investor?: string;
  lastSync?: string;
  error?: string;
  balance?: number;
  equity?: number;
  currency?: string;
}

const generateSyncKey = () =>
  `JFX-${Math.floor(1000 + Math.random() * 9000)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

const normalizeTerminalStatus = (value?: string | null) => (value || '').trim().toLowerCase();

const BrokerConnect: React.FC<BrokerConnectProps> = ({ isDarkMode, userProfile, onUpdateProfile, embedded, autoConnect, onDisconnect, userId, onTradeAdded, onEditTrade, trades = [], eaSession }) => {
  const [server, setServer] = useState(userProfile?.broker_server || '');
  const [login, setLogin] = useState(userProfile?.broker_login || '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<BrokerStatus>({ connected: false });
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAgo, setLastSyncAgo] = useState('');
  const [isSavingTrade, setIsSavingTrade] = useState<string | null>(null);

  // Diagnostics panel
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  // Custom date range state (used for journal queue filtering UI)
  const [historyFromDate, setHistoryFromDate] = useState<string>('');
  const [historyToDate, setHistoryToDate] = useState<string>('');

  // Derive live data entirely from the real-time eaSession (updated by the VPS bridge via Supabase Realtime).
  // This is the ONLY data source — no local /api/mt5/* polling on Vercel deployment.
  const vpsLiveData = useMemo(() => eaSession?.data || null, [eaSession]);

  const isBridgeLive = useMemo(() => {
    if (!eaSession?.last_updated) return false;
    return (Date.now() - new Date(eaSession.last_updated).getTime()) < 20_000;
  }, [eaSession]);

  // Adapt eaSession data into the shape the rest of the UI expects
  const localMT5 = useMemo<LocalMT5Data>(() => ({
    account: vpsLiveData?.account
      ? {
          login: vpsLiveData.account.login,
          server: vpsLiveData.account.server || '',
          balance: vpsLiveData.account.balance ?? 0,
          equity: vpsLiveData.account.equity ?? 0,
          profit: vpsLiveData.account.profit ?? 0,
          margin: vpsLiveData.account.margin ?? 0,
          free_margin: (vpsLiveData.account as any).free_margin ?? (vpsLiveData.account as any).freeMargin ?? 0,
          currency: vpsLiveData.account.currency || 'USD',
          name: (vpsLiveData.account as any).name || '',
          company: (vpsLiveData.account as any).company || '',
        }
      : null,
    openPositions: (vpsLiveData?.openPositions || []) as EAPosition[],
    trades: (vpsLiveData?.trades || []) as EADeal[],
    lastUpdated: eaSession?.last_updated ? new Date(eaSession.last_updated) : null,
  }), [vpsLiveData, eaSession]);

  // 1s timer for live updated status, and unmount cleanup
  const [now, setNow] = useState(new Date());
  const inFlightTickets = useRef<Set<string>>(new Set());

  const { addToast } = useToast();

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearInterval(timer);
      inFlightTickets.current.clear();
    };
  }, []);

  useEffect(() => {
    setServer(userProfile.broker_server || '');
    setLogin(userProfile.broker_login || '');
  }, [userProfile.broker_login, userProfile.broker_server]);

  // Auto-refresh diagnostics panel every 10s when open
  useEffect(() => {
    if (!diagnosticsOpen) return;
    const fetchDiag = async () => {
      setDiagLoading(true);
      try {
        const res = await fetch(`${VPS_API_URL}/api/broker/diagnostics`, {
          headers: { 'X-API-Key': VPS_API_KEY }
        });
        if (res.ok) setDiagnostics(await res.json());
      } catch { /* silent */ }
      finally { setDiagLoading(false); }
    };
    fetchDiag();
    const interval = setInterval(fetchDiag, 10000);
    return () => clearInterval(interval);
  }, [diagnosticsOpen]);

  // No local polling — all live data comes from eaSession (Supabase Realtime, pushed by VPS bridge)

  // Save a deal to the journal
  const handleLogTrade = useCallback(async (deal: EADeal) => {
    const key = String(deal.ticket);
    if (inFlightTickets.current.has(key)) return; // already in-flight, skip
    inFlightTickets.current.add(key);
    setIsSavingTrade(key);
    try {
      const netPnL = Number(((deal.profit || 0) + (deal.swap || 0) + (deal.commission || 0)).toFixed(2));
      const ts = deal.time && !isNaN(deal.time) ? deal.time * 1000 : Date.now();
      const tradeDate = new Date(ts);
      const sast = getSASTDateTime(tradeDate);
      const newTrade = normalizeTrade({
        id: '',
        ticketId: key,
        pair: deal.symbol,
        assetType: 'Forex',
        date: sast.date,
        time: sast.fullTime,
        openTime: tradeDate.toISOString(),
        closeTime: tradeDate.toISOString(),
        direction: deal.type === 'BUY' ? 'Long' : 'Short',
        entryPrice: deal.entry_price || deal.price || 0,
        exitPrice: deal.price || 0,
        stopLoss: deal.sl || 0,
        takeProfit: deal.tp || 0,
        lots: deal.volume,
        result: netPnL > 0 ? 'Win' : netPnL < 0 ? 'Loss' : 'BE',
        pnl: netPnL,
        rr: 0,
        rating: 0,
        tags: ['Others'],
        notes: `Synced via Broker Direct. Deal #${deal.ticket}`,
        planAdherence: 'No Plan',
        tradingMistake: 'None',
        mindset: 'Neutral',
      });
      if (!autoLog && onEditTrade) {
        onEditTrade(newTrade);
        return;
      }
      const saved = await dataService.addTrade(newTrade);
      if (onTradeAdded) onTradeAdded(saved);
    } catch (e: any) {
      console.error('Failed to log trade:', e);
      addToast?.({
        type: 'error',
        title: 'Logging Failed',
        message: e.message || 'Failed to save trade to the journal.',
        duration: 5000,
      });
    } finally {
      inFlightTickets.current.delete(key); // release lock
      setIsSavingTrade(null);
    }
  }, [onTradeAdded, onEditTrade, addToast]);

  const autoLog = false; // always open edit modal

  // relative last updated text
  const lastUpdatedText = useMemo(() => {
    if (!localMT5.lastUpdated) return '';
    const diffSecs = Math.floor((now.getTime() - localMT5.lastUpdated.getTime()) / 1000);
    if (diffSecs < 1) return 'Just now';
    return `${diffSecs}s ago`;
  }, [localMT5.lastUpdated, now]);

  const pendingDeals = useMemo(
    () => localMT5.trades.filter(
      (t: EADeal) => t.symbol && !trades.some(st => st.ticketId === String(t.ticket))
    ),
    [localMT5.trades, trades]
  );

  useEffect(() => {
    const terminalStatus = normalizeTerminalStatus(userProfile.mt_terminal_status);
    const shouldCheckStatus = autoConnect || ['connected', 'credentials_stored', 'auth_failed'].includes(terminalStatus);

    if (!shouldCheckStatus) {
      setStatus({ connected: false });
      setLastSyncAgo('');
      setError('');
      return;
    }

    if (userProfile.broker_server && userProfile.broker_login) {
      void fetchStatus();
    }
  }, [autoConnect, userProfile.broker_login, userProfile.broker_server, userProfile.mt_terminal_status, userProfile.syncKey, userId]);

  const fetchStatus = async () => {
    try {
      const sessionLookup = userProfile.syncKey
        ? supabase.from('ea_sessions').select('data').eq('sync_key', userProfile.syncKey).maybeSingle()
        : Promise.resolve({ data: null } as any);

      const [vpsRes, sessionRes] = await Promise.all([
        fetch(`${VPS_API_URL}/api/broker/status/${userId}`, {
          headers: { 'X-API-Key': VPS_API_KEY }
        }),
        sessionLookup
      ]);

      if (!vpsRes.ok) {
        setError('Unable to load broker status from the VPS bridge.');
        return;
      }

      const data = await vpsRes.json();
      const terminalStatus = normalizeTerminalStatus(data.mt_terminal_status ?? data.status);
      const accountData = data.account || sessionRes.data?.data?.account || null;
      const expectedLogin = String(userProfile.broker_login || login || '').trim();
      const accountLogin = String(accountData?.login ?? accountData?.Login ?? data.broker_login ?? data.login ?? '').trim();

      if (expectedLogin && accountLogin && expectedLogin !== accountLogin) {
        setStatus({ connected: false, error: `Fetched account ${accountLogin} does not match the stored login ${expectedLogin}.` });
        setError('The VPS returned a different account than the one you entered.');
        return;
      }

      const balance = accountData?.balance ?? accountData?.Balance;
      const equity = accountData?.equity ?? accountData?.Equity;
      const currency = accountData?.currency ?? accountData?.Currency;
      const lastSyncAt = data.last_sync_at || data.lastSyncAt;
      const name = String(accountData?.name ?? data.account_name ?? data.name ?? '').trim();
      const accountType = String(accountData?.type ?? data.account_type ?? data.accountType ?? '').trim();
      const accountStatus = String(data.account_status ?? data.status_label ?? data.accountStatus ?? '').trim();
      const depositValue = accountData?.deposit ?? data.deposit;
      const investor = String(data.investor ?? accountData?.investor ?? '').trim();

      if (terminalStatus === 'auth_failed') {
        setStatus({ connected: false, authFailed: true, error: 'Invalid credentials. Please re-enter your password.' });
        updateLastSyncAgo(lastSyncAt);
      } else if (data.broker_sync_enabled || terminalStatus === 'connected' || terminalStatus === 'credentials_stored') {
        setStatus({
          connected: true,
          pendingSync: !data.broker_sync_enabled || terminalStatus === 'credentials_stored',
          server: data.broker_server,
          login: data.broker_login,
          name: name || undefined,
          accountType: accountType || undefined,
          accountStatus: accountStatus || undefined,
          deposit: Number.isFinite(Number(depositValue)) ? Number(depositValue) : undefined,
          investor: investor || undefined,
          lastSync: lastSyncAt,
          balance: balance !== undefined ? Number(balance) : undefined,
          equity: equity !== undefined ? Number(equity) : undefined,
          currency
        });
        updateLastSyncAgo(lastSyncAt);
        setError('');
      } else {
        setStatus({ connected: false });
        setLastSyncAgo('');
      }
    } catch {}
  };

  const updateLastSyncAgo = (syncTime?: string) => {
    if (!syncTime) { setLastSyncAgo('Pending first sync'); return; }
    const diff = Math.floor((Date.now() - new Date(syncTime).getTime()) / 1000);
    if (diff < 60) setLastSyncAgo('Just now');
    else if (diff < 3600) setLastSyncAgo(`${Math.floor(diff / 60)}m ago`);
    else if (diff < 86400) setLastSyncAgo(`${Math.floor(diff / 3600)}h ago`);
    else setLastSyncAgo(`${Math.floor(diff / 86400)}d ago`);
  };

  const ensureSyncKey = async () => {
    if (!userProfile.syncKey) {
      const newKey = generateSyncKey();
      await onUpdateProfile({ ...userProfile, syncKey: newKey });
      return newKey;
    }
    return userProfile.syncKey;
  };

  const handleConnect = async () => {
    const trimmedServer = server.trim();
    const trimmedLogin = login.trim();
    const trimmedPassword = password.trim();
    let credentialsStored = false;

    if (!trimmedServer || !trimmedLogin || !trimmedPassword) {
      setError('Please fill in all fields');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const syncKey = await ensureSyncKey();

      const storeRes = await fetch(`${VPS_API_URL}/api/broker/credentials?user_id=${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': VPS_API_KEY },
        body: JSON.stringify({ server: trimmedServer, login: trimmedLogin, password: trimmedPassword })
      });

      if (!storeRes.ok) {
        const errData = await storeRes.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to store credentials on VPS');
      }

      const pendingSyncAt = new Date().toISOString();
      await supabase.from('profiles').update({
        broker_server: trimmedServer,
        broker_login: trimmedLogin,
        mt_terminal_status: 'credentials_stored',
        broker_sync_enabled: false,
        mt_terminal_connected_at: pendingSyncAt,
        last_sync_at: null
      }).eq('id', userId);

      await onUpdateProfile({
        ...userProfile,
        broker_server: trimmedServer,
        broker_login: trimmedLogin,
        mt_terminal_status: 'credentials_stored'
      });
      credentialsStored = true;

      setStatus({
        connected: true,
        pendingSync: true,
        server: trimmedServer,
        login: trimmedLogin,
        lastSync: pendingSyncAt
      });
      updateLastSyncAgo(undefined);

      const syncRes = await fetch(`${VPS_API_URL}/api/broker/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': VPS_API_KEY },
        body: JSON.stringify({
          user_id: userId,
          sync_key: syncKey
        })
      });

      if (!syncRes.ok) {
        const errData = await syncRes.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to trigger initial sync');
      }

      const connectedAt = new Date().toISOString();
      await supabase.from('profiles').update({
        broker_server: trimmedServer,
        broker_login: trimmedLogin,
        mt_terminal_status: 'connected',
        broker_sync_enabled: true,
        mt_terminal_connected_at: connectedAt,
        last_sync_at: connectedAt
      }).eq('id', userId);

      setStatus({
        connected: true,
        pendingSync: false,
        server: trimmedServer,
        login: trimmedLogin,
        lastSync: connectedAt
      });
      updateLastSyncAgo(connectedAt);

      await onUpdateProfile({
        ...userProfile,
        broker_server: trimmedServer,
        broker_login: trimmedLogin,
        mt_terminal_status: 'connected'
      });

      setTimeout(fetchStatus, 3000);
    } catch (err: any) {
      setError(err.message || 'Connection failed');
      setStatus(
        credentialsStored
          ? { connected: true, pendingSync: true, server: trimmedServer, login: trimmedLogin, error: err.message }
          : { connected: false, error: err.message }
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const syncKey = await ensureSyncKey();
      const res = await fetch(`${VPS_API_URL}/api/broker/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': VPS_API_KEY },
        body: JSON.stringify({
          user_id: userId,
          sync_key: syncKey
        })
      });
      if (res.ok) {
        const now = new Date().toISOString();
        setStatus(prev => ({ ...prev, pendingSync: false, lastSync: now }));
        updateLastSyncAgo(now);
        await supabase.from('profiles').update({
          mt_terminal_status: 'connected',
          broker_sync_enabled: true,
          last_sync_at: now
        }).eq('id', userId);
        setTimeout(fetchStatus, 3000);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.detail || 'Sync request failed');
      }
    } catch {
      setError('Could not reach VPS bridge server');
    }
    setSyncing(false);
  };

  const handleDisconnect = async () => {
    try {
      await fetch(`${VPS_API_URL}/api/broker/disconnect/${userId}`, {
        method: 'POST',
        headers: { 'X-API-Key': VPS_API_KEY }
      });
    } catch {}
    await supabase.from('profiles').update({
      mt_terminal_status: 'disconnected',
      broker_sync_enabled: false,
      mt_terminal_connected_at: null,
      last_sync_at: null
    }).eq('id', userId);
    await onUpdateProfile({
      ...userProfile,
      mt_terminal_status: 'disconnected'
    });
    setStatus({ connected: false });
    setPassword('');
    setError('');
    onDisconnect?.();
  };

  const handleReEnterCredentials = async () => {
    await supabase.from('profiles').update({
      mt_terminal_status: 'disconnected',
      broker_sync_enabled: false,
      mt_terminal_connected_at: null,
      last_sync_at: null
    }).eq('id', userId);
    await onUpdateProfile({
      ...userProfile,
      mt_terminal_status: 'disconnected'
    });
    setStatus({ connected: false, authFailed: false });
    setError('');
  };

  const renderContent = () => (
    <div className="space-y-5">
      {!status.connected && !status.authFailed ? (
        <>
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02]">
            <Shield size={14} className="text-zinc-500 mt-0.5 shrink-0" />
            <p className="text-xs text-zinc-500 leading-relaxed">
              Credentials are encrypted and sent to the JournalFX VPS broker server.
              Trades sync automatically every 6 hours.
            </p>
          </div>

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
            {loading ? 'Connecting...' : 'Connect & Enable Auto-Sync'}
          </button>
        </>
      ) : null}

      {status.authFailed ? (
        <div className="space-y-5">
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-rose-500/10 text-rose-500 text-xs">
            <XCircle size={14} />
            {status.error}
          </div>
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-5 py-4">
            <p className="text-xs text-zinc-400 leading-relaxed">
              The broker rejected these credentials. Your password may have changed,
              or the account may have been disabled. Click below to update.
            </p>
          </div>
          <button
            onClick={handleReEnterCredentials}
            className="w-full py-2.5 rounded-xl border border-white/10 text-xs text-zinc-300 font-medium hover:bg-white/[0.03] transition-all"
          >
            Re-enter Credentials
          </button>
        </div>
      ) : null}

      {status.connected ? (
        <div className="space-y-4">

          {/* ── STATUS BAR ── */}
          <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02]">
            <div className="flex items-center gap-2.5">
              <div className={`w-2 h-2 rounded-full transition-colors ${
                isBridgeLive
                  ? 'bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.5)] animate-pulse'
                  : status.pendingSync
                  ? 'bg-amber-400'
                  : 'bg-emerald-500'
              }`} />
              <div>
                <p className="text-xs text-zinc-300 font-medium">
                  {isBridgeLive
                    ? `Live · VPS Bridge (${lastUpdatedText})`
                    : status.pendingSync
                    ? 'Credentials stored · Awaiting VPS sync'
                    : 'Connected via VPS Bridge'}
                  <span className="text-zinc-600 mx-1.5">·</span>
                  <span className="text-zinc-500">{localMT5.account?.server || status.server}</span>
                </p>
                <p className="text-[10px] text-zinc-600 mt-0.5">
                  {localMT5.account?.name || status.name || ''}
                  {(localMT5.account?.name || status.name) && (localMT5.account?.company || status.accountType) ? ' · ' : ''}
                  {localMT5.account?.company || status.accountType || ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSync}
                disabled={syncing}
                title="Sync Now"
                className="p-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-white hover:border-white/20 transition-all disabled:opacity-30"
              >
                <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={() => setDiagnosticsOpen(!diagnosticsOpen)}
                className={`p-1.5 rounded-lg border transition-all ${diagnosticsOpen ? 'border-[#FF4F01]/40 text-[#FF4F01]' : 'border-white/10 text-zinc-400 hover:text-white hover:border-white/20'}`}
                title="VPS Diagnostics"
              >
                <Server size={12} />
              </button>
              <button onClick={handleDisconnect} className="text-xs text-zinc-600 hover:text-rose-400 transition-colors">Disconnect</button>
            </div>
          </div>

          {/* ── ACCOUNT METRICS BENTO ── */}
          {(() => {
            const acc = localMT5.account;
            const bal   = acc?.balance   ?? status.balance;
            const eq    = acc?.equity    ?? status.equity;
            const prof  = acc?.profit    ?? 0;
            const curr  = acc?.currency  ?? status.currency ?? 'USD';
            const openCnt = localMT5.openPositions.length;
            const profitColor = prof >= 0 ? 'text-emerald-400' : 'text-rose-400';
            return (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/5 bg-[#0a0a0a] px-5 py-4">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Balance</p>
                  <p className="text-lg font-black text-white tabular-nums">
                    {bal !== undefined ? bal.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
                  </p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">{curr}</p>
                </div>
                <div className="rounded-2xl border border-white/5 bg-[#0a0a0a] px-5 py-4">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Equity</p>
                  <p className="text-lg font-black text-white tabular-nums">
                    {eq !== undefined ? eq.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
                  </p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">{curr}</p>
                </div>
                <div className="rounded-2xl border border-white/5 bg-[#0a0a0a] px-5 py-4">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Float P&L</p>
                  <p className={`text-lg font-black tabular-nums ${profitColor}`}>
                    {prof >= 0 ? '+' : ''}{prof.toFixed(2)}
                  </p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">{curr}</p>
                </div>
                <div className="rounded-2xl border border-white/5 bg-[#0a0a0a] px-5 py-4">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Open Positions</p>
                  <p className="text-lg font-black text-white tabular-nums">{openCnt}</p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">{openCnt === 1 ? 'trade' : 'trades'}</p>
                </div>
              </div>
            );
          })()}

          {/* ── OPEN POSITIONS ── */}
          {localMT5.openPositions.length > 0 && (
            <div className="rounded-2xl border border-white/5 bg-[#0a0a0a] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
                <Activity size={12} className="text-emerald-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Open Positions</span>
                <span className="ml-auto text-[9px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-bold">{localMT5.openPositions.length}</span>
              </div>
              <div className="divide-y divide-white/[0.03]">
                {useMemo(() => localMT5.openPositions.map((pos: EAPosition) => {
                  const profitColor = pos.profit >= 0 ? 'text-emerald-400' : 'text-rose-400';
                  return (
                    <div key={pos.ticket} className="px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${pos.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{pos.type}</span>
                        <span className="text-xs font-bold text-white">{pos.symbol}</span>
                        <span className="text-[10px] text-zinc-600">{pos.volume}L</span>
                      </div>
                      <div className="text-right">
                        <p className={`text-xs font-bold tabular-nums ${profitColor}`}>{pos.profit >= 0 ? '+' : ''}{pos.profit?.toFixed(2)}</p>
                        <p className="text-[9px] text-zinc-600">@ {pos.open_price}</p>
                      </div>
                    </div>
                  );
                }), [localMT5.openPositions])}
              </div>
            </div>
          )}

          {/* ── JOURNAL QUEUE ── */}
          <div className="rounded-2xl border border-white/5 bg-[#0a0a0a] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <Download size={12} className="text-[#FF4F01]" />
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Journal Queue</span>
                {pendingDeals.length > 0 && (
                  <span className="text-[9px] bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full font-bold">{pendingDeals.length} pending</span>
                )}
              </div>

              {/* Date Filters */}
              <div className="flex items-center gap-1.5 ml-auto">
                <input
                  type="date"
                  value={historyFromDate}
                  onChange={(e) => setHistoryFromDate(e.target.value)}
                  className="px-2 py-1 rounded border border-white/10 bg-black text-[10px] text-zinc-300 focus:outline-none focus:border-[#FF4F01]/50"
                />
                <span className="text-[10px] text-zinc-600">to</span>
                <input
                  type="date"
                  value={historyToDate}
                  onChange={(e) => setHistoryToDate(e.target.value)}
                  className="px-2 py-1 rounded border border-white/10 bg-black text-[10px] text-zinc-300 focus:outline-none focus:border-[#FF4F01]/50"
                />
                {(historyFromDate || historyToDate) && (
                  <button
                    onClick={() => { setHistoryFromDate(''); setHistoryToDate(''); }}
                    className="text-[10px] text-zinc-500 hover:text-white"
                  >
                    Reset
                  </button>
                )}
              </div>

              {pendingDeals.length > 1 && (
                <button
                  onClick={async () => { for (const d of pendingDeals) await handleLogTrade(d); }}
                  disabled={isSavingTrade !== null}
                  className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg bg-[#FF4F01]/10 text-[#FF4F01] hover:bg-[#FF4F01] hover:text-white transition-all disabled:opacity-40"
                >
                  Log All
                </button>
              )}
            </div>
            <div className="divide-y divide-white/[0.03] max-h-64 overflow-y-auto custom-scrollbar">
              {pendingDeals.length > 0 ? pendingDeals.map((deal: EADeal) => {
                const net = (deal.profit || 0) + (deal.swap || 0) + (deal.commission || 0);
                const alreadySaved = trades.some(st => st.ticketId === String(deal.ticket));
                return (
                  <div key={deal.ticket} className="px-4 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center gap-2">
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${deal.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{deal.type}</span>
                      <div>
                        <p className="text-xs font-bold text-white">{deal.symbol}</p>
                        <p className="text-[9px] text-zinc-600">#{deal.ticket} · {deal.volume}L</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className={`text-xs font-bold tabular-nums ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{net >= 0 ? '+' : ''}{net.toFixed(2)}</p>
                      {alreadySaved ? (
                        <div className="flex items-center gap-1 text-[8px] font-black text-emerald-500 uppercase">
                          <CheckCircle2 size={10} strokeWidth={3} /> Logged
                        </div>
                      ) : (
                        <button
                          onClick={() => handleLogTrade(deal)}
                          disabled={isSavingTrade !== null}
                          className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg bg-white/5 text-zinc-300 hover:bg-[#FF4F01] hover:text-white transition-all border border-white/10 disabled:opacity-40"
                        >
                          {isSavingTrade === String(deal.ticket) ? '...' : 'Log'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              }) : (
                <div className="py-8 flex flex-col items-center gap-2 text-center">
                  <BarChart3 size={20} className="text-zinc-700" />
                  <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">
                    {localMT5.lastUpdated ? 'No new closed trades' : 'Connecting to MT5...'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── VPS DIAGNOSTICS PANEL ── */}
          {diagnosticsOpen && status.connected && (
            <div className="rounded-2xl border border-white/5 bg-[#0a0a0a] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
                <Activity size={12} className="text-zinc-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">VPS Diagnostics</span>
                {diagLoading && <Loader2 size={10} className="animate-spin text-zinc-500" />}
                {!diagnostics && !diagLoading && (
                  <span className="text-[9px] text-rose-400 ml-auto">Unavailable — add /api/broker/diagnostics to VPS manager</span>
                )}
              </div>
              {diagnostics && (
                <div className="p-4 space-y-3 text-[10px]">
                  {/* Services row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal size={12} className="text-zinc-500" />
                      <span className="text-zinc-400">MT5 Terminal</span>
                    </div>
                    <span className={`font-bold ${diagnostics.services?.mt5_terminal?.running ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {diagnostics.services?.mt5_terminal?.running ? `Running (PID ${diagnostics.services.mt5_terminal.pid})` : 'Stopped'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Wifi size={12} className="text-zinc-500" />
                      <span className="text-zinc-400">MT5 Bridge (8001)</span>
                    </div>
                    <span className={`font-bold ${diagnostics.services?.mt5_bridge?.reachable ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {diagnostics.services?.mt5_bridge?.reachable ? 'Reachable' : 'Unreachable'}
                    </span>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-white/5" />

                  {/* Connection Status */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe size={12} className="text-zinc-500" />
                      <span className="text-zinc-400">Connection Status</span>
                    </div>
                    <span className={`font-bold ${status.connected ? 'text-emerald-400' : 'text-zinc-500'}`}>
                      {status.connected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  {status.lastSync && (
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Last Sync</span>
                      <span className="text-zinc-300 font-mono">{new Date(status.lastSync).toLocaleString()}</span>
                    </div>
                  )}
                  {diagnostics.system?.uptime && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock size={12} className="text-zinc-500" />
                        <span className="text-zinc-400">VPS Uptime</span>
                      </div>
                      <span className="text-zinc-300">{diagnostics.system.uptime}</span>
                    </div>
                  )}
                  {diagnostics.system?.memory?.total_mb && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Cpu size={12} className="text-zinc-500" />
                        <span className="text-zinc-400">Memory</span>
                      </div>
                      <span className="text-zinc-300">{diagnostics.system.memory.used_mb}/{diagnostics.system.memory.total_mb} MB</span>
                    </div>
                  )}
                  {diagnostics.users && (
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Active Users</span>
                      <span className="text-zinc-300">{diagnostics.users.connected}/{diagnostics.users.active}</span>
                    </div>
                  )}

                  {/* Error display */}
                  {(status as any).error && (
                    <>
                      <div className="border-t border-white/5" />
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 text-rose-400">
                        <AlertTriangle size={10} />
                        <span>{(status as any).error}</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-rose-500/10 text-rose-500 text-xs">
              <AlertTriangle size={14} />
              {error}
            </div>
          )}

          <p className="text-[10px] text-zinc-700 text-center">
            Auto-sync every 6h via VPS
          </p>
        </div>
      ) : null}
    </div>
  );

  if (embedded) return renderContent();

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-8 bg-[#000000]">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 text-[#FF4F01]">
            <div className="p-2 rounded-lg bg-[#FF4F01]/10">
              <Globe size={24} />
            </div>
            <h1 className="text-2xl font-black tracking-tight">Broker Sync</h1>
          </div>
          <p className={`text-sm ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
            Connect your MT5 account via the VPS broker bridge for automated trade syncing.
          </p>
        </div>

        {renderContent()}
      </div>
    </div>
  );
};

export default BrokerConnect;
