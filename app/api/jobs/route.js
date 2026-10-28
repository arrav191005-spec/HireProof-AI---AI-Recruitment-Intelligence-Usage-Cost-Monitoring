import getRepo from '@/lib/repo';
import { ok, fail, requireUser, validate, handleRouteError } from '@/lib/api';
import { jobCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    await requireUser();
    const repo = await getRepo();
    const { searchParams } = new URL(request.url);
    const result = await repo.listJobs({
      status: searchParams.get('status') ?? 'all',
      q: searchParams.get('q') ?? '',
      page: Number(searchParams.get('page') ?? 1),
      pageSize: Math.min(50, Number(searchParams.get('pageSize') ?? 20)),
    });
    return ok(result);
  } catch (err) {
    return handleRouteError(err, 'GET /api/jobs');
  }
}

export async function POST(request) {
  try {
    await requireUser();
    const body = await request.json().catch(() => null);
    const { ok: valid, data, error } = await validate(jobCreateSchema, body);
    if (!valid) return error;
    const repo = await getRepo();
    const job = await repo.createJob(data);
    await repo.logAudit({ action: 'job.create', entityType: 'job', entityId: job.id, metadata: { title: job.title } });
    return ok(job, { created: true });
  } catch (err) {
    return handleRouteError(err, 'POST /api/jobs');
  }
}
