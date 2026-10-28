// Repository-layer tests for the in-memory fallback store. The store path is
// derived from process.cwd() at import time, so this file chdirs into a
// temporary directory FIRST and then imports the repo — the real
// .data/demo-store.json is never touched. Run with:
//   node --import ./tests/helpers/register-alias.mjs --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hireproof-repo-'));
process.chdir(tmp);

const { default: memory } = await import('@/lib/repo/memory');

test('searchCorpus returns one entry per candidate with its relations attached', async () => {
  const corpus = await memory.searchCorpus();
  assert.ok(corpus.length > 0, 'store should be seeded');
  for (const e of corpus) {
    assert.ok(e.candidate.id, 'candidate id present');
    assert.ok(Array.isArray(e.skills));
    assert.ok(Array.isArray(e.evidence));
    assert.ok(Array.isArray(e.submissions));
    for (const ev of e.evidence) {
      assert.equal(ev.candidateId, e.candidate.id, 'evidence belongs to its candidate');
    }
  }
});

test('listCandidates filters by skill and by years', async () => {
  const all = await memory.listCandidates({ page: 1, pageSize: 100 });
  assert.ok(all.items.length > 0);

  const python = await memory.listCandidates({ skill: 'Python', page: 1, pageSize: 100 });
  assert.ok(python.items.length > 0);
  assert.ok(python.items.length <= all.items.length);
  for (const c of python.items) {
    assert.ok(
      c.skills.some((s) => ['Python'].includes(s.skill)),
      `${c.fullName} does not have Python`
    );
  }

  const seniors = await memory.listCandidates({ minYears: 6, page: 1, pageSize: 100 });
  for (const c of seniors.items) assert.ok(c.yearsExperience >= 6, `${c.fullName} under 6 years`);
});

test('listCandidates pages deterministically without duplicating records', async () => {
  const p1 = await memory.listCandidates({ page: 1, pageSize: 3 });
  const p2 = await memory.listCandidates({ page: 2, pageSize: 3 });
  assert.equal(p1.items.length, 3);
  const ids = [...p1.items, ...p2.items].map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'a candidate appeared on two pages');
});

test('getCandidate returns null for an unknown id instead of throwing', async () => {
  assert.equal(await memory.getCandidate('cand-does-not-exist'), null);
});

test('analyticsSummary reports exact counts and a valid 6-week series', async () => {
  const s = await memory.analyticsSummary();
  assert.equal(typeof s.openJobs, 'number');
  assert.equal(typeof s.totalCandidates, 'number');

  const corpus = await memory.searchCorpus();
  assert.equal(s.totalCandidates, corpus.length, 'candidate count must match the corpus');

  for (const status of ['claimed', 'supporting', 'assessment', 'not_established', 'needs_review']) {
    assert.equal(typeof s.evidenceByStatus[status], 'number', `${status} count missing`);
  }
  const sum = Object.values(s.evidenceByStatus).reduce((a, b) => a + b, 0);
  const totalEvidence = corpus.reduce((a, e) => a + e.evidence.length, 0);
  assert.equal(sum, totalEvidence, 'status counts must add up to the real total');

  assert.equal(s.weeks.length, 6, 'six weeks of activity');
  for (const w of s.weeks) {
    assert.ok(w.label, 'each week has a label');
    for (const key of ['applications', 'searches', 'uploads']) {
      assert.equal(typeof w[key], 'number', `${key} must be a count`);
      assert.ok(w[key] >= 0, `${key} must not be negative`);
    }
  }
  // Weeks must be contiguous Mondays — the anchor bug produced NaN dates.
  const parsed = s.weeks.map((w) => new Date(w.label));
  for (const d of parsed) assert.ok(!Number.isNaN(d.getTime()), 'week label is a real date');
});

test('createCandidateFromExtraction never reuses an existing id', async () => {
  const before = await memory.searchCorpus();
  const existingSlug = before[0].candidate.fullName;
  const beforeIds = new Set(before.map((e) => e.candidate.id));

  const base = {
    fullName: existingSlug, // same name → same slug → collision pressure
    headline: 'Test Duplicate',
    skills: [],
    evidence: [],
    experience: [],
    education: [],
    projects: [],
    resume: null,
  };
  const a = await memory.createCandidateFromExtraction({ ...base });
  const b = await memory.createCandidateFromExtraction({ ...base });

  assert.notEqual(a.id, b.id, 'two candidates must not share an id');
  assert.ok(!beforeIds.has(a.id), 'first id must be fresh');
  assert.ok(!beforeIds.has(b.id), 'second id must be fresh');

  const after = await memory.searchCorpus();
  const ids = after.map((e) => e.candidate.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids in the corpus');
});

test('duplicate evidence ids are repaired on load (React key collisions)', async () => {
  // The store file is written by this test and then reloaded from disk.
  const file = path.join(process.cwd(), '.data', 'demo-store.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(raw.evidence) && raw.evidence.length >= 2) {
    raw.evidence[1].id = raw.evidence[0].id; // simulate a persisted duplicate
    fs.writeFileSync(file, JSON.stringify(raw, null, 1));
  }
  // Force a reload by re-importing the resolved file with a cache-busting
  // query (cwd is the temp dir here, so anchor on this file's own location).
  const resolved = new URL('../lib/repo/memory.js', import.meta.url);
  const fresh = await import(`${resolved.href}?reload=${Date.now()}`);
  const corpus = await fresh.default.searchCorpus();
  const evIds = corpus.flatMap((e) => e.evidence.map((x) => x.id));
  assert.equal(new Set(evIds).size, evIds.length, 'evidence ids must be unique after repair');
});
