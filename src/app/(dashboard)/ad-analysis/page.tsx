'use client';

import { useState, useMemo, useCallback, useRef, useEffect, Fragment } from 'react';
import { formatNumber } from '@/lib/utils';
import {
  Megaphone, Upload, Loader2, TrendingUp, TrendingDown,
  MousePointerClick, Eye, DollarSign, Target, ArrowUpDown,
  ChevronDown, ChevronUp, ChevronRight, Search, Download, Settings, GripVertical,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, Area, AreaChart, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart,
} from 'recharts';

// ─── Types ──────────────────────────────────────────────────────────────────

interface DailyRow {
  date: string;
  impressions: number; clicks: number; cost: number;
  orders14d: number; revenue14d: number; revenue14d_raw: number;
  cogs14d: number; // 매출원가 (주문수 × 원가)
  commission14d: number; // 판매수수료 (매출 × 수수료율)
}

interface KeywordRow {
  campaign?: string; product?: string;
  keyword: string;
  impressions: number; clicks: number; cost: number;
  orders14d: number; revenue14d: number;
  ctr: number; cpc: number; cvr: number; roas14d: number;
}

interface PlacementRow {
  campaign?: string; product?: string;
  placement: string;
  impressions: number; clicks: number; cost: number;
  orders14d: number; revenue14d: number;
}

interface PlacementDailyRow {
  placement: string; date: string; campaign: string; product: string;
  impressions: number; clicks: number; cost: number;
  orders14d: number; revenue14d: number;
}

interface KeywordDailyRow {
  keyword: string; date: string; campaign: string; product: string;
  impressions: number; clicks: number; cost: number;
  orders14d: number; revenue14d: number;
  cogs14d: number; commission14d: number;
}

interface PriceInfo {
  optionId: string; price: number; cost_price: number;
  product_name: string; sku_code: string;
  commission_rate: number; // 판매대행수수료율 (VAT/전자결제수수료 제외)
  rg_cost: number; // 쿠팡 그로스 부대비용 합산 (입출고+배송+반품+포장 등)
}

interface ParsedRow {
  date: string; campaign: string; product: string;
  impressions: number; clicks: number; cost: number;
  orders14d: number; revenue14d: number; revenue14d_raw: number;
  cogs14d: number;
  commission14d: number;
  keywordCount: number;
  clickKeywordCount: number;
}

interface AnalysisData {
  totalRows: number;
  dateRange: { from: string; to: string };
  priceInfo: PriceInfo[];
  unmatchedOptionIds: string[];
  campaigns: string[];
  products: string[];
  rows: ParsedRow[];
  totals: DailyRow;
  daily: DailyRow[];
  keywords: KeywordRow[];
  placements: PlacementRow[];
  placementDaily: PlacementDailyRow[];
  keywordDaily: KeywordDailyRow[];
  _rawRows?: any[]; // 누적 업로드용 원본 데이터
  _diagnostics?: {
    skippedNoDate: number;     // 날짜 파싱 실패로 버려진 행 수
    sampleKeys: string[];      // 첫 행의 컬럼명들 (디버깅)
    missingCols: string[];     // 기대 컬럼 중 빠진 것
  };
}

// ─── Granularity helpers ────────────────────────────────────────────────────

type Granularity = 'daily' | 'weekly' | 'monthly';

// 쿠팡 광고 xlsx '날짜' 컬럼을 'YYYY-MM-DD'로 정규화.
// 받을 수 있는 형태: 'YYYYMMDD' / 'YYYY-MM-DD' / 'YYYY/MM/DD' / Date 객체 / Excel 날짜 시리얼(숫자)
function normalizeDate(raw: unknown): string {
  if (raw == null || raw === '') return '';
  // Date 객체
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear(), m = raw.getMonth() + 1, d = raw.getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  // Excel 날짜 시리얼 (1900-01-01 기준, 1900 윤년 버그 보정)
  if (typeof raw === 'number' && raw > 0 && raw < 90000) {
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const dt = new Date(ms);
    if (!isNaN(dt.getTime())) {
      const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  const s = String(raw).trim();
  // 'YYYYMMDD' (8자리 숫자)
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  // 'YYYY-MM-DD' / 'YYYY/MM/DD' / 'YYYY.MM.DD'
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return '';
}

function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  const wn = 1 + Math.round(((d.getTime() - w1.getTime()) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(wn).padStart(2, '0')}`;
}

function bucketKey(dateStr: string, gran: Granularity): string {
  if (gran === 'daily') return dateStr;
  if (gran === 'monthly') return dateStr.slice(0, 7);
  return isoWeekKey(dateStr);
}

function bucketLabel(key: string, gran: Granularity): string {
  if (gran === 'daily') return key.slice(5); // 03-09
  if (gran === 'monthly') return key; // 2026-03
  // weekly: 2026-W11 → "3월 2주차"
  const [yearStr, weekPart] = key.split('-W');
  const wn = Number(weekPart);
  const year = Number(yearStr);
  // ISO week → approximate date
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = (jan4.getDay() + 6) % 7; // Mon=0
  const weekStart = new Date(jan4.getTime() + ((wn - 1) * 7 - dayOfWeek) * 86400000);
  const month = weekStart.getMonth() + 1;
  // Week-of-month: count which week of the month this is
  const firstOfMonth = new Date(weekStart.getFullYear(), weekStart.getMonth(), 1);
  const firstMonday = new Date(firstOfMonth.getTime() + ((8 - (firstOfMonth.getDay() || 7)) % 7) * 86400000);
  const weekOfMonth = Math.floor((weekStart.getTime() - firstMonday.getTime()) / (7 * 86400000)) + 1;
  const wom = weekOfMonth < 1 ? 1 : weekOfMonth;
  return `${month}월 ${wom}주차`;
}

interface BucketRow extends DailyRow {
  label: string;
  keywordCount: number;
  clickKeywordCount: number;
}

function aggregateByGranularity(daily: DailyRow[], gran: Granularity, compactRows?: ParsedRow[]): BucketRow[] {
  const map = new Map<string, BucketRow>();

  for (const d of daily) {
    const key = bucketKey(d.date, gran);
    if (!map.has(key)) {
      map.set(key, {
        date: key, label: bucketLabel(key, gran),
        impressions: 0, clicks: 0, cost: 0,
        orders14d: 0, revenue14d: 0, revenue14d_raw: 0,
        cogs14d: 0,
        commission14d: 0,
        keywordCount: 0,
        clickKeywordCount: 0,
      });
    }
    const b = map.get(key)!;
    b.impressions += d.impressions;
    b.clicks += d.clicks;
    b.cost += d.cost;
    b.orders14d += d.orders14d;
    b.revenue14d += d.revenue14d;
    b.revenue14d_raw += d.revenue14d_raw;
    b.cogs14d += d.cogs14d;
    b.commission14d += d.commission14d;
  }

  // Sum keyword counts from compact rows per bucket
  // 일별 bucket 에서는 정확, 주/월 bucket 은 캠페인·상품별 중복 가능 (근사치)
  if (compactRows) {
    const kwMap = new Map<string, number>();
    const kwClickMap = new Map<string, number>();
    for (const r of compactRows) {
      const key = bucketKey(r.date, gran);
      kwMap.set(key, (kwMap.get(key) ?? 0) + (r.keywordCount ?? 0));
      kwClickMap.set(key, (kwClickMap.get(key) ?? 0) + (r.clickKeywordCount ?? 0));
    }
    for (const [key, count] of kwMap) {
      const b = map.get(key);
      if (b) b.keywordCount = count;
    }
    for (const [key, count] of kwClickMap) {
      const b = map.get(key);
      if (b) b.clickKeywordCount = count;
    }
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Chart metric config ────────────────────────────────────────────────────

type MetricKey = 'cost' | 'revenue14d' | 'roas14d' |
  'impressions' | 'clicks' | 'orders14d' | 'ctr' | 'cvr' | 'cpc' | 'cpm' | 'cpa' | 'profit';

interface MetricDef {
  key: MetricKey;
  label: string;
  type: 'bar' | 'line';       // default chart type
  unit: 'won' | 'pct' | 'cnt';
  color: string;
  getValue: (d: any) => number;
}

const METRICS: MetricDef[] = [
  { key: 'cost',       label: '광고비',      type: 'line', unit: 'won', color: '#F43F5E', getValue: (d) => d.cost },
  { key: 'revenue14d', label: '매출(14일)',   type: 'line', unit: 'won', color: '#3182F6', getValue: (d) => d.revenue14d },
  { key: 'roas14d',    label: 'ROAS(14일)',   type: 'bar',  unit: 'pct', color: '#10B981', getValue: (d) => d.cost > 0 ? d.revenue14d / d.cost : 0 },
  { key: 'impressions',label: '노출',         type: 'line', unit: 'cnt', color: '#8B95A1', getValue: (d) => d.impressions },
  { key: 'clicks',     label: '클릭',         type: 'line', unit: 'cnt', color: '#8B5CF6', getValue: (d) => d.clicks },
  { key: 'orders14d',  label: '주문(14일)',   type: 'bar',  unit: 'cnt', color: '#F97316', getValue: (d) => d.orders14d },
  { key: 'ctr',        label: 'CTR',          type: 'line', unit: 'pct', color: '#06B6D4', getValue: (d) => d.impressions > 0 ? d.clicks / d.impressions : 0 },
  { key: 'cvr',        label: 'CVR(14일)',    type: 'line', unit: 'pct', color: '#EAB308', getValue: (d) => d.clicks > 0 ? d.orders14d / d.clicks : 0 },
  { key: 'cpc',        label: 'CPC',          type: 'line', unit: 'won', color: '#A855F7', getValue: (d) => d.clicks > 0 ? d.cost / d.clicks : 0 },
  { key: 'cpm',        label: 'CPM',          type: 'line', unit: 'won', color: '#0EA5E9', getValue: (d) => d.impressions > 0 ? d.cost / d.impressions * 1000 : 0 },
  { key: 'cpa',        label: 'CPA',          type: 'line', unit: 'won', color: '#F97316', getValue: (d) => d.orders14d > 0 ? d.cost / d.orders14d : 0 },
  { key: 'profit',     label: '순이익(14일)', type: 'bar',  unit: 'won', color: '#22C55E', getValue: (d) => d.revenue14d - d.cogs14d - (d.commission14d ?? 0) - d.cost },
];

const DEFAULT_METRICS: MetricKey[] = ['cost', 'revenue14d', 'roas14d'];

// ─── Helpers ────────────────────────────────────────────────────────────────

const pct = (n: number) => (n * 100).toFixed(2) + '%';
// 원 기호 없는 금액 포맷
const fmtW = (n: number) => Math.round(n).toLocaleString('ko-KR');

type SortKey = 'cost' | 'clicks' | 'impressions' | 'orders14d' | 'revenue14d' | 'ctr' | 'cpc' | 'cvr' | 'roas14d';

// ─── KPI Definitions ────────────────────────────────────────────────────────

type KpiKey = 'cost' | 'roas' | 'revenue' | 'orders' | 'cpc' | 'ctr' | 'cvr' | 'cpm' | 'cpa' | 'aov' | 'adRatio' | 'impressions' | 'clicks';

interface KpiDef {
  key: KpiKey;
  label: string;
  icon: React.ElementType;
  color: string;
  getValue: (t: any, extra: any) => string;
  getSub?: (t: any, extra: any) => string;
}

const KPI_DEFS: KpiDef[] = [
  { key: 'cost', label: '광고비 (VAT포함)', icon: DollarSign, color: 'bg-red-50 text-red-600',
    getValue: (t) => fmtW(t.cost) },
  { key: 'roas', label: 'ROAS (14일)', icon: TrendingUp, color: 'bg-green-50 text-green-600',
    getValue: (t) => `${(t.cost > 0 ? t.revenue14d / t.cost * 100 : 0).toFixed(0)}%` },
  { key: 'revenue', label: '전환매출 (14일)', icon: Target, color: 'bg-blue-50 text-blue-600',
    getValue: (t) => fmtW(t.revenue14d) },
  { key: 'orders', label: '주문수 (14일)', icon: Megaphone, color: 'bg-purple-50 text-purple-600',
    getValue: (t) => `${t.orders14d}건` },
  { key: 'cpc', label: 'CPC', icon: MousePointerClick, color: 'bg-cyan-50 text-cyan-600',
    getValue: (t) => t.clicks > 0 ? fmtW(Math.round(t.cost / t.clicks)) : '-',
    getSub: (t) => `클릭 ${formatNumber(t.clicks)}` },
  { key: 'ctr', label: 'CTR', icon: MousePointerClick, color: 'bg-sky-50 text-sky-600',
    getValue: (t) => t.impressions > 0 ? pct(t.clicks / t.impressions) : '-' },
  { key: 'cvr', label: 'CVR (14일)', icon: Eye, color: 'bg-amber-50 text-amber-600',
    getValue: (t) => t.clicks > 0 ? pct(t.orders14d / t.clicks) : '-' },
  { key: 'cpm', label: 'CPM', icon: Eye, color: 'bg-teal-50 text-teal-600',
    getValue: (t) => t.impressions > 0 ? fmtW(Math.round(t.cost / t.impressions * 1000)) : '-',
    getSub: (t) => `노출 ${formatNumber(t.impressions)}` },
  { key: 'cpa', label: 'CPA (건당 광고비)', icon: DollarSign, color: 'bg-orange-50 text-orange-600',
    getValue: (t) => t.orders14d > 0 ? fmtW(Math.round(t.cost / t.orders14d)) : '-' },
  { key: 'aov', label: 'AOV (평균 주문가)', icon: Target, color: 'bg-indigo-50 text-indigo-600',
    getValue: (t) => t.orders14d > 0 ? fmtW(Math.round(t.revenue14d / t.orders14d)) : '-' },
  { key: 'adRatio', label: '광고비율', icon: TrendingDown, color: 'bg-rose-50 text-rose-600',
    getValue: (t) => t.revenue14d > 0 ? pct(t.cost / t.revenue14d) : '-',
    getSub: () => '광고비 ÷ 매출' },
  { key: 'impressions', label: '노출수', icon: Eye, color: 'bg-gray-50 text-gray-600',
    getValue: (t) => formatNumber(t.impressions) },
  { key: 'clicks', label: '클릭수', icon: MousePointerClick, color: 'bg-violet-50 text-violet-600',
    getValue: (t) => formatNumber(t.clicks) },
];

const DEFAULT_KPIS: KpiKey[] = ['cost', 'roas', 'revenue', 'orders', 'cpc', 'ctr', 'cvr', 'cpm'];
const KPI_STORAGE_KEY = 'lv-erp-ad-kpis';

function loadKpis(): KpiKey[] {
  if (typeof window === 'undefined') return DEFAULT_KPIS;
  try {
    const saved = localStorage.getItem(KPI_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_KPIS;
}

// ─── KPI Card ───────────────────────────────────────────────────────────────

function KPI({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#F2F4F6] p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-[12px] text-[#6B7684] font-medium">{label}</span>
      </div>
      <p className="text-[20px] font-bold text-[#191F28] mt-1">{value}</p>
      {sub && <p className="text-[11px] text-[#B0B8C1]">{sub}</p>}
    </div>
  );
}

// ─── Metric Chip ────────────────────────────────────────────────────────────

function MetricChip({ m, active, onClick }: { m: MetricDef; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all border ${
        active
          ? 'border-[#191F28] bg-white text-[#191F28] shadow-sm'
          : 'border-[#E5E8EB] bg-[#F8F9FA] text-[#8B95A1] hover:border-[#B0B8C1]'
      }`}
    >
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: m.color, opacity: active ? 1 : 0.4 }} />
      {m.label}
      <span className="text-[10px] opacity-60">{m.type === 'bar' ? '■' : '─'}</span>
    </button>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

interface UploadInfo { filename: string; row_count: number; uploaded_at: string; }

interface PendingMatch {
  adName: string;
  dbName: string;
  price: number;
  cost_price: number;
  commission_rate: number;
  sku_code: string;
  score: number; // 매칭 신뢰도
  status: 'pending' | 'confirmed' | 'ignored';
}

