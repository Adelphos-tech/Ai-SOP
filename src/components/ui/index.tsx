"use client";
import Link from "next/link";

export function PageContainer({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`max-w-[1280px] mx-auto px-4 md:px-8 py-8 ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
      <div>
        <h1 className="text-page-title text-dvivid-text-primary">{title}</h1>
        {subtitle && <p className="text-base text-dvivid-text-secondary mt-1.5">{subtitle}</p>}
      </div>
      {action && <div className="flex items-center gap-3">{action}</div>}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  children,
  className = "",
  action,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={`bg-white border border-dvivid-border rounded-card shadow-card ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-7 pt-6 pb-0">
          {title && <h2 className="text-card-title text-dvivid-text-primary">{title}</h2>}
          {action}
        </div>
      )}
      {description && <p className="text-sm text-dvivid-text-secondary px-7 pt-1.5">{description}</p>}
      <div className="p-7">{children}</div>
    </div>
  );
}

export function InfoPanel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-dvivid-primary-light border border-dvivid-primary-border rounded-card p-5 ${className}`}>
      {children}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  className = "",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-5 py-2.5 bg-dvivid-primary text-white rounded-button font-medium text-sm shadow-cta hover:bg-dvivid-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  className = "",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-5 py-2.5 bg-white border border-dvivid-border text-dvivid-text-primary rounded-button font-medium text-sm hover:border-dvivid-primary hover:text-dvivid-primary transition-colors disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function DangerButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-5 py-2.5 bg-dvivid-error text-white rounded-button font-medium text-sm hover:opacity-90 transition-colors disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    APPROVED: { bg: "bg-dvivid-success-light", text: "text-dvivid-success" },
    IN_REVIEW: { bg: "bg-dvivid-primary-light", text: "text-dvivid-primary" },
    DRAFT: { bg: "bg-gray-100", text: "text-dvivid-text-secondary" },
    FAILED: { bg: "bg-dvivid-error-light", text: "text-dvivid-error" },
    NEEDS_INFORMATION: { bg: "bg-dvivid-warning-light", text: "text-dvivid-warning" },
    GENERATED: { bg: "bg-dvivid-success-light", text: "text-dvivid-success" },
    GENERATING: { bg: "bg-dvivid-primary-light", text: "text-dvivid-primary" },
    NOT_GENERATED: { bg: "bg-gray-100", text: "text-dvivid-text-secondary" },
  };
  const style = map[status] || map.DRAFT;
  const display = label || status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  return (
    <span className={`px-2.5 py-1 ${style.bg} ${style.text} text-xs font-medium rounded-full whitespace-nowrap`}>
      {display}
    </span>
  );
}

export function PromptSourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; bg: string; text: string }> = {
    OFFICIAL_VERIFIED: { label: "Official Requirement", bg: "bg-dvivid-primary-light", text: "text-dvivid-primary" },
    APPLICATION_PORTAL: { label: "Application Portal", bg: "bg-dvivid-primary-light", text: "text-dvivid-primary" },
    USER_PROVIDED_PORTAL_PROMPT: { label: "Prompt provided by user", bg: "bg-dvivid-primary-light", text: "text-dvivid-primary" },
    CONSULTANT_PROVIDED: { label: "Consultant Provided", bg: "bg-purple-50", text: "text-purple-700" },
    DVIVID_DEFAULT_TEMPLATE: { label: "D-Vivid Template", bg: "bg-gray-100", text: "text-dvivid-text-secondary" },
    CUSTOM: { label: "Custom", bg: "bg-gray-100", text: "text-dvivid-text-secondary" },
  };
  const style = map[source] || { label: source, bg: "bg-gray-100", text: "text-dvivid-text-secondary" };
  return (
    <span className={`px-2.5 py-1 ${style.bg} ${style.text} text-xs font-medium rounded-full whitespace-nowrap`}>
      {style.label}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="text-center py-16 px-6">
      <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-dvivid-primary-light flex items-center justify-center">
        {icon || (
          <svg className="w-8 h-8 text-dvivid-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
        )}
      </div>
      <h3 className="text-lg font-semibold text-dvivid-text-primary mb-1.5">{title}</h3>
      <p className="text-sm text-dvivid-text-secondary mb-6 max-w-sm mx-auto">{description}</p>
      {action}
    </div>
  );
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <div className="flex items-center gap-2 text-sm mb-6">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && <span className="text-dvivid-text-muted">/</span>}
          {item.href ? (
            <Link href={item.href} className="text-dvivid-text-secondary hover:text-dvivid-primary transition-colors">
              {item.label}
            </Link>
          ) : (
            <span className="text-dvivid-text-primary font-medium">{item.label}</span>
          )}
        </div>
      ))}
    </div>
  );
}
