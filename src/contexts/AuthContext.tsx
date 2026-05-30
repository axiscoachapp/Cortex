import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

const ADMIN_BYPASS_KEY = 'cortex_admin_bypass';

// Credentials come from env so they're never hardcoded in source.
// In production builds (import.meta.env.DEV === false) the entire bypass
// code path is eliminated by Vite/Rollup dead-code removal.
const BYPASS_EMAIL    = import.meta.env.VITE_BYPASS_EMAIL    ?? '';
const BYPASS_PASSWORD = import.meta.env.VITE_BYPASS_PASSWORD ?? '';

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

  const enableAdminBypass = import.meta.env.DEV
    ? async () => {
        if (!BYPASS_EMAIL || !BYPASS_PASSWORD) {
          console.warn('Admin bypass: set VITE_BYPASS_EMAIL and VITE_BYPASS_PASSWORD in .env.local');
          return;
        }
        localStorage.setItem(ADMIN_BYPASS_KEY, '1');
        setAdminBypass(true);
        const { error } = await supabase.auth.signInWithPassword({
          email: BYPASS_EMAIL,
          password: BYPASS_PASSWORD,
        });
        if (error) {
          await supabase.auth.signUp({ email: BYPASS_EMAIL, password: BYPASS_PASSWORD });
          await supabase.auth.signInWithPassword({ email: BYPASS_EMAIL, password: BYPASS_PASSWORD });
        }
      }
    : async () => {
        // Completely inert in production — Vite dead-code-eliminates this entire branch.
        console.warn('Admin bypass is not available in production builds.');
      };

  const signOut = async () => {
    localStorage.removeItem(ADMIN_BYPASS_KEY);
    setAdminBypass(false);
    await supabase.auth.signOut();
  };

  const effectiveSession = adminBypass ? null : session;

  return (
    <AuthContext.Provider
      value={{
        user,
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