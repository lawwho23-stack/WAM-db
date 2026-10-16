"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Chip, Panel, PanelHeader, relTime } from "@/components/ui";

type TokenRow = {
  id: string;
  name: string;
  token_prefix: string;
  scope: string | null;
  can_read: boolean;
  can_write: boolean;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

const ENDPOINT = "https://wam-db.vercel.app/api/mcp";

function configSnippet(token: string, withBypass: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (withBypass) headers["x-vercel-protection-bypass"] = withBypass;
  return JSON.stringify(
    {
      mcpServers: {
        "wam-db": {
          type: "http",
          url: ENDPOINT,
          headers,
        },
      },
    },
    null,
    2,
  );
}

export default function AgentTokens({ tokens, scopes }: { tokens: TokenRow[]; scopes: string[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scope, setScope] = useState("");
  const [canWrite, setCanWrite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [bypass, setBypass] = useState("");

  const active = tokens.filter((t) => !t.revoked_at);
  const revoked = tokens.filter((t) => t.revoked_at);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scope: scope || null, canRead: true, canWrite }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(typeof data.error === "string" ? data.error : "Could not create the token");
      setFresh({ token: data.token, name: data.name });
      setName("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the token");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, label: string) {
    if (!confirm(`Revoke “${label}”? Any agent using it loses access immediately.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(typeof data.error === "string" ? data.error : "Could not revoke");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke");
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <Panel className="overflow-hidden">
          <PanelHeader title="Issue a token" hint="One token per agent. Shown once, stored as a hash." />
          <div className="space-y-3 px-4 py-4">
            <div>
              <label className="label mb-1.5 block" htmlFor="token-name">
                Agent name
              </label>
              <input
                id="token-name"
                className="input"
                placeholder="claude-code, codex, reviewer-bot…"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="label mb-1.5 block" htmlFor="token-scope">
                Scope
              </label>
              <select id="token-scope" className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="">every scope in the workspace</option>
                {scopes.map((s) => (
                  <option key={s} value={s}>
                    {s} only
                  </option>
                ))}
              </select>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-white/[0.02] px-3.5 py-3">
              <input type="checkbox" className="mt-0.5 accent-[var(--color-cyan)]" checked={canWrite} onChange={(e) => setCanWrite(e.target.checked)} />
              <span>
                <span className="block text-[13px] text-ink">Allow writes</span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-faint">
                  Off means the agent can read context and search, but cannot save or edit anything.
                </span>
              </span>
            </label>
            <button className="btn btn-primary w-full" disabled={busy || name.trim().length === 0} onClick={create} type="button">
              {busy ? "Working…" : "Create token"}
            </button>
            {error ? <p className="text-[12.5px] text-rose">{error}</p> : null}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader
            title="How an agent connects"
            hint="Works with any client that speaks MCP over HTTP."
            right={<Chip tone="cyan">{ENDPOINT.replace("https://", "")}</Chip>}
          />
          <div className="space-y-3 px-4 py-4">
            <textarea className="textarea num min-h-[150px] text-[11.5px]" readOnly value={configSnippet(fresh?.token ?? "<your-token>", bypass)} />
            <div>
              <label className="label mb-1.5 block" htmlFor="bypass">
                Bypass header (only if deployment protection is on)
              </label>
              <input
                id="bypass"
                className="input num text-[12px]"
                placeholder="paste the Protection Bypass for Automation secret"
                value={bypass}
                onChange={(e) => setBypass(e.target.value)}
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                Vercel → Project <span className="num">wam-db</span> → Settings → Deployment Protection → Protection Bypass for Automation.
                Leave empty once the app has its own login and protection is off.
              </p>
            </div>
            <button className="btn w-full" type="button" onClick={() => copy(configSnippet(fresh?.token ?? "<your-token>", bypass), "config")}>
              {copied === "config" ? "Copied" : "Copy config"}
            </button>
          </div>
        </Panel>
      </div>

      {fresh ? (
        <Panel className="border-cyan/40">
          <div className="px-4 py-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Chip tone="cyan">new token</Chip>
              <span className="text-[12.5px] text-muted">{fresh.name}</span>
              <span className="ml-auto text-[11px] text-amber">Copy it now — it is never shown again.</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="num min-w-0 flex-1 break-all rounded-xl border border-cyan/30 bg-cyan/[0.07] px-3 py-2.5 text-[12.5px] text-cyan">
                {fresh.token}
              </code>
              <button className="btn btn-primary" type="button" onClick={() => copy(fresh.token, "token")}>
                {copied === "token" ? "Copied" : "Copy"}
              </button>
              <button className="btn" type="button" onClick={() => setFresh(null)}>
                Done
              </button>
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel className="overflow-hidden">
        <PanelHeader title="Active tokens" hint="Every call they make is fenced by scope and permissions." right={<Chip tone="mint">{active.length}</Chip>} />
        {active.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-faint">No tokens yet. Issue one above to let an agent in.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {active.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                <div className="min-w-[160px] flex-1">
                  <p className="text-[13.5px] text-ink">{t.name}</p>
                  <p className="num mt-1 text-[11px] text-faint">
                    {t.token_prefix}…… created {relTime(t.created_at)}
                  </p>
                </div>
                <Chip tone="violet">{t.scope ?? "all scopes"}</Chip>
                <Chip tone={t.can_write ? "mint" : "amber"}>{t.can_write ? "read + write" : "read only"}</Chip>
                <span className="num text-[11px] text-faint">last used {relTime(t.last_used_at)}</span>
                <button className="btn btn-danger" disabled={busy} onClick={() => revoke(t.id, t.name)} type="button">
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {revoked.length > 0 ? (
        <Panel className="overflow-hidden">
          <PanelHeader title="Revoked" hint="Kept for the record; they cannot authenticate." right={<Chip>{revoked.length}</Chip>} />
          <ul className="divide-y divide-[var(--color-line)]">
            {revoked.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[12.5px] text-faint">
                <span className="min-w-[160px] flex-1 text-muted">{t.name}</span>
                <span className="num">{t.token_prefix}……</span>
                <span className="num">revoked {relTime(t.revoked_at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
