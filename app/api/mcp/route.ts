import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import { bearerFrom, resolveToken, touchToken, actorForToken, type TokenContext } from "@/lib/auth-tokens";
import {
  getContext,
  searchMemory,
  writeMemory,
  updateMemory,
  listMemories,
  scopeStats,
} from "@/lib/memory";
import { searchSkills, getSkill } from "@/lib/skills";
import { sessionAppend, sessionGet } from "@/lib/redis";
import { sql } from "@/lib/db";

// The one MCP door. Every agent reaches memory through this route with its own
// bearer token. The token decides which scope the agent can touch and whether
// it may write, so a read-only reviewer bot cannot rewrite personal facts.
//
// Auth runs in this file, before the MCP handler sees the request, and the
// resolved context travels into the tool callbacks through AsyncLocalStorage.

export const runtime = "nodejs";
export const maxDuration = 60;

const authStore = new AsyncLocalStorage<TokenContext>();

function auth(): TokenContext {
  const ctx = authStore.getStore();
  if (!ctx) throw new Error("Not authenticated.");
  return ctx;
}

function ok(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** Wrap a tool body so a thrown error becomes a readable tool result. */
function guard<T>(fn: (args: T) => Promise<unknown>) {
  return async (args: T) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Tool failed.");
    }
  };
}

/** Which scope may this call touch? The token wins when it is scoped. */
async function scopeFor(requested?: string): Promise<string> {
  const me = auth();
  if (!me.canRead && !me.canWrite) throw new Error(`Token '${me.tokenName}' has no permissions.`);
  if (me.scopeName) {
    if (requested && requested !== me.scopeName) {
      throw new Error(`Token '${me.tokenName}' is limited to scope '${me.scopeName}'.`);
    }
    return me.scopeName;
  }
  if (requested) return requested;
  const db = sql();
  const rows = await db`SELECT name FROM scopes WHERE workspace_id = ${me.workspaceId}
    ORDER BY (kind = 'personal') DESC, name LIMIT 1`;
  if (rows.length === 0) throw new Error("This workspace has no scopes yet.");
  return rows[0].name as string;
}

