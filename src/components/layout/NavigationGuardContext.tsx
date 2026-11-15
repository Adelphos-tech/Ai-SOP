"use client";

import { createContext, useContext, useRef, useCallback, ReactNode } from "react";

export type NavigationGuardFn = (href: string) => boolean;

interface NavigationGuardContextValue {
  registerGuard: (fn: NavigationGuardFn, opts?: { signOut?: boolean }) => void;
  unregisterGuard: () => void;
  checkGuard: (href: string) => boolean;
  checkSignOut: () => boolean;
}

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const guardRef = useRef<NavigationGuardFn | null>(null);

  const signOutRef = useRef(false);

  const registerGuard = useCallback((fn: NavigationGuardFn, opts?: { signOut?: boolean }) => {
    guardRef.current = fn;
    signOutRef.current = opts?.signOut === true;
  }, []);

  const unregisterGuard = useCallback(() => {
    guardRef.current = null;
    signOutRef.current = false;
  }, []);

  const checkGuard = useCallback((href: string): boolean => {
    return guardRef.current ? guardRef.current(href) : true;
  }, []);

  // A guard may refuse now and navigate to href itself later (save first,
  // then leave). That would land on /login still signed in, so only guards
  // that opt in are asked about sign-out.
  const checkSignOut = useCallback((): boolean => {
    return guardRef.current && signOutRef.current ? guardRef.current("/login") : true;
  }, []);

  return (
    <NavigationGuardContext.Provider value={{ registerGuard, unregisterGuard, checkGuard, checkSignOut }}>
      {children}
    </NavigationGuardContext.Provider>
  );
}

export function useNavigationGuard() {
  const ctx = useContext(NavigationGuardContext);
  if (!ctx) {
    throw new Error("useNavigationGuard must be used within NavigationGuardProvider");
  }
  return ctx;
}
