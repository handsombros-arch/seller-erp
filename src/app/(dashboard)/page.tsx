'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { formatCurrency, formatNumber, formatDate, skuOptionLabel } from '@/lib/utils';
import {
  Package, Warehouse, AlertTriangle, TrendingUp,
  PackageCheck, ArrowRight, Loader2, ChevronDown, X, Plus,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

interface DashboardData {
  stats: {
    totalSkus: number;
    totalStock: number;
    totalStockValue: number;
    needsReorderCount: number;
  };
  needsReorder: any[];
  pendingPOs: any[];
  recentInbound: any[];
  channelSales: Record<string, number>;
}

// ─── 판매 추이 차트 ──────────────────────────────────────────────────────────

const LINE_COLORS = ['#3182F6', '#FF6B00', '#1EC800', '#9B59B6', '#E74C3C', '#1ABC9C', '#F39C12', '#E91E63', '#00BCD4', '#FF5722'];

function nDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function fmtDateLabel(dateStr: string, unit: string) {
  if (unit === 'week') {
    const [, w] = dateStr.split('-W');
    return `${parseInt(w, 10)}주`;
  }
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

interface SkuOption { id: string; label: string; sku_code: string; }

function SalesTrendSection() {
  const [skuOptions, setSkuOptions] = useState<SkuOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [from, setFrom] = useState(nDaysAgo(29));
  const [to, setTo] = useState(nDaysAgo(0));
  const [unit, setUnit] = useState<'day' | 'week'>('day');
  const [chartData, setChartData] = useState<Record<string, any>[]>([]);
  const [skuInfo, setSkuInfo] = useState<Record<string, { sku_code: string; product_name: string; option_values: Record<string, string> }>>({});
  const [loading, setLoading] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // Load all SKUs for selection
  useEffect(() => {
    fetch('/api/products').then((r) => r.json()).then((products: any[]) => {
      const opts: SkuOption[] = [];
      for (const p of products ?? []) {
        for (const s of p.skus ?? []) {
          const optLabel = skuOptionLabel(s.option_values ?? {});
          opts.push({ id: s.id, sku_code: s.sku_code, label: `${p.name}${optLabel ? ' · ' + optLabel : ''}` });
        }
      }
      setSkuOptions(opts);
    });
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch trend data
  useEffect(() => {
    if (!selectedIds.length) { setChartData([]); return; }
    setLoading(true);
    const params = new URLSearchParams({ from, to, unit, sku_ids: selectedIds.join(',') });
    fetch(`/api/channel-sales/trends?${params}`)
      .then((r) => r.json())
      .then((d) => { setChartData(d.data ?? []); setSkuInfo(d.skus ?? {}); })
      .finally(() => setLoading(false));
  }, [selectedIds, from, to, unit]);

  function toggleSku(id: string) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function skuLabel(id: string) {
    const info = skuInfo[id];
    if (!info) return skuOptions.find((s) => s.id === id)?.label ?? id;
    const optLabel = skuOptionLabel(info.option_values);
    return `${info.product_name}${optLabel ? ' · ' + optLabel : ''}`;
  }

  return (
    <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="text-[14px] font-semibold text-[#191F28] tracking-[-0.02em]">판매 추이</h3>
          <p className="text-[12px] text-[#B0B8C1] mt-0.5">상품·옵션별 기간 판매량</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* 일별/주별 토글 */}
          <div className="flex rounded-xl border border-[#E5E8EB] overflow-hidden">
            {(['day', 'week'] as const).map((u) => (
              <button key={u} onClick={() => setUnit(u)}
                className={`h-8 px-3 text-[12.5px] font-medium transition-colors ${unit === u ? 'bg-[#3182F6] text-white' : 'bg-white text-[#6B7684] hover:bg-[#F2F4F6]'}`}>
                {u === 'day' ? '일별' : '주별'}
              </button>
            ))}
          </div>

          {/* 날짜 범위 */}
          <div className="flex items-center gap-1.5">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="h-8 px-2.5 rounded-xl border border-[#E5E8EB] text-[12.5px] text-[#191F28] focus:outline-none focus:border-[#3182F6]" />
            <span className="text-[12px] text-[#B0B8C1]">~</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="h-8 px-2.5 rounded-xl border border-[#E5E8EB] text-[12.5px] text-[#191F28] focus:outline-none focus:border-[#3182F6]" />
          </div>
        </div>
      </div>

      {/* SKU 선택 */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {selectedIds.map((id, idx) => (
          <span key={id} className="flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-full text-[12px] font-medium text-white"
            style={{ backgroundColor: LINE_COLORS[idx % LINE_COLORS.length] }}>
            {skuOptions.find((s) => s.id === id)?.label ?? id}
            <button onClick={() => toggleSku(id)} className="hover:opacity-70">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <div className="relative" ref={dropRef}>
          <button onClick={() => setDropOpen((v) => !v)}
            className="flex items-center gap-1 h-7 px-3 rounded-full border border-dashed border-[#B0B8C1] text-[12px] text-[#6B7684] hover:border-[#3182F6] hover:text-[#3182F6] transition-colors">
            <Plus className="h-3 w-3" /> 상품 추가
            <ChevronDown className="h-3 w-3" />
          </button>
          {dropOpen && (
            <div className="absolute left-0 top-9 z-30 w-72 max-h-64 overflow-y-auto bg-white rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] border border-[#F2F4F6]">
              {skuOptions.length === 0 ? (
                <p className="text-[13px] text-[#B0B8C1] text-center py-6">등록된 SKU 없음</p>
              ) : (
                <div className="p-2">
                  {skuOptions.map((s) => {
                    const sel = selectedIds.includes(s.id);
                    return (
                      <button key={s.id} onClick={() => toggleSku(s.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors ${sel ? 'bg-[#EBF1FE]' : 'hover:bg-[#F8F9FB]'}`}>
                        <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 ${sel ? 'bg-[#3182F6] border-[#3182F6]' : 'border-[#D0D5DD]'}`}>
                          {sel && <svg viewBox="0 0 12 10" className="w-2.5 h-2.5 fill-white"><path d="M1 5l3 3 7-7" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-[#191F28] truncate">{s.label}</p>
                          <p className="text-[11px] text-[#B0B8C1] font-mono">{s.sku_code}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 차트 */}
      {selectedIds.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40">
          <TrendingUp className="h-8 w-8 text-[#E5E8EB] mb-2" />
          <p className="text-[13px] text-[#B0B8C1]">위에서 상품을 선택하면 추이 그래프가 표시됩니다</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" />
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40">
          <p className="text-[13px] text-[#B0B8C1]">선택한 기간에 판매 데이터가 없습니다</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F6" />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => fmtDateLabel(v, unit)}
              tick={{ fontSize: 11, fill: '#B0B8C1' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#B0B8C1' }}
              tickLine={false}
              axisLine={false}
              width={32}
            />
            <Tooltip
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', fontSize: 12 }}
              labelFormatter={(v) => fmtDateLabel(String(v), unit)}
              formatter={(value: any, name: any) => [formatNumber(value) + '개', skuLabel(String(name))]}
            />
            <Legend
              formatter={(value) => <span style={{ fontSize: 12, color: '#6B7684' }}>{skuLabel(value)}</span>}
            />
            {selectedIds.map((id, idx) => (
              <Line
                key={id}
                type="monotone"
                dataKey={id}
                stroke={LINE_COLORS[idx % LINE_COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const stats = data?.stats;
  const statCards = [
    { label: '관리 SKU', value: formatNumber(stats?.totalSkus ?? 0), unit: '개', color: 'text-primary', bg: 'bg-[#EBF1FE]', icon: Package },
    { label: '총 재고 수량', value: formatNumber(stats?.totalStock ?? 0), unit: '개', color: 'text-[#1EC800]', bg: 'bg-green-50', icon: Warehouse },
    { label: '재고 원가 총액', value: formatCurrency(stats?.totalStockValue ?? 0), unit: '', color: 'text-[#FF6B00]', bg: 'bg-orange-50', icon: TrendingUp },
    { label: '발주 필요 SKU', value: formatNumber(stats?.needsReorderCount ?? 0), unit: '개', color: 'text-red-500', bg: 'bg-red-50', icon: AlertTriangle },
  ];

  return (
    <div className="space-y-5">
      <div className="pt-1">
        <h2 className="text-[20px] font-bold tracking-[-0.03em] text-foreground">대시보드</h2>
        <p className="mt-1 text-[13.5px] text-[#6B7684]">재고 현황과 발주 알림을 확인하세요</p>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center mb-3`}>
              <s.icon className={`h-[18px] w-[18px] ${s.color}`} strokeWidth={2.5} />
            </div>
            <p className="text-[11.5px] text-[#6B7684] font-medium mb-1">{s.label}</p>
            <div className="flex items-baseline gap-1">
              <span className={`text-[22px] font-bold tracking-[-0.04em] ${s.color}`}>{s.value}</span>
              {s.unit && <span className="text-[13px] text-[#B0B8C1] font-medium">{s.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* 판매 추이 그래프 */}
      <SalesTrendSection />

      <div className="grid md:grid-cols-2 gap-4">
        {/* 발주 필요 목록 */}
        <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div>
              <h3 className="text-[14px] font-semibold text-foreground tracking-[-0.02em]">발주 필요 SKU</h3>
              <p className="text-[12px] text-[#B0B8C1] mt-0.5">재고점 이하 도달</p>
            </div>
            <Link href="/forecast" className="flex items-center gap-1 text-[12.5px] text-primary font-medium">
              전체 <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {(data?.needsReorder ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="w-12 h-12 rounded-2xl bg-[#F2F4F6] flex items-center justify-center mb-3">
                <Package className="h-5 w-5 text-[#B0B8C1]" />
              </div>
              <p className="text-[13px] text-[#B0B8C1]">발주 필요 항목 없음</p>
            </div>
          ) : (
            <div className="divide-y divide-[#F2F4F6]">
              {(data?.needsReorder ?? []).map((sku: any) => {
                const total = (sku.inventory ?? []).reduce((s: number, i: any) => s + (i.quantity ?? 0), 0);
                return (
                  <div key={sku.id} className="flex items-center justify-between px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-foreground truncate">{sku.product?.name}</p>
                      <p className="text-[12px] text-[#6B7684] mt-0.5">{sku.sku_code} · {skuOptionLabel(sku.option_values ?? {})}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <span className="text-[15px] font-bold text-red-500 tabular-nums">{formatNumber(total)}</span>
                      <p className="text-[11px] text-[#B0B8C1]">발주점 {formatNumber(sku.reorder_point)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 진행 중 발주서 */}
        <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div>
              <h3 className="text-[14px] font-semibold text-foreground tracking-[-0.02em]">진행 중 발주</h3>
              <p className="text-[12px] text-[#B0B8C1] mt-0.5">입고 예정 발주서</p>
            </div>
            <Link href="/inbound" className="flex items-center gap-1 text-[12.5px] text-primary font-medium">
              전체 <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {(data?.pendingPOs ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="w-12 h-12 rounded-2xl bg-[#F2F4F6] flex items-center justify-center mb-3">
                <PackageCheck className="h-5 w-5 text-[#B0B8C1]" />
              </div>
              <p className="text-[13px] text-[#B0B8C1]">진행 중인 발주 없음</p>
            </div>
          ) : (
            <div className="divide-y divide-[#F2F4F6]">
              {(data?.pendingPOs ?? []).map((po: any) => {
                const statusMap: Record<string, { label: string; color: string }> = {
                  ordered: { label: '발주완료', color: 'bg-blue-50 text-blue-600' },
                  partial: { label: '부분입고', color: 'bg-amber-50 text-amber-600' },
                };
                const s = statusMap[po.status] ?? { label: po.status, color: 'bg-gray-100 text-gray-600' };
                return (
                  <div key={po.id} className="flex items-center justify-between px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-foreground">{po.po_number}</p>
                      <p className="text-[12px] text-[#6B7684] mt-0.5">
                        {po.supplier ?? '공급사 미지정'} · 입고예정 {po.expected_date ? formatDate(po.expected_date) : '-'}
                      </p>
                    </div>
                    <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${s.color}`}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 채널별 이번 달 출고 */}
      {Object.keys(data?.channelSales ?? {}).length > 0 && (
        <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <h3 className="text-[14px] font-semibold text-foreground tracking-[-0.02em] mb-4">이번 달 채널별 출고</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Object.entries(data?.channelSales ?? {}).map(([ch, qty]) => (
              <div key={ch} className="rounded-xl bg-[#F2F4F6] p-4 text-center">
                <p className="text-[12px] text-[#6B7684] font-medium">{ch}</p>
                <p className="text-[22px] font-bold text-foreground tracking-[-0.03em] mt-1">{formatNumber(qty)}</p>
                <p className="text-[11px] text-[#B0B8C1]">개</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 바로가기 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { href: '/products',  icon: Package,      label: '상품 관리',  desc: 'SKU · 원가 설정',    color: 'text-primary',    bg: 'bg-[#EBF1FE]' },
          { href: '/inventory', icon: Warehouse,    label: '재고 현황',  desc: '창고별 재고 조회',    color: 'text-green-600',  bg: 'bg-green-50' },
          { href: '/inbound',   icon: PackageCheck, label: '입고 관리',  desc: '발주 · 입고 처리',    color: 'text-[#FF6B00]',  bg: 'bg-orange-50' },
          { href: '/forecast',  icon: TrendingUp,   label: '재고 예측',  desc: '소진일 · 발주 타이밍', color: 'text-purple-600', bg: 'bg-purple-50' },
        ].map((item) => (
          <Link key={item.href} href={item.href}>
            <div className="bg-white rounded-2xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)] transition-shadow cursor-pointer">
              <div className={`w-9 h-9 rounded-xl ${item.bg} flex items-center justify-center mb-3`}>
                <item.icon className={`h-[18px] w-[18px] ${item.color}`} strokeWidth={2.5} />
              </div>
              <p className="text-[13px] font-semibold text-foreground">{item.label}</p>
              <p className="text-[11.5px] text-[#B0B8C1] mt-0.5 leading-relaxed">{item.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
