import { useState } from 'react';
import { UserProfile } from '../types';

export type ConnectionMode = 'bridge' | 'broker' | 'ctrader' | null;

export function useConnectionMode(userId: string, userProfile: UserProfile) {
    const [connectionMode, setConnectionMode] = useState<ConnectionMode>(() => {
        const justAuthorized =
            localStorage.getItem('ctrader_just_authorized') === 'true' ||
            sessionStorage.getItem('ctrader_just_authorized') === 'true';
        if (justAuthorized) {
            return 'ctrader';
        }

        // Check if valid cTrader tokens exist in storage
        const hasCtraderTokens = (() => {
            try {
                const raw = localStorage.getItem('jfx_ctrader_tokens') || sessionStorage.getItem('jfx_ctrader_tokens');
                if (!raw) return false;
                const tokens = JSON.parse(raw);
                return Boolean(tokens && tokens.accessToken && (Date.now() < (tokens.expiresAt || Infinity)));
            } catch {
                return false;
            }
        })();

        // Check explicit saved mode preference
        try {
            const savedMode = localStorage.getItem(`jfx_connection_mode_${userId}`);
            if (savedMode === 'none') {
                return null;
            }
            if (savedMode === 'ctrader' && hasCtraderTokens) {
                return 'ctrader';
            }
            if (savedMode === 'bridge' || savedMode === 'broker') {
                return savedMode as 'bridge' | 'broker';
            }
        } catch { /* ignore */ }

        // Default fallback if cTrader is authenticated
        if (hasCtraderTokens) {
            return 'ctrader';
        }

        return userProfile.eaConnected ? 'bridge' : 
            ['connected', 'credentials_stored', 'auth_failed'].includes(userProfile.mt_terminal_status || '') ? 'broker' : null;
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
