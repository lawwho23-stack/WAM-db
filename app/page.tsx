"use client";
import { useState } from "react";

// Chat UI: loads context pack (pinned + recent), then searches memory.
export default function Chat() {
  const [scope, setScope] = useState("laww-personal");
  const [q, setQ] = useState("");
  const [out, setOut] = useState<string>("Ask something, e.g. PR diff limit");
  const [busy, setBusy] = useState(false);

  async function ask() {
    setBusy(true);
    try {
      const ctx = await (await fetch(`/api/context?scope=${scope}`)).json();
      const s = await (await fetch(`/api/search?q=${encodeURIComponent(q)}&scope=${scope}`)).json();
      const pins = (ctx.pinned || []).map((p: { content: string }) => "- [pinned] " + p.content).join("\n");
      const hits = (s.results || []).map((r: { content: string; trust: string }) => `- (${r.trust}) ${r.content}`).join("\n");
      setOut(`CONTEXT (pinned first):\n${pins || "(none)"}\n\nSEARCH for "${q}":\n${hits || "(no match)"}`);
    } catch (e) {
      setOut("Error: " + (e instanceof Error ? e.message : "fetch failed"));
    }
    setBusy(false);
  }

  return (
    <div>
      <h2>Chat + context</h2>
      <p style={{ color: "#999", fontSize: 13 }}>Reads pinned items first, then recent. Same door agents use: MCP get_context + search_memory.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ padding: 8 }}>
          <option value="laww-personal">laww-personal</option>
          <option value="pr-reviewer">pr-reviewer</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask memory…" style={{ flex: 1, padding: 8 }} />
        <button onClick={ask} disabled={busy} style={{ padding: "8px 16px" }}>{busy ? "…" : "Ask"}</button>
      </div>
      <pre style={{ whiteSpace: "pre-wrap", background: "#141926", padding: 12, marginTop: 12, borderRadius: 8 }}>{out}</pre>
    </div>
  );
}
