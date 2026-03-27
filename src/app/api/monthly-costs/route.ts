import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('monthly_costs')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const admin = await createAdminClient();

  if (body.id) {
    // update
    const { error } = await admin
      .from('monthly_costs')
      .update({ label: body.label, amount: body.amount ?? 0 })
      .eq('id', body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    // insert
    const { data: maxRow } = await admin
      .from('monthly_costs')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await admin
      .from('monthly_costs')
      .insert({ label: body.label, amount: body.amount ?? 0, sort_order: (maxRow?.sort_order ?? 0) + 1 });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
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
  const { error } = await admin.from('monthly_costs').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
