#!/usr/bin/env node
// ---------------------------------------------------------------------------
// HireProof AI — repository smoke test (PostgreSQL backend).
//
//   node database/smoke-test.js
//
// Verifies lib/repo/postgres.js against the reference behaviour of
// lib/repo/memory.js using lib/demo-data.js as the oracle. The memory backend
// itself is NOT imported (it would create .data/demo-store.json); instead the
// expected values are derived from the demo dataset with the same
// filter/sort/paginate semantics memory.js implements.
//
// Phases:
//   1. read-only parity — every list/get/search/analytics method, deep-comparing
//      key sets, value types and list ORDER against the demo-derived oracle;
//   2. mutations — createJob/updateJob, createCandidateFromExtraction,
//      addEvidence/updateEvidence, createSubmission/updateSubmission,
//      createApplication/updateApplicationStage, updateCandidate,
//      recordSearchEvent/logAudit — each verified then cleaned up;
//   3. cleanup — deletes ONLY the rows this run created (own pool, exact ids),
//      then asserts the seeded row counts are back to the demo baseline.
//
// Timestamp VALUES can never match a live database, so createdAt/updatedAt/
// uploadedAt/submittedAt/reviewedAt are compared as epoch milliseconds.
// Deep-compare tolerance: a key absent in the oracle but NULL in the database
// is accepted (evidence.location is the only such column — see README).
//
// Exit code: 0 = all checks passed, 1 = at least one mismatch.
// ---------------------------------------------------------------------------
import seed from '../lib/demo-data.js'; // static: demo-data reads no env

await import('./load-env.js');

const { default: pg } = await import('pg');
const { buildSslConfig } = await import('./tls.js');
const { default: repo } = await import('../lib/repo/postgres.js');
const { closePool } = await import('../lib/repo/postgres.js');

// --- oracle: memory.js semantics over lib/demo-data.js ----------------------

const matches = (text, q) => text?.toLowerCase().includes(q);

function oraclePaginate(items, page, pageSize) {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pageCount);
  return { items: items.slice((p - 1) * pageSize, p * pageSize), total, page: p, pageCount };
}

function oracleListJobs({ status, q, page = 1, pageSize = 20 } = {}) {
  let items = [...seed.jobs];
  if (status && status !== 'all') items = items.filter((j) => j.status === status);
  if (q) {
    const query = q.toLowerCase();
    items = items.filter(
      (j) =>
        matches(j.title, query) ||
        matches(j.department, query) ||
        matches(j.location, query) ||
        matches(j.description, query)
    );
  }
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return oraclePaginate(items, page, pageSize);
}

function oracleListCandidates({ q, skill, minYears, maxYears, evidenceStatus, page = 1, pageSize = 10, sort = 'recent' } = {}) {
  let items = [...seed.candidates];
  if (evidenceStatus) {
    items = items.filter((c) => seed.evidence.some((ev) => ev.candidateId === c.id && ev.status === evidenceStatus));
  }
  if (q) {
    const query = q.toLowerCase();
    items = items.filter(
      (c) =>
        matches(c.fullName, query) ||
        matches(c.headline, query) ||
        matches(c.summary, query) ||
        matches(c.currentCompany, query) ||
        seed.candidateSkills.some((sk) => sk.candidateId === c.id && matches(sk.skill, query))
    );
  }
  if (skill) {
    const wanted = skill.toLowerCase();
    items = items.filter((c) =>
      seed.candidateSkills.some((sk) => sk.candidateId === c.id && sk.skill.toLowerCase() === wanted)
    );
  }
  if (minYears != null && minYears !== '') items = items.filter((c) => c.yearsExperience >= Number(minYears));
  if (maxYears != null && maxYears !== '') items = items.filter((c) => c.yearsExperience <= Number(maxYears));

  if (sort === 'experience') items.sort((a, b) => b.yearsExperience - a.yearsExperience);
  else if (sort === 'name') items.sort((a, b) => a.fullName.localeCompare(b.fullName));
  else items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const result = oraclePaginate(items, page, pageSize);
  return {
    ...result,
    items: result.items.map((c) => ({
      ...c,
      skills: seed.candidateSkills.filter((sk) => sk.candidateId === c.id),
    })),
  };
}

