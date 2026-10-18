import React from 'react';
import type { Trade, UserProfile } from '../../../types';
import { useChecklistTemplates } from '../../../lib/useChecklistTemplates';
import { FeatureGate } from '../../ui/FeatureGate';
import { ComplianceKpis, ComplianceEmptyState } from './ComplianceKpis';
import { ComplianceEquityCurve } from './ComplianceEquityCurve';
import { WinRateByGradeChart } from './WinRateByGradeChart';
import { DisciplineTrendChart } from './DisciplineTrendChart';
import { CostOfMistakesTable } from './CostOfMistakesTable';
import { RuleLeakageList } from './RuleLeakageList';
import { TradingMistakesBarChartWidget } from '../TradingMistakesBarChartWidget';

interface ComplianceViewProps {
  trades: Trade[];
  isDarkMode: boolean;
  currencySymbol: string;
  userProfile: UserProfile | null | undefined;
  onInfoClick?: (id: string) => void;
}

/**
 * Rules Compliance analytics. Answers: "How much money am I making when I
 * follow my rules versus how much am I losing when I break them?"
 *
 * Freemium split: KPI cards are free (the hook); deep charts are Premium
 * via the `complianceAnalytics` plan flag.
 */
export const ComplianceView: React.FC<ComplianceViewProps> = ({
  trades,
  isDarkMode,
  currencySymbol,
  userProfile,
  onInfoClick,
}) => {
  const { activeTemplate } = useChecklistTemplates();
  const hasSnapshots = trades.some((t) => typeof t.adherenceRate === 'number');

  const gateProps = { feature: 'complianceAnalytics' as const, userProfile };

  return (
    <div className="space-y-6 pb-20">
      {/* FREE — the hook */}
      <ComplianceKpis trades={trades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} />

      {!hasSnapshots ? (
        <ComplianceEmptyState isDarkMode={isDarkMode} />
      ) : (
        <>
          {/* PREMIUM — deep analysis */}
          <FeatureGate
            {...gateProps}
            variant="card"
            title="Compliant vs Non-Compliant Equity"
            description="See two equity curves: trades where you followed your rules vs trades where you broke them. Premium only."
          >
            <ComplianceEquityCurve trades={trades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} onInfoClick={onInfoClick ? () => onInfoClick('complianceEquity') : undefined} />
          </FeatureGate>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <FeatureGate
              {...gateProps}
              variant="card"
              title="Win Rate by Execution Grade"
              description="Win rate for Grade A through F. Premium only."
            >
              <WinRateByGradeChart trades={trades} isDarkMode={isDarkMode} onInfoClick={onInfoClick ? () => onInfoClick('winRateByGrade') : undefined} />
            </FeatureGate>
            <FeatureGate
              {...gateProps}
              variant="card"
              title="Discipline Trend"
              description="Weekly compliance % against account growth. Premium only."
            >
              <DisciplineTrendChart trades={trades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} onInfoClick={onInfoClick ? () => onInfoClick('disciplineTrend') : undefined} />
            </FeatureGate>
          </div>

          <FeatureGate
            {...gateProps}
            variant="card"
            title="Cost of Mistakes"
            description="Exactly how much each violation tag has cost you. Premium only."
          >
            <CostOfMistakesTable trades={trades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} onInfoClick={onInfoClick ? () => onInfoClick('costOfMistakes') : undefined} />
          </FeatureGate>

          <FeatureGate
            {...gateProps}
            variant="card"
            title="Rule Leakage Analysis"
            description="Which checklist rules you skip most often, per trade phase. Premium only."
          >
            <RuleLeakageList trades={trades} template={activeTemplate} isDarkMode={isDarkMode} onInfoClick={onInfoClick ? () => onInfoClick('ruleLeakage') : undefined} />
          </FeatureGate>
        </>
      )}

      {/* Free (moved from the removed Advanced tab) — pairs with Cost of Mistakes above */}
      <TradingMistakesBarChartWidget trades={trades} isDarkMode={isDarkMode} onInfoClick={onInfoClick ? () => onInfoClick('tradingMistakes') : undefined} />
    </div>
  );
};
