"use client";

// ============================================================
// AppTopBar — 60px workspace header: nav toggle (mobile),
// global search → Students search (existing capability),
// consultant avatar. No fake functionality.
// ============================================================

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AppTopBar({ onMenuToggle }: { onMenuToggle: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/students?q=${encodeURIComponent(q)}` : "/students");
  };

  return (
    <header className="sticky top-0 z-30 h-[60px] bg-white border-b border-dvivid-border flex items-center gap-3 px-4 md:px-6">
      <button
        className="lg:hidden p-2 -ml-1 rounded-input text-dvivid-text-secondary hover:bg-dvivid-surface-alt"
        onClick={onMenuToggle}
        aria-label="Open navigation"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Global search — routes to Students search (existing capability) */}
      <form onSubmit={submitSearch} className="flex-1 max-w-md" role="search">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dvivid-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search students, applications, or documents..."
            aria-label="Search"
            className="w-full h-9 pl-9 pr-3 rounded-input border border-dvivid-border bg-dvivid-surface-alt text-sm text-dvivid-text-primary placeholder-dvivid-text-muted focus:outline-none focus:bg-white focus:ring-2 focus:ring-dvivid-primary/15 focus:border-dvivid-primary transition-colors"
          />
        </div>
      </form>

      <div className="ml-auto flex items-center gap-3">
        {/* Login disabled — brand initials stand in for the profile menu */}
        <div
          className="w-8 h-8 rounded-full bg-dvivid-primary-light flex items-center justify-center"
          title="D-Vivid Consultant"
          aria-label="Consultant account"
        >
          <span className="text-xs font-semibold text-dvivid-primary">DC</span>
        </div>
      </div>
    </header>
  );
}
