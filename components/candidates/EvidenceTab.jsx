'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, AlertTriangle } from 'lucide-react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { Field, Input, Textarea, FieldError } from '@/components/ui/Field';
import { EmptyState, InlineAlert, Spinner } from '@/components/ui/Feedback';
import { EvidenceBadge } from '@/components/ui/Badge';
import EvidenceCard, { evidenceExplanations } from '@/components/evidence/EvidenceCard';
import { FileText } from 'lucide-react';

// Evidence tab: status overview, reviewable evidence records, manual additions.
export default function EvidenceTab({ candidateId, evidence, statusCounts }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ skill: '', excerpt: '', notes: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.skill.trim()) next.skill = 'Skill is required.';
    if (form.excerpt.trim().length < 3) next.excerpt = 'Paste the excerpt this is based on.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skill: form.skill.trim(),
          excerpt: form.excerpt.trim(),
          notes: form.notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Could not add evidence (${res.status})`);
      }
      setOpen(false);
      setForm({ skill: '', excerpt: '', notes: '' });
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const pending = statusCounts.needs_review + statusCounts.claimed;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {Object.entries(statusCounts).map(([status, count]) =>
            count > 0 ? (
              <span
                key={status}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm"
                title={evidenceExplanations[status]}
              >
                <EvidenceBadge status={status} />
                <span className="font-semibold text-slate-800">{count}</span>
              </span>
            ) : null
          )}
          {evidence.length === 0 && (
            <p className="text-sm text-slate-500">No evidence records yet.</p>
          )}
        </div>
        <Button onClick={() => setOpen(true)} variant="secondary" size="sm">
          <Plus size={14} /> Add evidence manually
        </Button>
      </div>

      {pending > 0 && (
        <InlineAlert tone="warning" title={`${pending} record${pending === 1 ? '' : 's'} need human judgment`}>
          Claims and ambiguous records stay marked until a recruiter reviews them. They never
          count as verified skill on their own.
        </InlineAlert>
      )}

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {evidence.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No evidence yet"
          description="Upload a resume to extract grounded evidence, or add a record manually with a source excerpt."
        />
      ) : (
        <div className="space-y-3">
          {evidence.map((ev) => (
            <EvidenceCard key={ev.id} evidence={ev} interactive />
          ))}
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add evidence manually"
        description="Record something you verified yourself. It will be attributed to you as the source."
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setOpen(false)} type="button">Cancel</Button>
            <Button size="md" form="add-evidence-form" type="submit" disabled={saving}>
              {saving ? <Spinner size={14} /> : null} Add evidence
            </Button>
          </>
        }
      >
        <form id="add-evidence-form" onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Skill or requirement" htmlFor="ev-skill" error={errors.skill} hint="required">
            <Input
              id="ev-skill"
              data-autofocus
              value={form.skill}
              onChange={(e) => setForm((f) => ({ ...f, skill: e.target.value }))}
              placeholder="e.g. React"
            />
          </Field>
          <Field label="Source excerpt" htmlFor="ev-excerpt" error={errors.excerpt} hint="required">
            <Textarea
              id="ev-excerpt"
              rows={4}
              value={form.excerpt}
              onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))}
              placeholder="Quote the exact text that supports this (from a call note, portfolio, reference…)"
            />
          </Field>
          <Field label="Reviewer note" htmlFor="ev-notes">
            <Input
              id="ev-notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Context: where this came from, what remains unclear…"
            />
          </Field>
          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
            Manual evidence is saved with source type “manual” and extractor “human” so it is always
            distinguishable from resume extraction.
          </p>
        </form>
      </Dialog>
    </div>
  );
}
