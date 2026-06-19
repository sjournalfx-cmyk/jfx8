import React, { useEffect, useState } from 'react';
import {
  User,
  Globe,
  Shield,
  Save,
  Trash2,
  CreditCard,
  Lock,
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
} from 'lucide-react';
import { UserProfile } from '../types';
import { APP_CONSTANTS, normalizePlan } from '../lib/constants';
import { Select } from './Select';
import { normalizeThemePreference } from '../lib/theme';
import { getDefaultTimezone } from '../lib/timeUtils';

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

type SettingsTab = 'profile' | 'account' | 'appearance' | 'billing' | 'security' | 'help';

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
  migrationVersion?: string;
}

const tabs: Array<{ id: SettingsTab; label: string; icon: React.ElementType; desc: string }> = [
  { id: 'profile', label: 'Trading Persona', icon: User, desc: 'Identity and style' },
  { id: 'account', label: 'Account Config', icon: Briefcase, desc: 'Sync and balance' },
  { id: 'appearance', label: 'Appearance', icon: Palette, desc: 'Theme and motion' },
  { id: 'billing', label: 'Plan & Billing', icon: CreditCard, desc: 'Usage and plan' },
  { id: 'security', label: 'Security', icon: Shield, desc: 'Access and session' },
  { id: 'help', label: 'Help & Feedback', icon: HelpCircle, desc: 'Docs and support' },
];

const profileOptions = {
  tradingStyle: ['Scalper', 'Day Trader', 'Swing Trader', 'Investor'],
  experienceLevel: ['Beginner', 'Intermediate', 'Advanced', 'Pro'],
} as const;

