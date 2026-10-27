import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, setAuthToken, setUnauthorizedHandler } from './api';
import { identifyPurchaser, resetPurchaser } from './purchases';
import { tokenStore } from './token-store';
import type { User } from './types';

const TOKEN_KEY = 'stockpilot.token';

interface AuthState {
  ready: boolean;
  user: User | null;
  signIn: (email: string, password: string, mode: 'login' | 'register') => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const signOut = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    await tokenStore.remove(TOKEN_KEY);
    await resetPurchaser();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    (async () => {
      try {
        const token = await tokenStore.get(TOKEN_KEY);
        if (token) {
          setAuthToken(token);
          const me = await api.me();
          setUser(me);
          await identifyPurchaser(me.id);
        }
      } catch {
        // Expired token or server unreachable: show sign-in.
        setAuthToken(null);
      } finally {
        setReady(true);
      }
    })();
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const signIn = useCallback(async (email: string, password: string, mode: 'login' | 'register') => {
    const res = mode === 'login' ? await api.login(email, password) : await api.register(email, password);
    setAuthToken(res.token);
    await tokenStore.set(TOKEN_KEY, res.token);
    setUser(res.user);
    await identifyPurchaser(res.user.id);
  }, []);

  const refreshUser = useCallback(async () => {
    setUser(await api.me());
  }, []);

  const value = useMemo(
    () => ({ ready, user, signIn, signOut, refreshUser, setUser }),
    [ready, user, signIn, signOut, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
