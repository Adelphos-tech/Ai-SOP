"use client";
import { useEffect, useState } from "react";
import { AppSidebar, AppSidebarMobile } from "./AppSidebar";
import { AppTopBar } from "./AppTopBar";

/**
 * Stale-client refresh notice.
 * Detects when the browser has an older build than the server by checking
 * the Server Action manifest. If a Server Action lookup fails (common after
 * a deployment), shows a non-intrusive banner prompting the user to refresh.
 */
function StaleClientNotice() {
  const [showNotice, setShowNotice] = useState(false);

  useEffect(() => {
    // Listen for Server Action errors that indicate a stale client
    const handleError = (event: ErrorEvent) => {
      const msg = event.message || event.error?.message || "";
      if (
        msg.includes("Failed to find Server Action") ||
        msg.includes("Cannot read properties of undefined (reading 'workers')")
      ) {
        setShowNotice(true);
      }
    };
    window.addEventListener("error", handleError);
    return () => window.removeEventListener("error", handleError);
  }, []);

  if (!showNotice) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-dvivid-primary text-white rounded-lg shadow-lg px-4 py-3 flex items-center gap-3">
      <span className="text-sm">A new version of D-Vivid is available.</span>
      <button
        className="text-sm font-semibold underline whitespace-nowrap"
        onClick={() => window.location.reload()}
      >
        Refresh
      </button>
      <button
        className="text-white/70 hover:text-white text-lg leading-none"
        onClick={() => setShowNotice(false)}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-dvivid-page-bg">
      <AppSidebar />
      <AppSidebarMobile open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex-1 min-w-0 flex flex-col">
        <AppTopBar onMenuToggle={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
      <StaleClientNotice />
    </div>
  );
}
