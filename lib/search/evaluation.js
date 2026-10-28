// Search-quality evaluation: runs the judged query set (tests/search-eval.json)
// through the live search engine and computes Precision@5, Recall@5 and MRR.
//
// The dataset is manually judged against the synthetic demo corpus, so the
// numbers measure the *retrieval logic* on demo data — they are not production
// search-quality claims. The UI shows a setup state until an evaluation has
// actually been run.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import getRepo from '@/lib/repo';
import { searchCandidates } from '@/lib/search/engine';

export async function loadJudgedQueries() {
  const file = path.join(process.cwd(), 'tests', 'search-eval.json');
  const raw = JSON.parse(await readFile(file, 'utf8'));
  return raw.judgedQueries;
}

function metricsForRun(rankedIds, judgments, k = 5) {
  const relevant = Object.entries(judgments).filter(([, rel]) => rel >= 1).map(([id]) => id);
  const topK = rankedIds.slice(0, k);

  const relevantInTopK = topK.filter((id) => judgments[id] >= 1).length;
  const precisionAtK = relevantInTopK / Math.max(1, Math.min(k, rankedIds.length || k));
  const recallAtK = relevant.length === 0 ? null : relevantInTopK / relevant.length;

  let mrr = 0;
  for (let i = 0; i < rankedIds.length; i++) {
    if (judgments[rankedIds[i]] >= 1) {
      mrr = 1 / (i + 1);
      break;
    }
  }
  return {
    precisionAt5: Math.round(precisionAtK * 100) / 100,
    recallAt5: recallAtK == null ? null : Math.round(recallAtK * 100) / 100,
    mrr: Math.round(mrr * 100) / 100,
    rankedIds,
    relevant,
  };
}

export async function runSearchEvaluation(k = 5) {
  const repo = await getRepo();
  const corpus = await repo.searchCorpus();
  const queries = await loadJudgedQueries();

  const perQuery = queries.map(({ id, query, judgments }) => {
    const { results } = searchCandidates(corpus, { query });
    const rankedIds = results.map((r) => r.candidate.id);
    const metrics = metricsForRun(rankedIds, judgments, k);
    const missed = metrics.relevant.filter((rid) => !rankedIds.slice(0, k).includes(rid));
    return { id, query, ...metrics, missedRelevant: missed };
  });

  const avg = (key) => {
    const vals = perQuery.map((q) => q[key]).filter((v) => v != null);
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
  };

  return {
    ranAt: new Date().toISOString(),
    k,
    queryCount: queries.length,
    corpusSize: corpus.length,
    precisionAt5: avg('precisionAt5'),
    recallAt5: avg('recallAt5'),
    mrr: avg('mrr'),
    perQuery,
    note: 'Measured on the synthetic demo corpus with manually judged relevance — not a production benchmark.',
  };
}
