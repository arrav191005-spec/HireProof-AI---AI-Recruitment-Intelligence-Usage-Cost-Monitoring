'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud, FileText, X, CheckCircle2, Wand2, Info } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { EvidenceBadge } from '@/components/ui/Badge';
import { InlineAlert, Spinner } from '@/components/ui/Feedback';

const fmtBytes = (n) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;

// Same rule the server applies at commit time: a located page makes the record
// "supporting", an unlocatable mention stays "claimed".
const previewStatus = (ev) =>
  ev.status && ev.status !== 'claimed' ? ev.status : ev.page != null ? 'supporting' : 'claimed';

const MODE_NOTES = {
  'python-service': 'Python document service (pypdf) · demo heuristics',
  'python-service-llm': 'Python document service · LLM extraction',
  llm: 'LLM extraction with substring grounding',
  'node-unpdf': 'Node PDF parser (unpdf) — Python service not reachable',
  'demo-heuristic': 'Demo heuristic extraction (no LLM configured)',
};

export default function ResumeUpload({ maxSizeMb = 5 }) {
  const router = useRouter();
  const inputRef = useRef(null);

  const [stage, setStage] = useState('idle'); // idle | uploading | review
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const [upload, setUpload] = useState(null);
  const [form, setForm] = useState({});
  const [formErrors, setFormErrors] = useState({});
  const [removedSkills, setRemovedSkills] = useState([]);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const reset = () => {
    setStage('idle');
    setUpload(null);
    setForm({});
    setFormErrors({});
    setRemovedSkills([]);
    setError(null);
    setSaveError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const startUpload = async (chosen) => {
    setError(null);
    if (!chosen) return;
    if (chosen.type !== 'application/pdf' && !chosen.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF resumes are accepted. Choose a .pdf file.');
      return;
    }
    if (chosen.size > maxSizeMb * 1024 * 1024) {
      setError(`That file is ${fmtBytes(chosen.size)} — the limit is ${maxSizeMb} MB.`);
      return;
    }
    if (chosen.size === 0) {
      setError('That file is empty.');
      return;
    }

    setStage('uploading');
    setUpload(null);
    try {
      const body = new FormData();
      body.append('file', chosen);
      const res = await fetch('/api/resumes', { method: 'POST', body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `Upload failed (${res.status})`);
      const data = json.data ?? json;
      setUpload(data);
      const ex = data.extraction ?? {};
      setForm({
        fullName: ex.name ?? '',
        headline: ex.headline ?? '',
        email: ex.email ?? '',
        location: ex.location ?? '',
        currentCompany: ex.experience?.[0]?.company ?? '',
        yearsExperience: ex.yearsExperience ?? '',
        summary: ex.summary ?? '',
      });
      setRemovedSkills([]);
      setStage('review');
    } catch (err) {
      setError(err.message);
      setStage('idle');
    }
  };

  const save = async (e) => {
    e.preventDefault();
    const errs = {};
    if ((form.fullName ?? '').trim().length < 2) errs.fullName = 'Full name is required before saving.';
    if ((form.email ?? '').trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errs.email = 'Enter a valid email address or leave it empty.';
    }
    setFormErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId: upload.uploadId,
          fullName: form.fullName.trim(),
          headline: (form.headline ?? '').trim() || undefined,
          email: (form.email ?? '').trim() || null,
          location: (form.location ?? '').trim() || null,
          currentCompany: (form.currentCompany ?? '').trim() || null,
          yearsExperience: form.yearsExperience === '' || form.yearsExperience == null ? null : Number(form.yearsExperience),
          summary: (form.summary ?? '').trim(),
          dropSkills: removedSkills,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `Could not save the candidate (${res.status})`);
      const candidate = json.data ?? json;
      router.push(`/candidates/${candidate.id}`);
      router.refresh();
    } catch (err) {
      setSaveError(err.message);
      setSaving(false);
    }
  };

  const extraction = upload?.extraction ?? null;
  const skills = extraction?.skills ?? [];
  const evidence = extraction?.evidence ?? [];
  const keptSkills = skills.filter((s) => !removedSkills.includes(s.skill));
  const parseNote = upload ? (MODE_NOTES[upload.modes?.parse] ?? upload.modes?.parse) : null;
  const extractNote = extraction ? (MODE_NOTES[extraction.via] ?? extraction.via) : null;

  // -------------------------------------------------------------------------
  // Step 1 — choose the file
  // -------------------------------------------------------------------------
  if (stage === 'idle' || stage === 'uploading') {
    const busy = stage === 'uploading';
    return (
      <div className="max-w-2xl">
        <Card className="p-6">
          <label
            htmlFor="resume-file"
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!busy) startUpload(e.dataTransfer.files?.[0]);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
              dragging
                ? 'border-brand-400 bg-brand-50/70'
                : 'border-slate-300 bg-slate-50/60 hover:border-brand-300 hover:bg-brand-50/40'
            } ${busy ? 'pointer-events-none opacity-70' : ''}`}
          >
            <input
              ref={inputRef}
              id="resume-file"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              disabled={busy}
              onChange={(e) => startUpload(e.target.files?.[0])}
            />
            {busy ? (
              <>
                <Spinner size={26} className="text-brand-600" />
                <p className="mt-4 text-[15px] font-semibold text-slate-800">Parsing resume…</p>
                <p className="mt-1 text-[13px] text-slate-500">
                  Extracting text page by page and locating evidence excerpts. This usually takes a few seconds.
                </p>
              </>
            ) : (
              <>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
                  <UploadCloud size={24} aria-hidden="true" />
                </span>
                <p className="mt-4 text-[15px] font-semibold text-slate-800">
                  Drop a PDF here, or <span className="text-brand-700 underline underline-offset-2">browse</span>
                </p>
                <p className="mt-1 text-[13px] text-slate-500">
                  PDF only · up to {maxSizeMb} MB · the file never leaves the server
                </p>
              </>
            )}
          </label>

          {error && (
            <div className="mt-4">
              <InlineAlert tone="error" title="Upload rejected">
                {error}
              </InlineAlert>
            </div>
          )}
        </Card>

        <ol className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            ['1. Parse', 'Text extracted per page (PDF is untrusted content).'],
            ['2. Review', 'You edit and confirm every extracted field.'],
            ['3. Save', 'Candidate, skills and evidence created together.'],
          ].map(([t, d]) => (
            <li key={t} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[13px] font-semibold text-slate-800">{t}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{d}</p>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Step 2 — review the extraction
  // -------------------------------------------------------------------------
  return (
    <form onSubmit={save} className="space-y-4" noValidate>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badgeish icon={FileText} label={upload.filename} />
          <Badgeish icon={Wand2} label={`${upload.pageCount} page${upload.pageCount === 1 ? '' : 's'} · ${fmtBytes(upload.fileSize)}`} />
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={saving}>
          <X size={14} /> Different file
        </Button>
      </div>

      <InlineAlert tone="warning" title="Review before saving — nothing is saved yet">
        Extraction ran as <strong>{extractNote}</strong>. Check the name, headline and skills below: anything
        you remove here is excluded from the profile and its evidence.
        {upload.truncated && ' The document was long and text extraction was truncated at 400k characters.'}
      </InlineAlert>

      {saveError && (
        <InlineAlert tone="error" title="Could not save">
          {saveError}
        </InlineAlert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* --- Identity fields --- */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Profile details"
            subtitle="Pre-filled from the document — edit anything before saving"
            actions={
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">
                <CheckCircle2 size={13} aria-hidden="true" /> Parser: {parseNote ?? '—'}
              </span>
            }
          />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="u-name" hint="required" error={formErrors.fullName}>
                <Input id="u-name" data-autofocus value={form.fullName ?? ''} onChange={set('fullName')} />
              </Field>
              <Field label="Headline" htmlFor="u-headline" hint={form.headline ? undefined : 'not found — add one'}>
                <Input
                  id="u-headline"
                  value={form.headline ?? ''}
                  onChange={set('headline')}
                  placeholder="e.g. Full-Stack Developer"
                />
              </Field>
              <Field label="Email" htmlFor="u-email" error={formErrors.email}>
                <Input id="u-email" type="email" value={form.email ?? ''} onChange={set('email')} />
              </Field>
              <Field label="Location" htmlFor="u-location">
                <Input id="u-location" value={form.location ?? ''} onChange={set('location')} />
              </Field>
              <Field label="Current company" htmlFor="u-company">
                <Input id="u-company" value={form.currentCompany ?? ''} onChange={set('currentCompany')} />
              </Field>
              <Field label="Years of experience" htmlFor="u-years">
                <Input
                  id="u-years"
                  type="number"
                  min="0"
                  max="60"
                  value={form.yearsExperience ?? ''}
                  onChange={set('yearsExperience')}
                />
              </Field>
            </div>
            <Field label="Summary" htmlFor="u-summary" hint="as written in the resume">
              <Textarea id="u-summary" rows={4} value={form.summary ?? ''} onChange={set('summary')} />
            </Field>
          </CardBody>
        </Card>

        {/* --- Skills + evidence --- */}
        <div className="space-y-4">
          <Card>
            <CardHeader
              title={`Skills (${keptSkills.length}/${skills.length})`}
              subtitle="Click a skill to exclude it"
            />
            <CardBody>
              {skills.length === 0 ? (
                <p className="text-[13px] text-slate-500">
                  No skills could be located in the document. You can add evidence manually from the profile
                  after saving.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((s) => {
                    const removed = removedSkills.includes(s.skill);
                    return (
                      <button
                        key={s.skill}
                        type="button"
                        onClick={() =>
                          setRemovedSkills((list) =>
                            removed ? list.filter((x) => x !== s.skill) : [...list, s.skill]
                          )
                        }
                        title={removed ? 'Include this skill' : 'Exclude this skill from the profile'}
                        className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                          removed
                            ? 'bg-slate-100 text-slate-400 line-through ring-slate-200'
                            : 'bg-brand-50 text-brand-700 ring-brand-200 hover:bg-brand-100'
                        }`}
                      >
                        {s.skill}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Evidence (${evidence.length})`} subtitle="Excerpt + page it was found on" />
            <CardBody className="space-y-3">
              {evidence.length === 0 && (
                <p className="text-[13px] text-slate-500">No grounded excerpts were found.</p>
              )}
              {evidence.map((ev, i) => {
                const status = previewStatus(ev);
                const removed = removedSkills.includes(ev.skill);
                return (
                  <div
                    key={`${ev.skill}-${i}`}
                    className={`rounded-lg border border-slate-200 p-3 ${removed ? 'opacity-50' : ''}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-slate-800">{ev.skill}</span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-400">
                          saved as {status.replace('_', ' ')}
                        </span>
                        <EvidenceBadge status={status} />
                      </span>
                    </div>
                    <p className="mt-1.5 rounded-md bg-slate-50 px-2.5 py-2 text-xs leading-relaxed text-slate-600">
                      “{ev.excerpt.length > 220 ? `${ev.excerpt.slice(0, 220)}…` : ev.excerpt}”
                    </p>
                    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                      <FileText size={11} aria-hidden="true" />
                      {ev.page != null ? `Page ${ev.page}` : 'Page not locatable'}
                      {ev.section ? ` · ${ev.section}` : ''}
                    </p>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <p className="inline-flex items-start gap-1.5 text-xs text-slate-500">
          <Info size={13} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
          Saving creates the profile with the resume attached and writes an audit entry. Nothing is ranked or
          auto-rejected at any point.
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="md" onClick={reset} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="md" disabled={saving}>
            {saving ? <Spinner size={15} /> : <CheckCircle2 size={15} />} Create candidate
          </Button>
        </div>
      </div>
    </form>
  );
}

function Badgeish({ icon: Icon, label }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600">
      <Icon size={13} className="shrink-0 text-slate-400" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}
