import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AuthCallbackProps {
  onSuccess: () => void;
}

/**
 * Handles the return from Supabase Google OAuth at /auth/callback.
 * Exchanges the ?code= for a session (PKCE) and hands off to the
 * normal login flow. Distinct from the cTrader ?code= flow at /.
 */
const AuthCallback: React.FC<AuthCallbackProps> = ({ onSuccess }) => {
  const [error, setError] = useState<string | null>(null);
  const [nativeBounceUrl, setNativeBounceUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        // 1. If a session is already established, succeed immediately
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        if (initialSession?.user) {
          if (!cancelled) onSuccess();
          return;
        }

        const searchParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const code = searchParams.get('code') || hashParams.get('code');
        const oauthError = searchParams.get('error_description') || 
                           searchParams.get('error') || 
                           hashParams.get('error_description') || 
                           hashParams.get('error');

        // Check for mobile bounce
        const isNative = searchParams.get('native') === '1' || searchParams.get('mobile') === '1';
        if (isNative) {
          const bounceUrl = code
            ? `site.jfxjournal.app://auth-callback?code=${encodeURIComponent(code)}`
            : `site.jfxjournal.app://auth-callback?error=${encodeURIComponent(oauthError || 'Authentication failed')}`;
          
          setNativeBounceUrl(bounceUrl);
          try {
            window.location.href = bounceUrl;
          } catch (err) {
            console.warn('Auto-redirect to app failed, user can tap manual button', err);
          }
          return;
        }

        if (oauthError) {
          throw new Error(oauthError);
        }

        if (!code) {
          // Double check session in case it arrived asynchronously
          const { data: { session: retrySession } } = await supabase.auth.getSession();
          if (retrySession?.user) {
            if (!cancelled) onSuccess();
            return;
          }
          throw new Error('No authorization code returned. Please try signing in again.');
        }

        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          // Verify if session exists despite exchange error
          const { data: { session: postErrorSession } } = await supabase.auth.getSession();
          if (postErrorSession?.user) {
            window.history.replaceState({}, '', '/auth/callback');
            if (!cancelled) onSuccess();
            return;
          }
          throw exchangeError;
        }

        window.history.replaceState({}, '', '/auth/callback');
        if (!cancelled) onSuccess();
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Sign-in failed. Please try again.');
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [onSuccess]);

  if (error) {
    return (
      <div className="min-h-dvh w-full bg-[#000000] text-white flex items-center justify-center p-6">
        <div className="w-full max-w-[420px] text-center">
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center gap-3 text-rose-500 text-sm font-bold mb-6">
            <AlertCircle size={18} />
            {error}
          </div>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-8 py-3 bg-[#FF4F01] hover:bg-[#E64601] text-white rounded-2xl font-black text-[13px] transition-all"
          >
            Back to sign in
          </a>
          <p className="mt-8 text-xs text-zinc-500">
            By continuing you agree to our{' '}
            <a href="/terms" className="underline hover:text-zinc-300">Terms of Service</a>
            {' '}and{' '}
            <a href="/privacy" className="underline hover:text-zinc-300">Privacy Policy</a>.
          </p>
        </div>
      </div>
    );
  }

  if (nativeBounceUrl) {
    return (
      <div className="min-h-dvh w-full bg-[#000000] text-white flex flex-col items-center justify-center p-6 gap-6 text-center">
        <div className="w-10 h-10 border-2 border-white/20 border-t-[#FF4F01] rounded-full animate-spin" />
        <div>
          <h2 className="text-xl font-black">Returning to JFX Journal</h2>
          <p className="mt-2 text-sm text-zinc-400">If the app does not open automatically, tap below:</p>
        </div>
        <a
          href={nativeBounceUrl}
          className="inline-flex items-center gap-2 px-8 py-3.5 bg-[#FF4F01] hover:bg-[#E64601] text-white rounded-2xl font-black text-sm shadow-lg shadow-[#FF4F01]/25 transition-all"
        >
          Open JFX Journal App
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-dvh w-full bg-[#000000] text-white flex flex-col items-center justify-center p-6 gap-4">
      <div className="w-8 h-8 border-2 border-white/20 border-t-[#FF4F01] rounded-full animate-spin" />
      <p className="text-sm font-bold text-zinc-400">Signing you in with Google&hellip;</p>
    </div>
  );
};

export default AuthCallback;
