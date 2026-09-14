"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";

// ============================================================
// LOGIN NOT REQUIRED — temporary bypass
// ============================================================
// The consultant profile / sign-out button is hidden while the
// login module is disabled. To re-enable auth, restore the
// /api/auth/me fetch and the <LogoutButton /> import below.
// ============================================================

const navLinks = [
  { href: "/students", label: "Students" },
  { href: "/applications", label: "Applications" },
];

export function AppHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const initials = "DC";

  return (
    <header className="bg-white border-b border-dvivid-border sticky top-0 z-30" style={{ height: "72px" }}>
      <div className="max-w-[1280px] mx-auto h-full flex items-center justify-between px-4 md:px-8">
        {/* Left: Logo + Title */}
        <div className="flex items-center gap-3">
          <Image src="/dvivid_logo.png" alt="D-Vivid" width={180} height={50} priority />
        </div>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map(link => {
            const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-2 rounded-button text-sm font-medium transition-colors ${
                  active
                    ? "text-dvivid-primary bg-dvivid-primary-light"
                    : "text-dvivid-text-secondary hover:text-dvivid-text-primary hover:bg-dvivid-surface-alt"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Right: Profile (login disabled — showing brand mark only) */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-dvivid-primary-light flex items-center justify-center">
            <span className="text-sm font-semibold text-dvivid-primary">{initials}</span>
          </div>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-2 rounded-button text-dvivid-text-secondary hover:bg-dvivid-surface-alt"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mobileOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
          </svg>
        </button>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <nav className="md:hidden border-t border-dvivid-border bg-white px-4 py-3 space-y-1">
          {navLinks.map(link => {
            const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`block px-4 py-2.5 rounded-button text-sm font-medium ${
                  active ? "text-dvivid-primary bg-dvivid-primary-light" : "text-dvivid-text-secondary hover:bg-dvivid-surface-alt"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
