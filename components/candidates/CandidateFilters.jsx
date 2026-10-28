'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { Input, Select } from '@/components/ui/Field';
import Button from '@/components/ui/Button';

// Filter bar for the candidate list: pushes state into the URL so filters are
// shareable and the server component stays the source of truth.
export default function CandidateFilters({ initial = {}, allSkills = [] }) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q ?? '');
  const [skill, setSkill] = useState(initial.skill ?? '');
  const [minYears, setMinYears] = useState(initial.minYears ?? '');
  const [maxYears, setMaxYears] = useState(initial.maxYears ?? '');
  const [sort, setSort] = useState(initial.sort ?? 'recent');

  const submit = (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (skill) params.set('skill', skill);
    if (minYears !== '') params.set('minYears', minYears);
    if (maxYears !== '') params.set('maxYears', maxYears);
    if (sort !== 'recent') params.set('sort', sort);
    if (initial.evidenceStatus) params.set('evidenceStatus', initial.evidenceStatus);
    router.push(`/candidates${params.toString() ? `?${params}` : ''}`);
  };

  const clear = () => router.push('/candidates');

  return (
    <form onSubmit={submit} role="search" aria-label="Search candidates" className="flex flex-wrap items-end gap-3">
      <div className="relative min-w-[220px] flex-1">
        <label htmlFor="c-q" className="sr-only">Search candidates</label>
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <Input
          id="c-q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, headline, company or skill…"
          className="pl-9"
        />
      </div>
      <div>
        <label htmlFor="c-skill" className="sr-only">Skill</label>
        <Select id="c-skill" value={skill} onChange={(e) => setSkill(e.target.value)} className="w-40">
          <option value="">Any skill</option>
          {allSkills.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-1.5">
        <label htmlFor="c-min" className="sr-only">Min years</label>
        <Input id="c-min" type="number" min="0" max="50" placeholder="Min yrs" value={minYears} onChange={(e) => setMinYears(e.target.value)} className="w-24" />
        <span aria-hidden="true" className="text-slate-400">–</span>
        <label htmlFor="c-max" className="sr-only">Max years</label>
        <Input id="c-max" type="number" min="0" max="50" placeholder="Max yrs" value={maxYears} onChange={(e) => setMaxYears(e.target.value)} className="w-24" />
      </div>
      <div>
        <label htmlFor="c-sort" className="sr-only">Sort</label>
        <Select id="c-sort" value={sort} onChange={(e) => setSort(e.target.value)} className="w-44">
          <option value="recent">Recently added</option>
          <option value="experience">Most experienced</option>
          <option value="name">Name (A–Z)</option>
        </Select>
      </div>
      <Button type="submit" size="md">Apply</Button>
      <Button type="button" variant="ghost" size="md" onClick={clear}>Clear</Button>
    </form>
  );
}
