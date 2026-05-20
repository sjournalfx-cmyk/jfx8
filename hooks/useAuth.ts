
import { useState, useEffect, useRef } from 'react';
import { UserProfile } from '../types';
import { authService } from '../services/authService';
import { dataService } from '../services/dataService';
import { supabase } from '../lib/supabase';
import { normalizeThemePreference } from '../lib/theme';
import { normalizePlan } from '../lib/constants';

const AUTH_BOOT_TIMEOUT_MS = 8000;

const withTimeout = <T,>(promise: Promise<T>, label: string, timeoutMs = AUTH_BOOT_TIMEOUT_MS): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
};

export const useAuth = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  const loadUserData = async (userId: string) => {
    try {
      const { data: profile } = await authService.getProfile(userId);
      let mappedProfile: UserProfile | null = null;
      if (profile) {
        const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
        let avatarUrl = profile.avatar_url;
        if (avatarUrl && !avatarUrl.startsWith('http')) {
          avatarUrl = `${supabaseUrl}/storage/v1/object/public/avatars/${avatarUrl}`;
        }

        mappedProfile = {
          name: profile.name || '',
          country: profile.country || '',
          accountName: profile.account_name || 'Primary Account',
          initialBalance: profile.initial_balance || 0,
          currency: profile.currency || 'USD',
          currencySymbol: profile.currency_symbol || '$',
          syncMethod: profile.sync_method || 'Manual',
          experienceLevel: profile.experience_level || 'Beginner',
          tradingStyle: profile.trading_style || 'Day Trader',
          onboarded: profile.onboarded || false,
          plan: normalizePlan(profile.plan),
          syncKey: profile.sync_key,
          eaConnected: profile.ea_connected || false,
          autoJournal: profile.auto_journal || false,
          avatarUrl: avatarUrl,
          themePreference: normalizeThemePreference(profile.theme_preference),
          chartConfig: profile.chart_config || null,
          keepChartsAlive: profile.keep_charts_alive ?? true,
        };
        setUserProfile(mappedProfile);
      }
      return mappedProfile;
    } catch (error) {
      console.error("Error loading user data:", error);
      return null;
    }
  };

  const isInitializing = useRef(false);

  const initApp = async () => {
    if (isInitializing.current) return;
    isInitializing.current = true;
    try {
      const user = await withTimeout(authService.getCurrentUser(), 'Auth bootstrap');
      if (user) {
        setUserId(user.id);
        setIsAuthenticated(true);
        setUserEmail(user.email || '');
        await withTimeout(loadUserData(user.id), 'Profile bootstrap');
      }
    } catch (error) {
      console.error("Failed to initialize app:", error);
    } finally {
      setIsInitialLoading(false);
      isInitializing.current = false;
    }
  };

  useEffect(() => {
    initApp();
  }, []);

  const handleLogout = async () => {
    await authService.signOut();
    setIsAuthenticated(false);
    setUserProfile(null);
    setUserId(null);
    setUserEmail('');
  };

  const handleOnboardingComplete = async (profile: UserProfile) => {
    const normalizedProfile = { ...profile, plan: normalizePlan(profile.plan) };
    setUserProfile(normalizedProfile);
    try {
      await dataService.updateProfile(normalizedProfile);
    } catch (error) {
      console.error("Error saving profile:", error);
      throw error;
    }
  };
  
  const handleUpdateProfile = async (profile: UserProfile) => {
    try {
      const normalizedProfile = { ...profile, plan: normalizePlan(profile.plan) };
      await dataService.updateProfile(normalizedProfile);
      setUserProfile(normalizedProfile);
    } catch (error) {
      console.error("Error updating profile:", error);
      throw error;
    }
  };

  return {
    userId,
    userProfile,
    userEmail,
    isAuthenticated,
    isInitialLoading,
    handleLogout,
    handleOnboardingComplete,
    handleUpdateProfile,
    loadUserData,
    setIsAuthenticated,
    setIsInitialLoading,
    setUserId,
    setUserEmail,
    setUserProfile
  };
};
