// ---------------------------------------------------------------------------
// Candidate search engine — transparent, evidence-grounded ranking.
//
// Design rules:
//  - Ranking components are exposed per result (never a single opaque %).
//  - A candidate claim alone never counts as verified skill; evidence status
//    per requirement drives the requirement-level explanation.
//  - Absence of evidence is reported as "not established", never as a
//    negative signal that demotes the candidate.
//  - Protected characteristics are not used anywhere in ranking.
//
// This module is pure: it takes a corpus (from repo.searchCorpus()) and a
// parsed query, so it can be unit-tested without a database.
// ---------------------------------------------------------------------------

// Canonical skill -> aliases that also indicate the skill (lowercase).
// `satisfies` lists broader skills that this skill proves (e.g. MySQL proves SQL).
export const SKILL_TAXONOMY = {
  react: { label: 'React', aliases: ['react', 'react.js', 'reactjs'] },
  nextjs: { label: 'Next.js', aliases: ['next.js', 'nextjs', 'next'] },
  typescript: { label: 'TypeScript', aliases: ['typescript', ' ts '] },
  javascript: { label: 'JavaScript', aliases: ['javascript', 'js', 'es6'] },
  'node.js': { label: 'Node.js', aliases: ['node.js', 'nodejs', 'node', 'node js', 'express', 'express.js'] },
  sql: { label: 'SQL', aliases: ['sql', 'database', 'relational database', 'rdbms'] },
  postgresql: { label: 'PostgreSQL', aliases: ['postgresql', 'postgres', 'psql'], satisfies: ['sql'] },
  mysql: { label: 'MySQL', aliases: ['mysql', 'mariadb'], satisfies: ['sql'] },
  python: { label: 'Python', aliases: ['python', 'python3'] },
  fastapi: { label: 'FastAPI', aliases: ['fastapi', 'fast api'] },
  docker: { label: 'Docker', aliases: ['docker', 'containers'] },
  kafka: { label: 'Kafka', aliases: ['kafka', 'event streaming'] },
  redis: { label: 'Redis', aliases: ['redis'] },
  airflow: { label: 'Airflow', aliases: ['airflow', 'apache airflow'] },
  dbt: { label: 'dbt', aliases: ['dbt', 'data build tool'] },
  figma: { label: 'Figma', aliases: ['figma'] },
  prototyping: { label: 'Prototyping', aliases: ['prototyping', 'prototype'] },
  'design systems': { label: 'Design Systems', aliases: ['design system', 'design systems', 'component library'] },
  testing: { label: 'Testing', aliases: ['testing', 'jest', 'playwright', 'vitest', 'e2e', 'unit tests'] },
  'rest apis': { label: 'REST APIs', aliases: ['rest', 'rest api', 'rest apis', 'apis', 'api development'] },
  git: { label: 'Git', aliases: ['git', 'github', 'version control'] },
  'html/css': { label: 'HTML/CSS', aliases: ['html', 'css', 'html/css'] },
  'user research': { label: 'User Research', aliases: ['user research', 'usability'] },
};

const STOPWORDS = new Set([
  'find', 'me', 'a', 'an', 'the', 'with', 'who', 'have', 'has', 'and', 'or', 'of', 'in', 'on',
  'for', 'to', 'that', 'is', 'are', 'as', 'but', 'not', 'preferred', 'required', 'developers',
  'developer', 'engineers', 'engineer', 'candidates', 'candidate', 'worked', 'work', 'working',
  'built', 'build', 'developed', 'develop', 'using', 'use', 'experience', 'experienced', 'any',
]);

function canonicalizeSkill(text) {
  const t = ` ${text.toLowerCase().trim()} `;
  for (const [key, def] of Object.entries(SKILL_TAXONOMY)) {
    if (def.aliases.some((a) => t.includes(a.trim()) && a.trim().length > 1)) return key;
    if (t.includes(` ${key.replace('.', '.')} `) || t.includes(key)) return key;
  }
  return null;
}

export function skillMatchesRequirement(candidateSkill, requirementSkill) {
  if (!candidateSkill || !requirementSkill) return false;
  const c = canonicalizeSkill(candidateSkill);
  const r = canonicalizeSkill(requirementSkill);
  if (!c || !r) return candidateSkill.toLowerCase() === requirementSkill.toLowerCase();
  if (c === r) return true;
  const def = SKILL_TAXONOMY[c];
  return Boolean(def?.satisfies?.includes(r));
}

// --- Query parsing -----------------------------------------------------------

const SENIORITY_WORDS = new Set(['junior', 'entry-level', 'entry', 'level', 'graduate', 'senior', 'sr', 'lead', 'principal']);

