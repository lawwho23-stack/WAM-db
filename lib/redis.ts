// Short-term memory. Tries Upstash Redis, falls back to in-memory Map.
// Technical term: TTL = time to live. Old session notes auto-expire.

type Entry = { items: string[]; expires: number };
const mem = new Map<string, Entry>();
const SEVEN_DAYS = 7 * 24 * 3600 * 1000;

function useRedis() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function redisCall(cmd: string[]) {
  const { Redis } = await import("@upstash/redis");
  const r = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  // @ts-expect-error dynamic command
  return r.call(cmd[0], ...cmd.slice(1));
}

export async function sessionAppend(scope: string, sessionId: string, note: string) {
  if (useRedis()) {
    await redisCall(["RPUSH", `sess:${scope}:${sessionId}`, note]);
    await redisCall(["EXPIRE", `sess:${scope}:${sessionId}`, String(7 * 24 * 3600)]);
    return;
  }
  const k = `${scope}:${sessionId}`;
  const e = mem.get(k) ?? { items: [], expires: Date.now() + SEVEN_DAYS };
  e.items.push(note);
  mem.set(k, e);
}

export async function sessionGet(scope: string, sessionId: string): Promise<string[]> {
  if (useRedis()) {
    const out = (await redisCall(["LRANGE", `sess:${scope}:${sessionId}`, "0", "-1"])) as string[];
    return out ?? [];
  }
  return mem.get(`${scope}:${sessionId}`)?.items ?? [];
}
