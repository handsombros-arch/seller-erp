import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { vendor_item_id, grade } = await request.json();
  if (!vendor_item_id) return NextResponse.json({ error: 'vendor_item_id 필요' }, { status: 400 });

  const admin = await createAdminClient();
  const { error } = await admin
    .from('rg_return_vendor_items')
    .upsert({ vendor_item_id, grade: grade ?? null }, { onConflict: 'vendor_item_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { vendor_item_id } = await request.json();
  if (!vendor_item_id) return NextResponse.json({ error: 'vendor_item_id 필요' }, { status: 400 });

  const admin = await createAdminClient();
  const { error } = await admin
    .from('rg_return_vendor_items')
    .delete()
    .eq('vendor_item_id', vendor_item_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { vendor_item_id, grade, sku_id } = await request.json();
  if (!vendor_item_id) return NextResponse.json({ error: 'vendor_item_id 필요' }, { status: 400 });

  const admin = await createAdminClient();
  const patch: Record<string, any> = {};
  if (grade !== undefined) patch.grade = grade;
  if (sku_id !== undefined) patch.sku_id = sku_id;

  const { error } = await admin
    .from('rg_return_vendor_items')
    .update(patch)
    .eq('vendor_item_id', vendor_item_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
