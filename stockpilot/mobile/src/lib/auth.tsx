import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { startLocal, wipeLocal, type LocalHandle } from '@/local/api';

import { api, SERVER_ENABLED, setAuthToken, setLocalApi, setUnauthorizedHandler } from './api';
import { hasProOnThisDevice, identifyPurchaser, resetPurchaser } from './purchases';
import { tokenStore } from './token-store';
import type { User } from './types';

const TOKEN_KEY = 'stockpilot.token';
const MODE_KEY = 'stockpilot.mode'; // "local": on-phone mode, no account

let localHandle: LocalHandle | null = null;

interface AuthState {
  ready: boolean;
  user: User | null;
  signIn: (email: string, password: string, mode: 'login' | 'register') => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (u: User) => void;
  /** On-phone mode: everything runs on the device, no account or server needed. */
  local: boolean;
  startOnPhone: () => Promise<void>;
  /** On-phone mode only: try the app as a Free or Pro user. */
  setLocalPlan: (plan: 'free' | 'pro') => Promise<void>;
  /** On-phone mode only: delete everything stored on this phone. */
  wipeOnPhone: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [local, setLocal] = useState(false);

  const enterLocal = useCallback(async () => {
    localHandle = await startLocal();
    setLocalApi(localHandle.api);
    setLocal(true);
    setUser(await api.me());
    // No server: Google Play (through RevenueCat) says whether this phone has Pro.
    const pro = await hasProOnThisDevice();
    if (pro !== null && localHandle) {
      localHandle.setPlan(pro ? 'pro' : 'free');
      setUser(await api.me());
    }
  }, []);

  const signOut = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    setLocalApi(null);
    localHandle = null;
    setLocal(false);
    await tokenStore.remove(TOKEN_KEY);
    await tokenStore.remove(MODE_KEY); // on-phone data stays; "Try without an account" opens it again
    await resetPurchaser();
  }, []);

  const startOnPhone = useCallback(async () => {
    await tokenStore.set(MODE_KEY, 'local');
    await enterLocal();
  }, [enterLocal]);

  const setLocalPlan = useCallback(async (plan: 'free' | 'pro') => {
    localHandle?.setPlan(plan);
    setUser(await api.me());
  }, []);

  const wipeOnPhone = useCallback(async () => {
    await wipeLocal();
    await enterLocal();
  }, [enterLocal]);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    (async () => {
      try {
        // A build without a server always runs on the phone; otherwise the seller chose it.
        if (!SERVER_ENABLED || (await tokenStore.get(MODE_KEY)) === 'local') {
          await enterLocal();
          return;
        }
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
  }, [signOut, enterLocal]);

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
    () => ({ ready, user, signIn, signOut, refreshUser, setUser, local, startOnPhone, setLocalPlan, wipeOnPhone }),
    [ready, user, signIn, signOut, refreshUser, local, startOnPhone, setLocalPlan, wipeOnPhone],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
