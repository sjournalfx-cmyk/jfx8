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

    pairDistribution: {
        id: 'pairDistribution',
        title: 'What is Pair Distribution?',
        category: 'Trade Analysis',
        breadcrumb: 'Help Center / Trade Analysis / Pair Distribution',
        definition: 'The Pair Distribution treemap shows how your completed trades are spread across the instruments you trade. Each tile represents a pair, and its size reflects that pair’s share of your trading activity.',
        formula: 'Tile size = Number of completed trades for the pair ÷ Total completed trades',
        formulaExample: 'Example: If you completed 20 of 50 trades on EURUSD, its tile represents 40% of your trade distribution. The colour shows whether that pair was profitable or unprofitable overall.',
        whyMisleading: {
            intro: 'A large tile shows activity, not quality. A pair with many trades is not automatically your best opportunity.',
            examples: [
                'High Frequency, Low Quality: A large tile may reveal overtrading if the pair has poor profitability or inconsistent results.',
                'Small Sample Size: A small, profitable tile may be due to only a few trades and needs more data before drawing conclusions.',
            ],
        },
        howItHelps: [
            {
                title: '1. Reveals Trading Concentration',
                points: [
                    'Shows which pairs receive most of your attention and capital.',
                    'Highlights concentration risk when one instrument dominates your activity.',
                ],
            },
            {
                title: '2. Supports Pair Review',
                points: [
                    'Compare the size and result of each tile to spot pairs worth keeping, reducing, or reviewing.',
                    'Use it alongside win rate and expectancy before changing your watchlist.',
                ],
            },
        ],
    },

    symbolPerformance: { id: 'symbolPerformance', title: 'What is Symbol Performance?', category: 'Trade Analysis', breadcrumb: 'Help Center / Trade Analysis / Symbol Performance', definition: 'Symbol Performance compares the completed-trade results of each instrument you trade, including its total P/L, win rate, and trade count.', formula: 'Pair P/L = Sum of completed-trade P/L for that symbol', formulaExample: 'Use a meaningful sample size before deciding that a pair is strong or weak.' },
    largestWinLoss: { id: 'largestWinLoss', title: 'What are Largest Win and Loss?', category: 'Trade Analysis', breadcrumb: 'Help Center / Trade Analysis / Largest Win and Loss', definition: 'This widget highlights your biggest single winning and losing trades, together with the cumulative P/L of long and short positions.', formula: 'Largest result = Maximum or minimum P/L across completed trades', formulaExample: 'A single exceptional result is context, not proof of a repeatable edge.' },
    outcomeDistribution: { id: 'outcomeDistribution', title: 'What is Outcome Distribution?', category: 'Trade Analysis', breadcrumb: 'Help Center / Trade Analysis / Outcome Distribution', definition: 'Outcome Distribution shows the share of completed trades that were wins, losses, or break-even.', formula: 'Outcome share = Trades in outcome ÷ Total completed trades × 100', formulaExample: 'Review it with average win and average loss; the most common outcome is not always the most profitable.' },
    riskReward: { id: 'riskReward', title: 'What is Risk/Reward?', category: 'Overview', breadcrumb: 'Help Center / Overview / Risk Reward', definition: 'Risk/Reward compares the average amount you gain on winning trades with the average amount you lose on losing trades.', formula: 'Risk/Reward = Average win ÷ Absolute average loss', formulaExample: 'An average win of R200 and average loss of R100 produces a 2.0 risk/reward ratio.' },
    netProfit: { id: 'netProfit', title: 'What is Net P/L?', category: 'Overview', breadcrumb: 'Help Center / Overview / Net Profit Loss', definition: 'Net P/L is the total realised result from all completed trades after gains and losses are combined.', formula: 'Net P/L = Gross profit − Gross loss', formulaExample: 'Positive net P/L means the selected completed trades made money overall.' },
    timeAnalysis: { id: 'timeAnalysis', title: 'What is Time Analysis?', category: 'Timing', breadcrumb: 'Help Center / Timing / Time Analysis', definition: 'Time Analysis maps your completed-trade performance by day and hour, making productive and weak trading windows easier to identify.', formula: 'Time-slot P/L = Sum of completed-trade P/L in that day and hour', formulaExample: 'Treat a hot or cold slot cautiously until it contains enough trades to be representative.' },
    strategyPerformance: { id: 'strategyPerformance', title: 'What is Strategy Performance?', category: 'Advanced', breadcrumb: 'Help Center / Advanced / Strategy Performance', definition: 'Strategy Performance groups completed trades by strategy tag to compare their activity and cumulative P/L.', formula: 'Strategy P/L = Sum of completed-trade P/L sharing a strategy tag', formulaExample: 'A strategy with fewer trades may need more samples before it is scaled or removed.' },
    tradingMistakes: { id: 'tradingMistakes', title: 'What are Trading Mistakes?', category: 'Advanced', breadcrumb: 'Help Center / Advanced / Trading Mistakes', definition: 'Trading Mistakes tracks the frequency and impact of mistakes recorded in your journal, so recurring execution issues become visible.', formula: 'Mistake count = Number of completed trades tagged with each mistake', formulaExample: 'Focus on the mistakes that recur most often or coincide with the largest losses.' },
    detailedReport: { id: 'detailedReport', title: 'What is the Detailed Performance Report?', category: 'Reports', breadcrumb: 'Help Center / Reports / Detailed Performance Report', definition: 'The Detailed Performance Report consolidates key performance metrics, trading-day activity, and drawdown information for review.', formula: 'Report values are calculated from the completed trades in the active journal data.', formulaExample: 'Use it to review the full performance picture instead of relying on any one metric.' },
    marketSessions: { id: 'marketSessions', title: 'What is Market Session Performance?', category: 'Timing', breadcrumb: 'Help Center / Timing / Market Sessions', definition: 'Market Session Performance groups completed trades by Asian, London, overlap, and New York trading sessions.', formula: 'Session P/L = Sum of completed-trade P/L assigned to that session', formulaExample: 'Session results can help you focus preparation on the times your method performs best.' },
    hourlyPerformance: { id: 'hourlyPerformance', title: 'What is Hourly Performance?', category: 'Timing', breadcrumb: 'Help Center / Timing / Hourly Performance', definition: 'Hourly Performance compares trade activity, duration, and results for each hour of the day.', formula: 'Hourly P/L = Sum of completed-trade P/L opened in each hour', formulaExample: 'Check that a favourable hour has enough trades before changing your trading schedule.' },
    dailyActivity: { id: 'dailyActivity', title: 'What is Daily Activity?', category: 'Timing', breadcrumb: 'Help Center / Timing / Daily Activity', definition: 'Daily Activity shows how your trade count and P/L vary across the trading days of the week.', formula: 'Daily P/L = Sum of completed-trade P/L for each weekday', formulaExample: 'A poor day may be caused by a small sample, so review it alongside trade count.' },
    comparison: { id: 'comparison', title: 'What is Comparative Equity?', category: 'Comparison', breadcrumb: 'Help Center / Comparison / Comparative Equity', definition: 'Comparative Equity overlays cumulative P/L for the two selected groups, such as symbols, strategies, or sessions.', formula: 'Cumulative P/L = Running sum of completed-trade P/L over time', formulaExample: 'Compare both the final result and the smoothness of each line.' },
    cashTransactions: { id: 'cashTransactions', title: 'What are Cash Transactions?', category: 'Transactions', breadcrumb: 'Help Center / Transactions / Cash Transactions', definition: 'Cash Transactions records deposits, withdrawals, fees, interest, and transfers separately from trade performance.', formula: 'Net cash flow = Deposits + interest + transfers − withdrawals − fees', formulaExample: 'Separating cash flow from trading P/L prevents deposits from being mistaken for trading profit.' },
    transactionMomentum: { id: 'transactionMomentum', title: 'What is Transaction Momentum?', category: 'Transactions', breadcrumb: 'Help Center / Transactions / Transaction Momentum', definition: 'Transaction Momentum visualises cumulative capital movements and their trend over time.', formula: 'Cumulative cash flow = Running sum of recorded cash transactions', formulaExample: 'Use it to understand balance changes that were caused by funding rather than trades.' },

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
    complianceEquity: {
        id: 'complianceEquity',
        title: 'What is Compliant vs Non-Compliant Equity?',
        category: 'Rules Compliance',
        breadcrumb: 'Help Center / Rules Compliance / Equity Split',
        definition: 'Two cumulative P&L curves: trades with ≥80% rule compliance (Grades A & B) versus trades below 80% (Grades C, D & F).',
        formula: 'Compliant equity = running sum of P&L for trades with adherence ≥ 80%',
        formulaExample: 'Example: compliant trades +R3,450 while non-compliant trades -R1,200.',
        whyMisleading: {
            intro: 'Small samples can mislead — a few lucky off-plan wins do not prove anything.',
            examples: [
                'Judge the split over 30+ graded trades, not a single week.',
            ],
        },
        howItHelps: [
            {
                title: '1. Proves discipline pays',
                points: [
                    'Visually demonstrates that breaking rules bleeds profits over time.',
                    'Makes the cost of deviation impossible to ignore.',
                ],
            },
        ],
    },
    winRateByGrade: {
        id: 'winRateByGrade',
        title: 'What is Win Rate by Execution Grade?',
        category: 'Rules Compliance',
        breadcrumb: 'Help Center / Rules Compliance / Win Rate by Grade',
        definition: 'Win-rate percentage broken down by execution grade (A, B, C–D, F). Grade measures rule-following only — never profitability.',
        formula: 'Grade win rate = Wins in grade ÷ Completed trades in grade',
        formulaExample: 'Example: Grade A trades win 68% of the time; Grade F trades win 18%.',
        whyMisleading: {
            intro: 'Grades need volume to be meaningful.',
            examples: [
                'A grade bucket with fewer than 5 trades has no statistical weight.',
            ],
        },
        howItHelps: [
            {
                title: '1. Links process to outcome',
                points: [
                    'Shows that following rules raises win rate, independent of market conditions.',
                    'Justifies the checklist habit with your own data.',
                ],
            },
        ],
    },
    disciplineTrend: {
        id: 'disciplineTrend',
        title: 'What is the Discipline Trend?',
        category: 'Rules Compliance',
        breadcrumb: 'Help Center / Rules Compliance / Discipline Trend',
        definition: 'Weekly average rule-compliance % plotted against cumulative account growth.',
        formula: 'Weekly compliance = mean adherence of that week’s graded trades',
        formulaExample: 'Example: compliance climbs from 62% to 88% while equity recovers.',
        whyMisleading: {
            intro: 'Holiday weeks with 1–2 trades swing the average wildly.',
            examples: [
                'Focus on the multi-week slope, not single-week spikes.',
            ],
        },
        howItHelps: [
            {
                title: '1. Tracks whether you are improving',
                points: [
                    'Shows if discipline is improving or degrading as the account grows.',
                    'Early warning when compliance slips before drawdown follows.',
                ],
            },
        ],
    },
    costOfMistakes: {
        id: 'costOfMistakes',
        title: 'What is the Cost of Mistakes?',
        category: 'Rules Compliance',
        breadcrumb: 'Help Center / Rules Compliance / Cost of Mistakes',
        definition: 'Net P&L grouped by violation tag (Revenge Trade, Moved Stop Loss, FOMO / Early Entry, Over-leveraged), ranked by financial damage.',
        formula: 'Violation cost = Sum of P&L for completed trades carrying the tag',
        formulaExample: 'Example: Revenge trades cost -R1,450 across 6 trades this month.',
        whyMisleading: {
            intro: 'A tag only counts when you tag honestly at review time.',
            examples: [
                'Untagged violations hide in the totals — review every trade in the Rules tab.',
            ],
        },
        howItHelps: [
            {
                title: '1. Prices every bad habit',
                points: [
                    'Puts an exact money figure on each mistake, ranked worst-first.',
                    'The most expensive row is your #1 thing to fix next.',
                ],
            },
        ],
    },
    ruleLeakage: {
        id: 'ruleLeakage',
        title: 'What is Rule Leakage Analysis?',
        category: 'Rules Compliance',
        breadcrumb: 'Help Center / Rules Compliance / Rule Leakage',
        definition: 'Per-rule fail-rate: the % of graded trades where each checklist item was left unchecked, grouped by trade phase.',
        formula: 'Rule fail-rate = Trades with rule unchecked ÷ Trades graded against this template',
        formulaExample: 'Example: "Wait for 15m candle close" failed in 32% of trades.',
        whyMisleading: {
            intro: 'Only trades graded against the current template count.',
            examples: [
                'Rules added recently have smaller samples — give them time.',
            ],
        },
        howItHelps: [
            {
                title: '1. Pinpoints what to train',
                points: [
                    'The top of this list is exactly which part of your strategy needs psychological work.',
                    'Fix one leaking rule at a time, starting with pre-entry.',
                ],
            },
        ],
    },
    strategyRulesChecklists: {
        id: 'strategyRulesChecklists',
        title: 'What are Strategy Rules & Checklists?',
        category: 'Discipline',
        breadcrumb: 'Help Center / Discipline / Strategy Rules & Checklists',
        definition: 'Your personal rulebook, split into three trade phases. Every rule you add here appears as a checkbox on each trade (Rules tab), and your checks produce an adherence % and an execution grade (A–F) that is completely decoupled from profit and loss.',
        formula: 'Adherence = checked rules ÷ total rules. A = 100%, B = 80–99%, C = 70–79%, D = 60–69%, F = below 60%.',
        formulaExample: 'Example: 4 of 5 rules checked = 80% adherence = Grade B — even if the trade lost money.',
        whyMisleading: {
            intro: 'A checklist only works if it mirrors your real strategy.',
            examples: [
                'Too many rules: more than ~10 rules turns the checklist into a chore you skip.',
                'Vague rules: "trade well" cannot be checked honestly — write rules you can answer yes/no.',
            ],
        },
        howItHelps: [
            {
                title: '1. Pre-Entry Checks — verification before opening',
                points: [
                    'Confirm the setup before risking money: trend alignment, candle closes, risk-to-reward, news blackout.',
                    'Examples: "15m candle closed above the level?", "Risk-to-Reward ≥ 1:2?", "No high-impact news within 30 min?"',
                ],
            },
            {
                title: '2. In-Trade Management — execution steps',
                points: [
                    'Lock in risk discipline while the trade is live: stops placed, size respected, no tampering.',
                    'Examples: "Stop loss placed immediately?", "Risked ≤ 1% of account?"',
                ],
            },
            {
                title: '3. Post-Trade Review — reflection questions',
                points: [
                    'Score yourself honestly after the trade: exit plan followed, emotions in check.',
                    'Examples: "Did I follow my exit plan?", "No FOMO or impulse to tamper with the trade?"',
                ],
            },
        ],
    },
};

