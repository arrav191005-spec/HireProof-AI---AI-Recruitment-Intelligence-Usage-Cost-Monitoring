// ---------------------------------------------------------------------------
// Backend selection for the repository layer.
//
// - If DATABASE_URL is set AND PostgreSQL answers, use lib/repo/postgres.js.
// - Otherwise fall back to the in-memory demo store (lib/repo/memory.js) and
//   surface that clearly in the UI (see the banner on Settings/Overview).
// The probe result is cached for the process lifetime.
//
// On Cloudflare Workers the returned repo is wrapped in a per-isolate
// read-through cache (see `wrapWithCache`): the free Workers plan allows
// 10 ms of CPU per request, and list pages otherwise re-run 3–9 SQL round-trips
// (each a fresh TCP connection) on every view. Reads are memoised for a short
// TTL with promise-level dedupe; ANY write clears the whole cache through a
// version guard, so data never goes stale after a mutation. The wrapper is a
// no-op outside the Workers runtime — local dev and `npm test` see the raw
// repository, so test semantics are unchanged.
// ---------------------------------------------------------------------------
import { getRepoBackend as getBackendOverride } from '@/lib/config';
import { isWorkersRuntime } from '@/database/tls.js';

let cached = null;
let probing = null;

// Read methods whose results may be reused across requests within the TTL.
// Deliberately an allowlist: anything not listed (create*, update*, add*,
// recordSearchEvent, logAudit, closePool…) is treated as a write and
// invalidates the cache.
const READ_METHODS = new Set([
  'getBackendInfo',
  'listJobs',
  'getJob',
  'getJobRequirements',
  'listCandidates',
  'getCandidate',
  'getCandidateSkills',
  'getCandidateEvidence',
  'getCandidateSubmissions',
  'getCandidateApplications',
  'getJobApplications',
  'listAssessments',
  'getAssessment',
  'listSubmissions',
  'recentSearchEvents',
  'analyticsSummary',
  'recentAuditLogs',
  'searchCorpus',
  // list-page aggregates
  'listSkillVocab',
  'applicationCounts',
  'candidateRollups',
]);

const CACHE_TTL_MS = 15_000;
const MAX_ENTRIES = 128;

function wrapWithCache(repo) {
  if (!isWorkersRuntime()) return repo;

  const entries = new Map(); // key -> { promise, expires }
  let version = 0; // bumped on every write; guards read results racing a write

  const store = (key, promise, atVersion) => {
    if (atVersion !== version) return; // a write landed while this read ran
    if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
    entries.set(key, { promise, expires: Date.now() + CACHE_TTL_MS });
    promise.catch(() => entries.delete(key)); // never memoise failures
  };

  return new Proxy(repo, {
    get(target, prop) {
      const fn = target[prop];
      if (typeof fn !== 'function') return fn;

      if (!READ_METHODS.has(prop)) {
        // Write path: run against the raw repo, then invalidate everything
        // (including in-flight reads resolved pre-write via the version guard).
        return (...args) => {
          const result = fn.apply(target, args);
          const done = () => {
            version += 1;
            entries.clear();
          };
          if (result && typeof result.then === 'function') result.then(done, done);
          else done();
          return result;
        };
      }

      return (...args) => {
        const key = args.length ? `${prop}:${JSON.stringify(args)}` : prop;
        const hit = entries.get(key);
        if (hit && hit.expires > Date.now()) return hit.promise;
        const atVersion = version;
        const promise = Promise.resolve(fn.apply(target, args));
        store(key, promise, atVersion);
        return promise;
      };
    },
  });
}

async function probe() {
  const { DATABASE_URL } = await import('@/lib/config');
  if (!DATABASE_URL) {
    return { backend: wrapWithCache((await import('./memory.js')).default), info: null };
  }
  try {
    const pg = (await import('./postgres.js')).default;
    const info = await pg.getBackendInfo();
    return { backend: wrapWithCache(pg), info };
  } catch (err) {
    console.warn(
      `[hireproof] PostgreSQL unavailable (${err?.code ?? err?.message ?? 'unknown'}); ` +
        'falling back to the in-memory demo store.'
    );
    return { backend: wrapWithCache((await import('./memory.js')).default), info: null };
  }
}

export default async function getRepo() {
  if (cached) return cached;
  if (!probing) {
    probing = probe().then(({ backend, info }) => {
      cached = backend;
      probing = null;
      return backend;
    });
  }
  return probing;
}

export async function getBackendInfo() {
  const override = getBackendOverride();
  if (override) return override;
  const { backend } = await (cached ? Promise.resolve({ backend: cached }) : probe());
  try {
    return await backend.getBackendInfo();
  } catch {
    return { backend: 'memory', label: 'In-memory demo store', persistent: true };
  }
}
