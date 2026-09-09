'use client';

import { useState } from 'react';
import { Loader2, CheckCircle2, Upload, Save } from 'lucide-react';
import { useToast } from '@/components/ui/toast';

// ───────────────── Platform Cost Calculator ─────────────────

interface CostProduct { name: string; qty: number; revenue: number; cost: number; unitCost: number; matched: boolean; method: string; }
interface CostResult { platform: string; totalRevenue: number; totalQty: number; matchCount: number; totalItems: number; products: CostProduct[]; detectedYm?: string; }

const PLATFORMS = [
  { id: 'coupang', label: '쿠팡 그로스', accept: '.xlsx,.xls', hint: '셀러 인사이트 엑셀' },
  { id: 'toss', label: '토스', accept: '.xlsx,.xls', hint: '전체주문조회 엑셀 (구매확정)' },
  { id: 'smartstore', label: '스스', accept: '.xlsx,.xls,.csv', hint: '주문조회 엑셀 (구매확정)' },
  { id: 'esm', label: 'ESM', accept: '.xlsx,.xls', hint: '주문 엑셀 (G마켓/옥션)' },
  { id: 'talkdeal', label: '톡딜', accept: '.xlsx,.xls', hint: '주문 엑셀', manualOnly: true as const },
];

export function CostUpload({ selectedYm, onApply, closed }: { selectedYm: string; onApply?: () => void; closed?: boolean }) {
  const [platform, setPlatform] = useState(PLATFORMS[0].id);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<CostResult | null>(null);
  const toast = useToast();
  const [vatIncluded, setVatIncluded] = useState(false);
  const [applied, setApplied] = useState(false);

  const fmt = (n: number) => n.toLocaleString('ko-KR');
  const totalExVat = result ? result.products.reduce((s, p) => s + p.cost, 0) : 0;
  const total = vatIncluded ? Math.round(totalExVat * 1.1) : totalExVat;

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    setResult(null);
    setApplied(false);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('platform', platform);
    const res = await fetch('/api/monthly-costs/calc-cost', { method: 'POST', body: fd });
    const data = await res.json();
    setUploading(false);
    if (data.products) {
      setResult(data);
      // 엑셀 날짜와 선택월 불일치 시 알럿 (쿠팡 인사이트는 날짜 없어 detectedYm 비어있음 — skip)
      if (data.detectedYm && data.detectedYm !== selectedYm) {
        toast.warning(`엑셀의 월(${data.detectedYm})과 선택된 월(${selectedYm})이 다릅니다.\n\n그대로 "정산시트에 적용" 시 ${selectedYm} 데이터로 저장됩니다.\n월을 바꾸시려면 정산 시트 위쪽 월 선택기에서 ${data.detectedYm} 선택하세요.`);
      }
    }
    else { toast.success(data?.error || '파일 처리 실패'); setTimeout(() => toast.success(''), 2000); }
  }

  function updateProductUnitCost(idx: number, unitCost: number) {
    if (!result) return;
    const products = [...result.products];
    const p = products[idx];
    products[idx] = { ...p, unitCost, cost: unitCost * p.qty };
    setResult({ ...result, products });
    setApplied(false);
  }

  async function applyToSettlement() {
    if (closed) { toast.warning(`${selectedYm} 은 마감된 달입니다. 시트에서 마감을 해제한 뒤 적용하세요.`); return; }
    if (!result) return;
    const pLabel = PLATFORMS.find(p => p.id === platform)?.label || platform;

    // 수기 입력/수정된 단가 매핑 저장
    const mappings = result.products
      .filter(p => p.unitCost > 0)
      .map(p => ({ name: p.name, unitCost: p.unitCost }));
    if (mappings.length) {
      await fetch('/api/monthly-costs/calc-cost', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, mappings }),
      });
    }

    // 상품별 매출 영속화 (monthly_product_sales) — 분석용
    await fetch('/api/monthly-product-sales', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        yearMonth: selectedYm,
        platform,
        products: result.products,
      }),
    });

    const costRes = await fetch('/api/monthly-costs');
    const allItems: any[] = costRes.ok ? await costRes.json() : [];
    const amount = totalExVat;

    // cogs 항목에서 매칭 (정확 → top-level 부분 매칭)
    const cogsItems = allItems.filter((i: any) => i.category === 'cogs');
    const allCogsAndChildren = allItems.filter((i: any) => {
      if (i.category === 'cogs') return true;
      const parent = allItems.find((p: any) => p.id === i.parent_id);
      return parent?.category === 'cogs';
    });
    const cogsTopLevel = allCogsAndChildren.filter((i: any) => !i.parent_id);

    let target: any =
      // 정확 매칭 (전체 트리)
      allCogsAndChildren.find((i: any) => i.label === pLabel) ||
      // 부분 매칭 (top-level만, 자식에 잘못 매칭 방지)
      cogsTopLevel.find((i: any) => pLabel.includes(i.label) || i.label.includes(pLabel)) ||
      // 레거시
      allItems.find((i: any) => i.label === `매입원가 (${pLabel})`) ||
      null;

    // 정산시트에서 선택된 월에 저장
    const targetYm = selectedYm;

    if (target) {
      // 구조 업데이트
      await fetch('/api/monthly-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: target.id, amount, vat_applicable: vatIncluded }),
      });
      // 현재 월 스냅샷에도 저장
      await fetch('/api/monthly-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'snapshot_items', year_month: targetYm, amounts: [{ id: target.id, amount }] }),
      });
      toast.success(`${target.label} 매입원가 → ${fmt(total)}원 적용 완료`);
    } else {
      // 새로 생성 (항상 top-level cogs)
      const res = await fetch('/api/monthly-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: pLabel, amount, vat_applicable: vatIncluded, parent_id: null, category: 'cogs' }),
      });
      const created = await res.json();
      // 생성된 항목도 스냅샷에 저장
      if (created?.id) {
        await fetch('/api/monthly-costs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'snapshot_items', year_month: targetYm, amounts: [{ id: created.id, amount }] }),
        });
      }
      toast.success(`${pLabel} 매입원가 → ${fmt(total)}원 항목 생성 완료`);
    }
    setApplied(true);
    onApply?.();
    setTimeout(() => toast.success(''), 2500);
  }

  const curPlatform = PLATFORMS.find(p => p.id === platform)!;

  return (
    <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-5 py-4 border-b border-line-2">
        <h3 className="text-[15px] font-bold text-fg">플랫폼별 매입원가</h3>
        <p className="text-[12px] text-fg-3 mt-0.5">엑셀 업로드 → SKU 원가 자동 매칭 → 정산시트에 적용</p>
      </div>

      <div className="px-3 md:px-5 py-3 md:py-4 space-y-3 md:space-y-4">
        {/* 플랫폼 탭 */}
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div className="flex bg-app rounded-lg p-0.5">
            {PLATFORMS.map(p => (
              <button key={p.id} onClick={() => { setPlatform(p.id); setResult(null); }}
                className={`px-2.5 md:px-3.5 py-1.5 rounded-md text-[11px] md:text-[12px] font-medium transition-all ${platform === p.id ? 'bg-card text-fg shadow-sm' : 'text-fg-3'}`}>
                {p.label}
              </button>
            ))}
          </div>
          {curPlatform.manualOnly ? (
            <span className="h-8 md:h-9 px-3 md:px-4 rounded-lg bg-app text-fg-3 text-[11px] md:text-[12px] font-medium flex items-center">
              수동 입력 전용 — 정산 페이지에서 직접 금액 입력
            </span>
          ) : (
            <label className="h-8 md:h-9 px-3 md:px-4 rounded-lg bg-brand text-white text-[11px] md:text-[12px] font-semibold hover:bg-brand-hover flex items-center gap-1.5 cursor-pointer transition-colors">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{curPlatform.hint}</span><span className="sm:hidden">업로드</span>
              <input type="file" accept={curPlatform.accept} onChange={handleUpload} className="hidden" />
            </label>
          )}
        </div>

        {/* 결과 */}
        {result && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
              <div className="bg-card-2 rounded-lg px-3 py-2">
                <p className="text-[10px] text-fg-3">총 판매량</p>
                <p className="text-[14px] font-bold text-fg tabular-nums">{fmt(result.totalQty)}건</p>
              </div>
              <div className="bg-card-2 rounded-lg px-3 py-2">
                <p className="text-[10px] text-fg-3">총 매출</p>
                <p className="text-[14px] font-bold text-fg tabular-nums">{fmt(result.totalRevenue)}원</p>
              </div>
              <div className="bg-card-2 rounded-lg px-3 py-2">
                <p className="text-[10px] text-fg-3">총 매입원가</p>
                <p className="text-[14px] font-bold text-warn tabular-nums">{fmt(total)}원</p>
              </div>
              <div className="bg-card-2 rounded-lg px-3 py-2">
                <p className="text-[10px] text-fg-3">매칭</p>
                <p className="text-[14px] font-bold text-fg tabular-nums">{result.matchCount}/{result.totalItems}</p>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto border border-line rounded-xl">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 z-10 bg-card-2"><tr className="text-fg-3 border-b border-line">
                  <th className="text-left py-2 px-3 min-w-[200px]">상품 / 옵션</th>
                  <th className="text-right py-2 px-2 w-12">수량</th>
                  <th className="text-right py-2 px-2 w-24">매출</th>
                  <th className="text-right py-2 px-2 w-24">단가</th>
                  <th className="text-right py-2 px-2 w-28">매입원가</th>
                  <th className="text-center py-2 px-2 w-12">상태</th>
                </tr></thead>
                <tbody>
                  {result.products.map((p, i) => (
                    <tr key={i} className={`border-b border-line-2 ${!p.matched ? 'bg-amber-50/50' : ''}`}>
                      <td className="py-1.5 px-3 text-fg text-[10px]">{p.name}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-fg-3">{p.qty}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-fg-3">{fmt(p.revenue)}</td>
                      <td className="py-0.5 px-1">
                        <input type="text" inputMode="numeric" value={p.unitCost ? fmt(p.unitCost) : ''}
                          onChange={(e) => updateProductUnitCost(i, Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                          placeholder="0"
                          className={`w-full h-7 px-2 text-right text-[11px] tabular-nums font-medium rounded border transition-colors focus:outline-none focus:border-brand focus:bg-card ${!p.matched ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-transparent hover:border-line bg-transparent text-fg'}`} />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-fg-3">{p.cost ? fmt(p.cost) : '-'}</td>
                      <td className="py-1.5 px-2 text-center">
                        {p.method === 'saved'
                          ? <span className="text-[9px] font-semibold text-brand bg-brand-bg px-1.5 py-0.5 rounded">누적</span>
                          : p.matched
                          ? <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">자동</span>
                          : <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">수기</span>}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-line font-bold bg-card-2">
                    <td className="py-2 px-3 text-fg">합계</td>
                    <td className="py-2 px-2 text-right tabular-nums">{result.totalQty}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{fmt(result.totalRevenue)}</td>
                    <td className="py-2 px-2" />
                    <td className="py-2 px-2 text-right tabular-nums text-warn">{fmt(total)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={() => setVatIncluded(!vatIncluded)}
                className={`h-10 px-4 rounded-lg text-[12px] font-semibold transition-all active:scale-95 ${
                  vatIncluded
                    ? 'bg-warn text-white ring-1 ring-warn/30'
                    : 'bg-app text-fg-3 hover:bg-line'
                }`}>
                {vatIncluded ? 'VAT 포함 ✓' : 'VAT 제외'}
              </button>
              {applied ? (
                <div className="flex-1 h-10 rounded-lg bg-emerald-500 text-white text-[13px] font-semibold flex items-center justify-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  정산시트 적용 완료: {fmt(total)}원{vatIncluded ? ' (VAT포함)' : ''}
                </div>
              ) : (
                <button onClick={applyToSettlement}
                  className="flex-1 h-10 rounded-lg bg-warn text-white text-[13px] font-semibold hover:bg-[#EA6C0B] transition-colors flex items-center justify-center gap-2">
                  <Save className="h-4 w-4" />
                  정산시트에 적용: {fmt(total)}원{vatIncluded ? ' (VAT포함)' : ''}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

    </section>
  );
}

// ───────────────── Product Profit (상품별 순이익 분석) ─────────────────

