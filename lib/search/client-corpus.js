// ---------------------------------------------------------------------------
// Browser-safe projection of the search corpus.
//
// Ranking runs in the browser so a search costs no Worker CPU (Workers Free
// allows 10 ms per request). The /search page embeds this projection in the
// edge-cached document; only fields the ranking engine and result cards read
// survive. Resumes, emails, links, submission answers and audit data are
// deliberately excluded — they are never needed to rank or explain a match.
//
// The projection must stay a superset of every field read by:
//   - lib/search/engine.js (entryText, requirementStatusFor, scoreEntry)
//   - components/search/SearchClient.jsx (ResultCard, RequirementLines)
// tests/search-client-corpus.test.js asserts ranking parity for this reason.
// ---------------------------------------------------------------------------

const MAX_SUMMARY = 4000;
const MAX_EXCERPT = 2000;
const MAX_HIGHLIGHT = 1000;
const MAX_PROJECT_TEXT = 2000;

function clip(value, max) {
  if (typeof value !== 'string') return value ?? null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function toClientCorpus(corpus = []) {
  return corpus.map((entry) => {
    const candidate = entry.candidate ?? {};
    return {
      candidate: {
        id: candidate.id,
        fullName: candidate.fullName ?? '',
        headline: candidate.headline ?? '',
        location: candidate.location ?? null,
        yearsExperience: candidate.yearsExperience ?? null,
        currentCompany: candidate.currentCompany ?? null,
        summary: clip(candidate.summary, MAX_SUMMARY),
      },
      skills: (entry.skills ?? []).map((s) => ({
        candidateId: s.candidateId ?? candidate.id,
        skill: s.skill,
        years: s.years ?? null,
      })),
      evidence: (entry.evidence ?? []).map((e) => ({
        id: e.id,
        candidateId: e.candidateId ?? candidate.id,
        skill: e.skill,
        status: e.status,
        excerpt: clip(e.excerpt, MAX_EXCERPT),
        location: e.location ?? null,
        sourceName: e.sourceName ?? null,
      })),
      experience: (entry.experience ?? []).map((e) => ({
        candidateId: e.candidateId ?? candidate.id,
        company: e.company ?? null,
        title: e.title ?? null,
        summary: clip(e.summary, MAX_SUMMARY),
        highlights: (e.highlights ?? []).map((h) => clip(h, MAX_HIGHLIGHT)),
      })),
      projects: (entry.projects ?? []).map((p) => ({
        candidateId: p.candidateId ?? candidate.id,
        name: p.name ?? null,
        summary: clip(p.summary, MAX_PROJECT_TEXT),
        tech: p.tech ?? [],
      })),
      submissions: (entry.submissions ?? []).map((s) => ({
        id: s.id,
        candidateId: s.candidateId ?? candidate.id,
        status: s.status,
        score: s.score ?? null,
        assessment: s.assessment
          ? {
              id: s.assessment.id,
              title: s.assessment.title,
              skill: s.assessment.skill,
            }
          : null,
      })),
      applications: (entry.applications ?? []).map((a) => ({
        candidateId: a.candidateId ?? candidate.id,
        jobId: a.jobId,
        stage: a.stage ?? null,
      })),
    };
  });
}

// Skills shown in the filter dropdown come from the same corpus the browser
// ranks, so the vocabulary can never advertise a skill the index cannot search.
export function skillVocabulary(corpus = []) {
  const skills = new Set();
  for (const entry of corpus) {
    for (const s of entry.skills ?? []) {
      if (s.skill) skills.add(s.skill);
    }
  }
  return [...skills].sort((a, b) => a.localeCompare(b));
}