export default function AdAnalysisPage() {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rgSaverMonthly, setRgSaverMonthly] = useState(0);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [pendingMatches, setPendingMatches] = useState<PendingMatch[]>([]);
  const [pendingRaw, setPendingRaw] = useState<any[] | null>(null); // 확인 대기 중인 raw 데이터
  const [tab, setTab] = useState<'daily' | 'keywords' | 'placements' | 'products'>('daily');
  const [pivotAxis, setPivotAxis] = useState<'kw-date' | 'date-kw'>('kw-date');
  const [pivotMetric, setPivotMetric] = useState<'cost' | 'impressions' | 'clicks' | 'orders14d' | 'revenue14d' | 'ctr' | 'cvr' | 'roas' | 'cpc' | 'keywordCount' | 'clickKeywordCount'>('cost');
  const [pivotTopN, setPivotTopN] = useState(50);
  const [gran, setGran] = useState<Granularity>('daily');
  const [activeMetrics, setActiveMetrics] = useState<MetricKey[]>(DEFAULT_METRICS);
  const [filterCampaign, setFilterCampaign] = useState('all');
  const [filterProduct, setFilterProduct] = useState('all');
  const [activeKpis, setActiveKpis] = useState<KpiKey[]>(loadKpis);
  const [kpiEditOpen, setKpiEditOpen] = useState(false);
  const [trendSortKey, setTrendSortKey] = useState<string>('date');
  const [trendSortAsc, setTrendSortAsc] = useState(true);
  const [tableColEdit, setTableColEdit] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('cost');
  const [sortAsc, setSortAsc] = useState(false);
  const [kwSearch, setKwSearch] = useState('');
  const [kwLimit, setKwLimit] = useState(50);
  const [pivotDim, setPivotDim] = useState<'product' | 'campaign' | 'keyword'>('product');
  const [pivotGran, setPivotGran] = useState<Granularity | 'total'>('weekly');
  const [pivotSortKey, setPivotSortKey] = useState<string>('cost');
  const [pivotSortAsc, setPivotSortAsc] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [prodMetric, setProdMetric] = useState<string>('cost');
  const [expandedDims, setExpandedDims] = useState<Set<string>>(new Set());
  const [pivotSearch, setPivotSearch] = useState('');
  const [kwOnlyOrders, setKwOnlyOrders] = useState(false);
  const [expandedKw, setExpandedKw] = useState<string | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [placeGran, setPlaceGran] = useState<Granularity | 'total'>('weekly');
  const [expandedPlaces, setExpandedPlaces] = useState<Set<string>>(new Set());
  const [placeSearch, setPlaceSearch] = useState('');
  const [placeMetric, setPlaceMetric] = useState<'cost' | 'impressions' | 'clicks' | 'orders14d' | 'revenue14d'>('cost');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  // 사용자가 직접 기간을 만진 적이 있으면 자동 핏을 멈춘다
  const dateTouchedRef = useRef(false);
  const setDateFromUser = (v: string) => { dateTouchedRef.current = true; setDateFrom(v); };
  const setDateToUser = (v: string) => { dateTouchedRef.current = true; setDateTo(v); };
  const [metricTypes, setMetricTypes] = useState<Record<string, 'bar' | 'line'>>({});
  const [rightAxisKeys, setRightAxisKeys] = useState<Set<string>>(new Set());
  const [memos, setMemos] = useState<Record<string, string>>({});
  const [placeShowRoas, setPlaceShowRoas] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Toggle KPI
  const toggleKpi = (key: KpiKey) => {
    setActiveKpis((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try { localStorage.setItem(KPI_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Toggle metric
  const toggleMetric = (key: MetricKey) => {
    setActiveMetrics((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  // ─── 데이터 테이블 컬럼 ──────────────────────────────────────────
  type TableColKey = 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'cost' | 'orders14d' | 'revenue14d' | 'roas' | 'cvr' | 'cpm' | 'cpa' | 'profit' | 'adRatio' | 'aov' | 'keywordCount' | 'clickKeywordCount';

  interface TableColDef {
    key: TableColKey;
    label: string;
    render: (d: any) => React.ReactNode;
    renderTotal: (t: any) => React.ReactNode;
    className?: string;
  }

  const TABLE_COLS: TableColDef[] = [
    { key: 'impressions', label: '노출',
      render: (d) => formatNumber(d.impressions),
      renderTotal: (t) => formatNumber(t.impressions) },
    { key: 'clicks', label: '클릭',
      render: (d) => formatNumber(d.clicks),
      renderTotal: (t) => formatNumber(t.clicks), className: 'text-[#191F28]' },
    { key: 'ctr', label: 'CTR',
      render: (d) => d.impressions > 0 ? pct(d.clicks / d.impressions) : '-',
      renderTotal: (t) => t.impressions > 0 ? pct(t.clicks / t.impressions) : '-' },
    { key: 'cpc', label: 'CPC',
      render: (d) => d.clicks > 0 ? fmtW(Math.round(d.cost / d.clicks)) : '-',
      renderTotal: (t) => t.clicks > 0 ? fmtW(Math.round(t.cost / t.clicks)) : '-' },
    { key: 'cost', label: '광고비(VAT)',
      render: (d) => fmtW(d.cost),
      renderTotal: (t) => fmtW(t.cost), className: 'text-[#F43F5E] font-medium' },
    { key: 'orders14d', label: '주문(14d)',
      render: (d) => d.orders14d,
      renderTotal: (t) => t.orders14d },
    { key: 'revenue14d', label: '매출(14d)',
      render: (d) => fmtW(d.revenue14d),
      renderTotal: (t) => fmtW(t.revenue14d), className: 'text-[#3182F6] font-medium' },
    { key: 'roas', label: 'ROAS(14d)',
      render: (d) => { const r = d.cost > 0 ? d.revenue14d / d.cost : 0; return <span className={r >= 1 ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}>{d.cost > 0 ? `${(r * 100).toFixed(0)}%` : '-'}</span>; },
      renderTotal: (t) => { const r = t.cost > 0 ? t.revenue14d / t.cost : 0; return <span className={r >= 1 ? 'text-green-600' : 'text-red-500'}>{(r * 100).toFixed(0)}%</span>; } },
    { key: 'cvr', label: 'CVR(14d)',
      render: (d) => d.clicks > 0 ? pct(d.orders14d / d.clicks) : '-',
      renderTotal: (t) => t.clicks > 0 ? pct(t.orders14d / t.clicks) : '-' },
    { key: 'cpm', label: 'CPM',
      render: (d) => d.impressions > 0 ? fmtW(Math.round(d.cost / d.impressions * 1000)) : '-',
      renderTotal: (t) => t.impressions > 0 ? fmtW(Math.round(t.cost / t.impressions * 1000)) : '-' },
    { key: 'cpa', label: 'CPA',
      render: (d) => d.orders14d > 0 ? fmtW(Math.round(d.cost / d.orders14d)) : '-',
      renderTotal: (t) => t.orders14d > 0 ? fmtW(Math.round(t.cost / t.orders14d)) : '-' },
    { key: 'aov', label: 'AOV',
      render: (d) => d.orders14d > 0 ? fmtW(Math.round(d.revenue14d / d.orders14d)) : '-',
      renderTotal: (t) => t.orders14d > 0 ? fmtW(Math.round(t.revenue14d / t.orders14d)) : '-' },
    { key: 'adRatio', label: '광고비율',
      render: (d) => d.revenue14d > 0 ? pct(d.cost / d.revenue14d) : '-',
      renderTotal: (t) => t.revenue14d > 0 ? pct(t.cost / t.revenue14d) : '-' },
    { key: 'profit', label: '순이익(14d)',
      render: (d) => { const p = d.revenue14d - (d.cogs14d ?? 0) - (d.commission14d ?? 0) - d.cost; return <span className={p >= 0 ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>{fmtW(p)}</span>; },
      renderTotal: (t) => { const p = t.revenue14d - t.cogs14d - (t.commission14d ?? 0) - t.cost; return <span className={p >= 0 ? 'text-green-600' : 'text-red-500'}>{fmtW(p)}</span>; } },
    { key: 'keywordCount', label: '노출 키워드수',
      render: (d) => formatNumber(d.keywordCount ?? 0),
      renderTotal: () => '-', className: 'text-[#8B5CF6] font-medium' },
    { key: 'clickKeywordCount', label: '유입 키워드수',
      render: (d) => formatNumber(d.clickKeywordCount ?? 0),
      renderTotal: () => '-', className: 'text-[#10B981] font-medium' },
  ];

  const DEFAULT_TABLE_COLS: TableColKey[] = ['impressions', 'clicks', 'ctr', 'cpc', 'cost', 'orders14d', 'revenue14d', 'roas', 'keywordCount', 'clickKeywordCount'];
  const TABLE_COL_STORAGE = 'lv-erp-ad-table-cols';

  const [activeCols, setActiveCols] = useState<TableColKey[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_TABLE_COLS;
    try { const s = localStorage.getItem(TABLE_COL_STORAGE); if (s) return JSON.parse(s); } catch {}
    return DEFAULT_TABLE_COLS;
  });

  const toggleCol = (key: TableColKey) => {
    setActiveCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try { localStorage.setItem(TABLE_COL_STORAGE, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const colMap = Object.fromEntries(TABLE_COLS.map((c) => [c.key, c]));
  const visibleCols = activeCols.map((k) => colMap[k]).filter(Boolean);
  const dragCol = useRef<string | null>(null);
  const handleColDragStart = (key: string) => { dragCol.current = key; };
  const handleColDrop = (targetKey: string) => {
    if (!dragCol.current || dragCol.current === targetKey) return;
    setActiveCols((prev) => {
      const from = prev.indexOf(dragCol.current!);
      const to = prev.indexOf(targetKey);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, dragCol.current!);
      try { localStorage.setItem(TABLE_COL_STORAGE, JSON.stringify(next)); } catch {}
      return next;
    });
    dragCol.current = null;
  };

  // ─── 매칭 유틸 ───────────────────────────────────────────────────
  const tokenize = (s: string) => s.toLowerCase().replace(/[()（）]/g, '').split(/[\s,]+/).filter(w => w.length >= 2);

  const fuzzyMatch = (adName: string, pricesByName: Record<string, any>, priceNameKeys: string[]) => {
    const lower = adName.toLowerCase();
    if (pricesByName[lower]) return { info: pricesByName[lower], dbName: lower, score: 1 };
    for (const key of priceNameKeys) {
      if (lower.includes(key) || key.includes(lower)) return { info: pricesByName[key], dbName: key, score: 0.9 };
    }
    const adWords = tokenize(adName);
    let best: any = null, bestKey = '', bestScore = 0;
    for (const key of priceNameKeys) {
      const dbWords = tokenize(key);
      const overlap = adWords.filter(w => dbWords.some(d => d.includes(w) || w.includes(d))).length;
      const score = overlap / Math.max(adWords.length, dbWords.length);
      if (score > bestScore && score >= 0.5) { bestScore = score; best = pricesByName[key]; bestKey = key; }
    }
    return best ? { info: best, dbName: bestKey, score: bestScore } : null;
  };

  // ─── 데이터 처리 (prices 맵 기반) ──────────────────────────────
  const processData = useCallback((raw: any[], prices: Record<string, any>, confirmedMap: Record<string, any>, rgSaverMonthly = 0, monthlyTotal = 0) => {
    const matchedIds = new Set<string>();
    const unmatchedIds = new Set<string>();
    const dailyMap = new Map<string, any>();
    const kwMap = new Map<string, any>();
    const plMap = new Map<string, any>();
    const plDateMap = new Map<string, any>();
    const kwDateMap = new Map<string, any>();
    const compactMap = new Map<string, any>();

    let skippedNoDate = 0;
    for (const r of raw) {
      const date = normalizeDate(r['날짜']);
      if (!date) { skippedNoDate++; continue; }
      const keyword = r['키워드'] || '-';
      const placement = r['광고 노출 지면'] || '기타';
      const campaign = r['캠페인명'] || '기타';
      const rawProduct = String(r['광고집행 상품명'] ?? '');
      const product = rawProduct.split(',')[0].trim() || '기타';
      const convOptionId = String(r['광고전환매출발생 옵션ID'] ?? '');

      const impressions = Number(r['노출수']) || 0;
      const clicks = Number(r['클릭수']) || 0;
      const cost = Math.round((Number(r['광고비']) || 0) * 1.1);
      const orders14d = Number(r['총 주문수(14일)']) || 0;
      const revenue14d_raw = Number(r['총 전환매출액(14일)']) || 0;

      // 매칭: 옵션ID → 저장된 매핑 → 없으면 null (미매칭)
      const matched = prices[convOptionId] ?? confirmedMap[product] ?? null;
        if (matched && orders14d > 0) matchedIds.add(convOptionId);
        else if (!matched && orders14d > 0) unmatchedIds.add(convOptionId);

        const actualPrice = matched?.price ?? 0;
        const costPrice = matched?.cost_price ?? 0;
        const commissionRate = matched?.commission_rate ?? 0;
        const rgCost = matched?.rg_cost ?? 0;
        // 매칭 시 DB 가격 × 주문수, 미매칭 시 0 (CSV raw 사용 안 함)
        const revenue14d = actualPrice ? orders14d * actualPrice : 0;
        const cogs14d = costPrice ? orders14d * (costPrice + rgCost) : 0;
        const commission14d = commissionRate ? revenue14d * (commissionRate / 100) : 0;

        // Daily
        if (!dailyMap.has(date)) dailyMap.set(date, { date, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, revenue14d_raw: 0, cogs14d: 0, commission14d: 0 });
        const d = dailyMap.get(date)!;
        d.impressions += impressions; d.clicks += clicks; d.cost += cost;
        d.orders14d += orders14d; d.revenue14d += revenue14d; d.revenue14d_raw += revenue14d_raw;
        d.cogs14d += cogs14d;
        d.commission14d += commission14d;

        // Keywords by campaign+product
        if (keyword !== '-') {
          const kwKey = `${campaign}||${product}||${keyword}`;
          if (!kwMap.has(kwKey)) kwMap.set(kwKey, { campaign, product, keyword, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0 });
          const k = kwMap.get(kwKey)!;
          k.impressions += impressions; k.clicks += clicks; k.cost += cost;
          k.orders14d += orders14d; k.revenue14d += revenue14d;

          // Keyword × date (for period breakdown)
          const kwDateKey = `${campaign}||${product}||${keyword}||${date}`;
          if (!kwDateMap.has(kwDateKey)) kwDateMap.set(kwDateKey, { keyword, date, campaign, product, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, cogs14d: 0, commission14d: 0 });
          const kd = kwDateMap.get(kwDateKey)!;
          kd.impressions += impressions; kd.clicks += clicks; kd.cost += cost;
          kd.orders14d += orders14d; kd.revenue14d += revenue14d;
          kd.cogs14d += cogs14d; kd.commission14d += commission14d;
        }

        // Placements by campaign+product
        const plKey = `${campaign}||${product}||${placement}`;
        if (!plMap.has(plKey)) plMap.set(plKey, { campaign, product, placement, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0 });
        const p = plMap.get(plKey)!;
        p.impressions += impressions; p.clicks += clicks; p.cost += cost;
        p.orders14d += orders14d; p.revenue14d += revenue14d;

        // Placement × date (for period breakdown)
        const plDateKey = `${campaign}||${product}||${placement}||${date}`;
        if (!plDateMap.has(plDateKey)) plDateMap.set(plDateKey, { placement, date, campaign, product, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0 });
        const pd = plDateMap.get(plDateKey)!;
        pd.impressions += impressions; pd.clicks += clicks; pd.cost += cost;
        pd.orders14d += orders14d; pd.revenue14d += revenue14d;

        // Compact rows (date+campaign+product)
        const cKey = `${date}|${campaign}|${product}`;
        if (!compactMap.has(cKey)) compactMap.set(cKey, { date, campaign, product, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, revenue14d_raw: 0, cogs14d: 0, commission14d: 0, _kw: new Set<string>(), _kwClick: new Set<string>() });
        const c = compactMap.get(cKey)!;
        c.impressions += impressions; c.clicks += clicks; c.cost += cost;
        c.orders14d += orders14d; c.revenue14d += revenue14d; c.revenue14d_raw += revenue14d_raw;
        c.cogs14d += cogs14d;
        c.commission14d += commission14d;
        if (keyword !== '-' && impressions > 0) c._kw.add(keyword);
        if (keyword !== '-' && clicks > 0) c._kwClick.add(keyword);
      }

      const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));

      // 월 고정비용 일할 배분 (세이버 + 인건비/관리비 등)
      const totalMonthlyFixed = rgSaverMonthly + monthlyTotal;
      if (totalMonthlyFixed > 0 && daily.length > 0) {
        const dailyFixed = Math.round(totalMonthlyFixed / 30);
        for (const d of daily) d.cogs14d += dailyFixed;
      }

      const keywords = [...kwMap.values()].sort((a, b) => b.cost - a.cost).map((k: any) => ({
        ...k, ctr: k.impressions > 0 ? k.clicks / k.impressions : 0, cpc: k.clicks > 0 ? Math.round(k.cost / k.clicks) : 0,
        cvr: k.clicks > 0 ? k.orders14d / k.clicks : 0, roas14d: k.cost > 0 ? k.revenue14d / k.cost : 0,
      }));
      const placements = [...plMap.values()].sort((a, b) => b.cost - a.cost);
      const placementDaily = [...plDateMap.values()];
      const keywordDaily = [...kwDateMap.values()];
      const rows = [...compactMap.values()].map(({ _kw, _kwClick, ...rest }: any) => ({ ...rest, keywordCount: _kw.size, clickKeywordCount: _kwClick.size }));

      const totals = daily.reduce((acc: any, d: any) => {
        acc.impressions += d.impressions; acc.clicks += d.clicks; acc.cost += d.cost;
        acc.orders14d += d.orders14d; acc.revenue14d += d.revenue14d; acc.revenue14d_raw += d.revenue14d_raw;
        acc.cogs14d += d.cogs14d;
        acc.commission14d += d.commission14d;
        return acc;
      }, { impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, revenue14d_raw: 0, cogs14d: 0, commission14d: 0 });

      const campaigns = [...new Set(rows.map((r: any) => r.campaign))].sort();
      const products = [...new Set(rows.map((r: any) => r.product))].sort();

      const priceInfo = [...matchedIds].map((id) => {
        const info = prices[id] ?? confirmedMap[id];
        return info ? { optionId: id, ...info } : null;
      }).filter(Boolean) as PriceInfo[];

      // 진단: 컬럼 매칭 점검 (이름이 바뀌면 노출/광고비/주문이 모두 0이 됨)
      const sample = raw[0] ?? {};
      const sampleKeys = Object.keys(sample);
      const expectedCols = ['날짜', '노출수', '클릭수', '광고비', '총 주문수(14일)', '총 전환매출액(14일)'];
      const missingCols = expectedCols.filter(c => !(c in sample));

      return {
        totalRows: raw.length,
        dateRange: { from: daily[0]?.date, to: daily[daily.length - 1]?.date },
        priceInfo,
        unmatchedOptionIds: [...unmatchedIds],
        campaigns, products, rows, totals, daily, keywords, placements, placementDaily, keywordDaily,
        _rawRows: raw,
        _diagnostics: { skippedNoDate, sampleKeys, missingCols },
      } as AnalysisData;
    }, []);

  // ─── 결과 저장 ─────────────────────────────────────────────────
  const saveResult = useCallback((result: AnalysisData) => {
    setData(result);
  }, []);

  // ─── 청크 업로드 (Vercel serverless body 4.5MB 제한 회피) ────────────
  // 단일 거대 POST 가 조용히 413 으로 실패하던 문제 해결.
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const uploadRowsInChunks = useCallback(async (
    rows: any[],
    filename: string,
    opts: { abortOnFirstFail?: boolean } = {},
  ) => {
    const CHUNK = 5000; // Vercel 4.5MB body 한도 내. 청크 수 ↓ → 빠름
    const totalChunks = Math.ceil(rows.length / CHUNK);
    let inserted = 0, attempted = 0, failedChunks = 0;
    let firstServerError: string | null = null;
    setSyncProgress({ done: 0, total: totalChunks });
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      try {
        const res = await fetch('/api/ad-analysis/rows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: batch, filename }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!firstServerError) firstServerError = j.error || `HTTP ${res.status}`;
          failedChunks++;
          if (opts.abortOnFirstFail) break; // 첫 실패 즉시 중단 → 진단 빠르게
        } else {
          inserted += j.inserted ?? 0;
          attempted += j.attempted ?? batch.length;
          if (j.partialError && !firstServerError) {
            firstServerError = j.partialError;
            if (opts.abortOnFirstFail) {
              setSyncProgress({ done: Math.floor(i / CHUNK) + 1, total: totalChunks });
              break;
            }
          }
        }
      } catch (e: any) {
        failedChunks++;
        if (!firstServerError) firstServerError = e?.message ?? '네트워크 오류';
        if (opts.abortOnFirstFail) break;
      }
      setSyncProgress({ done: Math.floor(i / CHUNK) + 1, total: totalChunks });
    }
    setSyncProgress(null);
    return { inserted, attempted, failedChunks, totalChunks, firstServerError };
  }, []);

  // ─── Upload handler (클라이언트에서 바로 처리, DB 없음) ─────────
  const dedupKey = (r: any) => `${r['날짜']}|${r['키워드']??''}|${r['광고전환매출발생 옵션ID']??''}|${r['광고 노출 지면']??''}`;

  const handleUpload = useCallback(async (files: File[]) => {
    setLoading(true);
    setError('');
    try {
      const [XLSX, pricesRes, mappingsRes] = await Promise.all([
        import('xlsx'),
        fetch('/api/ad-analysis'),
        fetch('/api/ad-analysis/mappings'),
      ]);
      if (!pricesRes.ok) throw new Error('가격 정보 조회 실패');
      const { prices, pricesByName, priceNameKeys, rgSaverMonthly: saverCost, monthlyTotal: mTotal } = await pricesRes.json();
      setRgSaverMonthly(saverCost ?? 0);
      setMonthlyTotal(mTotal ?? 0);
      const { mappings: savedMappings } = mappingsRes.ok ? await mappingsRes.json() : { mappings: [] };

      const confirmedMap: Record<string, any> = {};
      for (const m of savedMappings) {
        confirmedMap[m.ad_product_name] = {
          price: Number(m.price), cost_price: Number(m.cost_price),
          commission_rate: Number(m.commission_rate ?? 0),
          sku_code: m.sku_code ?? '', product_name: m.matched_name ?? '',
        };
      }

      // 여러 파일 동시 읽기
      const allRows: any[] = [];
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        allRows.push(...rows);
      }
      if (!allRows.length) throw new Error('데이터가 없습니다');

      // 중복 제거 (기존 데이터 + 새 파일 누적)
      const seen = new Set<string>();
      let raw: any[] = [];

      // 기존 데이터가 있으면 항상 누적
      if (data?._rawRows) {
        for (const r of data._rawRows) {
          const key = dedupKey(r);
          if (!seen.has(key)) { seen.add(key); raw.push(r); }
        }
      }
      for (const r of allRows) {
        const key = dedupKey(r);
        if (!seen.has(key)) { seen.add(key); raw.push(r); }
      }

      // 미매칭 상품 퍼지 매칭
      const adProductNames = new Set<string>();
      for (const r of raw) {
        const convId = String(r['광고전환매출발생 옵션ID'] ?? '');
        const product = String(r['광고집행 상품명'] ?? '').split(',')[0].trim();
        const hasOrders = (Number(r['총 주문수(14일)']) || 0) > 0;
        if (hasOrders && product && !prices[convId] && !confirmedMap[product]) {
          adProductNames.add(product);
        }
      }

      const pending: PendingMatch[] = [];
      for (const adName of adProductNames) {
        const result = fuzzyMatch(adName, pricesByName, priceNameKeys);
        if (result) {
          pending.push({
            adName, dbName: result.dbName, score: result.score,
            price: result.info.price, cost_price: result.info.cost_price,
            commission_rate: result.info.commission_rate, sku_code: result.info.sku_code,
            status: 'pending',
          });
        }
      }

      if (pending.length > 0) {
        setPendingMatches(pending);
        setPendingRaw(raw);
      }

      const result = processData(raw, prices, confirmedMap, saverCost ?? 0, mTotal ?? 0);
      saveResult(result);

      // 백그라운드: 원본 파일을 Storage에 저장
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        fetch('/api/ad-analysis/upload', { method: 'POST', body: fd }).catch(() => {});
      }
      // IndexedDB에 전체 누적 저장 + DB에 신규분만 백업 (청크로 — Vercel 4.5MB body 제한 회피)
      saveToIdb(raw);
      if (allRows.length > 0) {
        const sync = await uploadRowsInChunks(allRows, files[0]?.name ?? 'upload');
        if (sync.failedChunks > 0) {
          setError(`DB 동기화 부분 실패: ${sync.failedChunks}/${sync.totalChunks} 청크 실패. '${'DB 강제 동기화'}' 버튼으로 재시도하세요.`);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [data, processData, saveResult, uploadRowsInChunks]);

  // 매칭 확인 → DB 저장 → 재처리
  const handleConfirmMatches = useCallback(async () => {
    const confirmed = pendingMatches.filter(m => m.status === 'confirmed');
    if (confirmed.length > 0) {
      try {
        await fetch('/api/ad-analysis/mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mappings: confirmed.map(m => ({
              ad_product_name: m.adName, matched_name: m.dbName,
              price: m.price, cost_price: m.cost_price,
              commission_rate: m.commission_rate, sku_code: m.sku_code,
            })),
          }),
        });
      } catch {}
    }

    setPendingMatches([]);
    setPendingRaw(null);
    // 매핑 반영해서 재처리
    if (pendingRaw) {
      const [pricesRes, mappingsRes] = await Promise.all([
        fetch('/api/ad-analysis'),
        fetch('/api/ad-analysis/mappings'),
      ]);
      const { prices } = pricesRes.ok ? await pricesRes.json() : { prices: {} };
      const { mappings: savedMappings } = mappingsRes.ok ? await mappingsRes.json() : { mappings: [] };
      const confirmedMap: Record<string, any> = {};
      for (const m of savedMappings) {
        confirmedMap[m.ad_product_name] = {
          price: Number(m.price), cost_price: Number(m.cost_price),
          commission_rate: Number(m.commission_rate ?? 0),
          sku_code: m.sku_code ?? '', product_name: m.matched_name ?? '',
        };
      }
      const result = processData(pendingRaw, prices, confirmedMap, rgSaverMonthly, monthlyTotal);
      saveResult(result);
    }
  }, [pendingMatches, pendingRaw, processData, saveResult, rgSaverMonthly, monthlyTotal]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter(f => /\.(xlsx|xls|csv)$/i.test(f.name));
    if (files.length) handleUpload(files);
  }, [handleUpload]);

  // ─── IndexedDB로 클라이언트 로컬에 raw rows 저장/복원 ─────────────
  const idbName = 'lv-erp-ad';
  const idbStore = 'rawRows';
  const openIdb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const req = indexedDB.open(idbName, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(idbStore); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const saveToIdb = async (rows: any[]) => {
    try {
      const db = await openIdb();
      const tx = db.transaction(idbStore, 'readwrite');
      tx.objectStore(idbStore).put(rows, 'data');
      db.close();
    } catch {}
  };
  const loadFromIdb = async (): Promise<any[] | null> => {
    try {
      const db = await openIdb();
      return new Promise((resolve) => {
        const tx = db.transaction(idbStore, 'readonly');
        const req = tx.objectStore(idbStore).get('data');
        req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
        req.onerror = () => { db.close(); resolve(null); };
      });
    } catch { return null; }
  };

  // ─── DB 강제 동기화: 로컬 IDB 전체를 DB 로 밀어넣음 (다른 PC 복원용) ───
  const handleForceSyncToDb = useCallback(async () => {
    if (!data?._rawRows?.length) {
      setError('업로드된 데이터가 없습니다');
      return;
    }
    setError('');
    // 첫 청크 실패 즉시 중단 → 3분 기다리지 않고 1-2초로 진단
    const sync = await uploadRowsInChunks(data._rawRows, 'force-sync', { abortOnFirstFail: true });
    const head = `시도 ${sync.attempted.toLocaleString()}행 / 신규 ${sync.inserted.toLocaleString()}행 (중복 제외)`;
    if (sync.failedChunks > 0 || sync.firstServerError) {
      setError(`DB 동기화 실패 — ${head} · 실패 청크 ${sync.failedChunks}/${sync.totalChunks}` +
        (sync.firstServerError ? ` · 서버 오류: ${sync.firstServerError}` : '') +
        ` · (첫 실패 시 즉시 중단 — 동일 원인이면 나머지도 실패하므로)`);
    } else {
      setError(`DB 동기화 완료 — ${head} (${sync.totalChunks} 청크)`);
    }
  }, [data, uploadRowsInChunks]);

  // ─── 페이지 로드 시 IndexedDB → DB fallback 복원 ─────────────────────────
  const [initialLoading, setInitialLoading] = useState(false);
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (initialLoadDone.current || data) return;
    initialLoadDone.current = true;
    (async () => {
      try {
        setInitialLoading(true);
        // 1차: DB (원본 소스) — PC 이동/브라우저 변경 시에도 즉시 복원
        let cachedRows: any[] | null = null;
        try {
          const dbRes = await fetch('/api/ad-analysis/rows');
          if (dbRes.ok) {
            const { rows: dbRows } = await dbRes.json();
            if (dbRows?.length) {
              cachedRows = dbRows;
              saveToIdb(dbRows);
            }
          }
        } catch {}
        // 2차: DB 실패/0건이면 IndexedDB fallback (오프라인 대비)
        if (!cachedRows?.length) {
          cachedRows = await loadFromIdb();
        }
        if (!cachedRows?.length) return;
        const [pricesRes, mappingsRes] = await Promise.all([
          fetch('/api/ad-analysis'),
          fetch('/api/ad-analysis/mappings'),
        ]);
        if (!pricesRes.ok) return;
        const { prices, rgSaverMonthly: saverCost, monthlyTotal: mTotal } = await pricesRes.json();
        setRgSaverMonthly(saverCost ?? 0);
        setMonthlyTotal(mTotal ?? 0);
        const { mappings: savedMappings } = mappingsRes.ok ? await mappingsRes.json() : { mappings: [] };
        const confirmedMap: Record<string, any> = {};
        for (const m of savedMappings) {
          confirmedMap[m.ad_product_name] = {
            price: Number(m.price), cost_price: Number(m.cost_price),
            commission_rate: Number(m.commission_rate ?? 0),
            sku_code: m.sku_code ?? '', product_name: m.matched_name ?? '',
          };
        }
        const result = processData(cachedRows, prices, confirmedMap, saverCost ?? 0, mTotal ?? 0);
        saveResult(result);
      } catch {
      } finally {
        setInitialLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 메모 로드
  // 데이터 로드 시 기간 자동 핏: 사용자가 한 번도 안 건드렸을 때만,
  // 그리고 현재 dateFrom/dateTo 가 데이터 범위와 겹치지 않을 때만 자동 보정
  useEffect(() => {
    if (dateTouchedRef.current) return;
    const from = data?.dateRange?.from;
    const to = data?.dateRange?.to;
    if (!from || !to) return;
    const overlaps = !(dateTo && dateTo < from) && !(dateFrom && dateFrom > to);
    if (overlaps) return; // 현재 필터 안에 데이터가 들어있으면 그대로 둠
    setDateFrom(from);
    setDateTo(to);
  }, [data?.dateRange?.from, data?.dateRange?.to, dateFrom, dateTo]);

  useEffect(() => {
    fetch('/api/ad-analysis/memos').then(r => r.ok ? r.json() : []).then((list: any[]) => {
      const map: Record<string, string> = {};
      for (const m of list) map[m.date] = m.memo;
      setMemos(map);
    }).catch(() => {});
  }, []);

  const saveMemo = (date: string, memo: string) => {
    setMemos(prev => ({ ...prev, [date]: memo }));
    fetch('/api/ad-analysis/memos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, memo }),
    }).catch(() => {});
  };

  // ── Filtered & re-aggregated data ──────────────────────────────────────
  const filtered = useMemo(() => {
    if (!data) return { rows: [] as ParsedRow[], daily: [] as DailyRow[], keywords: [] as KeywordRow[], placements: [] as PlacementRow[], totals: null as any };

    const fc = filterCampaign;
    const fp = filterProduct;
    const matchRow = (r: { campaign: string; product: string }) =>
      (fc === 'all' || r.campaign === fc) && (fp === 'all' || r.product === fp);

    // Filter compact rows → re-aggregate daily
    const rows = data.rows.filter(matchRow);
    const dMap = new Map<string, DailyRow>();
    for (const r of rows) {
      if (!dMap.has(r.date)) {
        dMap.set(r.date, { date: r.date, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, revenue14d_raw: 0, cogs14d: 0, commission14d: 0 });
      }
      const d = dMap.get(r.date)!;
      d.impressions += r.impressions; d.clicks += r.clicks; d.cost += r.cost;
      d.orders14d += r.orders14d; d.revenue14d += r.revenue14d; d.revenue14d_raw += r.revenue14d_raw;
      d.cogs14d += r.cogs14d;
      d.commission14d += r.commission14d;
    }
    const daily = [...dMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    // Filter keywords (server-aggregated by campaign+product+keyword)
    const fkw = data.keywords.filter(matchRow);
    // Re-aggregate by keyword (merge across campaign/product if both 'all')
    const kMap = new Map<string, any>();
    for (const k of fkw) {
      if (!kMap.has(k.keyword)) kMap.set(k.keyword, { keyword: k.keyword, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0 });
      const m = kMap.get(k.keyword)!;
      m.impressions += k.impressions; m.clicks += k.clicks; m.cost += k.cost;
      m.orders14d += k.orders14d; m.revenue14d += k.revenue14d;
    }
    const keywords: KeywordRow[] = [...kMap.values()].sort((a, b) => b.cost - a.cost).map((k) => ({
      ...k,
      ctr: k.impressions > 0 ? k.clicks / k.impressions : 0,
      cpc: k.clicks > 0 ? Math.round(k.cost / k.clicks) : 0,
      cvr: k.clicks > 0 ? k.orders14d / k.clicks : 0,
      roas14d: k.cost > 0 ? k.revenue14d / k.cost : 0,
    }));

    // Filter placements
    const fpl = data.placements.filter(matchRow);
    const pMap = new Map<string, any>();
    for (const p of fpl) {
      if (!pMap.has(p.placement)) pMap.set(p.placement, { placement: p.placement, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0 });
      const m = pMap.get(p.placement)!;
      m.impressions += p.impressions; m.clicks += p.clicks; m.cost += p.cost;
      m.orders14d += p.orders14d; m.revenue14d += p.revenue14d;
    }
    const placements = [...pMap.values()].sort((a, b) => b.cost - a.cost);

    // Filter placementDaily
    const placementDaily = (data.placementDaily ?? []).filter(matchRow);

    // Filter keywordDaily
    const keywordDaily = (data.keywordDaily ?? []).filter(matchRow);

    // Aggregate by campaign × product
    const cpMap = new Map<string, any>();
    for (const r of rows) {
      const cpKey = `${r.campaign}||${r.product}`;
      if (!cpMap.has(cpKey)) cpMap.set(cpKey, { campaign: r.campaign, product: r.product, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, cogs14d: 0, commission14d: 0 });
      const m = cpMap.get(cpKey)!;
      m.impressions += r.impressions; m.clicks += r.clicks; m.cost += r.cost;
      m.orders14d += r.orders14d; m.revenue14d += r.revenue14d;
      m.cogs14d += r.cogs14d; m.commission14d += r.commission14d;
    }
    const campaignProducts = [...cpMap.values()].sort((a, b) => b.cost - a.cost);

    // Aggregate by product only (cross-campaign)
    const prodMap = new Map<string, any>();
    for (const cp of campaignProducts) {
      if (!prodMap.has(cp.product)) prodMap.set(cp.product, { product: cp.product, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, cogs14d: 0, commission14d: 0 });
      const m = prodMap.get(cp.product)!;
      m.impressions += cp.impressions; m.clicks += cp.clicks; m.cost += cp.cost;
      m.orders14d += cp.orders14d; m.revenue14d += cp.revenue14d;
      m.cogs14d += cp.cogs14d; m.commission14d += cp.commission14d;
    }
    const products = [...prodMap.values()].sort((a, b) => b.cost - a.cost);

    const totals = daily.reduce((acc, d) => {
      acc.impressions += d.impressions; acc.clicks += d.clicks; acc.cost += d.cost;
      acc.orders14d += d.orders14d; acc.revenue14d += d.revenue14d; acc.revenue14d_raw += d.revenue14d_raw;
      acc.cogs14d += d.cogs14d;
      acc.commission14d += d.commission14d;
      return acc;
    }, { impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, revenue14d_raw: 0, cogs14d: 0, commission14d: 0 } as DailyRow);

    return { rows, daily, keywords, placements, placementDaily, keywordDaily, products, campaignProducts, totals };
  }, [data, filterCampaign, filterProduct]);

  // 기간 필터 적용 (차트+테이블+KPI+키워드+지면 모두 반영)
  const dateFiltered = useMemo(() => {
    if (!dateFrom && !dateTo) return filtered;
    const dateInRange = (date: string) => {
      if (dateFrom && date < dateFrom) return false;
      if (dateTo && date > dateTo) return false;
      return true;
    };
    const daily = filtered.daily.filter(d => dateInRange(d.date));
    const totals = daily.reduce((acc, d) => {
      acc.impressions += d.impressions; acc.clicks += d.clicks; acc.cost += d.cost;
      acc.orders14d += d.orders14d; acc.revenue14d += d.revenue14d; acc.revenue14d_raw += d.revenue14d_raw;
      acc.cogs14d += d.cogs14d; acc.commission14d += d.commission14d;
      return acc;
    }, { impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, revenue14d_raw: 0, cogs14d: 0, commission14d: 0 } as DailyRow);
    const filteredRows = filtered.rows.filter(r => dateInRange(r.date));
    // 키워드 재집계 (keywordDaily에서)
    const kwMap = new Map<string, KeywordRow>();
    for (const kd of (filtered.keywordDaily ?? []).filter(d => dateInRange(d.date))) {
      const prev = kwMap.get(kd.keyword) ?? { keyword: kd.keyword, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, ctr: 0, cpc: 0, cvr: 0, roas14d: 0 };
      prev.impressions += kd.impressions; prev.clicks += kd.clicks; prev.cost += kd.cost;
      prev.orders14d += kd.orders14d; prev.revenue14d += kd.revenue14d;
      kwMap.set(kd.keyword, prev);
    }
    const keywords = [...kwMap.values()].map(k => ({
      ...k,
      ctr: k.impressions > 0 ? k.clicks / k.impressions : 0,
      cpc: k.clicks > 0 ? k.cost / k.clicks : 0,
      cvr: k.clicks > 0 ? k.orders14d / k.clicks : 0,
      roas14d: k.cost > 0 ? k.revenue14d / k.cost : 0,
    })).sort((a, b) => b.cost - a.cost);
    // 지면 재집계 (placementDaily에서)
    const plMap = new Map<string, PlacementRow>();
    for (const pd of (filtered.placementDaily ?? []).filter(d => dateInRange(d.date))) {
      const key = pd.placement;
      const prev = plMap.get(key) ?? { placement: key, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, ctr: 0, cpc: 0, cvr: 0, roas14d: 0 };
      prev.impressions += pd.impressions; prev.clicks += pd.clicks; prev.cost += pd.cost;
      prev.orders14d += pd.orders14d; prev.revenue14d += pd.revenue14d;
      plMap.set(key, prev);
    }
    const placements = [...plMap.values()].map(p => ({
      ...p,
      ctr: p.impressions > 0 ? p.clicks / p.impressions : 0,
      cpc: p.clicks > 0 ? p.cost / p.clicks : 0,
      cvr: p.clicks > 0 ? p.orders14d / p.clicks : 0,
      roas14d: p.cost > 0 ? p.revenue14d / p.cost : 0,
    }));
    // 일자별 breakdown 배열들도 기간 필터 적용 (드릴다운/xlsx 에서 사용)
    const keywordDaily = (filtered.keywordDaily ?? []).filter(d => dateInRange(d.date));
    const placementDaily = (filtered.placementDaily ?? []).filter(d => dateInRange(d.date));
    return { ...filtered, daily, totals, rows: filteredRows, keywords, placements, keywordDaily, placementDaily };
  }, [filtered, dateFrom, dateTo]);

  // Aggregated chart data
  const chartData = useMemo(() => {
    if (!dateFiltered.daily.length) return [];
    const buckets = aggregateByGranularity(dateFiltered.daily, gran, dateFiltered.rows);
    return buckets.map((b) => {
      const row: any = { ...b };
      for (const m of METRICS) {
        row[`__${m.key}`] = m.getValue(b);
      }
      return row;
    });
  }, [dateFiltered.daily, dateFiltered.rows, gran]);

  // Sorted trend table data
  const sortedTrendData = useMemo(() => {
    if (!chartData.length) return chartData;
    return [...chartData].sort((a: any, b: any) => {
      const key = trendSortKey;
      let av = a[key] ?? 0;
      let bv = b[key] ?? 0;
      // Compute derived values
      if (key === 'ctr') { av = a.impressions > 0 ? a.clicks / a.impressions : 0; bv = b.impressions > 0 ? b.clicks / b.impressions : 0; }
      if (key === 'cpc') { av = a.clicks > 0 ? a.cost / a.clicks : 0; bv = b.clicks > 0 ? b.cost / b.clicks : 0; }
      if (key === 'roas') { av = a.cost > 0 ? a.revenue14d / a.cost : 0; bv = b.cost > 0 ? b.revenue14d / b.cost : 0; }
      if (typeof av === 'string') return trendSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return trendSortAsc ? av - bv : bv - av;
    });
  }, [chartData, trendSortKey, trendSortAsc]);

  const toggleTrendSort = (key: string) => {
    if (trendSortKey === key) setTrendSortAsc(!trendSortAsc);
    else { setTrendSortKey(key); setTrendSortAsc(key === 'date'); }
  };

  const TrendSortIcon = ({ k }: { k: string }) => (
    trendSortKey === k
      ? (trendSortAsc ? <ChevronUp className="h-3 w-3 inline" /> : <ChevronDown className="h-3 w-3 inline" />)
      : <ArrowUpDown className="h-3 w-3 inline opacity-30" />
  );

  // Active metric defs
  const activeDefs = useMemo(
    () => METRICS.filter((m) => activeMetrics.includes(m.key)),
    [activeMetrics],
  );

  // Determine Y-axis needs
  const needsWon = activeDefs.some((m) => m.unit === 'won');
  const needsPct = activeDefs.some((m) => m.unit === 'pct');
  const needsCnt = activeDefs.some((m) => m.unit === 'cnt');

  // Map unit → yAxisId (max 2 axes)
  const leftUnit = needsWon ? 'won' : needsCnt ? 'cnt' : 'pct';
  const rightUnit = needsPct && leftUnit !== 'pct' ? 'pct' : needsCnt && leftUnit !== 'cnt' ? 'cnt' : null;
  const hasCustomRight = rightAxisKeys.size > 0 && activeMetrics.some(k => rightAxisKeys.has(k));
  const unitToAxis = (u: string, key?: string) => {
    if (key && rightAxisKeys.has(key)) return 'right';
    return u === leftUnit ? 'left' : 'right';
  };

  // Sorted keywords
  const sortedKeywords = useMemo(() => {
    if (!dateFiltered.keywords.length) return [];
    let list = dateFiltered.keywords;
    if (kwOnlyOrders) list = list.filter((k) => k.orders14d > 0);
    if (kwSearch) {
      const q = kwSearch.toLowerCase();
      list = list.filter((k) => k.keyword.toLowerCase().includes(q));
    }
    const sorted = [...list].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return sorted.slice(0, kwLimit);
  }, [dateFiltered.keywords, sortKey, sortAsc, kwSearch, kwLimit, kwOnlyOrders]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortIcon = ({ k }: { k: SortKey }) => (
    sortKey === k
      ? (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
      : <ArrowUpDown className="h-3 w-3 opacity-30" />
  );

  // xlsx download
  const downloadXlsx = useCallback((sheetData: Record<string, any>[], filename: string) => {
    import('xlsx').then((XLSX) => {
      const ws = XLSX.utils.json_to_sheet(sheetData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      XLSX.writeFile(wb, filename);
    });
  }, []);

  const downloadXlsxMulti = useCallback((sheets: { name: string; data: Record<string, any>[] }[], filename: string) => {
    import('xlsx').then((XLSX) => {
      const wb = XLSX.utils.book_new();
      for (const s of sheets) {
        const ws = XLSX.utils.json_to_sheet(s.data);
        XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
      }
      XLSX.writeFile(wb, filename);
    });
  }, []);

  const handleDownload = useCallback(() => {
    if (tab === 'daily') {
      const summary = chartData.map((d: any) => ({
        [gran === 'daily' ? '날짜' : gran === 'weekly' ? '주차' : '월']: d.label,
        노출: d.impressions, 클릭: d.clicks,
        CTR: d.impressions > 0 ? +(d.clicks / d.impressions * 100).toFixed(2) : 0,
        CPC: d.clicks > 0 ? Math.round(d.cost / d.clicks) : 0,
        CPM: d.impressions > 0 ? Math.round(d.cost / d.impressions * 1000) : 0,
        광고비: d.cost, '주문(14일)': d.orders14d, '매출(14일)': d.revenue14d,
        'ROAS(14일)': d.cost > 0 ? +(d.revenue14d / d.cost * 100).toFixed(1) : 0,
        ...(d.keywordCount !== undefined ? { '노출 키워드수': d.keywordCount } : {}),
        ...(d.clickKeywordCount !== undefined ? { '유입 키워드수': d.clickKeywordCount } : {}),
      }));
      // 일자×키워드 long format: 날짜 오름차순 → 광고비 내림차순
      const byDateKw = new Map<string, { date: string; keyword: string; impressions: number; clicks: number; cost: number; orders14d: number; revenue14d: number }>();
      for (const d of (dateFiltered.keywordDaily ?? [])) {
        const key = `${d.date}||${d.keyword}`;
        if (!byDateKw.has(key)) byDateKw.set(key, { date: d.date, keyword: d.keyword, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0 });
        const x = byDateKw.get(key)!;
        x.impressions += d.impressions; x.clicks += d.clicks; x.cost += d.cost;
        x.orders14d += d.orders14d; x.revenue14d += d.revenue14d;
      }
      const dateKw = Array.from(byDateKw.values())
        .sort((a, b) => a.date === b.date ? b.cost - a.cost : a.date.localeCompare(b.date))
        .map((r) => ({
          날짜: r.date, 키워드: r.keyword,
          노출: r.impressions, 클릭: r.clicks, 광고비: r.cost,
          CTR: r.impressions > 0 ? +(r.clicks / r.impressions * 100).toFixed(2) : 0,
          CPC: r.clicks > 0 ? Math.round(r.cost / r.clicks) : 0,
          '주문(14일)': r.orders14d, '매출(14일)': r.revenue14d,
          CVR: r.clicks > 0 ? +(r.orders14d / r.clicks * 100).toFixed(2) : 0,
          ROAS: r.cost > 0 ? +(r.revenue14d / r.cost * 100).toFixed(1) : 0,
        }));
      downloadXlsxMulti(
        [{ name: gran === 'daily' ? '일자' : gran === 'weekly' ? '주차' : '월', data: summary }, { name: '일자×키워드', data: dateKw }],
        `광고분석_${gran}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } else if (tab === 'keywords') {
      const summary = sortedKeywords.map((k) => ({
        키워드: k.keyword, 노출: k.impressions, 클릭: k.clicks, 광고비: k.cost,
        CTR: +(k.ctr * 100).toFixed(2), CPC: k.cpc,
        '주문(14일)': k.orders14d, '매출(14일)': k.revenue14d,
        CVR: +(k.cvr * 100).toFixed(2), 'ROAS(14일)': +(k.roas14d * 100).toFixed(1),
      }));
      // 키워드×일자 long format (필터 적용된 키워드만 포함)
      const kwSet = new Set(sortedKeywords.map((k) => k.keyword));
      const byKwDate = new Map<string, { keyword: string; date: string; impressions: number; clicks: number; cost: number; orders14d: number; revenue14d: number }>();
      for (const d of (dateFiltered.keywordDaily ?? [])) {
        if (!kwSet.has(d.keyword)) continue;
        const key = `${d.keyword}||${d.date}`;
        if (!byKwDate.has(key)) byKwDate.set(key, { keyword: d.keyword, date: d.date, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0 });
        const x = byKwDate.get(key)!;
        x.impressions += d.impressions; x.clicks += d.clicks; x.cost += d.cost;
        x.orders14d += d.orders14d; x.revenue14d += d.revenue14d;
      }
      const daily = Array.from(byKwDate.values())
        .sort((a, b) => a.keyword === b.keyword ? a.date.localeCompare(b.date) : a.keyword.localeCompare(b.keyword))
        .map((r) => ({
          키워드: r.keyword, 날짜: r.date,
          노출: r.impressions, 클릭: r.clicks, 광고비: r.cost,
          CTR: r.impressions > 0 ? +(r.clicks / r.impressions * 100).toFixed(2) : 0,
          CPC: r.clicks > 0 ? Math.round(r.cost / r.clicks) : 0,
          '주문(14일)': r.orders14d, '매출(14일)': r.revenue14d,
          CVR: r.clicks > 0 ? +(r.orders14d / r.clicks * 100).toFixed(2) : 0,
          ROAS: r.cost > 0 ? +(r.revenue14d / r.cost * 100).toFixed(1) : 0,
        }));
      downloadXlsxMulti(
        [{ name: '키워드', data: summary }, { name: '키워드×일자', data: daily }],
        `광고분석_키워드_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } else if (tab === 'placements') {
      const rows = dateFiltered.placements.map((p) => ({
        노출지면: p.placement, 노출: p.impressions, 클릭: p.clicks,
        CTR: p.impressions > 0 ? +(p.clicks / p.impressions * 100).toFixed(2) : 0,
        광고비: p.cost, '주문(14일)': p.orders14d, '매출(14일)': p.revenue14d,
        'ROAS(14일)': p.cost > 0 ? +(p.revenue14d / p.cost * 100).toFixed(1) : 0,
      }));
      downloadXlsx(rows, `광고분석_노출지면_${new Date().toISOString().slice(0, 10)}.xlsx`);
    }
  }, [tab, gran, chartData, sortedKeywords, dateFiltered.placements, dateFiltered.keywordDaily, downloadXlsx, downloadXlsxMulti]);

  // ─── Render ─────────────────────────────────────────────────────────────

  const t = dateFiltered.totals;
  const hasData = data && t && (t.cost > 0 || t.impressions > 0);
  const roas14d = t && t.cost > 0 ? t.revenue14d / t.cost : 0;

  const tabs = [
    { key: 'daily' as const, label: '기간별 추이' },
    { key: 'keywords' as const, label: '키워드 분석' },
    { key: 'placements' as const, label: '지면별' },
    { key: 'products' as const, label: '상품별' },
  ];

  const granOptions: { key: Granularity; label: string }[] = [
    { key: 'daily', label: '일' },
    { key: 'weekly', label: '주' },
    { key: 'monthly', label: '월' },
  ];

  // Tooltip formatter
  const tooltipFormatter = (value: number, name: string) => {
    const m = activeDefs.find((d) => d.label === name);
    if (!m) return [String(value), name];
    if (m.unit === 'pct') return [`${(value * 100).toFixed(1)}%`, name];
    if (m.unit === 'won') return [fmtW(Math.round(value)), name];
    return [formatNumber(Math.round(value)), name];
  };

  const yAxisFormatter = (unit: string) => (v: number) => {
    if (unit === 'pct') return `${(v * 100).toFixed(0)}%`;
    if (unit === 'won') return v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : `${(v / 1000).toFixed(0)}k`;
    return v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Megaphone className="h-5 w-5 text-[#3182F6]" />
          <h1 className="text-[20px] font-bold text-[#191F28]">광고 분석</h1>
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
          {data && (
            <button
              onClick={() => { if (confirm('모든 광고 데이터를 삭제하시겠습니까?')) { setData(null); } }}
              className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[#6B7684] text-[13px] font-medium hover:bg-[#F8F9FA] transition-colors"
            >
              초기화
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files ? [...e.target.files] : [];
            if (files.length) handleUpload(files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Upload zone (no data) */}
      {!data && !loading && (
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
              <p className="text-[12px] text-[#8B95A1] mt-1">이전에 업로드한 광고 데이터를 복원합니다</p>
            </>
          ) : (
            <>
              <Upload className="h-10 w-10 mx-auto text-[#B0B8C1] mb-3" />
              <p className="text-[15px] font-semibold text-[#333D4B]">쿠팡 광고 데이터 (xlsx) 를 드래그하거나 클릭하세요</p>
              <p className="text-[12px] text-[#8B95A1] mt-1">PA 일별 키워드 리포트 · 여러 파일 동시 업로드 가능 · 중복 자동 제거</p>
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

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">{error}</div>
      )}

      {/* 데이터 요약 + DB 동기화 */}
      {data?._rawRows && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#8B95A1]">
          <span>데이터: {data._rawRows.length.toLocaleString()}행 로드됨</span>
          {data.dateRange?.from && data.dateRange?.to && (
            <span>· 데이터 기간: {data.dateRange.from} ~ {data.dateRange.to}</span>
          )}
          {data._diagnostics && data._diagnostics.skippedNoDate > 0 && (
            <span className="text-amber-600">· 날짜 인식 실패 {data._diagnostics.skippedNoDate.toLocaleString()}행 건너뜀</span>
          )}
          {syncProgress ? (
            <span className="text-[#3182F6] font-medium">
              · DB 동기화 중 {syncProgress.done}/{syncProgress.total} 청크
            </span>
          ) : (
            <button
              onClick={handleForceSyncToDb}
              className="px-2 h-6 rounded-md border border-[#BFD7FF] text-[#3182F6] text-[10px] font-medium hover:bg-[#F0F6FF]"
              title="다른 PC 에서 최신 데이터가 안 보일 때 — 이 PC 의 로컬 데이터를 DB 로 강제 푸시"
            >
              DB 강제 동기화
            </button>
          )}
        </div>
      )}

      {/* 기간 선택 (데이터 있으면 항상 노출 — hasData 와 무관) */}
      {data && (
        <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl border border-[#F2F4F6] px-4 py-2.5">
          <span className="text-[12px] font-semibold text-[#191F28]">기간</span>
          <input type="date" value={dateFrom} onChange={e => setDateFromUser(e.target.value)}
            className="h-8 px-2 rounded-lg border border-[#E5E8EB] text-[11px] bg-white" />
          <span className="text-[11px] text-[#6B7684]">~</span>
          <input type="date" value={dateTo} onChange={e => setDateToUser(e.target.value)}
            className="h-8 px-2 rounded-lg border border-[#E5E8EB] text-[11px] bg-white" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { dateTouchedRef.current = true; setDateFrom(''); setDateTo(''); }}
              className="h-8 px-2 rounded-lg text-[10px] text-red-400 hover:bg-red-50 border border-red-200">초기화</button>
          )}
          {data.dateRange?.from && data.dateRange?.to && (
            <button onClick={() => {
              dateTouchedRef.current = false;
              setDateFrom(data.dateRange.from);
              setDateTo(data.dateRange.to);
            }} className="h-8 px-2 rounded-lg text-[10px] text-[#3182F6] hover:bg-[#F0F6FF] border border-[#BFD7FF]">데이터 전체 기간</button>
          )}
          {(dateFrom || dateTo) && (
            <span className="text-[10px] text-[#6B7684] ml-1">
              {dateFiltered.daily.length}일 / {dateFiltered.keywords.length}키워드
            </span>
          )}
        </div>
      )}

      {/* 빈 결과 진단 배너: 데이터는 있는데 hasData=false 일 때 */}
      {data && !hasData && !loading && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-[12px] text-amber-900 space-y-2">
          <div className="font-semibold text-[13px]">표시할 데이터가 없습니다.</div>
          <div className="text-amber-800">
            {data._rawRows?.length?.toLocaleString() ?? 0}행 로드됨 · 데이터 기간 <b>{data.dateRange?.from ?? '?'} ~ {data.dateRange?.to ?? '?'}</b>
            {(dateFrom || dateTo) && <> · 현재 필터 <b>{dateFrom || '~'} ~ {dateTo || '~'}</b></>}
          </div>
          {data._diagnostics?.missingCols && data._diagnostics.missingCols.length > 0 && (
            <div className="text-red-700">
              ⚠ 기대 컬럼이 누락됨: <b>{data._diagnostics.missingCols.join(', ')}</b>
              <div className="text-[11px] text-red-600 mt-0.5">
                업로드한 파일의 컬럼명: {data._diagnostics.sampleKeys.slice(0, 12).join(' / ')}
                {data._diagnostics.sampleKeys.length > 12 && ' …'}
              </div>
              <div className="text-[11px] text-red-600 mt-0.5">→ 쿠팡 리포트 양식이 바뀐 것 같습니다. 컬럼명 매핑을 업데이트해야 합니다.</div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            {data.dateRange?.from && data.dateRange?.to && (
              <button onClick={() => {
                dateTouchedRef.current = false;
                setDateFrom(data.dateRange.from);
                setDateTo(data.dateRange.to);
              }} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[11px] font-semibold hover:bg-amber-700">
                데이터 전체 기간으로 보기
              </button>
            )}
            <button onClick={() => { dateTouchedRef.current = true; setDateFrom(''); setDateTo(''); }}
              className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-800 text-[11px] font-semibold hover:bg-amber-100">
              기간 필터 해제
            </button>
          </div>
        </div>
      )}

      {/* 매칭 확인 패널 */}
      {pendingMatches.length > 0 && (
        <div className="bg-white rounded-2xl border-2 border-[#3182F6] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-bold text-[#191F28]">상품 매칭 확인</h3>
            <span className="text-[11px] text-[#8B95A1]">
              광고 CSV 상품명 → DB 상품 자동 매칭 결과를 확인하세요
            </span>
          </div>
          <div className="space-y-2">
            {pendingMatches.map((m, i) => (
              <div key={m.adName} className={`flex flex-wrap items-center gap-2 p-3 rounded-xl border text-[12px] ${
                m.status === 'confirmed' ? 'bg-emerald-50 border-emerald-200' :
                m.status === 'ignored' ? 'bg-gray-50 border-gray-200 opacity-50' :
                'bg-amber-50 border-amber-200'
              }`}>
                <div className="flex-1 min-w-[200px]">
                  <p className="font-medium text-[#333D4B]">{m.adName}</p>
                  <p className="text-[#6B7684] mt-0.5">
                    → {m.dbName} · {m.price?.toLocaleString()}원 · 원가 {m.cost_price?.toLocaleString()}원 · 수수료 {m.commission_rate}%
                    <span className="ml-2 text-[10px] text-[#B0B8C1]">신뢰도 {Math.round(m.score * 100)}%</span>
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setPendingMatches(prev => prev.map((p, j) => j === i ? { ...p, status: 'confirmed' } : p))}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                      m.status === 'confirmed' ? 'bg-emerald-600 text-white' : 'bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >확인</button>
                  <button
                    onClick={() => setPendingMatches(prev => prev.map((p, j) => j === i ? { ...p, status: 'ignored' } : p))}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                      m.status === 'ignored' ? 'bg-gray-500 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >무시</button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={() => setPendingMatches(prev => prev.map(p => ({ ...p, status: 'confirmed' })))}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700"
            >전체 확인</button>
            <button
              onClick={handleConfirmMatches}
              disabled={!pendingMatches.some(m => m.status !== 'pending')}
              className="px-4 py-2 rounded-lg bg-[#3182F6] text-white text-[12px] font-semibold hover:bg-[#1B6AE5] disabled:opacity-40"
            >적용</button>
            <button
              onClick={() => { setPendingMatches([]); setPendingRaw(null); }}
              className="px-4 py-2 rounded-lg border border-[#E5E8EB] text-[#6B7684] text-[12px] font-medium hover:bg-[#F8F9FA]"
            >취소</button>
          </div>
        </div>
      )}

      {/* Results */}
      {hasData && (
        <>
          {/* Price info */}
          {data.priceInfo.length > 0 && (
            <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl px-4 py-3 text-[12px] text-[#166534]">
              <span className="font-semibold">매출 보정 적용됨</span>
              {data.priceInfo.map((p) => (
                <span key={p.optionId} className="ml-3">
                  {p.sku_code} · 판매가 {fmtW(p.price)} · 원가 {fmtW(p.cost_price)}{p.commission_rate ? ` · 수수료 ${p.commission_rate}%` : ''}
                </span>
              ))}
              <span className="ml-3 text-[11px] text-[#4ADE80]">
                (광고 원본 매출 {fmtW(t.revenue14d_raw)} → 보정 {fmtW(t.revenue14d)})
              </span>
            </div>
          )}

          {/* Campaign / Product filter */}
          {(data.campaigns.length > 1 || data.products.length > 1) && (() => {
            // 캠페인 선택 시 해당 캠페인의 상품만, 상품 선택 시 해당 상품의 캠페인만
            const productsForCampaign = filterCampaign === 'all'
              ? data.products
              : [...new Set(data.rows.filter((r) => r.campaign === filterCampaign).map((r) => r.product))].sort();
            const campaignsForProduct = filterProduct === 'all'
              ? data.campaigns
              : [...new Set(data.rows.filter((r) => r.product === filterProduct).map((r) => r.campaign))].sort();

            return (
            <div className="flex flex-wrap items-center gap-3">
              {data.campaigns.length > 1 && (
                <div className="flex items-center gap-2">
                  <label className="text-[12px] font-medium text-[#6B7684]">캠페인</label>
                  <select
                    value={filterCampaign}
                    onChange={(e) => {
                      setFilterCampaign(e.target.value);
                      // 캠페인 변경 시, 현재 상품이 새 캠페인에 없으면 초기화
                      if (filterProduct !== 'all') {
                        const nextProducts = e.target.value === 'all'
                          ? data.products
                          : [...new Set(data.rows.filter((r) => r.campaign === e.target.value).map((r) => r.product))];
                        if (!nextProducts.includes(filterProduct)) setFilterProduct('all');
                      }
                    }}
                    className="h-9 px-3 rounded-lg border border-[#E5E8EB] text-[13px] text-[#191F28] bg-white focus:outline-none focus:border-[#3182F6]"
                  >
                    <option value="all">전체 ({campaignsForProduct.length})</option>
                    {campaignsForProduct.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}
              {data.products.length > 1 && (
                <div className="flex items-center gap-2">
                  <label className="text-[12px] font-medium text-[#6B7684]">상품</label>
                  <select
                    value={filterProduct}
                    onChange={(e) => setFilterProduct(e.target.value)}
                    className="h-9 px-3 rounded-lg border border-[#E5E8EB] text-[13px] text-[#191F28] bg-white focus:outline-none focus:border-[#3182F6] max-w-[300px] truncate"
                  >
                    <option value="all">전체 ({productsForCampaign.length})</option>
                    {productsForCampaign.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              )}
              {(filterCampaign !== 'all' || filterProduct !== 'all') && (
                <button
                  onClick={() => { setFilterCampaign('all'); setFilterProduct('all'); }}
                  className="text-[12px] text-[#3182F6] font-medium hover:underline"
                >
                  필터 초기화
                </button>
              )}
            </div>
            );
          })()}

          {/* KPI Cards */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-[#8B95A1]">핵심 지표</span>
              <button
                onClick={() => setKpiEditOpen(!kpiEditOpen)}
                className="text-[12px] text-[#3182F6] font-medium hover:underline"
              >
                {kpiEditOpen ? '완료' : '편집'}
              </button>
            </div>
            {kpiEditOpen && (
              <div className="flex flex-wrap gap-2 mb-3 p-3 bg-[#F8F9FA] rounded-xl border border-[#E5E8EB]">
                {KPI_DEFS.map((kd) => (
                  <button
                    key={kd.key}
                    onClick={() => toggleKpi(kd.key)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${
                      activeKpis.includes(kd.key)
                        ? 'border-[#3182F6] bg-[#EBF1FE] text-[#3182F6]'
                        : 'border-[#E5E8EB] bg-white text-[#8B95A1] hover:border-[#B0B8C1]'
                    }`}
                  >
                    {kd.label}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {KPI_DEFS.filter((kd) => activeKpis.includes(kd.key)).map((kd) => {
                // Dynamic icon/color for ROAS
                let icon = kd.icon;
                let color = kd.color;
                if (kd.key === 'roas') {
                  const roasVal = t.cost > 0 ? t.revenue14d / t.cost : 0;
                  icon = roasVal >= 1 ? TrendingUp : TrendingDown;
                  color = roasVal >= 1 ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600';
                }
                return (
                  <KPI
                    key={kd.key}
                    label={kd.label}
                    value={kd.getValue(t, null)}
                    sub={kd.getSub?.(t, null)}
                    icon={icon}
                    color={color}
                  />
                );
              })}
            </div>
          </div>

          {/* Profit summary — only show when cogs data exists */}
          {(() => {
            const hasCogs = t.cogs14d > 0;
            const commission = t.commission14d ?? 0;
            const netProfit = t.revenue14d - t.cogs14d - commission - t.cost;
            const perOrderCost = t.orders14d > 0 ? Math.round(t.cost / t.orders14d) : 0;
            const perOrderProfit = t.orders14d > 0 ? Math.round(netProfit / t.orders14d) : 0;
            return hasCogs ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white rounded-2xl border border-[#F2F4F6] p-4">
                  <p className="text-[12px] text-[#6B7684]">광고 순이익 (14일) = 매출 − 원가 − 수수료 − 광고비</p>
                  <p className={`text-[20px] font-bold mt-1 ${netProfit > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmtW(netProfit)}
                  </p>
                  <p className="text-[11px] text-[#B0B8C1]">
                    매출 {fmtW(t.revenue14d)} − 원가 {fmtW(t.cogs14d)}{commission > 0 ? ` − 수수료 ${fmtW(Math.round(commission))}` : ''} − 광고비 {fmtW(t.cost)}
                  </p>
                </div>
                <div className="bg-white rounded-2xl border border-[#F2F4F6] p-4">
                  <p className="text-[12px] text-[#6B7684]">건당 광고비</p>
                  <p className="text-[20px] font-bold mt-1 text-[#191F28]">
                    {perOrderCost ? fmtW(perOrderCost) : '-'}
                  </p>
                  <p className="text-[11px] text-[#B0B8C1]">광고비 ÷ 주문수(14일)</p>
                </div>
                <div className="bg-white rounded-2xl border border-[#F2F4F6] p-4">
                  <p className="text-[12px] text-[#6B7684]">건당 순이익</p>
                  <p className={`text-[20px] font-bold mt-1 ${perOrderProfit > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {perOrderProfit ? fmtW(perOrderProfit) : '-'}
                  </p>
                  <p className="text-[11px] text-[#B0B8C1]">(매출 − 원가 − 수수료 − 광고비) ÷ 주문수</p>
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[12px] text-amber-700">
                순이익 계산 불가 — 마스터시트 &gt; 플랫폼 탭에서 해당 상품의 <strong>원가(cost_price)</strong>를 입력하세요.
                {data.unmatchedOptionIds.length > 0 && (
                  <span className="ml-2">매칭 실패 옵션ID: {data.unmatchedOptionIds.join(', ')}</span>
                )}
              </div>
            );
          })()}

          {/* Rule-based Insights */}
          {(() => {
            const insights: { type: 'danger' | 'warn' | 'good'; text: string }[] = [];
            const ctr = t.impressions > 0 ? t.clicks / t.impressions : 0;
            const cvr = t.clicks > 0 ? t.orders14d / t.clicks : 0;
            const roas = t.cost > 0 ? t.revenue14d / t.cost : 0;
            const cpc = t.clicks > 0 ? Math.round(t.cost / t.clicks) : 0;
            const commission = t.commission14d ?? 0;
            const profit = t.revenue14d - t.cogs14d - commission - t.cost;

            // Overall ROAS
            if (roas > 0 && roas < 1) insights.push({ type: 'danger', text: `전체 ROAS ${roas.toFixed(2)} — 광고비 대비 매출 적자. 저효율 키워드 정리 필요` });
            else if (roas >= 1 && roas < 2) insights.push({ type: 'warn', text: `전체 ROAS ${roas.toFixed(2)} — 원가/수수료 고려 시 실질 수익 미미. 키워드 최적화 권장` });
            else if (roas >= 3) insights.push({ type: 'good', text: `전체 ROAS ${roas.toFixed(2)} — 양호. 광고비 증액 여지 있음` });

            // Profit
            if (t.cogs14d > 0 && profit < 0) insights.push({ type: 'danger', text: `순이익 ${fmtW(profit)} 적자 — 광고비(${fmtW(t.cost)}) 또는 원가 구조 점검 필요` });

            // CTR
            if (ctr > 0 && ctr < 0.005) insights.push({ type: 'warn', text: `CTR ${(ctr*100).toFixed(2)}% 낮음 — 광고 소재(썸네일/타이틀) 개선 권장` });
            else if (ctr >= 0.02) insights.push({ type: 'good', text: `CTR ${(ctr*100).toFixed(2)}% 우수 — 소재 경쟁력 양호` });

            // CVR
            if (cvr > 0 && cvr < 0.01) insights.push({ type: 'warn', text: `CVR ${(cvr*100).toFixed(2)}% 저조 — 상세페이지/가격/리뷰 점검 필요` });

            // Per-keyword insights
            const topKw = dateFiltered.keywords.filter(k => k.cost > 0).sort((a, b) => {
              const ra = a.cost > 0 ? a.revenue14d / a.cost : 0;
              const rb = b.cost > 0 ? b.revenue14d / b.cost : 0;
              return ra - rb;
            });

            // Worst keywords (ROAS < 0.5, cost > 5% of total)
            const worstKws = topKw.filter(k => {
              const r = k.cost > 0 ? k.revenue14d / k.cost : 0;
              return r < 0.5 && k.cost > t.cost * 0.05;
            });
            if (worstKws.length > 0) {
              const names = worstKws.slice(0, 3).map(k => `"${k.keyword}"(ROAS ${k.cost > 0 ? (k.revenue14d / k.cost).toFixed(1) : '0'})`).join(', ');
              const totalWaste = worstKws.reduce((s, k) => s + k.cost, 0);
              insights.push({ type: 'danger', text: `비효율 키워드: ${names} → 광고비 ${fmtW(totalWaste)} 낭비. 중단 또는 입찰가 조정 권장` });
            }

            // Best keywords (ROAS > 3, has orders)
            const bestKws = topKw.filter(k => {
              const r = k.cost > 0 ? k.revenue14d / k.cost : 0;
              return r > 3 && k.orders14d > 0;
            }).reverse();
            if (bestKws.length > 0) {
              const names = bestKws.slice(0, 3).map(k => `"${k.keyword}"(ROAS ${(k.revenue14d / k.cost).toFixed(1)})`).join(', ');
              insights.push({ type: 'good', text: `고효율 키워드: ${names} → 입찰가 상향 또는 예산 집중 권장` });
            }

            // High CPC warning
            if (cpc > 500 && roas < 2) insights.push({ type: 'warn', text: `CPC ${fmtW(cpc)} 높음 + ROAS 낮음 — 경쟁 키워드 대신 롱테일 키워드 활용 고려` });

            // Product-level insight
            const prodMap = new Map<string, { cost: number; revenue: number; orders: number }>();
            for (const r of dateFiltered.rows) {
              const p = prodMap.get(r.product) ?? { cost: 0, revenue: 0, orders: 0 };
              p.cost += r.cost; p.revenue += r.revenue14d; p.orders += r.orders14d;
              prodMap.set(r.product, p);
            }
            for (const [name, p] of prodMap) {
              const pr = p.cost > 0 ? p.revenue / p.cost : 0;
              if (pr < 0.5 && p.cost > t.cost * 0.15) {
                insights.push({ type: 'danger', text: `"${name.slice(0, 20)}" ROAS ${pr.toFixed(1)} — 광고비 비중 ${Math.round(p.cost / t.cost * 100)}%인데 효율 낮음. 예산 재배분 고려` });
              }
            }

            if (insights.length === 0) return null;
            const colors = { danger: 'bg-red-50 border-red-200 text-red-700', warn: 'bg-amber-50 border-amber-200 text-amber-700', good: 'bg-emerald-50 border-emerald-200 text-emerald-700' };
            const icons = { danger: '!', warn: '?', good: '+' };
            return (
              <div className="bg-white rounded-2xl border border-[#F2F4F6] p-5 space-y-2">
                <h3 className="text-[13px] font-bold text-[#191F28]">자동 인사이트</h3>
                {insights.map((ins, i) => (
                  <div key={i} className={`${colors[ins.type]} border rounded-lg px-3 py-2 text-[12px] flex items-start gap-2`}>
                    <span className="font-bold shrink-0 w-4 text-center">{icons[ins.type]}</span>
                    <span>{ins.text}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Tabs */}
          <div className="flex gap-1 bg-[#F2F4F6] rounded-xl p-1 w-fit">
            {tabs.map((tb) => (
              <button
                key={tb.key}
                onClick={() => setTab(tb.key)}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                  tab === tb.key ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684] hover:text-[#333D4B]'
                }`}
              >
                {tb.label}
              </button>
            ))}
          </div>

          {/* ─── Tab: Daily / Trend ───────────────────────────────────── */}
          {tab === 'daily' && (
            <div className="space-y-4">
              {/* Controls: granularity + metric chips */}
              <div className="bg-white rounded-2xl border border-[#F2F4F6] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[13px] font-bold text-[#191F28]">기간별 추이</h3>
                  {/* Granularity toggle */}
                  <div className="flex gap-1 bg-[#F2F4F6] rounded-lg p-0.5">
                    {granOptions.map((g) => (
                      <button
                        key={g.key}
                        onClick={() => setGran(g.key)}
                        className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                          gran === g.key ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684] hover:text-[#333D4B]'
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Metric filter chips: 클릭 → 막대 → 꺾은선 → 숨김 */}
                <div className="flex flex-wrap gap-2">
                  {METRICS.map((m) => {
                    const active = activeMetrics.includes(m.key);
                    const currentType = metricTypes[m.key] || m.type;
                    const handleClick = () => {
                      if (!active) {
                        // 숨김 → 막대
                        setActiveMetrics(prev => [...prev, m.key]);
                        setMetricTypes(prev => ({ ...prev, [m.key]: 'bar' }));
                      } else if (currentType === 'bar') {
                        // 막대 → 꺾은선
                        setMetricTypes(prev => ({ ...prev, [m.key]: 'line' }));
                      } else {
                        // 꺾은선 → 숨김
                        setActiveMetrics(prev => prev.filter(k => k !== m.key));
                      }
                    };
                    return (
                      <button key={m.key}
                        onClick={handleClick}
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
                      {activeMetrics.map(key => {
                        const m = METRICS.find(x => x.key === key);
                        if (!m) return null;
                        const isRight = rightAxisKeys.has(key);
                        return (
                          <button key={key} onClick={() => setRightAxisKeys(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })}
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
                {activeDefs.length > 0 && (
                  <div className="h-[360px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F6" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis
                          yAxisId="left"
                          tick={{ fontSize: 11 }}
                          tickFormatter={yAxisFormatter(leftUnit)}
                        />
                        {(rightUnit || hasCustomRight) && (
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={{ fontSize: 11 }}
                            tickFormatter={yAxisFormatter(rightUnit || leftUnit)}
                          />
                        )}
                        <Tooltip formatter={tooltipFormatter} />
                        <Legend />
                        {activeDefs.map((m) => {
                          const yId = unitToAxis(m.unit, m.key);
                          const chartType = metricTypes[m.key] || m.type;
                          if (chartType === 'bar') {
                            return (
                              <Bar
                                key={m.key}
                                yAxisId={yId}
                                dataKey={`__${m.key}`}
                                name={m.label}
                                fill={m.color}
                                opacity={0.75}
                                radius={[4, 4, 0, 0]}
                              />
                            );
                          }
                          return (
                            <Line
                              key={m.key}
                              yAxisId={yId}
                              type="monotone"
                              dataKey={`__${m.key}`}
                              name={m.label}
                              stroke={m.color}
                              strokeWidth={2}
                              dot={{ r: 3, fill: m.color }}
                            />
                          );
                        })}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {activeDefs.length === 0 && (
                  <p className="text-center text-[13px] text-[#B0B8C1] py-10">표시할 지표를 선택하세요</p>
                )}
              </div>

              {/* Data table */}
              <div className="bg-white rounded-2xl border border-[#F2F4F6] overflow-x-auto">
                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                  <span className="text-[12px] text-[#8B95A1]">헤더 클릭 정렬 · 헤더 드래그 순서 변경</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setTableColEdit(!tableColEdit)}
                      className={`flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11px] font-medium border transition-all ${
                        tableColEdit ? 'border-[#3182F6] bg-[#EBF1FE] text-[#3182F6]' : 'border-[#E5E8EB] text-[#6B7684] hover:border-[#B0B8C1]'
                      }`}>
                      <Settings className="h-3 w-3" /> 컬럼
                    </button>
                    <button onClick={handleDownload} className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11px] font-medium border border-[#3182F6] text-[#3182F6] bg-white hover:bg-[#EBF1FE] transition-colors">
                      <Download className="h-3 w-3" /> xlsx · 일자 + 일자×키워드
                    </button>
                  </div>
                </div>
                {tableColEdit && (
                  <div className="flex flex-wrap gap-1.5 px-4 pb-2">
                    {TABLE_COLS.map((c) => (
                      <button key={c.key} onClick={() => toggleCol(c.key)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${
                          activeCols.includes(c.key)
                            ? 'border-[#3182F6] bg-[#EBF1FE] text-[#3182F6]'
                            : 'border-[#E5E8EB] bg-white text-[#8B95A1] hover:border-[#B0B8C1]'
                        }`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-[#F2F4F6] bg-[#FAFBFC]">
                      <th onClick={() => toggleTrendSort('date')}
                        className="text-left px-3 py-2.5 font-semibold text-[#6B7684] cursor-pointer hover:text-[#191F28] select-none whitespace-nowrap">
                        {gran === 'daily' ? '날짜' : gran === 'weekly' ? '주차' : '월'} <TrendSortIcon k="date" />
                      </th>
                      {visibleCols.map((col) => (
                        <th key={col.key}
                          draggable
                          onDragStart={() => handleColDragStart(col.key)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleColDrop(col.key)}
                          onClick={() => toggleTrendSort(col.key)}
                          className="text-right px-3 py-2.5 font-semibold text-[#6B7684] cursor-grab hover:text-[#191F28] select-none whitespace-nowrap active:cursor-grabbing">
                          {col.label} <TrendSortIcon k={col.key} />
                        </th>
                      ))}
                      <th className="px-2 py-2.5 text-[#6B7684] font-semibold text-left whitespace-nowrap">메모</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTrendData.map((d: any) => {
                      const canDrill = gran === 'daily';
                      const isExpanded = canDrill && expandedDate === d.date;
                      // 해당 일자의 키워드 breakdown 집계
                      const kwForDate = isExpanded
                        ? Object.values((dateFiltered.keywordDaily ?? [])
                            .filter((kd) => kd.date === d.date)
                            .reduce((acc: Record<string, { keyword: string; impressions: number; clicks: number; cost: number; orders14d: number; revenue14d: number }>, kd) => {
                              if (!acc[kd.keyword]) acc[kd.keyword] = { keyword: kd.keyword, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0 };
                              acc[kd.keyword].impressions += kd.impressions;
                              acc[kd.keyword].clicks += kd.clicks;
                              acc[kd.keyword].cost += kd.cost;
                              acc[kd.keyword].orders14d += kd.orders14d;
                              acc[kd.keyword].revenue14d += kd.revenue14d;
                              return acc;
                            }, {}))
                            .sort((a, b) => b.cost - a.cost)
                        : [];
                      return (
                        <Fragment key={d.date}>
                          <tr className={`border-b border-[#F2F4F6] hover:bg-[#FAFBFC] ${memos[d.date] ? 'bg-amber-50/30' : ''} ${isExpanded ? 'bg-[#F0F7FF]' : ''} ${canDrill ? 'cursor-pointer' : ''}`}
                            onClick={(e) => {
                              if (!canDrill) return;
                              const t = e.target as HTMLElement;
                              if (t.tagName === 'INPUT') return;
                              setExpandedDate(isExpanded ? null : d.date);
                            }}>
                            <td className="px-3 py-2.5 font-medium text-[#191F28]">
                              <div className="flex items-center gap-1.5">
                                {canDrill && <span className="text-[#B0B8C1]">{isExpanded ? '▾' : '▸'}</span>}
                                {d.label}
                                {memos[d.date] && <span className="text-[9px] text-amber-600 bg-amber-100 px-1 rounded">메모</span>}
                              </div>
                            </td>
                            {visibleCols.map((col) => (
                              <td key={col.key} className={`px-3 py-2.5 text-right ${col.className ?? 'text-[#6B7684]'}`}>
                                {col.render(d)}
                              </td>
                            ))}
                            <td className="px-1 py-1">
                              <input value={memos[d.date] ?? ''} onChange={e => saveMemo(d.date, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="메모" className="w-24 h-7 px-1.5 text-[10px] rounded border border-transparent hover:border-[#E5E8EB] focus:border-[#3182F6] focus:outline-none bg-transparent" />
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={visibleCols.length + 2} className="p-0 bg-[#FAFBFC] border-b border-[#E5E8EB]">
                                <div className="px-6 py-3">
                                  <div className="text-[11px] font-semibold text-[#6B7684] mb-2">
                                    {d.label} — 키워드별 성과 ({kwForDate.length}개 키워드, 광고비 순)
                                  </div>
                                  <div className="overflow-auto max-h-96">
                                    <table className="w-full text-[11px]">
                                      <thead className="bg-white sticky top-0">
                                        <tr className="text-[#8B95A1] border-b border-[#F2F4F6]">
                                          <th className="text-left px-2 py-1.5 font-medium">키워드</th>
                                          <th className="text-right px-2 py-1.5 font-medium">노출</th>
                                          <th className="text-right px-2 py-1.5 font-medium">클릭</th>
                                          <th className="text-right px-2 py-1.5 font-medium">CTR</th>
                                          <th className="text-right px-2 py-1.5 font-medium">CPC</th>
                                          <th className="text-right px-2 py-1.5 font-medium">광고비</th>
                                          <th className="text-right px-2 py-1.5 font-medium">주문(14d)</th>
                                          <th className="text-right px-2 py-1.5 font-medium">매출(14d)</th>
                                          <th className="text-right px-2 py-1.5 font-medium">CVR</th>
                                          <th className="text-right px-2 py-1.5 font-medium">ROAS</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {kwForDate.length === 0 && (
                                          <tr><td colSpan={10} className="text-center py-3 text-[#B0B8C1]">키워드 데이터 없음</td></tr>
                                        )}
                                        {kwForDate.map((kd) => {
                                          const ctr = kd.impressions > 0 ? kd.clicks / kd.impressions : 0;
                                          const cpc = kd.clicks > 0 ? Math.round(kd.cost / kd.clicks) : 0;
                                          const cvr = kd.clicks > 0 ? kd.orders14d / kd.clicks : 0;
                                          const roas = kd.cost > 0 ? kd.revenue14d / kd.cost : 0;
                                          return (
                                            <tr key={kd.keyword} className="border-b border-[#F5F6F7] hover:bg-white">
                                              <td className="px-2 py-1.5 max-w-[260px] truncate font-medium text-[#333D4B]" title={kd.keyword}>{kd.keyword}</td>
                                              <td className="px-2 py-1.5 text-right">{formatNumber(kd.impressions)}</td>
                                              <td className="px-2 py-1.5 text-right">{formatNumber(kd.clicks)}</td>
                                              <td className="px-2 py-1.5 text-right text-[#6B7684]">{pct(ctr)}</td>
                                              <td className="px-2 py-1.5 text-right text-[#6B7684]">{kd.clicks > 0 ? fmtW(cpc) : '-'}</td>
                                              <td className="px-2 py-1.5 text-right text-[#F43F5E]">{fmtW(kd.cost)}</td>
                                              <td className="px-2 py-1.5 text-right">{kd.orders14d}</td>
                                              <td className="px-2 py-1.5 text-right text-[#3182F6]">{fmtW(kd.revenue14d)}</td>
                                              <td className="px-2 py-1.5 text-right text-[#6B7684]">{pct(cvr)}</td>
                                              <td className={`px-2 py-1.5 text-right font-semibold ${roas >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                                                {kd.cost > 0 ? `${(roas * 100).toFixed(0)}%` : '-'}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {/* 플로팅 합계 */}
                <div className="sticky bottom-0 bg-[#F8FAFC] border-t-2 border-[#E5E8EB]">
                  <table className="w-full text-[12px]"><tbody>
                    <tr className="font-bold">
                      <td className="px-3 py-2.5 text-[#191F28]">합계</td>
                      {visibleCols.map((col) => (
                        <td key={col.key} className="px-3 py-2.5 text-right">
                          {col.renderTotal(t)}
                        </td>
                      ))}
                    </tr>
                  </tbody></table>
                </div>
              </div>
            </div>
          )}

          {/* ─── Tab: Keywords ──────────────────────────────────────────── */}
          {tab === 'keywords' && (
            <div className="space-y-4">
              {/* 행 전환 버튼 + 공통 지표 선택 (엑셀 피벗 스타일) */}
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => setPivotAxis(pivotAxis === 'kw-date' ? 'date-kw' : 'kw-date')}
                  className="flex items-center gap-2 h-8 px-3 rounded-lg border border-[#3182F6] bg-white hover:bg-[#EBF1FE] text-[#3182F6] text-[12px] font-medium transition-colors"
                  title="행/열 전환 (엑셀 피벗처럼 축 바꾸기)"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  {pivotAxis === 'kw-date' ? '행: 키워드 → 열: 일자' : '행: 일자 → 열: 키워드'}
                  <span className="text-[#B0B8C1]">↔</span>
                </button>
                <span className="text-[11px] text-[#8B95A1]">
                  {pivotAxis === 'kw-date' ? '키워드 클릭 → 일자별 펼침' : '일자 클릭 → 키워드별 펼침'}
                </span>
                <div className="flex items-center gap-2 ml-auto">
                  <label className="text-[12px] font-medium text-[#6B7684]">차트 지표</label>
                  <select value={pivotMetric} onChange={(e) => setPivotMetric(e.target.value as typeof pivotMetric)}
                    className="h-8 px-2 rounded-lg border border-[#E5E8EB] text-[12px] bg-white focus:outline-none focus:border-[#3182F6]">
                    <optgroup label="볼륨">
                      <option value="impressions">노출수 (impressions)</option>
                      <option value="clicks">유입수 (clicks)</option>
                      <option value="orders14d">주문수 (14d)</option>
                    </optgroup>
                    <optgroup label="금액">
                      <option value="cost">광고비 (VAT)</option>
                      <option value="revenue14d">매출 (14d)</option>
                      <option value="cpc">CPC (클릭당 비용)</option>
                    </optgroup>
                    <optgroup label="비율">
                      <option value="ctr">CTR (노출→클릭)</option>
                      <option value="cvr">CVR (클릭→주문)</option>
                      <option value="roas">ROAS</option>
                    </optgroup>
                    <optgroup label="키워드 다양성">
                      <option value="keywordCount">노출된 키워드 수</option>
                      <option value="clickKeywordCount">유입된 키워드 수</option>
                    </optgroup>
                  </select>
                </div>
              </div>
              {/* 지표 기반 트렌드 차트 — 선택된 키워드 있으면 그 키워드의 일자별로 필터 */}
              {(() => {
                const metricInfo: Record<typeof pivotMetric, { label: string; type: 'bar' | 'line'; unit: 'won' | 'cnt' | 'pct'; color: string }> = {
                  cost: { label: '광고비', type: 'bar', unit: 'won', color: '#F43F5E' },
                  revenue14d: { label: '매출(14d)', type: 'bar', unit: 'won', color: '#3182F6' },
                  impressions: { label: '노출수', type: 'bar', unit: 'cnt', color: '#8B5CF6' },
                  clicks: { label: '유입수(클릭)', type: 'bar', unit: 'cnt', color: '#06B6D4' },
                  orders14d: { label: '주문수(14d)', type: 'bar', unit: 'cnt', color: '#10B981' },
                  ctr: { label: 'CTR', type: 'line', unit: 'pct', color: '#EAB308' },
                  cvr: { label: 'CVR', type: 'line', unit: 'pct', color: '#F59E0B' },
                  roas: { label: 'ROAS', type: 'line', unit: 'pct', color: '#A855F7' },
                  cpc: { label: 'CPC', type: 'line', unit: 'won', color: '#EF4444' },
                  keywordCount: { label: '노출된 키워드 수', type: 'bar', unit: 'cnt', color: '#8B5CF6' },
                  clickKeywordCount: { label: '유입된 키워드 수', type: 'bar', unit: 'cnt', color: '#10B981' },
                };
                const info = metricInfo[pivotMetric];

                // 키워드 선택 중이면 그 키워드의 일자별(버킷별) 집계만 사용
                const baseData: any[] = expandedKw
                  ? (() => {
                      const m = new Map<string, any>();
                      for (const kd of (dateFiltered.keywordDaily ?? [])) {
                        if (kd.keyword !== expandedKw) continue;
                        const k = bucketKey(kd.date, gran);
                        if (!m.has(k)) m.set(k, { date: k, label: bucketLabel(k, gran), impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, keywordCount: 1, clickKeywordCount: 0 });
                        const b = m.get(k)!;
                        b.impressions += kd.impressions; b.clicks += kd.clicks; b.cost += kd.cost;
                        b.orders14d += kd.orders14d; b.revenue14d += kd.revenue14d;
                        if (kd.clicks > 0) b.clickKeywordCount = 1;
                      }
                      return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
                    })()
                  : chartData;

                const enhancedData = baseData.map((d: any) => ({
                  ...d,
                  ctr: d.impressions > 0 ? d.clicks / d.impressions : 0,
                  cvr: d.clicks > 0 ? d.orders14d / d.clicks : 0,
                  roas: d.cost > 0 ? d.revenue14d / d.cost : 0,
                  cpc: d.clicks > 0 ? Math.round(d.cost / d.clicks) : 0,
                }));
                const fmtY = (v: number) => {
                  if (info.unit === 'won') return v >= 10000 ? `${Math.round(v / 10000).toLocaleString()}만` : v.toLocaleString();
                  if (info.unit === 'pct') return `${Math.round(v * 100)}%`;
                  return formatNumber(v);
                };
                const fmtTooltip = (v: number) => {
                  if (info.unit === 'won') return [fmtW(Math.round(v)), info.label];
                  if (info.unit === 'pct') return [pct(v), info.label];
                  return [formatNumber(v), info.label];
                };
                return (
                  <div className="bg-white rounded-2xl border border-[#F2F4F6] p-5">
                    <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[13px] font-bold text-[#191F28]">
                          기간별 {info.label} 추이
                        </h3>
                        {expandedKw && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] bg-[#EBF1FE] text-[#3182F6] px-2 py-0.5 rounded-full font-medium">
                            <Search className="h-3 w-3" />
                            {expandedKw}
                            <button onClick={() => setExpandedKw(null)} className="ml-0.5 hover:bg-white/50 rounded-full w-4 h-4 flex items-center justify-center" title="선택 해제">
                              ×
                            </button>
                          </span>
                        )}
                        {!expandedKw && <span className="text-[11px] text-[#8B95A1]">· 키워드 클릭 시 해당 키워드 기준 차트로 전환</span>}
                      </div>
                      <div className="flex gap-1 bg-[#F2F4F6] rounded-lg p-0.5">
                        {([
                          { key: 'daily' as Granularity, label: '일' },
                          { key: 'weekly' as Granularity, label: '주' },
                          { key: 'monthly' as Granularity, label: '월' },
                        ]).map((g) => (
                          <button key={g.key} onClick={() => setGran(g.key)}
                            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${gran === g.key ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684] hover:text-[#333D4B]'}`}>
                            {g.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={enhancedData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F6" />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtY} />
                          <Tooltip formatter={(v: number) => fmtTooltip(v)} />
                          {info.type === 'bar'
                            ? <Bar dataKey={pivotMetric} name={info.label} fill={info.color} opacity={0.8} radius={[4, 4, 0, 0]} />
                            : <Line type="monotone" dataKey={pivotMetric} name={info.label} stroke={info.color} strokeWidth={2.5} dot={{ r: 3, fill: info.color }} />
                          }
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })()}

              {pivotAxis === 'kw-date' && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px] max-w-[360px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#B0B8C1]" />
                  <input
                    type="text"
                    value={kwSearch}
                    onChange={(e) => setKwSearch(e.target.value)}
                    placeholder="키워드 검색..."
                    className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10"
                  />
                </div>
                <button onClick={() => setKwOnlyOrders(!kwOnlyOrders)}
                  className={`h-8 px-3 rounded-lg text-[12px] font-medium border transition-all ${kwOnlyOrders ? 'border-[#3182F6] bg-[#EBF1FE] text-[#3182F6]' : 'border-[#E5E8EB] text-[#6B7684]'}`}>
                  구매 키워드만
                </button>
                <button onClick={handleDownload} className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border border-[#3182F6] text-[#3182F6] bg-white hover:bg-[#EBF1FE] transition-colors">
                  <Download className="h-3.5 w-3.5" /> xlsx · 키워드 + 키워드×일자
                </button>
                <span className="text-[12px] text-[#8B95A1]">
                  {sortedKeywords.length}개{kwSearch ? ' (필터)' : ''} / 전체 {dateFiltered.keywords.length}개 키워드
                </span>
              </div>
              )}

              {pivotAxis === 'kw-date' && (<>
              <div className="bg-white rounded-2xl border border-[#F2F4F6] max-h-[70vh] overflow-auto">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-[#F2F4F6] bg-[#FAFBFC] shadow-sm">
                      <th className="w-6 bg-[#FAFBFC]"></th>
                      <th className="text-left px-3 py-2.5 font-semibold text-[#6B7684] min-w-[180px] bg-[#FAFBFC]">키워드</th>
                      {([
                        ['impressions', '노출'], ['clicks', '클릭'], ['cost', '광고비'],
                        ['ctr', 'CTR'], ['cpc', 'CPC'], ['orders14d', '주문(14d)'],
                        ['revenue14d', '매출(14d)'], ['cvr', 'CVR'], ['roas14d', 'ROAS(14d)'],
                      ] as [SortKey, string][]).map(([k, label]) => (
                        <th key={k}
                          onClick={() => toggleSort(k)}
                          className="text-right px-3 py-2.5 font-semibold text-[#6B7684] cursor-pointer hover:text-[#191F28] whitespace-nowrap select-none bg-[#FAFBFC]"
                        >
                          <span className="inline-flex items-center gap-1">{label} <SortIcon k={k} /></span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedKeywords.map((k) => {
                      const isExpanded = expandedKw === k.keyword;
                      const dailyRows = isExpanded
                        ? (dateFiltered.keywordDaily ?? [])
                            .filter((d) => d.keyword === k.keyword)
                            .reduce((acc: Record<string, { date: string; impressions: number; clicks: number; cost: number; orders14d: number; revenue14d: number }>, d) => {
                              if (!acc[d.date]) acc[d.date] = { date: d.date, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0 };
                              acc[d.date].impressions += d.impressions;
                              acc[d.date].clicks += d.clicks;
                              acc[d.date].cost += d.cost;
                              acc[d.date].orders14d += d.orders14d;
                              acc[d.date].revenue14d += d.revenue14d;
                              return acc;
                            }, {})
                        : {};
                      const dailyList = isExpanded ? Object.values(dailyRows).sort((a, b) => a.date.localeCompare(b.date)) : [];
                      return (
                        <Fragment key={k.keyword}>
                          <tr
                            className={`border-b border-[#F2F4F6] hover:bg-[#FAFBFC] cursor-pointer ${isExpanded ? 'bg-[#F0F7FF]' : ''}`}
                            onClick={() => setExpandedKw(isExpanded ? null : k.keyword)}
                          >
                            <td className="px-1.5 py-2 text-center text-[#B0B8C1]">
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5 inline" /> : <ChevronRight className="h-3.5 w-3.5 inline" />}
                            </td>
                            <td className="px-3 py-2 font-medium text-[#191F28] max-w-[260px] truncate">{k.keyword}</td>
                            <td className="px-3 py-2 text-right text-[#6B7684]">{formatNumber(k.impressions)}</td>
                            <td className="px-3 py-2 text-right text-[#191F28]">{formatNumber(k.clicks)}</td>
                            <td className="px-3 py-2 text-right text-[#F43F5E]">{fmtW(k.cost)}</td>
                            <td className="px-3 py-2 text-right text-[#6B7684]">{pct(k.ctr)}</td>
                            <td className="px-3 py-2 text-right text-[#6B7684]">{fmtW(k.cpc)}</td>
                            <td className="px-3 py-2 text-right text-[#191F28]">{k.orders14d}</td>
                            <td className="px-3 py-2 text-right text-[#3182F6]">{fmtW(k.revenue14d)}</td>
                            <td className="px-3 py-2 text-right text-[#6B7684]">{pct(k.cvr)}</td>
                            <td className={`px-3 py-2 text-right font-bold ${k.roas14d >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                              {k.cost > 0 ? `${(k.roas14d * 100).toFixed(0)}%` : '-'}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={11} className="p-0 bg-[#FAFBFC] border-b border-[#E5E8EB]">
                                <div className="px-6 py-3">
                                  <div className="text-[11px] font-semibold text-[#6B7684] mb-2">{k.keyword} — 일자별 성과 ({dailyList.length}일)</div>
                                  <table className="w-full text-[11px]">
                                    <thead>
                                      <tr className="text-[#8B95A1] border-b border-[#F2F4F6]">
                                        <th className="text-left px-2 py-1.5 font-medium">날짜</th>
                                        <th className="text-right px-2 py-1.5 font-medium">노출</th>
                                        <th className="text-right px-2 py-1.5 font-medium">클릭</th>
                                        <th className="text-right px-2 py-1.5 font-medium">CTR</th>
                                        <th className="text-right px-2 py-1.5 font-medium">CPC</th>
                                        <th className="text-right px-2 py-1.5 font-medium">광고비</th>
                                        <th className="text-right px-2 py-1.5 font-medium">주문(14d)</th>
                                        <th className="text-right px-2 py-1.5 font-medium">매출(14d)</th>
                                        <th className="text-right px-2 py-1.5 font-medium">CVR</th>
                                        <th className="text-right px-2 py-1.5 font-medium">ROAS</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {dailyList.length === 0 && (
                                        <tr><td colSpan={10} className="text-center py-3 text-[#B0B8C1]">해당 기간 노출 없음</td></tr>
                                      )}
                                      {dailyList.map((d) => {
                                        const ctr = d.impressions > 0 ? d.clicks / d.impressions : 0;
                                        const cpc = d.clicks > 0 ? Math.round(d.cost / d.clicks) : 0;
                                        const cvr = d.clicks > 0 ? d.orders14d / d.clicks : 0;
                                        const roas = d.cost > 0 ? d.revenue14d / d.cost : 0;
                                        return (
                                          <tr key={d.date} className="border-b border-[#F5F6F7] hover:bg-white">
                                            <td className="px-2 py-1.5 font-mono text-[#333D4B]">{d.date}</td>
                                            <td className="px-2 py-1.5 text-right">{formatNumber(d.impressions)}</td>
                                            <td className="px-2 py-1.5 text-right">{formatNumber(d.clicks)}</td>
                                            <td className="px-2 py-1.5 text-right text-[#6B7684]">{pct(ctr)}</td>
                                            <td className="px-2 py-1.5 text-right text-[#6B7684]">{d.clicks > 0 ? fmtW(cpc) : '-'}</td>
                                            <td className="px-2 py-1.5 text-right text-[#F43F5E]">{fmtW(d.cost)}</td>
                                            <td className="px-2 py-1.5 text-right">{d.orders14d}</td>
                                            <td className="px-2 py-1.5 text-right text-[#3182F6]">{fmtW(d.revenue14d)}</td>
                                            <td className="px-2 py-1.5 text-right text-[#6B7684]">{pct(cvr)}</td>
                                            <td className={`px-2 py-1.5 text-right font-semibold ${roas >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                                              {d.cost > 0 ? `${(roas * 100).toFixed(0)}%` : '-'}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
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

              {sortedKeywords.length >= kwLimit && (
                <div className="text-center">
                  <button
                    onClick={() => setKwLimit((l) => l + 50)}
                    className="text-[13px] text-[#3182F6] font-medium hover:underline"
                  >
                    더 보기
                  </button>
                </div>
              )}
              </>)}

              {/* ─── 일자 → 키워드 드릴다운 (행 전환) ─── */}
              {pivotAxis === 'date-kw' && (() => {
                const daily = (dateFiltered.daily ?? []).slice().sort((a: any, b: any) => a.date.localeCompare(b.date));
                const kwForDate = (date: string) => {
                  const map: Record<string, any> = {};
                  for (const kd of (dateFiltered.keywordDaily ?? [])) {
                    if (kd.date !== date) continue;
                    if (!map[kd.keyword]) map[kd.keyword] = { keyword: kd.keyword, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0 };
                    map[kd.keyword].impressions += kd.impressions;
                    map[kd.keyword].clicks += kd.clicks;
                    map[kd.keyword].cost += kd.cost;
                    map[kd.keyword].orders14d += kd.orders14d;
                    map[kd.keyword].revenue14d += kd.revenue14d;
                  }
                  return Object.values(map).sort((a: any, b: any) => b.cost - a.cost);
                };
                return (
                  <div className="bg-white rounded-2xl border border-[#F2F4F6] max-h-[70vh] overflow-auto">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b border-[#F2F4F6] bg-[#FAFBFC] shadow-sm">
                          <th className="w-6 bg-[#FAFBFC]"></th>
                          <th className="text-left px-3 py-2.5 font-semibold text-[#6B7684] min-w-[120px] bg-[#FAFBFC]">일자</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684] bg-[#FAFBFC]">노출</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684] bg-[#FAFBFC]">클릭</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684] bg-[#FAFBFC]">CTR</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684] bg-[#FAFBFC]">CPC</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684] bg-[#FAFBFC]">광고비</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684] bg-[#FAFBFC]">주문(14d)</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684] bg-[#FAFBFC]">매출(14d)</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684] bg-[#FAFBFC]">CVR</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684] bg-[#FAFBFC]">ROAS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {daily.length === 0 && (
                          <tr><td colSpan={11} className="text-center py-6 text-[#B0B8C1]">일자 데이터 없음</td></tr>
                        )}
                        {daily.map((d: any) => {
                          const isExpanded = expandedDate === d.date;
                          const ctr = d.impressions > 0 ? d.clicks / d.impressions : 0;
                          const cpc = d.clicks > 0 ? Math.round(d.cost / d.clicks) : 0;
                          const cvr = d.clicks > 0 ? d.orders14d / d.clicks : 0;
                          const roas = d.cost > 0 ? d.revenue14d / d.cost : 0;
                          const kws = isExpanded ? kwForDate(d.date) : [];
                          return (
                            <Fragment key={d.date}>
                              <tr className={`border-b border-[#F2F4F6] hover:bg-[#FAFBFC] cursor-pointer ${isExpanded ? 'bg-[#F0F7FF]' : ''}`}
                                  onClick={() => setExpandedDate(isExpanded ? null : d.date)}>
                                <td className="px-1.5 py-2 text-center text-[#B0B8C1]">
                                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 inline" /> : <ChevronRight className="h-3.5 w-3.5 inline" />}
                                </td>
                                <td className="px-3 py-2 font-mono text-[#191F28]">{d.date}</td>
                                <td className="px-3 py-2 text-right text-[#6B7684]">{formatNumber(d.impressions)}</td>
                                <td className="px-3 py-2 text-right text-[#191F28]">{formatNumber(d.clicks)}</td>
                                <td className="px-3 py-2 text-right text-[#6B7684]">{pct(ctr)}</td>
                                <td className="px-3 py-2 text-right text-[#6B7684]">{d.clicks > 0 ? fmtW(cpc) : '-'}</td>
                                <td className="px-3 py-2 text-right text-[#F43F5E]">{fmtW(d.cost)}</td>
                                <td className="px-3 py-2 text-right text-[#191F28]">{d.orders14d}</td>
                                <td className="px-3 py-2 text-right text-[#3182F6]">{fmtW(d.revenue14d)}</td>
                                <td className="px-3 py-2 text-right text-[#6B7684]">{pct(cvr)}</td>
                                <td className={`px-3 py-2 text-right font-bold ${roas >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                                  {d.cost > 0 ? `${(roas * 100).toFixed(0)}%` : '-'}
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr>
                                  <td colSpan={11} className="p-0 bg-[#FAFBFC] border-b border-[#E5E8EB]">
                                    <div className="px-6 py-3">
                                      <div className="text-[11px] font-semibold text-[#6B7684] mb-2">
                                        {d.date} — 키워드별 성과 ({kws.length}개 · 광고비 순)
                                      </div>
                                      <div className="overflow-auto max-h-96">
                                        <table className="w-full text-[11px]">
                                          <thead className="bg-white sticky top-0">
                                            <tr className="text-[#8B95A1] border-b border-[#F2F4F6]">
                                              <th className="text-left px-2 py-1.5 font-medium">키워드</th>
                                              <th className="text-right px-2 py-1.5 font-medium">노출</th>
                                              <th className="text-right px-2 py-1.5 font-medium">클릭</th>
                                              <th className="text-right px-2 py-1.5 font-medium">CTR</th>
                                              <th className="text-right px-2 py-1.5 font-medium">CPC</th>
                                              <th className="text-right px-2 py-1.5 font-medium">광고비</th>
                                              <th className="text-right px-2 py-1.5 font-medium">주문(14d)</th>
                                              <th className="text-right px-2 py-1.5 font-medium">매출(14d)</th>
                                              <th className="text-right px-2 py-1.5 font-medium">CVR</th>
                                              <th className="text-right px-2 py-1.5 font-medium">ROAS</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {kws.length === 0 && (
                                              <tr><td colSpan={10} className="text-center py-3 text-[#B0B8C1]">키워드 데이터 없음</td></tr>
                                            )}
                                            {kws.map((kd: any) => {
                                              const kctr = kd.impressions > 0 ? kd.clicks / kd.impressions : 0;
                                              const kcpc = kd.clicks > 0 ? Math.round(kd.cost / kd.clicks) : 0;
                                              const kcvr = kd.clicks > 0 ? kd.orders14d / kd.clicks : 0;
                                              const kroas = kd.cost > 0 ? kd.revenue14d / kd.cost : 0;
                                              return (
                                                <tr key={kd.keyword} className="border-b border-[#F5F6F7] hover:bg-white">
                                                  <td className="px-2 py-1.5 max-w-[260px] truncate font-medium text-[#333D4B]" title={kd.keyword}>{kd.keyword}</td>
                                                  <td className="px-2 py-1.5 text-right">{formatNumber(kd.impressions)}</td>
                                                  <td className="px-2 py-1.5 text-right">{formatNumber(kd.clicks)}</td>
                                                  <td className="px-2 py-1.5 text-right text-[#6B7684]">{pct(kctr)}</td>
                                                  <td className="px-2 py-1.5 text-right text-[#6B7684]">{kd.clicks > 0 ? fmtW(kcpc) : '-'}</td>
                                                  <td className="px-2 py-1.5 text-right text-[#F43F5E]">{fmtW(kd.cost)}</td>
                                                  <td className="px-2 py-1.5 text-right">{kd.orders14d}</td>
                                                  <td className="px-2 py-1.5 text-right text-[#3182F6]">{fmtW(kd.revenue14d)}</td>
                                                  <td className="px-2 py-1.5 text-right text-[#6B7684]">{pct(kcvr)}</td>
                                                  <td className={`px-2 py-1.5 text-right font-semibold ${kroas >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                                                    {kd.cost > 0 ? `${(kroas * 100).toFixed(0)}%` : '-'}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
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
                );
              })()}
            </div>
          )}

          {/* ─── Tab: Placements (지면별) ──────────────────────────────── */}
          {tab === 'placements' && (() => {
            // 지면 × 기간 집계
            const placeData = (() => {
              const map = new Map<string, any>();
              // 합산 데이터
              const totals = new Map<string, any>();
              for (const p of dateFiltered.placements) {
                totals.set(p.placement, { ...p });
              }
              // 기간별은 placementDaily에서 집계 (price 매칭된 revenue14d 포함)
              if (placeGran !== 'total') {
                for (const r of dateFiltered.placementDaily) {
                  const period = placeGran === 'daily' ? r.date : placeGran === 'monthly' ? r.date.slice(0, 7) : isoWeekKey(r.date);
                  const key = `${r.placement}||${period}`;
                  if (!map.has(key)) map.set(key, { placement: r.placement, period, periodLabel: placeGran === 'daily' ? period.slice(5) : placeGran === 'monthly' ? period : bucketLabel(period, 'weekly'), impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0 });
                  const m = map.get(key)!;
                  m.impressions += r.impressions;
                  m.clicks += r.clicks;
                  m.cost += r.cost;
                  m.orders14d += r.orders14d;
                  m.revenue14d += r.revenue14d;
                }
              }
              return { totals: [...totals.values()], byPeriod: [...map.values()] };
            })();

            const plFiltered = placeSearch ? placeData.totals.filter((p: any) => p.placement.toLowerCase().includes(placeSearch.toLowerCase())) : placeData.totals;
            const plNames = plFiltered.map((p: any) => p.placement);

            const renderMetricRow = (r: any, indent = false) => {
              const ctr = r.impressions > 0 ? r.clicks / r.impressions : 0;
              const roas = r.cost > 0 ? r.revenue14d / r.cost : 0;
              return (<>
                <td className="px-3 py-2 text-right text-[#6B7684]">{formatNumber(r.impressions)}</td>
                <td className="px-3 py-2 text-right text-[#191F28]">{formatNumber(r.clicks)}</td>
                <td className="px-3 py-2 text-right text-[#6B7684]">{pct(ctr)}</td>
                <td className="px-3 py-2 text-right text-[#F43F5E] font-medium">{fmtW(r.cost)}</td>
                <td className="px-3 py-2 text-right text-[#191F28]">{r.orders14d}</td>
                <td className="px-3 py-2 text-right text-[#3182F6] font-medium">{fmtW(r.revenue14d)}</td>
                <td className={`px-3 py-2 text-right font-bold ${roas >= 1 ? 'text-green-600' : 'text-red-500'}`}>{r.cost > 0 ? `${(roas * 100).toFixed(0)}%` : '-'}</td>
              </>);
            };

            // ── 100% 누적 영역 차트 데이터 ──
            const PLACE_COLORS: string[] = ['#3182F6', '#F43F5E', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4', '#EC4899', '#84CC16', '#6366F1', '#F97316'];
            const placeMetricOpts: { key: typeof placeMetric; label: string }[] = [
              { key: 'cost', label: '광고비' }, { key: 'impressions', label: '노출' },
              { key: 'clicks', label: '클릭' }, { key: 'orders14d', label: '주문' },
              { key: 'revenue14d', label: '매출' },
            ];
            const placeMetricLabel = placeMetricOpts.find(o => o.key === placeMetric)?.label ?? '';

            // 기간별 차트 데이터 생성 (합산이면 주간으로 표시)
            const chartGranForPlace = placeGran === 'total' ? 'weekly' as Granularity : placeGran as Granularity;
            const chartByPeriod = (() => {
              const map = new Map<string, any>();
              for (const r of dateFiltered.placementDaily) {
                const period = chartGranForPlace === 'daily' ? r.date : chartGranForPlace === 'monthly' ? r.date.slice(0, 7) : isoWeekKey(r.date);
                const label = chartGranForPlace === 'daily' ? period.slice(5) : chartGranForPlace === 'monthly' ? period : bucketLabel(period, 'weekly');
                if (!map.has(period)) map.set(period, { period, label, _cost: 0, _revenue: 0 });
                const row = map.get(period)!;
                row[r.placement] = (row[r.placement] ?? 0) + r[placeMetric];
                row._cost += r.cost;
                row._revenue += r.revenue14d;
              }
              return [...map.values()].sort((a, b) => a.period.localeCompare(b.period));
            })();

            // 비율 변환 (100% 누적) + ROAS
            const chartDataPct = chartByPeriod.map((row) => {
              const out: any = { label: row.label, period: row.period };
              let total = 0;
              for (const pl of plNames) total += row[pl] ?? 0;
              for (const pl of plNames) out[pl] = total > 0 ? ((row[pl] ?? 0) / total) * 100 : 0;
              out._total = total;
              out._roas = row._cost > 0 ? (row._revenue / row._cost) * 100 : 0;
              return out;
            });

            return (
            <div className="space-y-4">
              {/* 컨트롤 바 */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[160px] max-w-[300px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#B0B8C1]" />
                  <input value={placeSearch} onChange={(e) => setPlaceSearch(e.target.value)} placeholder="지면 검색"
                    className="w-full h-9 pl-8 pr-3 rounded-lg border border-[#E5E8EB] text-[12px] focus:outline-none focus:border-[#3182F6]" />
                </div>
                <div className="flex gap-1 bg-[#F2F4F6] rounded-lg p-0.5">
                  {([['total', '합산'], ['daily', '일'], ['weekly', '주'], ['monthly', '월']] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setPlaceGran(k)}
                      className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${placeGran === k ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684]'}`}>{l}</button>
                  ))}
                </div>
                <div className="flex gap-1 bg-[#F2F4F6] rounded-lg p-0.5">
                  {placeMetricOpts.map(({ key, label }) => (
                    <button key={key} onClick={() => setPlaceMetric(key)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${placeMetric === key ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684]'}`}>{label}</button>
                  ))}
                </div>
                <button onClick={() => setPlaceShowRoas(v => !v)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${placeShowRoas ? 'bg-[#191F28] text-white border-[#191F28]' : 'bg-white text-[#6B7684] border-[#E5E8EB] hover:border-[#B0B8C1]'}`}>
                  ROAS {placeShowRoas ? 'ON' : 'OFF'}
                </button>
              </div>

              {/* 100% 누적 영역 차트 + ROAS 보조축 */}
              {chartDataPct.length > 1 && (
                <div className="bg-white rounded-2xl border border-[#F2F4F6] p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[13px] font-bold text-[#191F28]">지면별 {placeMetricLabel} 비중 추이</h3>
                    {placeShowRoas && <span className="text-[11px] text-[#6B7684]">--- ROAS (우축)</span>}
                  </div>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartDataPct}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F6" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="left" tickFormatter={(v: number) => `${Math.round(v)}%`} tick={{ fontSize: 11 }} domain={[0, 100]} />
                        {placeShowRoas && (
                          <YAxis yAxisId="right" orientation="right"
                            tickFormatter={(v: number) => `${Math.round(v)}%`}
                            tick={{ fontSize: 11, fill: '#6B7684' }}
                            stroke="#B0B8C1" />
                        )}
                        <Tooltip
                          formatter={(value: number, name: string, props: any) => {
                            if (name === 'ROAS') return [`${value.toFixed(0)}%`, name];
                            const row = props.payload;
                            const total = row._total ?? 0;
                            const raw = total > 0 ? (value / 100) * total : 0;
                            const formatted = placeMetric === 'cost' || placeMetric === 'revenue14d'
                              ? fmtW(Math.round(raw)) : formatNumber(Math.round(raw));
                            return [`${formatted} (${value.toFixed(1)}%)`, name];
                          }}
                          labelFormatter={(label: string) => label}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {plNames.map((pl, i) => (
                          <Bar key={pl} dataKey={pl} stackId="1" yAxisId="left"
                            fill={PLACE_COLORS[i % PLACE_COLORS.length]}
                            fillOpacity={0.85} barSize={chartDataPct.length > 20 ? undefined : 40} />
                        ))}
                        {placeShowRoas && (
                          <Line type="monotone" dataKey="_roas" yAxisId="right" name="ROAS"
                            stroke="#191F28" strokeWidth={2} strokeDasharray="6 3"
                            dot={{ r: 3, fill: '#191F28' }} />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* 테이블 */}
              <div className="bg-white rounded-2xl border border-[#F2F4F6] overflow-x-auto relative">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-[#F2F4F6] bg-[#FAFBFC]">
                      <th className="text-left px-3 py-2.5 font-semibold text-[#6B7684]">지면</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684]">노출</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684]">클릭</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684]">CTR</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684]">광고비</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684]">주문</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684]">매출</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-[#6B7684]">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plFiltered.map((p: any) => {
                      const isExp = expandedPlaces.has(p.placement);
                      const subRows = placeData.byPeriod.filter((r: any) => r.placement === p.placement).sort((a: any, b: any) => a.period.localeCompare(b.period));
                      return (
                        <Fragment key={p.placement}>
                          <tr className="border-b border-[#F2F4F6] hover:bg-[#FAFBFC] cursor-pointer"
                            onClick={() => setExpandedPlaces((prev) => { const n = new Set(prev); n.has(p.placement) ? n.delete(p.placement) : n.add(p.placement); return n; })}>
                            <td className="px-3 py-2.5 font-medium text-[#191F28] flex items-center gap-1.5">
                              <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: PLACE_COLORS[plNames.indexOf(p.placement) % PLACE_COLORS.length] }} />
                              {placeGran !== 'total' && (isExp ? <ChevronDown className="h-3 w-3 inline" /> : <ChevronUp className="h-3 w-3 inline rotate-90" />)}
                              {p.placement}
                            </td>
                            {renderMetricRow(p)}
                          </tr>
                          {isExp && subRows.map((sr: any) => (
                            <tr key={`${p.placement}||${sr.period}`} className="border-b border-[#F2F4F6] bg-[#FAFBFF]">
                              <td className="px-3 py-2 pl-10 text-[11px] text-[#6B7684]">{sr.periodLabel}</td>
                              {renderMetricRow(sr, true)}
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {/* 플로팅 합계 */}
                <div className="sticky bottom-0 bg-[#F8FAFC] border-t-2 border-[#E5E8EB]">
                  <table className="w-full text-[12px]"><tbody>
                    <tr className="font-bold">
                      <td className="px-3 py-2.5 text-[#191F28]">합계</td>
                      {renderMetricRow(t)}
                    </tr>
                  </tbody></table>
                </div>
              </div>
            </div>
            );
          })()}

          {/* ─── Tab: Products (피벗 분석) ─────────────────────────────── */}
          {tab === 'products' && (() => {
            const COLORS: string[] = ['#3182F6', '#F43F5E', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4', '#EC4899', '#84CC16', '#6366F1', '#F97316'];
            const metricOpts = [
              { key: 'cost', label: '광고비(VAT)' }, { key: 'revenue14d', label: '매출' },
              { key: 'orders14d', label: '주문' }, { key: 'roas', label: 'ROAS' },
              { key: 'impressions', label: '노출' }, { key: 'clicks', label: '클릭' },
              { key: 'cpc', label: 'CPC' }, { key: 'aov', label: 'AOV' }, { key: 'profit', label: '순이익' },
            ];
            const getMetricVal = (r: any, key: string) => {
              if (key === 'ctr') return r.impressions > 0 ? r.clicks / r.impressions : 0;
              if (key === 'cpc') return r.clicks > 0 ? r.cost / r.clicks : 0;
              if (key === 'cvr') return r.clicks > 0 ? r.orders14d / r.clicks : 0;
              if (key === 'roas') return r.cost > 0 ? r.revenue14d / r.cost : 0;
              if (key === 'aov') return r.orders14d > 0 ? r.revenue14d / r.orders14d : 0;
              if (key === 'profit') return r.revenue14d - (r.cogs14d ?? 0) - (r.commission14d ?? 0) - r.cost;
              return r[key] ?? 0;
            };

            // 피벗 데이터: 상품/캠페인/키워드 × 기간
            const pivotRows = (() => {
              if (!data) return [];
              const map = new Map<string, any>();
              const gran = pivotGran === 'total' ? 'total' : pivotGran;

              if (pivotDim === 'keyword' && gran !== 'total') {
                for (const r of dateFiltered.keywordDaily) {
                  const period = gran === 'daily' ? r.date : gran === 'monthly' ? r.date.slice(0, 7) : isoWeekKey(r.date);
                  const key = `${period}||${r.keyword}`;
                  if (!map.has(key)) map.set(key, { period, periodLabel: gran === 'daily' ? period.slice(5) : gran === 'monthly' ? period : bucketLabel(period, 'weekly'), dim: r.keyword, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, cogs14d: 0, commission14d: 0 });
                  const m = map.get(key)!;
                  m.impressions += r.impressions;
                  m.clicks += r.clicks;
                  m.cost += r.cost;
                  m.orders14d += r.orders14d;
                  m.revenue14d += r.revenue14d;
                  m.cogs14d += r.cogs14d;
                  m.commission14d += r.commission14d;
                }
                return [...map.values()];
              }

              if (pivotDim === 'keyword' && gran === 'total') {
                for (const k of dateFiltered.keywords) {
                  map.set(k.keyword, { period: 'total', periodLabel: '합계', dim: k.keyword, impressions: k.impressions, clicks: k.clicks, cost: k.cost, orders14d: k.orders14d, revenue14d: k.revenue14d, cogs14d: 0, commission14d: 0 });
                }
                return [...map.values()];
              }

              for (const r of dateFiltered.rows) {
                const period = gran === 'total' ? 'total' : gran === 'daily' ? r.date : gran === 'monthly' ? r.date.slice(0, 7) : isoWeekKey(r.date);
                const dim = pivotDim === 'product' ? r.product : r.campaign;
                const key = `${period}||${dim}`;
                if (!map.has(key)) map.set(key, {
                  period, periodLabel: gran === 'total' ? '합계' : gran === 'daily' ? period.slice(5) : gran === 'monthly' ? period : bucketLabel(period, 'weekly'),
                  dim, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, cogs14d: 0, commission14d: 0,
                });
                const m = map.get(key)!;
                m.impressions += r.impressions; m.clicks += r.clicks; m.cost += r.cost;
                m.orders14d += r.orders14d; m.revenue14d += r.revenue14d;
                m.cogs14d += r.cogs14d; m.commission14d += r.commission14d;
              }
              return [...map.values()];
            })();

            // 전체 차원 목록 (상품/캠페인/키워드)
            const allDims = [...new Set(pivotRows.map((r: any) => r.dim))].sort();

            // 선택된 상품이 없으면 상위 3개 자동 선택
            const sel = selectedProducts.size > 0 ? selectedProducts : new Set(
              [...pivotRows].filter((r: any) => r.period === 'total' || pivotGran !== 'total')
                .reduce((acc: Map<string, number>, r: any) => { acc.set(r.dim, (acc.get(r.dim) ?? 0) + r.cost); return acc; }, new Map<string, number>())
                .entries().toArray().sort((a: any, b: any) => b[1] - a[1]).slice(0, 3).map((e: any) => e[0])
            );

            const toggleProduct = (dim: string) => {
              setSelectedProducts((prev) => {
                const next = new Set(prev.size > 0 ? prev : sel);
                next.has(dim) ? next.delete(dim) : next.add(dim);
                return next;
              });
            };

            // 비교 차트 데이터 (선택된 상품 × 기간)
            const chartGran = pivotGran === 'total' ? 'weekly' as Granularity : pivotGran as Granularity;
            const chartPeriods = [...new Set(pivotRows.filter((r: any) => r.period !== 'total').map((r: any) => r.period))].sort();
            // 기간이 없으면 filtered.rows에서 생성
            const chartPeriodsFromRows = chartPeriods.length > 0 ? chartPeriods : [...new Set(dateFiltered.rows.map((r) => {
              return chartGran === 'daily' ? r.date : chartGran === 'monthly' ? r.date.slice(0, 7) : isoWeekKey(r.date);
            }))].sort();

            const compareChartData = (() => {
              if (pivotGran === 'total') {
                // total 모드에서도 차트는 주간으로 보여줌
                const map = new Map<string, any>();
                for (const r of dateFiltered.rows) {
                  const period = isoWeekKey(r.date);
                  if (!map.has(period)) map.set(period, { period, label: bucketLabel(period, 'weekly') });
                  const row = map.get(period)!;
                  const dim = pivotDim === 'product' ? r.product : r.campaign;
                  if (!sel.has(dim)) continue;
                  if (!row[dim]) row[dim] = { impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, cogs14d: 0, commission14d: 0 };
                  const m = row[dim];
                  m.impressions += r.impressions; m.clicks += r.clicks; m.cost += r.cost;
                  m.orders14d += r.orders14d; m.revenue14d += r.revenue14d;
                  m.cogs14d += r.cogs14d; m.commission14d += r.commission14d;
                }
                return [...map.values()].sort((a, b) => a.period.localeCompare(b.period)).map((row) => {
                  const out: any = { label: row.label };
                  for (const dim of sel) { out[dim] = row[dim] ? getMetricVal(row[dim], prodMetric) : 0; }
                  return out;
                });
              }
              // 기간별 모드
              const map = new Map<string, any>();
              for (const r of pivotRows) {
                if (!sel.has(r.dim) || r.period === 'total') continue;
                if (!map.has(r.period)) map.set(r.period, { label: r.periodLabel });
                map.get(r.period)![r.dim] = getMetricVal(r, prodMetric);
              }
              return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
            })();

            // 테이블용 메트릭 컬럼
            const metricCols = [
              { key: 'impressions', label: '노출', get: (r: any) => r.impressions, fmt: (v: number) => formatNumber(v) },
              { key: 'clicks', label: '클릭', get: (r: any) => r.clicks, fmt: (v: number) => formatNumber(v), cls: 'text-[#191F28]' },
              { key: 'ctr', label: 'CTR', get: (r: any) => r.impressions > 0 ? r.clicks / r.impressions : 0, fmt: (v: number) => pct(v) },
              { key: 'cpc', label: 'CPC', get: (r: any) => r.clicks > 0 ? r.cost / r.clicks : 0, fmt: (v: number) => fmtW(Math.round(v)) },
              { key: 'cost', label: '광고비', get: (r: any) => r.cost, fmt: (v: number) => fmtW(v), cls: 'text-[#F43F5E] font-medium' },
              { key: 'orders14d', label: '주문', get: (r: any) => r.orders14d, fmt: (v: number) => String(v) },
              { key: 'revenue14d', label: '매출', get: (r: any) => r.revenue14d, fmt: (v: number) => fmtW(v), cls: 'text-[#3182F6] font-medium' },
              { key: 'aov', label: 'AOV', get: (r: any) => r.orders14d > 0 ? r.revenue14d / r.orders14d : 0, fmt: (v: number) => v > 0 ? fmtW(Math.round(v)) : '-' },
              { key: 'cvr', label: 'CVR', get: (r: any) => r.clicks > 0 ? r.orders14d / r.clicks : 0, fmt: (v: number) => pct(v) },
              { key: 'roas', label: 'ROAS', get: (r: any) => r.cost > 0 ? r.revenue14d / r.cost : 0,
                render: (r: any) => { const v = r.cost > 0 ? r.revenue14d / r.cost : 0; return <span className={v >= 1 ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}>{r.cost > 0 ? `${(v * 100).toFixed(0)}%` : '-'}</span>; } },
              { key: 'profit', label: '순이익', get: (r: any) => r.revenue14d - (r.cogs14d ?? 0) - (r.commission14d ?? 0) - r.cost,
                render: (r: any) => { const v = r.revenue14d - (r.cogs14d ?? 0) - (r.commission14d ?? 0) - r.cost; return <span className={v >= 0 ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>{fmtW(v)}</span>; } },
            ];

            const sorted = [...pivotRows].sort((a, b) => {
              if (pivotSortKey === 'period') return pivotSortAsc ? a.period.localeCompare(b.period) : b.period.localeCompare(a.period);
              if (pivotSortKey === 'dim') return pivotSortAsc ? a.dim.localeCompare(b.dim) : b.dim.localeCompare(a.dim);
              const col = metricCols.find(c => c.key === pivotSortKey);
              if (!col) return 0;
              return pivotSortAsc ? col.get(a) - col.get(b) : col.get(b) - col.get(a);
            });
            const togglePSort = (key: string) => { if (pivotSortKey === key) setPivotSortAsc(!pivotSortAsc); else { setPivotSortKey(key); setPivotSortAsc(false); } };
            const si = (key: string) => pivotSortKey === key ? (pivotSortAsc ? ' ↑' : ' ↓') : '';
            const dimLabel = pivotDim === 'product' ? '상품' : pivotDim === 'campaign' ? '캠페인' : '키워드';
            const selArr = [...sel];

            return (
            <div className="space-y-4">
              {/* 비교 차트 */}
              <div className="bg-white rounded-2xl border border-[#F2F4F6] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[13px] font-bold text-[#191F28]">{dimLabel}별 비교</h3>
                  <div className="flex gap-1 bg-[#F2F4F6] rounded-lg p-0.5">
                    {metricOpts.map((m) => (
                      <button key={m.key} onClick={() => setProdMetric(m.key)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${prodMetric === m.key ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684]'}`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                {compareChartData.length > 0 && (
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={compareChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F6" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => prodMetric === 'roas' ? `${(v * 100).toFixed(0)}%` : v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(Math.round(v))} />
                        <Tooltip formatter={(v: number, name: string) => [prodMetric === 'roas' ? `${(v * 100).toFixed(0)}%` : fmtW(Math.round(v)), name]} />
                        <Legend />
                        {selArr.map((dim, i) => (
                          <Line key={dim} dataKey={dim} name={dim.length > 15 ? dim.slice(0, 15) + '…' : dim}
                            stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
                        ))}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {/* 상품 선택 칩 */}
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[#F2F4F6]">
                  <span className="text-[11px] text-[#B0B8C1] py-1">비교 대상:</span>
                  {allDims.map((dim, i) => (
                    <button key={dim} onClick={() => toggleProduct(dim)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                        sel.has(dim)
                          ? 'text-white border-transparent'
                          : 'border-[#E5E8EB] bg-white text-[#8B95A1] hover:border-[#B0B8C1]'
                      }`}
                      style={sel.has(dim) ? { backgroundColor: COLORS[allDims.indexOf(dim) % COLORS.length] } : undefined}>
                      {dim.length > 20 ? dim.slice(0, 20) + '…' : dim}
                    </button>
                  ))}
                </div>
              </div>

              {/* 엑셀 피벗 스타일 테이블 */}
              <div className="bg-white rounded-2xl border border-[#F2F4F6] overflow-x-auto relative">
                <div className="flex flex-wrap items-center gap-3 px-4 pt-3 pb-2">
                  <div className="flex gap-1 bg-[#F2F4F6] rounded-lg p-0.5">
                    {([['product', '상품'], ['campaign', '캠페인'], ['keyword', '키워드']] as const).map(([k, l]) => (
                      <button key={k} onClick={() => { setPivotDim(k); setSelectedProducts(new Set()); setExpandedDims(new Set()); }}
                        className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${pivotDim === k ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684]'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1 bg-[#F2F4F6] rounded-lg p-0.5">
                    {([['weekly', '주'], ['monthly', '월'], ['daily', '일']] as const).map(([k, l]) => (
                      <button key={k} onClick={() => setPivotGran(k)}
                        className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${pivotGran === k ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684]'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <div className="relative flex-1 min-w-[140px] max-w-[260px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#B0B8C1]" />
                    <input value={pivotSearch} onChange={(e) => setPivotSearch(e.target.value)} placeholder={`${dimLabel} 검색`}
                      className="w-full h-8 pl-8 pr-3 rounded-lg border border-[#E5E8EB] text-[12px] focus:outline-none focus:border-[#3182F6]" />
                  </div>
                  <span className="text-[11px] text-[#8B95A1] ml-auto">{allDims.length}개</span>
                </div>
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-[#F2F4F6] bg-[#FAFBFC]">
                      <th onClick={() => togglePSort('dim')} className="text-left px-3 py-2.5 font-semibold text-[#6B7684] cursor-pointer hover:text-[#191F28] whitespace-nowrap select-none">{dimLabel}{si('dim')}</th>
                      {metricCols.map((col) => (
                        <th key={col.key} onClick={() => togglePSort(col.key)} className="text-right px-3 py-2.5 font-semibold text-[#6B7684] cursor-pointer hover:text-[#191F28] whitespace-nowrap select-none">{col.label}{si(col.key)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // 차원별 합산 (정렬용)
                      const dimTotals = new Map<string, any>();
                      for (const r of pivotRows) {
                        if (!dimTotals.has(r.dim)) dimTotals.set(r.dim, { dim: r.dim, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, cogs14d: 0, commission14d: 0 });
                        const m = dimTotals.get(r.dim)!;
                        m.impressions += r.impressions; m.clicks += r.clicks; m.cost += r.cost;
                        m.orders14d += r.orders14d; m.revenue14d += r.revenue14d;
                        m.cogs14d += r.cogs14d; m.commission14d += r.commission14d;
                      }
                      let dims = [...dimTotals.values()];
                      if (pivotSearch) dims = dims.filter((d) => d.dim.toLowerCase().includes(pivotSearch.toLowerCase()));
                      // 정렬
                      dims.sort((a, b) => {
                        if (pivotSortKey === 'dim') return pivotSortAsc ? a.dim.localeCompare(b.dim) : b.dim.localeCompare(a.dim);
                        const col = metricCols.find(c => c.key === pivotSortKey);
                        if (!col) return 0;
                        return pivotSortAsc ? col.get(a) - col.get(b) : col.get(b) - col.get(a);
                      });

                      return dims.map((dt) => {
                        const isExp = expandedDims.has(dt.dim);
                        const subRows = pivotRows.filter((r: any) => r.dim === dt.dim && r.period !== 'total').sort((a: any, b: any) => a.period.localeCompare(b.period));
                        const isSel = sel.has(dt.dim);
                        const dimColor = COLORS[allDims.indexOf(dt.dim) % COLORS.length];
                        return (
                          <Fragment key={dt.dim}>
                            <tr className={`border-b border-[#F2F4F6] hover:bg-[#FAFBFC] cursor-pointer ${isSel ? 'bg-[#F8FAFF]' : ''}`}
                              onClick={() => { toggleProduct(dt.dim); setExpandedDims((prev) => { const n = new Set(prev); n.has(dt.dim) ? n.delete(dt.dim) : n.add(dt.dim); return n; }); }}>
                              <td className="px-3 py-2.5 font-semibold text-[#191F28] max-w-[260px] truncate" title={dt.dim}>
                                {isExp ? <ChevronDown className="h-3 w-3 inline mr-1.5 text-[#6B7684]" /> : <ChevronUp className="h-3 w-3 inline mr-1.5 text-[#B0B8C1] rotate-90" />}
                                {isSel && <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: dimColor }} />}
                                {dt.dim}
                              </td>
                              {metricCols.map((col) => (
                                <td key={col.key} className={`px-3 py-2.5 text-right font-semibold ${col.cls ?? 'text-[#6B7684]'}`}>
                                  {col.render ? col.render(dt) : col.fmt!(col.get(dt))}
                                </td>
                              ))}
                            </tr>
                            {isExp && subRows.map((sr: any) => (
                              <tr key={`${sr.dim}||${sr.period}`} className="border-b border-[#F2F4F6] bg-[#FAFBFF]">
                                <td className="px-3 py-2 pl-8 text-[11px] text-[#6B7684]">{sr.periodLabel}</td>
                                {metricCols.map((col) => (
                                  <td key={col.key} className={`px-3 py-2 text-right text-[11px] ${col.cls ?? 'text-[#8B95A1]'}`}>
                                    {col.render ? col.render(sr) : col.fmt!(col.get(sr))}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </Fragment>
                        );
                      });
                    })()}
                  </tbody>
                </table>
                {/* 플로팅 합계 */}
                <div className="sticky bottom-0 bg-[#F8FAFC] border-t-2 border-[#E5E8EB]">
                  <table className="w-full text-[12px]"><tbody>
                    <tr className="font-bold">
                      <td className="px-3 py-2.5 text-[#191F28]">합계</td>
                      {metricCols.map((col) => (
                        <td key={col.key} className="px-3 py-2.5 text-right">
                          {col.render ? col.render(t) : col.fmt!(col.get(t))}
                        </td>
                      ))}
                    </tr>
                  </tbody></table>
                </div>
              </div>
            </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
