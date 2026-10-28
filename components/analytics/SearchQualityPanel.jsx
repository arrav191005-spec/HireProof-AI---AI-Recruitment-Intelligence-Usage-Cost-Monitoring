'use client';

import { useEffect, useState } from 'react';
import { Play, RefreshCw, FlaskConical, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { InlineAlert, Spinner, EmptyState, Skeleton } from '@/components/ui/Feedback';

const pct = (v) => (v == null ? '—' : v.toFixed(2));

function Metric({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
      <p className="text-[13px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900">{pct(value)}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{hint}</p>
    </div>
  );
}

/**
 * Runs the judged search-query evaluation (tests/search-eval.json) against the
 * live search engine and reports P@5 / R@5 / MRR per query. The numbers only
 * exist after an actual run — nothing is pre-filled or faked.
 */
export default function SearchQualityPanel() {
  const [info, setInfo] = useState(null);
  const [run, setRun] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/analytics/search-quality');
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error?.message ?? `Could not load evaluation state (${res.status})`);
        if (!cancelled) {
          setInfo(body);
          setRun(body.lastRun ?? null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const evaluate = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/analytics/search-quality', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message ?? `Evaluation failed (${res.status})`);
      setRun(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Search quality evaluation"
        subtitle="Precision@5, Recall@5 and MRR over the judged query set, measured on the live search engine"
        actions={
          <Button size="sm" onClick={evaluate} disabled={running}>
            {running ? <Spinner size={13} /> : run ? <RefreshCw size={13} /> : <Play size={13} />}
            {running ? 'Evaluating…' : run ? 'Run again' : 'Run evaluation'}
          </Button>
        }
      />
      <CardBody className="space-y-4">
        {error && <InlineAlert tone="error" title="Evaluation failed">{error}</InlineAlert>}

        {loading && !info && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}

        {info && (
          <p className="text-[13px] text-slate-600">
            Dataset: <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">{info.datasetInfo?.location}</code>{' '}
            — {info.datasetInfo?.note}{' '}
            <span className="text-slate-500">
              Retrieval mode:{' '}
              <strong>{info.semanticEnabled ? 'hybrid (semantic + keyword)' : 'keyword + requirement evidence'}</strong>
              .
            </span>
          </p>
        )}

        {!loading && !error && !run && (
          <EmptyState
            icon={FlaskConical}
            title="No evaluation has been run yet"
            description="Run the judged query set against the current search engine to compute real precision, recall and MRR numbers. Metrics are never pre-filled."
          />
        )}

        {run && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric
                label="Precision@5"
                value={run.precisionAt5}
                hint="How many of the top 5 are judged relevant"
              />
              <Metric label="Recall@5" value={run.recallAt5} hint="Share of all relevant candidates found in the top 5" />
              <Metric label="MRR" value={run.mrr} hint="1 ÷ rank of the first relevant result" />
            </div>

            <div className="table-scroll rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th scope="col" className="px-4 py-2.5 font-medium">Query</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">P@5</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">R@5</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">MRR</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Missed relevant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {run.perQuery.map((q) => {
                    const perfect = q.missedRelevant.length === 0;
                    return (
                      <tr key={q.id}>
                        <td className="max-w-md px-4 py-2.5">
                          <p className="truncate text-[13px] text-slate-700" title={q.query}>
                            {q.query}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-800">{pct(q.precisionAt5)}</td>
                        <td className="px-3 py-2.5 font-medium text-slate-800">{pct(q.recallAt5)}</td>
                        <td className="px-3 py-2.5 font-medium text-slate-800">{pct(q.mrr)}</td>
                        <td className="px-3 py-2.5 text-xs">
                          {perfect ? (
                            <span className="inline-flex items-center gap-1 text-teal-700">
                              <CheckCircle2 size={13} aria-hidden="true" /> none
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <AlertTriangle size={13} aria-hidden="true" />
                              {q.missedRelevant.join(', ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span>
                Ran {new Date(run.ranAt).toLocaleString('en-GB')} · {run.queryCount} queries · corpus {run.corpusSize}{' '}
                candidates
              </span>
            </div>

            <InlineAlert tone="info" title="What these numbers mean">
              {run.note} They measure retrieval logic on a small judged set — not hiring outcomes, and not a
              claim about production search quality.
            </InlineAlert>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
