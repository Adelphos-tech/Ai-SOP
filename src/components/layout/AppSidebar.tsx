"use client";

// ============================================================
// AppSidebar — consultant workspace navigation.
// Compact Linear-style rail: brand mark, primary sections,
// restrained active state. Only routes that exist are listed.
// ============================================================

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const ICONS = {
  students: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87M16 3.13a4 4 0 010 7.75M12 14a4 4 0 100-8 4 4 0 000 8z" />
    </svg>
  ),
  applications: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6M9 8h6M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" />
    </svg>
  ),
  requirements: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.25v11.5m0-11.5c-.75-1.2-2.25-1.75-4-1.75-1.6 0-3 .3-4 .75v11.5c1-.45 2.4-.75 4-.75 1.75 0 3.25.55 4 1.75m0-11.5c.75-1.2 2.25-1.75 4-1.75 1.6 0 3 .3 4 .75v11.5c-1-.45-2.4-.75-4-.75-1.75 0-3.25.55-4 1.75" />
    </svg>
  ),
};

const NAV_ITEMS: NavItem[] = [
  { href: "/students", label: "Students", icon: ICONS.students },
  { href: "/applications", label: "Applications", icon: ICONS.applications },
  { href: "/requirements-library", label: "Requirements", icon: ICONS.requirements },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 px-3 mt-2" aria-label="Primary">
      {NAV_ITEMS.map(item => {
        const active =
          pathname === item.href ||
          (item.href !== "/" && pathname.startsWith(item.href + "/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-input text-sm font-medium transition-colors ${
              active
                ? "bg-dvivid-primary-light text-dvivid-primary"
                : "text-dvivid-text-secondary hover:bg-dvivid-surface-alt hover:text-dvivid-text-primary"
            }`}
          >
            <span className={active ? "text-dvivid-primary" : "text-dvivid-text-muted"}>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/students" className="flex items-center gap-2.5 px-5 h-16 border-b border-dvivid-border-light" aria-label="D-Vivid home">
      <Image src="/dvivid_logo.png" alt="D-Vivid" width={110} height={33} priority className="h-[33px] w-auto" />
    </Link>
  );
}

export function AppSidebar() {
  return (
    <aside className="hidden lg:flex w-[232px] flex-shrink-0 flex-col bg-white border-r border-dvivid-border sticky top-0 h-screen">
      <Brand />
      <NavList />
    </aside>
  );
}

export function AppSidebarMobile({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Navigation">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside className="absolute left-0 top-0 bottom-0 w-[248px] bg-white border-r border-dvivid-border shadow-card flex flex-col">
        <div className="flex items-center justify-between pr-3">
          <Brand />
          <button
            onClick={onClose}
            className="p-2 rounded-input text-dvivid-text-secondary hover:bg-dvivid-surface-alt"
            aria-label="Close navigation"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <NavList onNavigate={onClose} />
      </aside>
    </div>
  );
}
