
export const APP_CONSTANTS = {
  STORAGE_KEYS: {
    THEME: 'jfx_theme_mode', // Changed to mode to support future light/dark/system
    THEME_DARK: 'jfx_theme_dark',
  },
  VIEWS: {
    DASHBOARD: 'dashboard',
    LOG_TRADE: 'log-trade',
    JOURNAL: 'history',
    ANALYTICS: 'analytics',
    GOALS: 'goals',
    NOTES: 'notes',
    CHARTS: 'charts',
    DIAGRAMS: 'diagrams',
    SETTINGS: 'settings',
    MONITORING: 'monitoring',
  },
  TABLES: {
    PROFILES: 'profiles',
    TRADES: 'trades',
    NOTES: 'notes',
    DAILY_BIAS: 'daily_bias',
    GOALS: 'goals',
    FIREHOSE_RULES: 'firehose_rules',
    FIREHOSE_EVENTS: 'firehose_events',
  },
  PLANS: {
    FREE: 'FREE TIER (JOURNALER)',
    HOBBY: 'PRO TIER (ANALYSTS)',
    STANDARD: 'PREMIUM (MASTERS)',
  },
  CURRENCIES: [
    { code: 'USD', symbol: '$', name: 'US Dollar' },
    { code: 'EUR', symbol: '€', name: 'Euro' },
    { code: 'GBP', symbol: '£', name: 'British Pound' },
    { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  ]
};

const PLAN_NORMALIZATION_MAP: Record<string, string> = {
  [APP_CONSTANTS.PLANS.FREE.toLowerCase()]: APP_CONSTANTS.PLANS.FREE,
  free: APP_CONSTANTS.PLANS.FREE,
  'free tier': APP_CONSTANTS.PLANS.FREE,
  journaler: APP_CONSTANTS.PLANS.FREE,
  'free tier (journaler)': APP_CONSTANTS.PLANS.FREE,

  [APP_CONSTANTS.PLANS.HOBBY.toLowerCase()]: APP_CONSTANTS.PLANS.HOBBY,
  pro: APP_CONSTANTS.PLANS.HOBBY,
  'pro tier': APP_CONSTANTS.PLANS.HOBBY,
  analyst: APP_CONSTANTS.PLANS.HOBBY,
  analysts: APP_CONSTANTS.PLANS.HOBBY,
  'pro tier (analysts)': APP_CONSTANTS.PLANS.HOBBY,
  hobby: APP_CONSTANTS.PLANS.HOBBY,

  [APP_CONSTANTS.PLANS.STANDARD.toLowerCase()]: APP_CONSTANTS.PLANS.STANDARD,
  premium: APP_CONSTANTS.PLANS.STANDARD,
  'premium tier': APP_CONSTANTS.PLANS.STANDARD,
  masters: APP_CONSTANTS.PLANS.STANDARD,
  elite: APP_CONSTANTS.PLANS.STANDARD,
  'elite masters (premium)': APP_CONSTANTS.PLANS.STANDARD,
  'premium (masters)': APP_CONSTANTS.PLANS.STANDARD,
  standard: APP_CONSTANTS.PLANS.STANDARD,
};

export const normalizePlan = (plan?: string | null) => {
  const normalized = plan?.trim().toLowerCase();
  if (!normalized) return APP_CONSTANTS.PLANS.FREE;

  const directMatch = PLAN_NORMALIZATION_MAP[normalized];
  if (directMatch) return directMatch;

  if (normalized.includes('free')) return APP_CONSTANTS.PLANS.FREE;
  if (normalized.includes('pro') || normalized.includes('hobby') || normalized.includes('analyst')) {
    return APP_CONSTANTS.PLANS.HOBBY;
  }
  if (normalized.includes('premium') || normalized.includes('elite') || normalized.includes('standard')) {
    return APP_CONSTANTS.PLANS.STANDARD;
  }

  return APP_CONSTANTS.PLANS.FREE;
};

export const PLAN_FEATURES = {
  [APP_CONSTANTS.PLANS.FREE]: {
    maxTradesPerMonth: 50,
    maxNotes: 1,
    maxImages: 0,
    allowImageUploads: false,
    advancedAnalytics: false, // Growth, Discipline tabs
    comparisonAnalytics: false,
    multiChartLayouts: false,
    directBrokerSync: false,
    aiInsights: false,
    voiceNotes: false,
  },
  [APP_CONSTANTS.PLANS.HOBBY]: { // PRO
    maxTradesPerMonth: 500,
    maxNotes: Infinity,
    maxImages: 1000,
    allowImageUploads: true,
    advancedAnalytics: true,
    comparisonAnalytics: false,
    multiChartLayouts: false,
    directBrokerSync: false,
    aiInsights: false,
    voiceNotes: false,
  },
  [APP_CONSTANTS.PLANS.STANDARD]: { // PREMIUM
    maxTradesPerMonth: Infinity,
    maxNotes: Infinity,
    maxImages: Infinity,
    allowImageUploads: true,
    advancedAnalytics: true,
    comparisonAnalytics: true,
    multiChartLayouts: true,
    directBrokerSync: true, // Enabled for Premium
    aiInsights: true, // Enabled for Premium
    voiceNotes: true, // Enabled for Premium
    robustnessAnalytics: true, // New Intelligence lab
    headlessMT5: true, // New Headless feature
  }
};
