/**
 * Embedding provider — OpenAI text-embedding-3-small (1536d) via direct fetch.
 *
 * Reasons for picking this model over a Groq/Anthropic equivalent:
 *   - Groq's catalog is text generation only (no embedding endpoint).
 *   - text-embedding-3-small is industry standard, cheap (~$0.00002 / 1K),
 *     and dimension-matched to our pgvector column (1536).
 *
 * Returns null when OPENAI_API_KEY is missing so the rest of the platform
 * still works in development without the optional key. Downstream callers
 * (index + retrieve) treat null as "RAG disabled" and surface a clear
 * "set OPENAI_API_KEY to enable" message in the UI.
 *
 * A direct fetch is preferred over the official SDK so the rest of the
 * project stays free of an additional dependency. Swap to @ai-sdk/openai
 * or the official `openai` SDK if richer features (retries, streaming) are
 * needed later.
 */

const ENDPOINT = 'https://api.openai.com/v1/embeddings';
const MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

export type EmbeddingResult = {
  embedding: number[];
  tokens: number;
};

function getApiKey(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

export function isEmbeddingEnabled(): boolean {
  return getApiKey() !== null;
}

async function embedRaw(inputs: string[]): Promise<EmbeddingResult[] | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  if (inputs.length === 0) return [];

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: inputs,
      encoding_format: 'float',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`embed: OpenAI ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    data: Array<{ index: number; embedding: number[] }>;
    usage: { prompt_tokens: number };
  };
  // OpenAI returns embeddings in input order, but defensively sort by index.
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  const perInputTokens = Math.ceil(data.usage.prompt_tokens / inputs.length);
  return sorted.map((d) => ({ embedding: d.embedding, tokens: perInputTokens }));
}

export async function embedOne(text: string): Promise<EmbeddingResult | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const results = await embedRaw([trimmed]);
  return results?.[0] ?? null;
}

export async function embedMany(texts: string[]): Promise<EmbeddingResult[] | null> {
  const cleaned = texts.map((t) => t.trim()).filter((t) => t.length > 0);
  if (cleaned.length === 0) return [];
  // OpenAI accepts up to 2048 inputs per request; chunk to 96 to keep
  // per-call latency under ~3s and stay well within the 8K token-per-input cap.
  const BATCH = 96;
  const out: EmbeddingResult[] = [];
  for (let i = 0; i < cleaned.length; i += BATCH) {
    const slice = cleaned.slice(i, i + BATCH);
    const batch = await embedRaw(slice);
    if (!batch) return null;
    out.push(...batch);
  }
  return out;
}
