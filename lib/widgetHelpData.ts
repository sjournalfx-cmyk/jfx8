export interface HelpSection {
    title: string;
    points: string[];
}

export interface WidgetHelpArticle {
    id: string;
    title: string;
    category: string;
    breadcrumb: string;
    definition: string;
    formula?: string;
    formulaExample?: string;
    whyMisleading?: {
        intro: string;
        examples: string[];
        breakEvenFormula?: string;
    };
    howItHelps?: HelpSection[];
}

export const WIDGET_HELP_DATABASE: Record<string, WidgetHelpArticle> = {
    winRate: {
        id: 'winRate',
        title: 'What is a Win Rate?',
        category: 'Overview',
        breadcrumb: 'Help Center / Overview / Win Rate',
        definition: 'The win rate is a core metric used to track trading performance over a specific period or number of trades.',
        formula: '(Number of Winning Trades ÷ Total Number of Trades) × 100',
        formulaExample: 'Example: 60 winning trades out of 100 total trades equals a 60% win rate.\n\nNeutral Metric: A high win rate does not automatically guarantee overall profitability.',
        whyMisleading: {
            intro: 'A win rate must always be paired with the Risk-to-Reward Ratio (R:R) to understand actual profitability.',
            examples: [
                'High Win Rate, Losing Money: A trader wins 90% of the time, making R10 per win. However, the 10% of losing trades lose R200 each. The trader loses money overall.',
                'Low Win Rate, Making Money: A trader wins 30% of the time, losing R10 per loss. However, the 30% of winning trades make R50 each. The trader makes a net profit.',
            ],
            breakEvenFormula: 'Minimum Win Rate Required = 1 ÷ (1 + Average Reward / Average Risk)',
        },
        howItHelps: [
            {
                title: '1. Validates Trading Strategies',
                points: [
                    'Confirms if a strategy has a statistical edge.',
                    'Highlights which market conditions suit the strategy.',
                    'Prevents relying on guesswork or gut feelings.',
                ],
            },
            {
                title: '2. Enhances Risk Management',
                points: [
                    'Determines appropriate position sizing per trade.',
                    'Helps set realistic profit targets and stop-losses.',
                    'Prevents over-leveraging on low-probability setups.',
                ],
            },
            {
                title: '3. Manages Psychological Expectations',
                points: [
                    'Prepares the mind for inevitable losing streaks.',
                    'Reduces emotional trading during drawdown periods.',
                    'Builds discipline by setting realistic performance expectations.',
                ],
            },
            {
                title: '4. Identifies Performance Leaks',
                points: [
                    'Reveals if specific assets lower the win rate.',
                    'Highlights if trading during certain hours reduces success.',
                    'Pinpoints execution errors versus strategy failures.',
                ],
            },
        ],
    },

    profitFactor: {
        id: 'profitFactor',
        title: 'What is Profit Factor?',
        category: 'Overview',
        breadcrumb: 'Help Center / Overview / Profit Factor',
        definition: 'Profit Factor measures the ratio of total gross profits to total gross losses. It tells you how many rands (or dollars) you earn for every rand you lose.',
        formula: 'Gross Winning PnL ÷ Absolute Gross Losing PnL',
        formulaExample: 'Example: If you earned R50,000 in profits and lost R25,000, your Profit Factor = 50,000 ÷ 25,000 = 2.0\n\nA Profit Factor of 1.0 means break-even. Anything above 1.0 means your system is profitable.',
        whyMisleading: {
            intro: 'Profit Factor can appear strong on a short trade sample while hiding a fundamentally flawed strategy.',
            examples: [
                'Cherry-Picked Sample: A 10-trade streak of wins can show a Profit Factor of 3.0, but over 200 trades the system may be a 0.9 (losing).',
                'High Profit Factor with Ruin Risk: A system with PF 2.5 but a maximum drawdown of 60% will blow most accounts before the edge plays out.',
            ],
        },
        howItHelps: [
            {
                title: '1. Measures System Efficiency',
                points: [
                    'Quickly identifies if your strategy has a net positive expectancy.',
                    'Allows direct comparison between different strategies.',
                    'Shows the return generated per unit of risk taken.',
                ],
            },
            {
                title: '2. Guides Position Sizing',
                points: [
                    'Higher Profit Factor systems can safely use more aggressive sizing.',
                    'Low PF systems demand conservative risk per trade (0.25% - 0.5%).',
                ],
            },
            {
                title: '3. Early Warning System',
                points: [
                    'A declining Profit Factor over rolling 30-trade windows signals strategy degradation.',
                    'Helps catch regime changes before they cause significant drawdowns.',
                ],
            },
        ],
    },

    grossProfit: {
        id: 'grossProfit',
        title: 'What is Gross Profit?',
        category: 'Overview',
        breadcrumb: 'Help Center / Overview / Gross Profit',
        definition: 'Gross Profit is the total sum of all profits earned exclusively from winning closed trades, before subtracting any losses.',
        formula: 'Sum of PnL for all trades where PnL > 0',
        formulaExample: 'Example: If you had 5 winning trades of R200, R350, R100, R500, and R150 — your Gross Profit = R1,300.\n\nThis metric does not account for your losses, which is why it must always be read alongside Gross Loss.',
        howItHelps: [
            {
                title: '1. Evaluates Upside Potential',
                points: [
                    'Shows the raw earning power of your winning trades.',
                    'Helps calculate the Profit Factor alongside Gross Loss.',
                    'Reveals how much capital your system generates before costs.',
                ],
            },
            {
                title: '2. Strategy Benchmarking',
                points: [
                    'Compare Gross Profit across different strategies or timeframes.',
                    'Identify which setups or sessions contribute most to your top-line gains.',
                ],
            },
        ],
    },

    grossLoss: {
        id: 'grossLoss',
        title: 'What is Gross Loss?',
        category: 'Overview',
        breadcrumb: 'Help Center / Overview / Gross Loss',
        definition: 'Gross Loss is the total absolute sum of losses from all losing closed trades. It represents the downside cost of running your trading strategy.',
        formula: 'Sum of |PnL| for all trades where PnL < 0',
        formulaExample: 'Example: If your losing trades were -R150, -R200, -R75 — your Gross Loss = R425.\n\nGross Loss is always displayed as a positive number representing the total capital paid out in losses.',
        whyMisleading: {
            intro: 'A high Gross Loss number does not necessarily mean a bad strategy — what matters is whether it is smaller than Gross Profit.',
            examples: [
                'Healthy Gross Loss: Gross Profit R10,000 vs Gross Loss R5,000 = Profit Factor 2.0 (excellent).',
                'Dangerous Gross Loss: Gross Profit R3,000 vs Gross Loss R8,000 = Profit Factor 0.37 (system is destroying capital).',
            ],
        },
        howItHelps: [
            {
                title: '1. Risk Cost Visibility',
                points: [
                    'Makes the true cost of your losing trades visible.',
                    'Prevents traders from ignoring how much capital is being lost.',
                    'Paired with Gross Profit it produces the Profit Factor.',
                ],
            },
            {
                title: '2. Loss Control',
                points: [
                    'Tracking Gross Loss weekly forces accountability on losers.',
                    'Reveals if losses are growing disproportionately to wins.',
                ],
            },
        ],
    },

    equityCurve: {
        id: 'equityCurve',
        title: 'What is an Equity Curve?',
        category: 'Performance',
        breadcrumb: 'Help Center / Performance / Equity Curve',
        definition: 'An equity curve is a visual plot of your account balance over time, showing the cumulative growth or decline of your trading capital across all closed trades.',
        formula: 'Equity(n) = Starting Balance + Sum of PnL from Trade 1 to Trade n',
        formulaExample: 'Example: Starting balance R10,000. After 3 trades (+R500, -R200, +R800): Equity = R11,100.\n\nEach data point on the chart represents your running account balance after each completed trade.',
        whyMisleading: {
            intro: 'A rising equity curve over a short period can be misleading — it may reflect luck or low sample size rather than genuine edge.',
            examples: [
                'Lucky Streak Curve: 10 consecutive wins look like a smooth upward curve but mean nothing statistically without 50+ trade samples.',
                'Curve vs. Drawdown: A curve that goes up fast but drops 40% in one week is far more dangerous than a slower, steadier curve.',
            ],
        },
        howItHelps: [
            {
                title: '1. Tracks Account Health',
                points: [
                    'Shows whether your account is growing, stagnating, or declining.',
                    'Reveals drawdown depth and recovery speed at a glance.',
                    'Flags strategy breakdowns before they become catastrophic.',
                ],
            },
            {
                title: '2. Validates Strategy Consistency',
                points: [
                    'A smooth, steady slope indicates a reliable statistical edge.',
                    'Sharp spikes often signal over-leveraging or outlier wins — not skill.',
                    'Compare curve shape across different market conditions.',
                ],
            },
            {
                title: '3. Psychological Anchoring',
                points: [
                    'Provides a visual reference for your peak equity high-water mark.',
                    'Reduces emotional decisions by keeping performance data objective.',
                ],
            },
        ],
    },

    drawdown: {
        id: 'drawdown',
        title: 'What is Drawdown?',
        category: 'Risk Management',
        breadcrumb: 'Help Center / Risk / Drawdown',
        definition: 'Drawdown measures the peak-to-trough decline in your account equity. It tells you how far your account has fallen from its highest point at any given moment.',
        formula: 'Drawdown % = ((Peak Equity − Current Equity) ÷ Peak Equity) × 100',
        formulaExample: 'Example: Your account peaks at R20,000 then drops to R16,000. Drawdown = ((20,000 − 16,000) ÷ 20,000) × 100 = 20%\n\nA 20% drawdown means you need a 25% gain just to return to break-even.',
        whyMisleading: {
            intro: 'Maximum drawdown alone does not tell the full story — duration and recovery time matter equally.',
            examples: [
                'Fast Recovery: A 15% drawdown recovered in 2 weeks is manageable.',
                'Prolonged Drawdown: A 15% drawdown lasting 4 months indicates deep strategy problems and psychological erosion.',
            ],
        },
        howItHelps: [
            {
                title: '1. Defines Your Risk Tolerance',
                points: [
                    'Set hard stop rules at predefined drawdown levels (e.g. stop trading at 10%).',
                    'Determines maximum acceptable loss before a strategy review is mandatory.',
                ],
            },
            {
                title: '2. Guides Position Sizing',
                points: [
                    'Higher drawdown history = smaller position sizes per trade.',
                    'Cut lot sizes by 50% when drawdown exceeds 12% to reduce ruin risk.',
                ],
            },
            {
                title: '3. Prevents Overtrading During Losses',
                points: [
                    'Tracks emotional danger zones where traders Martingale or revenge trade.',
                    'Enforces circuit breakers — mandatory pause when drawdown threshold is hit.',
                ],
            },
        ],
    },

    momentumStreak: {
        id: 'momentumStreak',
        title: 'What is Momentum Streak?',
        category: 'Overview',
        breadcrumb: 'Help Center / Overview / Momentum Streak',
        definition: 'Momentum Streak tracks your current consecutive winning or losing run. It measures how many trades in a row have gone in the same direction (all wins or all losses).',
        formula: 'Streak = Count of consecutive identical outcomes (Win or Loss) from the most recent trade backward',
        formulaExample: 'Example: Your last 5 trades were: Win, Win, Win, Loss, Loss — your current streak is a 2-loss streak.\n\nStreaks are normal in any system with a statistical edge.',
        whyMisleading: {
            intro: 'Streaks are emotionally powerful but statistically normal. Most traders overreact to both winning and losing streaks.',
            examples: [
                'Winning Streak Overconfidence: A 7-trade winning streak may tempt you to increase size dramatically, right before the statistical regression hits.',
                'Losing Streak Panic: A 5-trade losing streak may cause you to abandon a strategy that is still statistically valid over 100+ trades.',
            ],
        },
        howItHelps: [
            {
                title: '1. Psychological Awareness',
                points: [
                    'Keeps you aware of hot and cold performance periods.',
                    'Prevents overconfident position sizing during hot streaks.',
                    'Provides context during losing runs — is this normal variance?',
                ],
            },
            {
                title: '2. Risk Adjustment Signal',
                points: [
                    'After 3+ consecutive losses, consider reducing lot size by 25-50%.',
                    'After 3+ consecutive wins, maintain size discipline — do not over-leverage.',
                ],
            },
        ],
    },

    currencyStrength: {
        id: 'currencyStrength',
        title: 'What is Currency Strength?',
        category: 'Market Matrix',
        breadcrumb: 'Help Center / Market / Currency Strength',
        definition: 'The Currency Strength Meter ranks major Forex currencies (USD, EUR, GBP, JPY, AUD, CAD, CHF, NZD) from strongest to weakest based on their performance across all cross pairs.',
        formula: 'Strength Index = Normalized sum of Rate-of-Change (ROC) across all currency cross pairs',
        formulaExample: 'Example: If USD is rising against EUR, GBP, JPY, and AUD simultaneously, USD receives a high strength score.\n\nThe index is normalized to a range, making currencies directly comparable.',
        whyMisleading: {
            intro: 'Currency strength is a lagging indicator — it reflects what has already happened, not necessarily what will happen next.',
            examples: [
                'Over-extended Strength: A currency at +90 strength may already be priced in and due for a reversal or consolidation.',
                'News Events Override Strength: A fundamental shock (rate decision, NFP) can instantly reverse currency rankings regardless of prior strength.',
            ],
        },
        howItHelps: [
            {
                title: '1. Setup Confluence Filter',
                points: [
                    'Trade in the direction of the strongest vs weakest currency pairing.',
                    'Avoid trading two neutral-strength currencies against each other.',
                    'Confirms momentum direction before entry.',
                ],
            },
            {
                title: '2. Pair Selection',
                points: [
                    'Identifies the highest probability directional bias for each session.',
                    'Eliminates low-conviction ranging pairs from your watchlist.',
                ],
            },
        ],
    },

    tradeGrade: {
        id: 'tradeGrade',
        title: 'What is Trade Setup Grade?',
        category: 'Execution',
        breadcrumb: 'Help Center / Execution / Trade Grade',
        definition: 'Trade Setup Grade measures the quality of each trade entry based on how many of your predefined setup criteria were met before you entered the position.',
        formula: 'Grade = A+ (all criteria met) → A → B → C (few/no criteria met)',
        formulaExample: 'Example: You have 5 setup rules. If all 5 are present before entry = A+. If 3-4 present = A. If 1-2 present = B or C.\n\nGrade C trades are impulse trades with minimal structural justification.',
        whyMisleading: {
            intro: 'A grade alone does not guarantee a win — markets are probabilistic. However, over many trades, higher grades should produce better expectancy.',
            examples: [
                'Grade A+ losing: A perfectly-graded setup can still lose due to news, manipulation, or low liquidity.',
                'Grade C winning: An impulse trade winning feels like validation. Over 100 trades, Grade C setups typically produce negative expectancy.',
            ],
        },
        howItHelps: [
            {
                title: '1. Enforces Pre-Trade Discipline',
                points: [
                    'Forces you to consciously evaluate every entry before executing.',
                    'Reduces impulse trades by requiring grade assignment before entry.',
                    'Creates a trackable record of your decision quality.',
                ],
            },
            {
                title: '2. Identifies Your Edge',
                points: [
                    'Reveals which grade tiers actually produce positive expectancy.',
                    'Allows you to eliminate unprofitable grade tiers completely.',
                    'Shows which setup criteria have the highest predictive value.',
                ],
            },
        ],
    },

    psychSlip: {
        id: 'psychSlip',
        title: 'What is Psychological Slip?',
        category: 'Psychology',
        breadcrumb: 'Help Center / Psychology / Psychological Slip',
        definition: 'Psychological Slip quantifies the monetary cost of emotionally-driven trading errors — trades taken due to FOMO, greed, revenge, or hesitation rather than strategy rules.',
        formula: 'Psych Slip = Sum of losses on trades tagged with execution errors or emotional mindset labels',
        formulaExample: 'Example: 3 revenge trades lost R200, R150, R300. Total Psych Slip = R650.\n\nThis number represents money lost not to the market, but to your own psychology.',
        whyMisleading: {
            intro: 'Psych Slip is only as accurate as your honest journaling. Under-reporting emotional trades makes this metric useless.',
            examples: [
                'Honest Logging: If you tag a revenge trade as "Greed / Revenge", the system captures the real cost.',
                'Dishonest Logging: Tagging every loss as a "strategy trade" hides emotional leaks and prevents improvement.',
            ],
        },
        howItHelps: [
            {
                title: '1. Makes Emotional Cost Visible',
                points: [
                    'Converts vague "bad trading habits" into a hard dollar figure.',
                    'Creates accountability for every emotional deviation.',
                    'Motivates behavior change by showing real financial impact.',
                ],
            },
            {
                title: '2. Identifies Your Biggest Emotional Trap',
                points: [
                    'Reveals which emotion (FOMO, greed, revenge) costs you the most.',
                    'Allows targeted journaling and mental protocols for specific triggers.',
                    'Week-over-week tracking shows if emotional control is improving.',
                ],
            },
        ],
    },

    revenueMatrix: {
        id: 'revenueMatrix',
        title: 'What is the Revenue Heatmap?',
        category: 'Time Analysis',
        breadcrumb: 'Help Center / Time Analysis / Revenue Heatmap',
        definition: 'The Revenue Heatmap visualises your net PnL performance broken down by hour of day and day of week, revealing when you trade best and worst.',
        formula: 'Cell Value = Net PnL accumulated during Hour [H] on Day [D] across all logged trades',
        formulaExample: 'Example: All your trades executed on Monday between 10:00–11:00 SAST collectively produced R1,200 in profit → that cell appears bright green.\n\nRed cells indicate consistent losses during that time slot.',
        whyMisleading: {
            intro: 'Small trade samples in specific time slots can make a cell look extremely profitable or unprofitable by chance.',
            examples: [
                'One big win at 3 AM does not mean 3 AM is your best hour — you need 10+ trades in a slot for statistical significance.',
                'Avoid eliminating time slots based on 2-3 trades; look for patterns with 15+ occurrences.',
            ],
        },
        howItHelps: [
            {
                title: '1. Optimise Your Trading Schedule',
                points: [
                    'Focus active trading time on your statistically best hours.',
                    'Eliminate or reduce trading during consistently red time slots.',
                    'Aligns session activity with peak market liquidity windows.',
                ],
            },
            {
                title: '2. Session Planning',
                points: [
                    'Plan your trading day around your highest-probability windows.',
                    'Avoid overtrading during low-performance late-session hours.',
                    'Identify whether London, NY, or Asian sessions suit your style.',
                ],
            },
        ],
    },

    tiltScore: {
        id: 'tiltScore',
        title: 'What is the Discipline Score?',
        category: 'Psychology',
        breadcrumb: 'Help Center / Psychology / Discipline Score',
        definition: 'The Discipline Score (Tilt Score) quantifies your emotional control and rule adherence as a score from 0 to 100, calculated from how consistently you follow your predefined trading plan.',
        formula: 'Discipline Score = 100 − (Impulse Penalty × 15) − (Plan Deviation Penalty × 10) − (SL Mutation Penalty × 20)',
        formulaExample: 'Example: 2 impulse trades, 1 stop-loss moved = 100 − 30 − 20 = 50. A score of 50 signals high emotional risk.\n\nThe closer to 100, the more mechanically and consistently you are executing.',
        whyMisleading: {
            intro: 'A high Discipline Score does not guarantee profits — but a low score almost always predicts avoidable losses.',
            examples: [
                'High Score, Losing Trades: You can follow every rule perfectly and still have losing trades — that is normal variance.',
                'Low Score, Winning Trades: Getting away with rule-breaking wins is the most dangerous outcome — it reinforces bad habits.',
            ],
        },
        howItHelps: [
            {
                title: '1. Monitors Emotional State in Real Time',
                points: [
                    'Gives an objective score to what is usually a subjective feeling.',
                    'Flags deteriorating discipline before a costly revenge-trading spiral begins.',
                    'Creates daily accountability for rule adherence.',
                ],
            },
            {
                title: '2. Protects Capital During Tilt',
                points: [
                    'Enforces mandatory cool-off when score drops below 70.',
                    'Reduces position sizes automatically as emotional risk rises.',
                    'Prevents account blow-ups caused by emotional decision chains.',
                ],
            },
            {
                title: '3. Long-Term Behaviour Improvement',
                points: [
                    'Weekly score trends show whether your discipline is improving.',
                    'Identifies which rule violations recur most frequently.',
                    'Provides data to build more robust pre-trade checklists.',
                ],
            },
        ],
    },
    plMindset: {
        id: 'plMindset',
        title: 'What is P/L by Mindset?',
        category: 'Psychology',
        breadcrumb: 'Help Center / Psychology / P/L by Mindset',
        definition: 'P/L by Mindset measures your total profit and loss grouped by the mental state (Confident, Neutral, Hesitant, Anxious, FOMO) you recorded when taking each trade.',
        formula: 'Mindset PnL = Sum of PnL for all trades tagged with Mindset [M]',
        formulaExample: 'Example: 10 Confident trades produced +R4,000, while 5 FOMO trades produced -R2,500.',
        whyMisleading: {
            intro: 'Self-reported mindset relies on honest post-trade reflection.',
            examples: [
                'Retrospective Bias: Labeling a losing trade as "FOMO" only after it lost, rather than recording your true feeling before entry.',
            ],
        },
        howItHelps: [
            {
                title: '1. Connects Emotion to Dollar Values',
                points: [
                    'Shows which mental states generate profits and which drain account equity.',
                    'Helps you recognize patterns like FOMO or Hesitation before they destroy capital.',
                ],
            },
        ],
    },

    plAdherence: {
        id: 'plAdherence',
        title: 'What is P/L by Plan Adherence?',
        category: 'Psychology',
        breadcrumb: 'Help Center / Psychology / Plan Adherence',
        definition: 'P/L by Plan Adherence compares profitability across trades where you followed your plan exactly versus trades with minor/major deviations or no plan at all.',
        formula: 'Adherence PnL = Sum of PnL for trades grouped by plan adherence tier',
        formulaExample: 'Example: Followed Exactly = +R8,500. Major Deviation = -R4,200.',
        whyMisleading: {
            intro: 'An off-plan trade can occasionally win, but over a sample of 50+ trades, off-plan trading almost always yields negative expectancy.',
            examples: [
                'Lucky Deviations: Winning on a trade where you broke your stop-loss rule can falsely validate bad discipline.',
            ],
        },
        howItHelps: [
            {
                title: '1. Proves Statistical Edge of Rule Adherence',
                points: [
                    'Provides clear visual proof that following your plan generates superior returns.',
                    'Deters impulse entries by highlighting the cost of plan deviations.',
                ],
            },
        ],
    },
};

export const getWidgetHelpArticle = (widgetId: string): WidgetHelpArticle => {
    return WIDGET_HELP_DATABASE[widgetId] || {
        id: widgetId,
        title: `What is ${widgetId.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}?`,
        category: 'Analytics',
        breadcrumb: `Help Center / Analytics / ${widgetId}`,
        definition: 'This metric tracks and measures a key aspect of your trading performance over time.',
        formula: 'Calculated dynamically based on your logged trade data.',
        formulaExample: 'Open a position with all required fields filled in to see this metric populate.',
        howItHelps: [
            {
                title: '1. Performance Insight',
                points: [
                    'Provides objective data to evaluate your trading decisions.',
                    'Identifies patterns and trends across your trade history.',
                ],
            },
        ],
    };
};
