// ---------------------------------------------------------------------------
// In-memory fallback data layer.
//
// Used automatically when PostgreSQL is unreachable or DATABASE_URL is unset.
// Seeded from lib/demo-data.js (synthetic data) and persisted to
// .data/demo-store.json so demo mutations survive restarts. Delete the file
// (or run `npm run db:reset -- --memory`) to restore the pristine seed.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import seed from '@/lib/demo-data';

const DATA_DIR = path.join(process.cwd(), '.data');
const STORE_FILE = path.join(DATA_DIR, 'demo-store.json');

let store = null;

function freshStore() {
  const nextId = (() => {
    let n = 1000;
    return (prefix) => `${prefix}-${++n}`;
  })();
  return {
    meta: { seededAt: new Date().toISOString(), source: 'lib/demo-data.js (synthetic)' },
    nextId,
    jobs: structuredClone(seed.jobs),
    candidates: structuredClone(seed.candidates),
    resumes: structuredClone(seed.resumes),
    candidateSkills: structuredClone(seed.candidateSkills),
    experiences: structuredClone(seed.experiences),
    education: structuredClone(seed.education),
    projects: structuredClone(seed.projects),
    evidence: structuredClone(seed.evidence),
    assessments: structuredClone(seed.assessments),
    submissions: structuredClone(seed.assessmentSubmissions),
    applications: structuredClone(seed.applications),
    searchEvents: structuredClone(seed.searchEvents),
    auditLogs: structuredClone(seed.auditLogs),
  };
}

function load() {
  if (store) return store;
  try {
    if (fs.existsSync(STORE_FILE)) {
      store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      if (!store?.meta) throw new Error('malformed store');

      // Derive the id counter from BOTH the persisted counter and the highest
      // id actually present — a stale/persisted-too-late counter used to hand
      // out ids that already existed (duplicate React keys + ambiguous
      // lookups). Highest-prefix-wins makes collisions impossible on load.
      let max = Number(store.meta.idCounter ?? 1000) || 1000;
      for (const value of Object.values(store)) {
        if (!Array.isArray(value)) continue;
        for (const rec of value) {
          const m = typeof rec?.id === 'string' ? rec.id.match(/^[a-z]+-(\d+)/) : null;
          if (m) max = Math.max(max, Number(m[1]));
        }
      }
      store.meta.idCounter = max;

      store.nextId = (() => {
        let n = max;
        return (prefix) => {
          n += 1;
          store.meta.idCounter = n;
          return `${prefix}-${n}`;
        };
      })();

      // Repair any duplicates already persisted (keep every record, re-key the
      // later ones) so no list renders two identical keys.
      let repaired = false;
      for (const value of Object.values(store)) {
        if (!Array.isArray(value)) continue;
        const seen = new Set();
        for (const rec of value) {
          if (!rec || typeof rec.id !== 'string') continue;
          if (seen.has(rec.id)) {
            const prefix = (rec.id.match(/^[a-z]+/) ?? ['rec'])[0];
            rec.id = store.nextId(prefix);
            repaired = true;
          }
          seen.add(rec.id);
        }
      }
      if (repaired) save();
      return store;
    }
  } catch {
    // fall through to reseed
  }
  store = freshStore();
  save();
  return store;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 1));
  } catch {
    // Persistence is best-effort in the fallback layer.
  }
}

const matches = (text, q) => text?.toLowerCase().includes(q);

function paginate(items, page, pageSize) {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pageCount);
  return { items: items.slice((p - 1) * pageSize, p * pageSize), total, page: p, pageCount };
}

