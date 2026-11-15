"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { inputClass } from "@/components/ui/FormField";
import { PrimaryButton } from "@/components/ui";

// ============================================================
// /login — consultant sign-in.
// POSTs to /api/auth/login which sets the httpOnly session cookie,
// then returns to the originally requested page (?redirect=).
// ============================================================

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        const redirect = searchParams.get("redirect") || "/students";
        router.replace(redirect.startsWith("/") ? redirect : "/students");
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Sign-in failed. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-dvivid-page-bg px-4">
      <div className="w-full max-w-sm bg-white border border-dvivid-border rounded-card p-8 shadow-sm">
        <div className="flex justify-center mb-6">
          <Image src="/dvivid_logo.png" alt="D-Vivid" width={180} height={50} priority />
        </div>
        <h1 className="text-lg font-semibold text-dvivid-text-primary text-center mb-6">
          Consultant sign-in
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-dvivid-text-secondary mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@dvivid.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-dvivid-text-secondary mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={inputClass}
              placeholder="••••••••"
            />
          </div>
          {error && (
            <p className="text-sm text-dvivid-error" role="alert">{error}</p>
          )}
          <PrimaryButton type="submit" disabled={submitting} className="w-full justify-center">
            {submitting ? "Signing in…" : "Sign in"}
          </PrimaryButton>
        </form>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
