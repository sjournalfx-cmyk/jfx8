import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  User,
  Globe,
  Shield,
  Save,
  Trash2,
  CreditCard,
  Mail,
  CheckCircle2,
  Copy,
  Check,
  Crown,
  HelpCircle,
  MessageSquare,
  Video,
  Send,
  ChevronDown,
  LogOut,
  Briefcase,
  Palette,
  Moon,
  Zap,
  ExternalLink,
  Clock,
  Code2,
  FileText,
} from 'lucide-react';
import { UserProfile, EASession, Portfolio } from '../types';
import { APP_CONSTANTS, normalizePlan } from '../lib/constants';
import { Select } from './Select';
import { normalizeThemePreference } from '../lib/theme';
import { getDefaultTimezone } from '../lib/timeUtils';
import { ApiKeysPanel } from './ApiKeysPanel';
import ConfirmationModal from './ConfirmationModal';
import { DESKTOP_BRIDGE_ENABLED } from '../config/features';

const freeAvatars = [
  'https://api.dicebear.com/7.x/bottts/svg?seed=1&backgroundColor=f1f5f9',
  'https://api.dicebear.com/7.x/bottts/svg?seed=2&backgroundColor=f1f5f9',
  'https://api.dicebear.com/7.x/bottts/svg?seed=3&backgroundColor=f1f5f9',
  'https://api.dicebear.com/7.x/bottts/svg?seed=4&backgroundColor=f1f5f9',
  'https://api.dicebear.com/7.x/bottts/svg?seed=5&backgroundColor=f1f5f9',
  'https://api.dicebear.com/7.x/bottts/svg?seed=6&backgroundColor=f1f5f9',
];

const proAvatars = [
  'https://api.dicebear.com/8.x/bottts-neutral/svg?seed=1&backgroundColor=e9d5ff&primaryColor=a855f7,c026d3,d8b4fe&backgroundType=gradientLinear',
  'https://api.dicebear.com/8.x/bottts-neutral/svg?seed=2&backgroundColor=e9d5ff&primaryColor=a855f7,c026d3,d8b4fe&backgroundType=gradientLinear',
  'https://api.dicebear.com/8.x/thumbs/svg?seed=1&backgroundColor=e9d5ff,d8b4fe,c084fc&backgroundType=gradientLinear',
  'https://api.dicebear.com/8.x/identicon/svg?seed=1&backgroundColor=fefce8,fef9c3,fef08a&backgroundType=gradientLinear',
  'https://api.dicebear.com/8.x/identicon/svg?seed=2&backgroundColor=fefce8,fef9c3,fef08a&backgroundType=gradientLinear',
  'https://api.dicebear.com/8.x/identicon/svg?seed=3&backgroundColor=fefce8,fef9c3,fef08a&backgroundType=gradientLinear',
];

const premiumAvatars = [
  'https://api.dicebear.com/7.x/lorelei/svg?seed=1&backgroundColor=c7d2fe',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=2&backgroundColor=c7d2fe',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=3&backgroundColor=c7d2fe',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=1&backgroundColor=c7d2fe',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=2&backgroundColor=c7d2fe',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=3&backgroundColor=c7d2fe',
];

type SettingsTab = 'profile' | 'account' | 'appearance' | 'billing' | 'security' | 'developer-tools' | 'help';

interface SettingsProps {
  isDarkMode: boolean;
  userProfile: UserProfile;
  userEmail?: string;
  onUpdateProfile: (profile: UserProfile) => Promise<void>;
  onLogout: () => void;
  tradesThisMonth?: number;
  totalNotes?: number;
  totalImages?: number;
  tradesCount?: number;
  onDeduplicate?: () => Promise<void>;
  initialTab?: SettingsTab;
  /** Tabs hidden from the section nav (e.g. mobile hides Appearance, Developer Tools, Help). */
  hiddenTabs?: SettingsTab[];
  /** Mobile: increment to trigger handleSave from the floating save button. Desktop never passes this. */
  saveSignal?: number;
  /** Mobile: notified whenever the effective settings tab changes (to hide the save FAB on tabs with nothing to save). */
  onSettingsTabChange?: (tab: SettingsTab) => void;
  migrationVersion?: string;
  /** Needed by the diagnostics panel (plan limits, portfolio + queue state). */
  userId?: string | null;
  offlineQueueCount?: number;
  eaSession?: EASession | null;
  portfolios?: Portfolio[];
  activePortfolioId?: string | null;
  defaultPortfolioId?: string | null;
  canAddPortfolio?: boolean;
  tradeCounts?: Record<string, number>;
  onSelectPortfolioId?: (id: string) => void;
  onAddPortfolio?: (input: { name: string; description?: string; purpose?: Portfolio['purpose']; source?: Portfolio['source']; startingBalance?: number; currency?: string }) => Promise<Portfolio>;
  onRemovePortfolio?: (id: string) => Promise<void>;
  hasCtraderConnection?: boolean;
  onDisconnectCtrader?: () => Promise<void> | void;
}

const tabs: Array<{ id: SettingsTab; label: string; shortLabel: string; icon: React.ElementType; desc: string }> = [
  { id: 'profile', label: 'Trading Persona', shortLabel: 'Profile', icon: User, desc: 'Identity and style' },
  { id: 'account', label: 'Account Config', shortLabel: 'Account', icon: Briefcase, desc: 'Sync and balance' },
  { id: 'appearance', label: 'Appearance', shortLabel: 'Looks', icon: Palette, desc: 'Theme and motion' },
  { id: 'billing', label: 'Plan & Billing', shortLabel: 'Billing', icon: CreditCard, desc: 'Usage and plan' },
  { id: 'security', label: 'Security', shortLabel: 'Security', icon: Shield, desc: 'Access and session' },
  { id: 'developer-tools', label: 'Developer Tools', shortLabel: 'Dev Tools', icon: Code2, desc: 'API keys and integrations' },
  { id: 'help', label: 'Help & Feedback', shortLabel: 'Help', icon: HelpCircle, desc: 'Docs and support' },
];

import { PortfolioSwitcher } from './PortfolioSwitcher';
import { DiagnosticsPanel } from './DiagnosticsPanel';

const profileOptions = {
  tradingStyle: ['Scalper', 'Day Trader', 'Swing Trader', 'Investor'],
  experienceLevel: ['Beginner', 'Intermediate', 'Advanced', 'Pro'],
} as const;

