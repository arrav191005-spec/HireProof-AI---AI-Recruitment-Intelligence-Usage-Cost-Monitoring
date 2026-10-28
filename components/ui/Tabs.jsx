'use client';

import { useId, useState } from 'react';

// Accessible tab switcher (WAI-ARIA tabs pattern). Tabs control visibility of
// panels rendered by the caller via the render prop.
export default function Tabs({ tabs, initial = 0, children, className = '' }) {
  const [active, setActive] = useState(initial);
  const baseId = useId();

  return (
    <div className={className}>
      <div role="tablist" aria-label="Section tabs" className="flex gap-1 overflow-x-auto border-b border-slate-200 scroll-thin">
        {tabs.map((tab, i) => {
          const selected = i === active;
          return (
            <button
              key={tab.id}
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') setActive((active + 1) % tabs.length);
                if (e.key === 'ArrowLeft') setActive((active - 1 + tabs.length) % tabs.length);
              }}
              className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                selected
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              {tab.label}
              {tab.count != null && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${
                    selected ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${tabs[active]?.id}`}
        aria-labelledby={`${baseId}-tab-${tabs[active]?.id}`}
        className="pt-5"
      >
        {children(tabs[active], active)}
      </div>
    </div>
  );
}
