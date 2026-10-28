export function Card({ className = '', children, ...props }) {
  return (
    <div
      className={`rounded-(--radius-card) border border-slate-200 bg-white shadow-(--shadow-card) ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 ${className}`}
    >
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className = '', children }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, className = '' }) {
  return (
    <h2 className={`text-base font-semibold text-slate-900 ${className}`}>{children}</h2>
  );
}
