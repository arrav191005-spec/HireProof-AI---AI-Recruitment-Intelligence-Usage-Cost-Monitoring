import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ok, fail, requireUser, handleRouteError } from '@/lib/api';
import { MAX_RESUME_SIZE_MB } from '@/lib/config';
import { parseResumePdf, extractResumeEvidence } from '@/lib/ai-client';
import { UPLOAD_DIR, uploadPdfPath, uploadMetaPath } from '@/lib/uploads';

export const dynamic = 'force-dynamic';

// Resume files live on the server filesystem (Supabase Storage has no buckets
// on this project). The directory is gitignored; files are never served
// directly — only metadata reaches the client.
const PDF_MAGIC = Buffer.from('%PDF-');

/**
 * POST /api/resumes — upload a PDF resume, parse it and extract grounded
 * evidence for review. Nothing is written to the database here: the reviewer
 * confirms (and edits) the extraction first, then POST /api/candidates
 * commits it together with the candidate record.
 */
export async function POST(request) {
  try {
    await requireUser();

    const form = await request.formData().catch(() => null);
    if (!form) return fail(415, 'Expected a multipart/form-data upload.');

    const file = form.get('file');
    if (!file || typeof file === 'string') return fail(422, 'Choose a PDF resume to upload.');
    if (file.type !== 'application/pdf') {
      return fail(415, 'Only PDF resumes are accepted (application/pdf).');
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const maxBytes = MAX_RESUME_SIZE_MB * 1024 * 1024;
    if (bytes.length === 0) return fail(422, 'The uploaded file is empty.');
    if (bytes.length > maxBytes) {
      return fail(413, `The file is larger than ${MAX_RESUME_SIZE_MB} MB.`);
    }
    if (!bytes.subarray(0, 5).equals(PDF_MAGIC)) {
      return fail(415, 'This file does not look like a real PDF (missing the %PDF header).');
    }

    // Parse (Python document service → unpdf fallback), then extract evidence.
    // Both layers ground every excerpt against the actual document text.
    const parsed = await parseResumePdf({ filename: file.name || 'resume.pdf', bytes });
    const extraction = await extractResumeEvidence({
      filename: file.name,
      text: parsed.fullText,
      pages: parsed.pages,
    });

    const uploadId = `upl-${crypto.randomUUID()}`;
    const storagePath = path.relative(process.cwd(), uploadPdfPath(uploadId));
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(uploadPdfPath(uploadId), bytes);

    const meta = {
      uploadId,
      filename: (file.name || 'resume.pdf').slice(0, 200),
      mimeType: 'application/pdf',
      fileSize: bytes.length,
      pageCount: parsed.pageCount,
      storagePath,
      uploadedAt: new Date().toISOString(),
      truncated: Boolean(parsed.truncated),
      parseVia: parsed.via,
      extraction,
    };
    await writeFile(uploadMetaPath(uploadId), JSON.stringify(meta, null, 2));

    // Audit only the metadata — never document contents.
    console.info(
      `[hireproof] resume uploaded id=${uploadId} bytes=${bytes.length} pages=${parsed.pageCount} ` +
        `parse=${parsed.via} extract=${extraction.via}`
    );

    return ok(
      {
        uploadId,
        filename: meta.filename,
        fileSize: meta.fileSize,
        pageCount: meta.pageCount,
        truncated: meta.truncated,
        extraction,
        modes: { parse: parsed.via, extraction: extraction.via },
      },
      { created: true }
    );
  } catch (err) {
    if (err?.fatal && err?.status) return fail(err.status, err.message);
    return handleRouteError(err, 'POST /api/resumes');
  }
}
