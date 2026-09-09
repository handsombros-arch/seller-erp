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
    // note 컬럼(00059)이 없는 DB 에서는 note 없이 재시도
    // 00059 note / 00060 ref_* 컬럼이 없는 DB 에서는 단계적으로 좁혀 재시도
    let res: { data: any[] | null; error: any } = await admin.from('monthly_cost_snapshots').select('year_month, cost_id, amount, note, ref_amount, ref_source, ref_detail').order('year_month', { ascending: false });
    if (res.error) res = await admin.from('monthly_cost_snapshots').select('year_month, cost_id, amount, note').order('year_month', { ascending: false });
    if (res.error) res = await admin.from('monthly_cost_snapshots').select('year_month, cost_id, amount').order('year_month', { ascending: false });
    return NextResponse.json(res.data ?? []);
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

  const updates = items.filter((i: any) => i.id).map((item: any) => ({
    id: item.id,
    label: item.label,
    vat_applicable: item.vat_applicable ?? true,
    is_income: item.is_income ?? false,
    is_locked: item.is_locked ?? false,
    sort_order: item.sort_order ?? 0,
    note: item.note ?? '',
    category: item.category ?? 'variable',
    // 00057 태그 — 컬럼이 없는 DB 에서는 아래에서 제거하고 재시도
    pl_line: item.pl_line ?? null,
    market: item.market ?? null,
    alloc_rule: item.alloc_rule ?? null,
    carry_forward: !!item.carry_forward,
    unit_price: item.unit_price == null || item.unit_price === '' ? null : Number(item.unit_price),
    vat_none: !!item.vat_none,
    vat_confirmed: !!item.vat_confirmed,
  }));

  const TAG_COLS = ['pl_line', 'market', 'alloc_rule', 'carry_forward', 'unit_price', 'vat_none', 'vat_confirmed'];
  const run = async (stripTags: boolean) => {
    const results = await Promise.all(updates.map((u: any) => {
      const { id, ...fields } = u;
      if (stripTags) for (const c of TAG_COLS) delete fields[c];
      return admin.from('monthly_costs').update(fields).eq('id', id);
    }));
    return results.find(r => r.error)?.error ?? null;
  };
  let err = await run(false);
  let tagsSaved = true;
  if (err && /PGRST204|column .* does not exist|schema cache/i.test(`${err.code} ${err.message}`)) {
    tagsSaved = false;
    err = await run(true);
  }
  if (err) return NextResponse.json({ error: err.message }, { status: 400 });

  return NextResponse.json({ ok: true, tagsSaved, needsMigration: !tagsSaved });
}

