'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Megaphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtNum, lastMonths } from '../_lib/settlement';

interface MonthRow { year_month: string; rows_count: number; cost: number }

/** 광고 raw 보유 현황 — 정산 페이지에서는 더 이상 광고 파일을 따로 올리지 않는다. 광고분석에 올린 raw 를 그대로 쓴다. */
export function AdCoverageCard({ selectedYm }: { selectedYm: string }) {
  const [months, setMonths] = useState<MonthRow[] | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settlement/product-ads?months=1').then(r => r.json()).then(j => {
      if (cancelled) return;
      setNeedsMigration(!!j.needsMigration);
      setMonths(Array.isArray(j.months) ? j.months : []);
    }).catch(() => { if (!cancelled) setMonths([]); });
    return () => { cancelled = true; };
  }, []);

  const recent = lastMonths(6).reverse();
  const byYm = new Map((months ?? []).map(m => [m.year_month, m]));
  const cur = byYm.get(selectedYm);

  return (
    <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-4 md:px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-0">
          <h3 className="text-[15px] font-bold text-fg flex items-center gap-1.5"><Megaphone className="h-4 w-4 text-info" /> 광고비 raw</h3>
          <p className="text-[12px] text-fg-3 mt-0.5">
            쿠팡 PA 보고서는 <Link href="/ad-analysis" className="text-brand font-semibold hover:underline">광고 분석</Link>에 한 번만 올리면 정산·상품별 순이익에 같이 쓰입니다.
            <span className="text-fg-4"> 올린 뒤 주황 배너가 보이면 "지금 DB 로 동기화"를 눌러야 여기 반영됩니다.</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {recent.map(ym => {
            const m = byYm.get(ym);
            const sel = ym === selectedYm;
            return (
              <span key={ym} title={m ? `${fmtNum(m.rows_count)}행 · 광고비 ${fmtNum(m.cost)}원` : '데이터 없음'}
                className={cn('h-7 px-2.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 border',
                  m ? 'bg-success/10 text-success border-success/20' : 'bg-app text-fg-4 border-transparent',
                  sel && 'ring-2 ring-brand/30')}>
                {ym.slice(2).replace('-', '.')}{m ? ' ✓' : ''}
              </span>
            );
          })}
        </div>
      </div>
      {needsMigration ? (
        <p className="mt-2 text-[11px] text-warn">DB 마이그레이션(00057) 적용 전입니다. 적용하면 광고 raw 월 집계가 켜집니다.</p>
      ) : months && !cur ? (
        <p className="mt-2 text-[11px] text-warn">{selectedYm.replace('-', '.')} 광고 raw 가 DB 에 없습니다. 상품별 순이익의 광고비가 0 으로 보입니다.</p>
      ) : cur ? (
        <p className="mt-2 text-[11px] text-fg-4">{selectedYm.replace('-', '.')} 광고비 합계 {fmtNum(cur.cost)}원 ({fmtNum(cur.rows_count)}행). 시트의 광고비 칸과 비교해 라이브·메시지 등 raw 에 없는 광고가 있는지 확인하세요.</p>
      ) : null}
    </section>
  );
}