function oracleRequirements(jobId) {
  const job = seed.jobs.find((j) => j.id === jobId);
  if (!job) return null;
  return [
    ...job.requiredSkills.map((r) => ({ ...r, category: 'required' })),
    ...job.preferredSkills.map((r) => ({ ...r, category: 'preferred' })),
  ];
}

function oracleCandidate(id) {
  const candidate = seed.candidates.find((c) => c.id === id);
  if (!candidate) return null;
  return {
    ...candidate,
    skills: seed.candidateSkills.filter((sk) => sk.candidateId === id),
    experience: seed.experiences.filter((e) => e.candidateId === id),
    education: seed.education.filter((e) => e.candidateId === id),
    projects: seed.projects.filter((p) => p.candidateId === id),
    resume: seed.resumes.find((r) => r.candidateId === id) ?? null,
  };
}

function oracleCorpus() {
  return seed.candidates.map((c) => ({
    candidate: c,
    skills: seed.candidateSkills.filter((sk) => sk.candidateId === c.id),
    evidence: seed.evidence.filter((ev) => ev.candidateId === c.id),
    experience: seed.experiences.filter((e) => e.candidateId === c.id),
    projects: seed.projects.filter((p) => p.candidateId === c.id),
    resume: seed.resumes.find((r) => r.candidateId === c.id) ?? null,
    submissions: seed.assessmentSubmissions
      .filter((x) => x.candidateId === c.id)
      .map((x) => ({ ...x, assessment: seed.assessments.find((a) => a.id === x.assessmentId) ?? null })),
    applications: seed.applications.filter((a) => a.candidateId === c.id),
  }));
}

function oracleAnalytics() {
  const openJobs = seed.jobs.filter((j) => j.status === 'open').length;
  const byStage = {};
  for (const stage of ['applied', 'screening', 'assessment', 'interview', 'offer', 'hired']) {
    byStage[stage] = seed.applications.filter((a) => a.stage === stage).length;
  }
  const evidenceByStatus = {};
  for (const status of ['claimed', 'supporting', 'assessment', 'not_established', 'needs_review']) {
    evidenceByStatus[status] = seed.evidence.filter((e) => e.status === status).length;
  }
  // Corrected Monday-anchored weeks (memory.js's own arithmetic has a fatal
  // setUTCDate/ms bug — RangeError — so this oracle uses the intended math,
  // which lib/repo/postgres.js implements).
  const weeks = [];
  const msWeek = 7 * 24 * 3600 * 1000;
  const anchor = new Date();
  anchor.setUTCHours(0, 0, 0, 0);
  const dow = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - dow - 5 * 7);
  for (let i = 0; i < 6; i++) {
    const start = new Date(anchor.getTime() + i * msWeek);
    const end = new Date(start.getTime() + msWeek);
    weeks.push({
      weekStart: start.toISOString().slice(0, 10),
      label: start.toISOString().slice(5, 10),
      applications: seed.applications.filter((a) => Date.parse(a.createdAt) >= start && Date.parse(a.createdAt) < end).length,
      searches: seed.searchEvents.filter((e) => Date.parse(e.createdAt) >= start && Date.parse(e.createdAt) < end).length,
      uploads: seed.resumes.filter((r) => Date.parse(r.uploadedAt) >= start && Date.parse(r.uploadedAt) < end).length,
    });
  }
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  return {
    openJobs,
    totalJobs: seed.jobs.length,
    totalCandidates: seed.candidates.length,
    completedAssessments: seed.assessmentSubmissions.filter((x) => x.status === 'completed').length,
    pendingReviews:
      seed.assessmentSubmissions.filter((x) => x.status === 'manual_review').length +
      seed.evidence.filter((e) => e.status === 'needs_review' || e.status === 'claimed').length,
    byStage,
    evidenceByStatus,
    totalApplications: seed.applications.length,
    searchesLast30d: seed.searchEvents.filter((e) => Date.parse(e.createdAt) >= cutoff).length,
    weeks,
  };
}

// --- deep comparator ---------------------------------------------------------

const TS_KEYS = new Set(['createdAt', 'updatedAt', 'uploadedAt', 'submittedAt', 'reviewedAt']);

