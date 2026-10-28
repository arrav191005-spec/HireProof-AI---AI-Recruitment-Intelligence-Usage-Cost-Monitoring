// Validation schema tests — especially the boundary between "no filter"
// (empty string from the UI) and an invalid value. Run with:
//   node --import ./tests/helpers/register-alias.mjs --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  searchRequestSchema,
  candidateCreateSchema,
  jobCreateSchema,
  evidenceReviewSchema,
} from '@/lib/validation';

// --- searchRequestSchema --------------------------------------------------------

test('searchRequestSchema accepts the exact payload the search UI sends', () => {
  const payload = {
    query: 'python backend engineer with FastAPI and Kafka experience',
    jobId: null,
    filters: {
      skill: '',
      minYears: '',
      maxYears: '',
      assessmentStatus: 'any',
      evidenceStatus: '',
      sort: 'relevance',
      onlyApplicants: false,
    },
    page: 1,
    pageSize: 6,
  };
  const parsed = searchRequestSchema.parse(payload);
  assert.equal(parsed.filters.evidenceStatus, '');
  assert.equal(parsed.pageSize, 6);
});

test('searchRequestSchema still rejects a bogus evidence status', () => {
  const result = searchRequestSchema.safeParse({
    query: 'x',
    filters: { evidenceStatus: 'definitely_verified' },
  });
  assert.equal(result.success, false);
});

test('searchRequestSchema accepts each of the five real statuses', () => {
  for (const status of ['claimed', 'supporting', 'assessment', 'not_established', 'needs_review']) {
    const r = searchRequestSchema.safeParse({ query: 'x', filters: { evidenceStatus: status } });
    assert.equal(r.success, true, `${status} should be accepted`);
  }
});

test('searchRequestSchema bounds query length and page size', () => {
  assert.equal(searchRequestSchema.safeParse({ query: 'x'.repeat(501) }).success, false);
  assert.equal(searchRequestSchema.safeParse({ query: 'x', pageSize: 51 }).success, false);
  assert.equal(searchRequestSchema.safeParse({ query: 'x', page: 0 }).success, false);
});

test('searchRequestSchema defaults let a minimal body through', () => {
  const parsed = searchRequestSchema.parse({});
  assert.equal(parsed.query, '');
  assert.equal(parsed.page, 1);
  assert.deepEqual(parsed.filters, {});
});

// --- candidateCreateSchema ------------------------------------------------------

test('candidateCreateSchema requires an upload reference and a real name', () => {
  assert.equal(candidateCreateSchema.safeParse({ uploadId: 'nope' }).success, false);
  assert.equal(candidateCreateSchema.safeParse({ uploadId: 'upl-abc12345', fullName: 'A' }).success, false);
  const ok = candidateCreateSchema.safeParse({ uploadId: 'upl-abc12345', fullName: 'Mira Odell' });
  assert.equal(ok.success, true);
});

test('candidateCreateSchema rejects non-uuid upload ids (path traversal guard)', () => {
  for (const uploadId of ['../../etc/passwd', 'upl-../../x', 'upl-abc;rm -rf']) {
    assert.equal(
      candidateCreateSchema.safeParse({ uploadId, fullName: 'Mira Odell' }).success,
      false,
      `uploadId "${uploadId}" must be rejected`
    );
  }
});

test('candidateCreateSchema bounds years of experience', () => {
  const base = { uploadId: 'upl-abc12345', fullName: 'Mira Odell' };
  assert.equal(candidateCreateSchema.safeParse({ ...base, yearsExperience: -1 }).success, false);
  assert.equal(candidateCreateSchema.safeParse({ ...base, yearsExperience: 61 }).success, false);
  assert.equal(candidateCreateSchema.safeParse({ ...base, yearsExperience: 5 }).success, true);
  assert.equal(candidateCreateSchema.safeParse({ ...base, yearsExperience: null }).success, true);
});

test('candidateCreateSchema bounds dropSkills list', () => {
  const base = { uploadId: 'upl-abc12345', fullName: 'Mira Odell' };
  assert.equal(
    candidateCreateSchema.safeParse({ ...base, dropSkills: Array(81).fill('SQL') }).success,
    false
  );
  assert.equal(candidateCreateSchema.safeParse({ ...base, dropSkills: ['SQL'] }).success, true);
});

// --- jobCreateSchema ------------------------------------------------------------

test('jobCreateSchema rejects unknown status values', () => {
  const base = { title: 'Backend Engineer' };
  assert.equal(jobCreateSchema.safeParse({ ...base, status: 'archived' }).success, false);
  for (const status of ['draft', 'open', 'closed']) {
    assert.equal(jobCreateSchema.safeParse({ ...base, status }).success, true, status);
  }
});

test('jobCreateSchema enforces skill requirement shape', () => {
  const bad = jobCreateSchema.safeParse({
    title: 'Backend Engineer',
    requiredSkills: [{ skill: '', minYears: 3 }],
  });
  assert.equal(bad.success, false);
});

// --- evidenceReviewSchema -------------------------------------------------------

test('evidenceReviewSchema only permits the five evidence statuses', () => {
  for (const status of ['claimed', 'supporting', 'assessment', 'not_established', 'needs_review']) {
    assert.equal(evidenceReviewSchema.safeParse({ status }).success, true, status);
  }
  assert.equal(evidenceReviewSchema.safeParse({ status: 'verified' }).success, false);
  assert.equal(evidenceReviewSchema.safeParse({ status: 'rejected' }).success, false);
});
