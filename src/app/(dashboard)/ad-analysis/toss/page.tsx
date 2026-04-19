'use client';

import { useState, useMemo, useCallback, useRef, useEffect, Fragment } from 'react';
import { formatNumber } from '@/lib/utils';
import { Upload, Loader2, Trash2, Download, Megaphone, TrendingUp, TrendingDown, Search, ArrowUpDown, ChevronRight, ChevronDown, Eye, MousePointerClick, DollarSign, ShoppingCart, Radio } from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
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

type TabKey = 'trend' | 'campaign' | 'adSet' | 'product';
type SortKey = 'cost' | 'revenue' | 'roas' | 'impressions' | 'clicks' | 'ctr' | 'cvr' | 'cpc' | 'cpm' | 'orderCount';

type MetricKey = 'impressions' | 'cpm' | 'clicks' | 'ctr' | 'cpc' | 'orderCount' | 'cvr' | 'cost' | 'revenue' | 'roas';
type MetricUnit = 'cnt' | 'won' | 'pct';
interface MetricDef { key: MetricKey; label: string; type: 'bar' | 'line'; unit: MetricUnit; color: string; }

const METRICS: MetricDef[] = [
  { key: 'impressions', label: '노출',    type: 'line', unit: 'cnt', color: '#3182F6' },
  { key: 'cpm',         label: 'CPM',     type: 'line', unit: 'won', color: '#F59E0B' },
  { key: 'clicks',      label: '클릭',    type: 'line', unit: 'cnt', color: '#8B5CF6' },
  { key: 'ctr',         label: 'CTR',     type: 'line', unit: 'pct', color: '#06B6D4' },
  { key: 'cpc',         label: 'CPC',     type: 'line', unit: 'won', color: '#A855F7' },
  { key: 'orderCount',  label: '주문',    type: 'bar',  unit: 'cnt', color: '#F97316' },
  { key: 'cvr',         label: 'CVR',     type: 'line', unit: 'pct', color: '#EAB308' },
  { key: 'cost',        label: '광고비',  type: 'bar',  unit: 'won', color: '#EF4444' },
  { key: 'revenue',     label: '매출',    type: 'bar',  unit: 'won', color: '#10B981' },
  { key: 'roas',        label: 'ROAS',    type: 'line', unit: 'pct', color: '#3182F6' },
];
const DEFAULT_METRICS: MetricKey[] = ['impressions', 'cpm'];

interface AggRow {
  key: string; name: string;
  impressions: number; clicks: number; cost: number; revenue: number; orderCount: number;
  ctr: number; cvr: number; cpc: number; cpm: number; roas: number;
}

function aggregate(rows: TossRow[], getKey: (r: TossRow) => string, getName?: (r: TossRow) => string): AggRow[] {
  const map = new Map<string, AggRow>();
  for (const r of rows) {
    const key = getKey(r) || '(empty)';
    if (!map.has(key)) map.set(key, { key, name: (getName?.(r) || getKey(r) || '(empty)'), impressions: 0, clicks: 0, cost: 0, revenue: 0, orderCount: 0, ctr: 0, cvr: 0, cpc: 0, cpm: 0, roas: 0 });
    const c = map.get(key)!;
    c.impressions += r.impressions; c.clicks += r.clicks; c.cost += r.cost;
    c.revenue += r.revenue; c.orderCount += r.orderCount;
  }
  return Array.from(map.values()).map((g) => ({
    ...g,
    ctr: g.impressions > 0 ? g.clicks / g.impressions * 100 : 0,
    cvr: g.clicks > 0 ? g.orderCount / g.clicks * 100 : 0,
    cpc: g.clicks > 0 ? Math.round(g.cost / g.clicks) : 0,
    cpm: g.impressions > 0 ? Math.round(g.cost / g.impressions * 1000) : 0,
    roas: g.cost > 0 ? g.revenue / g.cost * 100 : 0,
  }));
}

