'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import { Loader2, Plus, X } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Order {
  id: string; channel: string; order_date: string;
  product_name: string; quantity: number;
  sku?: { product: { name: string } } | null;
}

interface PlatformSkuEntry {
  platform_product_name: string;
  channel: { type: string } | null;
  sku: { product: { name: string } } | null;
}

type Granularity = 'daily' | 'weekly' | 'monthly';
type GroupBy    = 'channel' | 'product';
type Metric     = 'count' | 'quantity';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNEL_LABELS: Record<string, string> = {
  smartstore: '스마트스토어',
  toss:        '토스',
  coupang:     '쿠팡(직배)',
  coupang_rg:  '쿠팡(그로스)',
  other:       '기타',
};

const COLORS = [
  '#3182F6', '#F97316', '#10B981', '#8B5CF6',
  '#F43F5E', '#EAB308', '#06B6D4', '#84CC16',
];

const QUICK_RANGES = [
  { label: '7일',  days: 7 },
  { label: '30일', days: 30 },
  { label: '90일', days: 90 },
  { label: '180일', days: 180 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  const wn = 1 + Math.round(((d.getTime() - w1.getTime()) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(wn).padStart(2, '0')}`;
}

function bucketKey(dateStr: string, gran: Granularity): string {
  if (gran === 'daily')   return dateStr;
  if (gran === 'monthly') return dateStr.slice(0, 7);
  return isoWeekKey(dateStr);
}

function formatLabel(key: string, gran: Granularity): string {
  if (gran === 'monthly') {
    const [y, m] = key.split('-');
    return `${y}.${m}`;
  }
  if (gran === 'weekly') {
    const [y, w] = key.split('-W');
    return `${y}년 ${Number(w)}주`;
  }
  return key.slice(5).replace('-', '/');
}

function daysAgo(n: number): string {
  return new Date(Date.now() - (n - 1) * 86400000).toISOString().slice(0, 10);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrdersChartTab() {
  const today = new Date().toISOString().slice(0, 10);

  const [orders,       setOrders]       = useState<Order[]>([]);
  const [platformSkus, setPlatformSkus] = useState<PlatformSkuEntry[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [granularity,  setGranularity]  = useState<Granularity>('weekly');
  const [groupBy,      setGroupBy]      = useState<GroupBy>('channel');
  const [metric,       setMetric]       = useState<Metric>('count');
  const [dateFrom,     setDateFrom]     = useState(daysAgo(90));
  const [dateTo,       setDateTo]       = useState(today);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [productSearch, setProductSearch] = useState('');
  const [productDropOpen, setProductDropOpen] = useState(false);

  // platform_skus: platform_product_name+channel → master product name
  const platformSkuMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ps of platformSkus) {
      if (ps.platform_product_name && ps.channel?.type && ps.sku?.product?.name)
        map.set(`${ps.platform_product_name.toLowerCase()}|${ps.channel.type}`, ps.sku.product.name);
    }
    return map;
  }, [platformSkus]);

  function resolveAdminName(o: Order): string {
    if (o.sku?.product?.name) return o.sku.product.name;
    const channelType = o.channel === 'coupang_direct' ? 'coupang' : o.channel;
    return platformSkuMap.get(`${o.product_name.toLowerCase()}|${channelType}`) ?? o.product_name;
  }

  useEffect(() => {
    fetch('/api/platform-skus')
      .then((r) => r.json())
      .then((d) => setPlatformSkus(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    const params = new URLSearchParams({ from: dateFrom, to: dateTo });
    fetch(`/api/channel-orders?${params}`)
      .then((r) => r.json())
      .then((d) => setOrders(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  // ─── 채널/상품 옵션 ─────────────────────────────────────────────────────────

  const channelOptions = useMemo(() => {
    const set = new Set(orders.map(o => o.channel));
    return [...set].map(ch => ({ value: ch, label: CHANNEL_LABELS[ch] ?? ch }));
  }, [orders]);

  const productOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of orders) {
      const name = resolveAdminName(o);
      counts.set(name, (counts.get(name) ?? 0) + (o.quantity ?? 1));
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, qty]) => ({ name, qty }));
  }, [orders, platformSkuMap]);

  const filteredOrders = useMemo(() => {
    let result = orders;
    if (selectedChannels.size > 0) result = result.filter(o => selectedChannels.has(o.channel));
    if (selectedProducts.size > 0) result = result.filter(o => selectedProducts.has(resolveAdminName(o)));
    return result;
  }, [orders, selectedChannels, selectedProducts, platformSkuMap]);

  // ─── 데이터 집계 ────────────────────────────────────────────────────────────

  const { chartData, seriesKeys } = useMemo(() => {
    const bucketSet = new Set<string>();
    const groupSet  = new Set<string>();
    const countMap  = new Map<string, Map<string, number>>();

    for (const o of filteredOrders) {
      const bk = bucketKey(o.order_date, granularity);
      bucketSet.add(bk);

      const gk = groupBy === 'channel'
        ? (CHANNEL_LABELS[o.channel] ?? o.channel)
        : resolveAdminName(o);
      groupSet.add(gk);

      if (!countMap.has(bk)) countMap.set(bk, new Map());
      const m   = countMap.get(bk)!;
      const val = metric === 'count' ? 1 : (o.quantity ?? 0);
      m.set(gk, (m.get(gk) ?? 0) + val);
    }

    // 상품별일 때 상위 7개만 (꺾은선 가독성)
    let seriesKeys = [...groupSet];
    if (groupBy === 'product' && seriesKeys.length > 7) {
      const totals = new Map<string, number>();
      for (const m of countMap.values())
        for (const [g, v] of m) totals.set(g, (totals.get(g) ?? 0) + v);
      seriesKeys = [...seriesKeys]
        .sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))
        .slice(0, 7);
    }

    const sortedBuckets = [...bucketSet].sort();
    const chartData = sortedBuckets.map((bk) => {
      const row: Record<string, any> = { period: formatLabel(bk, granularity) };
      for (const key of seriesKeys) row[key] = countMap.get(bk)?.get(key) ?? 0;
      return row;
    });

    return { chartData, seriesKeys };
  }, [filteredOrders, granularity, groupBy, metric]);

  // ─── UI helpers ─────────────────────────────────────────────────────────────

  const seg = (active: boolean) =>
    `h-8 px-3 rounded-lg text-[12px] font-medium transition-colors ${
      active ? 'bg-[#3182F6] text-white' : 'bg-[#F2F4F6] text-[#6B7684] hover:bg-[#E5E8EB]'
    }`;

  const totalOrders  = filteredOrders.length;
  const totalQty     = filteredOrders.reduce((s, o) => s + (o.quantity ?? 0), 0);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[15px] font-bold text-[#191F28]">주문 분석</h3>
        <p className="text-[13px] text-[#6B7684] mt-0.5">채널·상품별 주문 추이를 비교합니다</p>
      </div>

      {/* ── 컨트롤 바 ───────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-5 py-4 space-y-3">

        {/* 날짜 */}
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6]" />
          <span className="text-[12px] text-[#B0B8C1]">~</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6]" />

          {/* 빠른 범위 */}
          <div className="flex items-center gap-1 ml-1">
            {QUICK_RANGES.map(({ label, days }) => (
              <button key={label}
                onClick={() => { setDateFrom(daysAgo(days)); setDateTo(today); }}
                className="h-8 px-2.5 rounded-lg text-[12px] font-medium bg-[#F2F4F6] text-[#6B7684] hover:bg-[#E5E8EB] transition-colors">
                {label}
              </button>
            ))}
          </div>

          {/* 요약 */}
          {!loading && orders.length > 0 && (
            <div className="ml-auto flex items-center gap-3 text-[12px] text-[#6B7684]">
              <span>총 <strong className="text-[#191F28]">{totalOrders.toLocaleString()}</strong>건</span>
              <span>수량 <strong className="text-[#191F28]">{totalQty.toLocaleString()}</strong>개</span>
            </div>
          )}
        </div>

        {/* 세그먼트 컨트롤 */}
        <div className="flex items-center gap-4 flex-wrap">
          {/* 단위 */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-[#B0B8C1] mr-1">단위</span>
            {(['daily', 'weekly', 'monthly'] as const).map((g) => (
              <button key={g} onClick={() => setGranularity(g)} className={seg(granularity === g)}>
                {g === 'daily' ? '일별' : g === 'weekly' ? '주별' : '월별'}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-[#E5E8EB]" />

          {/* 그룹 */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-[#B0B8C1] mr-1">비교</span>
            <button onClick={() => setGroupBy('channel')} className={seg(groupBy === 'channel')}>채널별</button>
            <button onClick={() => setGroupBy('product')} className={seg(groupBy === 'product')}>상품별</button>
          </div>

          <div className="w-px h-5 bg-[#E5E8EB]" />

          {/* 지표 */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-[#B0B8C1] mr-1">지표</span>
            <button onClick={() => setMetric('count')}    className={seg(metric === 'count')}>건수</button>
            <button onClick={() => setMetric('quantity')} className={seg(metric === 'quantity')}>수량</button>
          </div>
        </div>

        {/* 채널 필터 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-[#B0B8C1] shrink-0">채널</span>
          <button onClick={() => setSelectedChannels(new Set())}
            className={seg(selectedChannels.size === 0)}>전체</button>
          {channelOptions.map((ch) => (
            <button key={ch.value} onClick={() => setSelectedChannels((prev) => {
              const next = new Set(prev);
              next.has(ch.value) ? next.delete(ch.value) : next.add(ch.value);
              return next;
            })} className={seg(selectedChannels.has(ch.value))}>
              {ch.label}
            </button>
          ))}
        </div>

        {/* 상품 필터 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-[#B0B8C1] shrink-0">상품</span>
          <button onClick={() => setSelectedProducts(new Set())}
            className={seg(selectedProducts.size === 0)}>전체</button>
          {/* 선택된 상품 태그 */}
          {[...selectedProducts].map((name) => (
            <button key={name} onClick={() => setSelectedProducts((prev) => { const n = new Set(prev); n.delete(name); return n; })}
              className="h-8 px-3 rounded-lg text-[12px] font-medium bg-[#3182F6] text-white flex items-center gap-1 max-w-[180px]">
              <span className="truncate">{name}</span>
              <X className="h-3 w-3 shrink-0" />
            </button>
          ))}
          {/* 추가 드롭다운 */}
          <div className="relative">
            <button onClick={() => { setProductDropOpen(v => !v); setProductSearch(''); }}
              className="h-8 px-3 rounded-lg text-[12px] font-medium bg-[#F2F4F6] text-[#6B7684] hover:bg-[#E5E8EB] flex items-center gap-1">
              <Plus className="h-3 w-3" /> 상품 선택
            </button>
            {productDropOpen && (
              <div className="absolute left-0 top-9 z-30 w-80 bg-white rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] border border-[#F2F4F6]">
                <div className="p-2 border-b border-[#F2F4F6]">
                  <input autoFocus value={productSearch} onChange={e => setProductSearch(e.target.value)}
                    placeholder="상품명 검색..."
                    className="w-full h-8 px-3 text-[12px] rounded-lg border border-[#E5E8EB] outline-none focus:border-[#3182F6]" />
                </div>
                <div className="max-h-[20rem] overflow-y-auto p-1">
                  {productOptions
                    .filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()))
                    .slice(0, 30)
                    .map((p) => {
                      const sel = selectedProducts.has(p.name);
                      return (
                        <button key={p.name} onClick={() => {
                          setSelectedProducts(prev => { const n = new Set(prev); sel ? n.delete(p.name) : n.add(p.name); return n; });
                        }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${sel ? 'bg-[#EBF1FE]' : 'hover:bg-[#F8F9FB]'}`}>
                          <span className="text-[13px] text-[#191F28] truncate">{p.name}</span>
                          <span className="text-[11px] text-[#B0B8C1] shrink-0 ml-2 tabular-nums">{p.qty.toLocaleString()}개</span>
                        </button>
                      );
                    })}
                </div>
                <div className="p-2 border-t border-[#F2F4F6]">
                  <button onClick={() => setProductDropOpen(false)}
                    className="w-full h-8 rounded-lg text-[12px] font-medium text-[#6B7684] hover:bg-[#F2F4F6]">닫기</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 꺾은선 차트 ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-5 py-6">
        {loading ? (
          <div className="h-80 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#3182F6]" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-80 flex items-center justify-center flex-col gap-2">
            <p className="text-[13px] font-medium text-[#6B7684]">데이터가 없습니다</p>
            <p className="text-[12px] text-[#B0B8C1]">날짜 범위를 조정하거나 주문을 동기화하세요</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F6" vertical={false} />
              <XAxis
                dataKey="period"
                tick={{ fontSize: 11, fill: '#B0B8C1' }}
                tickLine={false} axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#B0B8C1' }}
                tickLine={false} axisLine={false}
                width={36}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 12, border: '1px solid #E5E8EB',
                  fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                }}
                labelStyle={{ fontWeight: 700, color: '#191F28', marginBottom: 4 }}
                formatter={(value: number, name: string) => [
                  `${value.toLocaleString()}${metric === 'count' ? '건' : '개'}`,
                  name,
                ]}
              />
              <Legend
                iconType="circle" iconSize={8}
                wrapperStyle={{ fontSize: 12, paddingTop: 20 }}
              />
              {seriesKeys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2.5}
                  dot={chartData.length <= 60
                    ? { r: 3, fill: COLORS[i % COLORS.length], strokeWidth: 0 }
                    : false}
                  activeDot={{ r: 5, strokeWidth: 0 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── 집계 테이블 ─────────────────────────────────────────────────────── */}
      {!loading && seriesKeys.length > 0 && (
        <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[#F2F4F6]">
            <p className="text-[13px] font-semibold text-[#191F28]">기간 합계</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8F9FB] border-b border-[#F2F4F6]">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#6B7684]">
                    {groupBy === 'channel' ? '채널' : '상품'}
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#6B7684]">건수</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#6B7684]">수량</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#6B7684]">비율</th>
                </tr>
              </thead>
              <tbody>
                {seriesKeys.map((key, i) => {
                  const cnt = filteredOrders.filter((o) =>
                    (groupBy === 'channel' ? (CHANNEL_LABELS[o.channel] ?? o.channel) : resolveAdminName(o)) === key
                  );
                  const count = cnt.length;
                  const qty   = cnt.reduce((s, o) => s + (o.quantity ?? 0), 0);
                  const pct   = totalOrders > 0 ? Math.round(count / totalOrders * 100) : 0;
                  return (
                    <tr key={key} className="border-b border-[#F2F4F6] hover:bg-[#FAFAFA]">
                      <td className="px-4 py-2.5 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="text-[13px] text-[#191F28] truncate">{key}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[13px] font-semibold text-[#191F28] tabular-nums">
                        {count.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right text-[13px] text-[#6B7684] tabular-nums">
                        {qty.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-[#F2F4F6] overflow-hidden">
                            <div className="h-full rounded-full" style={{
                              width: `${pct}%`,
                              backgroundColor: COLORS[i % COLORS.length],
                            }} />
                          </div>
                          <span className="text-[12px] text-[#6B7684] tabular-nums w-8 text-right">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
