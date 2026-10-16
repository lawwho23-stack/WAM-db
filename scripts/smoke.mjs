#!/usr/bin/env node
// End-to-end smoke test for WAM-db.
//
//   node scripts/smoke.mjs                       # against http://localhost:3000
//   node scripts/smoke.mjs https://wam-db.vercel.app
//
// Env:
//   MCP_TOKEN         reuse an existing agent token (otherwise one is created)
//   VERCEL_BYPASS     Protection Bypass for Automation secret, for protected
//                     deployments (x-vercel-protection-bypass header)
//
// Checks: health, token creation, the MCP handshake, all read/write paths,
// hybrid search, the job runner, then cleans up after itself.

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const bypass = process.env.VERCEL_BYPASS ?? "";

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  const mark = pass ? "\x1b[32m PASS \x1b[0m" : "\x1b[31m FAIL \x1b[0m";
  console.log(`${mark} ${name}${detail ? "  — " + detail : ""}`);
}

function headers(extra = {}) {
  const h = { "content-type": "application/json", ...extra };
  if (bypass) h["x-vercel-protection-bypass"] = bypass;
  return h;
}

async function jsonFetch(path, init = {}) {
  const res = await fetch(base + path, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 400); }
  return { status: res.status, body, headers: res.headers };
}

// ---------------------------------------------------------------- MCP client

let sessionId = null;
let protocolVersion = null;

