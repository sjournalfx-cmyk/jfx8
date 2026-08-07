import { Trade } from '../types';

const DISCIPLINE_SCORE_BY_ADHERENCE: Record<string, number> = {
    'Followed Exactly': 100,
    'Minor Deviation': 78,
    'Major Deviation': 30,
    'No Plan': 10,
};

export const calculateDisciplineScore = (trades: Trade[] = []) => {
    // Only score trades where the user has explicitly set their plan adherence.
    // Auto-synced or untagged trades are excluded to avoid unfairly penalising the score.
    const taggedTrades = trades.filter(t => t.planAdherence != null);
    if (!taggedTrades.length) return null;

    const total = taggedTrades.reduce((sum, trade) => {
        const adherence = trade.planAdherence!;
        return sum + (DISCIPLINE_SCORE_BY_ADHERENCE[adherence] ?? 55);
    }, 0);

    return Math.round(total / taggedTrades.length);
};

export const getDisciplineScoreLabel = (score: number) => {
    if (score >= 90) return 'Excellent';
    if (score >= 75) return 'Good';
    if (score >= 60) return 'Developing';
    return 'Needs Work';
};
