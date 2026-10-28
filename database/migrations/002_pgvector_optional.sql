-- ---------------------------------------------------------------------------
-- HireProof AI — 002 (OPTIONAL): pgvector embeddings for semantic search
--
-- The migration runner treats any failure of a file matching *optional*.sql as
-- a WARNING: it rolls the file back, records it as status 'failed' in
-- schema_migrations and continues (non-optional files abort the run).
--
-- Layout:
--   evidence_embeddings — one row per (evidence, model) embedding. The column
--   is an untyped `vector` so different models (384/1536/3072 dims) can share
--   the table; `dimensions` records the per-row width.
--
-- Index note: pgvector ANN indexes (hnsw / ivfflat, vector_cosine_ops) refuse
-- an untyped vector column ("column does not have dimensions"). The index is
-- therefore attempted inside a guarded block: if the column ever gains a typmod
-- (e.g. alter table … alter column embedding type vector(1536)) the index can
-- be created by re-running this file after removing its recorded row; today it
-- logs a NOTICE and the table is still usable with sequential scans.
-- ---------------------------------------------------------------------------
create extension if not exists vector;

create table if not exists evidence_embeddings (
  id          bigserial primary key,
  evidence_id text not null references candidate_evidence (id) on delete cascade,
  model       text not null,
  dimensions  integer not null,
  embedding   vector,                              -- untyped on purpose; see header
  created_at  timestamptz not null default now()
);
alter table evidence_embeddings enable row level security;

do $$
begin
  execute 'create index if not exists evidence_embeddings_embedding_idx on evidence_embeddings using hnsw (embedding vector_cosine_ops)';
exception when others then
  raise notice 'optional: cosine index skipped — %', sqlerrm;
end $$;

-- same lockdown as migration 001 (objects created after 001's default-ACL
-- revoke already lack anon grants; revoke again to be certain)
revoke all on evidence_embeddings from anon, authenticated;
do $$
begin
  execute 'revoke all on sequence evidence_embeddings_id_seq from anon, authenticated';
exception when others then
  raise notice 'sequence revoke skipped: %', sqlerrm;
end $$;
