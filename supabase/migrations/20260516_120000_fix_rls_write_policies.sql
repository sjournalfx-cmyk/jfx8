-- Fix RLS gaps for client-side writes
-- The app upserts profiles during onboarding/settings saves and inserts audit log rows for activity tracking.

-- Profiles: allow authenticated users to create and update their own row
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'profiles'
          AND policyname = 'Users can insert their own profile'
    ) THEN
        CREATE POLICY "Users can insert their own profile" ON public.profiles
            FOR INSERT
            WITH CHECK (auth.uid() = id);
    END IF;
END
$$;

-- Audit logs: allow authenticated users to write their own activity rows
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'audit_logs'
          AND policyname = 'Users can insert their own logs'
    ) THEN
        CREATE POLICY "Users can insert their own logs" ON public.audit_logs
            FOR INSERT
            WITH CHECK (auth.uid() = user_id);
    END IF;
END
$$;
