// Search engine unit tests: query parsing, requirement matching, transparent
// scoring and structural filters. Run with:
//   node --import ./tests/helpers/register-alias.mjs --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKILL_TAXONOMY,
  parseQuery,
  skillMatchesRequirement,
  requirementStatusFor,
  scoreEntry,
  searchCandidates,
} from '@/lib/search/engine';

function entry(overrides = {}) {
  return {
    candidate: {
      id: 'cand-x',
      fullName: 'Test Candidate',
      headline: 'Backend Developer',
      yearsExperience: 5,
      location: null,
      currentCompany: null,
      ...overrides.candidate,
    },
    skills: overrides.skills ?? [],
    evidence: overrides.evidence ?? [],
    submissions: overrides.submissions ?? [],
    experience: overrides.experience ?? [],
    projects: overrides.projects ?? [],
  };
}

// --- parseQuery ----------------------------------------------------------------

test('parseQuery detects taxonomy skills from free text', () => {
  const p = parseQuery('senior React TypeScript engineer with Next.js experience');
  assert.ok(p.skills.includes('react'), 'react detected');
  assert.ok(p.skills.includes('typescript'), 'typescript detected');
  assert.ok(p.skills.includes('nextjs'), 'nextjs detected');
  assert.deepEqual(p.seniority, ['senior']);
});

test('parseQuery keeps multi-part identifiers like node.js', () => {
  const p = parseQuery('node.js backend developer');
  assert.ok(p.skills.includes('node.js'));
});

test('parseQuery never returns stopwords or seniority words as keywords', () => {
  const p = parseQuery('junior developer with react experience');
  for (const w of ['with', 'junior', 'developer', 'experience']) {
    assert.ok(!p.keywords.includes(w), `"${w}" should not be a keyword`);
  }
});

test('parseQuery tolerates empty and non-string input', () => {
  assert.deepEqual(parseQuery('').skills, []);
  assert.deepEqual(parseQuery(null).keywords, []);
  assert.deepEqual(parseQuery(undefined).raw, '');
});

// --- skillMatchesRequirement ----------------------------------------------------

test('skillMatchesRequirement matches exact and canonical equivalents', () => {
  assert.ok(skillMatchesRequirement('React', 'react'));
  assert.ok(skillMatchesRequirement('Next.js', 'Next.js'));
});

test('skillMatchesRequirement honours taxonomy "satisfies" (postgres satisfies sql)', () => {
  assert.ok(skillMatchesRequirement('PostgreSQL', 'SQL'));
  assert.ok(skillMatchesRequirement('MySQL', 'SQL'));
});

test('skillMatchesRequirement does not claim unrelated skills match', () => {
  assert.ok(!skillMatchesRequirement('Figma', 'SQL'));
  assert.ok(!skillMatchesRequirement('React', 'Python'));
});

test('skillMatchesRequirement is false for empty inputs', () => {
  assert.ok(!skillMatchesRequirement('', 'SQL'));
  assert.ok(!skillMatchesRequirement('SQL', null));
});

// --- requirementStatusFor -------------------------------------------------------

test('requirementStatusFor reports not_established when nothing is present', () => {
  const r = requirementStatusFor(entry(), 'Kafka');
  assert.equal(r.status, 'not_established');
});

test('requirementStatusFor reports claimed for a bare skills-list mention', () => {
  const e = entry({ skills: [{ skill: 'Kafka' }] });
  assert.equal(requirementStatusFor(e, 'Kafka').status, 'claimed');
});

test('requirementStatusFor reports supporting when a located excerpt exists', () => {
  const e = entry({
    skills: [{ skill: 'Kafka' }],
    evidence: [{ skill: 'Kafka', status: 'supporting', excerpt: 'used kafka' }],
  });
  assert.equal(requirementStatusFor(e, 'Kafka').status, 'supporting');
});

test('requirementStatusFor reports assessment for a completed submission', () => {
  const e = entry({
    submissions: [{ status: 'completed', assessment: { skill: 'Kafka' } }],
  });
  assert.equal(requirementStatusFor(e, 'Kafka').status, 'assessment');
});

test('requirementStatusFor never promotes not_established to a positive status', () => {
  const e = entry({
    evidence: [{ skill: 'Kafka', status: 'not_established', excerpt: 'nothing' }],
  });
  assert.equal(requirementStatusFor(e, 'Kafka').status, 'not_established');
});

// --- scoreEntry -----------------------------------------------------------------

test('scoreEntry exposes named components, not one opaque number', () => {
  const e = entry({
    skills: [{ skill: 'React' }, { skill: 'TypeScript' }],
    evidence: [
      { skill: 'React', status: 'supporting', excerpt: 'react app' },
      { skill: 'TypeScript', status: 'supporting', excerpt: 'ts code' },
    ],
  });
  const { total, components } = scoreEntry(e, parseQuery('react typescript'), null);
  assert.equal(typeof total, 'number');
  assert.ok(total >= 0 && total <= 1, 'total is normalised');
  assert.ok(components.keyword, 'keyword component present');
  assert.ok(components.seniority, 'seniority component present');
  assert.ok('hits' in components.keyword, 'keyword hits are listed');
});

test('scoreEntry gives located evidence more credit than a bare claim', () => {
  const requirements = [{ skill: 'Kafka', category: 'required' }];
  const bare = entry({ skills: [{ skill: 'Kafka' }] });
  const backed = entry({
    skills: [{ skill: 'Kafka' }],
    evidence: [{ skill: 'Kafka', status: 'supporting', excerpt: 'kafka pipelines' }],
  });
  const sBare = scoreEntry(bare, parseQuery(''), requirements);
  const sBacked = scoreEntry(backed, parseQuery(''), requirements);
  assert.ok(
    sBacked.total > sBare.total,
    `evidence-backed (${sBacked.total}) must outrank bare claim (${sBare.total})`
  );
});

