"use client";
import { useEffect, useState } from "react";

type Row = { id: string; snippet: string; type: string; trust: string; importance: number; labels: string[] };

export default function Memories() {
  const [rows, setRows] = useState<Row[]>([]);
  const [content, setContent] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const r = await (await fetch("/api/memories?scope=laww-personal")).json();
    setRows(r.results || []);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setMsg("Saving…");
    const r = await (await fetch("/api/memories", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "laww-personal", type: "fact", content, trust: "owner_asserted", importance: 0.7 }),
    })).json();
    setMsg(r.id ? "Saved " + r.id.slice(0, 8) : "Error: " + JSON.stringify(r));
    setContent("");
    load();
  }

  return (
    <div>
      <h2>Memories table</h2>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={content} onChange={(e) => setContent(e.target.value)} placeholder="New fact, e.g. Deploy day is Friday" style={{ flex: 1, padding: 8 }} />
        <button onClick={save} style={{ padding: "8px 16px" }}>Save</button>
      </div>
      <p style={{ color: "#888", fontSize: 13 }}>{msg}</p>
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <thead><tr style={{ textAlign: "left", color: "#888" }}><th>Type</th><th>Snippet</th><th>Trust</th><th>Imp</th><th>Labels</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid #222" }}>
              <td>{r.type}</td><td>{r.snippet}</td><td>{r.trust}</td><td>{r.importance}</td><td>{r.labels?.join(",")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
