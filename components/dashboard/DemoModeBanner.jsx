import { Card, CardBody } from '@/components/ui/Card';
import { InlineAlert } from '@/components/ui/Feedback';

// Clearly labels the active data/AI backends. Shown where results depend on it.
export default function DemoModeBanner({ backend, aiMode, className = '' }) {
  if (!backend || backend.backend === 'postgres') {
    return aiMode === 'demo' ? (
      <div className={className}>
        <InlineAlert tone="info" title="Demo AI mode">
          No LLM/embedding provider is configured. Extraction, analysis and explanations use the
          clearly-labeled demo adapters; search runs in keyword + requirement-evidence mode. Configure
          <code className="mx-1 rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">OPENAI_API_KEY</code>
          to enable provider-backed features.
        </InlineAlert>
      </div>
    ) : null;
  }
  return (
    <div className={className}>
      <InlineAlert tone="warning" title="Running on the in-memory demo store">
        PostgreSQL is not reachable, so data comes from a seeded, synthetic in-memory store
        (persisted to <code className="mx-1 rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">.data/demo-store.json</code>).
        Set <code className="mx-1 rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">DATABASE_URL</code> and run
        <code className="mx-1 rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">npm run db:migrate && npm run db:seed</code>
        to use the real database. See Settings for details.
      </InlineAlert>
    </div>
  );
}