// 개별 추가/수정
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const admin = await createAdminClient();

  // 스냅샷 저장 (기존 호환)
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

  // 월별 금액 스냅샷 저장 (프론트에서 금액 직접 전달)
  if (body.action === 'snapshot_items') {
    const { year_month, amounts } = body as { year_month: string; amounts: { id: string; amount: number; note?: string | null; ref_amount?: number | null; ref_source?: string | null; ref_detail?: string | null }[] };
    const withNote = (amounts ?? []).some((a: any) => a.note !== undefined);
    const withRef = (amounts ?? []).some((a: any) => a.ref_amount !== undefined);
    const withQty = (amounts ?? []).some((a: any) => a.qty !== undefined);
    const withVat = (amounts ?? []).some((a: any) => a.vat_applicable !== undefined);
    const rows = (amounts ?? []).map((a: any) => ({
      year_month,
      cost_id: a.id,
      amount: a.amount ?? 0,     // 수기 입력 — 기준값으로 덮어쓰지 않는다
      ...(withQty ? { qty: a.qty == null ? null : Number(a.qty) } : {}),
      ...(withVat ? { vat_applicable: a.vat_applicable == null ? null : !!a.vat_applicable, vat_none: a.vat_none == null ? null : !!a.vat_none } : {}),
      ...(withNote ? { note: a.note ?? null } : {}),
      ...(withRef ? { ref_amount: a.ref_amount ?? null, ref_source: a.ref_source ?? null, ref_detail: a.ref_detail ?? null } : {}),
    }));
    let notesSaved = withNote, refsSaved = withRef;
    if (rows.length) {
      const isColErr = (e: any) => /schema cache|PGRST204|column/i.test(`${e?.code} ${e?.message}`);
      let { error } = await admin.from('monthly_cost_snapshots').upsert(rows, { onConflict: 'year_month,cost_id' });
      if (error && withVat && isColErr(error) && /vat_none/.test(error.message)) {
        ({ error } = await admin.from('monthly_cost_snapshots').upsert(rows.map(({ vat_none: _n, ...r }: any) => r), { onConflict: 'year_month,cost_id' }));
      }
      if (error && withVat && isColErr(error) && /vat_applicable/.test(error.message)) {
        ({ error } = await admin.from('monthly_cost_snapshots').upsert(rows.map(({ vat_applicable: _v, vat_none: _n, ...r }: any) => r), { onConflict: 'year_month,cost_id' }));
      }
      if (error && withQty && isColErr(error) && /qty/.test(error.message)) {
        ({ error } = await admin.from('monthly_cost_snapshots').upsert(rows.map(({ qty: _q, ...r }: any) => r), { onConflict: 'year_month,cost_id' }));
      }
      if (error && withRef && isColErr(error)) {
        refsSaved = false;
        ({ error } = await admin.from('monthly_cost_snapshots').upsert(rows.map(({ ref_amount: _a, ref_source: _s, ref_detail: _d, ...r }: any) => r), { onConflict: 'year_month,cost_id' }));
      }
      if (error && withNote && isColErr(error)) {
        notesSaved = false;
        ({ error } = await admin.from('monthly_cost_snapshots').upsert(rows.map(({ note: _n, ref_amount: _a, ref_source: _s, ref_detail: _d, ...r }: any) => r), { onConflict: 'year_month,cost_id' }));
      }
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, saved: rows.length, notesSaved, refsSaved });
  }

  if (body.id) {
    const update: any = {};
    if (body.label !== undefined) update.label = body.label;
    if (body.amount !== undefined) update.amount = body.amount;
    if (body.vat_applicable !== undefined) update.vat_applicable = body.vat_applicable;
    if (body.note !== undefined) update.note = body.note;
    if (body.is_income !== undefined) update.is_income = body.is_income;
    if (body.is_locked !== undefined) update.is_locked = body.is_locked;
    if (body.sort_order !== undefined) update.sort_order = body.sort_order;
    if (body.category !== undefined) update.category = body.category;
    if (body.pl_line !== undefined) update.pl_line = body.pl_line;
    if (body.market !== undefined) update.market = body.market;
    if (body.alloc_rule !== undefined) update.alloc_rule = body.alloc_rule;
    if (body.carry_forward !== undefined) update.carry_forward = !!body.carry_forward;
    if (body.unit_price !== undefined) update.unit_price = body.unit_price == null ? null : Number(body.unit_price);
    if (body.parent_id !== undefined) update.parent_id = body.parent_id || null;   // 항목 이동 (이력은 항목에 붙어 있어 모든 달에 적용)
    if (body.vat_none !== undefined) update.vat_none = !!body.vat_none;
    if (body.vat_confirmed !== undefined) update.vat_confirmed = !!body.vat_confirmed;
    const { error: upErr } = await admin.from('monthly_costs').update(update).eq('id', body.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const { data: maxRow } = await admin
    .from('monthly_costs')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const row: any = {
    label: body.label,
    amount: body.amount ?? 0,
    vat_applicable: body.vat_applicable ?? true,
    is_income: body.is_income ?? false,
    is_locked: body.is_locked ?? false,
    parent_id: body.parent_id ?? null,
    sort_order: (maxRow?.sort_order ?? 0) + 1,
  };
  if (body.note !== undefined) row.note = body.note;
  const { data: inserted } = await admin.from('monthly_costs').insert(row).select('*').single();

  return NextResponse.json(inserted ?? { ok: true });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  // 월별 스냅샷 삭제
  const ym = request.nextUrl.searchParams.get('ym');
  if (ym) {
    const admin = await createAdminClient();
    await admin.from('monthly_cost_snapshots').delete().eq('year_month', ym);
    return NextResponse.json({ ok: true, deleted: ym });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

  const admin = await createAdminClient();
  // 삭제는 스냅샷(전월 이력)까지 CASCADE 로 사라진다 → 이력 개수를 알려주고 confirm=1 없으면 거부
  const { data: kids } = await admin.from('monthly_costs').select('id').eq('parent_id', id);
  const ids = [id, ...(kids ?? []).map((k: any) => k.id)];
  const { count } = await admin.from('monthly_cost_snapshots').select('*', { count: 'exact', head: true }).in('cost_id', ids);
  if (request.nextUrl.searchParams.get('confirm') !== '1') {
    return NextResponse.json({ requiresConfirm: true, snapshotCount: count ?? 0, childCount: (kids ?? []).length }, { status: 409 });
  }
  const { error } = await admin.from('monthly_costs').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, deletedSnapshots: count ?? 0 });
}