const supportLinks = [
  { title: 'Documentation', icon: HelpCircle, desc: 'Setup guides, workflows, and feature notes.', href: '/DOCUMENTATION.md' },
  { title: 'Telegram Community', icon: MessageSquare, desc: 'Share feedback and get release updates.', href: 'https://t.me/+w_KvKM5HESYyMTdk' },
  { title: 'Video Tutorials', icon: Video, desc: 'Short walkthroughs for common setup tasks.', href: null },
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
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [formData, setFormData] = useState<UserProfile>({ ...userProfile, plan: normalizePlan(userProfile.plan) });
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveStatus] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState('Bug Report');
  const [feedbackSubject, setFeedbackSubject] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');

  useEffect(() => {
    setActiveTab(initialTab);
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

  const handleCopyKey = async () => {
    if (!formData.syncKey) return;
    await navigator.clipboard.writeText(formData.syncKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1800);
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
    ? 'bg-white/[0.03] border-white/[0.08] shadow-[0_20px_60px_rgba(0,0,0,0.25)]'
    : 'bg-white border-slate-200 shadow-[0_24px_80px_rgba(15,23,42,0.08)]';

  const inputClass = `w-full rounded-2xl border px-4 py-3.5 text-sm outline-none transition-all ${
    isDarkMode
      ? 'bg-white/[0.03] border-white/[0.08] text-zinc-100 placeholder:text-zinc-500 focus:border-[#FF4F01]'
      : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-[#FF4F01] focus:bg-white'
  }`;

  const labelClass = 'text-[10px] font-black uppercase tracking-[0.22em] opacity-50 block mb-2';

  const currentTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  const renderPlanProgress = (value: number, limit: number) => (
    <div className={`h-1.5 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-white/[0.08]' : 'bg-slate-200'}`}>
      <div className="h-full rounded-full bg-[#FF4F01]" style={{ width: `${Math.min(100, (value / limit) * 100)}%` }} />
    </div>
  );

  const renderAvatarGrid = (avatars: string[]) => (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
      {avatars.map((url) => (
        <button
          key={url}
          onClick={() => setFormData({ ...formData, avatarUrl: url })}
          className={`aspect-square overflow-hidden rounded-2xl border-2 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
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
      <div className="flex h-full w-full flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <header className={`rounded-[32px] border p-6 md:p-8 ${shellCard}`}>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
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

        <div className="grid flex-1 min-h-0 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className={`flex min-h-0 flex-col gap-3 rounded-[32px] border p-3 ${shellCard} lg:sticky lg:top-8`}>
            <div className="px-3 pb-2 pt-1">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] opacity-40">Sections</p>
            </div>

            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`group flex items-center gap-4 rounded-2xl px-4 py-4 text-left transition-all ${
                    active
                      ? 'bg-[#FF4F01] text-white shadow-lg shadow-[#FF4F01]/20'
                      : isDarkMode
                        ? 'text-zinc-300 hover:bg-white/[0.04]'
                        : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className={`rounded-xl p-2.5 ${active ? 'bg-white/15' : isDarkMode ? 'bg-white/[0.04]' : 'bg-slate-100'}`}>
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{tab.label}</p>
                    <p className={`text-[11px] ${active ? 'text-white/75' : 'opacity-45'}`}>{tab.desc}</p>
                  </div>
                </button>
              );
            })}

            <div className={`mt-2 rounded-2xl border p-4 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-rose-500/10 p-2 text-rose-500">
                  <LogOut size={16} />
                </div>
                <div>
                  <p className="text-sm font-bold">Sign out</p>
                  <p className="text-[11px] opacity-50">End this session on the device.</p>
                </div>
              </div>
              <button
                onClick={onLogout}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 px-4 py-3 text-sm font-bold text-white transition-all hover:bg-rose-400"
              >
                <LogOut size={16} />
                Sign Out
              </button>
            </div>
          </aside>

          <main className={`flex min-h-0 flex-col overflow-y-auto rounded-[32px] border p-6 md:p-8 ${shellCard} custom-scrollbar`}>
            <div
              className={`mb-6 flex flex-col gap-3 border-b pb-5 ${
                isDarkMode ? 'border-white/[0.06]' : 'border-slate-200'
              }`}
            >
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#FF4F01]">{currentTab.label}</p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight">{currentTab.label}</h2>
                </div>
                {activeTab === 'help' ? (
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

            {activeTab === 'profile' && (
              <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                <section className={`rounded-[28px] border p-6 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="mb-6 flex items-center gap-4">
                    <div className="h-20 w-20 overflow-hidden rounded-[24px] bg-gradient-to-br from-[#FF4F01] to-orange-500 shadow-lg shadow-[#FF4F01]/20">
                      {formData.avatarUrl ? (
                        <img src={formData.avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white">
                          <User size={32} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-40">Current Persona</p>
                      <h3 className="mt-1 truncate text-xl font-black">{formData.name}</h3>
                      <p className="mt-1 text-sm font-medium text-[#FF4F01]">{formData.plan}</p>
                    </div>
                  </div>

                  <div className="space-y-5">
                    <div>
                      <label htmlFor="settings-full-name" className={labelClass}>
                        Full Name
                      </label>
                      <input
                        id="settings-full-name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Email Address</label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                        <input value={userEmail || ''} readOnly className={`${inputClass} cursor-not-allowed pl-10 opacity-70`} />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="settings-country" className={labelClass}>
                        Country
                      </label>
                      <div className="relative">
                        <Globe className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                        <input
                          id="settings-country"
                          value={formData.country}
                          onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                          className={`${inputClass} pl-10`}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>
                        Timezone
                      </label>
                      <div className="relative">
                        <Clock className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                        <input
                          value={formData.timezone || getDefaultTimezone()}
                          readOnly
                          className={`${inputClass} cursor-not-allowed pl-10 opacity-70`}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className={labelClass}>Trading Style</label>
                        <Select
                          value={formData.tradingStyle}
                          onChange={(val) => setFormData({ ...formData, tradingStyle: val as UserProfile['tradingStyle'] })}
                          options={profileOptions.tradingStyle.map((item) => ({ value: item, label: item }))}
                          isDarkMode={isDarkMode}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Experience Level</label>
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

                <section className="space-y-6">
                  <div className={`rounded-[28px] border p-6 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'}`}>
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-40">Avatar Library</p>
                        <h3 className="mt-1 text-lg font-black">Choose Your Avatar</h3>
                      </div>
                      <div className="rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] opacity-60">
                        {formData.plan.includes('FREE') ? 'Free' : formData.plan.includes('PRO') ? 'Pro' : 'Premium'}
                      </div>
                    </div>

                    <div className="space-y-5">
                      {formData.plan === 'FREE TIER (JOURNALER)' && (
                        <div>
                          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Journaler Bots</p>
                          {renderAvatarGrid(freeAvatars)}
                        </div>
                      )}

                      {formData.plan === 'PRO TIER (ANALYSTS)' && (
                        <div>
                          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Analyst Set</p>
                          {renderAvatarGrid(proAvatars)}
                        </div>
                      )}

                      {formData.plan === 'PREMIUM (MASTERS)' && (
                        <div>
                          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Master Set</p>
                          {renderAvatarGrid(premiumAvatars)}
                        </div>
                      )}
                    </div>

                    <div className={`mt-6 flex items-center justify-between gap-4 border-t pt-5 ${isDarkMode ? 'border-white/[0.08]' : 'border-slate-200'}`}>
                      <p className="text-xs opacity-50">
                        Save persona changes before leaving this section.
                      </p>
                      <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#FF4F01] px-5 py-3 text-sm font-black text-white transition-all hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSaving ? 'Saving...' : 'Save Settings'}
                        <Save size={16} />
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'account' && (
              <div className="space-y-6">
                <section className={`rounded-[28px] border p-6 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <label htmlFor="settings-account-name" className={labelClass}>
                        Primary Account Name
                      </label>
                      <input
                        id="settings-account-name"
                        value={formData.accountName}
                        onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Base Currency</label>
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
                      <label htmlFor="settings-initial-balance" className={labelClass}>
                        Initial Balance
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono font-black text-[#FF4F01]">
                          {formData.currencySymbol}
                        </span>
                        <input
                          id="settings-initial-balance"
                          type="number"
                          value={formData.initialBalance}
                          onChange={(e) =>
                            setFormData({ ...formData, initialBalance: Number(e.target.value) || 0 })
                          }
                          className={`${inputClass} pl-10 font-mono`}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>Sync Method</label>
                      <div className={`flex h-[52px] items-center justify-between rounded-2xl border px-4 ${
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
                  <section className={`rounded-[28px] border p-6 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'}`}>
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-40">Sync Key</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <code className="rounded-2xl border px-4 py-3 font-mono text-sm font-bold tracking-wider text-[#FF4F01]">
                            {formData.syncKey || 'real-sync-key'}
                          </code>
                          <button
                            onClick={handleCopyKey}
                            className={`rounded-2xl border px-3 py-3 transition-all ${
                              copiedKey
                                ? 'border-emerald-500 bg-emerald-500 text-white'
                                : isDarkMode
                                  ? 'border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]'
                                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white'
                            }`}
                            title="Copy sync key"
                          >
                            {copiedKey ? <Check size={16} /> : <Copy size={16} />}
                          </button>
                          <button
                            onClick={() => {
                              const newKey = `JFX-${Math.floor(1000 + Math.random() * 9000)}-${Math.random()
                                .toString(36)
                                .substring(2, 6)
                                .toUpperCase()}`;
                              setFormData({ ...formData, syncKey: newKey });
                            }}
                            className={`rounded-2xl border px-3 py-3 transition-all ${
                              isDarkMode
                                ? 'border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]'
                                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white'
                            }`}
                            title="Regenerate sync key"
                          >
                            <Zap size={16} />
                          </button>
                        </div>
                      </div>

                      <div
                        className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
                          isDarkMode ? 'border-white/[0.08] bg-white/[0.03]' : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Auto-journal</p>
                          <p className="text-sm font-medium opacity-70">Automatically add closed trades.</p>
                        </div>
                        <button
                          onClick={() => setFormData({ ...formData, autoJournal: !formData.autoJournal })}
                          className={`relative h-7 w-14 rounded-full transition-all ${
                            formData.autoJournal ? 'bg-emerald-500' : 'bg-black'
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

                {onDeduplicate && (
                  <section className={`rounded-[28px] border p-6 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="flex items-center gap-3">
                      <Trash2 size={18} className="text-[#FF4F01]" />
                      <div className="flex-1">
                        <p className="text-sm font-bold">Clean duplicate entries</p>
                        <p className="text-xs opacity-50">Remove duplicate manual entries that share the same date, pair, and price.</p>
                      </div>
                      <button
                        onClick={onDeduplicate}
                        className={`rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.16em] transition-all ${
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

            {activeTab === 'appearance' && (
              <div className="space-y-6">
                <section className={`rounded-[28px] border p-6 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="rounded-2xl bg-[#FF4F01]/10 p-3 text-[#FF4F01]">
                        <Moon size={22} />
                      </div>
                      <div>
                        <p className="text-sm font-bold">Workspace Mode</p>
                        <p className="mt-1 text-sm opacity-60">
                          Obsidian mode is the default workspace look. Premium themes are available for Masters.
                        </p>
                      </div>
                    </div>
                    <div className="rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] opacity-60">
                      Locked
                    </div>
                  </div>
                </section>

                {formData.plan === 'PREMIUM (MASTERS)' && (
                  <section className={`rounded-[28px] border p-6 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'}`}>
                    <div className="mb-4 flex items-center gap-3">
                      <Crown size={18} className="text-amber-500" />
                      <h3 className="text-lg font-black">Premium Themes</h3>
                      <span className="ml-auto rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-500">
                        Masters only
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {[
                        { id: 'obsidian', label: 'Obsidian', desc: 'Deep dark panels with orange accents.' },
                        { id: 'cosmic', label: 'Cosmic', desc: 'Dark violet canvas with sharper contrast.' },
                      ].map((theme) => {
                        const selected = formData.themePreference === theme.id;
                        return (
                          <button
                            key={theme.id}
                            onClick={() => setFormData({ ...formData, themePreference: theme.id as UserProfile['themePreference'] })}
                            className={`rounded-[24px] border p-4 text-left transition-all ${
                              selected
                                ? 'border-[#FF4F01] bg-[#FF4F01]/5'
                                : isDarkMode
                                  ? 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.14]'
                                  : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                            }`}
                          >
                            <div className="mb-4 rounded-2xl border border-white/10 bg-[#000000] p-4">
                              <div className="mb-2 h-2 w-1/2 rounded-full bg-[#FF4F01]/60" />
                              <div className="mb-2 h-2 w-1/3 rounded-full bg-white/10" />
                              <div className="h-2 w-2/3 rounded-full bg-white/10" />
                            </div>
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-bold">{theme.label}</p>
                                <p className="text-xs opacity-50">{theme.desc}</p>
                              </div>
                              {selected && <CheckCircle2 size={16} className="text-[#FF4F01]" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section className={`rounded-[28px] border p-6 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="mb-4 flex items-center gap-3">
                    <Zap size={18} className="text-indigo-500" />
                    <h3 className="text-lg font-black">Performance</h3>
                  </div>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="max-w-2xl">
                      <p className="text-sm font-bold">Keep charts alive in background</p>
                      <p className="mt-1 text-sm opacity-60">
                        Preserve chart state when moving between pages. Turn it off if the interface feels heavy.
                      </p>
                    </div>
                    <button
                      onClick={() => setFormData({ ...formData, keepChartsAlive: !formData.keepChartsAlive })}
                      className={`relative h-7 w-14 rounded-full transition-all ${
                        formData.keepChartsAlive ? 'bg-indigo-500' : 'bg-black'
                      }`}
                    >
                      <span
                        className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
                          formData.keepChartsAlive ? 'right-1' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'billing' && (
              <div className="space-y-6">
                <section className="rounded-[32px] border border-[#FF4F01]/25 bg-[#FF4F01]/6 p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-2xl">
                      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#FF4F01]">Current Plan</p>
                      <h3 className="mt-2 text-3xl font-black tracking-tight">{formData.plan}</h3>
                      <p className="mt-3 text-sm leading-relaxed opacity-70">
                        {formData.plan === 'FREE TIER (JOURNALER)' && 'Manual journaling for lean trade tracking.'}
                        {formData.plan === 'PRO TIER (ANALYSTS)' && 'EA sync and workflow tools for active traders.'}
                        {formData.plan === 'PREMIUM (MASTERS)' && 'Full-capacity logging and advanced workspace control.'}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className={`min-w-[110px] rounded-2xl border p-4 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.03]' : 'border-slate-200 bg-white'}`}>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">Trades</p>
                        <p className="mt-2 text-lg font-black">{tradesThisMonth}</p>
                        <div className="mt-3">{renderPlanProgress(tradesThisMonth, formData.plan === 'PRO TIER (ANALYSTS)' ? 500 : 50)}</div>
                      </div>
                      <div className={`min-w-[110px] rounded-2xl border p-4 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.03]' : 'border-slate-200 bg-white'}`}>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">Notes</p>
                        <p className="mt-2 text-lg font-black">{formData.plan === 'FREE TIER (JOURNALER)' ? totalNotes : 'Unlimited'}</p>
                        <div className="mt-3">{renderPlanProgress(totalNotes, 1)}</div>
                      </div>
                      <div className={`min-w-[110px] rounded-2xl border p-4 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.03]' : 'border-slate-200 bg-white'}`}>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">Images</p>
                        <p className="mt-2 text-lg font-black">
                          {formData.plan === 'FREE TIER (JOURNALER)' ? '0' : formData.plan === 'PREMIUM (MASTERS)' ? 'Unlimited' : totalImages}
                        </p>
                        <div className="mt-3">{renderPlanProgress(totalImages, 1000)}</div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="grid gap-4">
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
                        className={`rounded-[28px] border p-5 transition-all ${
                          active
                            ? 'border-[#FF4F01] bg-[#FF4F01]/5'
                            : isDarkMode
                              ? 'border-white/[0.08] bg-black/20'
                              : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex items-start gap-4">
                            <div className={`rounded-2xl p-3 ${active ? 'bg-[#FF4F01] text-white' : isDarkMode ? 'bg-white/[0.04] text-zinc-300' : 'bg-white text-slate-600'}`}>
                              {plan.id === 'PREMIUM (MASTERS)' ? <Crown size={18} /> : <Zap size={18} />}
                            </div>
                            <div>
                              <h4 className="font-bold">{plan.id}</h4>
                              <p className="mt-1 text-sm opacity-60">{plan.desc}</p>
                              <div className="mt-4 flex flex-wrap gap-2">
                                {plan.features.map((feature) => (
                                  <span
                                    key={feature}
                                    className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
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

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              {plan.id === 'FREE TIER (JOURNALER)' ? (
                                <p className="text-lg font-black">$0</p>
                              ) : (
                                <p className="text-sm font-black text-[#FF4F01]">FREE BETA</p>
                              )}
                              <p className="text-[10px] font-bold uppercase opacity-40">per month</p>
                            </div>
                            <button
                            onClick={() => { void handlePlanSwitch(plan.id); }}
                            disabled={active}
                            className={`rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.16em] transition-all ${
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

            {activeTab === 'security' && (
              <div className="space-y-6">
                <section className={`rounded-[28px] border p-6 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-500">
                        <Lock size={20} />
                      </div>
                      <div>
                        <p className="text-sm font-bold">Two-factor authentication</p>
                        <p className="mt-1 text-sm opacity-60">Account-level protection is handled through your login provider.</p>
                      </div>
                    </div>
                    <div className="rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] opacity-60">
                      Enabled
                    </div>
                  </div>
                </section>

                <section className={`rounded-2xl border p-4 ${isDarkMode ? 'border-white/[0.08] bg-black' : 'border-slate-200 bg-white'}`}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-bold">Session control</p>
                      <p className="mt-1 text-sm opacity-60">Use sign out to end this device session immediately.</p>
                    </div>
                    <button
                      onClick={onLogout}
                      className="rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-rose-400"
                    >
                      Sign Out Now
                    </button>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'help' && (
              <div className="space-y-6">
                <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {supportLinks.map((item) => {
                    const Icon = item.icon;
                    const disabled = !item.href;

                    return disabled ? (
                      <div
                        key={item.title}
                        className={`rounded-[28px] border p-5 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'} opacity-60`}
                      >
                        <div className="mb-3 flex items-center gap-3">
                          <div className="rounded-2xl bg-white/[0.04] p-3 text-zinc-400">
                            <Icon size={16} />
                          </div>
                          <div>
                            <h4 className="font-bold">{item.title}</h4>
                            <p className="text-[11px] uppercase tracking-[0.16em] opacity-40">Coming soon</p>
                          </div>
                        </div>
                        <p className="text-sm opacity-60">{item.desc}</p>
                      </div>
                    ) : (
                      <a
                        key={item.title}
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`rounded-[28px] border p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                          isDarkMode ? 'border-white/[0.08] bg-black/20 hover:border-white/[0.14]' : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="mb-3 flex items-center gap-3">
                          <div className="rounded-2xl bg-[#FF4F01]/10 p-3 text-[#FF4F01]">
                            <Icon size={16} />
                          </div>
                          <div className="flex-1">
                            <h4 className="font-bold">{item.title}</h4>
                            <p className="text-sm opacity-60">{item.desc}</p>
                          </div>
                          <ExternalLink size={14} className="opacity-30" />
                        </div>
                      </a>
                    );
                  })}
                </section>

                <section className={`rounded-[28px] border p-6 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-40">FAQ</p>
                      <h3 className="mt-1 text-lg font-black">Frequently asked questions</h3>
                    </div>
                    {migrationVersion && (
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">
                        Database {migrationVersion}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    {faqItems.map((faq) => (
                      <FAQItem key={faq.q} question={faq.q} answer={faq.a} isDarkMode={isDarkMode} />
                    ))}
                  </div>
                </section>

                <section className={`rounded-[28px] border p-6 ${isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'}`}>
                  <div className="mb-5 flex items-center gap-3">
                    <MessageSquare size={18} className="text-[#FF4F01]" />
                    <h3 className="text-lg font-black">Send feedback</h3>
                  </div>

                  {feedbackSuccess ? (
                    <div className="rounded-[24px] border border-emerald-500/20 bg-emerald-500/5 px-6 py-10 text-center">
                      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                        <CheckCircle2 size={28} />
                      </div>
                      <h4 className="text-xl font-black">Feedback received</h4>
                      <p className="mx-auto mt-2 max-w-md text-sm opacity-60">
                        Your message has been logged. Thanks for helping shape the next version of JournalFX.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-5">
                      <div className={`rounded-2xl border p-4 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.03]' : 'border-slate-200 bg-slate-50'}`}>
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-40">Category</p>
                            <p className="mt-1 text-sm font-bold">Choose the closest match</p>
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">Direct message</span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-4">
                          {['Bug Report', 'Feature Request', 'Improvement', 'Other'].map((item) => (
                            <button
                              key={item}
                              onClick={() => setFeedbackCategory(item)}
                              className={`rounded-2xl border px-3 py-3 text-[10px] font-black uppercase tracking-[0.16em] transition-all ${
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

                      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(240px,0.7fr)]">
                        <div className="space-y-5">
                          <div>
                            <label htmlFor="feedback-subject" className={labelClass}>
                              Subject
                            </label>
                            <input
                              id="feedback-subject"
                              value={feedbackSubject}
                              onChange={(e) => setFeedbackSubject(e.target.value)}
                              placeholder="What should we look at?"
                              className={inputClass}
                            />
                          </div>

                          <div>
                            <label htmlFor="feedback-message" className={labelClass}>
                              Message
                            </label>
                            <textarea
                              id="feedback-message"
                              value={feedbackMessage}
                              onChange={(e) => setFeedbackMessage(e.target.value)}
                              rows={7}
                              placeholder="Share the issue, idea, or improvement."
                              className={`${inputClass} min-h-[220px] resize-none`}
                            />
                          </div>
                        </div>

                        <div className={`rounded-[24px] border p-5 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.03]' : 'border-slate-200 bg-slate-50'}`}>
                          <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-40">Send details</p>
                          <div className="mt-4 space-y-3 text-sm">
                            <div
                              className={`rounded-2xl border px-4 py-3 ${
                                isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'
                              }`}
                            >
                              <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">Category</p>
                              <p className="mt-1 font-bold">{feedbackCategory}</p>
                            </div>
                            <div
                              className={`rounded-2xl border px-4 py-3 ${
                                isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'
                              }`}
                            >
                              <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">Subject</p>
                              <p className="mt-1 font-bold">{feedbackSubject.trim() || 'No subject yet'}</p>
                            </div>
                            <div
                              className={`rounded-2xl border px-4 py-3 ${
                                isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'
                              }`}
                            >
                              <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-40">Message</p>
                              <p className="mt-1 line-clamp-4 text-sm opacity-70">
                                {feedbackMessage.trim() || 'Your message preview will appear here.'}
                              </p>
                            </div>
                          </div>
                          <p className="mt-4 text-xs opacity-50">
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
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#FF4F01] px-5 py-3 text-sm font-bold text-white transition-all hover:bg-[#e64901] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSubmittingFeedback ? (
                            <>
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                              Sending...
                            </>
                          ) : (
                            <>
                              <Send size={16} />
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

            <div className={`mt-8 flex flex-col gap-4 border-t pt-6 md:flex-row md:items-center md:justify-between ${isDarkMode ? 'border-white/[0.08]' : 'border-slate-200'}`}>
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
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#FF4F01] px-6 py-3.5 text-sm font-black text-white transition-all hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? 'Saving...' : 'Save Settings'}
                <Save size={16} />
              </button>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

const FAQItem: React.FC<{ question: string; answer: string; isDarkMode: boolean }> = ({ question, answer, isDarkMode }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className={`overflow-hidden rounded-2xl border transition-all ${
        isDarkMode ? 'border-white/[0.08] bg-black/20' : 'border-slate-200 bg-white'
      }`}
    >
      <button onClick={() => setIsOpen(!isOpen)} className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left">
        <span className="text-sm font-bold">{question}</span>
        <ChevronDown size={16} className={`shrink-0 text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <div className={`overflow-hidden transition-all ${isOpen ? 'max-h-40' : 'max-h-0'}`}>
        <p className="px-4 pb-4 text-sm opacity-60">{answer}</p>
      </div>
    </div>
  );
};

export default Settings;
