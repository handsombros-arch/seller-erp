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
  BarChart, Cell,
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
  { key: 'revenue14d', label: '매출(14일)',   type: 'line', unit: 'won', color: '#0071E3', getValue: (d) => d.revenue14d },
  { key: 'roas14d',    label: 'ROAS(14일)',   type: 'bar',  unit: 'pct', color: '#10B981', getValue: (d) => d.cost > 0 ? d.revenue14d / d.cost : 0 },
  { key: 'impressions',label: '노출',         type: 'line', unit: 'cnt', color: '#86868B', getValue: (d) => d.impressions },
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
    <div className="bg-white rounded-[18px] border border-black/[0.06] p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-[12px] text-[#6E6E73] font-medium">{label}</span>
      </div>
      <p className="text-[20px] font-bold text-[#1D1D1F] mt-1">{value}</p>
      {sub && <p className="text-[11px] text-[#D2D2D7]">{sub}</p>}
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
          ? 'border-[#1D1D1F] bg-white text-[#1D1D1F] shadow-sm'
          : 'border-black/[0.08] bg-[#FBFBFD] text-[#86868B] hover:border-[#D2D2D7]'
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
  const [tab, setTab] = useState<'daily' | 'keywords' | 'placements' | 'products' | 'momwow'>('daily');
  const [pivotAxis, setPivotAxis] = useState<'kw-date' | 'date-kw'>('kw-date');
  const [pivotMetric, setPivotMetric] = useState<'cost' | 'impressions' | 'clicks' | 'orders14d' | 'revenue14d' | 'ctr' | 'cvr' | 'roas' | 'cpc' | 'keywordCount' | 'clickKeywordCount'>('cost');
  const [pivotTopN, setPivotTopN] = useState(50);
  const [gran, setGran] = useState<Granularity>('daily');
  const [placeTypeFilter, setPlaceTypeFilter] = useState<'all' | 'search' | 'nonsearch'>('all'); // 기간별 추이: 쿠팡 검색/비검색 지면
  const [activeMetrics, setActiveMetrics] = useState<MetricKey[]>(DEFAULT_METRICS);
  const [filterCampaign, setFilterCampaign] = useState('all');
  const [filterProduct, setFilterProduct] = useState('all');
  const [activeKpis, setActiveKpis] = useState<KpiKey[]>(loadKpis);
  const [kpiEditOpen, setKpiEditOpen] = useState(false);
  const TREND_SORT_STORAGE = 'lv-erp-ad-trend-sort';
  const [trendSortKey, setTrendSortKey] = useState<string>(() => {
    if (typeof window === 'undefined') return 'date';
    try { const s = localStorage.getItem(TREND_SORT_STORAGE); if (s) return JSON.parse(s).key ?? 'date'; } catch {}
    return 'date';
  });
  const [trendSortAsc, setTrendSortAsc] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try { const s = localStorage.getItem(TREND_SORT_STORAGE); if (s) return !!JSON.parse(s).asc; } catch {}
    return true;
  });
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
  // 기본 기간: 전월 1일 ~ 오늘. 사용자가 수정하면 localStorage 에 저장해 새로고침/이동/창종료 후에도 유지.
  const DATE_RANGE_STORAGE = 'lv-erp-ad-date-range';
  const persistRange = (from: string, to: string) => { try { localStorage.setItem(DATE_RANGE_STORAGE, JSON.stringify({ from, to })); } catch {} };
  const [dateFrom, setDateFrom] = useState<string>(() => {
    if (typeof window !== 'undefined') { try { const s = localStorage.getItem(DATE_RANGE_STORAGE); if (s) return JSON.parse(s).from ?? ''; } catch {} }
    const d = new Date(); const p = new Date(d.getFullYear(), d.getMonth() - 1, 1); // 전월 1일
    return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [dateTo, setDateTo] = useState<string>(() => {
    if (typeof window !== 'undefined') { try { const s = localStorage.getItem(DATE_RANGE_STORAGE); if (s) return JSON.parse(s).to ?? ''; } catch {} }
    const d = new Date(); // 오늘
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  // 저장된 기간이 있으면(=사용자가 수정함) 데이터 로드 시 자동 핏을 멈춘다
  const dateTouchedRef = useRef<boolean>((() => { if (typeof window === 'undefined') return false; try { return !!localStorage.getItem(DATE_RANGE_STORAGE); } catch { return false; } })());
  const setDateFromUser = (v: string) => { dateTouchedRef.current = true; setDateFrom(v); persistRange(v, dateTo); };
  const setDateToUser = (v: string) => { dateTouchedRef.current = true; setDateTo(v); persistRange(dateFrom, v); };
  const [metricTypes, setMetricTypes] = useState<Record<string, 'bar' | 'line'>>({});
  const [rightAxisKeys, setRightAxisKeys] = useState<Set<string>>(new Set());
  const [memos, setMemos] = useState<Record<string, string>>({});
  const [placeShowRoas, setPlaceShowRoas] = useState(false);
  // 증감(MoM/WoW) 분석 탭 상태
  const [momGran, setMomGran] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [momCurPeriod, setMomCurPeriod] = useState<string>(''); // 기준 기간 ('' = 최신)
  const [momBasePeriod, setMomBasePeriod] = useState<string>(''); // 비교 기간 ('' = 직전)
  const [momView, setMomView] = useState<'cards' | 'bars'>('cards'); // 증감 시각화: KPI 카드 / 가로 막대
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
      renderTotal: (t) => formatNumber(t.clicks), className: 'text-[#1D1D1F]' },
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
      renderTotal: (t) => fmtW(t.revenue14d), className: 'text-[#0071E3] font-medium' },
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
  // 로컬(IDB)에만 있고 DB 엔 아직 없는 행 수. >0 이면 백업 권유 배너 노출.
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  // 본문 gzip 압축 (CompressionStream 지원하는 모던 브라우저). 실패 시 raw JSON.
  const gzipJson = async (obj: unknown): Promise<{ body: BodyInit; gzipped: boolean }> => {
    const json = JSON.stringify(obj);
    if (typeof CompressionStream === 'undefined') return { body: json, gzipped: false };
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
      const blob = await new Response(stream).blob();
      return { body: blob, gzipped: true };
    } catch {
      return { body: json, gzipped: false };
    }
  };

  const uploadRowsInChunks = useCallback(async (
    rows: any[],
    filename: string,
    opts: { abortOnFirstFail?: boolean } = {},
  ) => {
    // 5000 행은 서버 단일 함수에서 17×300 upsert 돌 때 Postgres statement_timeout 위험.
    // 2000 행으로 줄여 청크당 ~7×300 upsert 로 timeout 여유 확보. gzip 후엔 여전히 1MB 미만.
    const CHUNK = 2000;
    const totalChunks = Math.ceil(rows.length / CHUNK);
    let inserted = 0, attempted = 0, failedChunks = 0;
    let firstServerError: string | null = null;
    setSyncProgress({ done: 0, total: totalChunks });
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      try {
        const { body, gzipped } = await gzipJson({ rows: batch, filename });
        const res = await fetch('/api/ad-analysis/rows', {
          method: 'POST',
          headers: { 'Content-Type': gzipped ? 'application/gzip' : 'application/json' },
          body,
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!firstServerError) firstServerError = j.error || `HTTP ${res.status}`;
          failedChunks++;
          if (opts.abortOnFirstFail) break;
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

      // 여러 파일 동시 읽기 — CSV/TSV/TXT 는 구분자 자동인식 + 스트리밍 파서(PapaParse),
      // 엑셀(.xlsx/.xls)은 기존 XLSX. CSV 가 커도 안 멈추고, TSV(탭)도 자동 인식됨.
      const allRows: any[] = [];
      for (const file of files) {
        if (/\.(csv|tsv|txt)$/i.test(file.name)) {
          const Papa = (await import('papaparse')).default;
          const rows = await new Promise<any[]>((resolve, reject) => {
            Papa.parse(file, {
              header: true,         // 첫 행을 컬럼명으로 (sheet_to_json 과 동일)
              skipEmptyLines: true,
              dynamicTyping: true,  // 숫자 자동 변환 — 엑셀 경로와 동일한 값 타입
              // delimiter 미지정 = 콤마/탭 자동 감지 (CSV·TSV 모두 처리)
              complete: (res) => resolve(res.data as any[]),
              error: (err) => reject(err),
            });
          });
          for (const r of rows) allRows.push(r); // spread(...) 금지 — 대용량이면 스택 초과
        } else {
          const buffer = await file.arrayBuffer();
          const wb = XLSX.read(buffer, { type: 'array' });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
          for (const r of rows) allRows.push(r); // spread(...) 금지 — 대용량이면 스택 초과
        }
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

      // IDB 만 갱신 — DB 동기화는 수동 버튼으로 분리 (자동 청크 업로드가 느려서 사용자 요청).
      // 다른 PC 와 공유하려면 우측 "DB 로 백업" 버튼을 명시적으로 눌러야 함.
      saveToIdb(raw);
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }, [data, processData, saveResult]);

  // 수동 DB 백업 — 현재 IDB/메모리에 있는 전체 raw 를 청크 업로드.
  // dedup_key 로 ignoreDuplicates 되므로 여러 번 눌러도 안전.
  const handleSyncToDb = useCallback(async () => {
    if (!data?._rawRows?.length) return;
    const sync = await uploadRowsInChunks(data._rawRows, `manual-sync-${new Date().toISOString().slice(0, 10)}`);
    if (sync.failedChunks > 0 || sync.firstServerError) {
      setError(`DB 업로드 부분 실패 — ${sync.failedChunks}/${sync.totalChunks} 청크 실패` +
        (sync.firstServerError ? ` · 서버: ${sync.firstServerError}` : '') +
        ` (다시 누르면 dedup 으로 중복은 자동 스킵)`);
      // 부분 실패면 미백업분이 남아있으니 배너 유지.
    } else {
      setError('');
      setUnsyncedCount(0); // 전체 성공 시에만 미백업 0 으로.
    }
  }, [data, uploadRowsInChunks]);

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
    const files = [...e.dataTransfer.files].filter(f => /\.(xlsx|xls|csv|tsv|txt)$/i.test(f.name));
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

  // ─── 페이지 로드: IDB 캐시 즉시 표시 → 백그라운드에서 DB 로 갱신 ───
  const [initialLoading, setInitialLoading] = useState(false);
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (initialLoadDone.current || data) return;
    initialLoadDone.current = true;
    (async () => {
      setInitialLoading(true);
      try {
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

        // 1) IDB 캐시 즉시 표시 — 새로고침 시 1초 미만
        const idbRows = await loadFromIdb();
        if (idbRows?.length) {
          saveResult(processData(idbRows, prices, confirmedMap, saverCost ?? 0, mTotal ?? 0));
          setInitialLoading(false); // 화면 즉시 사용 가능
        }

        // 2) 백그라운드 DB 갱신 — 절대 일방 덮어쓰기 금지. dedup_key 기준 합집합(union)만.
        //    로컬(IDB)에만 있든 DB 에만 있든 모든 행을 보존한다. 데이터가 줄어드는 방향은 없음.
        //    ⚠️ 과거 사고: 여기서 DB 로 IDB 를 통째로 덮어써 로컬 풀 데이터가 말없이 사라짐.
        try {
          const dbRes = await fetch('/api/ad-analysis/rows');
          if (!dbRes.ok) return;
          const j = await dbRes.json();
          const dbRows: any[] = j.rows ?? [];

          // IDB ∪ DB — 같은 dedup_key 는 한 번만(중복 적재 없음), 어느 쪽에만 있어도 보존.
          // union 키는 DB PK(route.ts) 및 dedupKey() 와 완전히 동일하므로 idempotent.
          const merged: any[] = [];
          const seen = new Set<string>();
          for (const r of (idbRows ?? [])) {
            const k = dedupKey(r);
            if (!seen.has(k)) { seen.add(k); merged.push(r); }
          }
          for (const r of dbRows) {
            const k = dedupKey(r);
            if (!seen.has(k)) { seen.add(k); merged.push(r); }
          }

          if (!merged.length) return; // 양쪽 다 비었으면 둘 곳도, 그릴 것도 없음

          // 합집합이 로컬과 달라졌을 때만 IDB/화면 갱신. merged 는 idbRows 의 상위집합이라
          // 절대 줄지 않음(삭제 0). DB 에서 새로 받은 행이 있으면 그만큼 늘어남.
          if (!idbRows || merged.length !== idbRows.length) {
            saveToIdb(merged);
            saveResult(processData(merged, prices, confirmedMap, saverCost ?? 0, mTotal ?? 0));
          }

          // 로컬에만 있고 DB 엔 아직 없는 행 수 = |IDB ∪ DB| − |DB|. >0 이면 백업 안 된 데이터 존재.
          setUnsyncedCount(Math.max(0, merged.length - dbRows.length));
        } catch {}
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

  // 기간별 추이용 일별 데이터 — 검색/비검색 필터 (전체면 dateFiltered.daily 그대로)
  // 쿠팡: 키워드가 '-' = 비검색. keywordDaily 는 키워드≠'-'(검색)만 담으므로
  //  · 검색  = keywordDaily 일자 합 (cogs/commission 포함, 정확)
  //  · 비검색 = 전체 daily − 검색 (정확)
  const trendDaily = useMemo(() => {
    if (placeTypeFilter === 'all') return dateFiltered.daily;
    const searchByDate = new Map<string, DailyRow>();
    for (const kd of (dateFiltered.keywordDaily ?? [])) {
      if (!searchByDate.has(kd.date)) searchByDate.set(kd.date, { date: kd.date, impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, revenue14d_raw: 0, cogs14d: 0, commission14d: 0 });
      const m = searchByDate.get(kd.date)!;
      m.impressions += kd.impressions; m.clicks += kd.clicks; m.cost += kd.cost;
      m.orders14d += kd.orders14d; m.revenue14d += kd.revenue14d; m.revenue14d_raw += kd.revenue14d;
      m.cogs14d += kd.cogs14d; m.commission14d += kd.commission14d;
    }
    if (placeTypeFilter === 'search') {
      return [...searchByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    }
    // 비검색 = 전체 − 검색 (일자별). 월 고정비 안분분(daily.cogs 에 가산됨)은 비검색에 귀속됨.
    return dateFiltered.daily.map((d) => {
      const s = searchByDate.get(d.date);
      return {
        date: d.date,
        impressions: d.impressions - (s?.impressions ?? 0),
        clicks: d.clicks - (s?.clicks ?? 0),
        cost: d.cost - (s?.cost ?? 0),
        orders14d: d.orders14d - (s?.orders14d ?? 0),
        revenue14d: d.revenue14d - (s?.revenue14d ?? 0),
        revenue14d_raw: d.revenue14d_raw - (s?.revenue14d_raw ?? 0),
        cogs14d: d.cogs14d - (s?.cogs14d ?? 0),
        commission14d: d.commission14d - (s?.commission14d ?? 0),
      } as DailyRow;
    }).sort((a, b) => a.date.localeCompare(b.date));
  }, [placeTypeFilter, dateFiltered.daily, dateFiltered.keywordDaily]);

  // 기간별 추이 합계 (지면 필터 반영 — '전체'면 dateFiltered.totals 와 동일)
  const trendTotal = useMemo(() => trendDaily.reduce((acc, d) => {
    acc.impressions += d.impressions; acc.clicks += d.clicks; acc.cost += d.cost;
    acc.orders14d += d.orders14d; acc.revenue14d += d.revenue14d; acc.revenue14d_raw += d.revenue14d_raw;
    acc.cogs14d += d.cogs14d; acc.commission14d += d.commission14d;
    return acc;
  }, { date: '', impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, revenue14d_raw: 0, cogs14d: 0, commission14d: 0 } as DailyRow), [trendDaily]);

  // Aggregated chart data
  const chartData = useMemo(() => {
    if (!trendDaily.length) return [];
    const buckets = aggregateByGranularity(trendDaily, gran);
    // 노출/유입 키워드 수 = 버킷별 '검색' 키워드(키워드≠'-') distinct 개수.
    //  · 전체/검색 → keywordDaily 에서 직접 집계 (지면 필터와 무관하게 동일)
    //  · 비검색    → 키워드 없음이 정상 → 0
    const kwSet = new Map<string, Set<string>>();
    const kwClickSet = new Map<string, Set<string>>();
    if (placeTypeFilter !== 'nonsearch') {
      for (const kd of (dateFiltered.keywordDaily ?? [])) {
        const key = bucketKey(kd.date, gran);
        if (kd.impressions > 0) { if (!kwSet.has(key)) kwSet.set(key, new Set()); kwSet.get(key)!.add(kd.keyword); }
        if (kd.clicks > 0) { if (!kwClickSet.has(key)) kwClickSet.set(key, new Set()); kwClickSet.get(key)!.add(kd.keyword); }
      }
    }
    return buckets.map((b) => {
      const row: any = { ...b, keywordCount: kwSet.get(b.date)?.size ?? 0, clickKeywordCount: kwClickSet.get(b.date)?.size ?? 0 };
      for (const m of METRICS) {
        row[`__${m.key}`] = m.getValue(b);
      }
      return row;
    });
  }, [trendDaily, dateFiltered.keywordDaily, gran, placeTypeFilter]);

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
    const nextAsc = trendSortKey === key ? !trendSortAsc : (key === 'date');
    setTrendSortKey(key); setTrendSortAsc(nextAsc);
    try { localStorage.setItem(TREND_SORT_STORAGE, JSON.stringify({ key, asc: nextAsc })); } catch {}
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

  // 키워드 분석 → 네이티브 엑셀 피벗테이블 (xlsx 안에 pivotCache/pivotTable XML 직접 작성)
  // '데이터' 시트(원본 키워드×일자 전체) + '피벗' 시트(실제 PivotTable). refreshOnLoad 로 열 때 자동 갱신.
  const downloadKeywordPivot = useCallback(async () => {
    const srcRows = dateFiltered.keywordDaily ?? [];
    if (!srcRows.length) return;
    const JSZip = (await import('jszip')).default;
    const byDate = pivotAxis === 'date-kw'; // true: 행 = 일자→키워드, false: 행 = 키워드→일자

    // (키워드,일자) 합산 — 전체 키워드 포함
    const agg = new Map<string, { keyword: string; date: string; imp: number; clk: number; cost: number; ord: number; rev: number }>();
    for (const d of srcRows) {
      const k = `${d.keyword}||${d.date}`;
      if (!agg.has(k)) agg.set(k, { keyword: d.keyword, date: d.date, imp: 0, clk: 0, cost: 0, ord: 0, rev: 0 });
      const x = agg.get(k)!;
      x.imp += d.impressions; x.clk += d.clicks; x.cost += d.cost; x.ord += d.orders14d; x.rev += d.revenue14d;
    }
    const recs = [...agg.values()];

    // distinct 차원 (records 의 x 인덱스 참조용)
    const kws: string[] = []; const kwIdx = new Map<string, number>();
    const dates: string[] = []; const dtIdx = new Map<string, number>();
    for (const r of recs) {
      if (!kwIdx.has(r.keyword)) { kwIdx.set(r.keyword, kws.length); kws.push(r.keyword); }
      if (!dtIdx.has(r.date)) { dtIdx.set(r.date, dates.length); dates.push(r.date); }
    }

    const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    // shared strings (데이터 시트 문자열)
    const ss: string[] = []; const ssIdx = new Map<string, number>();
    const sId = (s: string) => { const e = esc(s); if (!ssIdx.has(e)) { ssIdx.set(e, ss.length); ss.push(e); } return ssIdx.get(e)!; };
    const headers = ['키워드', '일자', '노출', '클릭', '광고비', '주문', '매출'];
    const hIds = headers.map(sId);
    const kwS = kws.map(sId); const dtS = dates.map(sId);

    const nrows = recs.length + 1;
    const COL = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    let sd = `<row r="1">` + COL.map((c, i) => `<c r="${c}1" t="s"><v>${hIds[i]}</v></c>`).join('') + `</row>`;
    recs.forEach((r, i) => {
      const rn = i + 2;
      sd += `<row r="${rn}"><c r="A${rn}" t="s"><v>${kwS[kwIdx.get(r.keyword)!]}</v></c><c r="B${rn}" t="s"><v>${dtS[dtIdx.get(r.date)!]}</v></c>` +
        `<c r="C${rn}"><v>${r.imp}</v></c><c r="D${rn}"><v>${r.clk}</v></c><c r="E${rn}"><v>${r.cost}</v></c><c r="F${rn}"><v>${r.ord}</v></c><c r="G${rn}"><v>${r.rev}</v></c></row>`;
    });

    const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:G${nrows}"/><sheetData>${sd}</sheetData></worksheet>`;
    const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1"/><sheetData/></worksheet>`;

    const mm = (sel: (r: any) => number) => { let mn = Infinity, mx = -Infinity; for (const r of recs) { const v = sel(r); if (v < mn) mn = v; if (v > mx) mx = v; } if (!isFinite(mn)) { mn = 0; mx = 0; } return `minValue="${mn}" maxValue="${mx}"`; };
    const numF = (name: string, sel: (r: any) => number) => `<cacheField name="${esc(name)}" numFmtId="0"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1" containsInteger="1" ${mm(sel)}/></cacheField>`;

    const cacheDef = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1" refreshOnLoad="1" refreshedBy="seller-erp" createdVersion="3" refreshedVersion="3" minRefreshableVersion="3" recordCount="${recs.length}"><cacheSource type="worksheet"><worksheetSource ref="A1:G${nrows}" sheet="데이터"/></cacheSource><cacheFields count="7"><cacheField name="키워드" numFmtId="0"><sharedItems count="${kws.length}">${kws.map(k => `<s v="${esc(k)}"/>`).join('')}</sharedItems></cacheField><cacheField name="일자" numFmtId="0"><sharedItems count="${dates.length}">${dates.map(d => `<s v="${esc(d)}"/>`).join('')}</sharedItems></cacheField>${numF('노출', r => r.imp)}${numF('클릭', r => r.clk)}${numF('광고비', r => r.cost)}${numF('주문', r => r.ord)}${numF('매출', r => r.rev)}</cacheFields></pivotCacheDefinition>`;

    const recXml = recs.map(r => `<r><x v="${kwIdx.get(r.keyword)}"/><x v="${dtIdx.get(r.date)}"/><n v="${r.imp}"/><n v="${r.clk}"/><n v="${r.cost}"/><n v="${r.ord}"/><n v="${r.rev}"/></r>`).join('');
    const cacheRec = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheRecords xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" count="${recs.length}">${recXml}</pivotCacheRecords>`;

    const kwItems = `<items count="${kws.length + 1}">${kws.map((_, i) => `<item x="${i}"/>`).join('')}<item t="default"/></items>`;
    const dtItems = `<items count="${dates.length + 1}">${dates.map((_, i) => `<item x="${i}"/>`).join('')}<item t="default"/></items>`;
    const rowFieldsXml = byDate ? `<field x="1"/><field x="0"/>` : `<field x="0"/><field x="1"/>`;
    const pivot = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" name="키워드피벗" cacheId="1" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="값" updatedVersion="3" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="3" indent="0" outline="1" outlineData="1" multipleFieldFilters="0"><location ref="A3:G50" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/><pivotFields count="7"><pivotField axis="axisRow" showAll="0">${kwItems}</pivotField><pivotField axis="axisRow" showAll="0">${dtItems}</pivotField><pivotField dataField="1" showAll="0"/><pivotField dataField="1" showAll="0"/><pivotField dataField="1" showAll="0"/><pivotField dataField="1" showAll="0"/><pivotField dataField="1" showAll="0"/></pivotFields><rowFields count="2">${rowFieldsXml}</rowFields><rowItems count="1"><i><x/></i></rowItems><colFields count="1"><field x="-2"/></colFields><colItems count="5"><i><x/></i><i i="1"><x v="1"/></i><i i="2"><x v="2"/></i><i i="3"><x v="3"/></i><i i="4"><x v="4"/></i></colItems><dataFields count="5"><dataField name="합계 : 노출" fld="2" baseField="0" baseItem="0"/><dataField name="합계 : 클릭" fld="3" baseField="0" baseItem="0"/><dataField name="합계 : 광고비" fld="4" baseField="0" baseItem="0" numFmtId="3"/><dataField name="합계 : 주문" fld="5" baseField="0" baseItem="0"/><dataField name="합계 : 매출" fld="6" baseField="0" baseItem="0" numFmtId="3"/></dataFields><pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`;

    const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${ss.length}" uniqueCount="${ss.length}">${ss.map(s => `<si><t xml:space="preserve">${s}</t></si>`).join('')}</sst>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/><Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/><Override PartName="/xl/pivotCache/pivotCacheRecords1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/></Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="데이터" sheetId="1" r:id="rId1"/><sheet name="피벗" sheetId="2" r:id="rId2"/></sheets><pivotCaches><pivotCache cacheId="1" r:id="rId3"/></pivotCaches></workbook>`;
    const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${REL}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/><Relationship Id="rId4" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId5" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
    const sheet2Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>`;
    const pivotRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>`;
    const cacheRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/pivotCacheRecords" Target="pivotCacheRecords1.xml"/></Relationships>`;

    const zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('xl/workbook.xml', workbookXml);
    zip.file('xl/_rels/workbook.xml.rels', wbRels);
    zip.file('xl/styles.xml', styles);
    zip.file('xl/sharedStrings.xml', sharedStrings);
    zip.file('xl/worksheets/sheet1.xml', sheet1);
    zip.file('xl/worksheets/sheet2.xml', sheet2);
    zip.file('xl/worksheets/_rels/sheet2.xml.rels', sheet2Rels);
    zip.file('xl/pivotTables/pivotTable1.xml', pivot);
    zip.file('xl/pivotTables/_rels/pivotTable1.xml.rels', pivotRels);
    zip.file('xl/pivotCache/pivotCacheDefinition1.xml', cacheDef);
    zip.file('xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels', cacheRels);
    zip.file('xl/pivotCache/pivotCacheRecords1.xml', cacheRec);

    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `광고분석_키워드피벗_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }, [dateFiltered.keywordDaily, pivotAxis]);

  const handleDownload = useCallback(() => {
    // 합계 행 헬퍼 — 비율(CTR/CVR/ROAS/CPC)은 단순 합이 아니라 합산 구성요소로 재계산
    const sumOf = (arr: any[]) => arr.reduce((a, r) => { a.impressions += r.impressions; a.clicks += r.clicks; a.cost += r.cost; a.orders14d += r.orders14d; a.revenue14d += r.revenue14d; return a; }, { impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0 });
    const ctrStr = (x: any) => x.impressions > 0 ? (x.clicks / x.impressions * 100).toFixed(2) + '%' : '-';
    const cvrStr = (x: any) => x.clicks > 0 ? (x.orders14d / x.clicks * 100).toFixed(2) + '%' : '-';
    const roasStr = (x: any) => x.cost > 0 ? (x.revenue14d / x.cost * 100).toFixed(1) + '%' : '-';
    const cpcVal = (x: any) => x.clicks > 0 ? Math.round(x.cost / x.clicks) : 0;
    if (tab === 'daily') {
      const dateHeader = gran === 'daily' ? '날짜' : gran === 'weekly' ? '주차' : '월';
      // 화면 표와 동일하게: 보이는 컬럼만 · 드래그 순서대로 · 정렬 순서대로 출력
      const colNum = (d: any, key: TableColKey): number | string => {
        switch (key) {
          case 'impressions': return d.impressions;
          case 'clicks': return d.clicks;
          case 'ctr': return d.impressions > 0 ? (d.clicks / d.impressions * 100).toFixed(2) + '%' : '-';
          case 'cpc': return d.clicks > 0 ? Math.round(d.cost / d.clicks) : 0;
          case 'cost': return d.cost;
          case 'orders14d': return d.orders14d;
          case 'revenue14d': return d.revenue14d;
          case 'roas': return d.cost > 0 ? (d.revenue14d / d.cost * 100).toFixed(1) + '%' : '-';
          case 'cvr': return d.clicks > 0 ? (d.orders14d / d.clicks * 100).toFixed(2) + '%' : '-';
          case 'cpm': return d.impressions > 0 ? Math.round(d.cost / d.impressions * 1000) : 0;
          case 'cpa': return d.orders14d > 0 ? Math.round(d.cost / d.orders14d) : 0;
          case 'aov': return d.orders14d > 0 ? Math.round(d.revenue14d / d.orders14d) : 0;
          case 'adRatio': return d.revenue14d > 0 ? +(d.cost / d.revenue14d * 100).toFixed(2) : 0;
          case 'profit': return Math.round(d.revenue14d - (d.cogs14d ?? 0) - (d.commission14d ?? 0) - d.cost);
          case 'keywordCount': return d.keywordCount ?? 0;
          case 'clickKeywordCount': return d.clickKeywordCount ?? 0;
          default: return 0;
        }
      };
      const summary = sortedTrendData.map((d: any) => {
        const row: Record<string, any> = { [dateHeader]: d.label };
        for (const col of visibleCols) row[col.label] = colNum(d, col.key);
        return row;
      });
      // 합계 행 (비율 컬럼은 합산값으로 재계산, 키워드수는 합산 불가라 '-')
      const totalRow: Record<string, any> = { [dateHeader]: '합계' };
      for (const col of visibleCols) totalRow[col.label] = (col.key === 'keywordCount' || col.key === 'clickKeywordCount') ? '-' : colNum(trendTotal, col.key);
      summary.push(totalRow);
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
          CTR: r.impressions > 0 ? (r.clicks / r.impressions * 100).toFixed(2) + '%' : '-',
          CPC: r.clicks > 0 ? Math.round(r.cost / r.clicks) : 0,
          '주문(14일)': r.orders14d, '매출(14일)': r.revenue14d,
          CVR: r.clicks > 0 ? (r.orders14d / r.clicks * 100).toFixed(2) + '%' : '-',
          ROAS: r.cost > 0 ? (r.revenue14d / r.cost * 100).toFixed(1) + '%' : '-',
        }));
      const dkTot = sumOf([...byDateKw.values()]);
      dateKw.push({ 날짜: '합계', 키워드: '', 노출: dkTot.impressions, 클릭: dkTot.clicks, 광고비: dkTot.cost, CTR: ctrStr(dkTot), CPC: cpcVal(dkTot), '주문(14일)': dkTot.orders14d, '매출(14일)': dkTot.revenue14d, CVR: cvrStr(dkTot), ROAS: roasStr(dkTot) });
      downloadXlsxMulti(
        [{ name: gran === 'daily' ? '일자' : gran === 'weekly' ? '주차' : '월', data: summary }, { name: '일자×키워드', data: dateKw }],
        `광고분석_${gran}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } else if (tab === 'keywords') {
      // 그룹 접기/펼치기 피벗(ExcelJS). pivotAxis 에 따라 그룹키/강조 변경. 전체 키워드 포함.
      downloadKeywordPivot();
    } else if (tab === 'placements') {
      const rows = dateFiltered.placements.map((p) => ({
        노출지면: p.placement, 노출: p.impressions, 클릭: p.clicks,
        CTR: p.impressions > 0 ? (p.clicks / p.impressions * 100).toFixed(2) + '%' : '-',
        광고비: p.cost, '주문(14일)': p.orders14d, '매출(14일)': p.revenue14d,
        'ROAS(14일)': p.cost > 0 ? (p.revenue14d / p.cost * 100).toFixed(1) + '%' : '-',
      }));
      const pTot = sumOf(dateFiltered.placements);
      rows.push({ 노출지면: '합계', 노출: pTot.impressions, 클릭: pTot.clicks, CTR: ctrStr(pTot), 광고비: pTot.cost, '주문(14일)': pTot.orders14d, '매출(14일)': pTot.revenue14d, 'ROAS(14일)': roasStr(pTot) });
      downloadXlsx(rows, `광고분석_노출지면_${new Date().toISOString().slice(0, 10)}.xlsx`);
    }
  }, [tab, gran, sortedTrendData, trendTotal, visibleCols, dateFiltered.placements, dateFiltered.keywordDaily, downloadXlsx, downloadXlsxMulti, downloadKeywordPivot]);

  // ─── Render ─────────────────────────────────────────────────────────────

  const t = dateFiltered.totals;
  const hasData = data && t && (t.cost > 0 || t.impressions > 0);
  const roas14d = t && t.cost > 0 ? t.revenue14d / t.cost : 0;

  const tabs = [
    { key: 'daily' as const, label: '기간별 추이' },
    { key: 'keywords' as const, label: '키워드 분석' },
    { key: 'placements' as const, label: '지면별' },
    { key: 'products' as const, label: '상품별' },
    { key: 'momwow' as const, label: '증감(MoM/WoW)' },
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
          <Megaphone className="h-5 w-5 text-[#0071E3]" />
          <h1 className="text-[20px] font-bold text-[#1D1D1F]">광고 분석</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            className="flex items-center gap-2 h-10 px-4 rounded-xl bg-[#0071E3] text-white text-[13px] font-semibold hover:bg-[#0077ED] disabled:opacity-60 transition-colors"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            데이터 추가
          </button>
          {data && (
            <button
              onClick={() => { if (confirm('모든 광고 데이터를 삭제하시겠습니까?')) { setData(null); } }}
              className="flex items-center gap-2 h-10 px-4 rounded-xl border border-black/[0.08] text-[#6E6E73] text-[13px] font-medium hover:bg-[#FBFBFD] transition-colors"
            >
              초기화
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv,.tsv,.txt"
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
          className="border-2 border-dashed border-[#D1D6DB] rounded-[18px] p-12 text-center hover:border-[#0071E3] hover:bg-[#F8FAFF] transition-colors cursor-pointer"
          onClick={() => !initialLoading && fileRef.current?.click()}
        >
          {initialLoading ? (
            <>
              <Loader2 className="h-10 w-10 mx-auto text-[#0071E3] mb-3 animate-spin" />
              <p className="text-[15px] font-semibold text-[#1D1D1F]">저장된 데이터 불러오는 중...</p>
              <p className="text-[12px] text-[#86868B] mt-1">이전에 업로드한 광고 데이터를 복원합니다</p>
            </>
          ) : (
            <>
              <Upload className="h-10 w-10 mx-auto text-[#D2D2D7] mb-3" />
              <p className="text-[15px] font-semibold text-[#1D1D1F]">쿠팡 광고 데이터 (xlsx · csv · tsv) 를 드래그하거나 클릭하세요</p>
              <p className="text-[12px] text-[#86868B] mt-1">PA 일별 키워드 리포트 · 큰 CSV/TSV 도 OK · 여러 파일 동시 업로드 · 중복 자동 제거</p>
            </>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[#0071E3]" />
          <span className="ml-3 text-[15px] text-[#6E6E73]">데이터 처리 중...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">{error}</div>
      )}

      {/* 미백업 데이터 경고 — 로컬에만 있고 DB 엔 없는 행이 있을 때. 데이터 안전 가시화. */}
      {unsyncedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-[12px] text-amber-900">
          <span className="font-semibold">⚠️ {unsyncedCount.toLocaleString()}행이 이 브라우저(로컬)에만 있고 DB 엔 백업되지 않았습니다.</span>
          <span className="text-amber-800">캐시가 지워지거나 다른 기기에서 열면 이 데이터를 잃을 수 있습니다. 지금 DB 로 백업하세요.</span>
          <button
            onClick={handleSyncToDb}
            disabled={!!syncProgress}
            className="ml-auto h-7 px-3 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-[11px] font-semibold whitespace-nowrap"
          >
            {syncProgress ? `백업 중 ${syncProgress.done}/${syncProgress.total}` : '지금 DB 로 백업'}
          </button>
        </div>
      )}

      {/* 데이터 요약 + 수동 DB 백업 */}
      {data?._rawRows && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#86868B]">
          <span>데이터: {data._rawRows.length.toLocaleString()}행 로드됨 (로컬)</span>
          {data.dateRange?.from && data.dateRange?.to && (
            <span>· 데이터 기간: {data.dateRange.from} ~ {data.dateRange.to}</span>
          )}
          {data._diagnostics && data._diagnostics.skippedNoDate > 0 && (
            <span className="text-amber-600">· 날짜 인식 실패 {data._diagnostics.skippedNoDate.toLocaleString()}행 건너뜀</span>
          )}
          <button
            onClick={handleSyncToDb}
            disabled={!!syncProgress}
            className="ml-auto h-7 px-2.5 rounded-lg border border-[#BFD7FF] text-[#0071E3] hover:bg-[#F0F6FF] disabled:opacity-50 disabled:cursor-not-allowed text-[11px] font-medium"
            title="다른 PC 와 공유하려면 눌러 DB 에 백업. 평소엔 로컬(IDB)만으로 동작."
          >
            {syncProgress
              ? `DB 백업 중 ${syncProgress.done}/${syncProgress.total}`
              : 'DB 로 백업'}
          </button>
        </div>
      )}

      {/* 기간 선택 (데이터 있으면 항상 노출 — hasData 와 무관) */}
      {data && (
        <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl border border-black/[0.06] px-4 py-2.5">
          <span className="text-[12px] font-semibold text-[#1D1D1F]">기간</span>
          <input type="date" value={dateFrom} onChange={e => setDateFromUser(e.target.value)}
            className="h-8 px-2 rounded-lg border border-black/[0.08] text-[11px] bg-white" />
          <span className="text-[11px] text-[#6E6E73]">~</span>
          <input type="date" value={dateTo} onChange={e => setDateToUser(e.target.value)}
            className="h-8 px-2 rounded-lg border border-black/[0.08] text-[11px] bg-white" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { dateTouchedRef.current = true; setDateFrom(''); setDateTo(''); persistRange('', ''); }}
              className="h-8 px-2 rounded-lg text-[10px] text-red-400 hover:bg-red-50 border border-red-200">초기화</button>
          )}
          {data.dateRange?.from && data.dateRange?.to && (
            <button onClick={() => {
              dateTouchedRef.current = true;
              setDateFrom(data.dateRange.from);
              setDateTo(data.dateRange.to);
              persistRange(data.dateRange.from, data.dateRange.to);
            }} className="h-8 px-2 rounded-lg text-[10px] text-[#0071E3] hover:bg-[#F0F6FF] border border-[#BFD7FF]">데이터 전체 기간</button>
          )}
          {(dateFrom || dateTo) && (
            <span className="text-[10px] text-[#6E6E73] ml-1">
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
                dateTouchedRef.current = true;
                setDateFrom(data.dateRange.from);
                setDateTo(data.dateRange.to);
                persistRange(data.dateRange.from, data.dateRange.to);
              }} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[11px] font-semibold hover:bg-amber-700">
                데이터 전체 기간으로 보기
              </button>
            )}
            <button onClick={() => { dateTouchedRef.current = true; setDateFrom(''); setDateTo(''); persistRange('', ''); }}
              className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-800 text-[11px] font-semibold hover:bg-amber-100">
              기간 필터 해제
            </button>
          </div>
        </div>
      )}

      {/* 매칭 확인 패널 */}
      {pendingMatches.length > 0 && (
        <div className="bg-white rounded-[18px] border-2 border-[#0071E3] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-bold text-[#1D1D1F]">상품 매칭 확인</h3>
            <span className="text-[11px] text-[#86868B]">
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
                  <p className="font-medium text-[#1D1D1F]">{m.adName}</p>
                  <p className="text-[#6E6E73] mt-0.5">
                    → {m.dbName} · {m.price?.toLocaleString()}원 · 원가 {m.cost_price?.toLocaleString()}원 · 수수료 {m.commission_rate}%
                    <span className="ml-2 text-[10px] text-[#D2D2D7]">신뢰도 {Math.round(m.score * 100)}%</span>
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
              className="px-4 py-2 rounded-lg bg-[#0071E3] text-white text-[12px] font-semibold hover:bg-[#0077ED] disabled:opacity-40"
            >적용</button>
            <button
              onClick={() => { setPendingMatches([]); setPendingRaw(null); }}
              className="px-4 py-2 rounded-lg border border-black/[0.08] text-[#6E6E73] text-[12px] font-medium hover:bg-[#FBFBFD]"
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
                  <label className="text-[12px] font-medium text-[#6E6E73]">캠페인</label>
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
                    className="h-9 px-3 rounded-lg border border-black/[0.08] text-[13px] text-[#1D1D1F] bg-white focus:outline-none focus:border-[#0071E3]"
                  >
                    <option value="all">전체 ({campaignsForProduct.length})</option>
                    {campaignsForProduct.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}
              {data.products.length > 1 && (
                <div className="flex items-center gap-2">
                  <label className="text-[12px] font-medium text-[#6E6E73]">상품</label>
                  <select
                    value={filterProduct}
                    onChange={(e) => setFilterProduct(e.target.value)}
                    className="h-9 px-3 rounded-lg border border-black/[0.08] text-[13px] text-[#1D1D1F] bg-white focus:outline-none focus:border-[#0071E3] max-w-[300px] truncate"
                  >
                    <option value="all">전체 ({productsForCampaign.length})</option>
                    {productsForCampaign.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              )}
              {(filterCampaign !== 'all' || filterProduct !== 'all') && (
                <button
                  onClick={() => { setFilterCampaign('all'); setFilterProduct('all'); }}
                  className="text-[12px] text-[#0071E3] font-medium hover:underline"
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
              <span className="text-[12px] text-[#86868B]">핵심 지표</span>
              <button
                onClick={() => setKpiEditOpen(!kpiEditOpen)}
                className="text-[12px] text-[#0071E3] font-medium hover:underline"
              >
                {kpiEditOpen ? '완료' : '편집'}
              </button>
            </div>
            {kpiEditOpen && (
              <div className="flex flex-wrap gap-2 mb-3 p-3 bg-[#FBFBFD] rounded-xl border border-black/[0.08]">
                {KPI_DEFS.map((kd) => (
                  <button
                    key={kd.key}
                    onClick={() => toggleKpi(kd.key)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${
                      activeKpis.includes(kd.key)
                        ? 'border-[#0071E3] bg-[#EBF1FE] text-[#0071E3]'
                        : 'border-black/[0.08] bg-white text-[#86868B] hover:border-[#D2D2D7]'
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
                <div className="bg-white rounded-[18px] border border-black/[0.06] p-4">
                  <p className="text-[12px] text-[#6E6E73]">광고 순이익 (14일) = 매출 − 원가 − 수수료 − 광고비</p>
                  <p className={`text-[20px] font-bold mt-1 ${netProfit > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmtW(netProfit)}
                  </p>
                  <p className="text-[11px] text-[#D2D2D7]">
                    매출 {fmtW(t.revenue14d)} − 원가 {fmtW(t.cogs14d)}{commission > 0 ? ` − 수수료 ${fmtW(Math.round(commission))}` : ''} − 광고비 {fmtW(t.cost)}
                  </p>
                </div>
                <div className="bg-white rounded-[18px] border border-black/[0.06] p-4">
                  <p className="text-[12px] text-[#6E6E73]">건당 광고비</p>
                  <p className="text-[20px] font-bold mt-1 text-[#1D1D1F]">
                    {perOrderCost ? fmtW(perOrderCost) : '-'}
                  </p>
                  <p className="text-[11px] text-[#D2D2D7]">광고비 ÷ 주문수(14일)</p>
                </div>
                <div className="bg-white rounded-[18px] border border-black/[0.06] p-4">
                  <p className="text-[12px] text-[#6E6E73]">건당 순이익</p>
                  <p className={`text-[20px] font-bold mt-1 ${perOrderProfit > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {perOrderProfit ? fmtW(perOrderProfit) : '-'}
                  </p>
                  <p className="text-[11px] text-[#D2D2D7]">(매출 − 원가 − 수수료 − 광고비) ÷ 주문수</p>
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
              <div className="bg-white rounded-[18px] border border-black/[0.06] p-5 space-y-2">
                <h3 className="text-[13px] font-bold text-[#1D1D1F]">자동 인사이트</h3>
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
          <div className="flex gap-1 bg-[#F5F5F7] rounded-xl p-1 w-fit">
            {tabs.map((tb) => (
              <button
                key={tb.key}
                onClick={() => setTab(tb.key)}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                  tab === tb.key ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73] hover:text-[#1D1D1F]'
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
              <div className="bg-white rounded-[18px] border border-black/[0.06] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[13px] font-bold text-[#1D1D1F]">기간별 추이</h3>
                  {/* Granularity toggle */}
                  <div className="flex gap-1 bg-[#F5F5F7] rounded-lg p-0.5">
                    {granOptions.map((g) => (
                      <button
                        key={g.key}
                        onClick={() => setGran(g.key)}
                        className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                          gran === g.key ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 쿠팡 검색/비검색 지면 필터 */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-[#86868B]">지면</span>
                  <div className="flex gap-1 bg-[#F5F5F7] rounded-lg p-0.5">
                    {([['all', '전체'], ['search', '검색지면'], ['nonsearch', '비검색지면']] as const).map(([k, l]) => (
                      <button key={k} onClick={() => setPlaceTypeFilter(k)}
                        className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${placeTypeFilter === k ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73] hover:text-[#1D1D1F]'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                  {placeTypeFilter === 'search' && <span className="text-[11px] text-[#C7C7CC]">키워드 있는 행(검색) · 차트/표/엑셀 적용</span>}
                  {placeTypeFilter === 'nonsearch' && <span className="text-[11px] text-[#C7C7CC]">키워드 &lsquo;-&rsquo; 행(비검색) · 월 고정비는 비검색에 귀속</span>}
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
                          active ? 'text-white shadow-sm' : 'bg-[#F5F5F7] text-[#6E6E73] hover:bg-[#E5E5EA]'
                        }`}
                        style={active ? { backgroundColor: m.color } : {}}>
                        {m.label} {active ? (currentType === 'bar' ? '▊' : '━') : ''}
                      </button>
                    );
                  })}
                  {activeMetrics.length > 0 && (
                    <div className="flex items-center gap-1 ml-1 border-l border-black/[0.08] pl-2">
                      <span className="text-[10px] text-[#6E6E73]">보조축:</span>
                      {activeMetrics.map(key => {
                        const m = METRICS.find(x => x.key === key);
                        if (!m) return null;
                        const isRight = rightAxisKeys.has(key);
                        return (
                          <button key={key} onClick={() => setRightAxisKeys(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })}
                            className={`h-6 px-1.5 rounded text-[9px] font-semibold transition-all ${isRight ? 'text-white' : 'bg-[#F5F5F7] text-[#6E6E73]'}`}
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
                        <CartesianGrid strokeDasharray="3 3" stroke="#F5F5F7" />
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
                  <p className="text-center text-[13px] text-[#D2D2D7] py-10">표시할 지표를 선택하세요</p>
                )}
              </div>

              {/* Data table */}
              <div className="bg-white rounded-[18px] border border-black/[0.06] overflow-x-auto">
                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                  <span className="text-[12px] text-[#86868B]">헤더 클릭 정렬 · 헤더 드래그 순서 변경</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setTableColEdit(!tableColEdit)}
                      className={`flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11px] font-medium border transition-all ${
                        tableColEdit ? 'border-[#0071E3] bg-[#EBF1FE] text-[#0071E3]' : 'border-black/[0.08] text-[#6E6E73] hover:border-[#D2D2D7]'
                      }`}>
                      <Settings className="h-3 w-3" /> 컬럼
                    </button>
                    <button onClick={handleDownload} className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11px] font-medium border border-[#0071E3] text-[#0071E3] bg-white hover:bg-[#EBF1FE] transition-colors">
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
                            ? 'border-[#0071E3] bg-[#EBF1FE] text-[#0071E3]'
                            : 'border-black/[0.08] bg-white text-[#86868B] hover:border-[#D2D2D7]'
                        }`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-black/[0.06] bg-[#FAFBFC]">
                      <th onClick={() => toggleTrendSort('date')}
                        className="text-left px-3 py-2.5 font-semibold text-[#6E6E73] cursor-pointer hover:text-[#1D1D1F] select-none whitespace-nowrap">
                        {gran === 'daily' ? '날짜' : gran === 'weekly' ? '주차' : '월'} <TrendSortIcon k="date" />
                      </th>
                      {visibleCols.map((col) => (
                        <th key={col.key}
                          draggable
                          onDragStart={() => handleColDragStart(col.key)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleColDrop(col.key)}
                          onClick={() => toggleTrendSort(col.key)}
                          className="text-right px-3 py-2.5 font-semibold text-[#6E6E73] cursor-grab hover:text-[#1D1D1F] select-none whitespace-nowrap active:cursor-grabbing">
                          {col.label} <TrendSortIcon k={col.key} />
                        </th>
                      ))}
                      <th className="px-2 py-2.5 text-[#6E6E73] font-semibold text-left whitespace-nowrap">메모</th>
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
                          <tr className={`border-b border-black/[0.06] hover:bg-[#FAFBFC] ${memos[d.date] ? 'bg-amber-50/30' : ''} ${isExpanded ? 'bg-[#F0F7FF]' : ''} ${canDrill ? 'cursor-pointer' : ''}`}
                            onClick={(e) => {
                              if (!canDrill) return;
                              const t = e.target as HTMLElement;
                              if (t.tagName === 'INPUT') return;
                              setExpandedDate(isExpanded ? null : d.date);
                            }}>
                            <td className="px-3 py-2.5 font-medium text-[#1D1D1F]">
                              <div className="flex items-center gap-1.5">
                                {canDrill && <span className="text-[#D2D2D7]">{isExpanded ? '▾' : '▸'}</span>}
                                {d.label}
                                {memos[d.date] && <span className="text-[9px] text-amber-600 bg-amber-100 px-1 rounded">메모</span>}
                              </div>
                            </td>
                            {visibleCols.map((col) => (
                              <td key={col.key} className={`px-3 py-2.5 text-right ${col.className ?? 'text-[#6E6E73]'}`}>
                                {col.render(d)}
                              </td>
                            ))}
                            <td className="px-1 py-1">
                              <input value={memos[d.date] ?? ''} onChange={e => saveMemo(d.date, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="메모" className="w-24 h-7 px-1.5 text-[10px] rounded border border-transparent hover:border-black/[0.08] focus:border-[#0071E3] focus:outline-none bg-transparent" />
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={visibleCols.length + 2} className="p-0 bg-[#FAFBFC] border-b border-black/[0.08]">
                                <div className="px-6 py-3">
                                  <div className="text-[11px] font-semibold text-[#6E6E73] mb-2">
                                    {d.label} — 키워드별 성과 ({kwForDate.length}개 키워드, 광고비 순)
                                  </div>
                                  <div className="overflow-auto max-h-96">
                                    <table className="w-full text-[11px]">
                                      <thead className="bg-white sticky top-0">
                                        <tr className="text-[#86868B] border-b border-black/[0.06]">
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
                                          <tr><td colSpan={10} className="text-center py-3 text-[#D2D2D7]">키워드 데이터 없음</td></tr>
                                        )}
                                        {kwForDate.map((kd) => {
                                          const ctr = kd.impressions > 0 ? kd.clicks / kd.impressions : 0;
                                          const cpc = kd.clicks > 0 ? Math.round(kd.cost / kd.clicks) : 0;
                                          const cvr = kd.clicks > 0 ? kd.orders14d / kd.clicks : 0;
                                          const roas = kd.cost > 0 ? kd.revenue14d / kd.cost : 0;
                                          return (
                                            <tr key={kd.keyword} className="border-b border-[#F5F6F7] hover:bg-white">
                                              <td className="px-2 py-1.5 max-w-[260px] truncate font-medium text-[#1D1D1F]" title={kd.keyword}>{kd.keyword}</td>
                                              <td className="px-2 py-1.5 text-right">{formatNumber(kd.impressions)}</td>
                                              <td className="px-2 py-1.5 text-right">{formatNumber(kd.clicks)}</td>
                                              <td className="px-2 py-1.5 text-right text-[#6E6E73]">{pct(ctr)}</td>
                                              <td className="px-2 py-1.5 text-right text-[#6E6E73]">{kd.clicks > 0 ? fmtW(cpc) : '-'}</td>
                                              <td className="px-2 py-1.5 text-right text-[#F43F5E]">{fmtW(kd.cost)}</td>
                                              <td className="px-2 py-1.5 text-right">{kd.orders14d}</td>
                                              <td className="px-2 py-1.5 text-right text-[#0071E3]">{fmtW(kd.revenue14d)}</td>
                                              <td className="px-2 py-1.5 text-right text-[#6E6E73]">{pct(cvr)}</td>
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
                <div className="sticky bottom-0 bg-[#F8FAFC] border-t-2 border-black/[0.08]">
                  <table className="w-full text-[12px]"><tbody>
                    <tr className="font-bold">
                      <td className="px-3 py-2.5 text-[#1D1D1F]">합계</td>
                      {visibleCols.map((col) => (
                        <td key={col.key} className="px-3 py-2.5 text-right">
                          {col.renderTotal(trendTotal)}
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
                  className="flex items-center gap-2 h-8 px-3 rounded-lg border border-[#0071E3] bg-white hover:bg-[#EBF1FE] text-[#0071E3] text-[12px] font-medium transition-colors"
                  title="행/열 전환 (엑셀 피벗처럼 축 바꾸기)"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  {pivotAxis === 'kw-date' ? '행: 키워드 → 열: 일자' : '행: 일자 → 열: 키워드'}
                  <span className="text-[#D2D2D7]">↔</span>
                </button>
                <span className="text-[11px] text-[#86868B]">
                  {pivotAxis === 'kw-date' ? '키워드 클릭 → 일자별 펼침' : '일자 클릭 → 키워드별 펼침'}
                </span>
                <div className="flex items-center gap-2 ml-auto">
                  <label className="text-[12px] font-medium text-[#6E6E73]">차트 지표</label>
                  <select value={pivotMetric} onChange={(e) => setPivotMetric(e.target.value as typeof pivotMetric)}
                    className="h-8 px-2 rounded-lg border border-black/[0.08] text-[12px] bg-white focus:outline-none focus:border-[#0071E3]">
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
                  revenue14d: { label: '매출(14d)', type: 'bar', unit: 'won', color: '#0071E3' },
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
                  <div className="bg-white rounded-[18px] border border-black/[0.06] p-5">
                    <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[13px] font-bold text-[#1D1D1F]">
                          기간별 {info.label} 추이
                        </h3>
                        {expandedKw && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] bg-[#EBF1FE] text-[#0071E3] px-2 py-0.5 rounded-full font-medium">
                            <Search className="h-3 w-3" />
                            {expandedKw}
                            <button onClick={() => setExpandedKw(null)} className="ml-0.5 hover:bg-white/50 rounded-full w-4 h-4 flex items-center justify-center" title="선택 해제">
                              ×
                            </button>
                          </span>
                        )}
                        {!expandedKw && <span className="text-[11px] text-[#86868B]">· 키워드 클릭 시 해당 키워드 기준 차트로 전환</span>}
                      </div>
                      <div className="flex gap-1 bg-[#F5F5F7] rounded-lg p-0.5">
                        {([
                          { key: 'daily' as Granularity, label: '일' },
                          { key: 'weekly' as Granularity, label: '주' },
                          { key: 'monthly' as Granularity, label: '월' },
                        ]).map((g) => (
                          <button key={g.key} onClick={() => setGran(g.key)}
                            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${gran === g.key ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73] hover:text-[#1D1D1F]'}`}>
                            {g.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={enhancedData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#F5F5F7" />
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
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#D2D2D7]" />
                  <input
                    type="text"
                    value={kwSearch}
                    onChange={(e) => setKwSearch(e.target.value)}
                    placeholder="키워드 검색..."
                    className="w-full h-10 pl-9 pr-3 rounded-xl border border-black/[0.08] text-[13px] focus:outline-none focus:border-[#0071E3] focus:ring-2 focus:ring-[#0071E3]/10"
                  />
                </div>
                <button onClick={() => setKwOnlyOrders(!kwOnlyOrders)}
                  className={`h-8 px-3 rounded-lg text-[12px] font-medium border transition-all ${kwOnlyOrders ? 'border-[#0071E3] bg-[#EBF1FE] text-[#0071E3]' : 'border-black/[0.08] text-[#6E6E73]'}`}>
                  구매 키워드만
                </button>
                <button onClick={handleDownload} className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border border-[#0071E3] text-[#0071E3] bg-white hover:bg-[#EBF1FE] transition-colors">
                  <Download className="h-3.5 w-3.5" /> xlsx · 엑셀 피벗테이블 ({pivotAxis === 'kw-date' ? '행: 키워드→일자' : '행: 일자→키워드'})
                </button>
                <span className="text-[12px] text-[#86868B]">
                  {sortedKeywords.length}개{kwSearch ? ' (필터)' : ''} / 전체 {dateFiltered.keywords.length}개 키워드
                </span>
              </div>
              )}

              {pivotAxis === 'kw-date' && (<>
              <div className="bg-white rounded-[18px] border border-black/[0.06] max-h-[70vh] overflow-auto">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-black/[0.06] bg-[#FAFBFC] shadow-sm">
                      <th className="w-6 bg-[#FAFBFC]"></th>
                      <th className="text-left px-3 py-2.5 font-semibold text-[#6E6E73] min-w-[180px] bg-[#FAFBFC]">키워드</th>
                      {([
                        ['impressions', '노출'], ['clicks', '클릭'], ['cost', '광고비'],
                        ['ctr', 'CTR'], ['cpc', 'CPC'], ['orders14d', '주문(14d)'],
                        ['revenue14d', '매출(14d)'], ['cvr', 'CVR'], ['roas14d', 'ROAS(14d)'],
                      ] as [SortKey, string][]).map(([k, label]) => (
                        <th key={k}
                          onClick={() => toggleSort(k)}
                          className="text-right px-3 py-2.5 font-semibold text-[#6E6E73] cursor-pointer hover:text-[#1D1D1F] whitespace-nowrap select-none bg-[#FAFBFC]"
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
                            className={`border-b border-black/[0.06] hover:bg-[#FAFBFC] cursor-pointer ${isExpanded ? 'bg-[#F0F7FF]' : ''}`}
                            onClick={() => setExpandedKw(isExpanded ? null : k.keyword)}
                          >
                            <td className="px-1.5 py-2 text-center text-[#D2D2D7]">
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5 inline" /> : <ChevronRight className="h-3.5 w-3.5 inline" />}
                            </td>
                            <td className="px-3 py-2 font-medium text-[#1D1D1F] max-w-[260px] truncate">{k.keyword}</td>
                            <td className="px-3 py-2 text-right text-[#6E6E73]">{formatNumber(k.impressions)}</td>
                            <td className="px-3 py-2 text-right text-[#1D1D1F]">{formatNumber(k.clicks)}</td>
                            <td className="px-3 py-2 text-right text-[#F43F5E]">{fmtW(k.cost)}</td>
                            <td className="px-3 py-2 text-right text-[#6E6E73]">{pct(k.ctr)}</td>
                            <td className="px-3 py-2 text-right text-[#6E6E73]">{fmtW(k.cpc)}</td>
                            <td className="px-3 py-2 text-right text-[#1D1D1F]">{k.orders14d}</td>
                            <td className="px-3 py-2 text-right text-[#0071E3]">{fmtW(k.revenue14d)}</td>
                            <td className="px-3 py-2 text-right text-[#6E6E73]">{pct(k.cvr)}</td>
                            <td className={`px-3 py-2 text-right font-bold ${k.roas14d >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                              {k.cost > 0 ? `${(k.roas14d * 100).toFixed(0)}%` : '-'}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={11} className="p-0 bg-[#FAFBFC] border-b border-black/[0.08]">
                                <div className="px-6 py-3">
                                  <div className="text-[11px] font-semibold text-[#6E6E73] mb-2">{k.keyword} — 일자별 성과 ({dailyList.length}일)</div>
                                  <table className="w-full text-[11px]">
                                    <thead>
                                      <tr className="text-[#86868B] border-b border-black/[0.06]">
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
                                        <tr><td colSpan={10} className="text-center py-3 text-[#D2D2D7]">해당 기간 노출 없음</td></tr>
                                      )}
                                      {dailyList.map((d) => {
                                        const ctr = d.impressions > 0 ? d.clicks / d.impressions : 0;
                                        const cpc = d.clicks > 0 ? Math.round(d.cost / d.clicks) : 0;
                                        const cvr = d.clicks > 0 ? d.orders14d / d.clicks : 0;
                                        const roas = d.cost > 0 ? d.revenue14d / d.cost : 0;
                                        return (
                                          <tr key={d.date} className="border-b border-[#F5F6F7] hover:bg-white">
                                            <td className="px-2 py-1.5 font-mono text-[#1D1D1F]">{d.date}</td>
                                            <td className="px-2 py-1.5 text-right">{formatNumber(d.impressions)}</td>
                                            <td className="px-2 py-1.5 text-right">{formatNumber(d.clicks)}</td>
                                            <td className="px-2 py-1.5 text-right text-[#6E6E73]">{pct(ctr)}</td>
                                            <td className="px-2 py-1.5 text-right text-[#6E6E73]">{d.clicks > 0 ? fmtW(cpc) : '-'}</td>
                                            <td className="px-2 py-1.5 text-right text-[#F43F5E]">{fmtW(d.cost)}</td>
                                            <td className="px-2 py-1.5 text-right">{d.orders14d}</td>
                                            <td className="px-2 py-1.5 text-right text-[#0071E3]">{fmtW(d.revenue14d)}</td>
                                            <td className="px-2 py-1.5 text-right text-[#6E6E73]">{pct(cvr)}</td>
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
                    className="text-[13px] text-[#0071E3] font-medium hover:underline"
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
                  <div className="bg-white rounded-[18px] border border-black/[0.06] max-h-[70vh] overflow-auto">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b border-black/[0.06] bg-[#FAFBFC] shadow-sm">
                          <th className="w-6 bg-[#FAFBFC]"></th>
                          <th className="text-left px-3 py-2.5 font-semibold text-[#6E6E73] min-w-[120px] bg-[#FAFBFC]">일자</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73] bg-[#FAFBFC]">노출</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73] bg-[#FAFBFC]">클릭</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73] bg-[#FAFBFC]">CTR</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73] bg-[#FAFBFC]">CPC</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73] bg-[#FAFBFC]">광고비</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73] bg-[#FAFBFC]">주문(14d)</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73] bg-[#FAFBFC]">매출(14d)</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73] bg-[#FAFBFC]">CVR</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73] bg-[#FAFBFC]">ROAS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {daily.length === 0 && (
                          <tr><td colSpan={11} className="text-center py-6 text-[#D2D2D7]">일자 데이터 없음</td></tr>
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
                              <tr className={`border-b border-black/[0.06] hover:bg-[#FAFBFC] cursor-pointer ${isExpanded ? 'bg-[#F0F7FF]' : ''}`}
                                  onClick={() => setExpandedDate(isExpanded ? null : d.date)}>
                                <td className="px-1.5 py-2 text-center text-[#D2D2D7]">
                                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 inline" /> : <ChevronRight className="h-3.5 w-3.5 inline" />}
                                </td>
                                <td className="px-3 py-2 font-mono text-[#1D1D1F]">{d.date}</td>
                                <td className="px-3 py-2 text-right text-[#6E6E73]">{formatNumber(d.impressions)}</td>
                                <td className="px-3 py-2 text-right text-[#1D1D1F]">{formatNumber(d.clicks)}</td>
                                <td className="px-3 py-2 text-right text-[#6E6E73]">{pct(ctr)}</td>
                                <td className="px-3 py-2 text-right text-[#6E6E73]">{d.clicks > 0 ? fmtW(cpc) : '-'}</td>
                                <td className="px-3 py-2 text-right text-[#F43F5E]">{fmtW(d.cost)}</td>
                                <td className="px-3 py-2 text-right text-[#1D1D1F]">{d.orders14d}</td>
                                <td className="px-3 py-2 text-right text-[#0071E3]">{fmtW(d.revenue14d)}</td>
                                <td className="px-3 py-2 text-right text-[#6E6E73]">{pct(cvr)}</td>
                                <td className={`px-3 py-2 text-right font-bold ${roas >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                                  {d.cost > 0 ? `${(roas * 100).toFixed(0)}%` : '-'}
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr>
                                  <td colSpan={11} className="p-0 bg-[#FAFBFC] border-b border-black/[0.08]">
                                    <div className="px-6 py-3">
                                      <div className="text-[11px] font-semibold text-[#6E6E73] mb-2">
                                        {d.date} — 키워드별 성과 ({kws.length}개 · 광고비 순)
                                      </div>
                                      <div className="overflow-auto max-h-96">
                                        <table className="w-full text-[11px]">
                                          <thead className="bg-white sticky top-0">
                                            <tr className="text-[#86868B] border-b border-black/[0.06]">
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
                                              <tr><td colSpan={10} className="text-center py-3 text-[#D2D2D7]">키워드 데이터 없음</td></tr>
                                            )}
                                            {kws.map((kd: any) => {
                                              const kctr = kd.impressions > 0 ? kd.clicks / kd.impressions : 0;
                                              const kcpc = kd.clicks > 0 ? Math.round(kd.cost / kd.clicks) : 0;
                                              const kcvr = kd.clicks > 0 ? kd.orders14d / kd.clicks : 0;
                                              const kroas = kd.cost > 0 ? kd.revenue14d / kd.cost : 0;
                                              return (
                                                <tr key={kd.keyword} className="border-b border-[#F5F6F7] hover:bg-white">
                                                  <td className="px-2 py-1.5 max-w-[260px] truncate font-medium text-[#1D1D1F]" title={kd.keyword}>{kd.keyword}</td>
                                                  <td className="px-2 py-1.5 text-right">{formatNumber(kd.impressions)}</td>
                                                  <td className="px-2 py-1.5 text-right">{formatNumber(kd.clicks)}</td>
                                                  <td className="px-2 py-1.5 text-right text-[#6E6E73]">{pct(kctr)}</td>
                                                  <td className="px-2 py-1.5 text-right text-[#6E6E73]">{kd.clicks > 0 ? fmtW(kcpc) : '-'}</td>
                                                  <td className="px-2 py-1.5 text-right text-[#F43F5E]">{fmtW(kd.cost)}</td>
                                                  <td className="px-2 py-1.5 text-right">{kd.orders14d}</td>
                                                  <td className="px-2 py-1.5 text-right text-[#0071E3]">{fmtW(kd.revenue14d)}</td>
                                                  <td className="px-2 py-1.5 text-right text-[#6E6E73]">{pct(kcvr)}</td>
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
                <td className="px-3 py-2 text-right text-[#6E6E73]">{formatNumber(r.impressions)}</td>
                <td className="px-3 py-2 text-right text-[#1D1D1F]">{formatNumber(r.clicks)}</td>
                <td className="px-3 py-2 text-right text-[#6E6E73]">{pct(ctr)}</td>
                <td className="px-3 py-2 text-right text-[#F43F5E] font-medium">{fmtW(r.cost)}</td>
                <td className="px-3 py-2 text-right text-[#1D1D1F]">{r.orders14d}</td>
                <td className="px-3 py-2 text-right text-[#0071E3] font-medium">{fmtW(r.revenue14d)}</td>
                <td className={`px-3 py-2 text-right font-bold ${roas >= 1 ? 'text-green-600' : 'text-red-500'}`}>{r.cost > 0 ? `${(roas * 100).toFixed(0)}%` : '-'}</td>
              </>);
            };

            // ── 100% 누적 영역 차트 데이터 ──
            const PLACE_COLORS: string[] = ['#0071E3', '#F43F5E', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4', '#EC4899', '#84CC16', '#6366F1', '#F97316'];
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
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#D2D2D7]" />
                  <input value={placeSearch} onChange={(e) => setPlaceSearch(e.target.value)} placeholder="지면 검색"
                    className="w-full h-9 pl-8 pr-3 rounded-lg border border-black/[0.08] text-[12px] focus:outline-none focus:border-[#0071E3]" />
                </div>
                <div className="flex gap-1 bg-[#F5F5F7] rounded-lg p-0.5">
                  {([['total', '합산'], ['daily', '일'], ['weekly', '주'], ['monthly', '월']] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setPlaceGran(k)}
                      className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${placeGran === k ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73]'}`}>{l}</button>
                  ))}
                </div>
                <div className="flex gap-1 bg-[#F5F5F7] rounded-lg p-0.5">
                  {placeMetricOpts.map(({ key, label }) => (
                    <button key={key} onClick={() => setPlaceMetric(key)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${placeMetric === key ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73]'}`}>{label}</button>
                  ))}
                </div>
                <button onClick={() => setPlaceShowRoas(v => !v)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${placeShowRoas ? 'bg-[#1D1D1F] text-white border-[#1D1D1F]' : 'bg-white text-[#6E6E73] border-black/[0.08] hover:border-[#D2D2D7]'}`}>
                  ROAS {placeShowRoas ? 'ON' : 'OFF'}
                </button>
              </div>

              {/* 100% 누적 영역 차트 + ROAS 보조축 */}
              {chartDataPct.length > 1 && (
                <div className="bg-white rounded-[18px] border border-black/[0.06] p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[13px] font-bold text-[#1D1D1F]">지면별 {placeMetricLabel} 비중 추이</h3>
                    {placeShowRoas && <span className="text-[11px] text-[#6E6E73]">--- ROAS (우축)</span>}
                  </div>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartDataPct}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F5F5F7" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="left" tickFormatter={(v: number) => `${Math.round(v)}%`} tick={{ fontSize: 11 }} domain={[0, 100]} />
                        {placeShowRoas && (
                          <YAxis yAxisId="right" orientation="right"
                            tickFormatter={(v: number) => `${Math.round(v)}%`}
                            tick={{ fontSize: 11, fill: '#6E6E73' }}
                            stroke="#D2D2D7" />
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
                            stroke="#1D1D1F" strokeWidth={2} strokeDasharray="6 3"
                            dot={{ r: 3, fill: '#1D1D1F' }} />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* 테이블 */}
              <div className="bg-white rounded-[18px] border border-black/[0.06] overflow-x-auto relative">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-black/[0.06] bg-[#FAFBFC]">
                      <th className="text-left px-3 py-2.5 font-semibold text-[#6E6E73]">지면</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73]">노출</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73]">클릭</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73]">CTR</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73]">광고비</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73]">주문</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73]">매출</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-[#6E6E73]">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plFiltered.map((p: any) => {
                      const isExp = expandedPlaces.has(p.placement);
                      const subRows = placeData.byPeriod.filter((r: any) => r.placement === p.placement).sort((a: any, b: any) => a.period.localeCompare(b.period));
                      return (
                        <Fragment key={p.placement}>
                          <tr className="border-b border-black/[0.06] hover:bg-[#FAFBFC] cursor-pointer"
                            onClick={() => setExpandedPlaces((prev) => { const n = new Set(prev); n.has(p.placement) ? n.delete(p.placement) : n.add(p.placement); return n; })}>
                            <td className="px-3 py-2.5 font-medium text-[#1D1D1F] flex items-center gap-1.5">
                              <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: PLACE_COLORS[plNames.indexOf(p.placement) % PLACE_COLORS.length] }} />
                              {placeGran !== 'total' && (isExp ? <ChevronDown className="h-3 w-3 inline" /> : <ChevronUp className="h-3 w-3 inline rotate-90" />)}
                              {p.placement}
                            </td>
                            {renderMetricRow(p)}
                          </tr>
                          {isExp && subRows.map((sr: any) => (
                            <tr key={`${p.placement}||${sr.period}`} className="border-b border-black/[0.06] bg-[#FAFBFF]">
                              <td className="px-3 py-2 pl-10 text-[11px] text-[#6E6E73]">{sr.periodLabel}</td>
                              {renderMetricRow(sr, true)}
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {/* 플로팅 합계 */}
                <div className="sticky bottom-0 bg-[#F8FAFC] border-t-2 border-black/[0.08]">
                  <table className="w-full text-[12px]"><tbody>
                    <tr className="font-bold">
                      <td className="px-3 py-2.5 text-[#1D1D1F]">합계</td>
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
            const COLORS: string[] = ['#0071E3', '#F43F5E', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4', '#EC4899', '#84CC16', '#6366F1', '#F97316'];
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
              { key: 'clicks', label: '클릭', get: (r: any) => r.clicks, fmt: (v: number) => formatNumber(v), cls: 'text-[#1D1D1F]' },
              { key: 'ctr', label: 'CTR', get: (r: any) => r.impressions > 0 ? r.clicks / r.impressions : 0, fmt: (v: number) => pct(v) },
              { key: 'cpc', label: 'CPC', get: (r: any) => r.clicks > 0 ? r.cost / r.clicks : 0, fmt: (v: number) => fmtW(Math.round(v)) },
              { key: 'cost', label: '광고비', get: (r: any) => r.cost, fmt: (v: number) => fmtW(v), cls: 'text-[#F43F5E] font-medium' },
              { key: 'orders14d', label: '주문', get: (r: any) => r.orders14d, fmt: (v: number) => String(v) },
              { key: 'revenue14d', label: '매출', get: (r: any) => r.revenue14d, fmt: (v: number) => fmtW(v), cls: 'text-[#0071E3] font-medium' },
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
              <div className="bg-white rounded-[18px] border border-black/[0.06] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[13px] font-bold text-[#1D1D1F]">{dimLabel}별 비교</h3>
                  <div className="flex gap-1 bg-[#F5F5F7] rounded-lg p-0.5">
                    {metricOpts.map((m) => (
                      <button key={m.key} onClick={() => setProdMetric(m.key)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${prodMetric === m.key ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73]'}`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                {compareChartData.length > 0 && (
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={compareChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F5F5F7" />
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
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-black/[0.06]">
                  <span className="text-[11px] text-[#D2D2D7] py-1">비교 대상:</span>
                  {allDims.map((dim, i) => (
                    <button key={dim} onClick={() => toggleProduct(dim)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                        sel.has(dim)
                          ? 'text-white border-transparent'
                          : 'border-black/[0.08] bg-white text-[#86868B] hover:border-[#D2D2D7]'
                      }`}
                      style={sel.has(dim) ? { backgroundColor: COLORS[allDims.indexOf(dim) % COLORS.length] } : undefined}>
                      {dim.length > 20 ? dim.slice(0, 20) + '…' : dim}
                    </button>
                  ))}
                </div>
              </div>

              {/* 엑셀 피벗 스타일 테이블 */}
              <div className="bg-white rounded-[18px] border border-black/[0.06] overflow-x-auto relative">
                <div className="flex flex-wrap items-center gap-3 px-4 pt-3 pb-2">
                  <div className="flex gap-1 bg-[#F5F5F7] rounded-lg p-0.5">
                    {([['product', '상품'], ['campaign', '캠페인'], ['keyword', '키워드']] as const).map(([k, l]) => (
                      <button key={k} onClick={() => { setPivotDim(k); setSelectedProducts(new Set()); setExpandedDims(new Set()); }}
                        className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${pivotDim === k ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73]'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1 bg-[#F5F5F7] rounded-lg p-0.5">
                    {([['weekly', '주'], ['monthly', '월'], ['daily', '일']] as const).map(([k, l]) => (
                      <button key={k} onClick={() => setPivotGran(k)}
                        className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${pivotGran === k ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73]'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <div className="relative flex-1 min-w-[140px] max-w-[260px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#D2D2D7]" />
                    <input value={pivotSearch} onChange={(e) => setPivotSearch(e.target.value)} placeholder={`${dimLabel} 검색`}
                      className="w-full h-8 pl-8 pr-3 rounded-lg border border-black/[0.08] text-[12px] focus:outline-none focus:border-[#0071E3]" />
                  </div>
                  <span className="text-[11px] text-[#86868B] ml-auto">{allDims.length}개</span>
                </div>
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-black/[0.06] bg-[#FAFBFC]">
                      <th onClick={() => togglePSort('dim')} className="text-left px-3 py-2.5 font-semibold text-[#6E6E73] cursor-pointer hover:text-[#1D1D1F] whitespace-nowrap select-none">{dimLabel}{si('dim')}</th>
                      {metricCols.map((col) => (
                        <th key={col.key} onClick={() => togglePSort(col.key)} className="text-right px-3 py-2.5 font-semibold text-[#6E6E73] cursor-pointer hover:text-[#1D1D1F] whitespace-nowrap select-none">{col.label}{si(col.key)}</th>
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
                            <tr className={`border-b border-black/[0.06] hover:bg-[#FAFBFC] cursor-pointer ${isSel ? 'bg-[#F8FAFF]' : ''}`}
                              onClick={() => { toggleProduct(dt.dim); setExpandedDims((prev) => { const n = new Set(prev); n.has(dt.dim) ? n.delete(dt.dim) : n.add(dt.dim); return n; }); }}>
                              <td className="px-3 py-2.5 font-semibold text-[#1D1D1F] max-w-[260px] truncate" title={dt.dim}>
                                {isExp ? <ChevronDown className="h-3 w-3 inline mr-1.5 text-[#6E6E73]" /> : <ChevronUp className="h-3 w-3 inline mr-1.5 text-[#D2D2D7] rotate-90" />}
                                {isSel && <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: dimColor }} />}
                                {dt.dim}
                              </td>
                              {metricCols.map((col) => (
                                <td key={col.key} className={`px-3 py-2.5 text-right font-semibold ${col.cls ?? 'text-[#6E6E73]'}`}>
                                  {col.render ? col.render(dt) : col.fmt!(col.get(dt))}
                                </td>
                              ))}
                            </tr>
                            {isExp && subRows.map((sr: any) => (
                              <tr key={`${sr.dim}||${sr.period}`} className="border-b border-black/[0.06] bg-[#FAFBFF]">
                                <td className="px-3 py-2 pl-8 text-[11px] text-[#6E6E73]">{sr.periodLabel}</td>
                                {metricCols.map((col) => (
                                  <td key={col.key} className={`px-3 py-2 text-right text-[11px] ${col.cls ?? 'text-[#86868B]'}`}>
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
                <div className="sticky bottom-0 bg-[#F8FAFC] border-t-2 border-black/[0.08]">
                  <table className="w-full text-[12px]"><tbody>
                    <tr className="font-bold">
                      <td className="px-3 py-2.5 text-[#1D1D1F]">합계</td>
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

          {/* ─── Tab: 증감 (MoM / WoW) ─────────────────────────────── */}
          {tab === 'momwow' && (() => {
            if (!data) return null;
            const GREEN = '#10B981', RED = '#F43F5E';

            const periodOf = (date: string) => momGran === 'daily' ? date : momGran === 'monthly' ? date.slice(0, 7) : isoWeekKey(date);
            const periodLabel = (p: string) => momGran === 'daily' ? p.slice(5) : momGran === 'monthly' ? p : `${p.slice(0, 4)} ${bucketLabel(p, 'weekly')}`;

            // 캠페인/상품(글로벌 필터)만 적용된 전체 기간 합계 — 날짜 필터 무시
            const emptyAgg = () => ({ impressions: 0, clicks: 0, cost: 0, orders14d: 0, revenue14d: 0, cogs14d: 0, commission14d: 0 });
            const byPeriod = new Map<string, any>();
            const periodSet = new Set<string>();
            for (const r of filtered.rows) {
              if (!r.date) continue;
              const p = periodOf(r.date);
              periodSet.add(p);
              if (!byPeriod.has(p)) byPeriod.set(p, emptyAgg());
              const a = byPeriod.get(p)!;
              a.impressions += r.impressions; a.clicks += r.clicks; a.cost += r.cost;
              a.orders14d += r.orders14d; a.revenue14d += r.revenue14d; a.cogs14d += r.cogs14d; a.commission14d += r.commission14d;
            }
            const periods = [...periodSet].sort();
            if (periods.length === 0) {
              return <div className="bg-white rounded-[18px] border border-black/[0.06] p-10 text-center text-[13px] text-[#86868B]">데이터가 없습니다.</div>;
            }

            const curP = (momCurPeriod && periods.includes(momCurPeriod)) ? momCurPeriod : periods[periods.length - 1];
            const curIdx = periods.indexOf(curP);
            const baseP = (momBasePeriod && periods.includes(momBasePeriod)) ? momBasePeriod : (curIdx > 0 ? periods[curIdx - 1] : curP);
            const curAgg = byPeriod.get(curP) ?? emptyAgg();
            const baseAgg = byPeriod.get(baseP) ?? emptyAgg();

            const v = (a: any, key: string) => {
              if (key === 'roas') return a.cost > 0 ? a.revenue14d / a.cost : 0;
              if (key === 'cpc') return a.clicks > 0 ? a.cost / a.clicks : 0;
              if (key === 'cpa') return a.orders14d > 0 ? a.cost / a.orders14d : 0;
              if (key === 'cvr') return a.clicks > 0 ? a.orders14d / a.clicks : 0;
              if (key === 'ctr') return a.impressions > 0 ? a.clicks / a.impressions : 0;
              if (key === 'aov') return a.orders14d > 0 ? a.revenue14d / a.orders14d : 0;
              if (key === 'profit') return a.revenue14d - (a.cogs14d ?? 0) - (a.commission14d ?? 0) - a.cost;
              return a[key] ?? 0;
            };

            type Unit = 'won' | 'cnt' | 'rate' | 'roas';
            const metricRows: { key: string; label: string; unit: Unit }[] = [
              { key: 'cost', label: '광고비', unit: 'won' },
              { key: 'impressions', label: '노출', unit: 'cnt' },
              { key: 'clicks', label: '클릭', unit: 'cnt' },
              { key: 'ctr', label: 'CTR', unit: 'rate' },
              { key: 'cpc', label: 'CPC', unit: 'won' },
              { key: 'orders14d', label: '주문(14일)', unit: 'cnt' },
              { key: 'cpa', label: 'CPA', unit: 'won' },
              { key: 'cvr', label: 'CVR(14일)', unit: 'rate' },
              { key: 'revenue14d', label: '매출(14일)', unit: 'won' },
              { key: 'aov', label: 'AOV', unit: 'won' },
              { key: 'roas', label: 'ROAS(14일)', unit: 'roas' },
              { key: 'profit', label: '순이익(14일)', unit: 'won' },
            ];
            const fmtVal = (unit: Unit, val: number) => {
              if (unit === 'won') return fmtW(Math.round(val));
              if (unit === 'cnt') return formatNumber(Math.round(val));
              if (unit === 'roas') return val > 0 ? `${(val * 100).toFixed(0)}%` : '-';
              return `${(val * 100).toFixed(2)}%`;
            };
            const fmtDelta = (unit: Unit, cur: number, base: number) => {
              const d = cur - base;
              const s = d > 0 ? '+' : '';
              if (unit === 'won') return s + fmtW(Math.round(d));
              if (unit === 'cnt') return s + formatNumber(Math.round(d));
              if (unit === 'roas') return s + (d * 100).toFixed(0) + '%p';
              return s + (d * 100).toFixed(2) + '%p';
            };
            // 색상 통일: 부호 기준 — 증가=초록, 감소=빨강 (지표 종류 무관)
            const rateCell = (cur: number, base: number) => {
              if (base === 0 && cur === 0) return { text: '–', cls: 'text-[#D2D2D7]', rate: null as number | null };
              if (base === 0) return { text: '신규', cls: 'text-[#0071E3] font-semibold', rate: null as number | null };
              const d = (cur - base) / base;
              if (Math.abs(d) < 0.0001) return { text: '0%', cls: 'text-[#86868B]', rate: 0 };
              return { text: `${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}%`, cls: d > 0 ? 'text-green-600 font-bold' : 'text-red-500 font-bold', rate: d };
            };

            // MoM/WoW 막대: 지표별 증감율 (순이익은 음수 기준 왜곡 가능 → 제외), 변화 큰 순 정렬
            const barData = (metricRows
              .filter((m) => m.key !== 'profit')
              .map((m) => ({ label: m.label, rate: rateCell(v(curAgg, m.key), v(baseAgg, m.key)).rate }))
              .filter((d) => d.rate !== null) as { label: string; rate: number }[])
              .sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));

            // 카드 스파크라인용 최근 기간 시리즈
            const recentPeriods = periods.slice(-10);
            const sparkline = (key: string, color: string) => {
              const vals = recentPeriods.map((p) => v(byPeriod.get(p) ?? emptyAgg(), key));
              if (vals.length < 2) return null;
              const w = 120, h = 26, min = Math.min(...vals), max = Math.max(...vals), rng = (max - min) || 1;
              const pts = vals.map((val, i) => `${(i / (vals.length - 1)) * w},${h - 2 - ((val - min) / rng) * (h - 4)}`).join(' ');
              return <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} /></svg>;
            };

            const campaigns = data.campaigns ?? [];
            const products = data.products ?? [];
            const granOpts = [['monthly', '월 (MoM)'], ['weekly', '주 (WoW)'], ['daily', '일']] as const;

            return (
            <div className="space-y-4">
              {/* 컨트롤 — 단위 + 캠페인/상품(글로벌 필터와 동일 state) */}
              <div className="bg-white rounded-[18px] border border-black/[0.06] p-4 flex flex-wrap items-center gap-3">
                <div className="flex gap-1 bg-[#F5F5F7] rounded-lg p-0.5">
                  {granOpts.map(([k, l]) => (
                    <button key={k} onClick={() => { setMomGran(k); setMomCurPeriod(''); setMomBasePeriod(''); }} className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${momGran === k ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73]'}`}>{l}</button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-[12px]">
                  <span className="text-[#86868B] whitespace-nowrap">캠페인</span>
                  <select value={filterCampaign} onChange={(e) => setFilterCampaign(e.target.value)} className="h-8 px-2 rounded-lg border border-black/[0.08] text-[12px] max-w-[220px] focus:outline-none focus:border-[#0071E3]">
                    <option value="all">전체</option>
                    {campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[12px]">
                  <span className="text-[#86868B] whitespace-nowrap">상품</span>
                  <select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)} className="h-8 px-2 rounded-lg border border-black/[0.08] text-[12px] max-w-[220px] focus:outline-none focus:border-[#0071E3]">
                    <option value="all">전체</option>
                    {products.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <span className="text-[11px] text-[#C7C7CC] ml-auto">상단 캠페인/상품 필터와 연동 · 기간 필터 무시(전체)</span>
              </div>

              {/* MoM/WoW 증감 시각화 (카드 / 막대 전환) */}
              <div className="bg-white rounded-[18px] border border-black/[0.06] p-5 space-y-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h3 className="text-[13px] font-bold text-[#1D1D1F]">지표 증감</h3>
                  <div className="flex gap-1 bg-[#F5F5F7] rounded-lg p-0.5">
                    {([['cards', '카드'], ['bars', '막대']] as const).map(([k, l]) => (
                      <button key={k} onClick={() => setMomView(k)} className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${momView === k ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73]'}`}>{l}</button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1.5 text-[12px]">
                    <span className="text-[#86868B]">기준</span>
                    <select value={curP} onChange={(e) => setMomCurPeriod(e.target.value)} className="h-8 px-2 rounded-lg border border-black/[0.08] text-[12px] focus:outline-none focus:border-[#0071E3]">
                      {[...periods].reverse().map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
                    </select>
                  </label>
                  <span className="text-[#D2D2D7] text-[12px]">vs</span>
                  <label className="flex items-center gap-1.5 text-[12px]">
                    <span className="text-[#86868B]">비교</span>
                    <select value={baseP} onChange={(e) => setMomBasePeriod(e.target.value)} className="h-8 px-2 rounded-lg border border-black/[0.08] text-[12px] focus:outline-none focus:border-[#0071E3]">
                      {[...periods].reverse().map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
                    </select>
                  </label>
                  <span className="ml-auto text-[11px] flex items-center gap-2">
                    <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: GREEN }} />증가</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: RED }} />감소</span>
                  </span>
                </div>

                {momView === 'cards' ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
                    {metricRows.map((m) => {
                      const cv = v(curAgg, m.key), bv = v(baseAgg, m.key);
                      const rc = rateCell(cv, bv);
                      const dir = rc.rate == null ? 0 : rc.rate > 0 ? 1 : rc.rate < 0 ? -1 : 0;
                      const col = dir > 0 ? GREEN : dir < 0 ? RED : '#94A3B8';
                      return (
                        <div key={m.key} className="rounded-[14px] border border-black/[0.06] p-3">
                          <div className="text-[11px] text-[#86868B] mb-0.5 truncate">{m.label}</div>
                          <div className="text-[15px] font-bold text-[#1D1D1F]">{fmtVal(m.unit, cv)}</div>
                          <div className={`text-[12px] font-semibold ${rc.cls}`}>{dir > 0 ? '▲ ' : dir < 0 ? '▼ ' : ''}{rc.text}</div>
                          <div className="mt-1.5">{sparkline(m.key, col)}</div>
                          <div className="text-[10px] text-[#C7C7CC] mt-0.5">전 {fmtVal(m.unit, bv)}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : barData.length > 0 ? (
                  <div style={{ height: Math.max(220, barData.length * 34 + 40) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} layout="vertical" margin={{ top: 8, right: 36, left: 8, bottom: 8 }}>
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#F5F5F7" />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(val: number) => `${(val * 100).toFixed(0)}%`} />
                        <YAxis type="category" dataKey="label" width={76} tick={{ fontSize: 11 }} />
                        <ReferenceLine x={0} stroke="#D2D2D7" />
                        <Tooltip formatter={(val: number) => `${(val * 100).toFixed(1)}%`} />
                        <Bar dataKey="rate" radius={[0, 3, 3, 0]}>
                          {barData.map((d, i) => <Cell key={i} fill={d.rate >= 0 ? GREEN : RED} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : <div className="h-[160px] flex items-center justify-center text-[12px] text-[#C7C7CC]">비교할 증감율이 없습니다 (이전 기간 데이터 없음).</div>}

                <div className="text-[11px] text-[#86868B]">기준 <b>{periodLabel(curP)}</b> vs 비교 <b>{periodLabel(baseP)}</b> · 각 지표가 이전 기간 대비 얼마나 변했는지{momView === 'cards' ? ' (스파크라인 = 최근 추이)' : ''}</div>
              </div>

              {/* 상세 비교표 (전 지표) */}
              <div className="bg-white rounded-[18px] border border-black/[0.06] overflow-hidden">
                <div className="px-5 py-3 border-b border-black/[0.06] flex items-center justify-between">
                  <span className="text-[13px] font-bold text-[#1D1D1F]">상세 비교</span>
                  <span className="text-[11px] text-[#86868B]">{filterCampaign === 'all' ? '전체 캠페인' : filterCampaign} · {filterProduct === 'all' ? '전체 상품' : filterProduct}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-black/[0.06] bg-[#FAFBFC]">
                        <th className="text-left px-5 py-2.5 font-semibold text-[#6E6E73] whitespace-nowrap">지표</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-[#86868B] whitespace-nowrap">비교 ({periodLabel(baseP)})</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-[#1D1D1F] whitespace-nowrap">기준 ({periodLabel(curP)})</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-[#6E6E73] whitespace-nowrap">증감</th>
                        <th className="text-right px-5 py-2.5 font-semibold text-[#6E6E73] whitespace-nowrap">증감율</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metricRows.map((m) => {
                        const cv = v(curAgg, m.key), bv = v(baseAgg, m.key);
                        const rc = rateCell(cv, bv);
                        return (
                          <tr key={m.key} className="border-b border-black/[0.04] hover:bg-[#FAFBFC]">
                            <td className="px-5 py-2.5 font-medium text-[#1D1D1F] whitespace-nowrap">{m.label}</td>
                            <td className="px-4 py-2.5 text-right text-[#86868B] whitespace-nowrap">{fmtVal(m.unit, bv)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-[#1D1D1F] whitespace-nowrap">{fmtVal(m.unit, cv)}</td>
                            <td className={`px-4 py-2.5 text-right whitespace-nowrap ${rc.cls}`}>{fmtDelta(m.unit, cv, bv)}</td>
                            <td className={`px-5 py-2.5 text-right whitespace-nowrap ${rc.cls}`}>{rc.text}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
