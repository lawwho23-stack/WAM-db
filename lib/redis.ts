// Short-term memory: live session notes during a task.
//
// Real store is Upstash Redis with a 7-day TTL. If Redis is not configured, or
// a call fails, notes fall back to an in-process Map so a tool call never dies
// because of a cache. The fallback is per-instance and does not survive a cold
// start — that is fine for scratch notes, which is all sessions are for.
//
// Note: @upstash/redis has no `.call()` method. Use the typed commands.

type Entry = { items: string[]; expires: number };

const mem = new Map<string, Entry>();
const TTL_SECONDS = 7 * 24 * 3600;
const TTL_MS = TTL_SECONDS * 1000;

function client() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

async function redis() {
  const env = client();
  if (!env) return null;
  const { Redis } = await import("@upstash/redis");
  return new Redis({ url: env.url, token: env.token });
}

function memGet(scope: string, sessionId: string): string[] {
  const key = `${scope}:${sessionId}`;
  const entry = mem.get(key);
  if (!entry) return [];
  if (entry.expires < Date.now()) {
    mem.delete(key);
    return [];
  }
  return entry.items;
}

export type SessionStore = "redis" | "memory";

export async function sessionAppend(
  scope: string,
  sessionId: string,
  note: string,
): Promise<{ store: SessionStore }> {
  const key = `sess:${scope}:${sessionId}`;
  const r = await redis();
  if (r) {
    try {
      await r.rpush(key, note);
      await r.expire(key, TTL_SECONDS);
      return { store: "redis" };
    } catch (e) {
      console.warn("session notes: Redis append failed, using in-memory fallback —", e instanceof Error ? e.message : e);
    }
  }

  const memKey = `${scope}:${sessionId}`;
  const entry = mem.get(memKey) ?? { items: [], expires: Date.now() + TTL_MS };
  entry.items.push(note);
  entry.expires = Date.now() + TTL_MS;
  mem.set(memKey, entry);
  return { store: "memory" };
}

export async function sessionGet(scope: string, sessionId: string): Promise<string[]> {
  const key = `sess:${scope}:${sessionId}`;
  const r = await redis();
  if (r) {
    try {
      const out = (await r.lrange(key, 0, -1)) as unknown;
      if (Array.isArray(out)) return out.map(String);
      if (typeof out === "string") {
        try {
          const parsed = JSON.parse(out);
          return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          return [out];
        }
      }
    } catch (e) {
      console.warn("session notes: Redis read failed, using in-memory fallback —", e instanceof Error ? e.message : e);
    }
  }
  return memGet(scope, sessionId);
}

export async function sessionClear(scope: string, sessionId: string) {
  const key = `sess:${scope}:${sessionId}`;
  const r = await redis();
  if (r) {
    try {
      await r.del(key);
      return { cleared: true, store: "redis" as SessionStore };
    } catch {
      /* fall through */
    }
  }
  mem.delete(`${scope}:${sessionId}`);
  return { cleared: true, store: "memory" as SessionStore };
}
