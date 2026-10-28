// Server-side configuration, read once per process. Client bundles must never
// import this module — it only contains non-public values.

export function getConfig() {
  return {
    DATABASE_URL: process.env.DATABASE_URL || '',
    AI_SERVICE_URL: process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    OPENAI_CHAT_MODEL: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    MAX_RESUME_SIZE_MB: Number(process.env.MAX_RESUME_SIZE_MB || 5),
    AUTH_MODE: process.env.AUTH_MODE === 'supabase' ? 'supabase' : 'demo',
    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
  };
}

const {
  DATABASE_URL,
  AI_SERVICE_URL,
  OPENAI_API_KEY,
  OPENAI_CHAT_MODEL,
  OPENAI_EMBEDDING_MODEL,
  MAX_RESUME_SIZE_MB,
  AUTH_MODE,
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
} = getConfig();

export {
  DATABASE_URL,
  AI_SERVICE_URL,
  OPENAI_API_KEY,
  OPENAI_CHAT_MODEL,
  OPENAI_EMBEDDING_MODEL,
  MAX_RESUME_SIZE_MB,
  AUTH_MODE,
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
};

// Test hook: force the repository backend regardless of DB availability.
export function getRepoBackend() {
  return globalThis.__HIREFORCE_REPO_BACKEND__ ?? null;
}

export function aiMode() {
  return OPENAI_API_KEY ? 'configured' : 'demo';
}
