'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/layout/PageHeader';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { Field, Input, Textarea, Select, FieldError } from '@/components/ui/Field';
import { InlineAlert, ErrorState } from '@/components/ui/Feedback';
import { X, Plus, Info } from 'lucide-react';

const EMPTY_SKILL = { skill: '', minYears: '', note: '' };

function SkillsEditor({ label, hint, skills, onChange }) {
  const update = (i, patch) => {
    const next = skills.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange(next);
  };
  return (
    <div>
      <p className="text-[13px] font-medium text-slate-700">
        {label} <span className="font-normal text-slate-400">{hint}</span>
      </p>
      <ul className="mt-2 space-y-2">
        {skills.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
            <Input
              value={s.skill}
              onChange={(e) => update(i, { skill: e.target.value })}
              placeholder="Skill (e.g. React)"
              aria-label={`${label} skill name ${i + 1}`}
              className="min-w-[140px] flex-1"
            />
            <Input
              type="number"
              min="0"
              max="50"
              value={s.minYears}
              onChange={(e) => update(i, { minYears: e.target.value })}
              placeholder="Min yrs"
              aria-label={`${label} minimum years ${i + 1}`}
              className="w-24"
            />
            <Input
              value={s.note}
              onChange={(e) => update(i, { note: e.target.value })}
              placeholder="Note (optional)"
              aria-label={`${label} note ${i + 1}`}
              className="min-w-[140px] flex-1"
            />
            <Button variant="ghost" size="sm" onClick={() => onChange(skills.filter((_, idx) => idx !== i))} aria-label={`Remove skill ${s.skill || i + 1}`}>
              <X size={14} />
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" size="sm" className="mt-2" onClick={() => onChange([...skills, { ...EMPTY_SKILL }])}>
        <Plus size={14} /> Add {label.toLowerCase()}
      </Button>
    </div>
  );
}

export default function NewJobForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: '',
    department: 'Engineering',
    location: 'Remote',
    employmentType: 'Full-time',
    status: 'draft',
    experienceMin: '',
    experienceMax: '',
    description: '',
  });
  const [requiredSkills, setRequiredSkills] = useState([{ ...EMPTY_SKILL }]);
  const [preferredSkills, setPreferredSkills] = useState([]);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = () => {
    const next = {};
    if (form.title.trim().length < 2) next.title = 'Title is required (at least 2 characters).';
    if (form.description.trim().length > 8000) next.description = 'Description is too long.';
    const allSkills = [...requiredSkills, ...preferredSkills];
    if (allSkills.some((s) => s.skill.trim() === '')) next.skills = 'Every skill row needs a name (or remove the empty row).';
    const min = form.experienceMin === '' ? null : Number(form.experienceMin);
    const max = form.experienceMax === '' ? null : Number(form.experienceMax);
    if (min != null && max != null && min > max) next.experience = 'Minimum experience cannot exceed maximum.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;
    setSaving(true);
    try {
      const clean = (arr) =>
        arr
          .filter((s) => s.skill.trim())
          .map((s) => ({
            skill: s.skill.trim(),
            minYears: s.minYears === '' ? null : Number(s.minYears),
            note: s.note.trim() || null,
          }));
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          experienceMin: form.experienceMin === '' ? null : Number(form.experienceMin),
          experienceMax: form.experienceMax === '' ? null : Number(form.experienceMax),
          requiredSkills: clean(requiredSkills),
          preferredSkills: clean(preferredSkills),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      const created = await res.json();
      router.push(`/jobs/${created.id}`);
    } catch (err) {
      setSubmitError(err.message);
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Create job"
        description="Define the opening and its requirements. Requirement-level fields power evidence matching in candidate search."
        breadcrumbs={
          <nav aria-label="Breadcrumb" className="text-[13px] text-slate-500">
            <a href="/jobs" className="hover:text-brand-700 hover:underline">Jobs</a>
            <span className="mx-1.5 text-slate-300">/</span>
            <span className="font-medium text-slate-700">New</span>
          </nav>
        }
      />
      <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-6">
        {submitError && <ErrorState title="Could not create job" detail={submitError} />}

        <Card>
          <CardHeader title="Basics" />
          <CardBody className="space-y-4">
            <Field label="Job title" htmlFor="title" error={errors.title} hint="required">
              <Input id="title" value={form.title} onChange={set('title')} placeholder="e.g. Junior Full-Stack Developer" autoFocus />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Department" htmlFor="department">
                <Input id="department" value={form.department} onChange={set('department')} />
              </Field>
              <Field label="Location" htmlFor="location">
                <Input id="location" value={form.location} onChange={set('location')} />
              </Field>
              <Field label="Employment type" htmlFor="employmentType">
                <Select id="employmentType" value={form.employmentType} onChange={set('employmentType')}>
                  {['Full-time', 'Part-time', 'Contract', 'Internship'].map((t) => <option key={t}>{t}</option>)}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Experience min (years)" htmlFor="experienceMin" error={errors.experience}>
                <Input id="experienceMin" type="number" min="0" max="50" value={form.experienceMin} onChange={set('experienceMin')} placeholder="e.g. 0" />
              </Field>
              <Field label="Experience max (years)" htmlFor="experienceMax" error={errors.experience}>
                <Input id="experienceMax" type="number" min="0" max="50" value={form.experienceMax} onChange={set('experienceMax')} placeholder="e.g. 2" />
              </Field>
              <Field label="Status" htmlFor="status">
                <Select id="status" value={form.status} onChange={set('status')}>
                  <option value="draft">Draft</option>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </Select>
              </Field>
            </div>
            <Field label="Description" htmlFor="description" error={errors.description}>
              <Textarea id="description" rows={6} value={form.description} onChange={set('description')} placeholder="What the role involves, the team, and what success looks like…" />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Requirements" subtitle="Structured requirements enable per-requirement evidence matching." />
          <CardBody className="space-y-6">
            {errors.skills && <FieldError>{errors.skills}</FieldError>}
            <SkillsEditor label="Required skills" hint="candidates must show evidence of these" skills={requiredSkills} onChange={setRequiredSkills} />
            <SkillsEditor label="Preferred skills" hint="nice to have — weighted lower in matching" skills={preferredSkills} onChange={setPreferredSkills} />
            <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 px-4 py-3 text-[13px] text-slate-600">
              <Info size={15} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
              <p>
                Requirements are used to <strong>locate supporting evidence</strong> in candidate records — they never auto-reject anyone.
                Missing evidence is shown as “Not established”.
              </p>
            </div>
          </CardBody>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" as="a" href="/jobs" type="button">Cancel</Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create job'}
          </Button>
        </div>
      </form>
    </>
  );
}
