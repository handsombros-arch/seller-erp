import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const { rows } = body as { rows: Record<string, string>[] };
  if (!rows?.length) return NextResponse.json({ error: '데이터 없음' }, { status: 400 });

  const admin = await createAdminClient();

  let created = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const name = String(row['업체명'] ?? '').trim();
    if (!name) continue;

    // addresses JSONB 빌드: 사무실, 출고지 (값 있는 것만)
    const addresses: { type: string; label: string; address: string }[] = [];
    const office = row['사무실']?.trim();
    const factory = row['출고지']?.trim();
    if (office) addresses.push({ type: 'office', label: '사무실', address: office });
    if (factory) addresses.push({ type: 'factory', label: '출고지', address: factory });

    const { error } = await admin.from('suppliers').insert({
      name,
      contact_person: row['담당자']?.trim() || null,
      phone_country_code: row['국가코드']?.trim() || '+86',
      phone: row['전화번호']?.trim() || null,
      email: row['이메일']?.trim() || null,
      country: row['국가']?.trim() || '중국',
      lead_time_days: Number(row['리드타임(일)']) || 21,
      main_products: row['주요상품']?.trim() || null,
      addresses: addresses.length ? addresses : [],
      note: row['메모']?.trim() || null,
    });

    if (error) {
      if (error.code === '23505') {
        errors.push(`"${name}" 이미 존재 (건너뜀)`);
      } else {
        errors.push(`"${name}": ${error.message}`);
      }
    } else {
      created++;
    }
  }

  return NextResponse.json({ created, errors });
}
