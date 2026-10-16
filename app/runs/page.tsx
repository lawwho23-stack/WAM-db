"use client";
import { useEffect, useState } from "react";

type Run = { id: string; agent: string; external_id: string; repository: string; status: string; current_stage: string; findings_count: number; summary: string | null; events: number };

export default function Runs() {
  const [rows, setRows] = useState<Run[]>([]);
  useEffect(() => {
    (async () => {
      const r = await (await fetch("/api/runs?scope=pr-reviewer")).json();
      setRows(r.results || []);
    })();
  }, []);
  return (
    <div>
      <h2>Process view — agent runs</h2>
      <p style={{ color: "#888", fontSize: 13 }}>One row per PR + commit SHA. Steps come from agent_run_events.</p>
      {rows.length === 0 && <p>No runs yet in pr-reviewer scope.</p>}
      {rows.map((r) => (
        <div key={r.id} style={{ background: "#141926", padding: 12, borderRadius: 8, marginBottom: 8 }}>
          <b>{r.repository}</b> <span style={{ color: "#9ecbff" }}>{r.external_id}</span><br />
          <span>Status: {r.status} @ {r.current_stage} | findings: {r.findings_count} | steps: {r.events}</span>
          {r.summary && <div style={{ marginTop: 4 }}>{r.summary}</div>}
        </div>
      ))}
    </div>
  );
}
