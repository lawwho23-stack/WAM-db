"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** The sign-in form. One email, one passphrase, one owner. */
export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(typeof data.error === "string" ? data.error : "Sign-in failed.");
      router.replace(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <p className="label">Owner sign-in</p>
        <h1 className="mt-2 text-[20px] font-semibold tracking-tight text-ink">This memory belongs to one person.</h1>
      </div>

      <div className="space-y-3.5 px-5 py-5">
        <div>
          <label className="label mb-1.5 block" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="label mb-1.5 block" htmlFor="password">
            Passphrase
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
          />
        </div>

        {error ? (
          <p className="rounded-xl border border-rose/30 bg-rose/[0.07] px-3.5 py-2.5 text-[12.5px] text-rose">{error}</p>
        ) : null}

        <button className="btn btn-primary w-full" type="submit" disabled={busy || !email || !password}>
          {busy ? "Checking…" : "Sign in"}
        </button>

        <p className="text-[11.5px] leading-relaxed text-faint">
          Any other email is turned away. Sessions last 30 days and are signed, so they cannot be edited in the browser.
        </p>
      </div>
    </form>
  );
}
