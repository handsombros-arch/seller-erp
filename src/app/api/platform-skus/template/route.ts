import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

function escapeCsv(val: string): string {
  const s = val ?? '';
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function optionLabel(option_values: any): string {
  if (!option_values || !Object.keys(option_values).length) return '';
  return Object.values(option_values).join('/');
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  const [{ data: channels }, { data: skus }, { data: platformSkus }] = await Promise.all([
    admin.from('channels').select('id, name, type').order('created_at', { ascending: true }),
    admin.from('skus').select('id, sku_code, option_values, product:products(name)').order('created_at', { ascending: true }),
    admin.from('platform_skus').select('sku_id, channel_id, platform_product_name, platform_product_id, platform_sku_id, price, coupon_discount, commission_rate, rg_fee_inout, rg_fee_shipping, rg_fee_return, rg_fee_restock, rg_fee_send, rg_fee_packing'),
  ]);

  // sku_id|channel_id → platform data
  const psMap = new Map<string, any>();
  for (const ps of platformSkus ?? []) {
    psMap.set(`${ps.sku_id}|${ps.channel_id}`, ps);
  }

  const lines: string[] = ['SKU코드,채널명,플랫폼상품명,플랫폼상품ID,판매가,쿠폰할인,수수료율(%),RG입출고비,RG배송비,반품회수비,반품재입고비,창고발송비,포장비,상품명(참고),옵션(참고)'];

  for (const channel of channels ?? []) {
    const isCoupang = (channel as any).type === 'coupang';
    for (const sku of skus ?? []) {
      const ps = psMap.get(`${sku.id}|${channel.id}`);
      const productName = (sku.product as any)?.name ?? '';
      const platformId = isCoupang
        ? (ps?.platform_sku_id ?? '')
        : (ps?.platform_product_id ?? '');
      const num = (v: any) => v != null && v !== 0 ? String(v) : '';
      lines.push([
        sku.sku_code,
        channel.name,
        ps?.platform_product_name ?? '',
        platformId,
        ps?.price != null ? String(ps.price) : '',
        num(ps?.coupon_discount),
        num(ps?.commission_rate),
        num(ps?.rg_fee_inout),
        num(ps?.rg_fee_shipping),
        num(ps?.rg_fee_return),
        num(ps?.rg_fee_restock),
        num(ps?.rg_fee_send),
        num(ps?.rg_fee_packing),
        productName,
        optionLabel(sku.option_values),
      ].map(escapeCsv).join(','));
    }
  }

  const bom = '\uFEFF';
  return new NextResponse(bom + lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="platform_skus_template.csv"',
    },
  });
}