const ADDITIONAL_GUIDANCE: Record<string, Pick<WidgetHelpArticle, 'whyMisleading' | 'howItHelps'>> = {
    symbolPerformance: {
        whyMisleading: { intro: 'A pair can look strong or weak because of a few unusual trades, market conditions, or different position sizes.', examples: ['Compare trade count as well as P/L before favouring a symbol.', 'Review expectancy and drawdown; a profitable pair can still be volatile.'] },
        howItHelps: [{ title: '1. Refines your watchlist', points: ['Identify pairs where your setup has been most consistent.', 'Flag symbols that need a rule review, smaller size, or a pause.'] }],
    },
    largestWinLoss: {
        whyMisleading: { intro: 'Extreme single trades can distort your perception of normal performance.', examples: ['A large win may be an outlier rather than a repeatable setup.', 'A large loss may signal a process failure, not just normal variance.'] },
        howItHelps: [{ title: '1. Reviews execution extremes', points: ['Open the underlying trades and check entry, size, stop, and exit decisions.', 'Use the long versus short result to reveal directional bias.'] }],
    },
    outcomeDistribution: {
        whyMisleading: { intro: 'Win frequency alone does not determine profitability.', examples: ['A high win rate can lose money when losses are much larger than wins.', 'Break-even trades can hide costs or early exits when viewed without P/L.'] },
        howItHelps: [{ title: '1. Balances probability and payoff', points: ['Pair it with Risk/Reward and Profit Factor.', 'Track whether changes to your process improve the mix of outcomes.'] }],
    },
    riskReward: {
        whyMisleading: { intro: 'A high ratio is only useful when it is supported by a realistic win rate and consistent execution.', examples: ['A single oversized win can inflate the ratio.', 'A good ratio does not compensate for ignoring stops or over-sizing.'] },
        howItHelps: [{ title: '1. Tests your trade economics', points: ['Compare the ratio with win rate to assess expectancy.', 'Use it to spot whether winners are cut too early or losses are allowed to run.'] }],
    },
    netProfit: {
        whyMisleading: { intro: 'Net P/L is the outcome, but it does not show the risk, consistency, or sample size that produced it.', examples: ['A positive result driven by one trade may not be repeatable.', 'A losing period can still contain sound execution during normal variance.'] },
        howItHelps: [{ title: '1. Keeps the score', points: ['Track whether the account is progressing over the selected period.', 'Review it with drawdown, Profit Factor, and trade count before changing a strategy.'] }],
    },
    timeAnalysis: {
        whyMisleading: { intro: 'Time slots with few trades can appear unusually good or bad by chance.', examples: ['News events can skew a day-hour cell.', 'Your availability may influence the result as much as the market session.'] },
        howItHelps: [{ title: '1. Improves timing discipline', points: ['Focus preparation on time windows with repeatable results.', 'Use weak periods to set filters or reduce activity rather than forcing trades.'] }],
    },
    strategyPerformance: {
        whyMisleading: { intro: 'Strategy tags are only as reliable as the labels recorded in the journal.', examples: ['Inconsistent tagging can split the same setup across multiple groups.', 'A strategy with few trades needs more evidence before it is scaled.'] },
        howItHelps: [{ title: '1. Allocates attention to the right setups', points: ['Compare strategies using P/L, sample size, and drawdown.', 'Review losing strategies for market-condition or execution patterns.'] }],
    },
    tradingMistakes: {
        whyMisleading: { intro: 'A low count can mean mistakes were not recorded, rather than that they did not occur.', examples: ['One severe mistake can matter more than several minor ones.', 'A mistake that wins still deserves review if it broke your process.'] },
        howItHelps: [{ title: '1. Turns journaling into corrective action', points: ['Prioritise the most frequent or costly mistakes.', 'Create one specific prevention rule and measure whether recurrence falls.'] }],
    },
    detailedReport: {
        whyMisleading: { intro: 'A report is a summary, so individual metrics should be interpreted together rather than in isolation.', examples: ['Strong profit with a deep drawdown may not fit your risk tolerance.', 'A short reporting period may not represent the strategy’s long-term behaviour.'] },
        howItHelps: [{ title: '1. Runs a complete review', points: ['Use it for weekly or monthly performance reviews.', 'Record one strength, one weakness, and one next action from the report.'] }],
    },
    marketSessions: {
        whyMisleading: { intro: 'Session results can be affected by trade frequency, news, and the way sessions are assigned.', examples: ['A session with few trades can look exceptional by chance.', 'Overlap activity may differ because of volatility, not necessarily better execution.'] },
        howItHelps: [{ title: '1. Matches your schedule to your edge', points: ['Compare sessions using P/L, win rate, and trade count.', 'Use the result to focus your preparation and avoid weak windows.'] }],
    },
    hourlyPerformance: {
        whyMisleading: { intro: 'Hourly patterns need enough trades and should be read in your configured timezone.', examples: ['A single event can distort one hour.', 'A profitable hour can be caused by a particular strategy rather than the time itself.'] },
        howItHelps: [{ title: '1. Identifies productive hours', points: ['Set alerts or a trading routine around repeatable high-quality periods.', 'Review weak hours for fatigue, liquidity, or rule-following issues.'] }],
    },
    dailyActivity: {
        whyMisleading: { intro: 'Day-of-week results can reflect different trade counts and market events rather than a true weekday effect.', examples: ['One large Friday loss can dominate the weekly picture.', 'Avoid dropping a day until the sample is meaningful.'] },
        howItHelps: [{ title: '1. Finds weekly patterns', points: ['Plan attention and risk around consistently strong or weak days.', 'Combine it with session and time analysis before changing availability.'] }],
    },
    comparison: {
        whyMisleading: { intro: 'Two lines can finish at the same value while carrying very different risk and consistency.', examples: ['A smoother equity path may be easier to execute than a volatile one.', 'Groups with different trade counts should not be judged by P/L alone.'] },
        howItHelps: [{ title: '1. Compares quality, not only totals', points: ['Compare final P/L, path, drawdown, and sample size.', 'Use it to decide which pair, strategy, or session deserves deeper review.'] }],
    },
    cashTransactions: {
        whyMisleading: { intro: 'Cash movements change balance but are not trading performance.', examples: ['A deposit can make equity growth look stronger than the trading result.', 'A withdrawal does not mean the strategy lost money.'] },
        howItHelps: [{ title: '1. Keeps capital and performance separate', points: ['Reconcile account balance changes accurately.', 'Review trading P/L independently from funding decisions.'] }],
    },
    transactionMomentum: {
        whyMisleading: { intro: 'A rising capital-flow line does not show whether the trading strategy is profitable.', examples: ['Repeated deposits can mask a negative trading result.', 'Large one-off transactions can dominate the trend.'] },
        howItHelps: [{ title: '1. Understands account funding', points: ['Review when and why capital entered or left the account.', 'Keep funding decisions separate from strategy performance reviews.'] }],
    },
};

