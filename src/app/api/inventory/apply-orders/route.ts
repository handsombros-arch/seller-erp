import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { applyOrdersToInventory } from '@/lib/inventory/applyOrders';

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

    const admin = await createAdminClient();
    const result = await applyOrdersToInventory(admin, user.id);

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? '서버 오류' }, { status: 500 });
  }
}
