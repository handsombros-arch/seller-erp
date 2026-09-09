'use client';

import { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SegmentedControl } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { PL_ROWS, buildSeries, fmtNum, vatViewFor, type Basis, type MCost, type PL, type Regime, type Snapshot } from '../_lib/settlement';
import { useThemeColors } from '../_lib/useThemeColors';

interface Props { items: MCost[]; snapshots: Snapshot[]; months: string[]; vat: 'ex' | 'incl'; currentYm: string; loading?: boolean; vatFor?: (ym: string) => 'ex' | 'incl'; regimeOf?: (ym: string) => Regime; basis?: Basis }

const RANGE = [{ value: '6', label: '6개월' }, { value: '12', label: '12개월' }, { value: 'all', label: '전체' }] as const;
const MODE = [{ value: 'amount', label: '금액' }, { value: 'ratio', label: '매출 대비 %' }] as const;
const REGIME = [{ value: 'auto', label: '자동(전환월)' }, { value: 'simplified', label: '전부 간이' }, { value: 'general', label: '전부 일반' }] as const;

/** 월별 추이 — 손익계산서 형식. 열 = 월, 행 = 손익 라인. */
export function TrendPL({ items, snapshots, months, vat, currentYm, loading, vatFor, regimeOf, basis }: Props) {
  const [range, setRange] = useState<'6' | '12' | 'all'>('12');
  const [mode, setMode] = useState<'amount' | 'ratio'>('amount');
  const [includeCurrent, setIncludeCurrent] = useState(false);
  const [regimeMode, setRegimeMode] = useState<'auto' | 'simplified' | 'general'>('auto');
  const regimeOfEff = regimeMode === 'auto' ? regimeOf : (() => regimeMode as Regime);
  const vatForEff = regimeMode === 'auto' ? vatFor : (() => vatViewFor(regimeMode as Regime));
  const c = useThemeColors();

  const cols = useMemo(() => {
    const asc = [...months].sort();
    const filtered = includeCurrent ? asc : asc.filter(m => m !== currentYm);
    return range === 'all' ? filtered : filtered.slice(-Number(range));
  }, [months, range, includeCurrent, currentYm]);

  const series = useMemo(() => buildSeries(items, snapshots, cols, { vat, vatFor: vatForEff, regimeOf: regimeOfEff, basis }), [items, snapshots, cols, vat, vatForEff, regimeOfEff, basis]);

  const cell = (p: PL, key: keyof PL) => {
    const v = p[key];
    if (mode === 'ratio') {
      if (key === 'revenue' || key === 'coupon') return p.revenue ? `${((v / p.revenue) * 100).toFixed(1)}%` : '-';
      return p.netRevenue ? `${((v / p.netRevenue) * 100).toFixed(1)}%` : '-';
    }
    return v === 0 ? <span className="text-fg-5">-</span> : fmtNum(v);
  };
  const delta = (key: keyof PL) => {
    if (series.length < 2) return null;
    const a = series[series.length - 2].total[key], b = series[series.length - 1].total[key];
    if (!a) return null;
    return ((b - a) / Math.abs(a)) * 100;
  };

  const chartData = series.map(s => ({ ym: s.ym.slice(2).replace('-', '.'), 실매출: s.total.netRevenue, 공헌이익: s.total.contribution, 영업이익: s.total.operatingProfit, 광고비: s.total.ad + s.total.marketing }));
  const yTick = (v: number) => Math.abs(v) >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : Math.abs(v) >= 1e4 ? `${Math.round(v / 1e4)}만` : String(v);

  if (loading) {
    return <div className="bg-card rounded-2xl p-8 text-center text-[13px] text-fg-4">불러오는 중…</div>;
  }
  if (cols.length === 0) {
    return <div className="bg-card rounded-2xl p-8 text-center text-[13px] text-fg-4">저장된 월이 없습니다. 입력 탭에서 월을 저장하면 여기에 쌓입니다.</div>;
  }

  return (
    <div className="space-y-4">
      <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h3 className="text-[15px] font-bold text-fg mr-auto">월별 손익 추이</h3>
          <label className="flex items-center gap-1.5 text-[12px] text-fg-3 cursor-pointer select-none">
            <input type="checkbox" checked={includeCurrent} onChange={e => setIncludeCurrent(e.target.checked)} className="accent-brand" />
            진행 중인 달 포함
          </label>
          <SegmentedControl items={RANGE} value={range} onChange={setRange} />
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={c.line2} vertical={false} />
              <XAxis dataKey="ym" tick={{ fontSize: 11, fill: c.fg4 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={yTick} tick={{ fontSize: 10, fill: c.fg4 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip formatter={((v: number) => `${fmtNum(v)}원`) as any} contentStyle={{ fontSize: 12, borderRadius: 10, border: `1px solid ${c.line}`, background: c.card, color: c.fg }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="실매출" fill={c.brand} fillOpacity={0.25} stroke={c.brand} radius={[4, 4, 0, 0]} />
              <Bar dataKey="광고비" fill={c.info} fillOpacity={0.7} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="공헌이익" stroke={c.success} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="영업이익" stroke={c.fg} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="flex items-center gap-2 px-4 md:px-5 py-3 border-b border-line-2">
          <h3 className="text-[15px] font-bold text-fg mr-auto">손익계산서 <span className="text-[11px] font-medium text-fg-4 ml-1">간이 = VAT 포함(공급대가)+부가세 추정 · 일반 = VAT 별도(공급가액) · 원</span></h3>
          <SegmentedControl items={REGIME} value={regimeMode} onChange={setRegimeMode} />
          <SegmentedControl items={MODE} value={mode} onChange={setMode} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse min-w-[640px]">
            <thead>
              <tr className="h-9 text-[11px] font-semibold text-fg-4 border-b border-line">
                <th className="text-left px-4 sticky left-0 bg-card">항목</th>
                {series.map(s => <th key={s.ym} className={cn('text-right px-3 tabular-nums whitespace-nowrap', s.ym === currentYm && 'text-brand')} title={regimeOfEff ? (regimeOfEff(s.ym) === 'general' ? '일반과세 · VAT 별도' : '간이과세 · VAT 포함') : ''}>{s.ym.replace('-', '.')}{regimeOfEff && <span className="block text-[9px] font-normal text-fg-5">{regimeOfEff(s.ym) === 'general' ? '일반' : '간이'}</span>}{s.ym === currentYm && ' (진행)'}</th>)}
                <th className="text-right px-3 whitespace-nowrap">전월비</th>
              </tr>
            </thead>
            <tbody>
              {PL_ROWS.map(row => {
                const d = delta(row.key);
                const strong = row.kind === 'subtotal' || row.kind === 'result';
                return (
                  <tr key={row.key} className={cn('border-b border-line-2', strong && 'bg-card-2 font-semibold', row.kind === 'result' && 'border-t-2 border-line')}>
                    <td className={cn('px-4 py-2 sticky left-0 whitespace-nowrap', strong ? 'bg-card-2 text-fg' : 'bg-card text-fg-2', row.indent && 'pl-7')}>{row.label}</td>
                    {series.map(s => {
                      const v = s.total[row.key];
                      return <td key={s.ym} className={cn('px-3 py-2 text-right tabular-nums', row.kind === 'minus' && 'text-fg-3', strong && v < 0 && 'text-danger', row.kind === 'result' && v > 0 && 'text-success')}>{cell(s.total, row.key)}</td>;
                    })}
                    <td className={cn('px-3 py-2 text-right tabular-nums text-[11px]', d == null ? 'text-fg-5' : (row.kind === 'minus' ? (d > 0 ? 'text-danger' : 'text-success') : (d > 0 ? 'text-success' : 'text-danger')))}>{d == null ? '-' : `${d > 0 ? '+' : ''}${d.toFixed(0)}%`}</td>
                  </tr>
                );
              })}
              <tr className="text-[11px] text-fg-4">
                <td className="px-4 py-2 sticky left-0 bg-card">공헌이익률 / 영업이익률</td>
                {series.map(s => (
                  <td key={s.ym} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {s.total.netRevenue ? `${((s.total.contribution / s.total.netRevenue) * 100).toFixed(1)}% / ${((s.total.operatingProfit / s.total.netRevenue) * 100).toFixed(1)}%` : '-'}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="px-4 md:px-5 py-2.5 text-[11px] text-fg-4 border-t border-line-2">공헌이익 = 실매출 − 원가 − 마켓 수수료 − 물류·배송 − 광고·마케팅. 영업이익 = 공헌이익 − 고정비 − 기타. 항목 분류는 입력 탭의 분류·마켓 태그를 따릅니다.</p>
      </section>
    </div>
  );
}