function compare(actual, expected, path, diffs) {
  if (diffs.length > 20) return; // cap noise
  if (actual === expected) return;

  if (TS_KEYS.has(path.split('.').pop())) {
    const a = Date.parse(actual);
    const b = Date.parse(expected);
    if (Number.isNaN(a) || Number.isNaN(b) || a !== b) {
      diffs.push(`${path}: expected ${JSON.stringify(expected)} (${b} ms), got ${JSON.stringify(actual)} (${a} ms)`);
    }
    return;
  }

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      diffs.push(`${path}: array vs non-array`);
      return;
    }
    if (actual.length !== expected.length) {
      diffs.push(`${path}: expected ${expected.length} items, got ${actual.length}`);
      return;
    }
    expected.forEach((e, i) => compare(actual[i], e, `${path}[${i}]`, diffs));
    return;
  }

  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const k of keys) {
      // Tolerance: a key the oracle lacks but the database stores as NULL is
      // accepted (evidence.location for manually added rows — see header).
      if (!(k in expected) && actual[k] == null) continue;
      if (k in expected && !(k in actual)) {
        diffs.push(`${path}.${k}: missing in actual (expected ${JSON.stringify(expected[k])})`);
        continue;
      }
      if (!(k in expected)) {
        diffs.push(`${path}.${k}: unexpected key with value ${JSON.stringify(actual[k])}`);
        continue;
      }
      compare(actual[k], expected[k], `${path}.${k}`, diffs);
    }
    return;
  }

  if (typeof actual !== typeof expected || actual !== expected) {
    diffs.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const diffs = [];
  compare(actual, expected, '$', diffs);
  if (diffs.length === 0) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}`);
    for (const d of diffs) console.log(`    ${d}`);
  }
}

function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const sortedById = (rows) => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// --- phases ------------------------------------------------------------------

async function phase1ReadOnly() {
  console.log('\n— phase 1: read-only parity (vs lib/demo-data.js oracle) —');

  const info = await repo.getBackendInfo();
  ok('getBackendInfo → postgres/persistent', info.backend === 'postgres' && info.persistent === true, JSON.stringify(info));

  check('listJobs (default)', await repo.listJobs(), oracleListJobs());
  check('listJobs status=open', await repo.listJobs({ status: 'open' }), oracleListJobs({ status: 'open' }));
  check('listJobs status=all', await repo.listJobs({ status: 'all' }), oracleListJobs({ status: 'all' }));
  check('listJobs q=react', await repo.listJobs({ q: 'React' }), oracleListJobs({ q: 'React' }));
  check('listJobs page=99 pageSize=2 (clamped)', await repo.listJobs({ page: 99, pageSize: 2 }), oracleListJobs({ page: 99, pageSize: 2 }));
  check('getJob job-junior-fullstack', await repo.getJob('job-junior-fullstack'), seed.jobs.find((j) => j.id === 'job-junior-fullstack'));
  check('getJob unknown → null', await repo.getJob('does-not-exist'), null);
  check('getJobRequirements job-senior-frontend', await repo.getJobRequirements('job-senior-frontend'), oracleRequirements('job-senior-frontend'));
  check('getJobRequirements unknown → null', await repo.getJobRequirements('does-not-exist'), null);

  check('listCandidates (default)', await repo.listCandidates(), oracleListCandidates());
  check('listCandidates page=2', await repo.listCandidates({ page: 2 }), oracleListCandidates({ page: 2 }));
  check('listCandidates page=99 pageSize=5 (clamped)', await repo.listCandidates({ page: 99, pageSize: 5 }), oracleListCandidates({ page: 99, pageSize: 5 }));
  check('listCandidates skill=React', await repo.listCandidates({ skill: 'React' }), oracleListCandidates({ skill: 'React' }));
  check('listCandidates q=Node.js', await repo.listCandidates({ q: 'Node.js' }), oracleListCandidates({ q: 'Node.js' }));
  check('listCandidates minYears=5', await repo.listCandidates({ minYears: 5 }), oracleListCandidates({ minYears: 5 }));
  check('listCandidates maxYears=1', await repo.listCandidates({ maxYears: 1 }), oracleListCandidates({ maxYears: 1 }));
  check('listCandidates evidenceStatus=not_established', await repo.listCandidates({ evidenceStatus: 'not_established' }), oracleListCandidates({ evidenceStatus: 'not_established' }));
  check('listCandidates sort=experience', await repo.listCandidates({ sort: 'experience' }), oracleListCandidates({ sort: 'experience' }));
  check('listCandidates sort=name', await repo.listCandidates({ sort: 'name' }), oracleListCandidates({ sort: 'name' }));

  check('getCandidate cand-ava-thompson', await repo.getCandidate('cand-ava-thompson'), oracleCandidate('cand-ava-thompson'));
  check('getCandidate unknown → null', await repo.getCandidate('does-not-exist'), null);
  check('getCandidateSkills cand-ava-thompson',
    await repo.getCandidateSkills('cand-ava-thompson'),
    seed.candidateSkills.filter((sk) => sk.candidateId === 'cand-ava-thompson'));
  check('getCandidateEvidence cand-diego-ramirez',
    await repo.getCandidateEvidence('cand-diego-ramirez'),
    seed.evidence.filter((ev) => ev.candidateId === 'cand-diego-ramirez'));
  check('getCandidateSubmissions cand-ava-thompson',
    await repo.getCandidateSubmissions('cand-ava-thompson'),
    seed.assessmentSubmissions
      .filter((x) => x.candidateId === 'cand-ava-thompson')
      .map((x) => ({ ...x, assessment: seed.assessments.find((a) => a.id === x.assessmentId) ?? null })));
  check('getCandidateApplications cand-elena-petrova',
    await repo.getCandidateApplications('cand-elena-petrova'),
    seed.applications
      .filter((a) => a.candidateId === 'cand-elena-petrova')
      .map((a) => ({ ...a, job: seed.jobs.find((j) => j.id === a.jobId) ?? null })));
  check('getJobApplications job-junior-fullstack',
    await repo.getJobApplications('job-junior-fullstack'),
    seed.applications
      .filter((a) => a.jobId === 'job-junior-fullstack')
      .map((a) => ({ ...a, candidate: seed.candidates.find((c) => c.id === a.candidateId) ?? null })));

  check('listAssessments (with submissionCount)',
    await repo.listAssessments(),
    seed.assessments.map((a) => ({
      ...a,
      submissionCount: seed.assessmentSubmissions.filter((x) => x.assessmentId === a.id).length,
    })));
  check('getAssessment asmt-js-data-01',
    await repo.getAssessment('asmt-js-data-01'),
    (() => {
      const a = seed.assessments.find((x) => x.id === 'asmt-js-data-01');
      return {
        ...a,
        submissions: seed.assessmentSubmissions
          .filter((x) => x.assessmentId === a.id)
          .map((x) => ({ ...x, candidate: seed.candidates.find((c) => c.id === x.candidateId) ?? null })),
      };
    })());
  check('getAssessment unknown → null', await repo.getAssessment('does-not-exist'), null);
  check('listSubmissions assessmentId=asmt-sql-01',
    await repo.listSubmissions({ assessmentId: 'asmt-sql-01' }),
    seed.assessmentSubmissions
      .filter((x) => x.assessmentId === 'asmt-sql-01')
      .map((x) => ({
        ...x,
        assessment: seed.assessments.find((a) => a.id === x.assessmentId) ?? null,
        candidate: seed.candidates.find((c) => c.id === x.candidateId) ?? null,
      })));
  check('listSubmissions candidateId=cand-grace-liu',
    await repo.listSubmissions({ candidateId: 'cand-grace-liu' }),
    seed.assessmentSubmissions
      .filter((x) => x.candidateId === 'cand-grace-liu')
      .map((x) => ({
        ...x,
        assessment: seed.assessments.find((a) => a.id === x.assessmentId) ?? null,
        candidate: seed.candidates.find((c) => c.id === x.candidateId) ?? null,
      })));
  check('listSubmissions (all)',
    await repo.listSubmissions(),
    seed.assessmentSubmissions.map((x) => ({
      ...x,
      assessment: seed.assessments.find((a) => a.id === x.assessmentId) ?? null,
      candidate: seed.candidates.find((c) => c.id === x.candidateId) ?? null,
    })));

  const events = [...seed.searchEvents].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  check('recentSearchEvents (default 8)', await repo.recentSearchEvents(), events.slice(0, 8));
  check('recentSearchEvents limit=2', await repo.recentSearchEvents(2), events.slice(0, 2));
  const logs = [...seed.auditLogs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  check('recentAuditLogs (default 8)', await repo.recentAuditLogs(), logs.slice(0, 8));

  check('analyticsSummary', await repo.analyticsSummary(), oracleAnalytics());

  const corpus = await repo.searchCorpus();
  ok('searchCorpus length = 12', corpus.length === seed.candidates.length, `got ${corpus.length}`);
  ok('searchCorpus order = demo candidate order',
    corpus.every((d, i) => d.candidate.id === seed.candidates[i].id),
    corpus.map((d) => d.candidate.id).join(','));
  ok('searchCorpus entries have exactly 8 keys',
    corpus.every((d) => Object.keys(d).length === 8),
    JSON.stringify(Object.keys(corpus[0])));
  check('searchCorpus documents', corpus, oracleCorpus());
}

async function phase2Mutations(created) {
  console.log('\n— phase 2: mutations (rows cleaned up in phase 3) —');

  // -- jobs ------------------------------------------------------------------
  const job = await repo.createJob({
    title: 'Smoke Test Job',
    requiredSkills: [{ skill: 'Go', minYears: 2, note: null }],
    preferredSkills: [{ skill: 'Kafka', minYears: null, note: null }],
  });
  created.jobId = job.id;
  check('createJob', job, {
    id: job.id,
    title: 'Smoke Test Job',
    department: 'Engineering',
    location: 'Remote',
    employmentType: 'Full-time',
    status: 'draft',
    experienceMin: null,
    experienceMax: null,
    description: '',
    requiredSkills: [{ skill: 'Go', minYears: 2, note: null }],
    preferredSkills: [{ skill: 'Kafka', minYears: null, note: null }],
    createdBy: 'Demo Recruiter',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });

  const updatedJob = await repo.updateJob(job.id, {
    status: 'open',
    requiredSkills: [
      { skill: 'Go', minYears: 3, note: null },
      { skill: 'SQL', minYears: 1, note: 'Any engine' },
    ],
    preferredSkills: [],
  });
  check('updateJob (status + skills patch)', updatedJob, {
    ...job,
    status: 'open',
    requiredSkills: [
      { skill: 'Go', minYears: 3, note: null },
      { skill: 'SQL', minYears: 1, note: 'Any engine' },
    ],
    preferredSkills: [],
    updatedAt: updatedJob.updatedAt,
  });
  check('updateJob unknown → null', await repo.updateJob('does-not-exist', { status: 'open' }), null);
  check('getJobRequirements after patch', await repo.getJobRequirements(job.id), [
    { skill: 'Go', minYears: 3, note: null, category: 'required' },
    { skill: 'SQL', minYears: 1, note: 'Any engine', category: 'required' },
  ]);

  // -- candidate from extraction --------------------------------------------
  const payload = {
    fullName: 'Smoke Test Candidate',
    headline: 'Test Engineer',
    email: 'smoke@example.com',
    location: 'Testville',
    yearsExperience: 3,
    currentCompany: 'Smoke Labs',
    summary: 'Created by database/smoke-test.js; deleted during cleanup.',
    source: 'Resume upload',
    links: { github: 'github.com/smoke-demo' },
    skills: [
      { skill: 'Node.js', years: 3, level: 'working', source: 'resume' },
      { skill: 'SQL', years: 2, level: 'working', source: 'resume' },
    ],
    experience: [
      {
        company: 'Smoke Labs',
        title: 'Engineer',
        start: '2022-01',
        end: null,
        location: 'Testville',
        summary: 'Did testing.',
        highlights: ['Wrote smoke tests'],
      },
    ],
    education: [{ degree: 'BSc Testing', school: 'Smoke University', year: '2021' }],
    projects: [{ name: 'Smoke Project', summary: 'A project.', tech: ['Node.js'], link: 'github.com/smoke/project' }],
    evidence: [
      {
        skill: 'Node.js',
        sourceType: 'resume',
        sourceId: 'upl-smoke',
        sourceName: 'smoke.pdf',
        excerpt: 'Did Node.js work at Smoke Labs',
        location: { page: 1, section: 'Experience' },
        status: 'supporting',
        extractor: 'demo',
        notes: null,
      },
    ],
    resume: {
      filename: 'smoke.pdf',
      mimeType: 'application/pdf',
      fileSize: 12_345,
      pageCount: 2,
      storagePath: 'resumes/smoke.pdf',
      uploadedAt: new Date().toISOString(),
      status: 'processed',
      sections: [],
    },
  };
  const candidate = await repo.createCandidateFromExtraction(payload);
  created.candidateId = candidate.id;
  ok('createCandidateFromExtraction id format', /^cand-[a-z0-9-]+$/.test(candidate.id), candidate.id);

  const readBack = await repo.getCandidate(candidate.id);
  check('getCandidate after extraction (full shape)', readBack, {
    id: candidate.id,
    fullName: payload.fullName,
    headline: payload.headline,
    email: payload.email,
    location: payload.location,
    yearsExperience: payload.yearsExperience,
    currentCompany: payload.currentCompany,
    status: 'active',
    source: payload.source,
    summary: payload.summary,
    links: payload.links,
    createdAt: candidate.createdAt,
    skills: payload.skills.map((sk) => ({ candidateId: candidate.id, ...sk })),
    experience: [{ candidateId: candidate.id, ...payload.experience[0] }],
    education: [{ candidateId: candidate.id, degree: 'BSc Testing', school: 'Smoke University', year: '2021' }],
    projects: [{ candidateId: candidate.id, ...payload.projects[0] }],
    resume: {
      id: readBack.resume.id,
      candidateId: candidate.id,
      filename: 'smoke.pdf',
      mimeType: 'application/pdf',
      fileSize: 12_345,
      pageCount: 2,
      uploadedAt: payload.resume.uploadedAt,
      status: 'processed',
      sections: [],
      storagePath: 'resumes/smoke.pdf', // fullText stays absent (null) — same as memory
    },
  });
  check('getCandidateSkills after extraction',
    await repo.getCandidateSkills(candidate.id),
    payload.skills.map((sk) => ({ candidateId: candidate.id, ...sk })));

  // -- evidence ---------------------------------------------------------------
  const manual = await repo.addEvidence({
    candidateId: candidate.id,
    skill: 'SQL',
    excerpt: 'Wrote SQL queries during testing',
    sourceType: 'manual',
    sourceName: 'Recruiter note (Smoke)',
    status: 'supporting',
    extractor: 'human',
    notes: null,
  });
  created.evidenceId = manual.id;
  check('addEvidence (memory-shaped return, no location key)', manual, {
    id: manual.id,
    status: 'supporting',
    extractor: 'human',
    sourceType: 'manual',
    sourceName: 'Recruiter note (Smoke)',
    createdAt: manual.createdAt,
    candidateId: candidate.id,
    skill: 'SQL',
    excerpt: 'Wrote SQL queries during testing',
    notes: null,
  });
  ok('addEvidence return has no location key', !('location' in manual));

  // Runtime evidence ids are uuid-suffixed, so order is compared as a set.
  const evidenceAfter = await repo.getCandidateEvidence(candidate.id);
  check('getCandidateEvidence after addEvidence (set)',
    sortedById(evidenceAfter),
    sortedById([
      { ...manual },
      {
        id: evidenceAfter.find((e) => e.skill === 'Node.js').id,
        candidateId: candidate.id,
        skill: 'Node.js',
        sourceType: 'resume',
        sourceId: 'upl-smoke',
        sourceName: 'smoke.pdf',
        excerpt: 'Did Node.js work at Smoke Labs',
        location: { page: 1, section: 'Experience' },
        status: 'supporting',
        extractor: 'demo',
        notes: null,
        createdAt: evidenceAfter.find((e) => e.skill === 'Node.js').createdAt,
      },
    ]));

  const reviewed = await repo.updateEvidence(manual.id, { status: 'needs_review', notes: 'checking' });
  check('updateEvidence', reviewed, {
    ...manual,
    status: 'needs_review',
    notes: 'checking',
    reviewedBy: 'Demo Recruiter',
    reviewedAt: reviewed.reviewedAt,
  });
  check('updateEvidence unknown → null', await repo.updateEvidence('does-not-exist', { status: 'claimed' }), null);

  // -- submissions ------------------------------------------------------------
  const submission = await repo.createSubmission({
    assessmentId: 'asmt-sql-01',
    candidateId: candidate.id,
    status: 'manual_review',
    executionMode: 'static_checks',
    result: { staticChecks: { passed: ['ok'], warnings: [] }, testCaseResults: [], reviewerNote: null },
  });
  created.submissionId = submission.id;
  check('createSubmission', submission, {
    id: submission.id,
    assessmentId: 'asmt-sql-01',
    candidateId: candidate.id,
    submittedAt: submission.submittedAt,
    status: 'manual_review',
    score: null,
    executionMode: 'static_checks',
    result: { staticChecks: { passed: ['ok'], warnings: [] }, testCaseResults: [], reviewerNote: null },
  });
  const reviewedSub = await repo.updateSubmission(submission.id, { status: 'completed', score: 91 });
  check('updateSubmission', reviewedSub, { ...submission, status: 'completed', score: 91 });
  check('updateSubmission unknown → null', await repo.updateSubmission('does-not-exist', { status: 'completed' }), null);
  check('getCandidateSubmissions after createSubmission',
    await repo.getCandidateSubmissions(candidate.id),
    [{ ...reviewedSub, assessment: seed.assessments.find((a) => a.id === 'asmt-sql-01') }]);

  // -- applications -----------------------------------------------------------
  const app = await repo.createApplication({ candidateId: candidate.id, jobId: 'job-backend-node' });
  created.applicationId = app.id;
  check('createApplication', app, {
    id: app.id,
    candidateId: candidate.id,
    jobId: 'job-backend-node',
    stage: 'applied',
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  });
  const appAgain = await repo.createApplication({ candidateId: candidate.id, jobId: 'job-backend-node' });
  check('createApplication dedupe (returns existing)', appAgain, app);
  const appMoved = await repo.updateApplicationStage(app.id, 'interview');
  check('updateApplicationStage', appMoved, { ...app, stage: 'interview', updatedAt: appMoved.updatedAt });
  check('updateApplicationStage unknown → null', await repo.updateApplicationStage('does-not-exist', 'offer'), null);

  // -- candidate patch --------------------------------------------------------
  // memory.js updateCandidate returns the RAW candidate (no children keys).
  const { skills: _sk, experience: _xp, education: _ed, projects: _pj, resume: _rs, ...baseCandidate } = readBack;
  const patched = await repo.updateCandidate(candidate.id, { headline: 'Senior Test Engineer', yearsExperience: 4 });
  check('updateCandidate', patched, { ...baseCandidate, headline: 'Senior Test Engineer', yearsExperience: 4 });
  check('updateCandidate unknown → null', await repo.updateCandidate('does-not-exist', { headline: 'x' }), null);

  // -- search events / audit --------------------------------------------------
  const event = await repo.recordSearchEvent({ query: 'smoke test query', mode: 'keyword', resultCount: 1 });
  created.searchEventId = event.id;
  check('recordSearchEvent', event, {
    id: event.id,
    query: 'smoke test query',
    mode: 'keyword',
    resultCount: 1,
    createdAt: event.createdAt,
  });
  check('recentSearchEvents picks up the new event first', (await repo.recentSearchEvents(1))[0], event);

  const audit = await repo.logAudit({
    action: 'smoke.test',
    entityType: 'candidate',
    entityId: candidate.id,
    metadata: { ok: true },
  });
  created.auditId = audit.id;
  check('logAudit', audit, {
    id: audit.id,
    actor: 'Demo Recruiter',
    action: 'smoke.test',
    entityType: 'candidate',
    entityId: candidate.id,
    metadata: { ok: true },
    createdAt: audit.createdAt,
  });
  check('recentAuditLogs picks up the new entry first', (await repo.recentAuditLogs(1))[0], audit);

  // -- analytics deltas -------------------------------------------------------
  const analytics = await repo.analyticsSummary();
  ok('analytics: totalJobs +1', analytics.totalJobs === seed.jobs.length + 1, `${analytics.totalJobs}`);
  ok('analytics: totalCandidates +1', analytics.totalCandidates === seed.candidates.length + 1, `${analytics.totalCandidates}`);
  ok('analytics: openJobs +1', analytics.openJobs === oracleAnalytics().openJobs + 1, `${analytics.openJobs}`);
  ok('analytics: totalApplications +1', analytics.totalApplications === seed.applications.length + 1, `${analytics.totalApplications}`);
  ok('analytics: byStage.interview +1', analytics.byStage.interview === oracleAnalytics().byStage.interview + 1, `${analytics.byStage.interview}`);
  ok('analytics: completedAssessments +1', analytics.completedAssessments === oracleAnalytics().completedAssessments + 1, `${analytics.completedAssessments}`);
}

async function phase3Cleanup(created) {
  console.log('\n— phase 3: cleanup (delete only rows created by this run) —');
  const cleanupPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: buildSslConfig(),
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  try {
    if (created.applicationId) await cleanupPool.query('delete from applications where id = $1', [created.applicationId]);
    if (created.submissionId) await cleanupPool.query('delete from assessment_submissions where id = $1', [created.submissionId]);
    if (created.evidenceId) await cleanupPool.query('delete from candidate_evidence where id = $1', [created.evidenceId]);
    if (created.candidateId) await cleanupPool.query('delete from candidates where id = $1', [created.candidateId]); // cascades children
    if (created.jobId) await cleanupPool.query('delete from jobs where id = $1', [created.jobId]); // cascades requirements
    if (created.searchEventId) await cleanupPool.query('delete from search_events where id = $1', [created.searchEventId]);
    if (created.auditId) await cleanupPool.query('delete from audit_logs where id = $1', [created.auditId]);
    console.log('✓ cleanup deletes executed');

    const { rows } = await cleanupPool.query(`
      select
        (select count(*) from jobs)::int as jobs,
        (select count(*) from job_requirements)::int as job_requirements,
        (select count(*) from candidates)::int as candidates,
        (select count(*) from resumes)::int as resumes,
        (select count(*) from candidate_skills)::int as candidate_skills,
        (select count(*) from experiences)::int as experiences,
        (select count(*) from education)::int as education,
        (select count(*) from projects)::int as projects,
        (select count(*) from candidate_evidence)::int as candidate_evidence,
        (select count(*) from assessments)::int as assessments,
        (select count(*) from assessment_submissions)::int as assessment_submissions,
        (select count(*) from applications)::int as applications,
        (select count(*) from search_events)::int as search_events,
        (select count(*) from audit_logs)::int as audit_logs
    `);
    const baseline = {
      jobs: seed.jobs.length,
      job_requirements: seed.jobs.reduce((n, j) => n + j.requiredSkills.length + j.preferredSkills.length, 0),
      candidates: seed.candidates.length,
      resumes: seed.resumes.length,
      candidate_skills: seed.candidateSkills.length,
      experiences: seed.experiences.length,
      education: seed.education.length,
      projects: seed.projects.length,
      candidate_evidence: seed.evidence.length,
      assessments: seed.assessments.length,
      assessment_submissions: seed.assessmentSubmissions.length,
      applications: seed.applications.length,
      search_events: seed.searchEvents.length,
      audit_logs: seed.auditLogs.length,
    };
    check('row counts restored to demo baseline', rows[0], baseline);
  } finally {
    await cleanupPool.end();
  }
}

async function main() {
  console.log('HireProof AI — PostgreSQL repository smoke test');

  // Preflight: schema must be migrated and seeded, else the parity checks
  // below would compare against the wrong baseline.
  const pre = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: buildSslConfig(),
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  let seeded = false;
  try {
    const { rows } = await pre.query(
      "select to_regclass('public.jobs') as jobs, (select count(*) from jobs)::int as n"
    );
    seeded = Boolean(rows[0].jobs) && rows[0].n > 0;
  } finally {
    await pre.end();
  }
  if (!seeded) {
    console.error('✗ schema not migrated or not seeded — run:');
    console.error('    node database/run-migrations.js');
    console.error('    node database/seed.js');
    return 1;
  }

  const created = {};
  try {
    await phase1ReadOnly();
    await phase2Mutations(created);
    await phase3Cleanup(created);
  } finally {
    await closePool();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(`✗ smoke test failed: ${err.message}`);
  console.error(err.stack);
  process.exitCode = 1;
}
