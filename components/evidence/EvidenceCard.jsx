'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, ClipboardCheck, User, HelpCircle, MapPin, Check, AlertTriangle } from 'lucide-react';
import Badge, { EvidenceBadge, evidenceStatusMeta } from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { InlineAlert, Spinner } from '@/components/ui/Feedback';

// Plain-language explanation for each evidence status — shown consistently
// everywhere an evidence record appears.
export const evidenceExplanations = {
  claimed: 'Mentioned by the candidate or in their resume. Not independently verified.',
  supporting: 'Relevant details were located in a source document.',
  assessment: 'Result of a defined practical assessment.',
  not_established: 'Available records do not establish this. That is an absence of information, not evidence of absence.',
  needs_review: 'Ambiguous, conflicting, or requires human judgment.',
};

const sourceIcons = { resume: FileText, assessment: ClipboardCheck, manual: User };

function sourceLocationLabel(location) {
  if (!location) return null;
  const parts = [];
  if (location.page != null) parts.push(`Page ${location.page}`);
  if (location.section) parts.push(location.section);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * One evidence record: status, excerpt, provenance, review controls.
 * `interactive` enables the recruiter review workflow (status + note editing).
 */
export default function EvidenceCard({ evidence, interactive = false, defaultOpen = false }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [status, setStatus] = useState(evidence.status);
  const [notes, setNotes] = useState(evidence.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const SourceIcon = sourceIcons[evidence.sourceType] ?? FileText;
  const locationLabel = sourceLocationLabel(evidence.location);

  const save = async (patch) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/evidence/${evidence.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Review failed (${res.status})`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <article
      id={`evidence-${evidence.id}`}
      className="rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-(--shadow-card)"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{evidence.skill}</span>
            <EvidenceBadge status={status} />
          </div>
          <p className="mt-1 text-xs text-slate-500">{evidenceExplanations[status]}</p>
        </div>
        {interactive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? 'Hide review' : 'Review'}
          </Button>
        )}
      </div>

      <blockquote className="mt-3 rounded-lg border-l-2 border-brand-300 bg-slate-50/70 px-3 py-2 text-[13px] leading-relaxed text-slate-700">
        “{evidence.excerpt}”
      </blockquote>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <SourceIcon size={13} aria-hidden="true" /> {evidence.sourceName}
        </span>
        {locationLabel && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin size={13} aria-hidden="true" /> {locationLabel}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <Badge tone="gray">{evidence.extractor}</Badge>
        </span>
        {evidence.createdAt && <span>Added {new Date(evidence.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
      </div>

      {open && interactive && (
        <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          {error && <InlineAlert tone="error">Could not save the review. {error}</InlineAlert>}
          {saved && (
            <InlineAlert tone="success" title="Review saved">
              The decision was recorded in the audit log.
            </InlineAlert>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[13px] font-medium text-slate-700">
              Evidence status
              <Select
                className="mt-1.5"
                value={status}
                disabled={saving}
                onChange={(e) => {
                  setStatus(e.target.value);
                  save({ status: e.target.value, notes });
                }}
              >
                {Object.entries(evidenceStatusMeta).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block text-[13px] font-medium text-slate-700">
              Reviewer note
              <textarea
                className="field mt-1.5"
                rows={2}
                value={notes}
                disabled={saving}
                placeholder="Why this status? (optional)"
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Last reviewed: {evidence.reviewedAt ? new Date(evidence.reviewedAt).toLocaleString('en-GB') : 'never'}
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={saving || (status === evidence.status && notes === (evidence.notes ?? ''))}
              onClick={() => save({ status, notes })}
            >
              {saving ? <Spinner size={13} /> : <Check size={13} />} Save review
            </Button>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
            A recruiter decision — never auto-applied. Changing status does not move or reject the candidate.
          </p>
        </div>
      )}

      {!interactive && evidence.notes && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500">
          <HelpCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> {evidence.notes}
        </p>
      )}
    </article>
  );
}
