import { createContext, useContext, useEffect, useState, ReactNode, useRef } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const ADMIN_BYPASS_KEY = 'cortex_admin_bypass';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null; session: Session | null }>;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  resendConfirmation: (email: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (password: string) => Promise<{ error: AuthError | null }>;
  enableAdminBypass: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const applySession = (next: Session | null) => {
      if (!active) return;
      if (previousUserId.current !== (next?.user.id ?? null)) queryClient.clear();
      previousUserId.current = next?.user.id ?? null;
      setSession(next);
      setUser(next?.user ?? null);
      setLoading(false);
    };
    localStorage.removeItem(ADMIN_BYPASS_KEY);
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        receivedEvent = true;
        applySession(session);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!receivedEvent) applySession(session);
    }).catch(() => { if (!receivedEvent) applySession(null); });

    return () => { active = false; subscription.unsubscribe(); };
  }, [queryClient]);

  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl
      }
    });
    return { error, session: data.session };
  };

  // https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
  const resetPassword = async (email: string) => supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth?mode=recovery`,
  });
  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error };
  };
  const resendConfirmation = async (email: string) => {
    const { error } = await supabase.auth.resend({type:'signup',email,options:{emailRedirectTo:`${window.location.origin}/`}});
    return {error};
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
        // Env reads live INSIDE the DEV branch so the inlined credential
        // strings are guaranteed dead-code-eliminated from production bundles.
        const bypassEmail    = import.meta.env.VITE_BYPASS_EMAIL    ?? '';
        const bypassPassword = import.meta.env.VITE_BYPASS_PASSWORD ?? '';
        if (!bypassEmail || !bypassPassword) {
          console.warn('Admin bypass: set VITE_BYPASS_EMAIL and VITE_BYPASS_PASSWORD in .env.local');
          return;
        }
        const { error } = await supabase.auth.signInWithPassword({
          email: bypassEmail,
          password: bypassPassword,
        });
        if (error) {
          throw error;
        }
      }
    : async () => {
        // Completely inert in production — Vite dead-code-eliminates this entire branch.
        console.warn('Admin bypass is not available in production builds.');
      };

  const signOut = async () => {
    localStorage.removeItem(ADMIN_BYPASS_KEY);
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    queryClient.clear();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        signUp,
        signIn,
        resetPassword,
        resendConfirmation,
        updatePassword,
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
