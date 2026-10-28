'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { Field, Input, Textarea, Select } from '@/components/ui/Field';
import { InlineAlert, Spinner } from '@/components/ui/Feedback';

const EMPTY = {
  title: '',
  skill: '',
  difficulty: 'medium',
  status: 'draft',
  timeLimitMinutes: 45,
  description: '',
  instructions: '',
};

// Create-assessment dialog (server-validated by POST /api/assessments).
export default function AssessmentForm({ triggerLabel = 'New assessment' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (form.title.trim().length < 2) next.title = 'Title is required.';
    if (!form.skill.trim()) next.skill = 'Skill is required.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          title: form.title.trim(),
          skill: form.skill.trim(),
          timeLimitMinutes: Number(form.timeLimitMinutes),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message ?? `Could not create assessment (${res.status})`);
      const created = body.data ?? body;
      setOpen(false);
      setForm({ ...EMPTY });
      router.push(`/assessments/${created.id}`);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={15} /> {triggerLabel}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create skill assessment"
        description="Define the task candidates will complete. Content is stored as-is — generated content must be reviewed before publishing."
        width="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" size="md" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="md" type="submit" form="assessment-form" disabled={saving}>
              {saving ? <Spinner size={14} /> : null} Create assessment
            </Button>
          </>
        }
      >
        <form id="assessment-form" onSubmit={submit} className="space-y-4" noValidate>
          {error && <InlineAlert tone="error">{error}</InlineAlert>}
          <Field label="Title" htmlFor="a-title" error={errors.title} hint="required">
            <Input id="a-title" data-autofocus value={form.title} onChange={set('title')} placeholder="e.g. JavaScript Data Processing Challenge" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Skill" htmlFor="a-skill" error={errors.skill} hint="required">
              <Input id="a-skill" value={form.skill} onChange={set('skill')} placeholder="e.g. JavaScript" />
            </Field>
            <Field label="Difficulty" htmlFor="a-difficulty">
              <Select id="a-difficulty" value={form.difficulty} onChange={set('difficulty')}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </Select>
            </Field>
            <Field label="Time limit (min)" htmlFor="a-time">
              <Input id="a-time" type="number" min="5" max="480" value={form.timeLimitMinutes} onChange={set('timeLimitMinutes')} />
            </Field>
          </div>
          <Field label="Description" htmlFor="a-desc">
            <Textarea id="a-desc" rows={3} value={form.description} onChange={set('description')} placeholder="What this assessment measures and how it is reviewed…" />
          </Field>
          <Field label="Task / instructions" htmlFor="a-instructions">
            <Textarea id="a-instructions" rows={5} value={form.instructions} onChange={set('instructions')} placeholder="Exact task statement candidates will see…" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status" htmlFor="a-status">
              <Select id="a-status" value={form.status} onChange={set('status')}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </Select>
            </Field>
          </div>
          <InlineAlert tone="warning" title="No code execution in this build">
            Submissions receive static checks and are queued for human review. Untrusted candidate
            code is never executed inside the application server.
          </InlineAlert>
        </form>
      </Dialog>
    </>
  );
}
