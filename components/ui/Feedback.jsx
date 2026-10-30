import Link from '@/components/ui/NoPrefetchLink';

export function Skeleton({ className = '' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-slate-200/70 ${className}`} />;
}

export function Spinner({ size = 16, className = '' }) {
  return (
    <svg
      className={`animate-spin text-current ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-14 text-center ${className}`}>
      {Icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <Icon size={22} />
        </div>
      )}
      <h3 className="text-[15px] font-semibold text-slate-800">{title}</h3>
      {description && <p className="mt-1 max-w-md text-[13px] text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', detail, onRetry }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
      <h3 className="text-sm font-semibold text-red-800">{title}</h3>
      {detail && <p className="mt-1 text-[13px] text-red-700">{detail}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 text-[13px] font-medium text-red-800 underline underline-offset-2 hover:no-underline"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function InlineAlert({ tone = 'info', title, children }) {
  const tones = {
    info: 'border-brand-200 bg-brand-50 text-brand-900',
    success: 'border-teal-200 bg-teal-50 text-teal-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-900',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-[13px] ${tones[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
    </div>
  );
}

export function Pagination({ page, pageCount, total, onPage }) {
  if (pageCount <= 1) {
    return total > 0 ? (
      <p className="px-1 py-3 text-[13px] text-slate-500">
        {total} result{total === 1 ? '' : 's'}
      </p>
    ) : null;
  }
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1
  );
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 py-3">
      <p className="text-[13px] text-slate-500">
        Page {page} of {pageCount} · {total} results
      </p>
      <div className="flex items-center gap-1">
        {pages.map((p, i) => (
          <span key={p} className="flex items-center">
            {i > 0 && p - pages[i - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
            <button
              onClick={() => onPage(p)}
              aria-current={p === page ? 'page' : undefined}
              className={`h-8 min-w-8 rounded-lg px-2 text-[13px] font-medium ${
                p === page
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p}
            </button>
          </span>
        ))}
      </div>
    </nav>
  );
}

export function Breadcrumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px]">
      {items.map((item, i) => (
        <span key={item.href ?? item.label} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-slate-300">/</span>}
          {item.href ? (
            <Link href={item.href} className="text-slate-500 hover:text-brand-700 hover:underline underline-offset-2">
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-slate-700">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
