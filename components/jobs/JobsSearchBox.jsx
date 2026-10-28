'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/Field';

export default function JobsSearchBox({ initialQ = '', status = 'all' }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQ);

  const submit = (e) => {
    e.preventDefault();
    const params = new URLSearchParams({ status });
    if (value.trim()) params.set('q', value.trim());
    router.push(`/jobs?${params.toString()}`);
  };

  return (
    <form onSubmit={submit} role="search" aria-label="Search jobs" className="relative sm:w-72">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search jobs…"
        aria-label="Search jobs"
        className="pl-9"
      />
    </form>
  );
}
