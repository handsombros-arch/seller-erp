import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: '파일 없음' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

    // Normalize columns
    const parsed = rows.map((r, i) => ({
      index: i,
      rank: Number(r['순위'] ?? i + 1),
      category: String(r['카테고리'] ?? ''),
      brand: String(r['브랜드'] ?? ''),
      manufacturer: String(r['제조사'] ?? ''),
      name: String(r['상품명'] ?? ''),
      price: Number(r['가격'] ?? 0),
      purchases: Number(r['구매건수(1개월)'] ?? r['구매건수'] ?? 0),
      reviews: Number(r['리뷰수'] ?? 0),
      clicks: Number(r['클릭수'] ?? 0),
      link: String(r['링크'] ?? ''),
      couponAmount: 0,
      couponPercent: 0,
      actualPrice: Number(r['가격'] ?? 0),
    }));

    return NextResponse.json({ rows: parsed, sheetName: wb.SheetNames[0] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '파싱 실패';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
