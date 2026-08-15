import { useState } from 'react';
import { UserProfile } from '../types';

export type ConnectionMode = 'bridge' | 'ctrader' | null;

export function useConnectionMode(userId: string, userProfile: UserProfile) {
    const [connectionMode, setConnectionMode] = useState<ConnectionMode>(() => {
        const justAuthorized =
            localStorage.getItem('ctrader_just_authorized') === 'true' ||
            sessionStorage.getItem('ctrader_just_authorized') === 'true';
        if (justAuthorized) {
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

        return userProfile.eaConnected ? 'bridge' : null;
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
