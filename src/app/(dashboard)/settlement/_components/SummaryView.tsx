'use client';

import { useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';
import { MARKETS, buildSeries, fmtNum, fmtPct, regimeFor, vatViewFor, type Basis, type MCost, type Snapshot } from '../_lib/settlement';
import { estimateIncomeTax, estimateVat } from '../_lib/taxEstimate';
import { useThemeColors } from '../_lib/useThemeColors';

/** 첫 화면 요약 — 올해 누적 매출·이익, 월별 흐름, 마켓 비중, 예상 세금을 한눈에 */
export function SummaryView({ items, snapshots, months, switchYm, ym, basis = 'actual', onGo }: { items: MCost[]; snapshots: Snapshot[]; months: string[]; switchYm: string; ym: string; basis?: Basis; onGo: (tab: 'input' | 'trend' | 'analysis' | 'products') => void }) {
  const c = useThemeColors();
  const year = ym.slice(0, 4);
  const yearMonths = useMemo(() => months.filter(m => m.startsWith(year)).sort(), [months, year]);
  const series = useMemo(() => buildSeries(items, snapshots, yearMonths, { vat: 'incl', vatFor: (m) => vatViewFor(regimeFor(m, switchYm)), regimeOf: (m) => regimeFor(m, switchYm), basis }), [items, snapshots, yearMonths, switchYm, basis]);
  const otherSeries = useMemo(() => buildSeries(items, snapshots, yearMonths, { vat: 'incl', vatFor: (m) => vatViewFor(regimeFor(m, switchYm)), regimeOf: (m) => regimeFor(m, switchYm), basis: basis === 'actual' ? 'accounting' : 'actual' }), [items, snapshots, yearMonths, switchYm, basis]);
  const otherProfit = otherSeries.reduce((s, x) => s + x.total.operatingProfit, 0);
  const seriesEx = useMemo(() => buildSeries(items, snapshots, yearMonths, { vat: 'ex' }), [items, snapshots, yearMonths]);
  const seriesIncl = useMemo(() => buildSeries(items, snapshots, yearMonths, { vat: 'incl' }), [items, snapshots, yearMonths]);

  const ytd = useMemo(() => {
    const t = { revenue: 0, netRevenue: 0, contribution: 0, operatingProfit: 0, ad: 0 };
    for (const s of series) { t.revenue += s.total.revenue; t.netRevenue += s.total.netRevenue; t.contribution += s.total.contribution; t.operatingProfit += s.total.operatingProfit; t.ad += s.total.ad + s.total.marketing; }
    return t;
  }, [series]);
  const ytdEx = seriesEx.reduce((s, x) => s + x.total.revenue, 0);
  const ytdIncl = seriesIncl.reduce((s, x) => s + x.total.revenue, 0);
  const last = series[series.length - 1]; const prev = series[series.length - 2];
  const mom = (k: 'netRevenue' | 'operatingProfit') => last && prev && prev.total[k] ? ((last.total[k] - prev.total[k]) / Math.abs(prev.total[k])) * 100 : null;

  // 마켓 비중 (연 누적)
  const marketAgg = useMemo(() => {
    const m = new Map<string, { rev: number; contrib: number }>();
    for (const s of series) for (const mk of s.markets) { const a = m.get(mk.market) ?? { rev: 0, contrib: 0 }; a.rev += mk.netRevenue; a.contrib += mk.contribution; m.set(mk.market, a); }
    return [...m.entries()].map(([id, v]) => ({ id, label: MARKETS.find(x => x.id === id)?.label ?? id, ...v })).sort((a, b) => b.rev - a.rev);
  }, [series]);
  const marketTotal = marketAgg.reduce((s, m) => s + m.rev, 0);

  const vat = useMemo(() => estimateVat(items, snapshots, Number(year), switchYm), [items, snapshots, year, switchYm]);
  const inc = useMemo(() => estimateIncomeTax(items, snapshots, Number(year), switchYm), [items, snapshots, year, switchYm]);
  const vatPayable = vat.reduce((s, p) => s + p.payable, 0);

  const chart = series.map(s => ({ ym: s.ym.slice(5) + '월', 실매출: s.total.netRevenue, 영업이익: s.total.operatingProfit, 공헌이익: s.total.contribution }));
  const yTick = (v: number) => Math.abs(v) >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : `${Math.round(v / 1e4)}만`;
  const won = (n: number) => `${fmtNum(n)}원`;
  const THRESHOLD = 300_000_000; const ratio = Math.min(100, (ytdEx / THRESHOLD) * 100);

  if (yearMonths.length === 0) return <div className="bg-card rounded-2xl p-8 text-center text-[13px] text-fg-4">{year}년 저장된 달이 없습니다. <button onClick={() => onGo('input')} className="text-brand font-semibold hover:underline">입력 탭</button>에서 시트를 저장하면 요약이 채워집니다.</div>;

  return (
    <div className="space-y-4">
      {/* 상단 KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label={`${year}년 누적 실매출`} value={won(ytd.netRevenue)} sub={`${yearMonths.length}개월 · 총매출 ${won(ytd.revenue)}`} />
        <Kpi label={`누적 영업이익 (${basis === 'accounting' ? '회계' : '실제'})`} value={won(ytd.operatingProfit)} sub={`${basis === 'accounting' ? '실제' : '회계'} 기준 ${won(otherProfit)} · 영업이익률 ${fmtPct(ytd.netRevenue ? (ytd.operatingProfit / ytd.netRevenue) * 100 : null)}`} tone={ytd.operatingProfit < 0 ? 'bad' : 'good'} />
        <Kpi label={`${last?.ym.replace('-', '.')} 실매출`} value={last ? won(last.total.netRevenue) : '-'} sub={mom('netRevenue') != null ? `전월 대비 ${mom('netRevenue')! >= 0 ? '+' : ''}${mom('netRevenue')!.toFixed(0)}%` : '전월 없음'} delta={mom('netRevenue')} />
        <Kpi label={`${last?.ym.replace('-', '.')} 영업이익`} value={last ? won(last.total.operatingProfit) : '-'} sub={mom('operatingProfit') != null ? `전월 대비 ${mom('operatingProfit')! >= 0 ? '+' : ''}${mom('operatingProfit')!.toFixed(0)}%` : '전월 없음'} delta={mom('operatingProfit')} tone={last && last.total.operatingProfit < 0 ? 'bad' : undefined} />
      </div>

      {/* 월별 차트 */}
      <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 md:p-5">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-[15px] font-bold text-fg mr-auto">{year}년 월별 매출과 이익 <span className="text-[11px] font-medium text-fg-4">간이 달은 VAT 포함 · 일반 달은 VAT 별도</span></h3>
          <button onClick={() => onGo('trend')} className="text-[12px] text-brand hover:underline">손익계산서 보기</button>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={c.line2} vertical={false} />
              <XAxis dataKey="ym" tick={{ fontSize: 11, fill: c.fg4 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={yTick} tick={{ fontSize: 10, fill: c.fg4 }} axisLine={false} tickLine={false} width={48} />
              <Tooltip formatter={((v: number) => won(v)) as any} contentStyle={{ fontSize: 12, borderRadius: 10, border: `1px solid ${c.line}`, background: c.card, color: c.fg }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="실매출" fill={c.brand} fillOpacity={0.25} stroke={c.brand} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="공헌이익" stroke={c.success} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="영업이익" stroke={c.fg} strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 마켓 비중 */}
        <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-[15px] font-bold text-fg mr-auto">마켓별 누적 <span className="text-[11px] font-medium text-fg-4">실매출 · 공헌이익</span></h3>
            <button onClick={() => onGo('analysis')} className="text-[12px] text-brand hover:underline">이 달 분석</button>
          </div>
          <div className="space-y-2">
            {marketAgg.map(m => (
              <div key={m.id} className="text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="w-20 font-semibold text-fg truncate">{m.label}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-app overflow-hidden"><div className="h-full rounded-full bg-brand" style={{ width: `${marketTotal ? (m.rev / marketTotal) * 100 : 0}%` }} /></div>
                  <span className="w-10 text-right text-fg-3 tabular-nums">{fmtPct(marketTotal ? (m.rev / marketTotal) * 100 : null, 0)}</span>
                  <span className="w-24 text-right tabular-nums text-fg">{fmtNum(m.rev)}</span>
                  <span className={cn('w-24 text-right tabular-nums font-semibold', m.contrib < 0 ? 'text-danger' : 'text-success')}>{fmtNum(m.contrib)}</span>
                </div>
              </div>
            ))}
            {marketAgg.length === 0 && <p className="text-[12px] text-fg-4">마켓 태그가 붙은 매출이 없습니다.</p>}
          </div>
        </section>

        {/* 세금·기준선 */}
        <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 md:p-5 space-y-3">
          <h3 className="text-[15px] font-bold text-fg">{year}년 예상 세금 <span className="text-[11px] font-medium text-fg-4">세무사 확인용</span></h3>
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div className="rounded-xl bg-card-2 px-3 py-2.5"><div className="text-[11px] text-fg-4">부가가치세 납부 예상</div><div className="mt-0.5 text-[16px] font-bold tabular-nums text-fg">{won(vatPayable)}</div><div className="text-[10px] text-fg-5">{vat.map(p => `${p.regime === 'simplified' ? '간이' : '일반'} ${won(p.payable)}`).join(' · ')}</div></div>
            <div className="rounded-xl bg-card-2 px-3 py-2.5"><div className="text-[11px] text-fg-4">종합소득세 예상 (지방세 포함)</div><div className="mt-0.5 text-[16px] font-bold tabular-nums text-fg">{won(inc.total)}</div><div className="text-[10px] text-fg-5">영업이익 {won(inc.profit)} · {inc.bracket} 구간 · 공제 미반영</div></div>
          </div>
          <div>
            <div className="flex items-center justify-between text-[11px] text-fg-3"><span>누적 매출(공급가액) {won(ytdEx)} <span className="text-fg-5">· VAT 포함 {won(ytdIncl)}</span></span><span className={cn('font-semibold', ytdEx >= THRESHOLD ? 'text-danger' : 'text-fg-3')}>{fmtPct(ratio, 0)} / 3억 (복식부기 기준)</span></div>
            <div className="mt-1 h-2 rounded-full bg-app overflow-hidden"><div className={cn('h-full rounded-full', ytdEx >= THRESHOLD ? 'bg-danger' : ratio > 80 ? 'bg-warn' : 'bg-brand')} style={{ width: `${ratio}%` }} /></div>
            <p className="mt-1 text-[10px] text-fg-5">도소매업은 전년 매출 3억 이상이면 다음 해 복식부기 의무. 넘기면 로그인 때 알림이 뜹니다.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, delta, tone }: { label: string; value: string; sub?: string; delta?: number | null; tone?: 'good' | 'bad' }) {
  return (
    <div className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
      <div className="text-[11px] font-semibold text-fg-4">{label}</div>
      <div className={cn('mt-1 text-[20px] font-bold tabular-nums tracking-tight', tone === 'bad' ? 'text-danger' : tone === 'good' ? 'text-success' : 'text-fg')}>{value}</div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-fg-4"><span className="truncate">{sub}</span>{delta != null && <span className={cn('ml-auto shrink-0 font-semibold', delta >= 0 ? 'text-success' : 'text-danger')}>{delta >= 0 ? '▲' : '▼'}</span>}</div>
    </div>
  );
}