export function parseQuery(rawQuery) {
  const query = (rawQuery ?? '').trim();
  const lower = query.toLowerCase();

  const seniority = [];
  if (/\b(junior|entry[- ]level|graduate)\b/.test(lower)) seniority.push('junior');
  if (/\b(senior|sr\.?|lead|principal)\b/.test(lower)) seniority.push('senior');

  // Keep dots here so multi-part names like "node.js" survive tokenization.
  const normalized = ` ${lower.replace(/[,;:!?]/g, ' ').replace(/\s+/g, ' ')} `;

  const skills = [];
  for (const [key, def] of Object.entries(SKILL_TAXONOMY)) {
    if (def.aliases.some((a) => a.trim().length > 1 && normalized.includes(` ${a.trim()} `))) {
      if (!skills.includes(key)) skills.push(key);
    }
  }

  // Generic keywords: alphanumeric tokens, no stopwords/seniority/skill tokens.
  const keywords = lower
    .replace(/[^a-z0-9+#-]/g, ' ')
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 2 &&
        !STOPWORDS.has(w) &&
        !SENIORITY_WORDS.has(w) &&
        !skills.some((s) => SKILL_TAXONOMY[s].aliases.includes(w)) &&
        !skills.some((s) => SKILL_TAXONOMY[s].label.toLowerCase() === w)
    );

  return {
    raw: query,
    skills,
    seniority,
    keywords: [...new Set(keywords)],
  };
}

// --- Requirement status per candidate ---------------------------------------

const STATUS_RANK = { assessment: 3, supporting: 2, needs_review: 1.5, claimed: 1, not_established: 0 };

export function requirementStatusFor(corpusEntry, requirementSkill) {
  const skillDefs = corpusEntry.skills.filter((s) => skillMatchesRequirement(s.skill, requirementSkill));
  const evidenceRecords = corpusEntry.evidence.filter((ev) =>
    skillMatchesRequirement(ev.skill, requirementSkill)
  );
  const submissions = corpusEntry.submissions.filter((x) =>
    skillMatchesRequirement(x.assessment?.skill, requirementSkill) && x.status === 'completed'
  );

  let status = 'not_established';
  const source = [];
  if (skillDefs.length > 0) {
    status = 'claimed';
    source.push({ type: 'skills', detail: `Skills list includes ${skillDefs.map((s) => s.skill).join(', ')}` });
  }
  for (const ev of evidenceRecords) {
    if (STATUS_RANK[ev.status] > STATUS_RANK[status]) {
      status = ev.status;
      source.length = 0;
    }
    if (STATUS_RANK[ev.status] === STATUS_RANK[status]) {
      source.push({
        type: 'evidence',
        evidenceId: ev.id,
        excerpt: ev.excerpt,
        location: ev.location,
        sourceName: ev.sourceName,
      });
    }
  }
  for (const sub of submissions) {
    status = 'assessment';
    source.push({
      type: 'assessment',
      submissionId: sub.id,
      detail: `Assessment "${sub.assessment?.title}" completed${sub.score != null ? ` — score ${sub.score}` : ''}`,
    });
  }
  return { status, source };
}

// --- Profile text search ------------------------------------------------------

function entryText(entry) {
  const parts = [
    entry.candidate.fullName,
    entry.candidate.headline,
    entry.candidate.summary,
    entry.candidate.currentCompany,
    entry.skills.map((s) => s.skill).join(' '),
    entry.experience.flatMap((e) => [e.company, e.title, e.summary, ...(e.highlights ?? [])]),
    entry.projects.flatMap((p) => [p.name, p.summary, ...(p.tech ?? [])]),
    entry.evidence.map((e) => e.excerpt),
  ];
  return parts.flat().filter(Boolean).join(' ').toLowerCase();
}

function keywordHits(entry, keywords) {
  const text = entryText(entry);
  return keywords.filter((k) => text.includes(k));
}

// --- Ranking -----------------------------------------------------------------
// Weights are fixed and documented; each component is returned per result.

const WEIGHTS = { requirementEvidence: 1.0, keyword: 0.5, seniority: 0.35 };

export function scoreEntry(entry, parsed, requirements) {
  const components = {
    requirementEvidence: { score: 0, matched: [], unestablished: [] },
    keyword: { score: 0, hits: [] },
    seniority: { score: 0, detail: null },
  };

  // 1. Requirement-level evidence (only when requirements are known)
  if (requirements && requirements.length > 0) {
    for (const req of requirements) {
      const { status, source } = requirementStatusFor(entry, req.skill);
      const contribution =
        req.category === 'preferred' ? 0.5 : 1;
      if (status === 'supporting' || status === 'assessment') {
        components.requirementEvidence.score += contribution;
        components.requirementEvidence.matched.push({ skill: req.skill, category: req.category, status, source });
      } else if (status === 'needs_review') {
        // Ambiguous/uncorroborated — partial credit, flagged for human review.
        components.requirementEvidence.score += 0.4;
        components.requirementEvidence.matched.push({ skill: req.skill, category: req.category, status, source });
      } else if (status === 'claimed') {
        // A bare claim counts less than any located evidence.
        components.requirementEvidence.score += 0.25;
        components.requirementEvidence.matched.push({ skill: req.skill, category: req.category, status, source });
      } else {
        components.requirementEvidence.unestablished.push({ skill: req.skill, category: req.category });
      }
    }
    components.requirementEvidence.max = requirements.reduce(
      (acc, r) => acc + (r.category === 'preferred' ? 0.5 : 1),
      0
    );
  }

  // 2. Keyword overlap over profile text
  const hits = keywordHits(entry, parsed.keywords);
  components.keyword.hits = hits;
  if (parsed.keywords.length > 0) {
    components.keyword.score = hits.length / parsed.keywords.length;
  }

  // 3. Seniority alignment (never a disqualifier — informational)
  if (parsed.seniority.includes('junior')) {
    const isJunior = entry.candidate.yearsExperience <= 2 || /junior/i.test(entry.candidate.headline);
    components.seniority = { score: isJunior ? 1 : 0, detail: isJunior ? 'Matches junior level' : 'More experienced than junior' };
  } else if (parsed.seniority.includes('senior')) {
    const isSenior = entry.candidate.yearsExperience >= 5 || /senior|lead/i.test(entry.candidate.headline);
    components.seniority = { score: isSenior ? 1 : 0, detail: isSenior ? 'Matches senior level' : 'Less experienced than senior' };
  }

  const total =
    (components.requirementEvidence.max
      ? components.requirementEvidence.score / components.requirementEvidence.max
      : 0) *
      WEIGHTS.requirementEvidence +
    components.keyword.score * WEIGHTS.keyword +
    components.seniority.score * WEIGHTS.seniority;

  return { total: Math.round(total * 100) / 100, components };
}

// --- Main entry point ---------------------------------------------------------

export function searchCandidates(corpus, { query = '', jobId = null, jobRequirements = null, filters = {} } = {}) {
  const parsed = parseQuery(query);
  // Free-text queries get requirements synthesized from the skills detected in
  // the query itself, so requirement-level evidence matching applies there too.
  const requirements =
    jobRequirements ??
    (parsed.skills.length > 0
      ? parsed.skills.map((s) => ({ skill: SKILL_TAXONOMY[s].label, category: 'required' }))
      : null);
  let entries = [...corpus];

  // Structural filters (explicit user intent — applied before ranking)
  if (filters.skill) {
    entries = entries.filter((e) => e.skills.some((s) => skillMatchesRequirement(s.skill, filters.skill)));
  }
  if (filters.minYears != null && filters.minYears !== '') {
    entries = entries.filter((e) => e.candidate.yearsExperience >= Number(filters.minYears));
  }
  if (filters.maxYears != null && filters.maxYears !== '') {
    entries = entries.filter((e) => e.candidate.yearsExperience <= Number(filters.maxYears));
  }
  if (filters.assessmentStatus === 'completed') {
    entries = entries.filter((e) => e.submissions.some((x) => x.status === 'completed'));
  }
  if (filters.assessmentStatus === 'none') {
    entries = entries.filter((e) => e.submissions.length === 0);
  }
  if (filters.evidenceStatus) {
    entries = entries.filter((e) => e.evidence.some((ev) => ev.status === filters.evidenceStatus));
  }
  // Job scoping: selecting a job supplies its requirements for evidence
  // matching. Candidates are only *filtered* to the existing pipeline when the
  // recruiter explicitly asks for it — otherwise a job search should find the
  // best evidence-backed candidates, not just people who already applied.
  if (jobId && filters.onlyApplicants) {
    entries = entries.filter((e) => (e.applications ?? []).some((a) => a.jobId === jobId));
  }

  const scored = entries
    .map((entry) => {
      const { total, components } = scoreEntry(entry, parsed, requirements);
      return { entry, total, components };
    })
    // A result must be relevant somehow: matched a skill/keyword, or matched
    // at least one requirement. Zero-signal entries are dropped so the empty
    // state stays honest.
    .filter(({ total, components }) => {
      const hasSignal =
        total > 0 ||
        components.keyword.hits.length > 0 ||
        components.requirementEvidence.matched.length > 0;
      // With no query and no requirements (plain browse), keep everyone.
      return !query && !requirements ? true : hasSignal;
    });

  const sort = filters.sort ?? 'relevance';
  scored.sort((a, b) => {
    if (sort === 'experience') return b.entry.candidate.yearsExperience - a.entry.candidate.yearsExperience;
    if (sort === 'name') return a.entry.candidate.fullName.localeCompare(b.entry.candidate.fullName);
    return b.total - a.total;
  });

  return {
    parsed,
    mode: parsed.skills.length > 0 || parsed.keywords.length > 0 ? 'keyword+requirement' : 'browse',
    results: scored.map(({ entry, total, components }) => ({
      candidate: entry.candidate,
      skills: entry.skills,
      // Small, relevant slices of the record so the UI can show *why* a result
      // matched without shipping the whole profile in the response.
      experience: entry.experience.slice(0, 2),
      projects: entry.projects.slice(0, 2),
      score: total,
      scoreComponents: components,
    })),
  };
}

export default { searchCandidates, parseQuery, requirementStatusFor, skillMatchesRequirement, SKILL_TAXONOMY };
