import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

function detectPlatform(url: string): string {
  try {
    const host = new URL(url).host;
    if (host.includes('coupang.com')) return 'coupang';
    if (host.includes('smartstore.naver.com')) return 'smartstore';
    if (host.includes('brand.naver.com')) return 'brand';
    if (host.includes('naver.com')) return 'naver';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function extractProductId(url: string, platform: string): string | null {
  if (platform === 'coupang') {
    const m = url.match(/\/vp\/products\/(\d+)/);
    return m?.[1] || null;
  }
  if (platform === 'smartstore' || platform === 'brand' || platform === 'naver') {
    const m = url.match(/\/products?\/(\d+)/);
    return m?.[1] || null;
  }
  return null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('sourcing_analyses')
    .select('id, url, platform, product_id, status, error, product_info, review_stats, reviews_count, created_at, analyzed_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const urls: string[] = Array.isArray(body.urls) ? body.urls : (body.url ? [body.url] : []);
  if (urls.length === 0) return NextResponse.json({ error: 'urls 필요' }, { status: 400 });

  const rows = urls.map((u) => {
    const url = u.trim();
    const platform = detectPlatform(url);
    const productId = extractProductId(url, platform);
    return {
      user_id: user.id,
      url,
      platform,
      product_id: productId,
      status: 'pending' as const,
    };
  });

  const admin = await createAdminClient();
  const { data, error } = await admin.from('sourcing_analyses').insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ inserted: data?.length || 0, items: data });
}
