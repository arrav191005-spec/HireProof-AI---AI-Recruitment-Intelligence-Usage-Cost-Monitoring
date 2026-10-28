// Generates a small but *real* PDF resume (fictional person, synthetic text)
// for manual verification and integration tests — no third-party PDF library,
// just the raw PDF object graph with correct byte offsets for the xref table.
//
//   node scripts/make-test-resume.mjs [outputPath]
//
// Default output: tests/fixtures/sample-resume.pdf
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PAGES = [
  [
    'MIRA ODELL',
    'mira.odell@example.com | Bristol, UK',
    'Backend Developer',
    '',
    'SUMMARY',
    'Backend developer with 5 years of experience building APIs and data pipelines.',
    '',
    'SKILLS',
    'Python, FastAPI, PostgreSQL, Docker, Kafka, Git',
    '',
    'EXPERIENCE',
    'Backend Developer at Larkspur Systems | 2021-03 - Present',
    'Designed FastAPI services and PostgreSQL schemas; containerised with Docker.',
    'Wrote Kafka consumers feeding the reporting database. Code reviewed via Git.',
    '',
    'Junior Developer at Kestrel Media | 2019-01 - 2021-02',
    'Maintained REST endpoints in Python and wrote pytest suites.',
  ],
  [
    'PROJECTS',
    'Queue metrics dashboard',
    'Python service streaming Kafka events into a PostgreSQL dashboard.',
    '',
    'EDUCATION',
    'BSc Computer Science',
    'University of Bristol 2019',
    '',
    'REFERENCES',
    'Available on request.',
  ],
];

function escapePdfText(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function contentStream(lines) {
  const ops = ['BT', '/F1 11 Tf', '14 TL', '72 720 Td'];
  lines.forEach((line, i) => {
    if (i > 0) ops.push('T*');
    ops.push(`(${escapePdfText(line)}) Tj`);
  });
  ops.push('ET');
  return ops.join('\n');
}

function buildPdf(pages) {
  // Objects: 1 catalog, 2 pages, then per page: [page, content], then font.
  const objects = [];
  const pageObjIds = [];
  const fontId = 3 + pages.length * 2;

  for (let i = 0; i < pages.length; i += 1) pageObjIds.push(3 + i * 2);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  pages.forEach((lines, i) => {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    const stream = contentStream(lines);
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let body = '%PDF-1.4\n';
  const offsets = [0];
  const maxId = objects.length - 1;
  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = Buffer.byteLength(body);
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  const count = maxId + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) {
    xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'binary');
}

const outPath = path.resolve(
  process.argv[2] ?? path.join(process.cwd(), 'tests', 'fixtures', 'sample-resume.pdf')
);
mkdirSync(path.dirname(outPath), { recursive: true });
const pdf = buildPdf(PAGES);
writeFileSync(outPath, pdf);
console.log(`wrote ${outPath} (${pdf.length} bytes, ${PAGES.length} pages)`);
