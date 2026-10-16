import { NextResponse } from "next/server";
import { getContext, searchMemory, writeMemory, updateMemory } from "@/lib/memory";
import { sessionAppend, sessionGet } from "@/lib/redis";

// Minimal MCP door: POST /api/mcp with { method, params }.
// method: tools/list | tools/call. Tool names match your doc.
const TOOLS = [
  { name: "get_context", description: "Start of task: pinned + recent + session notes" },
  { name: "search_memory", description: "Look up facts: keyword + importance + usage" },
  { name: "write_memory", description: "Save fact, decision, or run record" },
  { name: "update_memory", description: "Edit or supersede one item" },
  { name: "session_append", description: "Short-term note during task (Redis)" },
  { name: "session_get", description: "Resume task: read session notes" },
  { name: "search_skills", description: "Find skill by task (use /api/skills?q=)" },
  { name: "get_skill", description: "Load one skill in full (use /api/skills)" },
];

export async function POST(req: Request) {
  const body = await req.json();
  const { method, params } = body as { method: string; params?: Record<string, unknown> };
  if (method === "tools/list") return NextResponse.json({ tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name as string;
    const args = (params?.arguments ?? {}) as Record<string, string>;
    try {
      switch (name) {
        case "get_context":
          return NextResponse.json({ result: await getContext(String(args.scope || "laww-personal"), args.sessionId ? String(args.sessionId) : undefined) });
        case "search_memory":
          return NextResponse.json({ result: await searchMemory(String(args.scope || "laww-personal"), String(args.query || ""), 8) });
        case "write_memory":
          return NextResponse.json({
            result: await writeMemory({
              scope: String(args.scope || "laww-personal"),
              type: String(args.type || "fact"),
              content: String(args.content || ""),
              fact_key: (args.fact_key as string) || null,
            }),
          });
        case "update_memory":
          return NextResponse.json({ result: await updateMemory(String(args.id), String(args.content || ""), "mcp edit") });
        case "session_append":
          await sessionAppend(String(args.scope || "laww-personal"), String(args.sessionId || "default"), String(args.note || ""));
          return NextResponse.json({ result: { ok: true } });
        case "session_get":
          return NextResponse.json({ result: await sessionGet(String(args.scope || "laww-personal"), String(args.sessionId || "default")) });
        default:
          return NextResponse.json({ error: `Unknown tool '${name}'. Skills go via /api/skills.` }, { status: 400 });
      }
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "tool error" }, { status: 400 });
    }
  }
  return NextResponse.json({ error: "Use method tools/list or tools/call" }, { status: 400 });
}
