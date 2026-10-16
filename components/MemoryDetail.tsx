"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MemoryRow, VersionRow } from "@/lib/memory";
import { Chip, Panel, PanelHeader, relTime } from "@/components/ui";

type Relation = {
  id: string;
  type: string;
  origin: string;
  status: string;
  created_at: string;
  outgoing: boolean;
  other_id: string;
  other_content: string;
};

export default function MemoryDetail({
  memory,
  versions,
  relations,
}: {
  memory: MemoryRow;
  versions: VersionRow[];
  relations: Relation[];
}) {
  const router = useRouter();
  const [text, setText] = useState(memory.content);
  const [draft, setDraft] = useState(memory.content);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pinned = memory.labels?.includes("pinned");

  async function patch(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/memories/${memory.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
      setNote(`${label} done.`);
      if (typeof body.content === "string") {
        setText(body.content);
        setEditing(false);
        setReason("");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  const meta: [string, string][] = [
    ["scope", memory.scope_name ?? "—"],
    ["type", memory.type],
    ["trust", memory.trust.replace(/_/g, " ")],
    ["state", memory.state],
    ["version", `v${memory.version}`],
    ["importance", String(memory.importance)],
    ["retrievals", String(memory.retrievals ?? 0)],
    ["embeddings", String(memory.embedding_count ?? 0)],
    ["fact key", memory.fact_key ?? "—"],
    ["author", memory.author ?? "—"],
    ["last used", memory.last_used_at ? relTime(memory.last_used_at) : "never"],
    ["updated", `${new Date(memory.updated_at).toLocaleString()} (${relTime(memory.updated_at)})`],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/memories" className="btn" type="button">
          ← All memories
        </Link>
        <button className="btn" disabled={busy !== null} onClick={() => patch({ pinned: !pinned }, pinned ? "Unpin" : "Pin")} type="button">
          {pinned ? "Unpin" : "Pin to context"}
        </button>
        <button
          className="btn"
          disabled={busy !== null}
          onClick={() => {
            setEditing((v) => !v);
            setDraft(text);
          }}
          type="button"
        >
          {editing ? "Cancel edit" : "Edit"}
        </button>
        {memory.state === "active" ? (
          <button className="btn btn-danger" disabled={busy !== null} onClick={() => patch({ state: "deleted" }, "Delete")} type="button">
            Delete
          </button>
        ) : (
          <button className="btn" disabled={busy !== null} onClick={() => patch({ state: "active" }, "Restore")} type="button">
            Restore
          </button>
        )}
        <button
          className="btn"
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(memory.id);
            setNote("Memory id copied.");
          }}
        >
          Copy id
        </button>
        <span className="num ml-auto text-[11px] text-faint">{memory.id}</span>
      </div>

      {error ? <Panel className="border-rose/40 px-4 py-3 text-[13px] text-rose">{error}</Panel> : null}
      {note && !error ? <Panel className="border-mint/30 px-4 py-3 text-[13px] text-mint">{note}</Panel> : null}

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Content"
          hint={editing ? "Saving creates a new version — the old text stays in history." : "Whitespace is preserved exactly as stored."}
          right={
            <div className="flex items-center gap-2">
              {memory.labels?.map((l) => (
                <Chip key={l} tone={l === "pinned" ? "cyan" : "neutral"}>
                  {l}
                </Chip>
              ))}
            </div>
          }
        />
        <div className="px-4 py-4">
          {editing ? (
            <div className="space-y-3">
              <textarea className="textarea num min-h-[160px] text-[13px]" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
              <input className="input" placeholder="Why the change? (shown in history)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-primary"
                  disabled={busy !== null || draft.trim().length === 0 || draft === text}
                  onClick={() => patch({ content: draft, reason: reason || "edit" }, "Save")}
                  type="button"
                >
                  {busy === "Save" ? "Saving…" : "Save new version"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraft(text);
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{text}</p>
          )}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Panel className="overflow-hidden">
          <PanelHeader title="Facts" hint="Where this memory sits." />
          <dl className="grid grid-cols-1 divide-y divide-[var(--color-line)]">
            {meta.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-3 px-4 py-2.5">
                <dt className="label w-28 shrink-0">{k}</dt>
                <dd className="num min-w-0 break-words text-[12.5px] text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <div className="space-y-4">
          <Panel className="overflow-hidden">
            <PanelHeader title="History" hint={`${versions.length} version${versions.length === 1 ? "" : "s"} kept`} />
            <ol className="divide-y divide-[var(--color-line)]">
              {versions.map((v) => (
                <li key={`${v.version}-${v.created_at}`} className="px-4 py-3">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="num text-[11px] text-violet">v{v.version}</span>
                    <Chip tone={v.state === "active" ? "mint" : "amber"}>{v.state}</Chip>
                    <span className="num ml-auto text-[11px] text-faint">{relTime(v.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">{v.content}</p>
                  <p className="mt-1.5 text-[11px] text-faint">
                    {v.actor} · {v.reason ?? "no reason given"}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>

          {relations.length > 0 ? (
            <Panel className="overflow-hidden">
              <PanelHeader title="Relations" hint="Links to other memories." />
              <ul className="divide-y divide-[var(--color-line)]">
                {relations.map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <div className="mb-1 flex items-center gap-2">
                      <Chip tone="violet">{r.type}</Chip>
                      <span className="text-[11px] text-faint">{r.outgoing ? "outgoing" : "incoming"}</span>
                    </div>
                    <Link href={`/memories/${r.other_id}`} className="text-[12.5px] text-muted hover:text-cyan">
                      {r.other_content}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
