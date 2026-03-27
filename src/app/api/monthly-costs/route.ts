import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  // 이력 조회
  const ym = request.nextUrl.searchParams.get('history');
  if (ym === 'all') {
    const { data } = await admin
      .from('monthly_cost_snapshots')
      .select('year_month, cost_id, amount, cost:monthly_costs(label, parent_id, vat_applicable)')
      .order('year_month', { ascending: false });
    return NextResponse.json(data ?? []);
  }

  const { data, error } = await admin
    .from('monthly_costs')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

// 일괄 저장 (전체 항목)
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { items } = await request.json() as { items: any[] };
  const admin = await createAdminClient();

  for (const item of items) {
    if (item.id) {
      await admin.from('monthly_costs').update({
        label: item.label,
        amount: item.amount ?? 0,
        vat_applicable: item.vat_applicable ?? true,
      }).eq('id', item.id);
    }
  }

  return NextResponse.json({ ok: true });
}

// 개별 추가/수정
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const admin = await createAdminClient();

  // 스냅샷 저장
  if (body.action === 'snapshot') {
    const { year_month } = body;
    const { data: costs } = await admin.from('monthly_costs').select('id, amount');
    const rows = (costs ?? []).map((c: any) => ({
      year_month,
      cost_id: c.id,
      amount: c.amount ?? 0,
    }));
    if (rows.length) {
      await admin.from('monthly_cost_snapshots')
        .upsert(rows, { onConflict: 'year_month,cost_id' });
    }
    return NextResponse.json({ ok: true, saved: rows.length });
  }

  if (body.id) {
    const update: any = {};
    if (body.label !== undefined) update.label = body.label;
    if (body.amount !== undefined) update.amount = body.amount;
    if (body.vat_applicable !== undefined) update.vat_applicable = body.vat_applicable;
    await admin.from('monthly_costs').update(update).eq('id', body.id);
  } else {
    const { data: maxRow } = await admin
      .from('monthly_costs')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    await admin.from('monthly_costs').insert({
      label: body.label,
      amount: body.amount ?? 0,
      vat_applicable: body.vat_applicable ?? true,
      parent_id: body.parent_id ?? null,
      sort_order: (maxRow?.sort_order ?? 0) + 1,
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

  const admin = await createAdminClient();
  await admin.from('monthly_costs').delete().eq('id', id);
  return NextResponse.json({ ok: true });
}
