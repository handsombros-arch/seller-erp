import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

function escapeCsv(val: string): string {
  const s = val ?? '';
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const format = request.nextUrl.searchParams.get('format');

  if (format === 'csv') {
    const { data: skus } = await admin
      .from('skus')
      .select('id, sku_code, option_values, product:products(name)')
      .order('created_at', { ascending: true });

    const { data: discounts } = await admin
      .from('sku_grade_discounts')
      .select('sku_id, grade, rate');

    const discMap = new Map<string, Record<string, number>>();
    for (const d of discounts ?? []) {
      if (!discMap.has(d.sku_id)) discMap.set(d.sku_id, {});
      discMap.get(d.sku_id)![d.grade] = Number(d.rate);
    }

    const grades = ['최상', '상', '중', '미개봉'];
    const lines: string[] = ['SKU코드,상품명(참고),옵션(참고),' + grades.join(',')];
    for (const sku of skus ?? []) {
      const d = discMap.get(sku.id) ?? {};
      const optLabel = sku.option_values ? Object.values(sku.option_values).join('/') : '';
      lines.push([
        sku.sku_code,
        (sku.product as any)?.name ?? '',
        optLabel,
        ...grades.map(g => d[g] != null && d[g] > 0 ? String(d[g]) : ''),
      ].map(escapeCsv).join(','));
    }

    return new NextResponse('\uFEFF' + lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="grade_discounts.csv"',
      },
    });
  }

  const { data, error } = await admin
    .from('sku_grade_discounts')
    .select('sku_id, grade, rate');

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

// 일괄 저장
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { items } = await request.json() as { items: { sku_id: string; grade: string; rate: number }[] };
  const admin = await createAdminClient();

  // 기존 데이터 삭제 후 재삽입 (심플)
  await admin.from('sku_grade_discounts').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  if (items.length > 0) {
    const rows = items.filter(i => i.rate > 0).map(i => ({
      sku_id: i.sku_id,
      grade: i.grade,
      rate: i.rate,
    }));
    if (rows.length > 0) {
      const { error } = await admin.from('sku_grade_discounts').insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