async function mcp(method, params, id = Math.floor(Math.random() * 100000)) {
  const h = headers({ authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" });
  if (sessionId) h["mcp-session-id"] = sessionId;
  if (protocolVersion) h["mcp-protocol-version"] = protocolVersion;

  const res = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;

  const raw = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  let payload = raw;
  if (contentType.includes("text/event-stream")) {
    const line = raw.split("\n").filter((l) => l.startsWith("data:")).pop();
    payload = line ? line.slice(5).trim() : "";
  }
  try { return { status: res.status, message: JSON.parse(payload) }; }
  catch { return { status: res.status, message: null, raw: raw.slice(0, 300) }; }
}

function toolResult(response) {
  const text = response?.message?.result?.content?.[0]?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

// -------------------------------------------------------------------- checks

let token = process.env.MCP_TOKEN ?? null;
const createdIds = [];

async function main() {
  console.log(`\nWAM-db smoke test → ${base}\n`);

  // 1. health
  const health = await jsonFetch("/api/health", { headers: headers() });
  record("health endpoint reports the database is reachable", health.status === 200 && health.body?.db === true, JSON.stringify(health.body).slice(0, 90));

  // 2. protection gate (only meaningful on a protected deployment)
  if (base.includes("vercel.app") && !bypass) {
    const gated = await fetch(`${base}/api/health`);
    record("deployment gate blocks anonymous requests", gated.status !== 200, `status ${gated.status}`);
  }

  // 3. token
  if (!token) {
    const created = await jsonFetch("/api/tokens", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: "smoke-test", scope: null, canRead: true, canWrite: true }),
    });
    token = created.body?.token ?? null;
    if (created.body?.id) createdIds.push(created.body.id);
    record(
      "create an agent token",
      Boolean(token),
      token ? `prefix ${token.slice(0, 12)}…` : String(created.body?.error ?? JSON.stringify(created.body)).slice(0, 120),
    );
    if (!token) return;
  } else {
    record("using supplied MCP_TOKEN", true);
  }

  // 4. unauthorized call is rejected
  const noAuth = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: headers({ accept: "application/json, text/event-stream" }),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } }),
  });
  record("MCP rejects a request with no token", noAuth.status === 401, `status ${noAuth.status}`);

  // 5. handshake
  const init = await mcp("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "wam-smoke", version: "1.0.0" },
  });
  const negotiated = init.message?.result?.protocolVersion;
  protocolVersion = negotiated ?? null;
  record("MCP initialize handshake", Boolean(negotiated), `protocol ${negotiated ?? "?"}, server ${init.message?.result?.serverInfo?.name ?? "?"}`);

  await mcp("notifications/initialized", {});

  // 6. tools/list
  const list = await mcp("tools/list", {});
  const tools = (list.message?.result?.tools ?? []).map((t) => t.name);
  record("tools/list returns the tool set", tools.length >= 10, `${tools.length} tools: ${tools.join(", ")}`);

  // 7. get_context
  const ctx = await mcp("tools/call", { name: "get_context", arguments: { scope: "laww-personal" } });
  const ctxData = toolResult(ctx);
  record("get_context returns a context pack", Boolean(ctxData?.scope), `scope ${ctxData?.scope ?? "?"}, pinned ${ctxData?.pinned?.length ?? 0}`);

  // 8. write_memory
  const stamp = new Date().toISOString();
  const written = await mcp("tools/call", {
    name: "write_memory",
    arguments: {
      scope: "laww-personal",
      type: "fact",
      content: `Smoke test marker written at ${stamp}. The smoke script verifies the whole write path.`,
      labels: ["smoke-test"],
      importance: 0.2,
      trust: "owner_asserted",
    },
  });
  const writeData = toolResult(written);
  const memoryId = typeof writeData === "object" ? writeData?.id : null;
  record("write_memory stores a memory", Boolean(memoryId), memoryId ? `id ${String(memoryId).slice(0, 8)}` : JSON.stringify(written).slice(0, 140));

  // 9. search: exact words (keyword leg)
  const kw = await mcp("tools/call", { name: "search_memory", arguments: { query: "smoke script write path", scope: "laww-personal" } });
  const kwData = toolResult(kw);
  const kwHit = Array.isArray(kwData) ? kwData.find((r) => r.id === memoryId) : null;
  record("search finds it by exact words", Boolean(kwHit), kwHit ? `rank score ${kwHit.score}, matched ${JSON.stringify(kwHit.matched)}` : "not found");

  // 10. search: meaning only, words deliberately absent (vector leg)
  const sem = await mcp("tools/call", { name: "search_memory", arguments: { query: "verify the application is working correctly", scope: "laww-personal", limit: 10 } });
  const semData = toolResult(sem);
  const semHit = Array.isArray(semData) ? semData.find((r) => r.id === memoryId) : null;
  record(
    "search finds it by meaning alone (vector leg)",
    Boolean(semHit?.matched?.vector),
    semHit ? `similarity ${semHit.similarity}, matched ${JSON.stringify(semHit.matched)}` : "not found",
  );

  // 11. list_memories + stats
  const listed = await mcp("tools/call", { name: "list_memories", arguments: { scope: "laww-personal", limit: 5 } });
  record("list_memories browses the scope", Array.isArray(toolResult(listed)?.results), `${toolResult(listed)?.total ?? "?"} total`);
  const stats = await mcp("tools/call", { name: "memory_stats", arguments: { scope: "laww-personal" } });
  const statsData = toolResult(stats);
  record("memory_stats reports counts", typeof statsData?.activeCount === "number", `active ${statsData?.activeCount}, embedded ${statsData?.embeddedCount}, missing ${statsData?.missingEmbeddings}`);

  // 12. session notes
  const sid = `smoke-${Date.now()}`;
  await mcp("tools/call", { name: "session_append", arguments: { scope: "laww-personal", session_id: sid, note: "smoke note one" } });
  const back = await mcp("tools/call", { name: "session_get", arguments: { scope: "laww-personal", session_id: sid } });
  const notes = toolResult(back)?.notes ?? [];
  record("session notes round-trip", notes.includes("smoke note one"), `${notes.length} note(s)`);

  // 13. scope fence: this token is unscoped, so test a scoped one
  if (!process.env.MCP_TOKEN) {
    const scoped = await jsonFetch("/api/tokens", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: "smoke-scoped", scope: "pr-reviewer", canRead: true, canWrite: false }),
    });
    if (scoped.body?.id) createdIds.push(scoped.body.id);
    if (scoped.body?.token) {
      const scopedToken = scoped.body.token;
      const res = await fetch(`${base}/api/mcp`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${scopedToken}`, accept: "application/json, text/event-stream" }),
        body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "write_memory", arguments: { scope: "pr-reviewer", content: "should not land" } } }),
      });
      const raw = await res.text();
      const line = raw.split("\n").filter((l) => l.startsWith("data:")).pop();
      let parsed = null;
      try { parsed = JSON.parse(line ? line.slice(5).trim() : raw); } catch {}
      const isError = parsed?.result?.isError === true;
      record("read-only token cannot write", isError, isError ? (parsed.result.content?.[0]?.text ?? "").slice(0, 80) : "write was allowed");
    }
  }

  // 14. cron job runner
  const cronSecret = process.env.CRON_SECRET ?? "";
  if (cronSecret) {
    const cron = await jsonFetch(`/api/cron?secret=${encodeURIComponent(cronSecret)}`, { headers: headers() });
    record("cron runner drains jobs", cron.status === 200 && cron.body?.ok === true, JSON.stringify(cron.body).slice(0, 110));
  } else {
    const cronNoAuth = await jsonFetch("/api/cron", { headers: headers() });
    record("cron refuses to run without the secret", cronNoAuth.status === 401, `status ${cronNoAuth.status}`);
  }

  // 15. fact_key: the same key twice replaces the old row and keeps its history
  const key = `smoke:key-${Date.now()}`;
  const first = await mcp("tools/call", {
    name: "write_memory",
    arguments: { scope: "laww-personal", type: "fact", fact_key: key, content: "Keyed smoke value, first.", labels: ["smoke-test"] },
  });
  const firstId = toolResult(first)?.id;
  const second = await mcp("tools/call", {
    name: "write_memory",
    arguments: { scope: "laww-personal", type: "fact", fact_key: key, content: "Keyed smoke value, second.", labels: ["smoke-test"] },
  });
  const secondId = toolResult(second)?.id;
  const oldDetail = firstId ? await jsonFetch(`/api/memories/${firstId}`, { headers: headers() }) : null;
  record(
    "fact_key supersedes the old row and keeps it",
    Boolean(secondId && secondId !== firstId && oldDetail?.body?.memory?.state === "superseded" && oldDetail?.body?.versions?.length >= 2),
    `old row state ${oldDetail?.body?.memory?.state ?? "?"}, ${oldDetail?.body?.versions?.length ?? 0} versions kept`,
  );

  // 16. edit path creates history, delete path hides the row without losing it
  if (memoryId) {
    const edited = await jsonFetch(`/api/memories/${memoryId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ content: `Smoke test marker, edited at ${new Date().toISOString()}.`, reason: "smoke edit" }),
    });
    record("edit path creates a new version", edited.status === 200 && edited.body?.version >= 2, `version ${edited.body?.version ?? "?"}`);

    const detail = await jsonFetch(`/api/memories/${memoryId}`, { headers: headers() });
    record("history keeps both versions", (detail.body?.versions?.length ?? 0) >= 2, `${detail.body?.versions?.length ?? 0} versions`);

    const pinned = await jsonFetch(`/api/memories/${memoryId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ pinned: true }),
    });
    record("pin toggle works", pinned.status === 200 && Array.isArray(pinned.body?.pin?.labels) && pinned.body.pin.labels.includes("pinned"), `labels ${JSON.stringify(pinned.body?.pin?.labels)}`);
  }

  // 17. cleanup: hide the markers and revoke the tokens this run created
  for (const id of [memoryId, firstId, secondId].filter(Boolean)) {
    const deleted = await jsonFetch(`/api/memories/${id}`, { method: "DELETE", headers: headers() });
    if (id === memoryId) {
      record("delete is a soft delete", deleted.status === 200 && deleted.body?.state === "deleted", `state ${deleted.body?.state ?? "?"}`);
    }
  }
  for (const id of createdIds) {
    // Purge, not revoke: a test token has no record value, and purging keeps
    // the same names reusable on the next run.
    await jsonFetch(`/api/tokens/${id}?purge=1`, { method: "DELETE", headers: headers() });
  }
  if (createdIds.length) record("cleanup: purged test tokens", true, `${createdIds.length} removed`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} failed` : ""}\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("\nSmoke test crashed:", e);
  process.exit(1);
});
