import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import type { PublicCatalog, UserProfile, UserWorkspace } from '../types';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  workspace: UserWorkspace | null;
  catalog: PublicCatalog | null;
  loadingAuth: boolean;
  loadingData: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshAll: () => Promise<void>;
  apiFetch: <T>(url: string, options?: RequestInit) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [workspace, setWorkspace] = useState<UserWorkspace | null>(null);
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const apiFetch = useCallback(
    async <T,>(url: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers);
      if (!headers.has('Content-Type') && options.body) {
        headers.set('Content-Type', 'application/json');
      }
      const currentUser = auth.currentUser;
      if (currentUser) {
        const token = await currentUser.getIdToken();
        headers.set('Authorization', `Bearer ${token}`);
      }
      const res = await fetch(url, { ...options, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data as T;
    },
    []
  );

  const loadPublicCatalog = useCallback(async () => {
    try {
      const res = await fetch('/api/public/catalog');
      if (res.ok) {
        const data = (await res.json()) as PublicCatalog;
        setCatalog(data);
      }
    } catch (err) {
      console.error('Failed to fetch catalog:', err);
    }
  }, []);

  const loadSession = useCallback(
    async (user: User | null) => {
      if (!user) {
        setProfile(null);
        setWorkspace(null);
        return;
      }
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setProfile(data.user);
          setWorkspace(data.workspace);
          setAuthError(null);
        } else {
          const errBody = await res.json().catch(() => ({}));
          setAuthError(errBody.error || 'Unable to synchronize student profile.');
        }
      } catch (err) {
        console.error('Failed to sync user session:', err);
        setAuthError('Network error while connecting to NUCESPOOL.');
      }
    },
    []
  );

  const refreshAll = useCallback(async () => {
    setLoadingData(true);
    await Promise.all([loadPublicCatalog(), loadSession(auth.currentUser)]);
    setLoadingData(false);
  }, [loadPublicCatalog, loadSession]);

  useEffect(() => {
    loadPublicCatalog().finally(() => setLoadingData(false));
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      await loadSession(user);
      setLoadingAuth(false);
    });
    return () => unsubscribe();
  }, [loadPublicCatalog, loadSession]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
      setAuthError(msg);
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    setProfile(null);
    setWorkspace(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        workspace,
        catalog,
        loadingAuth,
        loadingData,
        authError,
        signInWithGoogle,
        logout,
        refreshAll,
        apiFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