function requireWrite() {
  const me = auth();
  if (!me.canWrite) throw new Error(`Token '${me.tokenName}' is read-only (can_write = false).`);
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "get_context",
      {
        title: "Get context pack",
        description:
          "Start here. Returns the pinned memories, the most recent memories and any live session notes for a scope. Call this at the start of a task.",
        annotations: { readOnlyHint: true },
        inputSchema: z.object({
          scope: z.string().optional().describe("Memory scope, e.g. 'laww-personal'. Defaults to the token's scope."),
          session_id: z.string().optional().describe("Session id to include short-term notes from."),
        }),
      },
      guard(async ({ scope, session_id }: { scope?: string; session_id?: string }) =>
        getContext(await scopeFor(scope), session_id),
      ),
    );

    server.registerTool(
      "search_memory",
      {
        title: "Search memory",
        description:
          "Hybrid search over long-term memory: vector similarity for meaning plus full-text for exact words. Use it to look up facts, past decisions and earlier findings.",
        annotations: { readOnlyHint: true },
        inputSchema: z.object({
          query: z.string().min(1).describe("What to look for, in natural language."),
          scope: z.string().optional(),
          limit: z.number().int().min(1).max(25).optional().describe("How many results, default 8."),
        }),
      },
      guard(async ({ query, scope, limit }: { query: string; scope?: string; limit?: number }) =>
        searchMemory(await scopeFor(scope), query, limit ?? 8),
      ),
    );

    server.registerTool(
      "write_memory",
      {
        title: "Write memory",
        description:
          "Save a durable fact, preference, decision, procedure or run record. Pass the same fact_key again to replace an older value — the old row is kept as superseded history, never deleted.",
        annotations: { readOnlyHint: false, destructiveHint: false },
        inputSchema: z.object({
          content: z.string().min(1).describe("The memory itself, one clear statement."),
          type: z
            .enum(["fact", "preference", "decision", "experience", "procedure", "run_record", "skill_ref"])
            .optional()
            .describe("Kind of memory. Default 'fact'."),
          scope: z.string().optional(),
          fact_key: z
            .string()
            .optional()
            .describe("Stable key for a value that can change, e.g. 'deploy:release-day'. Same key supersedes the old row."),
          importance: z.number().min(0).max(1).optional().describe("0-1, default 0.5. Higher ranks first."),
          labels: z.array(z.string()).optional().describe("Tags, e.g. ['pinned','security']. 'pinned' items always appear in get_context."),
          trust: z.enum(["owner_asserted", "source_extracted", "agent_reported", "inferred"]).optional(),
        }),
      },
      guard(
        async (args: {
          content: string;
          type?: string;
          scope?: string;
          fact_key?: string;
          importance?: number;
          labels?: string[];
          trust?: string;
        }) => {
          requireWrite();
          const me = auth();
          const result = await writeMemory({
            scope: await scopeFor(args.scope),
            type: args.type ?? "fact",
            content: args.content,
            fact_key: args.fact_key ?? null,
            importance: args.importance,
            labels: args.labels,
            trust: args.trust ?? "agent_reported",
            actorKind: "agent",
            actorId: await actorForToken(me),
            source: `mcp:${me.tokenName}`,
          });
          return { ...result, note: result.deduped ? "Identical memory already existed." : "Stored and queued for embedding." };
        },
      ),
    );

    server.registerTool(
      "update_memory",
      {
        title: "Update memory",
        description:
          "Edit the text of an existing memory. A new version row keeps the old text, and the memory is re-embedded.",
        annotations: { readOnlyHint: false, destructiveHint: false },
        inputSchema: z.object({
          id: z.string().describe("Memory id (uuid)."),
          content: z.string().min(1).describe("The new full text."),
          reason: z.string().optional().describe("Why it changed, shown in history."),
        }),
      },
      guard(async ({ id, content, reason }: { id: string; content: string; reason?: string }) => {
        requireWrite();
        const me = auth();
        return updateMemory(id, content, reason ?? `edit via ${me.tokenName}`, await actorForToken(me));
      }),
    );

    server.registerTool(
      "list_memories",
      {
        title: "List memories",
        description: "Browse memories in a scope with filters, newest first. Useful for a review pass rather than a lookup.",
        annotations: { readOnlyHint: true },
        inputSchema: z.object({
          scope: z.string().optional(),
          type: z.string().optional(),
          state: z.enum(["active", "superseded", "deleted", "all"]).optional(),
          label: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        }),
      },
      guard(
        async (args: { scope?: string; type?: string; state?: string; label?: string; limit?: number }) => {
          const scope = await scopeFor(args.scope);
          const out = await listMemories({
            scope,
            type: args.type,
            state: args.state ?? "active",
            label: args.label,
            limit: args.limit ?? 25,
          });
          return { scope, total: out.total, labels: out.labels, results: out.results };
        },
      ),
    );

    server.registerTool(
      "memory_stats",
      {
        title: "Memory stats",
        description: "Counts by state and type, how many memories have embeddings, and how many jobs are queued.",
        annotations: { readOnlyHint: true },
        inputSchema: z.object({ scope: z.string().optional() }),
      },
      guard(async ({ scope }: { scope?: string }) => scopeStats(await scopeFor(scope))),
    );

    server.registerTool(
      "session_append",
      {
        title: "Append session note",
        description:
          "Short-term scratch notes during a task. Stored in Redis with a 7-day life, not in long-term memory. Promote anything durable into write_memory.",
        annotations: { readOnlyHint: false, destructiveHint: false },
        inputSchema: z.object({
          session_id: z.string().describe("Your task/session id."),
          note: z.string().min(1),
          scope: z.string().optional(),
        }),
      },
      guard(async ({ session_id, note, scope }: { session_id: string; note: string; scope?: string }) => {
        requireWrite();
        const s = await scopeFor(scope);
        const { store } = await sessionAppend(s, session_id, note);
        return { scope: s, session_id, appended: true, store };
      }),
    );

    server.registerTool(
      "session_get",
      {
        title: "Read session notes",
        description: "Resume a task by reading back the notes written during it.",
        annotations: { readOnlyHint: true },
        inputSchema: z.object({ session_id: z.string(), scope: z.string().optional() }),
      },
      guard(async ({ session_id, scope }: { session_id: string; scope?: string }) => {
        const s = await scopeFor(scope);
        return { scope: s, session_id, notes: await sessionGet(s, session_id) };
      }),
    );

    server.registerTool(
      "search_skills",
      {
        title: "Search skills",
        description: "Find a reusable procedure by task. Returns command, title and description only — load the body with get_skill.",
        annotations: { readOnlyHint: true },
        inputSchema: z.object({ q: z.string().optional(), scope: z.string().optional() }),
      },
      guard(async ({ q, scope }: { q?: string; scope?: string }) => searchSkills(await scopeFor(scope), q ?? "")),
    );

    server.registerTool(
      "get_skill",
      {
        title: "Load one skill",
        description: "Fetch one skill's full body, including the parts search_skills keeps out of the context window.",
        annotations: { readOnlyHint: true },
        inputSchema: z.object({ command: z.string().describe("Skill command, e.g. '/review'."), scope: z.string().optional() }),
      },
      guard(async ({ command, scope }: { command: string; scope?: string }) => getSkill(await scopeFor(scope), command)),
    );
  },
  {
    serverInfo: { name: "wam-db", version: "1.0.0" },
    instructions:
      "Whole Agent Memory. Start a task with get_context, look things up with search_memory, and save durable facts with write_memory. Use fact_key for values that change so the old row is superseded rather than duplicated.",
    verboseLogs: false,
  },
);

async function withAuth(req: Request): Promise<Response> {
  const raw = bearerFrom(req);
  const ctx = raw ? await resolveToken(raw) : null;

  if (!ctx) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Unauthorized: send a valid bearer token (create one in WAM-db → Settings)." },
      }),
      {
        status: 401,
        headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="wam-db"' },
      },
    );
  }

  // Stamp last-used without holding up the request.
  void touchToken(ctx.tokenId).catch(() => {});

  return authStore.run(ctx, () => mcpHandler(req));
}

export { withAuth as GET, withAuth as POST, withAuth as DELETE };
