'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { formatNumber } from '@/lib/utils';
import { Upload, Loader2, Trash2, Download, Megaphone, TrendingUp, TrendingDown, Search, ArrowUpDown } from 'lucide-react';
import {
  ComposedChart, Bar, Line, Area, AreaChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';

/* ══ 공통 포맷 ══ */
const fmtN = (n: number) => formatNumber(Math.round(n));
const fmtW = (n: number) => `${fmtN(n)}원`;
const fmtPct = (n: number) => `${n.toFixed(2)}%`;

/* ══ 토스 행 ══ */
interface TossRow {
  date: string;
  campaign: string; campaignId: string;
  adSet: string; adSetId: string;
  ad: string; adId: string;
  product: string; productId: string;
  option: string; optionId: string;
  impressions: number; clicks: number;
  ctr: number; cvr: number;
  salesQty: number; orderCount: number;
  revenue: number; roas: number;
  cost: number; cpc: number;
  directSalesQty: number; directOrderCount: number;
  directRevenue: number; directRoas: number;
}

function normDate(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
const num = (v: any) => {
  const n = parseFloat(String(v).replace(/[,%]/g, ''));
  return isFinite(n) ? n : 0;
};

function parseTossRow(r: any): TossRow {
  return {
    date: normDate(r['일자']),
    campaign: String(r['캠페인'] ?? '').trim(),
    campaignId: String(r['캠페인 ID'] ?? '').replace(/\.0$/, ''),
    adSet: String(r['광고 세트'] ?? '').trim(),
    adSetId: String(r['광고 세트 ID'] ?? '').replace(/\.0$/, ''),
    ad: String(r['광고'] ?? '').trim(),
    adId: String(r['광고 ID'] ?? '').replace(/\.0$/, ''),
    product: String(r['상품'] ?? '').trim(),
    productId: String(r['상품 ID'] ?? '').replace(/\.0$/, ''),
    option: String(r['옵션'] ?? '').trim(),
    optionId: String(r['옵션 ID'] ?? '').replace(/\.0$/, ''),
    impressions: num(r['노출수']),
    clicks: num(r['클릭수']),
    ctr: num(r['클릭률']),
    cvr: num(r['전환율']),
    salesQty: num(r['총 전환 판매수량']),
    orderCount: num(r['총 전환 주문건수']),
    revenue: num(r['총 전환 거래액']),
    roas: num(r['총 전환 광고수익률']),
    cost: num(r['집행 광고비']),
    cpc: num(r['클릭당 비용']),
    directSalesQty: num(r['직접 전환 판매수량']),
    directOrderCount: num(r['직접 전환 주문건수']),
    directRevenue: num(r['직접 전환 거래액']),
    directRoas: num(r['직접 전환 광고수익률']),
  };
}

type Gran = 'daily' | 'weekly' | 'monthly';
function bucketKey(d: string, g: Gran): string {
  if (g === 'monthly') return d.slice(0, 7);
  if (g === 'weekly') {
    const dt = new Date(d); dt.setHours(0, 0, 0, 0);
    dt.setDate(dt.getDate() + 3 - (dt.getDay() + 6) % 7);
    const w1 = new Date(dt.getFullYear(), 0, 4);
    const wn = 1 + Math.round(((dt.getTime() - w1.getTime()) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7);
    return `${dt.getFullYear()}-W${String(wn).padStart(2, '0')}`;
  }
  return d;
}

type AggKey = 'campaign' | 'adSet' | 'ad' | 'product' | 'option';
type SortKey = 'cost' | 'revenue' | 'roas' | 'impressions' | 'clicks' | 'ctr' | 'cvr' | 'cpc' | 'orderCount';

export default function TossAdAnalysisPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<TossRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const [gran, setGran] = useState<Gran>('daily');
  const [aggBy, setAggBy] = useState<AggKey>('product');
  const [sortKey, setSortKey] = useState<SortKey>('cost');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [search, setSearch] = useState('');
  const [campaignFilter, setCampaignFilter] = useState<string>('');
  const [productFilter, setProductFilter] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/ad-analysis/toss');
        if (r.ok) {
          const { rows: raw } = await r.json();
          if (raw?.length) setRows(raw.map(parseTossRow));
        }
      } finally { setInitialLoading(false); }
    })();
  }, []);

  const handleUpload = useCallback(async (files: File[]) => {
    setLoading(true); setError('');
    try {
      const XLSX = await import('xlsx');
      const allRaw: any[] = [];
      for (const f of files) {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheetName = wb.SheetNames.find((n) => n.includes('광고')) || wb.SheetNames[0];
        allRaw.push(...XLSX.utils.sheet_to_json(wb.Sheets[sheetName]));
      }
      if (!allRaw.length) throw new Error('데이터 없음');
      const keyOf = (r: any) => `${normDate(r['일자'])}|${String(r['광고 ID']||'').replace(/\.0$/, '')}|${String(r['옵션 ID']||'').replace(/\.0$/, '')}`;
      const existingKeys = new Set(rows.map((r) => `${r.date}|${r.adId}|${r.optionId}`));
      const newRaw = allRaw.filter((r) => !existingKeys.has(keyOf(r)));
      const parsed = allRaw.map(parseTossRow);
      setRows((prev) => {
        const merged = [...prev];
        const ek = new Set(prev.map((r) => `${r.date}|${r.adId}|${r.optionId}`));
        for (const p of parsed) {
          const k = `${p.date}|${p.adId}|${p.optionId}`;
          if (!ek.has(k)) { merged.push(p); ek.add(k); }
        }
        return merged;
      });
      if (newRaw.length) {
        fetch('/api/ad-analysis/toss', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: newRaw, filename: files[0]?.name ?? 'toss' }),
        }).catch(() => {});
      }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [rows]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
    if (files.length) handleUpload(files);
  };

  async function deleteAll() {
    if (!confirm('모든 토스 광고 데이터를 삭제하시겠습니까?')) return;
    await fetch('/api/ad-analysis/toss', { method: 'DELETE' });
    setRows([]);
  }

  // 필터 적용
  const filteredRows = useMemo(() => {
    return rows.filter((r) =>
      (!campaignFilter || r.campaign === campaignFilter) &&
      (!productFilter || r.product === productFilter)
    );
  }, [rows, campaignFilter, productFilter]);

  const campaigns = useMemo(() => Array.from(new Set(rows.map((r) => r.campaign))).filter(Boolean).sort(), [rows]);
  const products = useMemo(() => Array.from(new Set(rows.map((r) => r.product))).filter(Boolean).sort(), [rows]);
  const dateRange = useMemo(() => {
    if (!rows.length) return null;
    const dates = rows.map((r) => r.date).filter(Boolean).sort();
    return { from: dates[0], to: dates[dates.length - 1] };
  }, [rows]);

  // KPI 합계
  const totals = useMemo(() => {
    const t = { impressions: 0, clicks: 0, cost: 0, revenue: 0, orderCount: 0, salesQty: 0 };
    for (const r of filteredRows) {
      t.impressions += r.impressions;
      t.clicks += r.clicks;
      t.cost += r.cost;
      t.revenue += r.revenue;
      t.orderCount += r.orderCount;
      t.salesQty += r.salesQty;
    }
    return {
      ...t,
      ctr: t.impressions > 0 ? t.clicks / t.impressions * 100 : 0,
      cvr: t.clicks > 0 ? t.orderCount / t.clicks * 100 : 0,
      cpc: t.clicks > 0 ? t.cost / t.clicks : 0,
      roas: t.cost > 0 ? t.revenue / t.cost * 100 : 0,
    };
  }, [filteredRows]);

  // 기간별 집계 (노출수 + CPC 중심 + 광고비/매출/ROAS)
  const daily = useMemo(() => {
    const map = new Map<string, any>();
    for (const r of filteredRows) {
      const k = bucketKey(r.date, gran);
      if (!map.has(k)) map.set(k, { date: k, impressions: 0, clicks: 0, cost: 0, revenue: 0, orderCount: 0 });
      const c = map.get(k);
      c.impressions += r.impressions;
      c.clicks += r.clicks;
      c.cost += r.cost;
      c.revenue += r.revenue;
      c.orderCount += r.orderCount;
    }
    return Array.from(map.values()).map((d) => ({
      ...d,
      cpc: d.clicks > 0 ? Math.round(d.cost / d.clicks) : 0,
      ctr: d.impressions > 0 ? d.clicks / d.impressions * 100 : 0,
      cvr: d.clicks > 0 ? d.orderCount / d.clicks * 100 : 0,
      roas: d.cost > 0 ? d.revenue / d.cost * 100 : 0,
    })).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredRows, gran]);

  // 집계 기준
  const byGroup = useMemo(() => {
    const map = new Map<string, any>();
    for (const r of filteredRows) {
      const key = r[aggBy] || '(empty)';
      if (!map.has(key)) map.set(key, { name: key, impressions: 0, clicks: 0, cost: 0, revenue: 0, orderCount: 0 });
      const c = map.get(key);
      c.impressions += r.impressions;
      c.clicks += r.clicks;
      c.cost += r.cost;
      c.revenue += r.revenue;
      c.orderCount += r.orderCount;
    }
    let arr = Array.from(map.values()).map((g) => ({
      ...g,
      ctr: g.impressions > 0 ? g.clicks / g.impressions * 100 : 0,
      cvr: g.clicks > 0 ? g.orderCount / g.clicks * 100 : 0,
      cpc: g.clicks > 0 ? g.cost / g.clicks : 0,
      roas: g.cost > 0 ? g.revenue / g.cost * 100 : 0,
    }));
    if (search) arr = arr.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()));
    arr.sort((a, b) => (sortDir === 'desc' ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]));
    return arr;
  }, [filteredRows, aggBy, sortKey, sortDir, search]);

  function downloadXlsx(rows: any[], filename: string) {
    import('xlsx').then((XLSX) => {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      XLSX.writeFile(wb, filename);
    });
  }

  const hasData = rows.length > 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Megaphone className="h-5 w-5 text-[#3182F6]" />
          <h1 className="text-[20px] font-bold text-[#191F28]">토스 광고 분석</h1>
          {dateRange && (
            <span className="text-[12px] text-[#8B95A1]">{dateRange.from} ~ {dateRange.to}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            className="flex items-center gap-2 h-10 px-4 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B6AE5] disabled:opacity-60 transition-colors"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            데이터 추가
          </button>
          {hasData && (
            <button
              onClick={deleteAll}
              className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[#6B7684] text-[13px] font-medium hover:bg-[#F8F9FA] transition-colors"
            >
              초기화
            </button>
          )}
        </div>
        <input
          ref={fileRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden"
          onChange={(e) => {
            const files = e.target.files ? [...e.target.files] : [];
            if (files.length) handleUpload(files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Upload zone */}
      {!hasData && !loading && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="border-2 border-dashed border-[#D1D6DB] rounded-2xl p-12 text-center hover:border-[#3182F6] hover:bg-[#F8FAFF] transition-colors cursor-pointer"
          onClick={() => !initialLoading && fileRef.current?.click()}
        >
          {initialLoading ? (
            <>
              <Loader2 className="h-10 w-10 mx-auto text-[#3182F6] mb-3 animate-spin" />
              <p className="text-[15px] font-semibold text-[#333D4B]">저장된 데이터 불러오는 중...</p>
            </>
          ) : (
            <>
              <Upload className="h-10 w-10 mx-auto text-[#B0B8C1] mb-3" />
              <p className="text-[15px] font-semibold text-[#333D4B]">토스 광고 성과 보고서 (xlsx) 를 드래그하거나 클릭하세요</p>
              <p className="text-[12px] text-[#8B95A1] mt-1">여러 파일 동시 업로드 가능 · 중복 자동 제거</p>
            </>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[#3182F6]" />
          <span className="ml-3 text-[15px] text-[#6B7684]">데이터 처리 중...</span>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">{error}</div>}

      {hasData && (
        <>
          {/* 데이터 요약 + 필터 */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#8B95A1]">
            <span>데이터: {rows.length.toLocaleString()}행</span>
            {campaigns.length > 0 && (
              <select
                value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}
                className="h-7 px-2 rounded-lg border border-[#E5E8EB] text-[11px] text-[#333D4B] bg-white"
              >
                <option value="">캠페인 전체</option>
                {campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {products.length > 0 && (
              <select
                value={productFilter} onChange={(e) => setProductFilter(e.target.value)}
                className="h-7 px-2 rounded-lg border border-[#E5E8EB] text-[11px] text-[#333D4B] bg-white"
              >
                <option value="">상품 전체</option>
                {products.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>

          {/* KPI 카드 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <KPICard icon={<TrendingUp className="h-3.5 w-3.5" />} label="노출" value={fmtN(totals.impressions)} />
            <KPICard icon={<TrendingUp className="h-3.5 w-3.5" />} label="클릭" value={fmtN(totals.clicks)} sub={`CTR ${fmtPct(totals.ctr)}`} />
            <KPICard icon={<TrendingDown className="h-3.5 w-3.5" />} label="CPC" value={fmtW(totals.cpc)} accent="amber" />
            <KPICard icon={<TrendingUp className="h-3.5 w-3.5" />} label="주문" value={fmtN(totals.orderCount)} sub={`CVR ${fmtPct(totals.cvr)}`} />
            <KPICard icon={<TrendingUp className="h-3.5 w-3.5" />} label="판매수량" value={fmtN(totals.salesQty)} />
            <KPICard label="광고비" value={fmtW(totals.cost)} accent="red" />
            <KPICard label="매출" value={fmtW(totals.revenue)} accent="emerald" />
            <KPICard label="ROAS" value={`${totals.roas.toFixed(0)}%`} accent={totals.roas >= 300 ? 'emerald' : totals.roas >= 100 ? 'blue' : 'red'} />
          </div>

          {/* 🎯 일별 노출수 + CPC 변화 차트 (토스 핵심) */}
          <div className="bg-white rounded-2xl border border-[#E5E8EB] p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-[14px] font-bold text-[#191F28]">📊 노출수 & CPC 변화</h2>
                <p className="text-[11px] text-[#8B95A1] mt-0.5">일자별 노출량 변동과 클릭당 비용 추이 — 토스 광고 최적화 핵심 지표</p>
              </div>
              <GranToggle gran={gran} onChange={setGran} />
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F3F5" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8B95A1' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#8B95A1' }} tickFormatter={(v) => fmtN(v)} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#8B95A1' }} tickFormatter={(v) => `${fmtN(v)}원`} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'white', border: '1px solid #E5E8EB', borderRadius: '12px', fontSize: '12px' }}
                  formatter={(v: any, n: string) => n === 'CPC' ? fmtW(Number(v)) : fmtN(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Area yAxisId="left" type="monotone" dataKey="impressions" fill="#DBEAFE" stroke="#3182F6" name="노출수" strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="cpc" stroke="#F59E0B" name="CPC" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* 광고비 vs 매출 + ROAS 차트 */}
          <div className="bg-white rounded-2xl border border-[#E5E8EB] p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-bold text-[#191F28]">💰 광고비 vs 매출 & ROAS</h2>
              <GranToggle gran={gran} onChange={setGran} />
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F3F5" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8B95A1' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#8B95A1' }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#8B95A1' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'white', border: '1px solid #E5E8EB', borderRadius: '12px', fontSize: '12px' }}
                  formatter={(v: any, n: string) => n === 'ROAS' ? `${Number(v).toFixed(0)}%` : fmtW(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <ReferenceLine yAxisId="right" y={100} stroke="#EF4444" strokeDasharray="3 3" />
                <Bar yAxisId="left" dataKey="cost" fill="#EF4444" name="광고비" />
                <Bar yAxisId="left" dataKey="revenue" fill="#10B981" name="매출" />
                <Line yAxisId="right" type="monotone" dataKey="roas" stroke="#3182F6" name="ROAS" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* 클릭 & CVR 차트 */}
          <div className="bg-white rounded-2xl border border-[#E5E8EB] p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-bold text-[#191F28]">🎯 클릭 & 전환율</h2>
              <GranToggle gran={gran} onChange={setGran} />
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F3F5" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8B95A1' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#8B95A1' }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#8B95A1' }} tickFormatter={(v) => `${v.toFixed(1)}%`} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'white', border: '1px solid #E5E8EB', borderRadius: '12px', fontSize: '12px' }}
                  formatter={(v: any, n: string) => n === 'CTR' || n === 'CVR' ? `${Number(v).toFixed(2)}%` : fmtN(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar yAxisId="left" dataKey="clicks" fill="#8B5CF6" name="클릭" />
                <Line yAxisId="right" type="monotone" dataKey="ctr" stroke="#F59E0B" name="CTR" strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="cvr" stroke="#10B981" name="CVR" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* 집계 테이블 */}
          <div className="bg-white rounded-2xl border border-[#E5E8EB] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-[14px] font-bold text-[#191F28]">📋 기준별 분석</h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1 bg-[#F8F9FA] rounded-lg p-0.5">
                  {([
                    { k: 'campaign', l: '캠페인' },
                    { k: 'adSet', l: '광고세트' },
                    { k: 'ad', l: '광고' },
                    { k: 'product', l: '상품' },
                    { k: 'option', l: '옵션' },
                  ] as const).map((o) => (
                    <button
                      key={o.k}
                      onClick={() => setAggBy(o.k)}
                      className={`px-3 py-1 text-[11px] rounded-md font-medium transition-colors ${
                        aggBy === o.k ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684]'
                      }`}
                    >{o.l}</button>
                  ))}
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#B0B8C1]" />
                  <input
                    value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색..."
                    className="h-7 pl-8 pr-2 rounded-lg border border-[#E5E8EB] text-[11px] text-[#333D4B] bg-white w-32"
                  />
                </div>
                <button
                  onClick={() => downloadXlsx(byGroup, `토스_${aggBy}_${new Date().toISOString().slice(0, 10)}.xlsx`)}
                  className="h-7 px-3 rounded-lg border border-[#E5E8EB] text-[11px] text-[#6B7684] flex items-center gap-1 hover:bg-[#F8F9FA]"
                >
                  <Download className="h-3 w-3" /> xlsx
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-[#F8F9FA] border-b border-[#E5E8EB]">
                  <tr className="text-[11px] text-[#6B7684]">
                    <th className="text-left px-3 py-2.5 font-medium">이름</th>
                    <SortTh k="impressions" label="노출" cur={sortKey} dir={sortDir} onClick={(k) => { setSortKey(k); setSortDir((d) => sortKey === k ? (d === 'desc' ? 'asc' : 'desc') : 'desc'); }} />
                    <SortTh k="clicks" label="클릭" cur={sortKey} dir={sortDir} onClick={(k) => { setSortKey(k); setSortDir((d) => sortKey === k ? (d === 'desc' ? 'asc' : 'desc') : 'desc'); }} />
                    <SortTh k="ctr" label="CTR" cur={sortKey} dir={sortDir} onClick={(k) => { setSortKey(k); setSortDir((d) => sortKey === k ? (d === 'desc' ? 'asc' : 'desc') : 'desc'); }} />
                    <SortTh k="cpc" label="CPC" cur={sortKey} dir={sortDir} onClick={(k) => { setSortKey(k); setSortDir((d) => sortKey === k ? (d === 'desc' ? 'asc' : 'desc') : 'desc'); }} />
                    <SortTh k="orderCount" label="주문" cur={sortKey} dir={sortDir} onClick={(k) => { setSortKey(k); setSortDir((d) => sortKey === k ? (d === 'desc' ? 'asc' : 'desc') : 'desc'); }} />
                    <SortTh k="cvr" label="CVR" cur={sortKey} dir={sortDir} onClick={(k) => { setSortKey(k); setSortDir((d) => sortKey === k ? (d === 'desc' ? 'asc' : 'desc') : 'desc'); }} />
                    <SortTh k="cost" label="광고비" cur={sortKey} dir={sortDir} onClick={(k) => { setSortKey(k); setSortDir((d) => sortKey === k ? (d === 'desc' ? 'asc' : 'desc') : 'desc'); }} />
                    <SortTh k="revenue" label="매출" cur={sortKey} dir={sortDir} onClick={(k) => { setSortKey(k); setSortDir((d) => sortKey === k ? (d === 'desc' ? 'asc' : 'desc') : 'desc'); }} />
                    <SortTh k="roas" label="ROAS" cur={sortKey} dir={sortDir} onClick={(k) => { setSortKey(k); setSortDir((d) => sortKey === k ? (d === 'desc' ? 'asc' : 'desc') : 'desc'); }} />
                  </tr>
                </thead>
                <tbody>
                  {byGroup.map((g, i) => (
                    <tr key={i} className="border-b border-[#F1F3F5] hover:bg-[#F8FAFF]">
                      <td className="px-3 py-2.5 max-w-[260px] truncate text-[#333D4B]" title={g.name}>{g.name}</td>
                      <td className="px-3 py-2.5 text-right text-[#333D4B]">{fmtN(g.impressions)}</td>
                      <td className="px-3 py-2.5 text-right text-[#333D4B]">{fmtN(g.clicks)}</td>
                      <td className="px-3 py-2.5 text-right text-[#6B7684]">{fmtPct(g.ctr)}</td>
                      <td className="px-3 py-2.5 text-right text-[#6B7684]">{fmtW(g.cpc)}</td>
                      <td className="px-3 py-2.5 text-right text-[#333D4B]">{fmtN(g.orderCount)}</td>
                      <td className="px-3 py-2.5 text-right text-[#6B7684]">{fmtPct(g.cvr)}</td>
                      <td className="px-3 py-2.5 text-right text-[#EF4444] font-medium">{fmtW(g.cost)}</td>
                      <td className="px-3 py-2.5 text-right text-[#10B981] font-medium">{fmtW(g.revenue)}</td>
                      <td className={`px-3 py-2.5 text-right font-bold ${
                        g.roas >= 300 ? 'text-[#10B981]' : g.roas >= 100 ? 'text-[#3182F6]' : 'text-[#EF4444]'
                      }`}>{g.roas.toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 기간별 요약 테이블 */}
          <div className="bg-white rounded-2xl border border-[#E5E8EB] p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-bold text-[#191F28]">📅 기간별 요약</h2>
              <div className="flex gap-2">
                <GranToggle gran={gran} onChange={setGran} />
                <button
                  onClick={() => downloadXlsx(daily, `토스_${gran}_${new Date().toISOString().slice(0, 10)}.xlsx`)}
                  className="h-7 px-3 rounded-lg border border-[#E5E8EB] text-[11px] text-[#6B7684] flex items-center gap-1 hover:bg-[#F8F9FA]"
                >
                  <Download className="h-3 w-3" /> xlsx
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-[#F8F9FA] border-b border-[#E5E8EB]">
                  <tr className="text-[11px] text-[#6B7684]">
                    <th className="text-left px-3 py-2.5 font-medium">{gran === 'monthly' ? '월' : gran === 'weekly' ? '주' : '일자'}</th>
                    <th className="text-right px-3 py-2.5 font-medium">노출</th>
                    <th className="text-right px-3 py-2.5 font-medium">클릭</th>
                    <th className="text-right px-3 py-2.5 font-medium">CTR</th>
                    <th className="text-right px-3 py-2.5 font-medium">CPC</th>
                    <th className="text-right px-3 py-2.5 font-medium">주문</th>
                    <th className="text-right px-3 py-2.5 font-medium">CVR</th>
                    <th className="text-right px-3 py-2.5 font-medium">광고비</th>
                    <th className="text-right px-3 py-2.5 font-medium">매출</th>
                    <th className="text-right px-3 py-2.5 font-medium">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((d, i) => (
                    <tr key={i} className="border-b border-[#F1F3F5] hover:bg-[#F8FAFF]">
                      <td className="px-3 py-2.5 text-[#333D4B]">{d.date}</td>
                      <td className="px-3 py-2.5 text-right text-[#333D4B]">{fmtN(d.impressions)}</td>
                      <td className="px-3 py-2.5 text-right text-[#333D4B]">{fmtN(d.clicks)}</td>
                      <td className="px-3 py-2.5 text-right text-[#6B7684]">{fmtPct(d.ctr)}</td>
                      <td className="px-3 py-2.5 text-right text-[#F59E0B] font-medium">{fmtW(d.cpc)}</td>
                      <td className="px-3 py-2.5 text-right text-[#333D4B]">{fmtN(d.orderCount)}</td>
                      <td className="px-3 py-2.5 text-right text-[#6B7684]">{fmtPct(d.cvr)}</td>
                      <td className="px-3 py-2.5 text-right text-[#EF4444] font-medium">{fmtW(d.cost)}</td>
                      <td className="px-3 py-2.5 text-right text-[#10B981] font-medium">{fmtW(d.revenue)}</td>
                      <td className={`px-3 py-2.5 text-right font-bold ${
                        d.roas >= 300 ? 'text-[#10B981]' : d.roas >= 100 ? 'text-[#3182F6]' : 'text-[#EF4444]'
                      }`}>{d.roas.toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KPICard({ icon, label, value, sub, accent = 'gray' }: { icon?: React.ReactNode; label: string; value: string; sub?: string; accent?: 'gray' | 'emerald' | 'red' | 'blue' | 'amber' }) {
  const color = {
    gray: 'text-[#191F28]',
    emerald: 'text-[#10B981]',
    red: 'text-[#EF4444]',
    blue: 'text-[#3182F6]',
    amber: 'text-[#F59E0B]',
  }[accent];
  return (
    <div className="bg-white rounded-2xl border border-[#E5E8EB] p-4">
      <div className="flex items-center gap-1.5 text-[11px] text-[#8B95A1] mb-1">
        {icon}<span>{label}</span>
      </div>
      <div className={`text-[20px] font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-[#B0B8C1] mt-0.5">{sub}</div>}
    </div>
  );
}

function GranToggle({ gran, onChange }: { gran: Gran; onChange: (g: Gran) => void }) {
  return (
    <div className="flex gap-1 bg-[#F8F9FA] rounded-lg p-0.5">
      {(['daily', 'weekly', 'monthly'] as const).map((g) => (
        <button key={g} onClick={() => onChange(g)}
          className={`px-3 py-1 text-[11px] rounded-md font-medium transition-colors ${
            gran === g ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684]'
          }`}>
          {g === 'daily' ? '일별' : g === 'weekly' ? '주별' : '월별'}
        </button>
      ))}
    </div>
  );
}

function SortTh({ k, label, cur, dir, onClick }: { k: SortKey; label: string; cur: SortKey; dir: 'asc' | 'desc'; onClick: (k: SortKey) => void }) {
  const active = cur === k;
  return (
    <th
      className={`text-right px-3 py-2.5 font-medium cursor-pointer select-none hover:text-[#3182F6] ${active ? 'text-[#3182F6]' : ''}`}
      onClick={() => onClick(k)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active ? (dir === 'desc' ? '▼' : '▲') : <ArrowUpDown className="h-2.5 w-2.5" />}
      </span>
    </th>
  );
}