const supportLinks = [
  { title: 'Documentation', icon: HelpCircle, desc: 'Setup guides, workflows, and feature notes.', href: '/DOCUMENTATION.md' },
  { title: 'Telegram Community', icon: MessageSquare, desc: 'Share feedback and get release updates.', href: 'https://t.me/+w_KvKM5HESYyMTdk' },
  { title: 'Video Tutorials', icon: Video, desc: 'Short walkthroughs for common setup tasks.', href: null },
  { title: 'Features', icon: Zap, desc: 'See everything JFX Journal can do.', href: '/features' },
  { title: 'Privacy Policy', icon: Shield, desc: 'How we collect, use and protect your data.', href: '/privacy' },
  { title: 'Terms of Service', icon: FileText, desc: 'The rules that govern your use of JFX.', href: '/terms' },
];

const faqItems = [
  { q: 'How do I sync trades from MT5?', a: 'Go to Account Config, generate a sync key, and enter it in the JFX Bridge app.' },
  { q: 'How do I upgrade my plan?', a: 'Open Plan & Billing and switch to the tier you want.' },
  { q: 'Why are my charts not loading?', a: 'Try turning off Keep Charts Alive in Appearance, then refresh the page.' },
  { q: 'Where do I report bugs?', a: 'Use Help & Feedback to send a direct message from inside the app.' },
];

