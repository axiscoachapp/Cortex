import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

const ADMIN_BYPASS_KEY = 'cortex_admin_bypass';

const ADMIN_BYPASS_USER: User = {
  id: 'admin-bypass-local',
  email: 'admin@localhost',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
};

const BYPASS_EMAIL = 'test.bypass@cortex-dev.local';
const BYPASS_PASSWORD = 'CortexBypass2026!Dev';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  enableAdminBypass: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminBypass, setAdminBypass] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem(ADMIN_BYPASS_KEY) === '1'
  );

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl
      }
    });
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const enableAdminBypass = async () => {
    localStorage.setItem(ADMIN_BYPASS_KEY, '1');
    setAdminBypass(true);

    // Sign in to Supabase with a test account so RLS-protected queries work
    // on any device/browser without needing a real user session.
    const { error } = await supabase.auth.signInWithPassword({
      email: BYPASS_EMAIL,
      password: BYPASS_PASSWORD,
    });
    if (error) {
      // Account doesn't exist yet — create it, then sign in
      await supabase.auth.signUp({ email: BYPASS_EMAIL, password: BYPASS_PASSWORD });
      await supabase.auth.signInWithPassword({ email: BYPASS_EMAIL, password: BYPASS_PASSWORD });
    }
  };

  const signOut = async () => {
    localStorage.removeItem(ADMIN_BYPASS_KEY);
    setAdminBypass(false);
    await supabase.auth.signOut();
  };

  // In bypass mode: prefer the real Supabase user (so auth.uid() works in RLS);
  // fall back to the fake user only if no session exists yet.
  const effectiveUser = adminBypass ? (user ?? ADMIN_BYPASS_USER) : user;
  const effectiveSession = adminBypass ? null : session;

  return (
    <AuthContext.Provider
      value={{
        user: effectiveUser,
        session: effectiveSession,
        loading,
        signUp,
        signIn,
        enableAdminBypass,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};