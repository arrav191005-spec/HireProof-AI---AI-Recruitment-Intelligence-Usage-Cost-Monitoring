// Shared resume-upload storage.
//
// Three storage targets, one interface (chosen at runtime):
//   - Node (local `npm run dev`, CLI scripts, tests): filesystem under
//     storage/resumes/ (gitignored, never served directly).
//   - Cloudflare Workers + RESUME_UPLOADS R2 binding: object storage — raw PDF
//     bytes and the .meta.json extraction in the bucket (enable by uncommenting
//     r2_buckets in wrangler.jsonc; no code changes needed).
//   - Cloudflare Workers without the binding (current state — R2 subscription
//     not activated): a per-isolate in-memory Map holding the .meta.json
//     records. The raw PDF bytes are NOT retained in this mode (they are never
//     read back — see below). Upload → save must happen in the same isolate;
//     an isolate cold start between them yields an honest 404 ("upload session
//     is no longer available"). Documented in README known limitations.
//
// Only the .meta.json is ever read back (by POST /api/candidates); the PDF is
// written for archival/auditability and referenced by a storagePath recorded on
// the candidate. Parsing never re-reads from storage — it works on the bytes
// already in memory.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getCloudflareContext } from '@opennextjs/cloudflare';

const onWorkers =
  typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';

// Workers-without-R2 fallback: uploadId -> meta record (JSON-serializable).
// Module scope = per isolate; survives across requests, lost on cold start.
const memoryUploads = new Map();

export const UPLOAD_DIR = path.join(process.cwd(), 'storage', 'resumes');

export function uploadPdfPath(uploadId) {
  return path.join(UPLOAD_DIR, `${uploadId}.pdf`);
}

export function uploadMetaPath(uploadId) {
  return path.join(UPLOAD_DIR, `${uploadId}.meta.json`);
}

function r2Key(uploadId, ext) {
  return `resumes/${uploadId}.${ext}`;
}

/** R2 bucket binding, or null when unavailable (not on Workers / not bound). */
function getBucket() {
  if (!onWorkers) return null;
  try {
    return getCloudflareContext().env.RESUME_UPLOADS ?? null;
  } catch {
    // No request context (build/SSG) — treat as unbound.
    return null;
  }
}

/** Human-readable storage location, shown on the Settings page. */
export function resumeStorageInfo() {
  if (!onWorkers) {
    return {
      value: 'server filesystem',
      detail: 'storage/resumes/ (gitignored, never served publicly)',
    };
  }
  if (getBucket()) {
    return {
      value: 'Cloudflare R2 bucket',
      detail: 'binding RESUME_UPLOADS · durable across deploys and cold starts, never served publicly',
    };
  }
  return {
    value: 'in-memory (ephemeral)',
    detail:
      'Workers has no filesystem and no R2 binding — upload sessions live in this isolate only and clear on cold start',
  };
}

/**
 * Persist a fresh upload: the raw PDF bytes plus the review metadata (which
 * embeds the parsed extraction). Returns the storagePath recorded on the
 * candidate so it stays meaningful on all three storage targets.
 */
export async function storeResumeUpload({ uploadId, bytes, meta }) {
  if (onWorkers) {
    const bucket = getBucket();
    const storagePath = bucket
      ? `r2://RESUME_UPLOADS/${r2Key(uploadId, 'pdf')}`
      : `memory://resume-uploads/${uploadId}`;
    const record = { ...meta, storagePath };
    if (bucket) {
      await bucket.put(r2Key(uploadId, 'pdf'), bytes, {
        httpMetadata: { contentType: 'application/pdf' },
      });
      await bucket.put(r2Key(uploadId, 'meta.json'), JSON.stringify(record, null, 2), {
        httpMetadata: { contentType: 'application/json' },
      });
    } else {
      memoryUploads.set(uploadId, record);
    }
    return storagePath;
  }

  const storagePath = path.relative(process.cwd(), uploadPdfPath(uploadId));
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(uploadPdfPath(uploadId), bytes);
  await writeFile(uploadMetaPath(uploadId), JSON.stringify({ ...meta, storagePath }, null, 2));
  return storagePath;
}

/** Read the server-side extraction result for an upload. Null when missing. */
export async function readUploadMeta(uploadId) {
  try {
    if (onWorkers) {
      const bucket = getBucket();
      if (!bucket) return memoryUploads.get(uploadId) ?? null;
      const obj = await bucket.get(r2Key(uploadId, 'meta.json'));
      return obj ? await obj.json() : null;
    }
    return JSON.parse(await readFile(uploadMetaPath(uploadId), 'utf8'));
  } catch {
    return null;
  }
}

/** Rewrite the metadata (e.g. mark an upload consumed). */
export async function writeUploadMeta(uploadId, meta) {
  if (onWorkers) {
    const bucket = getBucket();
    if (!bucket) {
      memoryUploads.set(uploadId, meta);
      return;
    }
    await bucket.put(r2Key(uploadId, 'meta.json'), JSON.stringify(meta, null, 2), {
      httpMetadata: { contentType: 'application/json' },
    });
    return;
  }
  await writeFile(uploadMetaPath(uploadId), JSON.stringify(meta, null, 2));
}
