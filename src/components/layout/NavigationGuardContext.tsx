"use client";

import { createContext, useContext, useRef, useCallback, ReactNode } from "react";

export type NavigationGuardFn = (href: string) => boolean;

interface NavigationGuardContextValue {
  registerGuard: (fn: NavigationGuardFn) => void;
  unregisterGuard: () => void;
  checkGuard: (href: string) => boolean;
}

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const guardRef = useRef<NavigationGuardFn | null>(null);

  const registerGuard = useCallback((fn: NavigationGuardFn) => {
    guardRef.current = fn;
  }, []);

  const unregisterGuard = useCallback(() => {
    guardRef.current = null;
  }, []);

  const checkGuard = useCallback((href: string): boolean => {
    return guardRef.current ? guardRef.current(href) : true;
  }, []);

  return (
    <NavigationGuardContext.Provider value={{ registerGuard, unregisterGuard, checkGuard }}>
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
