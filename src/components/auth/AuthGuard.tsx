"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";

interface ConsultantInfo {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * Client-side auth guard.
 * Checks /api/auth/me on mount. If not authenticated, redirects to /login.
 * Shows a loading spinner while checking.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [consultant, setConsultant] = useState<ConsultantInfo | null>(null);

  const checkAuth = useCallback(async () => {
    // ===== LOGIN NOT REQUIRED — temporary bypass =====
    // To enable auth: delete this block and uncomment the code below.
    setChecking(false);
    return;
    // ===== END bypass =====

    // // Don't auth-check the login page itself
    // if (pathname === "/login") {
    //   setChecking(false);
    //   return;
    // }
    // try {
    //   const res = await fetch("/api/auth/me");
    //   if (res.status === 401) {
    //     const redirect = encodeURIComponent(pathname || "/");
    //     router.replace(`/login?redirect=${redirect}`);
    //     return;
    //   }
    //   const data = await res.json();
    //   if (data.consultant) {
    //     setConsultant(data.consultant);
    //   }
    // } catch {
    //   router.replace("/login");
    // } finally {
    //   setChecking(false);
    // }
  }, [router, pathname]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dvivid-page-bg">
        <div className="w-8 h-8 border-3 border-dvivid-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Logout button — calls POST /api/auth/session (destroys session)
 * then redirects to /login.
 */
export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    try {
      await fetch("/api/auth/session", { method: "POST" });
    } finally {
      router.replace("/login");
    }
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="text-sm text-dvivid-text-secondary hover:text-dvivid-error transition-colors px-2 py-1"
      title="Sign out"
    >
      {loading ? "..." : "Sign out"}
    </button>
  );
}
