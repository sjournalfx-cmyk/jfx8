import React, { useState, useEffect } from 'react';
import {
  Globe, Loader2, AlertTriangle, CheckCircle2, XCircle,
  Shield, RefreshCw, Clock, Wifi, WifiOff
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { UserProfile } from '../types';
import { VPS_API_URL, VPS_API_KEY } from '../lib/constants';

interface BrokerConnectProps {
  isDarkMode: boolean;
  userProfile: UserProfile;
  onUpdateProfile: (profile: UserProfile) => Promise<void>;
  embedded?: boolean;
  autoConnect?: boolean;
  onDisconnect?: () => void;
  userId: string;
}

interface BrokerStatus {
  connected: boolean;
  authFailed?: boolean;
  server?: string;
  login?: string;
  lastSync?: string;
  error?: string;
}

const BrokerConnect: React.FC<BrokerConnectProps> = ({ isDarkMode, userProfile, onUpdateProfile, embedded, autoConnect, onDisconnect, userId }) => {
  const [server, setServer] = useState(userProfile?.broker_server || '');
  const [login, setLogin] = useState(userProfile?.broker_login || '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<BrokerStatus>({ connected: false });
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAgo, setLastSyncAgo] = useState('');

  useEffect(() => {
    if (userProfile.broker_server && userProfile.broker_login) {
      fetchStatus();
    }
  }, []);

  useEffect(() => {
    if (autoConnect && userProfile.broker_server && userProfile.broker_login) {
      fetchStatus();
    }
  }, [autoConnect]);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${VPS_API_URL}/api/broker/status/${userId}`, {
        headers: { 'X-API-Key': VPS_API_KEY }
      });
      if (!res.ok) return;
      const data = await res.json();

      if (data.mt_terminal_status === 'auth_failed') {
        setStatus({ connected: false, authFailed: true, error: 'Invalid credentials. Please re-enter your password.' });
      } else if (data.broker_sync_enabled) {
        setStatus({
          connected: true,
          server: data.broker_server,
          login: data.broker_login,
          lastSync: data.last_sync_at
        });
        updateLastSyncAgo(data.last_sync_at);
      }
    } catch {}
  };

  const updateLastSyncAgo = (syncTime?: string) => {
    if (!syncTime) { setLastSyncAgo('Never'); return; }
    const diff = Math.floor((Date.now() - new Date(syncTime).getTime()) / 1000);
    if (diff < 60) setLastSyncAgo('Just now');
    else if (diff < 3600) setLastSyncAgo(`${Math.floor(diff / 60)}m ago`);
    else if (diff < 86400) setLastSyncAgo(`${Math.floor(diff / 3600)}h ago`);
    else setLastSyncAgo(`${Math.floor(diff / 86400)}d ago`);
  };

  const handleConnect = async () => {
    if (!server || !login || !password) {
      setError('Please fill in all fields');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const storeRes = await fetch(`${VPS_API_URL}/api/broker/credentials?user_id=${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': VPS_API_KEY },
        body: JSON.stringify({ server, login, password })
      });

      if (!storeRes.ok) {
        const errData = await storeRes.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to store credentials on VPS');
      }

      const syncRes = await fetch(`${VPS_API_URL}/api/broker/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': VPS_API_KEY },
        body: JSON.stringify({
          user_id: userId,
          sync_key: userProfile.syncKey || ''
        })
      });

      if (!syncRes.ok) {
        const errData = await syncRes.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to trigger initial sync');
      }

      await supabase.from('profiles').update({
        broker_server: server,
        broker_login: login,
        mt_terminal_status: 'connected',
        broker_sync_enabled: true,
        mt_terminal_connected_at: new Date().toISOString()
      }).eq('id', userId);

      setStatus({ connected: true, server, login, lastSync: new Date().toISOString() });
      setLastSyncAgo('Just now');

      await onUpdateProfile({
        ...userProfile,
        broker_server: server,
        broker_login: login,
        mt_terminal_status: 'connected'
      });
    } catch (err: any) {
      setError(err.message || 'Connection failed');
      setStatus({ connected: false, error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${VPS_API_URL}/api/broker/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': VPS_API_KEY },
        body: JSON.stringify({
          user_id: userId,
          sync_key: userProfile.syncKey || ''
        })
      });
      if (res.ok) {
        const now = new Date().toISOString();
        setStatus(prev => ({ ...prev, lastSync: now }));
        updateLastSyncAgo(now);
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
      broker_sync_enabled: false
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
      broker_sync_enabled: false
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
        <div className="space-y-5">
          <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02]">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
              <div>
                <p className="text-xs text-zinc-400">
                  Connected via VPS Bridge
                  <span className="text-zinc-600 mx-1.5">&#183;</span>
                  <span className="text-zinc-500">{status.server}</span>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-4">
              <p className="text-xs text-zinc-500 mb-1">Auto-Sync</p>
              <div className="flex items-center gap-2">
                <Wifi size={14} className="text-emerald-400" />
                <p className="text-sm font-medium text-white">Every 6 hours</p>
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-4">
              <p className="text-xs text-zinc-500 mb-1">Last Sync</p>
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-zinc-500" />
                <p className="text-sm font-medium text-white">{lastSyncAgo}</p>
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
            onClick={handleSync}
            disabled={syncing}
            className="w-full py-2.5 rounded-xl border border-white/10 text-xs text-zinc-300 font-medium hover:bg-white/[0.03] disabled:opacity-30 transition-all flex items-center justify-center gap-2"
          >
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>

          <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-4">
            <p className="text-xs text-zinc-500 leading-relaxed">
              Trades are synced automatically every 6 hours from the VPS.
              Use "Sync Now" to pull the latest trades immediately.
            </p>
          </div>
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
