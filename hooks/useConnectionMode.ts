import { useState } from 'react';
import { UserProfile } from '../types';
import { hasActiveSession } from '../services/ctraderService';

export type ConnectionMode = 'bridge' | 'ctrader' | null;

export function useConnectionMode(userId: string, userProfile: UserProfile) {
    const [connectionMode, setConnectionMode] = useState<ConnectionMode>(() => {
        const justAuthorized =
            localStorage.getItem('ctrader_just_authorized') === 'true' ||
            sessionStorage.getItem('ctrader_just_authorized') === 'true';
        if (justAuthorized) {
            // The OAuth return path never goes through updateConnectionMode, so
            // persist the choice here — otherwise this flag is consumed once
            // (Bridge clears it on mount) and the next visit falls back to the
            // method-choice screen instead of the cTrader terminal.
            try {
                localStorage.setItem(`jfx_connection_mode_${userId}`, 'ctrader');
            } catch { /* ignore */ }
            return 'ctrader';
        }

        // Check explicit saved mode preference
        try {
            const savedMode = localStorage.getItem(`jfx_connection_mode_${userId}`);
            if (savedMode === 'none') {
                return null;
            }
            if (savedMode === 'ctrader') {
                return 'ctrader';
            }
            if (savedMode === 'bridge') {
                return 'bridge';
            }
        } catch { /* ignore */ }

        // No explicit preference — resume the bridge if the EA is connected,
        // otherwise resume an existing cTrader OAuth session (covers sessions
        // created before mode persistence existed) instead of showing the
        // method-choice screen again.
        if (userProfile.eaConnected) return 'bridge';
        return hasActiveSession() ? 'ctrader' : null;
    });

    const updateConnectionMode = (mode: ConnectionMode) => {
        setConnectionMode(mode);
        try {
            if (mode) {
                localStorage.setItem(`jfx_connection_mode_${userId}`, mode);
            } else {
                localStorage.setItem(`jfx_connection_mode_${userId}`, 'none');
            }
        } catch { /* ignore */ }
    };

    return {
        connectionMode,
        setConnectionMode,
        updateConnectionMode,
    };
}
