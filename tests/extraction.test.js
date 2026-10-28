// Resume extraction + grounding tests. The core promise: every excerpt must be
// a real substring of the parsed document and every page must be locatable —
// nothing is invented when it cannot be proven. Run with:
//   node --import ./tests/helpers/register-alias.mjs --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { demoExtract, parseResumePdf } from '@/lib/ai-client';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PAGE1 = `MIRA ODELL
mira.odell@example.com | Bristol, UK
Backend Developer

SUMMARY
Backend developer with 5 years of experience building APIs and data pipelines.

SKILLS
Python, FastAPI, PostgreSQL, Docker, Kafka, Git

EXPERIENCE
Backend Developer at Larkspur Systems | 2021-03 - Present
Designed FastAPI services and PostgreSQL schemas; containerised with Docker.
Wrote Kafka consumers feeding the reporting database. Code reviewed via Git.

Junior Developer at Kestrel Media | 2019-01 - 2021-02
Maintained REST endpoints in Python and wrote pytest suites.`;

const PAGE2 = `PROJECTS
Queue metrics dashboard
Python service streaming Kafka events into a PostgreSQL dashboard.

EDUCATION
BSc Computer Science
University of Bristol 2019

REFERENCES
Available on request.`;

const PAGES = [
  { page: 1, text: PAGE1 },
  { page: 2, text: PAGE2 },
];
const FULL_TEXT = PAGES.map((p) => p.text).join('\n\n');

// --- grounding invariants -------------------------------------------------------

test('every extracted excerpt is a verbatim substring of the source page', () => {
  const ex = demoExtract({ text: FULL_TEXT, pages: PAGES });
  assert.ok(ex.evidence.length > 0, 'fixture should produce evidence');
  for (const ev of ex.evidence) {
    const page = PAGES.find((p) => p.page === ev.page);
    assert.ok(page, `page ${ev.page} must exist`);
    assert.ok(
      page.text.includes(ev.excerpt),
      `excerpt for ${ev.skill} is not on page ${ev.page}: ${JSON.stringify(ev.excerpt)}`
    );
  }
});

test('every skill excerpt is a verbatim substring too', () => {
  const ex = demoExtract({ text: FULL_TEXT, pages: PAGES });
  for (const s of ex.skills) {
    if (!s.excerpt) continue;
    const page = PAGES.find((p) => p.page === s.page);
    assert.ok(page?.text.includes(s.excerpt), `skill excerpt for ${s.skill} not found on its page`);
  }
});

test('page numbers never point outside the document', () => {
  const ex = demoExtract({ text: FULL_TEXT, pages: PAGES });
  for (const ev of ex.evidence) {
    assert.ok(ev.page >= 1 && ev.page <= PAGES.length, `bad page ${ev.page}`);
  }
});

test('only the five evidence statuses are ever produced', () => {
  const allowed = ['claimed', 'supporting', 'assessment', 'not_established', 'needs_review'];
  const ex = demoExtract({ text: FULL_TEXT, pages: PAGES });
  for (const ev of ex.evidence) {
    assert.ok(allowed.includes(ev.status), `unexpected status ${ev.status}`);
  }
});

// --- field extraction ------------------------------------------------------------

test('name is normalised from an ALL-CAPS header', () => {
  const ex = demoExtract({ text: FULL_TEXT, pages: PAGES });
  assert.equal(ex.name, 'Mira Odell');
});

test('email, headline and years are located, not guessed', () => {
  const ex = demoExtract({ text: FULL_TEXT, pages: PAGES });
  assert.equal(ex.email, 'mira.odell@example.com');
  assert.equal(ex.headline, 'Backend Developer');
  assert.equal(ex.yearsExperience, 5);
});

test('experience blocks are split per role with clean company names', () => {
  const ex = demoExtract({ text: FULL_TEXT, pages: PAGES });
  assert.equal(ex.experience.length, 2, 'two roles expected');
  const [first, second] = ex.experience;
  assert.equal(first.title, 'Backend Developer');
  assert.equal(first.company, 'Larkspur Systems', 'trailing separators must be stripped');
  assert.equal(first.start, '2021-03');
  assert.equal(first.end, null, 'Present maps to an open-ended role');
  assert.equal(second.company, 'Kestrel Media');
  assert.equal(second.end, '2021-02');
});

test('education carries school and year in the stored shape', () => {
  const ex = demoExtract({ text: FULL_TEXT, pages: PAGES });
  const edu = ex.education.find((e) => e.school === 'University of Bristol');
  assert.ok(edu, `education entry missing: ${JSON.stringify(ex.education)}`);
  assert.equal(edu.year, '2019');
  assert.ok(edu.degree.includes('Computer Science'));
});

test('content after an unclassified ALL-CAPS heading does not leak into the previous section', () => {
  const ex = demoExtract({ text: FULL_TEXT, pages: PAGES });
  for (const p of ex.projects) {
    assert.ok(!/REFERENCES/i.test(p.name + p.summary), 'REFERENCES leaked into projects');
  }
  for (const e of ex.education) {
    assert.ok(!/REFERENCES/i.test(`${e.school} ${e.degree}`), 'REFERENCES leaked into education');
  }
});

// --- conservative behaviour on sparse input --------------------------------------

test('missing fields stay null instead of being invented', () => {
  const sparse = [{ page: 1, text: 'SKILLS\nReact, TypeScript' }];
  const ex = demoExtract({ text: sparse[0].text, pages: sparse });
  assert.equal(ex.name, null, 'no name without a header');
  assert.equal(ex.email, null, 'no email without an address');
  assert.equal(ex.yearsExperience, null, 'no years without a claim or date range');
  assert.deepEqual(ex.experience, [], 'no roles without an experience section');
  assert.deepEqual(ex.education, [], 'no education without an education section');
});

test('extraction with no pages still works (single-page fallback)', () => {
  const ex = demoExtract({ text: 'SKILLS\nReact', pages: [] });
  assert.ok(ex.skills.some((s) => s.skill === 'React'));
});

test('an empty document yields an empty, non-crashing extraction', () => {
  const ex = demoExtract({ text: '', pages: [{ page: 1, text: '' }] });
  assert.equal(ex.name, null);
  assert.deepEqual(ex.evidence, []);
});

// --- real PDF parsing ------------------------------------------------------------

test('the committed PDF fixture parses into 2 real pages of text', async () => {
  const file = path.join(process.cwd(), 'tests', 'fixtures', 'sample-resume.pdf');
  const bytes = await readFile(file);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', 'fixture must be a real PDF');
  const parsed = await parseResumePdf({ filename: 'sample-resume.pdf', bytes });
  assert.equal(parsed.pageCount, 2);
  assert.ok(parsed.fullText.includes('MIRA ODELL'), 'page 1 text extracted');
  assert.ok(parsed.fullText.includes('EDUCATION'), 'page 2 text extracted');
  assert.equal(parsed.pages.length, 2);
  assert.ok(parsed.pages[1].text.includes('University of Bristol'), 'per-page text preserved');
  assert.equal(typeof parsed.via, 'string');
});

test('a corrupt PDF is rejected with a fatal, user-safe error', async () => {
  const bytes = Buffer.from('%PDF-1.4\nthis is not a real pdf object graph');
  await assert.rejects(
    () => parseResumePdf({ filename: 'broken.pdf', bytes }),
    (err) => err.fatal === true && err.status === 422
  );
});
