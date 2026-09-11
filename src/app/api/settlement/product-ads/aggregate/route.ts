import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { aggregateToss } from '@/lib/settlement/tossAgg';

export const maxDuration = 60;

/** POST { platform: 'toss', months?: string[] } — raw → 월 집계 재저장. months 생략 시 raw 에 있는 모든 달 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (body.platform !== 'toss') return NextResponse.json({ error: '지원 플랫폼: toss (쿠팡은 입력 탭의 "이 PC 광고 raw → 월 집계 저장")' }, { status: 400 });
  const months = Array.isArray(body.months) ? body.months.filter((m: unknown) => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m)) : undefined;
  const admin = await createAdminClient();
  try {
    const result = await aggregateToss(admin, user.id, months);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
