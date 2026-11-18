// Browser-search projection tests.
//
// The /search page ranks entirely in the browser, so the projection embedded
// in the cached document must (a) carry every field the engine reads and
// (b) never ship resumes, emails or submission answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toClientCorpus, skillVocabulary } from '@/lib/search/client-corpus';
import { searchCandidates } from '@/lib/search/engine';

function corpusEntry(overrides = {}) {
  const id = overrides.id ?? 'cand-1';
  return {
    candidate: {
      id,
      fullName: 'Mira Odell',
      headline: 'Senior Frontend Engineer',
      email: 'mira@example.com',
      location: 'Berlin',
      yearsExperience: 6,
      currentCompany: 'Acme',
      status: 'active',
      source: 'sourced',
      summary: 'Builds React and TypeScript products.',
      links: { github: 'https://example.com/mira' },
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides.candidate,
    },
    skills: overrides.skills ?? [
      { candidateId: id, skill: 'React', years: 6, level: 'senior', source: 'resume' },
      { candidateId: id, skill: 'TypeScript', years: 5, level: 'senior', source: 'resume' },
    ],
    evidence: overrides.evidence ?? [
      {
        id: 'ev-1',
        candidateId: id,
        skill: 'React',
        status: 'supporting',
        excerpt: 'Led the React design-system migration.',
        location: { page: 2, section: 'Experience' },
        sourceName: 'mira-cv.pdf',
        extractor: 'resume-extractor',
        notes: 'internal note',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ],
    experience: overrides.experience ?? [
      {
        candidateId: id,
        company: 'Acme',
        title: 'Senior Frontend Engineer',
        start: '2022-01',
        end: null,
        location: 'Berlin',
        summary: 'Owned the component library.',
        highlights: ['React migration'],
      },
    ],
    projects: overrides.projects ?? [
      {
        candidateId: id,
        name: 'Design system',
        summary: 'A React component library.',
        tech: ['React', 'TypeScript'],
        url: 'https://example.com/project',
      },
    ],
    submissions: overrides.submissions ?? [
      {
        id: 'sub-1',
        candidateId: id,
        assessmentId: 'asmt-1',
        status: 'completed',
        score: 92,
        result: { code: 'console.log("private submission")' },
        assessment: {
          id: 'asmt-1',
          title: 'Frontend task',
          skill: 'React',
          instructions: 'private assessment instructions',
        },
      },
    ],
    applications: overrides.applications ?? [
      { id: 'app-1', candidateId: id, jobId: 'job-1', stage: 'screening', createdAt: '2026-01-03T00:00:00.000Z' },
    ],
    resume: {
      id: 'res-1',
      candidateId: id,
      filename: 'mira-cv.pdf',
      fullText: 'private resume text',
      sections: [{ page: 1, section: 'Experience', text: 'private' }],
    },
  };
}

test('ranked projected search results do not expose private source records', () => {
  const corpus = toClientCorpus([corpusEntry()]);
  const { results } = searchCandidates(corpus, { query: 'React' });
  assert.equal(results.length, 1);
  const serialized = JSON.stringify(results);
  for (const secret of ['mira@example.com', 'private resume text', 'private submission', 'private assessment instructions', 'internal note']) {
    assert.equal(serialized.includes(secret), false, `leaked: ${secret}`);
  }
});

test('toClientCorpus strips PII, resumes and submission payloads', () => {
  const [entry] = toClientCorpus([corpusEntry()]);
  const serialized = JSON.stringify(entry);

  for (const secret of [
    'mira@example.com',
    'private resume text',
    'private submission',
    'private assessment instructions',
    'internal note',
    'https://example.com/mira',
  ]) {
    assert.ok(!serialized.includes(secret), `projection must not contain ${secret}`);
  }
  assert.equal(entry.resume, undefined, 'resume must not be projected');
  assert.equal(entry.candidate.email, undefined);
});

test('toClientCorpus keeps every field the result card renders', () => {
  const [entry] = toClientCorpus([corpusEntry()]);
  assert.equal(entry.candidate.id, 'cand-1');
  assert.equal(entry.candidate.fullName, 'Mira Odell');
  assert.equal(entry.candidate.headline, 'Senior Frontend Engineer');
  assert.equal(entry.candidate.location, 'Berlin');
  assert.equal(entry.candidate.yearsExperience, 6);
  assert.equal(entry.candidate.currentCompany, 'Acme');
  assert.equal(entry.candidate.summary, 'Builds React and TypeScript products.');
  assert.equal(entry.skills[0].years, 6);
  assert.equal(entry.evidence[0].excerpt, 'Led the React design-system migration.');
  assert.equal(entry.experience[0].highlights[0], 'React migration');
  assert.equal(entry.projects[0].tech[0], 'React');
  assert.equal(entry.submissions[0].assessment.title, 'Frontend task');
  assert.equal(entry.applications[0].jobId, 'job-1');
});

test('ranking is identical before and after projection', () => {
  const corpus = [
    corpusEntry(),
    corpusEntry({
      id: 'cand-2',
      candidate: {
        id: 'cand-2',
        fullName: 'Noah Kim',
        headline: 'Data Engineer',
        yearsExperience: 3,
        summary: 'Builds Python and SQL pipelines.',
      },
      skills: [
        { candidateId: 'cand-2', skill: 'Python', years: 3 },
        { candidateId: 'cand-2', skill: 'SQL', years: 3 },
      ],
      evidence: [
        { id: 'ev-2', candidateId: 'cand-2', skill: 'Python', status: 'supporting', excerpt: 'Python pipelines' },
      ],
      applications: [{ id: 'app-2', candidateId: 'cand-2', jobId: 'job-2', stage: 'applied' }],
    }),
  ];
  const options = {
    query: 'senior react typescript engineer',
    jobId: 'job-1',
    jobRequirements: [
      { skill: 'React', category: 'required' },
      { skill: 'TypeScript', category: 'preferred' },
    ],
    filters: {},
  };

  const before = searchCandidates(corpus, options).results;
  const after = searchCandidates(toClientCorpus(corpus), options).results;

  assert.deepEqual(
    after.map((r) => ({ id: r.candidate.id, score: r.score, matched: r.scoreComponents.requirementEvidence.matched.length })),
    before.map((r) => ({ id: r.candidate.id, score: r.score, matched: r.scoreComponents.requirementEvidence.matched.length }))
  );
});

test('onlyApplicants still works after projection', () => {
  const corpus = toClientCorpus([
    corpusEntry(),
    corpusEntry({
      id: 'cand-2',
      candidate: { id: 'cand-2', fullName: 'Noah Kim', yearsExperience: 3 },
      applications: [{ id: 'app-2', candidateId: 'cand-2', jobId: 'job-2', stage: 'applied' }],
    }),
  ]);
  const { results } = searchCandidates(corpus, {
    query: '',
    jobId: 'job-1',
    jobRequirements: [{ skill: 'React', category: 'required' }],
    filters: { onlyApplicants: true },
  });
  assert.deepEqual(results.map((r) => r.candidate.id), ['cand-1']);
});

test('skillVocabulary is unique and sorted', () => {
  const vocab = skillVocabulary(toClientCorpus([corpusEntry(), corpusEntry({ id: 'cand-2' })]));
  assert.deepEqual(vocab, ['React', 'TypeScript']);
});
