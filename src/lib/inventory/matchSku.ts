import type { SupabaseClient } from '@supabase/supabase-js';

interface SkuRule {
  sku_id: string;
  sku_code: string;
  product_name: string;
  option_values: string[];
  platform_names: string[];
}

/** 단어 경계 매칭 (L이 XL 안에서 매칭되지 않도록) */
function wordMatch(text: string, word: string): boolean {
  const w = word.toLowerCase();
  const t = ` ${text.toLowerCase()} `;
  const idx = t.indexOf(w);
  if (idx < 0) return false;
  const before = t[idx - 1];
  const after = t[idx + w.length];
  return !/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after);
}

export interface SkuMatcher {
  /** SKU코드 직접 매칭 */
  byCode(code: string): string | null;
  /** vendorItemId 매칭 (쿠팡 RG) */
  byVendorItemId(vid: string): string | null;
  /** 상품명 + 옵션명으로 매칭 (토스/스마트스토어/일반) */
  byNameOption(productName: string, optionName?: string | null): string | null;
}

/** sync-orders 등에서 사용할 SKU 매칭 로직 빌드 */
export async function buildSkuMatcher(admin: SupabaseClient): Promise<SkuMatcher> {
  const [
    { data: skus },
    { data: platformSkus },
    { data: rgSnapshots },
    { data: returnItems },
    { data: aliases },
  ] = await Promise.all([
    admin.from('skus').select('id, sku_code, option_values, product:products(id, name)'),
    admin.from('platform_skus').select('sku_id, platform_sku_id, platform_sku_id_return, platform_product_name, channel:channels(type)'),
    admin.from('rg_inventory_snapshots').select('vendor_item_id, external_sku_id, sku_id').not('sku_id', 'is', null),
    admin.from('rg_return_vendor_items').select('vendor_item_id, sku_id').not('sku_id', 'is', null),
    admin.from('sku_name_aliases').select('channel_name, sku_id'),
  ]);

  // 1. SKU코드 맵
  const codeMap = new Map<string, string>();
  for (const s of skus ?? []) codeMap.set(s.sku_code, s.id);

  // 2. vendorItemId 맵 (RG)
  const vidMap = new Map<string, string>();
  for (const r of rgSnapshots ?? []) vidMap.set(String(r.vendor_item_id), r.sku_id as string);
  for (const p of platformSkus ?? []) {
    if ((p as any).channel?.type !== 'coupang') continue;
    if ((p as any).platform_sku_id) vidMap.set(String((p as any).platform_sku_id), (p as any).sku_id);
    if ((p as any).platform_sku_id_return) vidMap.set(String((p as any).platform_sku_id_return), (p as any).sku_id);
  }
  for (const r of returnItems ?? []) {
    if (!vidMap.has(r.vendor_item_id)) vidMap.set(r.vendor_item_id, r.sku_id as string);
  }

  // 3. 이름+옵션 매칭 규칙
  const rules: SkuRule[] = [];
  for (const s of skus ?? []) {
    const pn = (s as any).product?.name;
    if (!pn) continue;
    const opts: string[] = s.option_values ? Object.values(s.option_values as Record<string, string>) : [];
    const platNames = (platformSkus ?? [])
      .filter((p: any) => p.sku_id === s.id && p.platform_product_name)
      .map((p: any) => p.platform_product_name as string);
    rules.push({ sku_id: s.id, sku_code: s.sku_code, product_name: pn, option_values: opts, platform_names: platNames });
  }

  // 다중옵션 상품 판별
  const productSkuCount: Record<string, number> = {};
  for (const s of skus ?? []) {
    const pid = (s as any).product?.id;
    if (pid) productSkuCount[pid] = (productSkuCount[pid] || 0) + 1;
  }
  const singleSkuProducts = new Set(
    Object.entries(productSkuCount).filter(([, c]) => c === 1).map(([id]) => id)
  );

  // 4. aliases 맵 (단일옵션 상품용)
  const aliasMap = new Map<string, string>();
  for (const a of aliases ?? []) {
    aliasMap.set((a.channel_name as string).trim().toLowerCase(), a.sku_id as string);
  }

  return {
    byCode(code: string) {
      return codeMap.get(code) ?? null;
    },

    byVendorItemId(vid: string) {
      return vidMap.get(vid) ?? null;
    },

    byNameOption(productName: string, optionName?: string | null) {
      const pn = (productName ?? '').trim().toLowerCase();
      const opt = (optionName ?? '').trim().toLowerCase();
      const fullText = `${pn} ${opt}`.trim();

      // 1차: aliases 정확 매칭 (단일옵션 상품에 유효)
      const aliasSkuId = aliasMap.get(pn);
      if (aliasSkuId) {
        // 단일옵션 상품이면 바로 반환
        const sku = (skus ?? []).find((s: any) => s.id === aliasSkuId);
        const pid = (sku as any)?.product?.id;
        if (pid && singleSkuProducts.has(pid)) return aliasSkuId;
      }

      // 2차: 상품명 + 옵션 정밀 매칭
      let bestMatch: SkuRule | null = null;
      let bestScore = 0;
      let bestLen = 0;

      for (const rule of rules) {
        // 상품명 매칭
        const nameMatch =
          rule.platform_names.some(n => pn.includes(n.toLowerCase()) || n.toLowerCase().includes(pn)) ||
          fullText.includes(rule.product_name.toLowerCase());
        if (!nameMatch) continue;

        if (rule.option_values.length === 0) {
          // 옵션 없는 SKU — 상품명만 매칭되면 OK
          if (!bestMatch) { bestMatch = rule; }
          continue;
        }

        // 옵션 매칭 (단어 경계)
        let optScore = 0;
        let optLen = 0;
        for (const ov of rule.option_values) {
          if (wordMatch(fullText, ov) || wordMatch(opt, ov)) {
            optScore++;
            optLen += ov.length;
          }
        }

        if (optScore > bestScore || (optScore === bestScore && optLen > bestLen)) {
          bestScore = optScore;
          bestLen = optLen;
          bestMatch = rule;
        }
      }

      return bestMatch?.sku_id ?? null;
    },
  };
}
