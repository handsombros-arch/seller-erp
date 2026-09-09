'use client';

import { useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { fmtNum, type MCost, type Snapshot } from '../_lib/settlement';
import { estimateIncomeTax, estimateVat } from '../_lib/taxEstimate';

/** 예상 부가가치세 · 종합소득세 — 시트 저장값 기준 추정 */
export function TaxEstimateCard({ items, snapshots, switchYm, ym }: { items: MCost[]; snapshots: Snapshot[]; switchYm: string; ym: string }) {
  const years = useMemo(() => { const ys = new Set<number>(snapshots.map(s => Number(s.year_month.slice(0, 4)))); ys.add(Number(ym.slice(0, 4))); return [...ys].sort((a, b) => b - a); }, [snapshots, ym]);
  const [year, setYear] = useState<string>(ym.slice(0, 4));
  const y = Number(year);
  const vat = useMemo(() => estimateVat(items, snapshots, y, switchYm), [items, snapshots, y, switchYm]);
  const inc = useMemo(() => estimateIncomeTax(items, snapshots, y, switchYm), [items, snapshots, y, switchYm]);
  const won = (n: number) => `${fmtNum(n)}원`;

  return (
    <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-4 md:px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-[15px] font-bold text-fg flex items-center gap-1.5 mr-auto"><Calculator className="h-4 w-4 text-brand" /> 예상 세금 <span className="text-[11px] font-medium text-fg-4">시트 저장값 기준 · 세무사 확인용</span></h3>
        <SegmentedControl items={years.map(v => ({ value: String(v), label: `${v}년` }))} value={year} onChange={setYear} />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {vat.map(p => (
          <div key={p.key} className="rounded-xl border border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-fg">{p.label}</span>
              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', p.regime === 'simplified' ? 'bg-warn/15 text-warn' : 'bg-brand-bg text-brand')}>{p.regime === 'simplified' ? '간이' : '일반'}</span>
              <span className="ml-auto text-[11px] text-fg-4">마감 {p.due}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
              <div><div className="text-[10px] text-fg-4">매출세액</div><div className="tabular-nums text-fg">{won(p.salesTax)}</div><div className="text-[10px] text-fg-5">매출 {won(p.salesBase)}</div></div>
              <div><div className="text-[10px] text-fg-4">{p.regime === 'simplified' ? '매입세액공제(0.5%)' : '매입세액'}</div><div className="tabular-nums text-fg">−{won(p.purchaseTax)}</div><div className="text-[10px] text-fg-5">매입 {won(p.purchaseBase)}</div></div>
              <div><div className="text-[10px] text-fg-4">납부 예상</div><div className={cn('tabular-nums font-bold', p.payable > 0 ? 'text-danger' : 'text-success')}>{won(p.payable)}</div><div className="text-[10px] text-fg-5">{p.monthsWithData}/{p.months.length}개월 저장됨</div></div>
            </div>
            {p.note && <p className="mt-1.5 text-[10px] text-fg-4">{p.note}</p>}
          </div>
        ))}

        <div className="rounded-xl border border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-fg">{inc.year}년 귀속 종합소득세</span>
            <span className="ml-auto text-[11px] text-fg-4">마감 {inc.due}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
            <div><div className="text-[10px] text-fg-4">연간 영업이익</div><div className="tabular-nums text-fg">{won(inc.profit)}</div><div className="text-[10px] text-fg-5">{inc.monthsWithData}/12개월 저장됨</div></div>
            <div><div className="text-[10px] text-fg-4">산출세액 ({inc.bracket} 구간)</div><div className="tabular-nums text-fg">{won(inc.incomeTax)}</div><div className="text-[10px] text-fg-5">지방소득세 +{won(inc.localTax)}</div></div>
            <div><div className="text-[10px] text-fg-4">납부 예상</div><div className={cn('tabular-nums font-bold', inc.total > 0 ? 'text-danger' : 'text-success')}>{won(inc.total)}</div></div>
          </div>
          <p className="mt-1.5 text-[10px] text-fg-4">사업소득만, 인적공제·노란우산·연금 등 소득공제와 세액공제 미반영. 단순경비율/기장 방식에 따라 크게 달라질 수 있습니다. 저장 안 된 달은 0 으로 계산됩니다.</p>
        </div>
      </div>
    </section>
  );
}
