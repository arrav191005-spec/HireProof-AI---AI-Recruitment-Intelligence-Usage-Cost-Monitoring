// Shared helpers for resume uploads. Files and review metadata live on the
// server filesystem (Supabase Storage has no buckets on this project); the
// directory is gitignored and nothing in it is ever served directly.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const UPLOAD_DIR = path.join(process.cwd(), 'storage', 'resumes');

export function uploadPdfPath(uploadId) {
  return path.join(UPLOAD_DIR, `${uploadId}.pdf`);
}

export function uploadMetaPath(uploadId) {
  return path.join(UPLOAD_DIR, `${uploadId}.meta.json`);
}

/** Read the server-side extraction result for an upload. Null when missing. */
export async function readUploadMeta(uploadId) {
  try {
    return JSON.parse(await readFile(uploadMetaPath(uploadId), 'utf8'));
  } catch {
    return null;
  }
}
