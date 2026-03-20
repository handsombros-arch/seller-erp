import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data } = await admin
    .from('suppliers')
    .select('*')
    .eq('is_active', true)
    .order('name');

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const admin = await createAdminClient();

  const { data, error } = await admin
    .from('suppliers')
    .insert({
      name: body.name,
      alias: body.alias ?? null,
      contact_person: body.contact_person ?? null,
      phone_country_code: body.phone_country_code ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      country: body.country ?? '중국',
      lead_time_days: body.lead_time_days ?? 21,
      main_products: body.main_products ?? null,
      addresses: body.addresses ?? [],
      note: body.note ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
