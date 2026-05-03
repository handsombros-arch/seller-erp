import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

type Row = {
  category_name: string | null;
  category_path: string[] | null;
  captured_at: string;
  total_impression: number | null;
  total_click: number | null;
  top100_impression: number | null;
  top100_search_pct: number | null;
  top100_ad_pct: number | null;
  memo: string | null;
};

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function num(n: number | null | undefined): string {
  return n == null ? '' : String(n);
}

function pct(n: number | null | undefined): string {
  return n == null ? '' : n.toFixed(2);
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const idsParam = request.nextUrl.searchParams.get('ids') || '';
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids 가 비어있습니다.' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('competitor_snapshots')
    .select('category_name, category_path, captured_at, total_impression, total_click, top100_impression, top100_search_pct, top100_ad_pct, memo')
    .in('id', ids)
    .eq('user_id', user.id)
    // path 전체로 정렬해야 같은 leaf 이름이라도 다른 path 가 별도로 모임
    .order('category_path', { ascending: true })
    .order('captured_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const header = [
    '카테고리',
    '카테고리 경로',
    '캡처일',
    '전체 노출',
    '전체 클릭',
    '전체 CTR(%)',
    'Top100 노출',
    'Top100 점유율(%)',
    'Top100 Search(%)',
    'Top100 Ad(%)',
    '메모',
  ];

  const lines: string[] = [header.map(csvEscape).join(',')];
  for (const r of (data || []) as Row[]) {
    const totalCtr =
      r.total_click && r.total_impression ? (r.total_click / r.total_impression) * 100 : null;
    const top100Share =
      r.top100_impression && r.total_impression
        ? (r.top100_impression / r.total_impression) * 100
        : null;
    const fullPath = r.category_path && r.category_path.length > 0
      ? r.category_path.join(' > ')
      : '';
    lines.push(
      [
        csvEscape(r.category_name),
        csvEscape(fullPath),
        csvEscape(new Date(r.captured_at).toISOString().slice(0, 10)),
        num(r.total_impression),
        num(r.total_click),
        pct(totalCtr),
        num(r.top100_impression),
        pct(top100Share),
        pct(r.top100_search_pct),
        pct(r.top100_ad_pct),
        csvEscape(r.memo),
      ].join(','),
    );
  }

  // 엑셀 한글 깨짐 방지를 위한 UTF-8 BOM
  const csv = '﻿' + lines.join('\r\n');
  const ts = new Date().toISOString().slice(0, 10);
  const filename = `category-compare-${ts}.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
