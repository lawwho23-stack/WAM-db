// Embeddings turn text into vectors (lists of numbers) that capture meaning.
// Same meaning = close vectors. We store 1024 numbers per memory.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/embeddings";

export function embedModel() {
  return process.env.EMBED_MODEL || "perplexity/pplx-embed-v1-0.6b";
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY missing — keyword search still works.");
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "agent-memory",
      "X-Title": "agent-memory",
    },
    body: JSON.stringify({ model: embedModel(), input: texts, dimensions: 1024 }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Embed failed ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  return (json.data as { embedding: number[] }[]).map((d) => d.embedding);
}

// pgvector wants "[1,2,3]" text form.
export function toPgVector(v: number[]): string {
  return `[${v.join(",")}]`;
}
