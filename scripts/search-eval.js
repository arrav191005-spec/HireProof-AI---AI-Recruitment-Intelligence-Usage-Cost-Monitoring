// Runs the judged search evaluation (tests/search-eval.json) through the live
// search engine and prints P@5 / R@5 / MRR plus the per-query breakdown.
//
//   npm run eval:search
//   npm run eval:search -- --k 10
//
// The numbers measure retrieval logic on a small, manually judged synthetic
// corpus — they are not a production search-quality claim.
import { runSearchEvaluation } from '@/lib/search/evaluation';

const kArgIndex = process.argv.indexOf('--k');
const k = kArgIndex !== -1 ? Number(process.argv[kArgIndex + 1]) : 5;

if (!Number.isInteger(k) || k < 1 || k > 50) {
  console.error(`Invalid --k "${process.argv[kArgIndex + 1]}" — expected an integer between 1 and 50.`);
  process.exit(2);
}

const fmt = (v) => (v == null ? '  n/a' : v.toFixed(2).padStart(5));

try {
  const run = await runSearchEvaluation(k);

  console.log('');
  console.log(`Search evaluation — k=${run.k}, ${run.queryCount} judged queries, corpus ${run.corpusSize}`);
  console.log(`Ran at ${run.ranAt}`);
  console.log('');
  console.log(`  Precision@${run.k}  ${run.precisionAt5}`);
  console.log(`  Recall@${run.k}     ${run.recallAt5}`);
  console.log(`  MRR               ${run.mrr}`);
  console.log('');
  console.log('  per query:');
  for (const q of run.perQuery) {
    const missed = q.missedRelevant.length ? `  missed: ${q.missedRelevant.join(', ')}` : '';
    console.log(
      `    P${fmt(q.precisionAt5)}  R${fmt(q.recallAt5)}  MRR${fmt(q.mrr)}  ${q.query}${missed}`
    );
  }
  console.log('');
  console.log(`  note: ${run.note}`);
  console.log('');
} catch (err) {
  console.error('Evaluation failed:', err?.message ?? err);
  process.exit(1);
}
