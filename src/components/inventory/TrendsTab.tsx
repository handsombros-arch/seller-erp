'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatNumber } from '@/lib/utils';
import { Loader2, BarChart3 } from 'lucide-react';
import {
  ComposedChart, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';

interface TrendPoint {
  period: string;
  coupang_qty: number;
  warehouse_qty: number;
  total_qty: number;
  sales_qty: number;
  order_count: number;
}

type Unit = 'day' | 'week' | 'month';

function formatPeriod(period: string, unit: Unit) {
  if (unit === 'week') return period;
  if (unit === 'month') return period;
  return period.slice(5);
}

const UNIT_LABELS: Record<Unit, string> = { day: '일별', week: '주별', month: '월별' };
const DAYS_OPTIONS = [30, 60, 90, 180];

export default function TrendsTab() {
  const [data, setData] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [unit, setUnit] = useState<Unit>('day');
  const [days, setDays] = useState(90);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/trends/inventory-sales?unit=${unit}&days=${days}`);
      const json = await res.json();
      setData(Array.isArray(json.data) ? json.data : []);
    } catch { setData([]); }
    setLoading(false);
  }, [unit, days]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    if (data.length === 0) return null;
    const latest = data[data.length - 1];
    const totalSales = data.reduce((s, d) => s + d.sales_qty, 0);
    const totalOrders = data.reduce((s, d) => s + d.order_count, 0);
    const avgDailySales = unit === 'day' && data.length > 0 ? Math.round(totalSales / data.length * 10) / 10 : null;
    return { latest, totalSales, totalOrders, avgDailySales };
  }, [data, unit]);

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: '쿠팡 재고', value: formatNumber(summary.latest.coupang_qty), sub: '현재' },
            { label: '창고 재고', value: formatNumber(summary.latest.warehouse_qty), sub: '현재' },
            { label: '총 판매', value: formatNumber(summary.totalSales) + '개', sub: `최근 ${days}일` },
            { label: unit === 'day' ? '일평균 판매' : '총 주문', value: summary.avgDailySales !== null ? `${summary.avgDailySales}개` : formatNumber(summary.totalOrders) + '건', sub: unit === 'day' ? `${data.length}일 평균` : `최근 ${days}일` },
          ].map((card, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-5 py-4">
              <p className="text-[12px] text-[#6B7684] font-medium">{card.label}</p>
              <p className="text-[22px] font-bold text-[#191F28] mt-1 tabular-nums">{card.value}</p>
              <p className="text-[11px] text-[#B0B8C1] mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          {(['day', 'week', 'month'] as Unit[]).map((u) => (
            <button key={u} onClick={() => setUnit(u)}
              className={`h-8 px-3 rounded-xl text-[12.5px] font-medium transition-colors ${unit === u ? 'bg-[#3182F6] text-white' : 'bg-white border border-[#E5E8EB] text-[#6B7684] hover:bg-[#F2F4F6]'}`}>
              {UNIT_LABELS[u]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {DAYS_OPTIONS.map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`h-8 px-3 rounded-xl text-[12.5px] font-medium transition-colors ${days === d ? 'bg-[#191F28] text-white' : 'bg-white border border-[#E5E8EB] text-[#6B7684] hover:bg-[#F2F4F6]'}`}>
              {d}일
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" /></div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <BarChart3 className="h-10 w-10 text-[#B0B8C1] mb-3" />
            <p className="text-[14px] text-[#6B7684]">데이터가 없습니다</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F6" />
              <XAxis dataKey="period" tickFormatter={(v) => formatPeriod(v, unit)} tick={{ fontSize: 11, fill: '#6B7684' }} axisLine={{ stroke: '#E5E8EB' }} tickLine={false} />
              <YAxis yAxisId="qty" tick={{ fontSize: 11, fill: '#6B7684' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
              <YAxis yAxisId="sales" orientation="right" tick={{ fontSize: 11, fill: '#3182F6' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E5E8EB', fontSize: 12 }} formatter={((value: number, name: string) => { const l: Record<string, string> = { coupang_qty: '쿠팡 재고', warehouse_qty: '창고 재고', sales_qty: '판매량' }; return [formatNumber(value) + '개', l[name] ?? name]; }) as any} labelFormatter={(label) => formatPeriod(String(label), unit)} />
              <Legend formatter={(value: string) => { const l: Record<string, string> = { coupang_qty: '쿠팡 재고', warehouse_qty: '창고 재고', sales_qty: '판매량' }; return l[value] ?? value; }} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Area yAxisId="qty" type="monotone" dataKey="coupang_qty" fill="#FF6B0020" stroke="#FF6B00" strokeWidth={2} dot={false} />
              <Area yAxisId="qty" type="monotone" dataKey="warehouse_qty" fill="#10B98120" stroke="#10B981" strokeWidth={2} dot={false} />
              <Bar yAxisId="sales" dataKey="sales_qty" fill="#3182F6" radius={[3, 3, 0, 0]} maxBarSize={unit === 'day' ? 12 : 24} opacity={0.7} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {!loading && data.length > 0 && (
        <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[#F2F4F6]">
            <span className="text-[13px] font-semibold text-[#191F28]">{UNIT_LABELS[unit]} 상세</span>
            <span className="text-[12px] text-[#B0B8C1] ml-2">{data.length}개 기간</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8F9FB] border-b border-[#F2F4F6]">
                  {['기간', '쿠팡 재고', '창고 재고', '합계', '판매량', '주문수'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[12px] font-semibold text-[#6B7684] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F4F6]">
                {[...data].reverse().map((d) => (
                  <tr key={d.period} className="hover:bg-[#FAFAFA]">
                    <td className="px-4 py-2.5 text-[13px] font-medium text-[#191F28] whitespace-nowrap">{formatPeriod(d.period, unit)}</td>
                    <td className="px-4 py-2.5 text-[13px] text-[#FF6B00] tabular-nums">{formatNumber(d.coupang_qty)}</td>
                    <td className="px-4 py-2.5 text-[13px] text-emerald-600 tabular-nums">{formatNumber(d.warehouse_qty)}</td>
                    <td className="px-4 py-2.5 text-[13px] font-semibold text-[#191F28] tabular-nums">{formatNumber(d.total_qty)}</td>
                    <td className="px-4 py-2.5 text-[13px] text-[#3182F6] tabular-nums">{d.sales_qty > 0 ? formatNumber(d.sales_qty) : '-'}</td>
                    <td className="px-4 py-2.5 text-[13px] text-[#6B7684] tabular-nums">{d.order_count > 0 ? formatNumber(d.order_count) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