// ---------------------------------------------------------------------------
// Backend implementation
// ---------------------------------------------------------------------------
const memory = {
  async getBackendInfo() {
    load();
    return {
      backend: 'memory',
      label: 'In-memory demo store (PostgreSQL unavailable)',
      persistent: true,
      seededAt: store.meta.seededAt,
    };
  },

  async listJobs({ status, q, page = 1, pageSize = 20 } = {}) {
    const s = load();
    let items = [...s.jobs];
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
    return paginate(items, page, pageSize);
  },

  async getJob(id) {
    return load().jobs.find((j) => j.id === id) ?? null;
  },

  async getJobRequirements(jobId) {
    const s = load();
    const job = s.jobs.find((j) => j.id === jobId);
    if (!job) return null;
    return [
      ...job.requiredSkills.map((r) => ({ ...r, category: 'required' })),
      ...job.preferredSkills.map((r) => ({ ...r, category: 'preferred' })),
    ];
  },

  async createJob(data) {
    const s = load();
    const job = {
      id: s.nextId('job'),
      title: data.title,
      department: data.department ?? 'Engineering',
      location: data.location ?? 'Remote',
      employmentType: data.employmentType ?? 'Full-time',
      status: data.status ?? 'draft',
      experienceMin: data.experienceMin ?? null,
      experienceMax: data.experienceMax ?? null,
      description: data.description ?? '',
      requiredSkills: data.requiredSkills ?? [],
      preferredSkills: data.preferredSkills ?? [],
      createdBy: 'Demo Recruiter',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    s.jobs.push(job);
    save();
    return job;
  },

  async updateJob(id, patch) {
    const s = load();
    const job = s.jobs.find((j) => j.id === id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    save();
    return job;
  },

  async listCandidates({ q, skill, minYears, maxYears, evidenceStatus, page = 1, pageSize = 10, sort = 'recent' } = {}) {
    const s = load();
    let items = [...s.candidates];
    if (evidenceStatus) {
      items = items.filter((c) => s.evidence.some((ev) => ev.candidateId === c.id && ev.status === evidenceStatus));
    }
    if (q) {
      const query = q.toLowerCase();
      items = items.filter(
        (c) =>
          matches(c.fullName, query) ||
          matches(c.headline, query) ||
          matches(c.summary, query) ||
          matches(c.currentCompany, query) ||
          s.candidateSkills.some((sk) => sk.candidateId === c.id && matches(sk.skill, query))
      );
    }
    if (skill) {
      const wanted = skill.toLowerCase();
      items = items.filter((c) =>
        s.candidateSkills.some((sk) => sk.candidateId === c.id && sk.skill.toLowerCase() === wanted)
      );
    }
    if (minYears != null && minYears !== '') items = items.filter((c) => c.yearsExperience >= Number(minYears));
    if (maxYears != null && maxYears !== '') items = items.filter((c) => c.yearsExperience <= Number(maxYears));

    if (sort === 'experience') items.sort((a, b) => b.yearsExperience - a.yearsExperience);
    else if (sort === 'name') items.sort((a, b) => a.fullName.localeCompare(b.fullName));
    else items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const result = paginate(items, page, pageSize);
    return {
      ...result,
      items: result.items.map((c) => ({
        ...c,
        skills: s.candidateSkills.filter((sk) => sk.candidateId === c.id),
      })),
    };
  },

  async getCandidate(id) {
    const s = load();
    const candidate = s.candidates.find((c) => c.id === id);
    if (!candidate) return null;
    return {
      ...candidate,
      skills: s.candidateSkills.filter((sk) => sk.candidateId === id),
      experience: s.experiences.filter((e) => e.candidateId === id),
      education: s.education.filter((e) => e.candidateId === id),
      projects: s.projects.filter((p) => p.candidateId === id),
      resume: s.resumes.find((r) => r.candidateId === id) ?? null,
    };
  },

  async createCandidateFromExtraction(data) {
    const s = load();
    const slug = data.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    // Slug ids collide when two candidates share a name — suffix instead of
    // overwriting the first profile.
    let id = `cand-${slug || s.nextId('cand')}`;
    for (let n = 2; s.candidates.some((c) => c.id === id); n += 1) {
      id = `cand-${slug || 'candidate'}-${n}`;
    }
    const candidate = {
      id,
      fullName: data.fullName,
      headline: data.headline ?? 'Candidate',
      email: data.email ?? null,
      location: data.location ?? null,
      yearsExperience: data.yearsExperience ?? null,
      currentCompany: data.currentCompany ?? null,
      status: 'active',
      source: data.source ?? 'Resume upload',
      summary: data.summary ?? '',
      links: data.links ?? {},
      createdAt: new Date().toISOString(),
    };
    s.candidates.push(candidate);
    if (data.resume) s.resumes.push({ id: s.nextId('res'), candidateId: candidate.id, ...data.resume });
    for (const sk of data.skills ?? []) {
      s.candidateSkills.push({ candidateId: candidate.id, ...sk });
    }
    for (const e of data.experience ?? []) s.experiences.push({ candidateId: candidate.id, ...e });
    for (const e of data.education ?? []) s.education.push({ candidateId: candidate.id, ...e });
    for (const p of data.projects ?? []) s.projects.push({ candidateId: candidate.id, ...p });
    for (const ev of data.evidence ?? []) {
      s.evidence.push({ id: s.nextId('ev'), candidateId: candidate.id, ...ev });
    }
    save();
    return candidate;
  },

  async getCandidateSkills(candidateId) {
    return load().candidateSkills.filter((sk) => sk.candidateId === candidateId);
  },

  async getCandidateEvidence(candidateId) {
    return load().evidence.filter((ev) => ev.candidateId === candidateId);
  },

  async updateEvidence(evidenceId, patch) {
    const s = load();
    const ev = s.evidence.find((e) => e.id === evidenceId);
    if (!ev) return null;
    const { reviewedBy, ...rest } = patch;
    Object.assign(ev, rest, {
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewedBy ?? 'Demo Recruiter', // demo mode has no real session
    });
    save();
    return ev;
  },

  async addEvidence(data) {
    const s = load();
    const ev = {
      id: s.nextId('ev'),
      status: 'supporting',
      extractor: 'human',
      sourceType: 'manual',
      sourceName: 'Manual note',
      createdAt: new Date().toISOString(),
      ...data,
    };
    s.evidence.push(ev);
    save();
    return ev;
  },

  async getCandidateSubmissions(candidateId) {
    const s = load();
    return s.submissions
      .filter((x) => x.candidateId === candidateId)
      .map((x) => ({ ...x, assessment: s.assessments.find((a) => a.id === x.assessmentId) ?? null }));
  },

  async getCandidateApplications(candidateId) {
    const s = load();
    return s.applications
      .filter((a) => a.candidateId === candidateId)
      .map((a) => ({ ...a, job: s.jobs.find((j) => j.id === a.jobId) ?? null }));
  },

  async getJobApplications(jobId) {
    const s = load();
    return s.applications
      .filter((a) => a.jobId === jobId)
      .map((a) => ({
        ...a,
        candidate: s.candidates.find((c) => c.id === a.candidateId) ?? null,
      }));
  },

  async createApplication({ candidateId, jobId, stage = 'applied' }) {
    const s = load();
    const existing = s.applications.find((a) => a.candidateId === candidateId && a.jobId === jobId);
    if (existing) return existing;
    const app = {
      id: s.nextId('app'),
      candidateId,
      jobId,
      stage,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    s.applications.push(app);
    save();
    return app;
  },

  async updateApplicationStage(applicationId, stage) {
    const s = load();
    const app = s.applications.find((a) => a.id === applicationId);
    if (!app) return null;
    app.stage = stage;
    app.updatedAt = new Date().toISOString();
    save();
    return app;
  },

  async updateCandidate(id, patch) {
    const s = load();
    const candidate = s.candidates.find((c) => c.id === id);
    if (!candidate) return null;
    Object.assign(candidate, patch);
    save();
    return candidate;
  },

  async listAssessments() {
    const s = load();
    return s.assessments.map((a) => ({
      ...a,
      submissionCount: s.submissions.filter((x) => x.assessmentId === a.id).length,
    }));
  },

  async getAssessment(id) {
    const s = load();
    const assessment = s.assessments.find((a) => a.id === id);
    if (!assessment) return null;
    return {
      ...assessment,
      submissions: s.submissions
        .filter((x) => x.assessmentId === id)
        .map((x) => ({ ...x, candidate: s.candidates.find((c) => c.id === x.candidateId) ?? null })),
    };
  },

  async createAssessment(data) {
    const s = load();
    const assessment = {
      id: s.nextId('asmt'),
      status: data.status ?? 'draft',
      executionMode: 'manual_review',
      testCases: [],
      createdAt: new Date().toISOString(),
      ...data,
    };
    s.assessments.push(assessment);
    save();
    return assessment;
  },

  async createSubmission(data) {
    const s = load();
    const submission = {
      id: s.nextId('sub'),
      submittedAt: new Date().toISOString(),
      status: data.status ?? 'manual_review',
      score: data.score ?? null,
      executionMode: data.executionMode ?? 'static_checks',
      result: data.result ?? { staticChecks: { passed: [], warnings: [] }, testCaseResults: [], reviewerNote: null },
      ...data,
    };
    s.submissions.push(submission);
    save();
    return submission;
  },

  async updateSubmission(id, patch) {
    const s = load();
    const sub = s.submissions.find((x) => x.id === id);
    if (!sub) return null;
    Object.assign(sub, patch);
    save();
    return sub;
  },

  async listSubmissions({ assessmentId, candidateId } = {}) {
    const s = load();
    return s.submissions
      .filter((x) => (!assessmentId || x.assessmentId === assessmentId) && (!candidateId || x.candidateId === candidateId))
      .map((x) => ({
        ...x,
        assessment: s.assessments.find((a) => a.id === x.assessmentId) ?? null,
        candidate: s.candidates.find((c) => c.id === x.candidateId) ?? null,
      }));
  },

  async recordSearchEvent({ query, mode, resultCount }) {
    const s = load();
    const event = {
      id: s.nextId('se'),
      query,
      mode,
      resultCount,
      createdAt: new Date().toISOString(),
    };
    s.searchEvents.push(event);
    save();
    return event;
  },

  async recentSearchEvents(limit = 8) {
    return [...load().searchEvents].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
  },

  async analyticsSummary() {
    const s = load();
    const openJobs = s.jobs.filter((j) => j.status === 'open').length;
    const byStage = {};
    for (const stage of ['applied', 'screening', 'assessment', 'interview', 'offer', 'hired']) {
      byStage[stage] = s.applications.filter((a) => a.stage === stage).length;
    }
    const evidenceByStatus = {};
    for (const status of ['claimed', 'supporting', 'assessment', 'not_established', 'needs_review']) {
      evidenceByStatus[status] = s.evidence.filter((e) => e.status === status).length;
    }

    // Weekly series for the last 6 ISO weeks (Monday-anchored).
    const weeks = [];
    const msWeek = 7 * 24 * 3600 * 1000;
    const anchor = new Date();
    anchor.setUTCHours(0, 0, 0, 0);
    const dow = (anchor.getUTCDay() + 6) % 7; // Monday = 0
    // Move back to the Monday 6 weeks ago: dow days to this week's Monday,
    // then 5 more full weeks (setUTCDate takes DAYS, not milliseconds).
    anchor.setUTCDate(anchor.getUTCDate() - dow - 5 * 7);
    for (let i = 0; i < 6; i++) {
      const start = new Date(anchor.getTime() + i * msWeek);
      const end = new Date(start.getTime() + msWeek);
      weeks.push({
        weekStart: start.toISOString().slice(0, 10),
        label: start.toISOString().slice(5, 10),
        applications: s.applications.filter((a) => a.createdAt >= start.toISOString() && a.createdAt < end.toISOString()).length,
        searches: s.searchEvents.filter((e) => e.createdAt >= start.toISOString() && e.createdAt < end.toISOString()).length,
        uploads: s.resumes.filter((r) => r.uploadedAt >= start.toISOString() && r.uploadedAt < end.toISOString()).length,
      });
    }

    return {
      openJobs,
      totalJobs: s.jobs.length,
      totalCandidates: s.candidates.length,
      completedAssessments: s.submissions.filter((x) => x.status === 'completed').length,
      pendingReviews:
        s.submissions.filter((x) => x.status === 'manual_review').length +
        s.evidence.filter((e) => e.status === 'needs_review' || e.status === 'claimed').length,
      byStage,
      evidenceByStatus,
      totalApplications: s.applications.length,
      searchesLast30d: s.searchEvents.length,
      weeks,
    };
  },

  async logAudit({ action, entityType, entityId, metadata }) {
    const s = load();
    const entry = {
      id: s.nextId('audit'),
      actor: 'Demo Recruiter',
      action,
      entityType,
      entityId,
      metadata: metadata ?? {},
      createdAt: new Date().toISOString(),
    };
    s.auditLogs.push(entry);
    save();
    return entry;
  },

  async recentAuditLogs(limit = 8) {
    return [...load().auditLogs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
  },

  // -- List-page aggregates ---------------------------------------------------
  // Same shapes as postgres.js — one pass over the store instead of per-row
  // queries (the memory backend is synchronous; these exist for interface
  // parity so list pages issue a fixed number of calls).

  async listSkillVocab() {
    return [...new Set(load().candidateSkills.map((sk) => sk.skill))];
  },

  async applicationCounts(jobIds) {
    const ids = jobIds ?? [];
    const counts = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const a of load().applications) {
      if (a.jobId in counts) counts[a.jobId] += 1;
    }
    return counts;
  },

  async candidateRollups(candidateIds) {
    const s = load();
    const out = Object.fromEntries(
      (candidateIds ?? []).map((id) => [
        id,
        { supportCount: 0, pendingReview: 0, completedAssessments: 0, totalEvidence: 0 },
      ])
    );
    for (const ev of s.evidence) {
      const b = out[ev.candidateId];
      if (!b) continue;
      b.totalEvidence += 1;
      if (ev.status === 'supporting' || ev.status === 'assessment') b.supportCount += 1;
      if (ev.status === 'needs_review' || ev.status === 'claimed') b.pendingReview += 1;
    }
    for (const sub of s.submissions) {
      if (sub.status === 'completed' && out[sub.candidateId]) {
        out[sub.candidateId].completedAssessments += 1;
      }
    }
    return out;
  },

  async searchCorpus() {
    const s = load();
    return s.candidates.map((c) => ({
      candidate: c,
      skills: s.candidateSkills.filter((sk) => sk.candidateId === c.id),
      evidence: s.evidence.filter((ev) => ev.candidateId === c.id),
      experience: s.experiences.filter((e) => e.candidateId === c.id),
      projects: s.projects.filter((p) => p.candidateId === c.id),
      resume: s.resumes.find((r) => r.candidateId === c.id) ?? null,
      submissions: s.submissions
        .filter((x) => x.candidateId === c.id)
        .map((x) => ({ ...x, assessment: s.assessments.find((a) => a.id === x.assessmentId) ?? null })),
      applications: s.applications.filter((a) => a.candidateId === c.id),
    }));
  },
};

export default memory;