test('scoreEntry never exceeds 1.0 even with many requirements', () => {
  const requirements = [
    { skill: 'React', category: 'required' },
    { skill: 'TypeScript', category: 'required' },
    { skill: 'Node.js', category: 'preferred' },
  ];
  const e = entry({
    skills: [{ skill: 'React' }, { skill: 'TypeScript' }, { skill: 'Node.js' }],
    evidence: [
      { skill: 'React', status: 'supporting', excerpt: 'a' },
      { skill: 'TypeScript', status: 'supporting', excerpt: 'b' },
      { skill: 'Node.js', status: 'supporting', excerpt: 'c' },
    ],
  });
  const { total } = scoreEntry(e, parseQuery('react typescript node.js'), requirements);
  assert.ok(total <= 1, `expected <= 1, got ${total}`);
});

// --- searchCandidates -----------------------------------------------------------

const CORPUS = [
  entry({
    candidate: { id: 'cand-react', fullName: 'React Person', headline: 'Frontend Developer', yearsExperience: 3 },
    skills: [{ skill: 'React' }, { skill: 'TypeScript' }],
    evidence: [{ skill: 'React', status: 'supporting', excerpt: 'built react dashboards' }],
  }),
  entry({
    candidate: { id: 'cand-python', fullName: 'Python Person', headline: 'Backend Developer', yearsExperience: 6 },
    skills: [{ skill: 'Python' }, { skill: 'PostgreSQL' }],
    evidence: [{ skill: 'Python', status: 'supporting', excerpt: 'python services' }],
  }),
  entry({
    candidate: { id: 'cand-designer', fullName: 'Design Person', headline: 'Product Designer', yearsExperience: 4 },
    skills: [{ skill: 'Figma' }],
    evidence: [],
  }),
];

test('searchCandidates ranks the skill-matching candidate first', () => {
  const { results, mode } = searchCandidates(CORPUS, { query: 'python backend developer' });
  assert.equal(results[0].candidate.id, 'cand-python');
  assert.ok(typeof mode === 'string' && mode.length > 0, 'mode is reported honestly');
});

test('searchCandidates results carry a score breakdown', () => {
  const { results } = searchCandidates(CORPUS, { query: 'react developer' });
  const top = results[0];
  assert.ok(typeof top.score === 'number');
  assert.ok(top.scoreComponents, 'components exposed');
  assert.ok(top.scoreComponents.requirementEvidence, 'requirement evidence component exposed');
  assert.ok(Array.isArray(top.scoreComponents.keyword.hits), 'keyword hits listed');
});

test('searchCandidates applies the skill filter', () => {
  const { results } = searchCandidates(CORPUS, { query: '', filters: { skill: 'Figma' } });
  assert.equal(results.length, 1);
  assert.equal(results[0].candidate.id, 'cand-designer');
});

test('searchCandidates applies the min-years filter', () => {
  const { results } = searchCandidates(CORPUS, { query: '', filters: { minYears: 5 } });
  assert.deepEqual(results.map((r) => r.candidate.id), ['cand-python']);
});

test('searchCandidates applies the max-years filter', () => {
  const { results } = searchCandidates(CORPUS, { query: '', filters: { maxYears: 3 } });
  assert.deepEqual(results.map((r) => r.candidate.id), ['cand-react']);
});

test('searchCandidates evidenceStatus filter matches only candidates with that status', () => {
  const { results } = searchCandidates(CORPUS, { query: '', filters: { evidenceStatus: 'claimed' } });
  assert.equal(results.length, 0, 'no claimed evidence in the fixture');

  const withSupporting = searchCandidates(CORPUS, { query: '', filters: { evidenceStatus: 'supporting' } });
  assert.equal(withSupporting.results.length, 2);
});

test('searchCandidates returns every candidate when the query is empty and no filter applies', () => {
  const { results } = searchCandidates(CORPUS, { query: '', filters: {} });
  assert.equal(results.length, CORPUS.length);
});

test('searchCandidates with a job uses the job requirements for evidence scoring', () => {
  const requirements = [
    { skill: 'Python', category: 'required', note: null },
    { skill: 'Figma', category: 'preferred', note: null },
  ];
  const { results } = searchCandidates(CORPUS, { query: '', jobRequirements: requirements });
  assert.equal(results[0].candidate.id, 'cand-python');
  const matched = results[0].scoreComponents.requirementEvidence.matched;
  assert.ok(matched.some((m) => m.skill === 'Python' && m.status === 'supporting'));
  const unestablished = results.find((r) => r.candidate.id === 'cand-designer')
    .scoreComponents.requirementEvidence.unestablished;
  assert.ok(unestablished.some((u) => u.skill === 'Python'), 'missing requirement is listed, not hidden');
});

test('searchCandidates never returns a negative or >1 score', () => {
  for (const q of ['', 'react', 'senior rust cobol mainframe', 'python python python']) {
    const { results } = searchCandidates(CORPUS, { query: q });
    for (const r of results) {
      assert.ok(r.score >= 0 && r.score <= 1, `score ${r.score} out of range for "${q}"`);
    }
  }
});

test('SKILL_TAXONOMY labels are unique (badges would collide otherwise)', () => {
  const labels = Object.values(SKILL_TAXONOMY).map((d) => d.label);
  assert.equal(new Set(labels).size, labels.length, 'duplicate taxonomy labels');
});
