// ---------------------------------------------------------------------------
// Backend selection for the repository layer.
//
// - If DATABASE_URL is set AND PostgreSQL answers, use lib/repo/postgres.js.
// - Otherwise fall back to the in-memory demo store (lib/repo/memory.js) and
//   surface that clearly in the UI (see the banner on Settings/Overview).
// The probe result is cached for the process lifetime.
// ---------------------------------------------------------------------------
import { getRepoBackend as getBackendOverride } from '@/lib/config';

let cached = null;
let probing = null;

async function probe() {
  const { DATABASE_URL } = await import('@/lib/config');
  if (!DATABASE_URL) {
    return { backend: (await import('./memory.js')).default, info: null };
  }
  try {
    const pg = (await import('./postgres.js')).default;
    const info = await pg.getBackendInfo();
    return { backend: pg, info };
  } catch (err) {
    console.warn(
      `[hireproof] PostgreSQL unavailable (${err?.code ?? err?.message ?? 'unknown'}); ` +
        'falling back to the in-memory demo store.'
    );
    return { backend: (await import('./memory.js')).default, info: null };
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
