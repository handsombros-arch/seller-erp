'use client';

/**
 * 광고 분석 페이지가 이 PC 브라우저(IndexedDB 'lv-erp-ad' / store 'rawRows' / key 'data')에 쌓아 둔
 * 쿠팡 PA 키워드 보고서 raw 를 읽어, 월 × 광고집행 옵션ID 로 집계한다.
 * raw 전체(수십만 행)를 DB 로 올리지 않고, 이 요약(월당 수십 행)만 monthly_product_ads 에 저장하는 용도.
 */

export interface LocalAdAgg {
  vendorItemId: string;
  name: string;
  campaignId: string;
  campaignName: string;
  cost: number;
  impressions: number;
  clicks: number;
  qty14d: number;
  rev14d: number;
  skuId: string | null;
  matched: boolean;
  rows: number;
}

const num = (v: unknown) => {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return isFinite(n) ? n : 0;
};

export async function readLocalAdRows(): Promise<Record<string, unknown>[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open('lv-erp-ad', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onupgradeneeded = () => { /* 광고분석 페이지가 만든다 */ };
  });
  if (!db || !db.objectStoreNames.contains('rawRows')) return [];
  const data = await new Promise<unknown>((resolve) => {
    const tx = db.transaction('rawRows', 'readonly');
    const req = tx.objectStore('rawRows').get('data');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  db.close();
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object' && Array.isArray((data as any).rows)) return (data as any).rows;
  return [];
}

/** rows → { 'YYYY-MM': LocalAdAgg[] } */
export function aggregateLocalAdRows(rows: Record<string, unknown>[]): Record<string, LocalAdAgg[]> {
  const byMonth = new Map<string, Map<string, LocalAdAgg>>();
  // 키워드 보고서('-')와 일별 보고서('')가 같은 지출을 두 번 담고 있을 수 있어 정규화 키로 중복 제거
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const kw = String(r['키워드'] ?? '').trim(); const key = `${r['날짜']}|${kw === '-' ? '' : kw}|${r['광고전환매출발생 옵션ID'] ?? ''}|${r['광고 노출 지면'] ?? ''}`;
    if (seen.has(key)) continue; seen.add(key);
    const d = String(r['날짜'] ?? '').replace(/\D/g, '');
    if (d.length < 6) continue;
    const ym = `${d.slice(0, 4)}-${d.slice(4, 6)}`;
    const vid = String(r['광고집행 옵션ID'] ?? '').trim();
    if (!vid) continue;
    let m = byMonth.get(ym);
    if (!m) { m = new Map(); byMonth.set(ym, m); }
    let a = m.get(vid);
    if (!a) {
      a = { vendorItemId: vid, name: String(r['광고집행 상품명'] ?? ''), campaignId: '', campaignName: String(r['캠페인명'] ?? r['캠페인'] ?? ''), cost: 0, impressions: 0, clicks: 0, qty14d: 0, rev14d: 0, skuId: null, matched: false, rows: 0 };
      m.set(vid, a);
    }
    a.cost += num(r['광고비']);
    a.impressions += num(r['노출수']);
    a.clicks += num(r['클릭수']);
    a.qty14d += num(r['총 판매수량(14일)']);
    a.rev14d += num(r['총 전환매출액(14일)']);
    a.rows += 1;
    if (!a.name && r['광고집행 상품명']) a.name = String(r['광고집행 상품명']);
  }
  const out: Record<string, LocalAdAgg[]> = {};
  for (const [ym, m] of byMonth) out[ym] = [...m.values()].sort((x, y) => y.cost - x.cost);
  return out;
}
