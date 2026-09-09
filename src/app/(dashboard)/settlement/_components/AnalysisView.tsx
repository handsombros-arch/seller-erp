'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MARKETS, PL_ROWS, buildPL, fmtNum, fmtPct, type Basis, type MCost, type Market, type MarketPL, type PL, type Regime, type VatMode } from '../_lib/settlement';

interface Props {
  items: MCost[];
  amounts: Map<string, number>;
  ym: string;
  vat: 'ex' | 'incl';
  orderCounts: Partial<Record<Market, number>> | null;
  /** 비교용 전월 금액 */
  prevAmounts?: Map<string, number> | null;
  vats?: Map<string, VatMode>;
  prevVats?: Map<string, VatMode>;
  regime?: Regime;
  basis?: Basis;
}

const won = (n: number) => `${fmtNum(n)}원`;

/** 현재월 분석 — KPI, 손익 구조, 마켓별 공헌이익·ROAS */
export function AnalysisView({ items, amounts, ym, vat, orderCounts, prevAmounts, vats, prevVats, regime, basis }: Props) {
  const res = useMemo(() => buildPL(items, (it) => amounts.get(it.id) ?? 0, { vat, regime, basis, orderCounts: orderCounts ?? undefined, vatOf: (it) => vats?.get(it.id) }), [items, amounts, vat, regime, basis, orderCounts, vats]);
  const prev = useMemo(() => prevAmounts ? buildPL(items, (it) => prevAmounts.get(it.id) ?? 0, { vat, regime, basis, orderCounts: undefined, vatOf: (it) => prevVats?.get(it.id) }) : null, [items, prevAmounts, vat, regime, basis, prevVats]);
  const t = res.total;
  const inferredCount = res.leaves.filter(l => l.tags.inferred && l.value !== 0).length;

  if (amounts.size === 0) {
    return <div className="bg-card rounded-2xl p-8 text-center text-[13px] text-fg-4">{ym.replace('-', '.')} 저장된 시트가 없습니다. 입력 탭에서 저장하면 분석이 생성됩니다.</div>;
  }

  const pct = (v: number) => t.netRevenue ? (v / t.netRevenue) * 100 : null;
  const dl = (cur: number, key: keyof PL) => {
    if (!prev) return null;
    const p = prev.total[key];
    if (!p) return null;
    return ((cur - p) / Math.abs(p)) * 100;
  };

  const kpis: { label: string; value: number; sub?: string; key: keyof PL; hint?: string }[] = [
    { label: '실매출', value: t.netRevenue, key: 'netRevenue', sub: t.coupon ? `총매출 ${won(t.revenue)} − 쿠폰 ${won(t.coupon)}` : `총매출 ${won(t.revenue)}`, hint: '쿠팡 판매자 할인쿠폰은 마켓 매출에 잡히지만 실제 입금되지 않는 금액이라 차감합니다.' },
    { label: '매출총이익', value: t.grossProfit, key: 'grossProfit', sub: `원가율 ${fmtPct(pct(t.cogs))}` },
    { label: '공헌이익', value: t.contribution, key: 'contribution', sub: `공헌이익률 ${fmtPct(pct(t.contribution))}` },
    { label: '영업이익', value: t.operatingProfit, key: 'operatingProfit', sub: `영업이익률 ${fmtPct(pct(t.operatingProfit))}${t.taxEstimate ? ` · 간이 부가세 추정 ${won(t.taxEstimate)} 반영` : ''}`, hint: regime === 'simplified' ? '간이과세: 공급대가(VAT 포함) 기준. 부가세 추정 = 매출 × 1% − 세금계산서 매입 × 0.5%' : '일반과세: 공급가액(VAT 별도) 기준. 부가세는 통과 항목' },
  ];

  return (
    <div className="space-y-4">
      {inferredCount > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-[12px] text-fg-2">
          <AlertTriangle className="h-4 w-4 text-warn shrink-0 mt-0.5" />
          <div>
            금액이 있는 항목 {inferredCount}개의 분류·마켓이 라벨로 추론된 상태입니다. 분석 정확도를 위해{' '}
            <Link href="/settlement?tab=input" className="text-brand font-semibold hover:underline">입력 탭</Link>에서 점선 칩을 눌러 확정해 주세요.
          </div>
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(k => {
          const d = dl(k.value, k.key);
          return (
            <div key={k.label} className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4" title={k.hint}>
              <div className="text-[11px] font-semibold text-fg-4">{k.label}</div>
              <div className={cn('mt-1 text-[20px] font-bold tabular-nums tracking-tight', k.value < 0 ? 'text-danger' : 'text-fg')}>{won(k.value)}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-fg-4">
                <span className="truncate">{k.sub}</span>
                {d != null && <span className={cn('ml-auto shrink-0 font-semibold', d >= 0 ? 'text-success' : 'text-danger')}>{d >= 0 ? '+' : ''}{d.toFixed(0)}%</span>}
              </div>
            </div>
          );
        })}
      </div>

        {/* 마켓별 */}
      <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-4 md:px-5 py-3 border-b border-line-2">
            <h3 className="text-[15px] font-bold text-fg">마켓별 공헌이익 <span className="text-[11px] font-medium text-fg-4">시트 실적 기준</span></h3>
            <p className="text-[11px] text-fg-4 mt-0.5">손익분기 ROAS = 광고 전 공헌이익률의 역수. 실제 ROAS가 이보다 낮으면 광고가 이익을 깎고 있는 마켓입니다.</p>
          </div>
          <div className="overflow-x-auto">
            <MarketTable markets={res.markets} total={t} />
          </div>
          {orderCounts && Object.keys(orderCounts).length > 0 && (
            <p className="px-4 md:px-5 py-2 text-[11px] text-fg-4 border-t border-line-2">
              공통 물류비 건수 비례 배분 기준 출고 건수: {MARKETS.filter(m => orderCounts[m.id]).map(m => `${m.short} ${orderCounts[m.id]}건`).join(' · ')} (쿠팡 제외)
            </p>
          )}
        </section>
      <div className="grid lg:grid-cols-2 gap-4">
        {/* 손익 구조 */}
        <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 md:p-5">
          <h3 className="text-[15px] font-bold text-fg mb-3">손익 구조 <span className="text-[11px] font-medium text-fg-4">실매출 대비</span></h3>
          <div className="space-y-2">
            {PL_ROWS.filter(r => r.kind === 'minus' && r.key !== 'coupon').map(r => {
              const v = t[r.key];
              const p = pct(v) ?? 0;
              return (
                <div key={r.key} className="flex items-center gap-3 text-[12px]">
                  <span className="w-24 text-fg-2">{r.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-app overflow-hidden">
                    <div className={cn('h-full rounded-full', r.key === 'cogs' ? 'bg-warn' : r.key === 'ad' || r.key === 'marketing' ? 'bg-info' : r.key === 'fixed' || r.key === 'other' ? 'bg-fg-4' : 'bg-brand')} style={{ width: `${Math.min(100, Math.max(0, p))}%` }} />
                  </div>
                  <span className="w-12 text-right tabular-nums text-fg-3">{fmtPct(p)}</span>
                  <span className="w-24 text-right tabular-nums text-fg">{fmtNum(v)}</span>
                </div>
              );
            })}
            <div className="flex items-center gap-3 text-[12px] pt-2 border-t border-line-2 font-semibold">
              <span className="w-24 text-fg">영업이익</span>
              <div className="flex-1" />
              <span className={cn('w-12 text-right tabular-nums', t.operatingProfit < 0 ? 'text-danger' : 'text-success')}>{fmtPct(pct(t.operatingProfit))}</span>
              <span className={cn('w-24 text-right tabular-nums', t.operatingProfit < 0 ? 'text-danger' : 'text-success')}>{fmtNum(t.operatingProfit)}</span>
            </div>
          </div>
          {res.unallocated !== 0 && <p className="mt-3 text-[11px] text-warn">공통 비용 {won(res.unallocated)} 은 배분 대상 마켓 매출이 없어 마켓별 표에 반영되지 않았습니다.</p>}
        </section>

        {/* 공통·고정 */}
        <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 md:p-5">
        <h3 className="text-[15px] font-bold text-fg mb-2">마켓에 배분하지 않은 비용</h3>
        <div className="grid grid-cols-2 gap-3 text-[12px]">
          {[
            { label: '고정비', v: t.fixed },
            { label: '기타', v: t.other },
            { label: '부가세 (간이 추정)', v: t.taxEstimate },
            { label: '공통 물류 (배분 안 함)', v: res.common.logistics },
            { label: '공통 광고·마케팅', v: res.common.ad + res.common.marketing },
          ].map(x => (
            <div key={x.label} className="rounded-xl bg-card-2 px-3 py-2.5">
              <div className="text-[11px] text-fg-4">{x.label}</div>
              <div className="mt-0.5 font-semibold tabular-nums text-fg">{won(x.v)}</div>
            </div>
          ))}
        </div>
        </section>
      </div>
    </div>
  );
}

function MarketTable({ markets, total }: { markets: MarketPL[]; total: PL }) {
  if (markets.length === 0) return <p className="px-5 py-6 text-[12px] text-fg-4">마켓 태그가 붙은 매출 항목이 없습니다.</p>;
  const th = 'h-9 px-3 text-[11px] font-semibold text-fg-4 whitespace-nowrap';
  const td = 'px-3 py-2.5 tabular-nums text-right';
  return (
    <table className="w-full text-[12px] border-collapse min-w-[860px]">
      <thead>
        <tr className="border-b border-line">
          <th className={cn(th, 'text-left')}>마켓</th>
          <th className={cn(th, 'text-right')}>실매출</th>
          <th className={cn(th, 'text-right')}>비중</th>
          <th className={cn(th, 'text-right')}>원가</th>
          <th className={cn(th, 'text-right')}>수수료</th>
          <th className={cn(th, 'text-right')} title="직접 귀속 + 공통 배분">물류</th>
          <th className={cn(th, 'text-right')}>광고·마케팅</th>
          <th className={cn(th, 'text-right')} title="광고 전 공헌이익률">광고 전</th>
          <th className={cn(th, 'text-right')}>ROAS</th>
          <th className={cn(th, 'text-right')} title="손익분기 ROAS">손익분기</th>
          <th className={cn(th, 'text-right')}>공헌이익</th>
          <th className={cn(th, 'text-right')}>마진</th>
        </tr>
      </thead>
      <tbody>
        {markets.map(m => {
          const adBad = m.roas != null && m.beRoas != null && m.roas < m.beRoas;
          return (
            <tr key={m.market} className="border-b border-line-2 h-11">
              <td className="px-3 font-semibold text-fg whitespace-nowrap">{MARKETS.find(x => x.id === m.market)?.label}</td>
              <td className={cn(td, 'text-fg')}>{fmtNum(m.netRevenue)}{m.coupon ? <span className="block text-[10px] text-fg-5">쿠폰 −{fmtNum(m.coupon)}</span> : null}</td>
              <td className={cn(td, 'text-fg-3')}>{fmtPct(m.share)}</td>
              <td className={cn(td, 'text-fg-3')}>{fmtNum(m.cogs)}</td>
              <td className={cn(td, 'text-fg-3')}>{fmtNum(m.marketFee)}</td>
              <td className={cn(td, 'text-fg-3')}>{fmtNum(m.logistics)}{m.logisticsAlloc ? <span className="block text-[10px] text-fg-5">배분 {fmtNum(m.logisticsAlloc)}</span> : null}</td>
              <td className={cn(td, 'text-fg-3')}>{fmtNum(m.ad + m.marketing)}</td>
              <td className={cn(td, m.preAdMarginRate != null && m.preAdMarginRate < 0 ? 'text-danger' : 'text-fg-2')}>{fmtPct(m.preAdMarginRate)}</td>
              <td className={cn(td, 'font-semibold', adBad ? 'text-danger' : m.roas != null ? 'text-success' : 'text-fg-5')}>{m.roas == null ? '-' : `${m.roas.toFixed(0)}%`}</td>
              <td className={cn(td, 'text-fg-3')}>{m.beRoas == null ? '-' : `${m.beRoas.toFixed(0)}%`}</td>
              <td className={cn(td, 'font-semibold', m.contribution < 0 ? 'text-danger' : 'text-fg')}>{fmtNum(m.contribution)}</td>
              <td className={cn(td, 'font-semibold', m.margin == null ? 'text-fg-5' : m.margin < 0 ? 'text-danger' : m.margin < 10 ? 'text-warn' : 'text-success')}>{fmtPct(m.margin)}</td>
            </tr>
          );
        })}
        <tr className="bg-card-2 font-semibold h-11 border-t border-line">
          <td className="px-3 text-fg">합계</td>
          <td className={cn(td, 'text-fg')}>{fmtNum(total.netRevenue)}</td>
          <td className={td} />
          <td className={cn(td, 'text-fg-3')}>{fmtNum(total.cogs)}</td>
          <td className={cn(td, 'text-fg-3')}>{fmtNum(total.marketFee)}</td>
          <td className={cn(td, 'text-fg-3')}>{fmtNum(total.logistics)}</td>
          <td className={cn(td, 'text-fg-3')}>{fmtNum(total.ad + total.marketing)}</td>
          <td className={td} />
          <td className={cn(td, 'text-fg-3')}>{total.ad + total.marketing > 0 ? `${((total.netRevenue / (total.ad + total.marketing)) * 100).toFixed(0)}%` : '-'}</td>
          <td className={td} />
          <td className={cn(td, total.contribution < 0 ? 'text-danger' : 'text-fg')}>{fmtNum(total.contribution)}</td>
          <td className={cn(td, 'text-fg-3')}>{total.netRevenue ? fmtPct((total.contribution / total.netRevenue) * 100) : '-'}</td>
        </tr>
      </tbody>
    </table>
  );
}