const Settings: React.FC<SettingsProps> = ({
  isDarkMode,
  userProfile,
  userEmail,
  migrationVersion,
  onUpdateProfile,
  onLogout,
  tradesThisMonth = 0,
  totalNotes = 0,
  totalImages = 0,
  tradesCount = 0,
  onDeduplicate,
  initialTab = 'profile',
  hiddenTabs = [],
  saveSignal = 0,
  onSettingsTabChange,
  eaSession,
  portfolios = [],
  activePortfolioId = null,
  defaultPortfolioId = null,
  canAddPortfolio = true,
  tradeCounts,
  onSelectPortfolioId,
  onAddPortfolio,
  onRemovePortfolio,
  hasCtraderConnection = false,
  onDisconnectCtrader,
  userId = null,
  offlineQueueCount = 0,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const visibleTabs = tabs.filter((t) => !hiddenTabs.includes(t.id));
  const effectiveTab = hiddenTabs.includes(activeTab) ? (visibleTabs[0]?.id ?? 'profile') : activeTab;
  // Mobile rail can scroll when squeezed: keep the active chip in view.
  // We scroll ONLY the aside rail container directly so parent containers (main/window) NEVER shift horizontally.
  const railRef = useRef<HTMLElement | null>(null);
  const activeTabBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const rail = railRef.current;
    const btn = activeTabBtnRef.current;
    if (rail && btn) {
      const left = btn.offsetLeft - rail.clientWidth / 2 + btn.clientWidth / 2;
      rail.scrollTo({ left, behavior: 'smooth' });
    }
  }, [effectiveTab]);
  const [formData, setFormData] = useState<UserProfile>({ ...userProfile, plan: normalizePlan(userProfile.plan) });

  const currentPlan = normalizePlan(formData.plan);
  const isFreeTier = currentPlan === APP_CONSTANTS.PLANS.FREE;
  const isBrokerSyncTier = currentPlan === APP_CONSTANTS.PLANS.HOBBY || currentPlan === APP_CONSTANTS.PLANS.STANDARD;
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveStatus] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showRegenSyncKeyConfirm, setShowRegenSyncKeyConfirm] = useState(false);
  const [showDisconnectCtraderConfirm, setShowDisconnectCtraderConfirm] = useState(false);
  const [isDisconnectingCtrader, setIsDisconnectingCtrader] = useState(false);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState('Bug Report');
  const [feedbackSubject, setFeedbackSubject] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');

  const localBrokerInfo = useMemo(() => {
    if (!eaSession?.data?.account) return null;
    return {
      login: eaSession.data.account.login || userProfile.broker_login,
      server: eaSession.data.account.server || userProfile.broker_server,
      balance: eaSession.data.account.balance,
      equity: eaSession.data.account.equity,
      currency: eaSession.data.account.currency || 'USD',
    };
  }, [eaSession, userProfile.broker_login, userProfile.broker_server]);


  useEffect(() => {
    setActiveTab(hiddenTabs.includes(initialTab) ? (visibleTabs[0]?.id ?? 'profile') : initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  useEffect(() => {
    setFormData({ ...userProfile, plan: normalizePlan(userProfile.plan) });
  }, [userProfile]);

  useEffect(() => {
    const activeTheme = normalizeThemePreference(formData.themePreference);

    if (activeTab === 'appearance' && formData.plan === 'PREMIUM (MASTERS)') {
      document.body.classList.remove('theme-obsidian', 'theme-cosmic');
      document.body.classList.add(`theme-${activeTheme}`);
    }

    return () => {
      document.body.classList.remove('theme-obsidian', 'theme-cosmic');
      document.body.classList.add(`theme-${normalizeThemePreference(userProfile?.themePreference)}`);
    };
  }, [activeTab, formData.plan, formData.themePreference, userProfile?.themePreference]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdateProfile(formData);
      setSaveStatus('Saved');
      setTimeout(() => setSaveStatus(null), 2500);
    } catch {
      setSaveStatus('Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  // Mobile floating save button: each saveSignal bump triggers a save
  // (security/developer-tools tabs own their own actions, so they opt out).
  const seenSaveSignal = useRef(saveSignal);
  useEffect(() => {
    if (seenSaveSignal.current === saveSignal) return;
    seenSaveSignal.current = saveSignal;
    if (effectiveTab === 'security' || effectiveTab === 'developer-tools') return;
    void handleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveSignal]);

  // Mobile: report tab switches so the FAB can hide where nothing saves.
  useEffect(() => {
    onSettingsTabChange?.(effectiveTab);
  }, [effectiveTab]);

  const handleCopyKey = async () => {
    if (!formData.syncKey) return;
    await navigator.clipboard.writeText(formData.syncKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1800);
  };

  const handleRegenerateSyncKey = () => {
    const rand = () => {
      const bytes = new Uint8Array(4);
      crypto.getRandomValues(bytes);
      return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase().slice(0, 4);
    };
    setFormData({ ...formData, syncKey: `JFX-${rand()}-${rand()}` });
    setShowRegenSyncKeyConfirm(false);
  };

  const handleDisconnectCtrader = async () => {
    if (!onDisconnectCtrader || isDisconnectingCtrader) return;
    setIsDisconnectingCtrader(true);
    try {
      await onDisconnectCtrader();
      setShowDisconnectCtraderConfirm(false);
    } finally {
      setIsDisconnectingCtrader(false);
    }
  };

  const handleFeedbackSubmit = async () => {
    setIsSubmittingFeedback(true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const updatedProfile = { ...formData, feedbackSent: true };
    await onUpdateProfile(updatedProfile);
    setFormData(updatedProfile);
    setIsSubmittingFeedback(false);
    setFeedbackSuccess(true);
    setFeedbackSubject('');
    setFeedbackMessage('');
    setTimeout(() => setFeedbackSuccess(false), 4000);
  };

  const handlePlanSwitch = async (planId: string) => {
    const nextProfile = { ...formData, plan: normalizePlan(planId) };
    const previousProfile = formData;

    setFormData(nextProfile);
    setIsSaving(true);

    try {
      await onUpdateProfile(nextProfile);
      setSaveStatus('Plan updated');
      setTimeout(() => setSaveStatus(null), 2500);
    } catch {
      setFormData(previousProfile);
      setSaveStatus('Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const containerBg = 'bg-[#000000] text-zinc-100';

  const shellCard = isDarkMode
    ? 'bg-[#000000] border-white/[0.08] shadow-[0_20px_60px_rgba(0,0,0,0.25)]'
    : 'bg-white border-slate-200 shadow-[0_24px_80px_rgba(15,23,42,0.08)]';

  const compactInputClass = `w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-all ${
    isDarkMode
      ? 'bg-white/[0.03] border-white/[0.08] text-zinc-100 placeholder:text-zinc-500 focus:border-[#FF4F01]'
      : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-[#FF4F01] focus:bg-white'
  }`;

  const compactLabelClass = 'text-[10px] font-black uppercase tracking-[0.2em] opacity-50 block mb-1.5';

  const currentTab = tabs.find((tab) => tab.id === effectiveTab) ?? visibleTabs[0] ?? tabs[0];
  const bridgeEntryDisabled = !DESKTOP_BRIDGE_ENABLED;

  const renderPlanProgress = (value: number, limit: number) => (
    <div className={`h-1.5 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-white/[0.08]' : 'bg-slate-200'}`}>
      <div className="h-full rounded-full bg-[#FF4F01]" style={{ width: `${Math.min(100, (value / limit) * 100)}%` }} />
    </div>
  );

  const renderAvatarGrid = (avatars: string[]) => (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {avatars.map((url) => (
        <button
          key={url}
          onClick={() => setFormData({ ...formData, avatarUrl: url })}
          className={`aspect-square overflow-hidden rounded-xl border-2 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
            formData.avatarUrl === url
              ? 'border-[#FF4F01] ring-2 ring-[#FF4F01]/15'
              : isDarkMode
                ? 'border-white/[0.08] hover:border-white/[0.18]'
                : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <img src={url} alt="Avatar option" className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );

  return (
    <div className={`h-screen overflow-hidden ${containerBg}`}>
      <div className="flex h-full w-full flex-col gap-5 p-4 sm:p-5 lg:p-6">
        <header className={`rounded-[28px] border p-5 md:p-6 ${shellCard}`}>
          <div className="settings-content-scale flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#FF4F01]">Preferences</p>
              <h1 className="mt-2 text-4xl font-black tracking-tight md:text-5xl">Settings</h1>
              <p className={`mt-3 max-w-2xl text-sm leading-relaxed ${isDarkMode ? 'text-zinc-400' : 'text-slate-600'}`}>
                Keep your trading identity, account setup, appearance, plan, security, and support in one clean place.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className={`rounded-2xl border px-4 py-3 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Plan</p>
                <p className="mt-1 text-sm font-bold">{formData.plan}</p>
              </div>
              <div className={`rounded-2xl border px-4 py-3 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Sync</p>
                <p className="mt-1 text-sm font-bold">{formData.syncMethod === 'EA_CONNECT' ? 'EA Active' : 'Manual'}</p>
              </div>
              <div className={`rounded-2xl border px-4 py-3 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Trades</p>
                <p className="mt-1 text-sm font-bold">{tradesCount}</p>
              </div>
              <div className={`rounded-2xl border px-4 py-3 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Notes</p>
                <p className="mt-1 text-sm font-bold">{totalNotes}</p>
              </div>
            </div>
          </div>
        </header>

        <div className="grid flex-1 min-h-0 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside ref={railRef} className={`flex min-h-0 flex-col gap-2.5 rounded-[28px] border p-2.5 ${shellCard} lg:sticky lg:top-8`}>
            <div className="px-3 pb-2 pt-1">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] opacity-40">Sections</p>
            </div>

            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const active = effectiveTab === tab.id;

              return (
                <button
                  key={tab.id}
                  ref={active ? activeTabBtnRef : undefined}
                  onClick={() => setActiveTab(tab.id)}
                  className={`group flex items-center gap-3 rounded-2xl px-3.5 py-3.5 text-left transition-all ${
                    active
                      ? 'bg-[#FF4F01] text-white shadow-lg shadow-[#FF4F01]/20'
                      : isDarkMode
                        ? 'text-zinc-300 hover:bg-white/[0.04]'
                        : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className={`rounded-xl p-2 ${active ? 'bg-white/15' : isDarkMode ? 'bg-white/[0.04]' : 'bg-slate-100'}`}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold">
                      <span className="tab-label-full">{tab.label}</span>
                      <span className="tab-label-short">{tab.shortLabel}</span>
                    </p>
                    <p className={`text-[10px] ${active ? 'text-white/75' : 'opacity-45'}`}>{tab.desc}</p>
                  </div>
                </button>
              );
            })}

            <div className={`mt-2 rounded-2xl border p-3.5 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-rose-500/10 p-2 text-rose-500">
                  <LogOut size={14} />
                </div>
                <div>
                  <p className="text-[13px] font-bold">Sign out</p>
                  <p className="text-[10px] opacity-50">End this session on the device.</p>
                </div>
              </div>
              <button
                onClick={onLogout}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 px-3.5 py-2.5 text-sm font-bold text-white transition-all hover:bg-rose-400"
              >
                <LogOut size={16} />
                Sign Out
              </button>
            </div>
          </aside>

          <main className={`flex min-h-0 flex-col overflow-y-auto rounded-[28px] border p-5 md:p-6 ${shellCard} custom-scrollbar`}>
            <div className="settings-content-scale">
            <div
              className={`mb-5 flex flex-col gap-3 border-b pb-4 ${
                isDarkMode ? 'border-white/[0.06]' : 'border-slate-200'
              }`}
            >
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#FF4F01]">{currentTab.label}</p>
                  <h2 className="mt-1 text-xl font-black tracking-tight">{currentTab.label}</h2>
                </div>
                {effectiveTab === 'help' ? (
                  <a
                    href="https://t.me/+w_KvKM5HESYyMTdk"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-[#0088cc]/30 bg-[#0088cc]/10 px-4 py-2 text-xs font-bold text-[#0088cc] hover:bg-[#0088cc]/20 transition-all hover:scale-[1.02] shadow-sm shadow-[#0088cc]/10 cursor-pointer"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="shrink-0"
                    >
                      <path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.578.192l-8.533 7.701-.33 4.955c.488 0 .702-.223.974-.485l2.338-2.27 4.861 3.59c.896.494 1.763-.829l3.185-15.01c.326-1.309-.5-1.902-1.356-1.513z" />
                    </svg>
                    Join us in Telegram
                  </a>
                ) : (
                  <p className={`max-w-2xl text-sm ${isDarkMode ? 'text-zinc-400' : 'text-slate-600'}`}>
                    {currentTab.desc}
                  </p>
                )}
              </div>
            </div>

            {effectiveTab === 'profile' && (
              <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
                <section className={`rounded-3xl border p-5 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="mb-5 flex items-center gap-3.5">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[20px] bg-gradient-to-br from-[#FF4F01] to-orange-500 shadow-lg shadow-[#FF4F01]/20">
                      {formData.avatarUrl ? (
                        <img src={formData.avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white">
                          <User size={26} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-40">Current Persona</p>
                      <h3 className="mt-0.5 truncate text-lg font-black">{formData.name}</h3>
                      <p className="mt-0.5 text-[13px] font-medium text-[#FF4F01]">{formData.plan}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label htmlFor="settings-full-name" className={compactLabelClass}>
                        Full Name
                      </label>
                      <input
                        id="settings-full-name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className={compactInputClass}
                      />
                    </div>
                    <div>
                      <label className={compactLabelClass}>Email Address</label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" size={15} />
                        <input value={userEmail || ''} readOnly className={`${compactInputClass} cursor-not-allowed pl-9 opacity-70`} />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="settings-country" className={compactLabelClass}>
                        Country
                      </label>
                      <div className="relative">
                        <Globe className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" size={15} />
                        <input
                          id="settings-country"
                          value={formData.country}
                          onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                          className={`${compactInputClass} pl-9`}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={compactLabelClass}>
                        Timezone
                      </label>
                      <div className="relative">
                        <Clock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" size={15} />
                        <input
                          value={formData.timezone || getDefaultTimezone()}
                          readOnly
                          className={`${compactInputClass} cursor-not-allowed pl-9 opacity-70`}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className={compactLabelClass}>Trading Style</label>
                        <Select
                          value={formData.tradingStyle}
                          onChange={(val) => setFormData({ ...formData, tradingStyle: val as UserProfile['tradingStyle'] })}
                          options={profileOptions.tradingStyle.map((item) => ({ value: item, label: item }))}
                          isDarkMode={isDarkMode}
                        />
                      </div>
                      <div>
                        <label className={compactLabelClass}>Experience Level</label>
                        <Select
                          value={formData.experienceLevel}
                          onChange={(val) => setFormData({ ...formData, experienceLevel: val as UserProfile['experienceLevel'] })}
                          options={profileOptions.experienceLevel.map((item) => ({ value: item, label: item }))}
                          isDarkMode={isDarkMode}
                        />
                      </div>
                    </div>
                  </div>

                </section>

                <section className="space-y-5">
                  <div className={`rounded-3xl border p-5 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'}`}>
                    <div className="mb-3.5 flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-40">Avatar Library</p>
                        <h3 className="mt-0.5 text-base font-black">Choose Your Avatar</h3>
                      </div>
                      <div className="rounded-full border px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] opacity-60">
                        {formData.plan.includes('FREE') ? 'Free' : formData.plan.includes('PRO') ? 'Pro' : 'Premium'}
                      </div>
                    </div>

                    <div className="space-y-4">
                      {formData.plan === 'FREE TIER (JOURNALER)' && (
                        <div>
                          <p className="mb-2.5 text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Journaler Bots</p>
                          {renderAvatarGrid(freeAvatars)}
                        </div>
                      )}

                      {formData.plan === 'PRO TIER (ANALYSTS)' && (
                        <div>
                          <p className="mb-2.5 text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Analyst Set</p>
                          {renderAvatarGrid(proAvatars)}
                        </div>
                      )}

                      {formData.plan === 'PREMIUM (MASTERS)' && (
                        <div>
                          <p className="mb-2.5 text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Master Set</p>
                          {renderAvatarGrid(premiumAvatars)}
                        </div>
                      )}
                    </div>

                  </div>
                </section>
              </div>
            )}

            {effectiveTab === 'account' && (
              <div className="space-y-5">
                <section className={`rounded-3xl border p-5 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                  <h3 className={`text-sm font-black uppercase tracking-widest mb-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Portfolios</h3>
                  <p className={`text-xs mb-4 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Each portfolio keeps its own journal, connection and stats. Imports and new trades land in the active one.</p>
                  <PortfolioSwitcher
                    portfolios={portfolios}
                    activeId={activePortfolioId}
                    defaultId={defaultPortfolioId}
                    canAdd={canAddPortfolio}
                    isDarkMode={isDarkMode}
                    variant="settings"
                    tradeCounts={tradeCounts}
                    onSelect={(id) => onSelectPortfolioId?.(id)}
                    onAdd={onAddPortfolio || (async () => { throw new Error('Portfolios unavailable right now.'); })}
                    onRemove={onRemovePortfolio || (async () => { throw new Error('Portfolios unavailable right now.'); })}
                  />
                </section>
                {hasCtraderConnection && onDisconnectCtrader && (
                  <section className={`rounded-3xl border p-5 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-start gap-3">
                        <LogOut size={18} className="mt-0.5 shrink-0 text-[#FF4F01]" />
                        <div>
                          <h3 className={`text-sm font-black uppercase tracking-widest ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>cTrader Connection</h3>
                          <p className={`mt-1 text-xs ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                            Disconnecting unlinks cTrader from every portfolio and clears cached broker balances. Your journal trades stay untouched.
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setShowDisconnectCtraderConfirm(true)}
                        className="shrink-0 rounded-xl border border-rose-500/30 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-rose-500 transition-all hover:bg-rose-500/10"
                      >
                        Disconnect cTrader
                      </button>
                    </div>
                  </section>
                )}
                <section className={`rounded-3xl border p-5 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label htmlFor="settings-account-name" className={compactLabelClass}>
                        Primary Account Name
                      </label>
                      <input
                        id="settings-account-name"
                        value={formData.accountName}
                        onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
                        className={compactInputClass}
                      />
                    </div>
                    <div>
                      <label className={compactLabelClass}>Base Currency</label>
                      <Select
                        value={formData.currency}
                        onChange={(val) => {
                          const selected = APP_CONSTANTS.CURRENCIES.find((currency) => currency.code === val);
                          if (selected) {
                            setFormData({
                              ...formData,
                              currency: selected.code,
                              currencySymbol: selected.symbol,
                            });
                          }
                        }}
                        options={APP_CONSTANTS.CURRENCIES.map((currency) => ({
                          value: currency.code,
                          label: `${currency.code} (${currency.symbol})`,
                        }))}
                        isDarkMode={isDarkMode}
                      />
                    </div>
                    <div>
                      {isFreeTier ? (
                        <>
                          <label htmlFor="settings-initial-balance" className={compactLabelClass}>
                            Initial Balance
                          </label>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-mono font-black text-[#FF4F01]">
                              {formData.currencySymbol}
                            </span>
                            <input
                              id="settings-initial-balance"
                              type="number"
                              value={formData.initialBalance}
                              onChange={(e) =>
                                setFormData({ ...formData, initialBalance: Number(e.target.value) || 0 })
                              }
                              className={`${compactInputClass} pl-9 font-mono`}
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <label className={compactLabelClass}>Account Balance</label>
                          <div className={`flex h-[44px] items-center gap-3 rounded-xl border px-3.5 ${
                            isDarkMode ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-emerald-200 bg-emerald-50'
                          }`}>
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-xs font-black uppercase tracking-[0.18em] text-emerald-500">
                              {isBrokerSyncTier && localBrokerInfo
                                ? `${formData.currencySymbol}${localBrokerInfo.balance?.toLocaleString(undefined, { minimumFractionDigits: 2 })} — Synced from Broker`
                                : isBrokerSyncTier
                                ? 'Synced from Broker — Connect EA to view live balance'
                                : `${formData.currencySymbol}${(formData.initialBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                              }
                            </span>
                          </div>
                          <p className="mt-1 text-[10px] opacity-40">
                            Your balance is pulled directly from your broker. To adjust it, update from within your trading platform.
                          </p>
                        </>
                      )}
                    </div>
                    <div>
                      <label className={compactLabelClass}>Sync Method</label>
                      <div className={`flex h-[44px] items-center justify-between rounded-xl border px-3.5 ${
                        isDarkMode ? 'border-white/[0.08] bg-white/[0.03]' : 'border-slate-200 bg-white'
                      }`}>
                        <div className="flex items-center gap-3">
                          <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                            formData.eaConnected
                              ? 'bg-emerald-500/10 text-emerald-500'
                              : 'bg-zinc-500/10 text-zinc-500'
                          }`}>
                            {formData.syncMethod === 'EA_CONNECT' ? 'EA Sync' : 'Manual'}
                          </span>
                          <span className="text-sm font-medium opacity-70">
                            {formData.eaConnected ? 'Connected' : 'Not connected'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {formData.syncMethod === 'EA_CONNECT' && (
                  <section
                    aria-disabled={bridgeEntryDisabled}
                    className={`rounded-3xl border p-5 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'} ${bridgeEntryDisabled ? 'opacity-50' : ''}`}
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-40">Sync Key</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2.5">
                          <code className="rounded-xl border px-3.5 py-2.5 font-mono text-sm font-bold tracking-wider text-[#FF4F01]">
                            {formData.syncKey || 'real-sync-key'}
                          </code>
                          <button
                            onClick={handleCopyKey}
                            disabled={bridgeEntryDisabled}
                            aria-disabled={bridgeEntryDisabled}
                            className={`rounded-xl border px-2.5 py-2.5 transition-all ${
                              bridgeEntryDisabled
                                ? 'cursor-not-allowed'
                                : copiedKey
                                  ? 'border-emerald-500 bg-emerald-500 text-white'
                                  : isDarkMode
                                    ? 'border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]'
                                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white'
                            }`}
                            title="Copy sync key"
                          >
                            {copiedKey ? <Check size={15} /> : <Copy size={15} />}
                          </button>
                          <button
                            onClick={() => setShowRegenSyncKeyConfirm(true)}
                            disabled={bridgeEntryDisabled}
                            aria-disabled={bridgeEntryDisabled}
                            className={`rounded-xl border px-2.5 py-2.5 transition-all ${
                              bridgeEntryDisabled
                                ? 'cursor-not-allowed'
                                : isDarkMode
                                  ? 'border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]'
                                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white'
                            }`}
                            title="Regenerate sync key"
                          >
                            <Zap size={15} />
                          </button>
                        </div>
                      </div>

                      <div
                        className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 ${
                          isDarkMode ? 'border-white/[0.08] bg-white/[0.03]' : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Auto-journal</p>
                          <p className="text-sm font-medium opacity-70">Automatically add closed trades.</p>
                        </div>
                        <button
                          onClick={() => setFormData({ ...formData, autoJournal: !formData.autoJournal })}
                          disabled={bridgeEntryDisabled}
                          aria-disabled={bridgeEntryDisabled}
                          className={`relative h-7 w-14 rounded-full transition-all ${
                            bridgeEntryDisabled
                              ? 'cursor-not-allowed'
                              : formData.autoJournal ? 'bg-emerald-500' : 'bg-black'
                          }`}
                        >
                          <span
                            className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
                              formData.autoJournal ? 'right-1' : 'left-1'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                {localBrokerInfo && (
                  <section className={`rounded-3xl border p-5 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                    <h3 className="text-xs font-black uppercase tracking-[0.2em] mb-3 text-[#FF4F01]">Connected Broker Status</h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <p className="text-[10px] uppercase font-bold text-zinc-500">Account Login</p>
                        <p className="text-sm font-semibold">{localBrokerInfo.login}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-bold text-zinc-500">Server</p>
                        <p className="text-sm font-semibold">{localBrokerInfo.server}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-bold text-zinc-500">Balance</p>
                        <p className="text-sm font-semibold font-mono">
                          {localBrokerInfo.balance?.toLocaleString(undefined, { minimumFractionDigits: 2 })} {localBrokerInfo.currency}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-bold text-zinc-500">Equity</p>
                        <p className="text-sm font-semibold font-mono">
                          {localBrokerInfo.equity?.toLocaleString(undefined, { minimumFractionDigits: 2 })} {localBrokerInfo.currency}
                        </p>
                      </div>
                    </div>
                  </section>
                )}

                {onDeduplicate && (
                  <section className={`rounded-3xl border p-5 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="flex items-center gap-3">
                      <Trash2 size={18} className="text-[#FF4F01]" />
                      <div className="flex-1">
                        <p className="text-sm font-bold">Clean duplicate entries</p>
                        <p className="text-xs opacity-50">Remove duplicate manual entries that share the same date, pair, and price.</p>
                      </div>
                      <button
                        onClick={onDeduplicate}
                        className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-[0.16em] transition-all ${
                          isDarkMode
                            ? 'bg-white/[0.06] text-white hover:bg-white/[0.1]'
                            : 'bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        Run Cleanup
                      </button>
                    </div>
                  </section>
                )}
              </div>
            )}

            {effectiveTab === 'appearance' && (
              <div className="space-y-4">
                <section className={`rounded-3xl border p-4 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-[#FF4F01]/10 p-2 text-[#FF4F01]">
                        <Moon size={16} />
                      </div>
                      <div>
                        <p className="text-[13px] font-bold">Workspace Mode</p>
                        <p className="mt-0.5 text-[13px] opacity-60">
                          Obsidian mode is the default workspace look. Premium themes are available for Masters.
                        </p>
                      </div>
                    </div>
                    <div className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] opacity-60">
                      Locked
                    </div>
                  </div>
                </section>

                {formData.plan === 'PREMIUM (MASTERS)' && (
                  <section className={`rounded-3xl border p-4 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'}`}>
                    <div className="mb-3 flex items-center gap-2.5">
                      <Crown size={15} className="text-amber-500" />
                      <h3 className="text-[15px] font-black">Premium Themes</h3>
                      <span className="ml-auto rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-amber-500">
                        Masters only
                      </span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {[
                        { id: 'obsidian', label: 'Obsidian', desc: 'Deep dark panels with orange accents.' },
                        { id: 'cosmic', label: 'Cosmic', desc: 'Dark violet canvas with sharper contrast.' },
                      ].map((theme) => {
                        const selected = formData.themePreference === theme.id;
                        return (
                          <button
                            key={theme.id}
                            onClick={() => setFormData({ ...formData, themePreference: theme.id as UserProfile['themePreference'] })}
                            className={`rounded-xl border p-2.5 text-left transition-all ${
                              selected
                                ? 'border-[#FF4F01] bg-[#FF4F01]/5'
                                : isDarkMode
                                  ? 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.14]'
                                  : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                            }`}
                          >
                            <div className="mb-2.5 rounded-lg border border-white/10 bg-[#000000] p-2.5">
                              <div className="mb-1.5 h-1.5 w-1/2 rounded-full bg-[#FF4F01]/60" />
                              <div className="mb-1.5 h-1.5 w-1/3 rounded-full bg-white/10" />
                              <div className="h-1.5 w-2/3 rounded-full bg-white/10" />
                            </div>
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-[13px] font-bold">{theme.label}</p>
                                <p className="text-[11px] opacity-50">{theme.desc}</p>
                              </div>
                              {selected && <CheckCircle2 size={14} className="text-[#FF4F01]" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section className={`rounded-3xl border p-4 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="mb-3 flex items-center gap-2.5">
                    <Zap size={15} className="text-indigo-500" />
                    <h3 className="text-[15px] font-black">Performance</h3>
                  </div>
                  <div className="flex flex-col gap-3.5 md:flex-row md:items-center md:justify-between">
                    <div className="max-w-2xl">
                      <p className="text-[13px] font-bold">Keep charts alive in background</p>
                      <p className="mt-0.5 text-[13px] opacity-60">
                        Preserve chart state when moving between pages. Turn it off if the interface feels heavy.
                      </p>
                    </div>
                    <button
                      onClick={() => setFormData({ ...formData, keepChartsAlive: !formData.keepChartsAlive })}
                      className={`relative h-6 w-12 rounded-full transition-all ${
                        formData.keepChartsAlive ? 'bg-indigo-500' : 'bg-black'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                          formData.keepChartsAlive ? 'right-0.5' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </section>
              </div>
            )}

            {effectiveTab === 'billing' && (
              <div className="space-y-4">
                <section className="rounded-3xl border border-[#FF4F01]/25 bg-[#FF4F01]/6 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-2xl">
                      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#FF4F01]">Current Plan</p>
                      <h3 className="mt-1 text-xl font-black tracking-tight">{formData.plan}</h3>
                      <p className="mt-1.5 text-[13px] leading-relaxed opacity-70">
                        {formData.plan === 'FREE TIER (JOURNALER)' && 'Manual journaling for lean trade tracking.'}
                        {formData.plan === 'PRO TIER (ANALYSTS)' && 'EA sync and workflow tools for active traders.'}
                        {formData.plan === 'PREMIUM (MASTERS)' && 'Full-capacity logging and advanced workspace control.'}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className={`min-w-[88px] rounded-xl border p-2.5 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.03]' : 'border-slate-200 bg-white'}`}>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">Trades</p>
                        <p className="mt-1 text-sm font-black">{tradesThisMonth}</p>
                        <div className="mt-1.5">{renderPlanProgress(tradesThisMonth, formData.plan === 'PRO TIER (ANALYSTS)' ? 500 : 50)}</div>
                      </div>
                      <div className={`min-w-[88px] rounded-xl border p-2.5 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.03]' : 'border-slate-200 bg-white'}`}>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">Notes</p>
                        <p className="mt-1 text-sm font-black">{formData.plan === 'FREE TIER (JOURNALER)' ? totalNotes : 'Unlimited'}</p>
                        <div className="mt-1.5">{renderPlanProgress(totalNotes, 1)}</div>
                      </div>
                      <div className={`min-w-[88px] rounded-xl border p-2.5 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.03]' : 'border-slate-200 bg-white'}`}>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">Images</p>
                        <p className="mt-1 text-sm font-black">
                          {formData.plan === 'FREE TIER (JOURNALER)' ? '0' : formData.plan === 'PREMIUM (MASTERS)' ? 'Unlimited' : totalImages}
                        </p>
                        <div className="mt-1.5">{renderPlanProgress(totalImages, 1000)}</div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="grid gap-3">
                  {[
                    {
                      id: 'FREE TIER (JOURNALER)',
                      desc: 'Manual trade logging and daily bias notes.',
                      features: ['50 trades / month', '1 note', 'Manual entry'],
                    },
                    {
                      id: 'PRO TIER (ANALYSTS)',
                      desc: 'EA sync, charts, and trading workflow tools.',
                      features: ['500 trades / month', 'Desktop bridge', 'Live sync'],
                    },
                    {
                      id: 'PREMIUM (MASTERS)',
                      desc: 'Maximum limits with full workspace control.',
                      features: ['Unlimited trades', 'Unlimited notes', 'Premium themes'],
                    },
                  ].map((plan) => {
                    const active = formData.plan === plan.id;

                    return (
                      <div
                        key={plan.id}
                        className={`rounded-2xl border p-3 transition-all ${
                          active
                            ? 'border-[#FF4F01] bg-[#FF4F01]/5'
                            : isDarkMode
                              ? 'border-white/[0.08] bg-black/20'
                              : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex items-start gap-3">
                            <div className={`rounded-lg p-2 ${active ? 'bg-[#FF4F01] text-white' : isDarkMode ? 'bg-white/[0.04] text-zinc-300' : 'bg-white text-slate-600'}`}>
                              {plan.id === 'PREMIUM (MASTERS)' ? <Crown size={14} /> : <Zap size={14} />}
                            </div>
                            <div>
                              <h4 className="text-sm font-bold">{plan.id}</h4>
                              <p className="mt-0.5 text-[13px] opacity-60">{plan.desc}</p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {plan.features.map((feature) => (
                                  <span
                                    key={feature}
                                    className={`rounded-full border px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] ${
                                      isDarkMode
                                        ? 'border-white/[0.08] bg-white/[0.03] text-zinc-300'
                                        : 'border-slate-200 bg-white text-slate-600'
                                    }`}
                                  >
                                    {feature}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5">
                            <div className="text-right">
                              {plan.id === 'FREE TIER (JOURNALER)' ? (
                                <p className="text-sm font-black">$0</p>
                              ) : (
                                <p className="text-[13px] font-black text-[#FF4F01]">FREE BETA</p>
                              )}
                              <p className="text-[9px] font-bold uppercase opacity-40">per month</p>
                            </div>
                            <button
                            onClick={() => { void handlePlanSwitch(plan.id); }}
                            disabled={active}
                            className={`rounded-lg px-2.5 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] transition-all ${
                              active
                                  ? 'cursor-default bg-black text-zinc-400'
                                  : 'bg-[#FF4F01] text-white hover:scale-[1.02]'
                              }`}
                            >
                              {active ? 'Active' : 'Switch'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </section>
              </div>
            )}

            {effectiveTab === 'security' && (
              <div className="space-y-5" />
            )}

            {effectiveTab === 'developer-tools' && (
              <div className="settings-developer-tools space-y-5">
                <ApiKeysPanel isDarkMode={isDarkMode} />
              </div>
            )}

            {effectiveTab === 'help' && (
              <div className="space-y-4">
                <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {supportLinks.map((item) => {
                    const Icon = item.icon;
                    const disabled = !item.href;

                    return disabled ? (
                      <div
                        key={item.title}
                        className={`rounded-2xl border p-3 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'} opacity-60`}
                      >
                        <div className="mb-2 flex items-center gap-2.5">
                          <div className="rounded-lg bg-white/[0.04] p-2 text-zinc-400">
                            <Icon size={14} />
                          </div>
                          <div>
                            <h4 className="text-[13px] font-bold">{item.title}</h4>
                            <p className="text-[10px] uppercase tracking-[0.16em] opacity-40">Coming soon</p>
                          </div>
                        </div>
                        <p className="text-[13px] opacity-60">{item.desc}</p>
                      </div>
                    ) : (
                      <a
                        key={item.title}
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`rounded-2xl border p-3 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                          isDarkMode ? 'border-white/[0.08] bg-black/20 hover:border-white/[0.14]' : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="mb-2 flex items-center gap-2.5">
                          <div className="rounded-lg bg-[#FF4F01]/10 p-2 text-[#FF4F01]">
                            <Icon size={14} />
                          </div>
                          <div className="flex-1">
                            <h4 className="text-[13px] font-bold">{item.title}</h4>
                            <p className="text-[13px] opacity-60">{item.desc}</p>
                          </div>
                          <ExternalLink size={13} className="opacity-30" />
                        </div>
                      </a>
                    );
                  })}
                </section>

                <section className={`rounded-3xl border p-4 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-40">FAQ</p>
                      <h3 className="mt-0.5 text-[15px] font-black">Frequently asked questions</h3>
                    </div>
                    {migrationVersion && (
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">
                        Database {migrationVersion}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {faqItems.map((faq) => (
                      <FAQItem key={faq.q} question={faq.q} answer={faq.a} isDarkMode={isDarkMode} />
                    ))}
                  </div>
                </section>

                <section className={`rounded-3xl border p-4 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'}`}>
                  <div className="mb-3.5 flex items-center gap-2.5">
                    <MessageSquare size={15} className="text-[#FF4F01]" />
                    <h3 className="text-[15px] font-black">Send feedback</h3>
                  </div>

                  {feedbackSuccess ? (
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-6 text-center">
                      <div className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                        <CheckCircle2 size={22} />
                      </div>
                      <h4 className="text-lg font-black">Feedback received</h4>
                      <p className="mx-auto mt-1.5 max-w-md text-sm opacity-60">
                        Your message has been logged. Thanks for helping shape the next version of JFX-JOURNAL.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      <div className={`rounded-xl border p-3 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.03]' : 'border-slate-200 bg-slate-50'}`}>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-40">Category</p>
                            <p className="mt-0.5 text-[13px] font-bold">Choose the closest match</p>
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">Direct message</span>
                        </div>
                        <div className="grid gap-1.5 sm:grid-cols-4">
                          {['Bug Report', 'Feature Request', 'Improvement', 'Other'].map((item) => (
                            <button
                              key={item}
                              onClick={() => setFeedbackCategory(item)}
                              className={`rounded-lg border px-2 py-1.5 text-[9px] font-black uppercase tracking-[0.16em] transition-all ${
                                feedbackCategory === item
                                  ? 'border-[#FF4F01] bg-[#FF4F01] text-white'
                                  : isDarkMode
                                    ? 'border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]'
                                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(220px,0.7fr)]">
                        <div className="space-y-4">
                          <div>
                            <label htmlFor="feedback-subject" className={compactLabelClass}>
                              Subject
                            </label>
                            <input
                              id="feedback-subject"
                              value={feedbackSubject}
                              onChange={(e) => setFeedbackSubject(e.target.value)}
                              placeholder="What should we look at?"
                              className={compactInputClass}
                            />
                          </div>

                          <div>
                            <label htmlFor="feedback-message" className={compactLabelClass}>
                              Message
                            </label>
                            <textarea
                              id="feedback-message"
                              value={feedbackMessage}
                              onChange={(e) => setFeedbackMessage(e.target.value)}
                              rows={5}
                              placeholder="Share the issue, idea, or improvement."
                              className={`${compactInputClass} min-h-[120px] resize-none`}
                            />
                          </div>
                        </div>

                        <div className={`rounded-xl border p-3 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.03]' : 'border-slate-200 bg-slate-50'}`}>
                          <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-40">Send details</p>
                          <div className="mt-2.5 space-y-2 text-sm">
                            <div
                              className={`rounded-lg border px-3 py-2 ${
                                isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'
                              }`}
                            >
                              <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">Category</p>
                              <p className="mt-0.5 font-bold">{feedbackCategory}</p>
                            </div>
                            <div
                              className={`rounded-lg border px-3 py-2 ${
                                isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'
                              }`}
                            >
                              <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">Subject</p>
                              <p className="mt-0.5 font-bold">{feedbackSubject.trim() || 'No subject yet'}</p>
                            </div>
                            <div
                              className={`rounded-lg border px-3 py-2 ${
                                isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'
                              }`}
                            >
                              <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">Message</p>
                              <p className="mt-0.5 line-clamp-4 text-sm opacity-70">
                                {feedbackMessage.trim() || 'Your message preview will appear here.'}
                              </p>
                            </div>
                          </div>
                          <p className="mt-3 text-xs opacity-50">
                            Keep it short and specific. Screenshots are not required for this version.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs opacity-50">
                          {feedbackMessage.trim().length} characters
                        </p>
                        <button
                          onClick={handleFeedbackSubmit}
                          disabled={isSubmittingFeedback || !feedbackMessage.trim()}
                          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#FF4F01] px-3.5 py-2 text-[13px] font-bold text-white transition-all hover:bg-[#e64901] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSubmittingFeedback ? (
                            <>
                              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                              Sending...
                            </>
                          ) : (
                            <>
                              <Send size={14} />
                              Submit Feedback
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}

            {effectiveTab === 'security' && (
            <div className="mt-5">
              <DiagnosticsPanel
                isDarkMode={isDarkMode}
                userId={userId}
                plan={formData.plan}
                tradesThisMonth={tradesThisMonth}
                tradesCount={tradesCount}
                tradeCounts={tradeCounts}
                portfolios={portfolios}
                activePortfolioId={activePortfolioId}
                offlineQueueCount={offlineQueueCount}
              />
            </div>
            )}

            {effectiveTab !== 'security' && effectiveTab !== 'developer-tools' && (
            <div className={`mt-6 flex flex-col gap-4 border-t pt-5 md:flex-row md:items-center md:justify-between ${isDarkMode ? 'border-white/[0.08]' : 'border-slate-200'}`}>
              <div className="min-h-[24px]">
                {saveMessage && (
                  <div className="flex items-center gap-2 text-sm font-bold text-emerald-500">
                    <CheckCircle2 size={14} />
                    {saveMessage}
                  </div>
                )}
              </div>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="settings-save-btn inline-flex items-center justify-center gap-2 rounded-xl bg-[#FF4F01] px-5 py-3 text-sm font-black text-white transition-all hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? 'Saving...' : 'Save Settings'}
                <Save size={15} />
              </button>
            </div>
            )}
            </div>
          </main>
        </div>
      </div>

      <ConfirmationModal
        isOpen={showRegenSyncKeyConfirm}
        title="Regenerate sync key?"
        description="Already-paired Bridge apps must be updated with the new key (and saved) before they sync again."
        confirmText="Regenerate"
        variant="warning"
        onConfirm={handleRegenerateSyncKey}
        onCancel={() => setShowRegenSyncKeyConfirm(false)}
        isDarkMode={isDarkMode}
      />
      <ConfirmationModal
        isOpen={showDisconnectCtraderConfirm}
        title="Disconnect cTrader?"
        description="This unlinks cTrader from every portfolio and clears cached broker balances. Your journal trades stay untouched."
        confirmText={isDisconnectingCtrader ? 'Disconnecting...' : 'Disconnect'}
        variant="danger"
        onConfirm={handleDisconnectCtrader}
        onCancel={() => setShowDisconnectCtraderConfirm(false)}
        isDarkMode={isDarkMode}
      />
    </div>
  );
};

const FAQItem: React.FC<{ question: string; answer: string; isDarkMode: boolean }> = ({ question, answer, isDarkMode }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className={`overflow-hidden rounded-xl border transition-all ${
        isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'
      }`}
    >
      <button onClick={() => setIsOpen(!isOpen)} className="flex w-full items-center justify-between gap-4 px-3 py-2.5 text-left">
        <span className="text-[13px] font-bold">{question}</span>
        <ChevronDown size={14} className={`shrink-0 text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <div className={`overflow-hidden transition-all ${isOpen ? 'max-h-40' : 'max-h-0'}`}>
        <p className="px-3 pb-2.5 text-[13px] opacity-60">{answer}</p>
      </div>
    </div>
  );
};

export default Settings;
