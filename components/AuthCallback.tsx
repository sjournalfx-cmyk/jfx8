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

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const oauthError = params.get('error_description') || params.get('error');
        // Clear the URL immediately so a re-mount never reuses the single-use code.
        window.history.replaceState({}, '', '/auth/callback');
        if (oauthError) {
          throw new Error(oauthError);
        }
        if (!code) {
          throw new Error('No authorization code returned. Please try signing in again.');
        }
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;
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

  return (
    <div className="min-h-dvh w-full bg-[#000000] text-white flex flex-col items-center justify-center p-6 gap-4">
      <div className="w-8 h-8 border-2 border-white/20 border-t-[#FF4F01] rounded-full animate-spin" />
      <p className="text-sm font-bold text-zinc-400">Signing you in with Google&hellip;</p>
    </div>
  );
};

export default AuthCallback;
