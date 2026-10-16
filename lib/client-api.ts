/** A small JSON fetch for client components: throws with the server's message. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = body?.error;
    const message =
      typeof detail === "string"
        ? detail
        : typeof detail === "object" && detail !== null
          ? Object.entries(detail as Record<string, string[]>)
              .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(", ") : messages}`)
              .join(" · ")
          : `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return body as T;
}