Object.entries(ADDITIONAL_GUIDANCE).forEach(([id, guidance]) => {
    Object.assign(WIDGET_HELP_DATABASE[id], guidance);
});

Object.assign(WIDGET_HELP_DATABASE, {
    improveProfitFactor: {
        id: 'improveProfitFactor',
        title: 'How to Improve Profit Factor',
        category: 'Improvement Playbooks',
        breadcrumb: 'Help Center / Improvement Playbooks / Profit Factor',
        definition: 'Use this playbook when gross losses are consuming too much of your gross profit. The aim is to improve trade quality and loss control, not simply to trade more often.',
        formula: 'Profit Factor = Gross Profit ÷ Gross Loss',
        formulaExample: 'A Profit Factor above 1.0 is profitable; focus on improving it with repeatable process changes.',
        howItHelps: [
            { title: '1. Review your losing trades', points: ['Tag the reason for each loss: valid setup, early entry, late entry, no stop, or rule break.', 'Separate normal strategy losses from avoidable execution losses.'] },
            { title: '2. Protect winning trades', points: ['Compare average win with average loss to see whether winners are cut too early.', 'Keep a consistent exit rule instead of changing targets emotionally.'] },
            { title: '3. Make one testable change', points: ['Choose one filter, such as avoiding low-liquidity hours or off-plan entries.', 'Review the next 20 trades before deciding whether the change worked.'] },
        ],
    },
    reduceDrawdown: {
        id: 'reduceDrawdown',
        title: 'How to Reduce Drawdown',
        category: 'Improvement Playbooks',
        breadcrumb: 'Help Center / Improvement Playbooks / Drawdown',
        definition: 'Use this playbook when losses are clustering or the account is taking too long to recover. Its purpose is to slow the damage while you identify the cause.',
        formula: 'Drawdown = (Peak Equity − Current Equity) ÷ Peak Equity × 100',
        formulaExample: 'A smaller drawdown needs less recovery profit and gives you more room to execute calmly.',
        howItHelps: [
            { title: '1. Add a circuit breaker', points: ['Set a maximum loss per day and per week.', 'Stop trading when the limit is reached; review rather than trying to win it back.'] },
            { title: '2. Reduce exposure during a losing run', points: ['Lower position size after a predefined number of losses.', 'Avoid adding correlated positions that can lose together.'] },
            { title: '3. Diagnose before resuming full size', points: ['Review whether losses came from market conditions, setup quality, or discipline.', 'Return to normal size only after your process is being followed consistently.'] },
        ],
    },
    stopOvertrading: {
        id: 'stopOvertrading',
        title: 'How to Stop Overtrading',
        category: 'Improvement Playbooks',
        breadcrumb: 'Help Center / Improvement Playbooks / Overtrading',
        definition: 'Use this playbook when trade count rises without a matching improvement in quality, or when you enter trades from boredom, fear of missing out, or a desire to recover losses.',
        formula: 'Quality trade rate = Trades that met your plan ÷ Total trades × 100',
        formulaExample: 'More trades do not create an edge; only trades that meet your tested rules do.',
        howItHelps: [
            { title: '1. Set entry limits before the session', points: ['Define your maximum number of trades and valid setup types.', 'Require a written reason or checklist before every entry.'] },
            { title: '2. Remove emotional triggers', points: ['Take a timed break after a loss or missed trade.', 'Do not increase size to recover a loss or chase a move.'] },
            { title: '3. Measure compliance', points: ['Review Plan Adherence and Trading Mistakes after each session.', 'Track how many trades would have been avoided by following your rules.'] },
        ],
    },
    improvePlanAdherence: {
        id: 'improvePlanAdherence',
        title: 'How to Improve Plan Adherence',
        category: 'Improvement Playbooks',
        breadcrumb: 'Help Center / Improvement Playbooks / Plan Adherence',
        definition: 'Use this playbook when your journal shows that deviations from your plan are reducing performance. The objective is to make following the plan easier than breaking it.',
        formula: 'Plan adherence rate = Trades followed exactly ÷ Total trades × 100',
        formulaExample: 'Review P/L by Plan Adherence to see the financial cost of minor and major deviations.',
        howItHelps: [
            { title: '1. Make the plan observable', points: ['Turn every entry rule into a short yes/no checklist.', 'Define invalidation, stop, target, and maximum size before entering.'] },
            { title: '2. Record deviations honestly', points: ['Tag every deviation immediately after the trade.', 'Describe the trigger: impatience, fear, revenge, news, or distraction.'] },
            { title: '3. Build accountability', points: ['Set one adherence target for the week, such as no entries without a checklist.', 'Review the result weekly and adjust one process step at a time.'] },
        ],
    },
});

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
