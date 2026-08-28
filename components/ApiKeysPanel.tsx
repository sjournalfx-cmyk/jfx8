import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Check, Copy, Download, KeyRound, Plus, RefreshCw, Terminal, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type ApiKey = { id: string; name: string; key_prefix: string; scopes: string[]; last_used_at: string | null; expires_at: string | null; created_at: string; status: 'active' | 'revoked'; revoked_at: string | null };
type Scope = 'trades:read' | 'trades:write' | 'notes:read' | 'notes:write' | 'bridge:read' | 'me:read';

const scopeGroups: Array<{ label: string; items: Array<{ value: Scope; label: string; desc?: string }> }> = [
  {
    label: 'Trades & cTrader',
    items: [
      { value: 'trades:read', label: 'Read trades & analytics', desc: 'Query journal trades, metrics & win rates' },
      { value: 'trades:write', label: 'Trade execution & write trades', desc: 'Open, close & modify cTrader positions and log journal entries' },
    ],
  },
  {
    label: 'Bridge & Positions',
    items: [
      { value: 'bridge:read', label: 'Read live positions & bridge', desc: 'Inspect open positions and sync health' },
    ],
  },
  {
    label: 'Notes',
    items: [
      { value: 'notes:read', label: 'Read notes', desc: 'Access journal notes and strategy logs' },
      { value: 'notes:write', label: 'Write notes', desc: 'Create and update playbook notes' },
    ],
  },
  {
    label: 'Self',
    items: [
      { value: 'me:read', label: 'Read profile & metadata', desc: 'View user profile and key information' },
    ],
  },
];

const formatDate = (value: string | null) => value ? new Date(value).toLocaleDateString() : 'Never';
const JFX_API_BASE = 'https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api';
const JFX_CTRADER_TRADE_URL = 'https://jfxjournal.site/api/ctrader/trade';
const DEFAULT_SCOPES: Scope[] = ['trades:read', 'trades:write'];
const agentSkill = `---
name: jfx-journal
description: Use the JFX Journal and cTrader API to query journal data, analytics, bridge state, and execute live or demo cTrader trades (open, close, modify).
---

# JFX Journal & cTrader Agent Skill

The API key is stored in the \`JFX_KEY\` environment variable. Never reveal the key or commit it to source control.

Base URLs:
- Journal & Analytics API: ${JFX_API_BASE}
- cTrader Execution API: ${JFX_CTRADER_TRADE_URL} (or /api/ctrader/trade)

Environment (.env downloaded from the key screen):
\`\`\`
JFX_KEY=jfx_pat_...
JFX_BASE=${JFX_API_BASE}
JFX_CTRADER_TRADE_URL=${JFX_CTRADER_TRADE_URL}
\`\`\`

---

## 1. Journal & Analytics Requests

Header: \`X-API-Key: $JFX_KEY\`

- Latest trade: \`GET /v1/trades?limit=1\`
- Recent trades: \`GET /v1/trades?limit=20\`
- Trade summary: \`GET /v1/analytics/summary\`
- Monthly summary: \`GET /v1/analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD\`
- Notes: \`GET /v1/notes?limit=20\`
- Bridge health: \`GET /v1/bridge/status\` — requires \`bridge:read\`
- Open positions (MT5 bridge): \`GET /v1/positions\` — requires \`bridge:read\` or \`trades:read\`/\`trades:write\`

Scopes: \`trades:read\` for reads, \`trades:write\` for writes and cTrader execution (\`trades:write\` implies \`trades:read\`).

---

## 2. cTrader Live Trading (Open, Close, Modify)

Endpoint: \`POST \${JFX_CTRADER_TRADE_URL:-${JFX_CTRADER_TRADE_URL}}\`
Header: \`X-API-Key: $JFX_KEY\` (No broker access tokens needed — authenticated securely via your JFX key)
Scopes: any trade execution (\`open\`, \`close\`, \`modify_position\`, \`modify_order\`, \`cancel_order\`, also aliases \`buy\`/\`sell\` and fields \`pair\`/\`instrument\`/\`ticker\` as aliases for \`symbol\`) requires \`trades:write\`. Reading positions requires \`trades:read\` (or \`trades:write\`).
If you get \`403 insufficient_scope need trades:write\`, tell the user to recreate the key with \`trades:write\` in Settings → Developer Tools. If you get \`400 ctrader_not_connected\`, instruct them to connect cTrader once in the web app on the **Connect & Import** page.

### Get Open Positions & Pending Orders
\`\`\`json
{
  "action": "get_positions",
  "isDemo": true
}
\`\`\`

### Open Market, Limit, or Stop Order
\`\`\`json
{
  "action": "open",
  "symbol": "EURUSD",
  "side": "buy",
  "volume": 0.01,
  "orderType": "market",
  "stopLoss": 1.0750,
  "takeProfit": 1.0950,
  "isDemo": true,
  "comment": "Opened by AI agent"
}
\`\`\`

### Close Position (Full or Partial)
\`\`\`json
{
  "action": "close",
  "positionId": 9876543,
  "volume": 0.01,
  "isDemo": true
}
\`\`\`

### Modify Position (Stop Loss & Take Profit)
\`\`\`json
{
  "action": "modify_position",
  "positionId": 9876543,
  "stopLoss": 1.0760,
  "takeProfit": 1.0960,
  "isDemo": true
}
\`\`\`

### Modify / Cancel Pending Order
\`\`\`json
{
  "action": "modify_order",
  "orderId": 456789,
  "limitPrice": 1.0820,
  "stopLoss": 1.0760,
  "takeProfit": 1.0960,
  "isDemo": true
}
\`\`\`
\`\`\`json
{
  "action": "cancel_order",
  "orderId": 456789,
  "isDemo": true
}
\`\`\`

Only execute trading actions when explicitly requested or confirmed by the user.

## 3. Error Handling

- \`401\` — missing/malformed/expired/revoked key
- \`403 insufficient_scope need trades:write\` — key lacks \`trades:write\`; ask user to recreate with trading scopes in Settings → Developer Tools
- \`400 ctrader_not_connected\` — key valid but cTrader not linked; ask user to connect cTrader once on the **Connect & Import** page
- \`429\` — rate limited; retry after \`Retry-After\` seconds
`;

