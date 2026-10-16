"use client";
import { useState } from "react";

export default function Skills() {
  const [q, setQ] = useState("");
  const [out, setOut] = useState<string>("Search skills, e.g. review");
  async function go() {
    const r = await (await fetch(`/api/skills?scope=laww-personal&q=${encodeURIComponent(q)}`)).json();
    setOut(JSON.stringify(r.results || [], null, 2));
  }
  return (
    <div>
      <h2>Skills library</h2>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Task, e.g. review PR" style={{ flex: 1, padding: 8 }} />
        <button onClick={go} style={{ padding: "8px 16px" }}>Find</button>
      </div>
      <pre style={{ background: "#141926", padding: 12, borderRadius: 8, marginTop: 12 }}>{out}</pre>
    </div>
  );
}
