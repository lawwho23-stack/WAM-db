"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Sidebar. Five destinations, no nesting — the whole app fits in one column.

const LINKS = [
  { href: "/", label: "Overview", hint: "System at a glance" },
  { href: "/money", label: "Money", hint: "Balance and spending" },
  { href: "/memories", label: "Memory", hint: "Search and edit" },
  { href: "/agents", label: "Agents", hint: "Tokens and access" },
  { href: "/runs", label: "Runs", hint: "Work log" },
  { href: "/skills", label: "Skills", hint: "Procedures" },
];

export default function Nav({ email }: { email?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;

    // The dot is the only consumer of this check, so a healthy result from the
    // last minute is reused instead of pinging the database on every load.
    const KEY = "health-ok-at";
    const TTL = 60_000;
    let seen = 0;
    try {
      seen = Number(sessionStorage.getItem(KEY)) || 0;
    } catch {
      // storage can be unavailable; just run the check
    }
    if (seen && Date.now() - seen < TTL) {
      setHealthy(true);
      return;
    }

    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const ok = Boolean(d.db);
        setHealthy(ok);
        try {
          if (ok) sessionStorage.setItem(KEY, String(Date.now()));
          else sessionStorage.removeItem(KEY);
        } catch {
          // a failed write only costs one extra check later
        }
      })
      .catch(() => alive && setHealthy(false));
    return () => {
      alive = false;
    };
  }, []);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-line px-4 py-6 md:flex">
      <Link href="/" className="flex items-center gap-3 px-2">
        <span className="relative grid h-8 w-8 place-items-center rounded-[10px] border border-line-strong bg-white/5">
          <span className="h-2 w-2 rounded-full bg-cyan shadow-[0_0_14px_var(--color-cyan)]" />
          <span className="absolute inset-0 rounded-[10px] border border-cyan/20" />
        </span>
        <span className="leading-tight">
          <span className="num block text-[13px] tracking-[0.14em] text-ink">WAM·DB</span>
          <span className="block text-[10.5px] tracking-[0.06em] text-faint">WHOLE AGENT MEMORY</span>
        </span>
      </Link>

      <nav className="flex flex-col gap-1">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`nav-link ${isActive(l.href) ? "nav-link-active" : ""}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isActive(l.href) ? "bg-cyan shadow-[0_0_9px_var(--color-cyan)]" : "bg-white/25"}`} />
            <span className="flex-1">{l.label}</span>
            <span className="text-[10px] text-faint opacity-0 transition-opacity group-hover:opacity-100">{l.hint}</span>
          </Link>
        ))}
      </nav>

      <div className="mt-auto space-y-3 px-2">
        <div className="hairline" />
        <div className="flex items-center gap-2 text-[11px] text-faint">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              healthy === null ? "bg-white/30" : healthy ? "bg-mint shadow-[0_0_9px_var(--color-mint)]" : "bg-rose"
            }`}
          />
          <span>{healthy === null ? "checking…" : healthy ? "database online" : "database unreachable"}</span>
        </div>

        {email ? (
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={email}>
              {email}
            </span>
            <button className="btn px-2 py-1 text-[11px]" type="button" onClick={signOut} disabled={busy}>
              {busy ? "…" : "Sign out"}
            </button>
          </div>
        ) : null}

        <p className="text-[10.5px] leading-relaxed text-faint">
          Neon Postgres · pgvector · Redis
          <br />
          MCP at <span className="num text-muted">/api/mcp</span>
        </p>
      </div>
    </aside>
  );
}
