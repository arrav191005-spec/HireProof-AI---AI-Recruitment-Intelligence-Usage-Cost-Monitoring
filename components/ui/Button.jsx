import Link from '@/components/ui/NoPrefetchLink';

const variants = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-[0_1px_2px_rgba(15,33,55,0.2)]',
  secondary:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100',
  ghost: 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900',
  'ghost-dark': 'text-navy-100 hover:bg-navy-700/60 hover:text-white',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
  'danger-outline':
    'bg-white text-red-700 border border-red-300 hover:bg-red-50 hover:border-red-400',
  success: 'bg-teal-accent text-white hover:bg-teal-700',
};

const sizes = {
  xs: 'h-7 px-2.5 text-xs gap-1',
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9.5 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2',
};

export default function Button({
  as,
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}) {
  const classes = [
    'inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap',
    'transition-colors disabled:opacity-50 disabled:pointer-events-none',
    variants[variant] ?? variants.primary,
    sizes[size] ?? sizes.md,
    className,
  ].join(' ');

  if (href) {
    const Comp = as ?? Link;
    return (
      <Comp href={href} className={classes} {...props}>
        {children}
      </Comp>
    );
  }
  const Comp = as ?? 'button';
  return (
    <Comp className={classes} {...props}>
      {children}
    </Comp>
  );
}
