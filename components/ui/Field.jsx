export function Label({ htmlFor, className = '', children, hint }) {
  return (
    <label htmlFor={htmlFor} className={`block text-[13px] font-medium text-slate-700 ${className}`}>
      {children}
      {hint && <span className="ml-1 font-normal text-slate-400">{hint}</span>}
    </label>
  );
}

export function Input({ className = '', error, ...props }) {
  return (
    <input
      className={`field ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/25' : ''} ${className}`}
      aria-invalid={error ? 'true' : undefined}
      {...props}
    />
  );
}

export function Textarea({ className = '', rows = 4, error, ...props }) {
  return (
    <textarea
      rows={rows}
      className={`field ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/25' : ''} ${className}`}
      {...props}
    />
  );
}

export function Select({ className = '', error, children, ...props }) {
  return (
    <select
      className={`field ${error ? 'border-red-400' : ''} ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function FieldError({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1 flex items-center gap-1 text-xs text-red-600">
      {children}
    </p>
  );
}

export function Field({ label, htmlFor, hint, error, children, className = '' }) {
  return (
    <div className={className}>
      {label && (
        <Label htmlFor={htmlFor} hint={hint}>
          {label}
        </Label>
      )}
      <div className="mt-1.5">{children}</div>
      <FieldError>{error}</FieldError>
    </div>
  );
}
