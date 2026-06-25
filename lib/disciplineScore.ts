import { Trade } from '../types';

const DISCIPLINE_SCORE_BY_ADHERENCE: Record<string, number> = {
    'Followed Exactly': 100,
    'Minor Deviation': 78,
    'Major Deviation': 30,
    'No Plan': 10,
};

export const calculateDisciplineScore = (trades: Trade[] = []) => {
    if (!trades.length) return null;

    const total = trades.reduce((sum, trade) => {
        const adherence = trade.planAdherence || 'No Plan';
        return sum + (DISCIPLINE_SCORE_BY_ADHERENCE[adherence] ?? 55);
    }, 0);

    return Math.round(total / trades.length);
};

export const getDisciplineScoreLabel = (score: number) => {
    if (score >= 90) return 'Excellent';
    if (score >= 75) return 'Good';
    if (score >= 60) return 'Developing';
    return 'Needs Work';
};
