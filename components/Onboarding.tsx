
import React, { useState, useRef, useEffect } from 'react';
import { User, DollarSign, Zap, ChevronRight, CheckCircle2, ArrowRight, ArrowLeft, Terminal, Shield, Flame, Check, Wallet, Lock, Camera, Newspaper, LineChart, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { UserProfile } from '../types';
import { dataService } from '../services/dataService';

interface OnboardingProps {
  isDarkMode: boolean;
  onComplete: (profile: UserProfile) => void;
  onExploreDemo: () => void;
}

const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
];

// Strategy Selector Matrix — pick an analytical engine and instantly know
// which metrics must be logged for every single trade.
type StrategyProfileId = 'Fundamental' | 'Technical' | 'Blended';

const STRATEGY_PROFILES: { id: StrategyProfileId; tagline: string; requires: string[]; icon: LucideIcon }[] = [
  {
    id: 'Fundamental',
    tagline: 'Trade the "why" — central banks & data',
    requires: [
      'Central bank bias per trade (Hawkish vs Dovish)',
      'Unexpected report overrides (#NFP, #CPI, #FOMC)',
      'Event tag on every entry',
    ],
    icon: Newspaper,
  },
  {
    id: 'Technical',
    tagline: 'Trade the "when" — structure & patterns',
    requires: [
      'Exact chart pattern per trade',
      'Rigid Risk-to-Reward (planned vs actual)',
      'Multi-timeframe structural alignment',
      'Before / After screenshots',
    ],
    icon: LineChart,
  },
  {
    id: 'Blended',
    tagline: 'Macro reason + technical trigger',
    requires: [
      'Macro reason — the "Why" (bias aligned?)',
      'Pattern trigger — the "When" (valid setup?)',
      'Trade valid only if BOTH pass',
    ],
    icon: Layers,
  },
];

// Mirror the selection locally so it survives reloads even before the
// profiles table gains a strategy_profile column.
const persistStrategyProfile = (id: StrategyProfileId) => {
  try { localStorage.setItem('jfx_strategy_profile', id); } catch { /* blocked */ }
};

const readPersistedStrategyProfile = (): StrategyProfileId | null => {
  try {
    const raw = localStorage.getItem('jfx_strategy_profile');
    return raw === 'Fundamental' || raw === 'Technical' || raw === 'Blended' ? raw : null;
  } catch { return null; }
};

// Journaler Bots (Free Tier)
const freeAvatars = [
  'https://api.dicebear.com/7.x/bottts/svg?seed=1&backgroundColor=f1f5f9',
  'https://api.dicebear.com/7.x/bottts/svg?seed=2&backgroundColor=f1f5f9',
  'https://api.dicebear.com/7.x/bottts/svg?seed=3&backgroundColor=f1f5f9',
  'https://api.dicebear.com/7.x/bottts/svg?seed=4&backgroundColor=f1f5f9',
  'https://api.dicebear.com/7.x/bottts/svg?seed=5&backgroundColor=f1f5f9',
  'https://api.dicebear.com/7.x/bottts/svg?seed=6&backgroundColor=f1f5f9',
];

// AI Analysts (Pro Tier)
const proAvatars = [
  'https://api.dicebear.com/8.x/bottts-neutral/svg?seed=1&backgroundColor=e9d5ff&primaryColor=a855f7,c026d3,d8b4fe&backgroundType=gradientLinear',
  'https://api.dicebear.com/8.x/bottts-neutral/svg?seed=2&backgroundColor=e9d5ff&primaryColor=a855f7,c026d3,d8b4fe&backgroundType=gradientLinear',
  'https://api.dicebear.com/8.x/thumbs/svg?seed=1&backgroundColor=e9d5ff,d8b4fe,c084fc&backgroundType=gradientLinear',
  'https://api.dicebear.com/8.x/identicon/svg?seed=1&backgroundColor=fefce8,fef9c3,fef08a&backgroundType=gradientLinear',
  'https://api.dicebear.com/8.x/identicon/svg?seed=2&backgroundColor=fefce8,fef9c3,fef08a&backgroundType=gradientLinear',
  'https://api.dicebear.com/8.x/identicon/svg?seed=3&backgroundColor=fefce8,fef9c3,fef08a&backgroundType=gradientLinear',
];

