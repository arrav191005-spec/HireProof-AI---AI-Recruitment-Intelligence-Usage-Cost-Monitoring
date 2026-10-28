// Semantic (embedding-based) retrieval availability.
//
// Stage 2 of the search roadmap: embeddings are only used when BOTH an
// embedding provider is configured AND the data backend supports vectors
// (pgvector). Without them, search runs in keyword+requirement mode and the
// UI/API say so explicitly — semantic search is never faked.
import { OPENAI_API_KEY } from '@/lib/config';

export async function semanticAvailable() {
  return Boolean(OPENAI_API_KEY);
}

export async function embedTexts(texts) {
  if (!OPENAI_API_KEY) {
    return { enabled: false, vectors: null, model: null };
  }
  // Real provider call lives in lib/ai-client.js; imported lazily so the demo
  // path never loads network code.
  const { embedTexts: providerEmbed } = await import('@/lib/ai-client');
  return providerEmbed(texts);
}
