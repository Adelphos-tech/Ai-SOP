"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/students";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed.");
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-dvivid-page-bg px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Image src="/dvivid_logo.png" alt="D-Vivid" width={180} height={50} priority />
          <h1 className="text-xl font-semibold text-dvivid-text-primary mt-4">Consultant Portal</h1>
          <p className="text-sm text-dvivid-text-secondary mt-1">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-card shadow-card p-6 space-y-4">
          {error && (
            <div className="p-3 bg-dvivid-error-light border border-dvivid-error/20 rounded-input">
              <p className="text-sm text-dvivid-error">{error}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-dvivid-text-primary mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
              className="w-full px-3 py-2 border border-dvivid-border rounded-input text-dvivid-text-primary focus:outline-none focus:border-dvivid-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dvivid-text-primary mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 border border-dvivid-border rounded-input text-dvivid-text-primary focus:outline-none focus:border-dvivid-primary"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-dvivid-primary text-white rounded-button font-medium hover:bg-dvivid-primary-dark disabled:opacity-50 transition-colors"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