// Elite AI Masters (Premium Tier)
const premiumAvatars = [
  'https://api.dicebear.com/7.x/lorelei/svg?seed=1&backgroundColor=c7d2fe',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=2&backgroundColor=c7d2fe',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=3&backgroundColor=c7d2fe',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=1&backgroundColor=c7d2fe',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=2&backgroundColor=c7d2fe',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=3&backgroundColor=c7d2fe',
];

const Onboarding: React.FC<OnboardingProps> = ({ isDarkMode, onComplete, onExploreDemo }) => {
  const [step, setStep] = useState(1);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<UserProfile>>({
    name: '',
    country: '',
    accountName: 'Primary Trading Account',
    initialBalance: 10000,
    currency: 'USD',
    currencySymbol: '$',
    syncMethod: 'Manual',
    experienceLevel: 'Beginner',
    tradingStyle: 'Day Trader',
    strategyProfile: readPersistedStrategyProfile() ?? 'Technical',
    onboarded: true,
    plan: 'FREE TIER (JOURNALER)',
    themePreference: 'obsidian',
    avatarUrl: freeAvatars[0],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(false);

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      if (scrollTop + clientHeight >= scrollHeight - 20) {
        setIsAtBottom(true);
      }
    }
  };

  const isFreePlan = selectedPlan === 'FREE TIER (JOURNALER)';

  const nextStep = () => {
    if (step === 4 && isFreePlan) {
      setFormData(prev => ({ ...prev, syncMethod: 'Manual', plan: 'FREE TIER (JOURNALER)' }));
      setStep(5);
    } else if (step === 4) {
      setStep(6);
    } else {
      setStep(s => Math.min(s + 1, 6));
    }
  };

  const prevStep = () => {
    if (step === 5 && isFreePlan) {
      setStep(4);
    } else if (step === 6 && !isFreePlan) {
      setStep(4);
    } else {
      setStep(s => Math.max(s - 1, 1));
    }
  };

  const handleSelectPlan = (planName: string) => {
    setSelectedPlan(planName);
    const defaultAvatar = planName === 'FREE TIER (JOURNALER)' ? freeAvatars[0] : 
                         planName === 'PRO TIER (ANALYSTS)' ? proAvatars[0] : premiumAvatars[0];
    
    setFormData(prev => ({ ...prev, plan: planName, avatarUrl: defaultAvatar }));
    
    if (planName === 'FREE TIER (JOURNALER)') {
      setFormData(prev => ({ ...prev, syncMethod: 'Manual', plan: 'FREE TIER (JOURNALER)', avatarUrl: freeAvatars[0] }));
      setStep(5); // Jump to Account Config
    } else {
      setFormData(prev => ({
        ...prev,
        syncMethod: planName === 'PRO TIER (ANALYSTS)' ? 'EA_CONNECT' : 'BROKER_SYNC',
      }));
      setStep(6); // Paid tiers use their plan's default sync method
    }
  };

  const handleFinish = () => {
    if (formData.name && formData.country && formData.accountName) {
      onComplete(formData as UserProfile);
    }
  };

  const containerBg = isDarkMode ? 'bg-[#0a0a0a]' : 'bg-[#fcfcfc]';
  const textColor = isDarkMode ? 'text-white' : 'text-[#1a1a1a]';
  const subTextColor = isDarkMode ? 'text-zinc-500' : 'text-[#666666]';

  // Total steps for UI display
  const totalStepsUI = 6;

  const stepsLeft = Math.max(0, totalStepsUI - step);
  const stepsLeftLabel = stepsLeft === 0
    ? 'Final step'
    : `${stepsLeft} quick step${stepsLeft === 1 ? '' : 's'} left`;

  const currentAvatars = formData.plan === 'FREE TIER (JOURNALER)' ? freeAvatars : 
                        formData.plan === 'PRO TIER (ANALYSTS)' ? proAvatars : premiumAvatars;

  const activeStrategy: StrategyProfileId =
    formData.strategyProfile === 'Fundamental' || formData.strategyProfile === 'Blended' ? formData.strategyProfile : 'Technical';

  const selectStrategyProfile = (id: StrategyProfileId) => {
    persistStrategyProfile(id);
    setFormData(prev => ({ ...prev, strategyProfile: id }));
  };

  return (
    <div className={`fixed inset-0 z-[200] flex flex-col items-center justify-start overflow-y-auto ${containerBg} ${textColor} font-sans`}>
      <div className="w-full max-w-6xl px-6 py-12 lg:py-20 flex flex-col min-h-full">

        {/* Header Navigation */}
        <div className="flex items-center justify-between mb-12">
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5 items-center">
              {[1, 2, 3, 4, 5, 6].map((s) => (
                <div
                  key={s}
                  className={`h-2.5 rounded-full transition-all duration-300 ${s === step ? 'w-8 bg-[#FF4F01]' : s < step ? 'w-2.5 bg-[#FF4F01]/40' : 'w-2.5 bg-zinc-200 dark:bg-black'
                    }`}
                />
              ))}
            </div>
            <p className="text-[11px] font-bold uppercase tracking-widest opacity-50">{stepsLeftLabel}</p>
          </div>
          <div className="flex items-center gap-4">
            {step === 6 && (
              <div className="flex gap-2">
                <span className="border border-[#FF4F01] text-[10px] font-bold px-2 py-1 rounded text-[#FF4F01] uppercase tracking-widest animate-pulse">Final Step</span>
              </div>
            )}
            <div className="bg-zinc-100 dark:bg-black px-3 py-1.5 rounded-md text-[11px] font-bold text-zinc-500 uppercase tracking-widest border border-zinc-200 dark:border-zinc-800">
              Step {step} of {totalStepsUI}
            </div>
          </div>
        </div>

        {/* Dynamic Step Content */}
        <div className="flex-1 flex flex-col">
          {step === 1 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl">
              <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">Welcome to JFX-JOURNAL</h1>
              <p className={`text-lg mb-12 ${subTextColor}`}>Let's start with your identity and country to tailor the regional experience.</p>

              <div className="space-y-8">
                <div className="group">
                  <label className="text-[11px] font-black uppercase tracking-[0.2em] mb-3 block opacity-60">Full Name</label>
                  <input
                    autoFocus
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Satoshi Nakamoto"
                    className={`w-full bg-transparent border-b-2 py-4 text-2xl font-bold outline-none transition-all ${isDarkMode ? 'border-zinc-800 focus:border-[#FF4F01]' : 'border-zinc-200 focus:border-[#FF4F01]'}`}
                  />
                </div>
                <div className="group">
                  <label className="text-[11px] font-black uppercase tracking-[0.2em] mb-3 block opacity-60">Country</label>
                  <input
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    placeholder="e.g. United Kingdom"
                    className={`w-full bg-transparent border-b-2 py-4 text-2xl font-bold outline-none transition-all ${isDarkMode ? 'border-zinc-800 focus:border-[#FF4F01]' : 'border-zinc-200 focus:border-[#FF4F01]'}`}
                  />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl">
              <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">Trading Persona</h1>
              <p className={`text-lg mb-12 ${subTextColor}`}>Help us understand your trading background and style.</p>

              <div className="space-y-12">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-[0.2em] mb-6 block opacity-60">Experience Level</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {['Beginner', 'Intermediate', 'Advanced', 'Pro'].map((lvl) => (
                      <button
                        key={lvl}
                        onClick={() => setFormData({ ...formData, experienceLevel: lvl as any })}
                        className={`p-6 rounded-xl border-2 text-left transition-all relative ${formData.experienceLevel === lvl
                            ? 'border-[#FF4F01] bg-[#FF4F01]/5'
                            : isDarkMode ? 'border-zinc-800 bg-[#111]' : 'border-zinc-100 bg-white shadow-sm'
                          }`}
                      >
                        <div className="font-bold text-sm mb-1">{lvl}</div>
                        {formData.experienceLevel === lvl && <div className="absolute top-3 right-3 text-[#FF4F01]"><Check size={14} /></div>}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-black uppercase tracking-[0.2em] mb-6 block opacity-60">Select your strategy profile</label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {STRATEGY_PROFILES.map((profile) => {
                      const Icon = profile.icon;
                      const isActive = activeStrategy === profile.id;
                      return (
                        <button
                          key={profile.id}
                          onClick={() => selectStrategyProfile(profile.id)}
                          className={`p-6 rounded-xl border-2 text-left transition-all relative ${isActive
                              ? 'border-[#FF4F01] bg-[#FF4F01]/5'
                              : isDarkMode ? 'border-zinc-800 bg-[#111]' : 'border-zinc-100 bg-white shadow-sm'
                            }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Icon size={16} className={isActive ? 'text-[#FF4F01]' : 'opacity-50'} />
                            <div className="font-bold text-sm">{profile.id}</div>
                          </div>
                          <div className={`text-xs mb-4 ${subTextColor}`}>{profile.tagline}</div>
                          <ul className="space-y-2">
                            {profile.requires.map((req) => (
                              <li key={req} className="flex items-start gap-2 text-xs opacity-80">
                                <Check size={12} className="text-[#FF4F01] shrink-0 mt-0.5" />
                                <span className="leading-snug">{req}</span>
                              </li>
                            ))}
                          </ul>
                          {isActive && <div className="absolute top-3 right-3 text-[#FF4F01]"><Check size={14} /></div>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-black uppercase tracking-[0.2em] mb-6 block opacity-60">Trading Style</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {['Scalper', 'Day Trader', 'Swing Trader', 'Investor'].map((style) => (
                      <button
                        key={style}
                        onClick={() => setFormData({ ...formData, tradingStyle: style as any })}
                        className={`p-6 rounded-xl border-2 text-left transition-all relative ${formData.tradingStyle === style
                            ? 'border-[#FF4F01] bg-[#FF4F01]/5'
                            : isDarkMode ? 'border-zinc-800 bg-[#111]' : 'border-zinc-100 bg-white shadow-sm'
                          }`}
                      >
                        <div className="font-bold text-sm mb-1">{style}</div>
                        {formData.tradingStyle === style && <div className="absolute top-3 right-3 text-[#FF4F01]"><Check size={14} /></div>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl">
              <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">Terms of Service & Privacy Policy</h1>
              <p className={`text-lg mb-8 ${subTextColor}`}>Please review and accept our terms and privacy policy to continue.</p>

              <div className="space-y-4">
                <div className={`p-8 rounded-xl border h-80 overflow-y-auto custom-scrollbar leading-relaxed text-sm ${isDarkMode ? 'bg-[#111] border-zinc-800 text-zinc-400' : 'bg-white border-zinc-200 text-zinc-600'}`} ref={scrollRef} onScroll={handleScroll}>
                  <h3 className="font-bold text-zinc-800 dark:text-zinc-200 mb-4 uppercase text-xs tracking-widest">Terms of Use / Service Agreement</h3>
                  <p className="mb-4">Date of last revision: October 24, 2024</p>
                  <p className="mb-6">This agreement is between JFX-JOURNAL Technologies ("the Company") and the user. By using this software, you acknowledge that trading foreign exchange on margin carries a high level of risk and may not be suitable for all investors.</p>
                  <p className="mb-4 font-bold uppercase text-zinc-800 dark:text-zinc-200">1. RISK DISCLOSURE</p>
                  <p className="mb-6">The high degree of leverage can work against you as well as for you. Before deciding to invest in foreign exchange you should carefully consider your investment objectives, level of experience, and risk appetite.</p>
                  <div className="h-20" />
                </div>

                <div className="space-y-4 pt-2">
                  <div className="flex items-center justify-between py-4 border-b border-zinc-200 dark:border-zinc-800">
                    <span className="text-sm font-bold opacity-80">I agree to JFX-JOURNAL's <span className="underline cursor-pointer">Terms of Service</span> and <span className="underline cursor-pointer">Privacy Policy</span>.</span>
                    <div className="flex items-center gap-4">
                      {!isAtBottom && <span className="text-[10px] font-black uppercase tracking-widest opacity-40 mr-2">Scroll to bottom</span>}
                      <button
                        onClick={() => setAgreedToTerms(!agreedToTerms)}
                        className={`w-12 h-6 rounded-full relative transition-all ${agreedToTerms ? 'bg-[#FF4F01]' : 'bg-zinc-200 dark:bg-black'}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 bg-white transition-all shadow-sm ${agreedToTerms ? 'left-7' : 'left-1'}`} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 w-full">
              <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">Choose your plan</h1>
              <p className={`text-lg mb-12 ${subTextColor}`}>Select a plan to access professional metrics. You can always change later.</p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  { 
                    name: 'FREE TIER (JOURNALER)', 
                    focus: 'Lightweight journaling for beginners.',
                    features: [
                      'Manual Trade Logging',
                      'Basic Journal & Daily Bias',
                      'Essential Analytics',
                      'Notebook (Max 1 note)',
                      'No image uploads'
                    ],
                    price: '0', 
                    limit: '50 trades / mo', 
                    highlight: false, 
                    tag: 'Starter' 
                  },
                  { 
                    name: 'PRO TIER (ANALYSTS)', 
                    focus: 'Data-driven automated trading.',
                    features: [
                      'Everything in FREE',
                      'Automated Trade Import',
                      'Advanced Analytics',
                      '1 Custom Chart Layout',
                      'Strategy Mapper',
                      'Goals & Calculators',
                      'Attach up to 1000 images'
                    ],
                    price: '0', 
                    limit: '500 trades / mo', 
                    highlight: false, 
                    tag: 'Free for Beta' 
                  },
                  { 
                    name: 'PREMIUM (MASTERS)', 
                    focus: 'Professional-grade trading journal.',
                    features: [
                      'Everything in PRO',
                      'Unlimited Monthly Trades',
                      'High-Capacity Image Storage',
                      'Multiple Chart Layouts',
                      'Priority Infrastructure',
                      'Professional Playbooks',
                      'Unlimited Notebooks'
                    ],
                    price: '0', 
                    limit: 'Unlimited trades', 
                    highlight: true, 
                    tag: 'Beta: Free Access' 
                  }
                ].map((plan, idx) => (
                  <div key={idx} className={`p-8 rounded-2xl border-2 flex flex-col h-full relative ${plan.highlight ? 'border-[#FF4F01]' : isDarkMode ? 'bg-[#111] border-zinc-800' : 'bg-white border-zinc-100 shadow-sm'}`}>
                    {plan.highlight && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#FF4F01] text-white text-[10px] font-black uppercase px-3 py-1 rounded-full tracking-widest">{plan.tag}</div>}
                    
                    <h3 className="font-bold text-xl mb-1">{plan.name}</h3>
                    <p className="text-[10px] font-bold text-[#FF4F01] uppercase tracking-wider mb-6 opacity-80">{plan.focus}</p>
                    
                    <ul className="space-y-3 mb-8 flex-1">
                      {plan.features.map((feat, fidx) => (
                        <li key={fidx} className="flex items-start gap-2.5 text-[13px] opacity-70">
                          <Check size={14} className="text-[#FF4F01] shrink-0 mt-0.5" />
                          <span className="leading-tight">{feat}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="flex items-center gap-2 mb-8 text-zinc-500">
                      <Flame size={18} className={plan.highlight ? 'text-[#FF4F01]' : ''} />
                      <span className="text-xs font-bold uppercase tracking-widest">{plan.limit}</span>
                    </div>

                    <div className="mt-auto">
                      <div className="mb-6">
                        {plan.price === '0' && idx !== 0 ? (
                          <div className="flex flex-col">
                            <span className="text-3xl font-black text-[#FF4F01]">FREE TO USE</span>
                            <span className="text-[10px] font-bold opacity-50 uppercase tracking-widest">FOR BETA TESTING</span>
                          </div>
                        ) : (
                          <><span className="text-5xl font-black">{formData.currencySymbol}{plan.price}</span> <span className="text-xs opacity-50 uppercase font-bold tracking-widest">{idx === 0 ? 'one-time' : '/monthly'}</span></>
                        )}
                      </div>
                      <button onClick={() => handleSelectPlan(plan.name)} className={`w-full py-4 rounded-xl font-bold text-sm transition-all ${plan.highlight ? 'bg-[#FF4F01] text-white hover:bg-[#e64601] shadow-lg shadow-[#FF4F01]/20' : 'bg-zinc-100 dark:bg-black text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-black'}`}>
                        {idx === 0 ? 'Get started' : 'Join Beta'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 5 && formData.plan !== 'PREMIUM (MASTERS)' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl">
              <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">Account Configuration</h1>
              <p className={`text-lg mb-12 ${subTextColor}`}>Define your primary trading account details and base currency.</p>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-10">
                <div className="space-y-8">
                  <div className="group">
                    <label className="text-[11px] font-black uppercase tracking-[0.2em] mb-3 block opacity-60">Account Name</label>
                    <div className="relative">
                      <Wallet className="absolute left-0 top-1/2 -translate-y-1/2 text-[#FF4F01]" size={20} />
                      <input
                        value={formData.accountName}
                        onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
                        placeholder="e.g. IC Markets Live"
                        className={`w-full bg-transparent border-b-2 pl-8 py-4 text-xl font-bold outline-none transition-all ${isDarkMode ? 'border-zinc-800 focus:border-[#FF4F01]' : 'border-zinc-200 focus:border-[#FF4F01]'}`}
                      />
                    </div>
                  </div>
                  <div className="group">
                    <label className="text-[11px] font-black uppercase tracking-[0.2em] mb-3 block opacity-60">Initial Balance</label>
                    <div className="relative">
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[#FF4F01] font-bold text-xl">{formData.currencySymbol}</span>
                      <input
                        type="number"
                        value={formData.initialBalance}
                        onChange={(e) => setFormData({ ...formData, initialBalance: parseFloat(e.target.value) })}
                        className={`w-full bg-transparent border-b-2 pl-8 py-4 text-xl font-mono font-bold outline-none transition-all ${isDarkMode ? 'border-zinc-800 focus:border-[#FF4F01]' : 'border-zinc-200 focus:border-[#FF4F01]'}`}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-black uppercase tracking-[0.2em] mb-6 block opacity-60 ml-1">Base Currency</label>
                  <div className="grid grid-cols-2 gap-4">
                    {CURRENCIES.map((c) => (
                      <button
                        key={c.code}
                        onClick={() => setFormData({ ...formData, currency: c.code, currencySymbol: c.symbol })}
                        className={`p-6 rounded-xl border-2 text-left transition-all relative group ${formData.currency === c.code
                            ? 'border-[#FF4F01] bg-[#FF4F01]/5'
                            : isDarkMode ? 'border-zinc-800 bg-[#111]' : 'border-zinc-100 bg-white shadow-sm'
                          }`}
                      >
                        <div className="font-black text-lg mb-1">{c.code}</div>
                        <div className="text-[10px] opacity-40 uppercase font-black tracking-widest">{c.name}</div>
                        {formData.currency === c.code && <div className="absolute top-4 right-4 text-[#FF4F01]"><CheckCircle2 size={20} /></div>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl">
              <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">Choose Your Avatar</h1>
              <p className={`text-lg mb-8 ${subTextColor}`}>Select a persona that represents your trading style.</p>

              <div className="flex items-center gap-2 mb-6">
                <h4 className="text-xs font-bold uppercase tracking-widest opacity-60">
                  {formData.plan === 'FREE TIER (JOURNALER)' ? 'Free Tier (Journaler Bots)' : 
                   formData.plan === 'PRO TIER (ANALYSTS)' ? 'Pro Tier (AI Analysts)' : 'Premium Tier (Elite Masters)'}
                </h4>
                <div className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${
                  formData.plan === 'PRO TIER (ANALYSTS)' ? 'bg-indigo-500/10 text-indigo-500' :
                  formData.plan === 'PREMIUM (MASTERS)' ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white' :
                  'bg-zinc-500/10 text-zinc-500'
                }`}>
                  {formData.plan === 'PRO TIER (ANALYSTS)' ? 'Pro' : 
                   formData.plan === 'PREMIUM (MASTERS)' ? 'Elite' : 'Starter'}
                </div>
              </div>

              <div className="grid grid-cols-3 md:grid-cols-6 gap-6">
                {currentAvatars.map((url, idx) => (
                  <button
                    key={idx}
                    onClick={() => setFormData({ ...formData, avatarUrl: url })}
                    className={`aspect-square rounded-3xl overflow-hidden border-4 transition-all relative group ${formData.avatarUrl === url
                        ? 'border-[#FF4F01] scale-105 shadow-xl shadow-[#FF4F01]/20'
                        : isDarkMode ? 'border-zinc-800 bg-[#111] opacity-50 hover:opacity-100' : 'border-zinc-100 bg-white shadow-sm opacity-50 hover:opacity-100'
                      }`}
                  >
                    <img src={url} alt="Avatar" className="w-full h-full object-cover" />
                    {formData.avatarUrl === url && (
                      <div className="absolute inset-0 bg-[#FF4F01]/10 flex items-center justify-center">
                        <div className="bg-[#FF4F01] text-white p-1 rounded-full shadow-lg">
                          <Check size={16} strokeWidth={4} />
                        </div>
                      </div>
                    )}
                  </button>
                ))}
              </div>

              <div className="mt-12 p-6 rounded-2xl border border-dashed border-zinc-800 flex items-center gap-6">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#FF4F01] to-orange-600 flex items-center justify-center text-white shadow-xl overflow-hidden shrink-0">
                  <img src={formData.avatarUrl} alt="Selected Avatar" className="w-full h-full object-cover" />
                </div>
                <div>
                  <h4 className="font-bold text-xl mb-1">Looking good, {formData.name || 'Trader'}!</h4>
                  <p className="text-sm opacity-50">This is how you will appear across the platform and in your analytics reports.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="mt-8 lg:mt-16 pt-8 border-t border-zinc-100 dark:border-zinc-900 flex items-center justify-between">
          <button
            onClick={prevStep}
            className={`flex items-center gap-2 px-8 py-3 rounded-xl font-bold text-sm transition-all border ${step === 1 ? 'opacity-0 pointer-events-none' : isDarkMode ? 'border-zinc-800 hover:bg-black text-zinc-400' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-600'
              }`}
          >
            <ArrowLeft size={18} /> Back
          </button>

          <div className="flex items-center gap-4">
            {step < 6 ? (
              <div className="flex items-center gap-4">
                {step < 6 && (
                  <button
                    onClick={nextStep}
                    disabled={(step === 1 && (!formData.name || !formData.country)) || (step === 3 && !agreedToTerms)}
                    className="flex items-center gap-3 px-12 py-4 bg-[#FF4F01] hover:bg-[#e64601] text-white rounded-xl font-black text-sm shadow-xl shadow-[#FF4F01]/20 disabled:opacity-30 transition-all hover:translate-x-1"
                  >
                    Continue <ArrowRight size={20} />
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <button
                  onClick={onExploreDemo}
                  className={`flex items-center gap-2 px-6 py-4 rounded-xl font-bold text-sm border transition-all ${
                    isDarkMode ? 'border-zinc-700 text-zinc-300 hover:border-zinc-500' : 'border-slate-300 text-slate-600 hover:border-slate-400'
                  }`}
                  title="Look around JFX-JOURNAL with realistic sample data — your real journal stays empty until you log trades"
                >
                  Explore with Demo Data
                </button>
                <button
                  onClick={handleFinish}
                  className="flex items-center gap-3 px-12 py-4 bg-[#FF4F01] hover:bg-[#e64601] text-white rounded-xl font-black text-sm shadow-xl shadow-[#FF4F01]/20 transition-all hover:scale-[1.05]"
                >
                  Get Started
                </button>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default Onboarding;