export function ApiKeysPanel({ isDarkMode }: { isDarkMode: boolean }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>([...DEFAULT_SCOPES]);
  const [expiry, setExpiry] = useState('90');
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedGuide, setCopiedGuide] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cardClass = isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white';
  const inputClass = isDarkMode ? 'border-white/[0.1] bg-white/[0.04] text-white' : 'border-slate-200 bg-white text-slate-900';

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('list_api_keys');
    if (error) setError(error.message); else setKeys((data ?? []) as ApiKey[]);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const expiresAt = useMemo(() => {
    if (expiry === 'never') return null;
    const next = new Date(); next.setDate(next.getDate() + Number(expiry)); return next.toISOString();
  }, [expiry]);

  const create = async () => {
    setError(null);
    if (!name.trim() || !scopes.length) return setError('Enter a name and choose at least one scope.');
    const { data, error } = await supabase.rpc('generate_api_key', { p_name: name.trim(), p_scopes: scopes, p_expires_at: expiresAt });
    if (error) return setError(error.message);
    setRawKey(data?.raw_key ?? null); setCreating(false); setName(''); setScopes([...DEFAULT_SCOPES]); await load();
  };
  const revoke = async (key: ApiKey) => {
    if (!window.confirm(`Revoke “${key.name}”? This permanently deletes the live API key and cannot be undone.`)) return;
    const { data, error } = await supabase.rpc('revoke_api_key', { p_key_id: key.id });
    if (error) return setError(error.message);
    if (!data) return setError('The key could not be revoked. It may already be inactive.');
    await load();
  };
  const toggleScope = (scope: Scope) => setScopes(previous => previous.includes(scope) ? previous.filter(item => item !== scope) : [...previous, scope]);
  const downloadEnv = () => {
    if (!rawKey) return;
    const content = `# JFX Journal Personal API Key\nJFX_KEY=${rawKey}\nJFX_BASE=${JFX_API_BASE}\nJFX_CTRADER_TRADE_URL=${JFX_CTRADER_TRADE_URL}\n`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'jfx-journal.env'; link.click();
    URL.revokeObjectURL(url);
  };
  const downloadSkill = () => {
    const url = URL.createObjectURL(new Blob([agentSkill], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'SKILL.md'; link.click();
    URL.revokeObjectURL(url);
  };
  const copySkill = async () => {
    await navigator.clipboard.writeText(agentSkill);
    setCopiedGuide(true);
    window.setTimeout(() => setCopiedGuide(false), 2000);
  };

  return <section className={`rounded-3xl border p-5 ${cardClass}`}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2"><KeyRound size={17} className="text-[#FF4F01]" /><h3 className="text-sm font-black">Personal API Keys</h3></div>
        <p className="mt-1 text-xs opacity-60">Connect Claude, Cursor, Codex, and trading bots to query your journal and execute cTrader trades.</p>
      </div>
      <button onClick={() => { setCreating(true); setError(null); }} className="flex items-center gap-2 rounded-xl bg-[#FF4F01] px-3 py-2 text-xs font-black text-white"><Plus size={15} /> Create key</button>
    </div>
    <section className={`mt-5 rounded-2xl border p-4 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.02]' : 'border-slate-200 bg-slate-50'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-2.5"><div className="rounded-lg bg-[#FF4F01]/10 p-2 text-[#FF4F01]"><Bot size={16} /></div><div><p className="text-xs font-black">Connect an AI agent</p><p className="mt-0.5 text-[11px] opacity-60">Give Claude Code, Codex CLI, or Hermes the instructions once; they can review journal history and execute trades via cTrader.</p></div></div><div className="flex gap-2"><button onClick={() => void copySkill()} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-black ${inputClass}`}>{copiedGuide ? <Check size={13} /> : <Copy size={13} />}{copiedGuide ? 'Copied' : 'Copy instructions'}</button><button onClick={downloadSkill} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-black ${inputClass}`}><Download size={13} />SKILL.md</button></div></div>
      <div className="mt-3 grid gap-2 md:grid-cols-3"><div className="rounded-xl border border-dashed p-2.5 text-[10px] opacity-75"><p className="font-black">1. Choose scopes</p><p className="mt-1">Select <code>trades:read</code> for metrics and <code>trades:write</code> to let agents open/close trades.</p></div><div className="rounded-xl border border-dashed p-2.5 text-[10px] opacity-75"><p className="font-black">2. Save the secret</p><p className="mt-1">Download the <code>.env</code> file from the one-time key screen.</p></div><div className="rounded-xl border border-dashed p-2.5 text-[10px] opacity-75"><p className="font-black">3. Install the skill</p><p className="mt-1">Place <code>SKILL.md</code> in your agent’s skills folder, then restart it.</p></div></div>
      <div className={`mt-3 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[10px] ${isDarkMode ? 'bg-black/30' : 'bg-white'}`}><Terminal size={13} className="text-[#FF4F01]" /><code className="break-all">curl -H "X-API-Key: $JFX_KEY" "{JFX_API_BASE}/v1/trades?limit=1"</code></div>
    </section>
    {error && <p className="mt-4 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{error}</p>}
    <div className="mt-5 overflow-x-auto rounded-2xl border border-dashed">
      {loading ? <p className="p-4 text-xs opacity-50">Loading API keys…</p> : keys.length === 0 ? <p className="p-4 text-xs opacity-55">No API keys yet. Create a scoped key for an external tool.</p> : <div className="min-w-[720px]">
        <div className={`grid grid-cols-[1.6fr_1fr_0.8fr_0.8fr_0.7fr_40px] gap-3 border-b px-4 py-2 text-[9px] font-black uppercase tracking-[0.14em] opacity-45 ${isDarkMode ? 'border-white/[0.08]' : 'border-slate-200'}`}><span>Name / Key</span><span>Scopes</span><span>Created</span><span>Last Used</span><span>Status</span><span /></div>
        {keys.map(key => <div key={`${key.status}-${key.id}`} className={`grid grid-cols-[1.6fr_1fr_0.8fr_0.8fr_0.7fr_40px] items-center gap-3 px-4 py-3 text-xs ${isDarkMode ? 'border-white/[0.06] even:bg-white/[0.02]' : 'border-slate-100 even:bg-slate-50'}`}>
          <div><p className="font-black">{key.name}</p><code className="mt-0.5 block text-[10px] text-[#FF4F01]">{key.key_prefix}_••••••••</code></div>
          <div className="flex flex-wrap gap-1">{key.scopes.map(scope => <span key={scope} className="rounded-md bg-[#FF4F01]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#FF4F01]">{scope}</span>)}</div>
          <span className="opacity-60">{formatDate(key.created_at)}</span><span className="opacity-60">{formatDate(key.last_used_at)}</span>
          <span className={`w-fit rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wide ${key.status === 'revoked' ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500'}`}>{key.status}</span>
          {key.status === 'active' ? <button onClick={() => void revoke(key)} title="Revoke key" className="rounded-lg p-2 text-rose-500 hover:bg-rose-500/10"><Trash2 size={15} /></button> : <span />}
        </div>)}
      </div>}
    </div>

    {creating && createPortal(<div className="api-key-modal-layer bg-black/70 p-4"><div className={`api-key-modal-card border p-7 shadow-2xl ${isDarkMode ? 'border-white/10 bg-[#151515] text-white' : 'border-slate-200 bg-white text-slate-900'}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-black">Create personal API key</h3>
        <span className="rounded-full bg-[#FF4F01]/10 px-2.5 py-0.5 text-[10px] font-black text-[#FF4F01]">cTrader Trading Ready</span>
      </div>
      <p className="mt-1 text-xs opacity-60">The secret will be shown once. Store it in a password manager or environment variable.</p>
      <label className="mt-4 block text-xs font-bold">Name<input value={name} onChange={event => setName(event.target.value)} placeholder="Claude trade review & execution" className={`mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none ${inputClass}`} /></label>
      <div className="mt-4 space-y-3">
        {scopeGroups.map(group => (
          <div key={group.label} className={`rounded-xl border p-3 ${isDarkMode ? 'border-white/[0.06] bg-white/[0.02]' : 'border-slate-100 bg-slate-50/50'}`}>
            <p className="mb-1.5 text-[10px] font-black uppercase tracking-wider opacity-45">{group.label}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.items.map(item => (
                <label key={item.value} className="flex items-start gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-[#FF4F01]"
                    checked={scopes.includes(item.value)}
                    onChange={() => toggleScope(item.value)}
                  />
                  <div>
                    <span className="font-bold">{item.label}</span>
                    {item.desc && <p className="text-[10px] opacity-50 leading-tight mt-0.5">{item.desc}</p>}
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {!scopes.includes('trades:write') && (
        <div className={`mt-3 rounded-xl border px-3 py-2.5 text-xs ${isDarkMode ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
          <span className="font-black">Heads up:</span> Without <code className="font-bold">trades:write</code> agents can only read journal data — they will not be able to open/close cTrader trades. Enable it above for buy/sell.
        </div>
      )}
      <label className="mt-4 block text-xs font-bold">Expiry<select value={expiry} onChange={event => setExpiry(event.target.value)} className={`mt-2 w-full rounded-xl border px-3 py-2 text-sm ${inputClass}`}><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">365 days</option><option value="never">Never</option></select></label>
      <div className="mt-6 flex justify-end gap-2"><button onClick={() => setCreating(false)} className="rounded-xl px-3 py-2 text-xs font-bold opacity-70">Cancel</button><button onClick={() => void create()} className="rounded-xl bg-[#FF4F01] px-3 py-2 text-xs font-black text-white">Generate key</button></div>
    </div></div>, document.body)}
    {rawKey && createPortal(<div className="api-key-modal-layer bg-black/70 p-4"><div className={`api-key-modal-card border p-7 shadow-2xl ${isDarkMode ? 'border-white/10 bg-[#151515] text-white' : 'border-slate-200 bg-white text-slate-900'}`}>
      <h3 className="text-lg font-black">Save your API key now</h3><p className="mt-1 text-xs text-amber-500">For security, it cannot be shown again.</p><code className={`mt-4 block break-all rounded-xl border p-3 text-xs ${inputClass}`}>{rawKey}</code>
      <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => { navigator.clipboard.writeText(rawKey); setCopied(true); }} className="flex items-center justify-center gap-2 rounded-xl bg-[#FF4F01] px-3 py-2 text-xs font-black text-white">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy key'}</button><button onClick={downloadEnv} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-black ${inputClass}`}><Download size={15} />Download .env</button></div>
      <label className="mt-4 flex items-center gap-2 text-xs"><input type="checkbox" checked={copied} onChange={event => setCopied(event.target.checked)} />I have saved this key securely.</label><button disabled={!copied} onClick={() => { setRawKey(null); setCopied(false); }} className="mt-4 w-full rounded-xl border px-3 py-2 text-xs font-bold disabled:opacity-40">Done</button>
    </div></div>, document.body)}
  </section>;
}
