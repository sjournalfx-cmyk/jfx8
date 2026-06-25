import { describe, expect, it } from 'vitest';
import { Trade } from '../types';
import { calculateDisciplineScore, getDisciplineScoreLabel } from './disciplineScore';

const createTrade = (planAdherence?: Trade['planAdherence']): Trade => ({
    id: `${planAdherence || 'no-plan'}-trade`,
    pair: 'EURUSD',
    assetType: 'Forex',
    date: '2026-06-01',
    time: '09:00',
    session: 'London',
    direction: 'Long',
    entryPrice: 1.1,
    exitPrice: 1.11,
    stopLoss: 1.09,
    takeProfit: 1.12,
    lots: 1,
    result: 'Win',
    pnl: 10,
    rr: 2,
    rating: 3,
    tags: [],
    notes: '',
    emotions: [],
    planAdherence,
    tradingMistake: '',
    mindset: '',
    exitComment: '',
    openTime: '',
    closeTime: '',
    beforeScreenshot: null,
    afterScreenshot: null,
});

describe('calculateDisciplineScore', () => {
    it('uses the shared adherence weights for all consumers', () => {
        const score = calculateDisciplineScore([
            createTrade('Followed Exactly'),
            createTrade('Minor Deviation'),
            createTrade('Major Deviation'),
            createTrade('No Plan'),
        ]);

        expect(score).toBe(55);
    });

    it('returns null when there are no trades', () => {
        expect(calculateDisciplineScore([])).toBeNull();
    });
});

describe('getDisciplineScoreLabel', () => {
    it('maps score bands consistently', () => {
        expect(getDisciplineScoreLabel(95)).toBe('Excellent');
        expect(getDisciplineScoreLabel(80)).toBe('Good');
        expect(getDisciplineScoreLabel(65)).toBe('Developing');
        expect(getDisciplineScoreLabel(45)).toBe('Needs Work');
    });
});
