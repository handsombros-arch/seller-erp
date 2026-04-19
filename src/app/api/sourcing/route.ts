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

type UrlKind = 'product' | 'category' | 'best100' | 'campaign' | 'unknown';
function classifyUrl(url: string): UrlKind {
  if (/\/vp\/products\//.test(url)) return 'product';
  if (/\/np\/best100\//.test(url)) return 'best100';
  if (/\/np\/categories\//.test(url)) return 'category';
  if (/\/np\/campaigns\//.test(url)) return 'campaign';
  return 'unknown';
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('sourcing_analyses')
    .select('id, url, platform, product_id, status, error, product_info, review_stats, reviews_count, batch_id, batch_rank, created_at, analyzed_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const urls: string[] = Array.isArray(body.urls) ? body.urls : (body.url ? [body.url] : []);
  const expandLimit = Math.max(5, Math.min(100, Number(body.expand_limit) || 40));
  if (urls.length === 0) return NextResponse.json({ error: 'urls 필요' }, { status: 400 });

  const admin = await createAdminClient();
  const productRows: Record<string, unknown>[] = [];
  const batchesCreated: Array<{ id: string; url: string; limit: number }> = [];
  const nowIso = new Date().toISOString();

  for (const raw of urls) {
    const url = raw.trim();
    if (!url) continue;
    const kind = classifyUrl(url);
    if (kind === 'product' || kind === 'unknown') {
      const platform = detectPlatform(url);
      const productId = extractProductId(url, platform);
      productRows.push({
        user_id: user.id,
        url,
        platform,
        product_id: productId,
        status: 'pending',
      });
    } else {
      // 카테고리/베스트100/캠페인 → batch 생성
      const { data: batch, error } = await admin
        .from('sourcing_batches')
        .insert({
          user_id: user.id,
          source_url: url,
          source_type: kind,
          expand_limit: expandLimit,
          status: 'pending',
          queued_at: nowIso,
        })
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      batchesCreated.push({ id: batch.id, url, limit: expandLimit });
    }
  }

  let insertedProducts = 0;
  if (productRows.length) {
    const { data, error } = await admin.from('sourcing_analyses').insert(productRows).select();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    insertedProducts = data?.length || 0;
  }

  return NextResponse.json({
    inserted: insertedProducts,
    batches: batchesCreated,
  });
}
