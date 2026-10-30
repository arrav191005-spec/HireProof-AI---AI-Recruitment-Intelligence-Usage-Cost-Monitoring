'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from '@/components/ui/NoPrefetchLink';
import { useRouter } from 'next/navigation';
import {
  Search, Sparkles, SlidersHorizontal, Users, MapPin, Briefcase, History,
  ChevronDown, ChevronUp, FileText, FlaskConical, AlertTriangle, Info,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { EvidenceBadge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, InlineAlert, Pagination, Skeleton, Spinner } from '@/components/ui/Feedback';
import { evidenceExplanations } from '@/components/evidence/EvidenceCard';

const EXAMPLE_QUERIES = [
  'Find junior developers who have built React applications, developed Node.js APIs, and worked with a SQL database. TypeScript is preferred but not required.',
  'senior React TypeScript engineer with Next.js experience',
  'backend engineer with Node.js and PostgreSQL performance experience',
  'python data engineer with Airflow and SQL pipelines',
];

const EMPTY_FILTERS = {
  skill: '',
  minYears: '',
  maxYears: '',
  assessmentStatus: 'any',
  evidenceStatus: '',
  sort: 'relevance',
  onlyApplicants: false,
};

function initials(name) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

// --- Score explanation -------------------------------------------------------
function ScoreBreakdown({ score, components }) {
  const [open, setOpen] = useState(false);
  const req = components.requirementEvidence;
  const reqPct = req.max ? Math.round((req.score / req.max) * 100) : null;
  const rows = [
    {
      label: 'Requirement evidence',
      weight: '≈54%',
      value: req.max != null ? `${reqPct ?? 0}% of ${req.max.toFixed(1)} available` : 'n/a (free-text query)',
      pct: reqPct,
      tone: 'bg-brand-500',
    },
    {
      label: 'Keyword overlap',
      weight: '≈27%',
      value: components.keyword.hits.length
        ? `matched: ${components.keyword.hits.slice(0, 6).join(', ')}`
        : 'no keyword hits',
      pct: Math.round(components.keyword.score * 100),
      tone: 'bg-teal-500',
    },
    {
      label: 'Seniority alignment',
      weight: '≈19%',
      value: components.seniority.detail ?? 'not requested',
      pct: Math.round(components.seniority.score * 100),
      tone: 'bg-navy-600',
    },
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-[13px] text-slate-600">
          <span className="font-semibold text-slate-800">Match score {score.toFixed(2)}</span>{' '}
          — retrieval ranking, not a hiring probability
        </span>
        {open ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
      </button>
      {open && (
        <div className="mt-3 space-y-2.5">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-700">{r.label}</span>
                <span className="text-slate-500">{r.value}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${r.tone}`}
                    style={{ width: `${Math.max(0, Math.min(100, r.pct ?? 0))}%` }}
                  />
                </div>
                <span className="w-20 text-right text-[11px] text-slate-400">{r.weight}</span>
              </div>
            </div>
          ))}
          <p className="text-[11px] leading-relaxed text-slate-500">
            Weights are fixed and documented in <code className="rounded bg-slate-200 px-1">lib/search/engine.js</code>.
            Missing evidence never subtracts points — it is reported as “Not established” below.
          </p>
        </div>
      )}
    </div>
  );
}

// --- Requirement status lines ------------------------------------------------
function RequirementLines({ matched, unestablished, candidateId }) {
  if (matched.length === 0 && unestablished.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Job requirements</p>
      <ul className="mt-2 space-y-2">
        {matched.map((m) => (
          <li key={`${m.category}-${m.skill}`} className="text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <EvidenceBadge status={m.status} />
              <span className="font-medium text-slate-800">{m.skill}</span>
              <span className="text-xs text-slate-400">{m.category}</span>
            </div>
            {/* Grounding: show the actual source excerpt for evidence-backed statuses */}
            {m.source?.length > 0 && m.source[0].excerpt ? (
              <div className="mt-1 flex items-start gap-1.5 text-xs text-slate-600">
                <FileText size={12} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
                <span>
                  “{m.source[0].excerpt.length > 180 ? `${m.source[0].excerpt.slice(0, 180)}…` : m.source[0].excerpt}”{' '}
                  <Link
                    href={`/candidates/${candidateId}#evidence-${m.source[0].evidenceId}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    View source
                  </Link>
                </span>
              </div>
            ) : (
              m.source?.[0]?.detail && (
                <p className="mt-1 text-xs text-slate-600">{m.source[0].detail}</p>
              )
            )}
          </li>
        ))}
        {unestablished.map((u) => (
          <li key={`${u.category}-${u.skill}`} className="flex flex-wrap items-center gap-2 text-[13px]">
            <EvidenceBadge status="not_established" />
            <span className="font-medium text-slate-700">{u.skill}</span>
            <span className="text-xs text-slate-400">{u.category} — records do not establish this (not a negative signal)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- One search result -------------------------------------------------------
function ResultCard({ result, jobRequirements }) {
  const { candidate, skills, score, scoreComponents: c, experience = [], projects = [] } = result;
  const matchedSkills = skills.slice(0, 7);
  const extra = skills.length - matchedSkills.length;

  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-semibold text-white">
          {initials(candidate.fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={`/candidates/${candidate.id}`}
                className="text-[15px] font-semibold text-slate-900 hover:text-brand-700 hover:underline underline-offset-2"
              >
                {candidate.fullName}
              </Link>
              <p className="text-[13px] text-slate-600">{candidate.headline}</p>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden="true" /> {candidate.location}</span>
            <span>{candidate.yearsExperience} yr experience</span>
            {candidate.currentCompany && <span>{candidate.currentCompany}</span>}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {matchedSkills.map((s) => (
              <span
                key={`${s.candidateId}-${s.skill}`}
                className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200"
              >
                {s.skill}
                {s.years != null && <span className="ml-1 font-normal text-brand-500">{s.years}y</span>}
              </span>
            ))}
            {extra > 0 && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">+{extra}</span>}
          </div>

          <p className="mt-3 text-[13px] leading-relaxed text-slate-600">{candidate.summary}</p>

          {(experience.length > 0 || projects.length > 0) && (
            <div className="mt-2 space-y-1">
              {experience.map((e, i) => (
                <p key={`x-${i}`} className="text-xs text-slate-500">
                  <span className="font-medium text-slate-600">{e.title}</span> at {e.company}
                  {e.summary ? ` — ${e.summary.slice(0, 110)}${e.summary.length > 110 ? '…' : ''}` : ''}
                </p>
              ))}
              {projects.slice(0, 1).map((p) => (
                <p key="p-0" className="text-xs text-slate-500">
                  <span className="font-medium text-slate-600">Project: {p.name}</span>
                  {p.summary ? ` — ${p.summary.slice(0, 110)}${p.summary.length > 110 ? '…' : ''}` : ''}
                </p>
              ))}
            </div>
          )}

          <div className="mt-3 space-y-3">
            <RequirementLines
              matched={c.requirementEvidence.matched ?? []}
              unestablished={c.requirementEvidence.unestablished ?? []}
              candidateId={candidate.id}
            />
            <ScoreBreakdown score={score} components={c} />
            {c.keyword.hits?.length > 0 && (
              <p className="text-xs text-slate-500">
                Also matched text: {c.keyword.hits.slice(0, 8).join(', ')}
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// --- Filters -----------------------------------------------------------------
function FiltersPanel({ filters, setFilters, allSkills, onApply, jobs, jobId, setJobId }) {
  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const dirty = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);
  return (
    <Card className="p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Skill" htmlFor="f-skill">
          <Select id="f-skill" value={filters.skill} onChange={set('skill')}>
            <option value="">Any skill</option>
            {allSkills.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Job association" htmlFor="f-job">
          <Select id="f-job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">No job (free-text search)</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </Select>
        </Field>
        <Field label="Min years" htmlFor="f-min">
          <Input id="f-min" type="number" min="0" max="50" value={filters.minYears} onChange={set('minYears')} placeholder="0" />
        </Field>
        <Field label="Max years" htmlFor="f-max">
          <Input id="f-max" type="number" min="0" max="50" value={filters.maxYears} onChange={set('maxYears')} placeholder="20" />
        </Field>
        <Field label="Assessment status" htmlFor="f-assess">
          <Select id="f-assess" value={filters.assessmentStatus} onChange={set('assessmentStatus')}>
            <option value="any">Any</option>
            <option value="completed">Has completed assessment</option>
            <option value="none">No assessments yet</option>
          </Select>
        </Field>
        <Field label="Evidence status" htmlFor="f-evidence">
          <Select id="f-evidence" value={filters.evidenceStatus} onChange={set('evidenceStatus')}>
            <option value="">Any</option>
            <option value="supporting">Has supporting evidence</option>
            <option value="assessment">Has assessment evidence</option>
            <option value="claimed">Has claimed evidence</option>
            <option value="needs_review">Has evidence needing review</option>
          </Select>
        </Field>
        <Field label="Sort" htmlFor="f-sort">
          <Select id="f-sort" value={filters.sort} onChange={set('sort')}>
            <option value="relevance">Relevance</option>
            <option value="experience">Most experienced</option>
            <option value="name">Name (A–Z)</option>
          </Select>
        </Field>
        <div className="flex items-end gap-2">
          <Button size="md" onClick={onApply}>Apply filters</Button>
          {dirty && (
            <Button size="md" variant="ghost" onClick={() => setFilters({ ...EMPTY_FILTERS })}>
              Reset
            </Button>
          )}
        </div>
      </div>
      {jobId && (
        <label className="mt-3 flex items-center gap-2 text-[13px] text-slate-600">
          <input
            type="checkbox"
            checked={filters.onlyApplicants}
            onChange={(e) => setFilters((f) => ({ ...f, onlyApplicants: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Only show candidates already in this job’s pipeline
        </label>
      )}
    </Card>
  );
}

// --- Main client -------------------------------------------------------------
export default function SearchClient({ initialQuery = '', initialJobId = '', jobs = [], allSkills = [] }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [jobId, setJobId] = useState(initialJobId);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(true);
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const started = useRef(false);

  const runSearch = useCallback(
    async ({ q = query, jid = jobId, f = filters, p = 1 } = {}) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, jobId: jid || null, filters: f, page: p, pageSize: 6 }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error?.message ?? `Search failed (${res.status})`);
        setData(body.data ?? body);
        setMeta(body.meta ?? null);
        setPage(p);
        // Keep the URL shareable without re-triggering a server round-trip
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (jid) params.set('jobId', jid);
        window.history.replaceState(null, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}`);
        // Refresh history (the route records non-empty queries server-side)
        fetch('/api/search')
          .then((r) => r.json())
          .then((b) => setHistory(b?.data?.history ?? b?.history ?? []))
          .catch(() => {});
      } catch (err) {
        setError(err.message);
        setData(null);
        setMeta(null);
      } finally {
        setLoading(false);
      }
    },
    [query, jobId, filters]
  );

  // Initial search from URL params (?q= / ?jobId=)
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch('/api/search')
      .then((r) => r.json())
      .then((b) => setHistory(b?.data?.history ?? b?.history ?? []))
      .catch(() => {});
    if (initialQuery || initialJobId) {
      runSearch({ q: initialQuery, jid: initialJobId, f: EMPTY_FILTERS, p: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (e) => {
    e.preventDefault();
    runSearch({ p: 1 });
  };

  const applyFilters = () => runSearch({ p: 1 });
  const onJobChange = (value) => {
    setJobId(value);
    runSearch({ jid: value, p: 1 });
  };

  const results = data?.results ?? [];
  const total = meta?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* ---- Query box ---- */}
      <Card className="p-5">
        <form onSubmit={onSubmit} role="search" aria-label="Natural language candidate search">
          <label htmlFor="nl-query" className="text-[13px] font-medium text-slate-700">
            Describe who you’re looking for
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                id="nl-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='e.g. "junior developers who built React apps with Node.js APIs and SQL"…'
                className="pl-9"
                autoComplete="off"
              />
            </div>
            <Button type="submit" size="lg" disabled={loading}>
              {loading ? <Spinner size={15} /> : <Sparkles size={15} />} Search
            </Button>
          </div>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Try:</span>
          {EXAMPLE_QUERIES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setQuery(ex);
                runSearch({ q: ex, p: 1 });
              }}
              className="max-w-full truncate rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
              title={ex}
            >
              {ex.length > 54 ? `${ex.slice(0, 54)}…` : ex}
            </button>
          ))}
        </div>

        {history.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setHistoryOpen((o) => !o)}
              aria-expanded={historyOpen}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              <History size={13} aria-hidden="true" /> Recent searches ({history.length})
              {historyOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {historyOpen && (
              <ul className="mt-2 space-y-1">
                {history.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery(h.query);
                        runSearch({ q: h.query, p: 1 });
                      }}
                      className="text-left text-xs text-slate-600 hover:text-brand-700 hover:underline"
                    >
                      “{h.query}” <span className="text-slate-400">— {h.resultCount} results</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      {/* ---- Filters ---- */}
      <div>
        <button
          type="button"
          onClick={() => setShowFilters((s) => !s)}
          aria-expanded={showFilters}
          className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-600 hover:text-slate-800"
        >
          <SlidersHorizontal size={14} aria-hidden="true" /> Filters
          {showFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showFilters && (
          <FiltersPanel
            filters={filters}
            setFilters={setFilters}
            allSkills={allSkills}
            onApply={applyFilters}
            jobs={jobs}
            jobId={jobId}
            setJobId={onJobChange}
          />
        )}
      </div>

      {/* ---- Mode honesty banner ---- */}
      {meta && (
        <InlineAlert tone={meta.semanticEnabled ? 'success' : 'info'} title={meta.semanticEnabled ? 'Hybrid search active' : 'Keyword + requirement-evidence search'}>
          {meta.semanticEnabled
            ? 'Embeddings are configured: semantic similarity is combined with keyword and requirement-evidence ranking.'
            : 'Semantic search is not configured in this environment — ranking uses exact skill matching, PostgreSQL-style keyword overlap and requirement-level evidence. No semantic results are being faked.'}
          {' '}Data backend: <strong>{meta.backend}</strong>.
        </InlineAlert>
      )}

      {/* ---- Results ---- */}
      {loading && !data && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-3 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-2/3" />
              <Skeleton className="mt-4 h-16 w-full" />
            </Card>
          ))}
        </div>
      )}

      {error && (
        <ErrorState
          title="Search failed"
          detail={error}
          onRetry={() => runSearch({ p: page })}
        />
      )}

      {!error && data && total === 0 && (
        <EmptyState
          icon={Users}
          title="No candidates matched this search"
          description="Nothing in the current records answers this query. Try removing a filter, broadening the wording — or upload a resume to expand the pool."
          action={
            <Button size="sm" variant="secondary" onClick={() => { setFilters({ ...EMPTY_FILTERS }); setQuery(''); }}>
              Clear search & filters
            </Button>
          }
        />
      )}

      {!error && !data && !loading && (
        <EmptyState
          icon={FlaskConical}
          title="Search the candidate pool"
          description="Ask in plain language. Every result explains which requirements have supporting evidence, which remain unestablished, and links to the source excerpts behind each claim."
        />
      )}

      {!error && data && total > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-sm text-slate-600">
              <strong>{total}</strong> candidate{total === 1 ? '' : 's'} matched
              {data.job && (
                <span className="text-slate-500">
                  {' '}— ranking against <strong>{data.job.title}</strong> requirements
                  ({data.job.requirements.filter((r) => r.category === 'required').length} required,{' '}
                  {data.job.requirements.filter((r) => r.category === 'preferred').length} preferred)
                </span>
              )}
            </p>
            <p className="text-xs text-slate-400">{meta?.mode}</p>
          </div>

          <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>
            {results.map((r) => (
              <ResultCard key={r.candidate.id} result={r} />
            ))}
          </div>

          <Pagination page={meta.page} pageCount={meta.pageCount} total={total} onPage={(p) => runSearch({ p })} />
        </>
      )}
    </div>
  );
}
