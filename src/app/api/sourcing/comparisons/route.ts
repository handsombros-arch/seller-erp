import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// GET: 사용자의 저장된 스냅샷 목록
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('sourcing_comparisons')
    .select('id, name, item_ids, note, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST: 새 스냅샷 저장
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await req.json();
  const { name, item_ids, custom_rows, note } = body;
  if (!name || !Array.isArray(item_ids) || item_ids.length === 0) {
    return NextResponse.json({ error: 'name, item_ids 필수' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('sourcing_comparisons')
    .insert({
      user_id: user.id,
      name,
      item_ids,
      custom_rows: custom_rows ?? [],
      note: note ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
