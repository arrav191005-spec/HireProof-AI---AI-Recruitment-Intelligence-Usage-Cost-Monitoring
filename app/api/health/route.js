import { NextResponse } from 'next/server';
import getRepo, { getBackendInfo } from '@/lib/repo';
import { aiMode } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const backend = await getBackendInfo();
    return NextResponse.json({
      status: 'ok',
      service: 'hireproof-ai',
      time: new Date().toISOString(),
      dataBackend: backend.backend,
      aiMode: aiMode(),
    });
  } catch (err) {
    return NextResponse.json({ status: 'degraded', error: err?.message ?? 'unknown' }, { status: 500 });
  }
}
