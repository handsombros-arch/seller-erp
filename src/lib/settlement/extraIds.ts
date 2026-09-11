/**
 * 추가 옵션ID(platform_sku_ids) — SKU 하나에 같은 채널 옵션ID 여러 개.
 * 모든 매칭 경로가 이 맵을 기본 ID(platform_skus.platform_sku_id) 위에 덮어서 쓴다.
 * 테이블이 아직 없으면(마이그레이션 00071 미적용) 빈 맵을 돌려주고 조용히 넘어간다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ExtraId { skuId: string; channelId: string; channelType: string; vid: string; label: string | null; price: number | null }

export async function loadExtraIds(admin: SupabaseClient): Promise<ExtraId[]> {
  const { data, error } = await admin.from('platform_sku_ids').select('sku_id, channel_id, platform_sku_id, label, price, channel:channels(type)');
  if (error || !data) return [];
  return (data as any[]).map(r => ({ skuId: String(r.sku_id), channelId: String(r.channel_id), channelType: String(r.channel?.type ?? ''), vid: String(r.platform_sku_id), label: r.label ?? null, price: r.price == null ? null : Number(r.price) }));
}

/** vid → sku_id (채널 유형으로 거를 수 있음) */
export async function loadExtraVidMap(admin: SupabaseClient, channelType?: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const e of await loadExtraIds(admin)) if (!channelType || e.channelType === channelType) m.set(e.vid, e.skuId);
  return m;
}

/** 기본 ID 맵에 추가 ID 를 합친다 (기본이 우선) */
export function mergeVidMap<T>(base: Map<string, T>, extras: Map<string, string>, of: (skuId: string) => T | undefined) {
  for (const [vid, skuId] of extras) { if (base.has(vid)) continue; const v = of(skuId); if (v !== undefined) base.set(vid, v); }
  return base;
}