interface DailyRow {
  date: string;
  impressions: number; clicks: number; cost: number; revenue: number; orderCount: number;
  ctr: number; cvr: number; cpc: number; cpm: number; roas: number;
}
function aggregateDaily(rows: TossRow[], gran: Gran): DailyRow[] {
  const map = new Map<string, DailyRow>();
  for (const r of rows) {
    const k = bucketKey(r.date, gran);
    if (!map.has(k)) map.set(k, { date: k, impressions: 0, clicks: 0, cost: 0, revenue: 0, orderCount: 0, ctr: 0, cvr: 0, cpc: 0, cpm: 0, roas: 0 });
    const c = map.get(k)!;
    c.impressions += r.impressions; c.clicks += r.clicks; c.cost += r.cost;
    c.revenue += r.revenue; c.orderCount += r.orderCount;
  }
  return Array.from(map.values()).map((d) => ({
    ...d,
    ctr: d.impressions > 0 ? d.clicks / d.impressions * 100 : 0,
    cvr: d.clicks > 0 ? d.orderCount / d.clicks * 100 : 0,
    cpc: d.clicks > 0 ? Math.round(d.cost / d.clicks) : 0,
    cpm: d.impressions > 0 ? Math.round(d.cost / d.impressions * 1000) : 0,
    roas: d.cost > 0 ? d.revenue / d.cost * 100 : 0,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

export default function TossAdAnalysisPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<TossRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');

  // 전역 필터
  const [campaignFilter, setCampaignFilter] = useState<string>('');
  const [productFilter, setProductFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  // 탭
  const [tab, setTab] = useState<TabKey>('trend');
  const [gran, setGran] = useState<Gran>('daily');
  const [memos, setMemos] = useState<Record<string, string>>({});

  // 리스트 정렬/검색
  const [sortKey, setSortKey] = useState<SortKey>('cost');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [search, setSearch] = useState('');

  // 드릴다운
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // 기간별 추이 차트 지표
  const [activeMetrics, setActiveMetrics] = useState<MetricKey[]>(DEFAULT_METRICS);
  const [metricTypes, setMetricTypes] = useState<Partial<Record<MetricKey, 'bar' | 'line'>>>({});
  const [rightAxisKeys, setRightAxisKeys] = useState<Set<MetricKey>>(new Set(['cpm']));

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
        try {
          const res = await fetch('/api/ad-analysis/toss', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: newRaw, filename: files[0]?.name ?? 'toss' }),
          });
          if (!res.ok) {
            const body = await res.text();
            setError(`DB 저장 실패 (${res.status}): ${body.slice(0, 200)} — 새로고침 시 데이터 사라질 수 있음`);
          }
        } catch (err: any) {
          setError(`DB 저장 실패: ${err.message} — 새로고침 시 데이터 사라질 수 있음`);
        }
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

  const dateRange = useMemo(() => {
    if (!rows.length) return null;
    const dates = rows.map((r) => r.date).filter(Boolean).sort();
    return { from: dates[0], to: dates[dates.length - 1] };
  }, [rows]);

  // 전역 필터 적용: 캠페인 + 상품 + 기간
  const filteredRows = useMemo(() => {
    return rows.filter((r) =>
      (!campaignFilter || r.campaign === campaignFilter) &&
      (!productFilter || r.product === productFilter) &&
      (!dateFrom || r.date >= dateFrom) &&
      (!dateTo || r.date <= dateTo)
    );
  }, [rows, campaignFilter, productFilter, dateFrom, dateTo]);

  const campaigns = useMemo(() => Array.from(new Set(rows.map((r) => r.campaign))).filter(Boolean).sort(), [rows]);
  const products = useMemo(() => Array.from(new Set(rows.map((r) => r.product))).filter(Boolean).sort(), [rows]);

  // KPI 합계 (필터 반영)
  const totals = useMemo(() => {
    const t = { impressions: 0, clicks: 0, cost: 0, revenue: 0, orderCount: 0, salesQty: 0 };
    for (const r of filteredRows) {
      t.impressions += r.impressions; t.clicks += r.clicks; t.cost += r.cost;
      t.revenue += r.revenue; t.orderCount += r.orderCount; t.salesQty += r.salesQty;
    }
    return {
      ...t,
      ctr: t.impressions > 0 ? t.clicks / t.impressions * 100 : 0,
      cvr: t.clicks > 0 ? t.orderCount / t.clicks * 100 : 0,
      cpc: t.clicks > 0 ? Math.round(t.cost / t.clicks) : 0,
      cpm: t.impressions > 0 ? Math.round(t.cost / t.impressions * 1000) : 0,
      roas: t.cost > 0 ? t.revenue / t.cost * 100 : 0,
    };
  }, [filteredRows]);

  // 기간별 추이 차트
  const daily = useMemo(() => aggregateDaily(filteredRows, gran), [filteredRows, gran]);

  // 토스 채널 메모 로드
  useEffect(() => {
    fetch('/api/ad-analysis/memos?channel=toss').then(r => r.ok ? r.json() : []).then((list: { date: string; memo: string }[]) => {
      const map: Record<string, string> = {};
      for (const m of list) map[m.date] = m.memo;
      setMemos(map);
    }).catch(() => {});
  }, []);

  const saveMemo = useCallback((date: string, memo: string) => {
    setMemos(prev => ({ ...prev, [date]: memo }));
    fetch('/api/ad-analysis/memos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, memo, channel: 'toss' }),
    }).catch(() => {});
  }, []);

  // 탭별 집계 리스트
  const listRows = useMemo(() => {
    let base: AggRow[] = [];
    if (tab === 'campaign') base = aggregate(filteredRows, (r) => r.campaignId || r.campaign, (r) => r.campaign);
    else if (tab === 'adSet') base = aggregate(filteredRows, (r) => r.adSetId || r.adSet, (r) => r.adSet);
    else if (tab === 'product') base = aggregate(filteredRows, (r) => r.productId || r.product, (r) => r.product);
    else return [];
    if (search) base = base.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()));
    base.sort((a, b) => (sortDir === 'desc' ? (b as any)[sortKey] - (a as any)[sortKey] : (a as any)[sortKey] - (b as any)[sortKey]));
    return base;
  }, [filteredRows, tab, sortKey, sortDir, search]);

  // 드릴다운: 특정 캠페인/세트의 일자별 데이터
  const getDailyFor = useCallback((key: string) => {
    const matched = filteredRows.filter((r) => {
      if (tab === 'campaign') return (r.campaignId || r.campaign) === key;
      if (tab === 'adSet') return (r.adSetId || r.adSet) === key;
      if (tab === 'product') return (r.productId || r.product) === key;
      return false;
    });
    return aggregateDaily(matched, gran);
  }, [filteredRows, tab, gran]);

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // 탭 전환 시 펼친 항목 초기화
  useEffect(() => {
    setExpandedKeys(new Set());
    setSearch('');
  }, [tab]);

  function downloadXlsx(data: any[], filename: string) {
    import('xlsx').then((XLSX) => {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      XLSX.writeFile(wb, filename);
    });
  }

  const hasData = rows.length > 0;
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'trend', label: '기간별 추이' },
    { key: 'campaign', label: '캠페인별' },
    { key: 'adSet', label: '광고세트별' },
    { key: 'product', label: '상품별' },
  ];

  const sortHandler = (k: SortKey) => {
    setSortKey(k);
    setSortDir((d) => (sortKey === k ? (d === 'desc' ? 'asc' : 'desc') : 'desc'));
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Megaphone className="h-5 w-5 text-[#3182F6]" />
          <h1 className="text-[20px] font-bold text-[#191F28]">토스 광고 분석</h1>
          {dateRange && (
            <span className="text-[12px] text-[#8B95A1]">데이터: {dateRange.from} ~ {dateRange.to}</span>
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
              <Trash2 className="h-3.5 w-3.5" /> 초기화
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
          {/* 캠페인/상품 필터 (쿠팡과 동일 위치: KPI 위) */}
          {(campaigns.length > 1 || products.length > 1) && (
            <div className="flex flex-wrap items-center gap-3">
              {campaigns.length > 1 && (
                <div className="flex items-center gap-2">
                  <label className="text-[12px] font-medium text-[#6B7684]">캠페인</label>
                  <select
                    value={campaignFilter}
                    onChange={(e) => setCampaignFilter(e.target.value)}
                    className="h-9 px-3 rounded-lg border border-[#E5E8EB] text-[13px] text-[#191F28] bg-white focus:outline-none focus:border-[#3182F6]"
                  >
                    <option value="">전체 ({campaigns.length})</option>
                    {campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}
              {products.length > 1 && (
                <div className="flex items-center gap-2">
                  <label className="text-[12px] font-medium text-[#6B7684]">상품</label>
                  <ProductCombobox
                    value={productFilter}
                    onChange={setProductFilter}
                    options={products}
                  />
                </div>
              )}
              {(campaignFilter || productFilter) && (
                <button
                  onClick={() => { setCampaignFilter(''); setProductFilter(''); }}
                  className="text-[12px] text-[#3182F6] font-medium hover:underline"
                >
                  필터 초기화
                </button>
              )}
            </div>
          )}

          {/* KPI 카드 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-[#8B95A1]">핵심 지표</span>
              <span className="text-[11px] text-[#B0B8C1]">집계 {filteredRows.length.toLocaleString()}행 / 전체 {rows.length.toLocaleString()}행</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <KPICard icon={<Eye className="h-4 w-4" />} label="노출" value={fmtN(totals.impressions)} accent="blue" />
              <KPICard icon={<Radio className="h-4 w-4" />} label="CPM" value={fmtN(totals.cpm)} sub="천회 노출당 비용" accent="amber" />
              <KPICard icon={<MousePointerClick className="h-4 w-4" />} label="클릭" value={fmtN(totals.clicks)} sub={`CTR ${fmtPct(totals.ctr)}`} accent="blue" />
              <KPICard icon={<DollarSign className="h-4 w-4" />} label="CPC" value={fmtN(totals.cpc)} sub="클릭당 비용" accent="amber" />
              <KPICard icon={<ShoppingCart className="h-4 w-4" />} label="주문" value={fmtN(totals.orderCount)} sub={`CVR ${fmtPct(totals.cvr)}`} accent="emerald" />
              <KPICard icon={<TrendingDown className="h-4 w-4" />} label="광고비" value={fmtW(totals.cost)} accent="red" />
              <KPICard icon={<TrendingUp className="h-4 w-4" />} label="매출" value={fmtW(totals.revenue)} accent="emerald" />
              <KPICard icon={totals.roas >= 100 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />} label="ROAS" value={`${totals.roas.toFixed(0)}%`} accent={totals.roas >= 300 ? 'emerald' : totals.roas >= 100 ? 'blue' : 'red'} />
            </div>
          </div>

          {/* 탭 바 (쿠팡과 동일) */}
          <div className="flex gap-1 bg-[#F2F4F6] rounded-xl p-1 w-fit">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                  tab === t.key ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684] hover:text-[#333D4B]'
                }`}
              >{t.label}</button>
            ))}
          </div>

          {/* 기간 선택 bar (쿠팡과 동일 위치: 탭 아래) */}
          <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl border border-[#F2F4F6] px-4 py-2.5">
            <span className="text-[12px] font-semibold text-[#191F28]">기간</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 px-2 rounded-lg border border-[#E5E8EB] text-[11px] bg-white" />
            <span className="text-[11px] text-[#6B7684]">~</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="h-8 px-2 rounded-lg border border-[#E5E8EB] text-[11px] bg-white" />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="h-8 px-2 rounded-lg text-[10px] text-red-400 hover:bg-red-50 border border-red-200">초기화</button>
            )}
            {(dateFrom || dateTo) && (
              <span className="text-[10px] text-[#6B7684] ml-1">
                {daily.length}일 / {tab !== 'trend' ? `${listRows.length}항목` : `${filteredRows.length.toLocaleString()}행`}
              </span>
            )}
          </div>

          {/* 기간별 추이 탭 */}
          {tab === 'trend' && (
            <>
              <div className="bg-white rounded-2xl border border-[#F2F4F6] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[13px] font-bold text-[#191F28]">기간별 추이</h3>
                    <p className="text-[11px] text-[#8B95A1] mt-0.5">칩 클릭 → 막대 → 꺾은선 → 숨김 · 보조축: 오른쪽 Y축 사용</p>
                  </div>
                  <GranToggle gran={gran} onChange={setGran} />
                </div>

                {/* Metric chips */}
                <div className="flex flex-wrap gap-2">
                  {METRICS.map((m) => {
                    const active = activeMetrics.includes(m.key);
                    const currentType = metricTypes[m.key] || m.type;
                    const handleClick = () => {
                      if (!active) {
                        setActiveMetrics((prev) => [...prev, m.key]);
                        setMetricTypes((prev) => ({ ...prev, [m.key]: 'bar' }));
                      } else if (currentType === 'bar') {
                        setMetricTypes((prev) => ({ ...prev, [m.key]: 'line' }));
                      } else {
                        setActiveMetrics((prev) => prev.filter((k) => k !== m.key));
                      }
                    };
                    return (
                      <button key={m.key} onClick={handleClick}
                        className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 ${
                          active ? 'text-white shadow-sm' : 'bg-[#F2F4F6] text-[#6B7684] hover:bg-[#E5E8EB]'
                        }`}
                        style={active ? { backgroundColor: m.color } : {}}>
                        {m.label} {active ? (currentType === 'bar' ? '▊' : '━') : ''}
                      </button>
                    );
                  })}
                  {activeMetrics.length > 0 && (
                    <div className="flex items-center gap-1 ml-1 border-l border-[#E5E8EB] pl-2">
                      <span className="text-[10px] text-[#6B7684]">보조축:</span>
                      {activeMetrics.map((key) => {
                        const m = METRICS.find((x) => x.key === key);
                        if (!m) return null;
                        const isRight = rightAxisKeys.has(key);
                        return (
                          <button key={key}
                            onClick={() => setRightAxisKeys((prev) => {
                              const n = new Set(prev);
                              if (n.has(key)) n.delete(key); else n.add(key);
                              return n;
                            })}
                            className={`h-6 px-1.5 rounded text-[9px] font-semibold transition-all ${isRight ? 'text-white' : 'bg-[#F2F4F6] text-[#6B7684]'}`}
                            style={isRight ? { backgroundColor: m.color } : {}}>
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Chart */}
                {activeMetrics.length > 0 && (() => {
                  const activeDefs = METRICS.filter((m) => activeMetrics.includes(m.key));
                  const leftDef = activeDefs.find((m) => !rightAxisKeys.has(m.key));
                  const rightDef = activeDefs.find((m) => rightAxisKeys.has(m.key));
                  const fmtUnit = (u: MetricUnit) => (v: number) => {
                    if (u === 'pct') return `${v.toFixed(1)}%`;
                    if (u === 'won') return fmtN(v);
                    return fmtN(v);
                  };
                  return (
                    <div className="h-[360px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={daily}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F6" />
                          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8B95A1' }} />
                          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#8B95A1' }}
                            tickFormatter={leftDef ? fmtUnit(leftDef.unit) : (v) => String(v)} />
                          {rightDef && (
                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#8B95A1' }}
                              tickFormatter={fmtUnit(rightDef.unit)} />
                          )}
                          <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #F2F4F6', borderRadius: '12px', fontSize: '12px' }}
                            formatter={(v: any, name: string) => {
                              const def = METRICS.find((x) => x.label === name);
                              if (!def) return fmtN(Number(v));
                              if (def.unit === 'pct') return `${Number(v).toFixed(2)}%`;
                              if (def.unit === 'won') return fmtW(Number(v));
                              return fmtN(Number(v));
                            }} />
                          <Legend wrapperStyle={{ fontSize: '12px' }} />
                          {activeDefs.map((m) => {
                            const yId = rightAxisKeys.has(m.key) ? 'right' : 'left';
                            const chartType = metricTypes[m.key] || m.type;
                            if (chartType === 'bar') {
                              return (
                                <Bar key={m.key} yAxisId={yId} dataKey={m.key} name={m.label}
                                  fill={m.color} opacity={0.8} radius={[4, 4, 0, 0]} />
                              );
                            }
                            return (
                              <Line key={m.key} yAxisId={yId} type="monotone" dataKey={m.key} name={m.label}
                                stroke={m.color} strokeWidth={2.5} dot={{ r: 3, fill: m.color }} />
                            );
                          })}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}
                {activeMetrics.length === 0 && (
                  <div className="text-center py-10 text-[12px] text-[#B0B8C1]">칩을 클릭해서 지표를 추가하세요</div>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-[#F2F4F6] p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[13px] font-bold text-[#191F28]">기간별 상세</h3>
                  <div className="flex gap-2">
                    <GranToggle gran={gran} onChange={setGran} />
                    <button
                      onClick={() => downloadXlsx(daily, `토스_${gran}_${new Date().toISOString().slice(0, 10)}.xlsx`)}
                      className="h-7 px-3 rounded-lg border border-[#E5E8EB] text-[11px] text-[#6B7684] flex items-center gap-1 hover:bg-[#F8F9FA]">
                      <Download className="h-3 w-3" /> xlsx
                    </button>
                  </div>
                </div>
                <DailyTable rows={daily} gran={gran} memos={memos} onSaveMemo={saveMemo} />
              </div>
            </>
          )}

          {/* 캠페인별 / 광고세트별 / 상품별 탭 */}
          {tab !== 'trend' && (
            <div className="bg-white rounded-2xl border border-[#F2F4F6] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="text-[13px] font-bold text-[#191F28]">
                  {tab === 'campaign' ? '캠페인별 분석' : tab === 'adSet' ? '광고세트별 분석' : '상품별 분석'}
                  <span className="ml-2 text-[11px] font-normal text-[#8B95A1]">{listRows.length.toLocaleString()}개</span>
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  {(tab === 'campaign' || tab === 'adSet') && (
                    <span className="text-[11px] text-[#8B95A1]">행 클릭 → 일자별 상세</span>
                  )}
                  <GranToggle gran={gran} onChange={setGran} />
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#B0B8C1]" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색..."
                      className="h-7 pl-8 pr-2 rounded-lg border border-[#E5E8EB] text-[11px] text-[#333D4B] bg-white w-40" />
                  </div>
                  <button
                    onClick={() => downloadXlsx(listRows, `토스_${tab}_${new Date().toISOString().slice(0, 10)}.xlsx`)}
                    className="h-7 px-3 rounded-lg border border-[#E5E8EB] text-[11px] text-[#6B7684] flex items-center gap-1 hover:bg-[#F8F9FA]">
                    <Download className="h-3 w-3" /> xlsx
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="bg-[#F8F9FA] border-b border-[#E5E8EB]">
                    <tr className="text-[11px] text-[#6B7684]">
                      <th className="w-8"></th>
                      <th className="text-left px-3 py-2.5 font-medium">이름</th>
                      <SortTh k="impressions" label="노출" cur={sortKey} dir={sortDir} onClick={sortHandler} />
                      <SortTh k="cpm" label="CPM" cur={sortKey} dir={sortDir} onClick={sortHandler} />
                      <SortTh k="clicks" label="클릭" cur={sortKey} dir={sortDir} onClick={sortHandler} />
                      <SortTh k="ctr" label="CTR" cur={sortKey} dir={sortDir} onClick={sortHandler} />
                      <SortTh k="cpc" label="CPC" cur={sortKey} dir={sortDir} onClick={sortHandler} />
                      <SortTh k="orderCount" label="주문" cur={sortKey} dir={sortDir} onClick={sortHandler} />
                      <SortTh k="cvr" label="CVR" cur={sortKey} dir={sortDir} onClick={sortHandler} />
                      <SortTh k="cost" label="광고비" cur={sortKey} dir={sortDir} onClick={sortHandler} />
                      <SortTh k="revenue" label="매출" cur={sortKey} dir={sortDir} onClick={sortHandler} />
                      <SortTh k="roas" label="ROAS" cur={sortKey} dir={sortDir} onClick={sortHandler} />
                    </tr>
                  </thead>
                  <tbody>
                    {listRows.map((g) => {
                      const isExpanded = expandedKeys.has(g.key);
                      const canExpand = tab === 'campaign' || tab === 'adSet' || tab === 'product';
                      return (
                        <Fragment key={g.key}>
                          <tr
                            className={`border-b border-[#F1F3F5] hover:bg-[#F8FAFF] ${canExpand ? 'cursor-pointer' : ''} ${isExpanded ? 'bg-[#F0F7FF]' : ''}`}
                            onClick={() => canExpand && toggleExpand(g.key)}>
                            <td className="px-2 py-2.5 text-[#B0B8C1]">
                              {canExpand && (isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
                            </td>
                            <td className="px-3 py-2.5 max-w-[280px] truncate text-[#333D4B]" title={g.name}>{g.name}</td>
                            <td className="px-3 py-2.5 text-right text-[#333D4B]">{fmtN(g.impressions)}</td>
                            <td className="px-3 py-2.5 text-right text-[#F59E0B] font-medium">{fmtN(g.cpm)}</td>
                            <td className="px-3 py-2.5 text-right text-[#333D4B]">{fmtN(g.clicks)}</td>
                            <td className="px-3 py-2.5 text-right text-[#6B7684]">{fmtPct(g.ctr)}</td>
                            <td className="px-3 py-2.5 text-right text-[#6B7684]">{fmtN(g.cpc)}</td>
                            <td className="px-3 py-2.5 text-right text-[#333D4B]">{fmtN(g.orderCount)}</td>
                            <td className="px-3 py-2.5 text-right text-[#6B7684]">{fmtPct(g.cvr)}</td>
                            <td className="px-3 py-2.5 text-right text-[#EF4444] font-medium">{fmtW(g.cost)}</td>
                            <td className="px-3 py-2.5 text-right text-[#10B981] font-medium">{fmtW(g.revenue)}</td>
                            <td className={`px-3 py-2.5 text-right font-bold ${
                              g.roas >= 300 ? 'text-[#10B981]' : g.roas >= 100 ? 'text-[#3182F6]' : 'text-[#EF4444]'
                            }`}>{g.roas.toFixed(0)}%</td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={12} className="p-0">
                                <div className="bg-[#FAFBFC] border-l-2 border-[#3182F6] px-6 py-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-[11px] font-semibold text-[#333D4B]">{g.name} — 일자별 상세</span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); downloadXlsx(getDailyFor(g.key), `토스_${tab}_${g.name.slice(0, 20)}_${gran}.xlsx`); }}
                                      className="h-6 px-2 rounded-md border border-[#E5E8EB] text-[10px] text-[#6B7684] flex items-center gap-1 hover:bg-white">
                                      <Download className="h-3 w-3" /> xlsx
                                    </button>
                                  </div>
                                  <DailyTable rows={getDailyFor(g.key)} gran={gran} dense />
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DailyTable({ rows, gran, dense = false, memos, onSaveMemo }: { rows: DailyRow[]; gran: Gran; dense?: boolean; memos?: Record<string, string>; onSaveMemo?: (date: string, memo: string) => void }) {
  const pad = dense ? 'py-1.5' : 'py-2.5';
  const hasMemo = !!memos && !!onSaveMemo;
  const colSpan = hasMemo ? 12 : 11;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="bg-[#F8F9FA] border-b border-[#E5E8EB]">
          <tr className="text-[11px] text-[#6B7684]">
            <th className={`text-left px-3 ${pad} font-medium`}>{gran === 'monthly' ? '월' : gran === 'weekly' ? '주' : '일자'}</th>
            <th className={`text-right px-3 ${pad} font-medium`}>노출</th>
            <th className={`text-right px-3 ${pad} font-medium`}>CPM</th>
            <th className={`text-right px-3 ${pad} font-medium`}>클릭</th>
            <th className={`text-right px-3 ${pad} font-medium`}>CTR</th>
            <th className={`text-right px-3 ${pad} font-medium`}>CPC</th>
            <th className={`text-right px-3 ${pad} font-medium`}>주문</th>
            <th className={`text-right px-3 ${pad} font-medium`}>CVR</th>
            <th className={`text-right px-3 ${pad} font-medium`}>광고비</th>
            <th className={`text-right px-3 ${pad} font-medium`}>매출</th>
            <th className={`text-right px-3 ${pad} font-medium`}>ROAS</th>
            {hasMemo && <th className={`text-left px-3 ${pad} font-medium whitespace-nowrap`}>메모</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((d, i) => {
            const memo = hasMemo ? (memos![d.date] ?? '') : '';
            const hasValue = hasMemo && memo.length > 0;
            return (
              <tr key={i} className={`border-b border-[#F1F3F5] hover:bg-[#F8FAFF] ${hasValue ? 'bg-amber-50/30' : ''}`}>
                <td className={`px-3 ${pad} text-[#333D4B]`}>
                  <div className="flex items-center gap-1.5">
                    {d.date}
                    {hasValue && <span className="text-[9px] text-amber-600 bg-amber-100 px-1 rounded">메모</span>}
                  </div>
                </td>
                <td className={`px-3 ${pad} text-right text-[#333D4B]`}>{fmtN(d.impressions)}</td>
                <td className={`px-3 ${pad} text-right text-[#F59E0B] font-medium`}>{fmtN(d.cpm)}</td>
                <td className={`px-3 ${pad} text-right text-[#333D4B]`}>{fmtN(d.clicks)}</td>
                <td className={`px-3 ${pad} text-right text-[#6B7684]`}>{fmtPct(d.ctr)}</td>
                <td className={`px-3 ${pad} text-right text-[#6B7684]`}>{fmtN(d.cpc)}</td>
                <td className={`px-3 ${pad} text-right text-[#333D4B]`}>{fmtN(d.orderCount)}</td>
                <td className={`px-3 ${pad} text-right text-[#6B7684]`}>{fmtPct(d.cvr)}</td>
                <td className={`px-3 ${pad} text-right text-[#EF4444] font-medium`}>{fmtW(d.cost)}</td>
                <td className={`px-3 ${pad} text-right text-[#10B981] font-medium`}>{fmtW(d.revenue)}</td>
                <td className={`px-3 ${pad} text-right font-bold ${
                  d.roas >= 300 ? 'text-[#10B981]' : d.roas >= 100 ? 'text-[#3182F6]' : 'text-[#EF4444]'
                }`}>{d.roas.toFixed(0)}%</td>
                {hasMemo && (
                  <td className={`px-3 ${pad}`}>
                    <input
                      value={memo}
                      onChange={(e) => onSaveMemo!(d.date, e.target.value)}
                      placeholder="메모"
                      className="w-full min-w-[120px] h-7 px-1.5 text-[10px] rounded border border-transparent hover:border-[#E5E8EB] focus:border-[#3182F6] focus:outline-none bg-transparent"
                    />
                  </td>
                )}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-[11px] text-[#B0B8C1]">데이터 없음</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function KPICard({ icon, label, value, sub, accent = 'gray' }: { icon?: React.ReactNode; label: string; value: string; sub?: string; accent?: 'gray' | 'emerald' | 'red' | 'blue' | 'amber' }) {
  const badge = {
    gray: 'bg-[#F2F4F6] text-[#6B7684]',
    emerald: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-orange-50 text-orange-600',
  }[accent];
  return (
    <div className="bg-white rounded-2xl border border-[#F2F4F6] p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${badge}`}>
          {icon}
        </div>
        <span className="text-[12px] text-[#6B7684] font-medium">{label}</span>
      </div>
      <p className="text-[20px] font-bold text-[#191F28] mt-1">{value}</p>
      {sub && <p className="text-[11px] text-[#B0B8C1]">{sub}</p>}
    </div>
  );
}

function ProductCombobox({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        // 미선택 상태로 닫히면 query를 실제 value 로 복원
        setQuery(value);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q === value.toLowerCase()) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [query, value, options]);

  const selectItem = (v: string) => {
    onChange(v);
    setQuery(v);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative flex items-center">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filtered.length > 0) {
              e.preventDefault();
              selectItem(filtered[0]);
            }
            if (e.key === 'Escape') { setOpen(false); setQuery(value); }
          }}
          placeholder={`전체 (${options.length}) · 검색`}
          className="h-9 pl-3 pr-7 rounded-lg border border-[#E5E8EB] text-[13px] text-[#191F28] bg-white focus:outline-none focus:border-[#3182F6] w-[280px]"
        />
        {(value || query) && (
          <button
            onClick={() => { onChange(''); setQuery(''); setOpen(false); }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-[#B0B8C1] hover:bg-[#F2F4F6] hover:text-[#6B7684] flex items-center justify-center text-[14px] leading-none"
            aria-label="필터 초기화"
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-20 top-full mt-1 left-0 w-[340px] max-h-64 overflow-y-auto bg-white border border-[#E5E8EB] rounded-lg shadow-lg">
          <button
            onClick={() => selectItem('')}
            className={`w-full px-3 py-2 text-left text-[12px] hover:bg-[#F8FAFF] border-b border-[#F2F4F6] ${!value ? 'bg-[#EBF5FF] text-[#3182F6] font-medium' : 'text-[#6B7684]'}`}
          >
            전체 ({options.length})
          </button>
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-[12px] text-[#B0B8C1] text-center">일치하는 상품 없음</div>
          )}
          {filtered.slice(0, 100).map((o) => (
            <button
              key={o}
              onClick={() => selectItem(o)}
              className={`w-full px-3 py-2 text-left text-[12px] hover:bg-[#F8FAFF] truncate ${o === value ? 'bg-[#EBF5FF] text-[#3182F6] font-medium' : 'text-[#333D4B]'}`}
              title={o}
            >
              {o}
            </button>
          ))}
          {filtered.length > 100 && (
            <div className="px-3 py-1.5 text-[10px] text-[#B0B8C1] bg-[#FAFBFC] border-t border-[#F2F4F6]">
              상위 100개만 표시 · 더 좁히려면 검색어 입력
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GranToggle({ gran, onChange }: { gran: Gran; onChange: (g: Gran) => void }) {
  return (
    <div className="flex gap-1 bg-[#F2F4F6] rounded-lg p-0.5">
      {(['daily', 'weekly', 'monthly'] as const).map((g) => (
        <button key={g} onClick={() => onChange(g)}
          className={`px-3 py-1.5 text-[12px] rounded-md font-medium transition-colors ${
            gran === g ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684] hover:text-[#333D4B]'
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
