'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Download, Loader2, Save, Trash2 } from 'lucide-react';
import { parseCompetitorSnapshot } from '@/lib/coupang/parse-competitor-snapshot';

// ────────────────────────────────────────────────────────────────────────────
// Sorting helpers
// ────────────────────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';
type SortState<K extends string> = { key: K; dir: SortDir } | null;

// null/undefined는 항상 끝으로
function cmp(a: unknown, b: unknown, dir: SortDir): number {
  const aNull = a == null;
  const bNull = b == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  let res = 0;
  if (typeof a === 'number' && typeof b === 'number') res = a - b;
  else res = String(a).localeCompare(String(b), 'ko');
  return dir === 'asc' ? res : -res;
}

function nextSort<K extends string>(prev: SortState<K>, key: K): SortState<K> {
  if (!prev || prev.key !== key) return { key, dir: 'asc' };
  if (prev.dir === 'asc') return { key, dir: 'desc' };
  return null; // 다시 클릭 시 정렬 해제 → 원래 순서
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir | null }) {
  if (!active) return <ArrowUpDown className="w-3 h-3 inline ml-1 text-gray-300" />;
  return dir === 'asc' ? (
    <ArrowUp className="w-3 h-3 inline ml-1 text-blue-600" />
  ) : (
    <ArrowDown className="w-3 h-3 inline ml-1 text-blue-600" />
  );
}

function SortableTh<K extends string>({
  sortKey,
  sort,
  onSort,
  children,
  className,
}: {
  sortKey: K;
  sort: SortState<K>;
  onSort: (k: K) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none hover:text-gray-900 ${className || ''}`}
    >
      {children}
      <SortIcon active={active} dir={active ? sort!.dir : null} />
    </th>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

type SnapshotMeta = {
  id: string;
  captured_at: string;
  memo: string | null;
  category_name: string | null;
  category_path: string[] | null;
  total_impression: number | null;
  top100_impression: number | null;
  top100_search_pct: number | null;
  top100_ad_pct: number | null;
  total_click: number | null;
  products_count: number;
  keywords_count: number;
};

type ProductDetail = {
  id: string;
  rank: number;
  name: string;
  released_at: string | null;
  review_score: number | null;
  review_count: number | null;
  exposure: number | null;
  exposure_change_pct: number | null;
  clicks: number | null;
  clicks_change_pct: number | null;
  ctr: number | null;
  ctr_change_pct: number | null;
  winner_price: number | null;
  price_min: number | null;
  price_max: number | null;
  is_my_product: boolean;
  keywords: KeywordDetail[];
};

type KeywordDetail = {
  id: string;
  rank: number | null;
  keyword: string;
  contributing_count: number | null;
  search_volume: number | null;
  search_volume_change_pct: number | null;
  exposure: number | null;
  exposure_change_pct: number | null;
  clicks: number | null;
  clicks_change_pct: number | null;
  avg_price: number | null;
  price_min: number | null;
  price_max: number | null;
};

// ────────────────────────────────────────────────────────────────────────────
// Formatters
// ────────────────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return '-';
  return n.toLocaleString('ko-KR');
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '-';
  return `${n.toFixed(2)}%`;
}

function fmtWon(n: number | null | undefined): string {
  if (n == null) return '-';
  return `₩${n.toLocaleString('ko-KR')}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: '2-digit', month: '2-digit', day: '2-digit',
  });
}

function ctr(click: number | null, imp: number | null): number | null {
  if (!click || !imp) return null;
  return (click / imp) * 100;
}

function top100Share(top: number | null, total: number | null): number | null {
  if (!top || !total) return null;
  return (top / total) * 100;
}

type CategoryColKey =
  | 'category_name'
  | 'captured_at'
  | 'total_impression'
  | 'total_click'
  | 'ctr'
  | 'top100_impression'
  | 'top100_share'
  | 'top100_search_pct'
  | 'top100_ad_pct';

function getCategoryValue(s: SnapshotMeta, key: CategoryColKey): unknown {
  switch (key) {
    case 'category_name': return s.category_name;
    case 'captured_at': return s.captured_at;
    case 'total_impression': return s.total_impression;
    case 'total_click': return s.total_click;
    case 'ctr': return ctr(s.total_click, s.total_impression);
    case 'top100_impression': return s.top100_impression;
    case 'top100_share': return top100Share(s.top100_impression, s.total_impression);
    case 'top100_search_pct': return s.top100_search_pct;
    case 'top100_ad_pct': return s.top100_ad_pct;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Group rows (카테고리 path prefix N개로 묶음)
// ────────────────────────────────────────────────────────────────────────────

type GroupRow = {
  key: string;
  pathPrefix: string[];
  leafs: SnapshotMeta[];
  total_impression: number;
  top100_impression: number;
  total_click: number;
  top100_search_pct: number | null;
  top100_ad_pct: number | null;
};

function buildGroupRows(leafs: SnapshotMeta[], level: number): GroupRow[] {
  const m = new Map<string, GroupRow>();
  for (const s of leafs) {
    const path = (s.category_path || []).slice(0, level);
    if (path.length === 0) continue;
    const key = path.join('|');
    let row = m.get(key);
    if (!row) {
      row = {
        key,
        pathPrefix: path,
        leafs: [],
        total_impression: 0,
        top100_impression: 0,
        total_click: 0,
        top100_search_pct: null,
        top100_ad_pct: null,
      };
      m.set(key, row);
    }
    row.leafs.push(s);
    row.total_impression += s.total_impression || 0;
    row.top100_impression += s.top100_impression || 0;
    row.total_click += s.total_click || 0;
  }
  // Search/Ad 비율: top100_impression 가중평균
  for (const row of m.values()) {
    let sumSearch = 0;
    let sumAd = 0;
    let wSum = 0;
    let hasSearch = false;
    let hasAd = false;
    for (const s of row.leafs) {
      const w = s.top100_impression || 0;
      if (w === 0) continue;
      wSum += w;
      if (s.top100_search_pct != null) { sumSearch += s.top100_search_pct * w; hasSearch = true; }
      if (s.top100_ad_pct != null) { sumAd += s.top100_ad_pct * w; hasAd = true; }
    }
    row.top100_search_pct = hasSearch && wSum > 0 ? sumSearch / wSum : null;
    row.top100_ad_pct = hasAd && wSum > 0 ? sumAd / wSum : null;
  }
  return Array.from(m.values());
}

type GroupColKey =
  | 'path'
  | 'leaf_count'
  | 'total_impression'
  | 'total_click'
  | 'ctr'
  | 'top100_impression'
  | 'top100_share'
  | 'top100_search_pct'
  | 'top100_ad_pct';

function getGroupValue(g: GroupRow, key: GroupColKey): unknown {
  switch (key) {
    case 'path': return g.pathPrefix.join(' > ');
    case 'leaf_count': return g.leafs.length;
    case 'total_impression': return g.total_impression;
    case 'total_click': return g.total_click;
    case 'ctr': return ctr(g.total_click, g.total_impression);
    case 'top100_impression': return g.top100_impression;
    case 'top100_share': return top100Share(g.top100_impression, g.total_impression);
    case 'top100_search_pct': return g.top100_search_pct;
    case 'top100_ad_pct': return g.top100_ad_pct;
  }
}

type ProductColKey =
  | 'rank'
  | 'name'
  | 'exposure'
  | 'clicks'
  | 'ctr'
  | 'winner_price'
  | 'review_score'
  | 'review_count'
  | 'keywords_count';

function getProductValue(p: ProductDetail, key: ProductColKey): unknown {
  switch (key) {
    case 'rank': return p.rank;
    case 'name': return p.name;
    case 'exposure': return p.exposure;
    case 'clicks': return p.clicks;
    case 'ctr': return p.ctr;
    case 'winner_price': return p.winner_price;
    case 'review_score': return p.review_score;
    case 'review_count': return p.review_count;
    case 'keywords_count': return p.keywords.length;
  }
}

type KeywordColKey =
  | 'rank'
  | 'keyword'
  | 'search_volume'
  | 'exposure'
  | 'clicks'
  | 'ctr'
  | 'avg_price'
  | 'contributing_count';

function getKeywordValue(k: KeywordDetail, key: KeywordColKey): unknown {
  switch (key) {
    case 'rank': return k.rank;
    case 'keyword': return k.keyword;
    case 'search_volume': return k.search_volume;
    case 'exposure': return k.exposure;
    case 'clicks': return k.clicks;
    case 'ctr': return ctr(k.clicks, k.exposure);
    case 'avg_price': return k.avg_price;
    case 'contributing_count': return k.contributing_count;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────────

export default function DataAnalysisPage() {
  // 입력
  const [rawText, setRawText] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 목록
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState(true);

  // 드릴다운: 카테고리(=스냅샷) 펼침 / 상품 펼침
  const [openSnapId, setOpenSnapId] = useState<string | null>(null);
  const [productsBySnap, setProductsBySnap] = useState<Record<string, ProductDetail[]>>({});
  const [loadingDetailFor, setLoadingDetailFor] = useState<string | null>(null);
  const [openProductIds, setOpenProductIds] = useState<Set<string>>(new Set());

  // 비교용 선택
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 카테고리 표 정렬
  const [catSort, setCatSort] = useState<SortState<CategoryColKey>>(null);

  // 그룹화 단계 (0=없음, 1~4)
  const [groupLevel, setGroupLevel] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [openGroupKeys, setOpenGroupKeys] = useState<Set<string>>(new Set());
  const [groupSort, setGroupSort] = useState<SortState<GroupColKey>>(null);

  const preview = useMemo(() => {
    if (!rawText.trim()) return null;
    return parseCompetitorSnapshot(rawText);
  }, [rawText]);

  const loadSnapshots = useCallback(async () => {
    const r = await fetch('/api/rank-tracking/competitor');
    if (r.ok) {
      const data = await r.json();
      const list: SnapshotMeta[] = data.snapshots || [];
      setSnapshots(list);
      // 디폴트: 카테고리별 가장 최신 스냅샷 1개씩 선택
      const latest = new Map<string, string>();
      for (const s of list) {
        if (!s.category_name) continue;
        if (!latest.has(s.category_name)) latest.set(s.category_name, s.id);
      }
      setSelected(new Set(latest.values()));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const loadDetail = useCallback(
    async (snapId: string) => {
      if (productsBySnap[snapId]) return; // already loaded
      setLoadingDetailFor(snapId);
      try {
        const r = await fetch(`/api/rank-tracking/competitor/${snapId}`);
        if (!r.ok) return;
        const data = await r.json();
        setProductsBySnap((prev) => ({ ...prev, [snapId]: data.products || [] }));
      } finally {
        setLoadingDetailFor(null);
      }
    },
    [productsBySnap],
  );

  const handleToggleSnap = useCallback(
    async (id: string) => {
      if (openSnapId === id) {
        setOpenSnapId(null);
        return;
      }
      setOpenSnapId(id);
      setOpenProductIds(new Set());
      await loadDetail(id);
    },
    [openSnapId, loadDetail],
  );

  const handleToggleProduct = (productId: string) => {
    setOpenProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const handleWinnerPriceChange = useCallback(
    async (snapId: string, productId: string, next: number | null) => {
      const r = await fetch(`/api/rank-tracking/competitor/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner_price: next }),
      });
      if (!r.ok) return;
      // 캐시 갱신
      setProductsBySnap((prev) => {
        const list = prev[snapId];
        if (!list) return prev;
        return {
          ...prev,
          [snapId]: list.map((p) => (p.id === productId ? { ...p, winner_price: next } : p)),
        };
      });
    },
    [],
  );

  const handleToggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!preview || preview.products.length === 0) {
      setError('파싱된 상품이 없습니다. 텍스트를 확인하세요.');
      return;
    }
    if (!preview.category) {
      setError('카테고리 헤더가 인식되지 않았습니다. 텍스트 상단(카테고리 결과)부터 복사했는지 확인하세요.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const r = await fetch('/api/rank-tracking/competitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText, memo: memo || null }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || '저장 실패');
        return;
      }
      setRawText('');
      setMemo('');
      await loadSnapshots();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('이 스냅샷을 삭제하시겠습니까?')) return;
    const r = await fetch(`/api/rank-tracking/competitor/${id}`, { method: 'DELETE' });
    if (r.ok) {
      if (openSnapId === id) setOpenSnapId(null);
      await loadSnapshots();
      // 캐시 정리
      setProductsBySnap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleDownloadCsv = () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected).join(',');
    window.location.href = `/api/rank-tracking/competitor/compare/csv?ids=${ids}`;
  };

  const withCategoryRaw = useMemo(
    () => snapshots.filter((s) => s.category_name),
    [snapshots],
  );
  const withCategory = useMemo(() => {
    if (!catSort) return withCategoryRaw;
    const k = catSort.key;
    const d = catSort.dir;
    return [...withCategoryRaw].sort((a, b) => cmp(getCategoryValue(a, k), getCategoryValue(b, k), d));
  }, [withCategoryRaw, catSort]);

  // 그룹 모드: 카테고리당 최신 1개씩만 뽑은 leaf
  const leafSnapshots = useMemo(() => {
    const seen = new Set<string>();
    const out: SnapshotMeta[] = [];
    // snapshots는 captured_at desc이므로 첫 등장이 최신
    for (const s of withCategoryRaw) {
      if (!s.category_name || seen.has(s.category_name)) continue;
      seen.add(s.category_name);
      out.push(s);
    }
    return out;
  }, [withCategoryRaw]);

  const groupRowsRaw = useMemo(
    () => (groupLevel === 0 ? [] : buildGroupRows(leafSnapshots, groupLevel)),
    [groupLevel, leafSnapshots],
  );
  const groupRows = useMemo(() => {
    if (!groupSort) return groupRowsRaw;
    const k = groupSort.key;
    const d = groupSort.dir;
    return [...groupRowsRaw].sort((a, b) => cmp(getGroupValue(a, k), getGroupValue(b, k), d));
  }, [groupRowsRaw, groupSort]);

  const handleToggleGroup = (key: string) => {
    setOpenGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // leaf 카테고리 표 (그룹 모드/비그룹 모드 양쪽에서 재사용)
  // nested=true 면 그룹 행 펼친 안에 들어가는 형태(인덴트 표시)
  const renderLeafTable = (rows: SnapshotMeta[], nested: boolean) => (
    <table className="w-full text-xs">
      <thead className="bg-gray-50 text-gray-600">
        <tr>
          <th className="p-2 w-8"></th>
          <th className="p-2 w-8"></th>
          {nested ? (
            <th className="p-2 text-left">카테고리</th>
          ) : (
            <SortableTh sortKey="category_name" sort={catSort} onSort={(k) => setCatSort((p) => nextSort(p, k))} className="p-2 text-left">카테고리</SortableTh>
          )}
          {nested ? (
            <th className="p-2 text-left">캡처일</th>
          ) : (
            <SortableTh sortKey="captured_at" sort={catSort} onSort={(k) => setCatSort((p) => nextSort(p, k))} className="p-2 text-left">캡처일</SortableTh>
          )}
          {nested ? (
            <th className="p-2 text-right">전체 노출</th>
          ) : (
            <SortableTh sortKey="total_impression" sort={catSort} onSort={(k) => setCatSort((p) => nextSort(p, k))} className="p-2 text-right">전체 노출</SortableTh>
          )}
          {nested ? (
            <th className="p-2 text-right">전체 클릭</th>
          ) : (
            <SortableTh sortKey="total_click" sort={catSort} onSort={(k) => setCatSort((p) => nextSort(p, k))} className="p-2 text-right">전체 클릭</SortableTh>
          )}
          {nested ? (
            <th className="p-2 text-right">전체 CTR</th>
          ) : (
            <SortableTh sortKey="ctr" sort={catSort} onSort={(k) => setCatSort((p) => nextSort(p, k))} className="p-2 text-right">전체 CTR</SortableTh>
          )}
          {nested ? (
            <th className="p-2 text-right">Top100 노출</th>
          ) : (
            <SortableTh sortKey="top100_impression" sort={catSort} onSort={(k) => setCatSort((p) => nextSort(p, k))} className="p-2 text-right">Top100 노출</SortableTh>
          )}
          {nested ? (
            <th className="p-2 text-right">Top100 점유율</th>
          ) : (
            <SortableTh sortKey="top100_share" sort={catSort} onSort={(k) => setCatSort((p) => nextSort(p, k))} className="p-2 text-right">Top100 점유율</SortableTh>
          )}
          {nested ? (
            <th className="p-2 text-right">Search</th>
          ) : (
            <SortableTh sortKey="top100_search_pct" sort={catSort} onSort={(k) => setCatSort((p) => nextSort(p, k))} className="p-2 text-right">Search</SortableTh>
          )}
          {nested ? (
            <th className="p-2 text-right">Ad</th>
          ) : (
            <SortableTh sortKey="top100_ad_pct" sort={catSort} onSort={(k) => setCatSort((p) => nextSort(p, k))} className="p-2 text-right">Ad</SortableTh>
          )}
          <th className="p-2 text-right">상품/키워드</th>
          <th className="p-2 text-left">메모</th>
          <th className="p-2 w-10"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => {
          const isOpen = openSnapId === s.id;
          const isSel = selected.has(s.id);
          const products = productsBySnap[s.id];
          return (
            <Fragment key={s.id}>
              <tr
                className={`border-t hover:bg-gray-50 cursor-pointer ${nested ? 'bg-white' : ''}`}
                onClick={() => handleToggleSnap(s.id)}
              >
                <td className="p-2 text-center">
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => {}}
                    onClick={(e) => handleToggleSelect(s.id, e)}
                  />
                </td>
                <td className="p-2 text-center">
                  {isOpen ? (
                    <ChevronDown className="w-3 h-3 inline" />
                  ) : (
                    <ChevronRight className="w-3 h-3 inline" />
                  )}
                </td>
                <td className="p-2 font-medium text-emerald-800">{s.category_name}</td>
                <td className="p-2 text-gray-600">{fmtDate(s.captured_at)}</td>
                <td className="p-2 text-right">{fmt(s.total_impression)}</td>
                <td className="p-2 text-right">{fmt(s.total_click)}</td>
                <td className="p-2 text-right">{fmtPct(ctr(s.total_click, s.total_impression))}</td>
                <td className="p-2 text-right">{fmt(s.top100_impression)}</td>
                <td className="p-2 text-right">{fmtPct(top100Share(s.top100_impression, s.total_impression))}</td>
                <td className="p-2 text-right">{fmtPct(s.top100_search_pct)}</td>
                <td className="p-2 text-right">{fmtPct(s.top100_ad_pct)}</td>
                <td className="p-2 text-right text-gray-500">
                  {s.products_count} / {s.keywords_count}
                </td>
                <td className="p-2 text-gray-500 truncate max-w-[160px]">{s.memo || ''}</td>
                <td className="p-2 text-center">
                  <button
                    onClick={(e) => handleDelete(s.id, e)}
                    className="text-red-500 hover:text-red-700"
                    title="삭제"
                  >
                    <Trash2 className="w-4 h-4 inline" />
                  </button>
                </td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={14} className="p-0 bg-gray-50">
                    <div className="p-3">
                      {loadingDetailFor === s.id || !products ? (
                        <div className="text-sm text-gray-500">상품 불러오는 중...</div>
                      ) : (
                        <ProductsTable
                          products={products}
                          openProductIds={openProductIds}
                          onToggleProduct={handleToggleProduct}
                          onWinnerPriceChange={(pid, v) =>
                            handleWinnerPriceChange(s.id, pid, v)
                          }
                        />
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
  const withoutCategory = useMemo(
    () => snapshots.filter((s) => !s.category_name),
    [snapshots],
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">데이터 분석</h1>
        <p className="text-sm text-gray-500 mt-1">
          쿠팡 셀러 광고진단 페이지 텍스트를 카테고리 단위로 붙여넣어 카테고리/상품/키워드를 한 번에 저장합니다.
          카테고리 → 상품 → 키워드 순으로 펼쳐서 봅니다.
        </p>
      </div>

      {/* 입력 */}
      <div className="border rounded-lg p-4 bg-white space-y-3">
        <h2 className="font-medium">새 데이터 추가</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-3">
            <Label htmlFor="memo">메모 (선택)</Label>
            <Input
              id="memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="예: 5월 1주차 여성백팩 분석"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="raw">텍스트 붙여넣기 (카테고리 결과 + TOP 20 상품 + TOP 10 키워드)</Label>
          <textarea
            id="raw"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            className="w-full min-h-[180px] mt-1 px-3 py-2 text-sm border rounded-md font-mono"
            placeholder={`"여성백팩" 카테고리 결과\n패션의류잡화\n여성패션\n...\nimpression\n1733.99만\n검색어 노출\n6.11%\n...`}
          />
        </div>

        {preview && (
          <div className="space-y-2 text-sm">
            {preview.category ? (
              <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-emerald-900">
                    카테고리: {preview.category.category_name}
                  </span>
                  {preview.category.category_path.length > 0 && (
                    <span className="text-xs text-emerald-700">
                      {preview.category.category_path.join(' > ')}
                    </span>
                  )}
                </div>
                <div className="mt-1 grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-1 text-xs text-emerald-900">
                  <span>전체 노출: <b>{fmt(preview.category.total_impression)}</b></span>
                  <span>전체 클릭: <b>{fmt(preview.category.total_click)}</b></span>
                  <span>Top100 노출: <b>{fmt(preview.category.top100_impression)}</b></span>
                  <span>Search: <b>{fmtPct(preview.category.top100_search_pct)}</b></span>
                  <span>Ad: <b>{fmtPct(preview.category.top100_ad_pct)}</b></span>
                </div>
              </div>
            ) : (
              <div className="text-orange-600">카테고리 헤더 미인식 — 카테고리 결과 줄부터 복사해주세요.</div>
            )}
            <div className="text-gray-600 flex items-center gap-4 flex-wrap">
              <span>
                상품 <b className="text-gray-900">{preview.products.length}</b>개,
                키워드 <b className="text-gray-900">
                  {preview.products.reduce((s, p) => s + p.keywords.length, 0)}
                </b>개
              </span>
              {preview.warnings.length > 0 && (
                <span className="text-orange-600">경고 {preview.warnings.length}건</span>
              )}
            </div>
          </div>
        )}

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setRawText('');
              setMemo('');
              setError(null);
            }}
            disabled={saving || !rawText}
          >
            지우기
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !preview || preview.products.length === 0 || !preview.category}
          >
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            저장
          </Button>
        </div>
      </div>

      {/* 카테고리 표 (드릴다운) */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="font-medium">카테고리 분석 ({withCategory.length})</h2>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              그룹화:
              <select
                value={groupLevel}
                onChange={(e) => setGroupLevel(Number(e.target.value) as 0 | 1 | 2 | 3 | 4)}
                className="border rounded px-2 py-1 text-xs bg-white"
              >
                <option value={0}>없음</option>
                <option value={1}>1단계</option>
                <option value={2}>2단계</option>
                <option value={3}>3단계</option>
                <option value={4}>4단계</option>
              </select>
            </label>
            {groupLevel === 0 && <span className="text-xs text-gray-500">선택 {selected.size}개</span>}
            {groupLevel > 0 && (
              <span className="text-xs text-emerald-700">
                {groupRows.length}개 그룹 · 카테고리별 최신 1건만 합산
              </span>
            )}
          </div>
          <Button onClick={handleDownloadCsv} disabled={selected.size === 0 || groupLevel > 0} size="sm">
            <Download className="w-4 h-4 mr-1" />
            선택 카테고리 CSV
          </Button>
        </div>
        {loading ? (
          <div className="p-6 text-center text-gray-500 text-sm">불러오는 중...</div>
        ) : withCategory.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">저장된 카테고리가 없습니다.</div>
        ) : groupLevel === 0 ? (
          <div className="overflow-x-auto">{renderLeafTable(withCategory, false)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="p-2 w-8"></th>
                  <SortableTh sortKey="path" sort={groupSort} onSort={(k) => setGroupSort((p) => nextSort(p, k))} className="p-2 text-left">카테고리 path ({groupLevel}단계)</SortableTh>
                  <SortableTh sortKey="leaf_count" sort={groupSort} onSort={(k) => setGroupSort((p) => nextSort(p, k))} className="p-2 text-right">하위 카테고리</SortableTh>
                  <SortableTh sortKey="total_impression" sort={groupSort} onSort={(k) => setGroupSort((p) => nextSort(p, k))} className="p-2 text-right">전체 노출 합</SortableTh>
                  <SortableTh sortKey="total_click" sort={groupSort} onSort={(k) => setGroupSort((p) => nextSort(p, k))} className="p-2 text-right">전체 클릭 합</SortableTh>
                  <SortableTh sortKey="ctr" sort={groupSort} onSort={(k) => setGroupSort((p) => nextSort(p, k))} className="p-2 text-right">CTR</SortableTh>
                  <SortableTh sortKey="top100_impression" sort={groupSort} onSort={(k) => setGroupSort((p) => nextSort(p, k))} className="p-2 text-right">Top100 노출 합</SortableTh>
                  <SortableTh sortKey="top100_share" sort={groupSort} onSort={(k) => setGroupSort((p) => nextSort(p, k))} className="p-2 text-right">Top100 점유율</SortableTh>
                  <SortableTh sortKey="top100_search_pct" sort={groupSort} onSort={(k) => setGroupSort((p) => nextSort(p, k))} className="p-2 text-right">Search (가중)</SortableTh>
                  <SortableTh sortKey="top100_ad_pct" sort={groupSort} onSort={(k) => setGroupSort((p) => nextSort(p, k))} className="p-2 text-right">Ad (가중)</SortableTh>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((g) => {
                  const isGroupOpen = openGroupKeys.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      <tr
                        className="border-t bg-emerald-50/30 hover:bg-emerald-50 cursor-pointer"
                        onClick={() => handleToggleGroup(g.key)}
                      >
                        <td className="p-2 text-center">
                          {isGroupOpen ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronRight className="w-3 h-3 inline" />}
                        </td>
                        <td className="p-2 font-semibold text-emerald-900">
                          {g.pathPrefix.join(' > ')}
                        </td>
                        <td className="p-2 text-right">{g.leafs.length}</td>
                        <td className="p-2 text-right font-medium">{fmt(g.total_impression)}</td>
                        <td className="p-2 text-right font-medium">{fmt(g.total_click)}</td>
                        <td className="p-2 text-right">{fmtPct(ctr(g.total_click, g.total_impression))}</td>
                        <td className="p-2 text-right">{fmt(g.top100_impression)}</td>
                        <td className="p-2 text-right">{fmtPct(top100Share(g.top100_impression, g.total_impression))}</td>
                        <td className="p-2 text-right">{fmtPct(g.top100_search_pct)}</td>
                        <td className="p-2 text-right">{fmtPct(g.top100_ad_pct)}</td>
                      </tr>
                      {isGroupOpen && (
                        <tr>
                          <td colSpan={10} className="p-0 bg-gray-50">
                            <div className="p-3">{renderLeafTable(g.leafs, true)}</div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 카테고리 헤더 미인식 스냅샷 (옛 데이터 등) */}
      {withoutCategory.length > 0 && (
        <div className="border rounded-lg bg-white overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="font-medium text-gray-700">카테고리 헤더 없는 스냅샷 ({withoutCategory.length})</h2>
            <p className="text-xs text-gray-500 mt-1">
              카테고리 헤더가 인식되지 않은 옛 데이터입니다. 삭제 후 재저장을 권장합니다.
            </p>
          </div>
          <div className="divide-y">
            {withoutCategory.map((s) => (
              <div key={s.id} className="px-4 py-2 flex items-center justify-between text-sm">
                <span className="text-gray-600">
                  {fmtDate(s.captured_at)} · 상품 {s.products_count} / 키워드 {s.keywords_count}
                  {s.memo ? ` · ${s.memo}` : ''}
                </span>
                <button
                  onClick={(e) => handleDelete(s.id, e)}
                  className="text-red-500 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 상품 표 (드릴다운: 키워드 펼침)
// ────────────────────────────────────────────────────────────────────────────

function ProductsTable({
  products,
  openProductIds,
  onToggleProduct,
  onWinnerPriceChange,
}: {
  products: ProductDetail[];
  openProductIds: Set<string>;
  onToggleProduct: (id: string) => void;
  onWinnerPriceChange: (productId: string, value: number | null) => void;
}) {
  const [sort, setSort] = useState<SortState<ProductColKey>>(null);
  const sorted = useMemo(() => {
    if (!sort) return products;
    const k = sort.key;
    const d = sort.dir;
    return [...products].sort((a, b) => cmp(getProductValue(a, k), getProductValue(b, k), d));
  }, [products, sort]);

  if (products.length === 0) {
    return <div className="text-sm text-gray-500">상품이 없습니다.</div>;
  }
  const onSort = (k: ProductColKey) => setSort((p) => nextSort(p, k));
  return (
    <div className="overflow-x-auto bg-white border rounded">
      <table className="w-full text-xs">
        <thead className="bg-gray-100 text-gray-600">
          <tr>
            <th className="p-2 w-8"></th>
            <SortableTh sortKey="rank" sort={sort} onSort={onSort} className="p-2 w-12 text-left">순위</SortableTh>
            <SortableTh sortKey="name" sort={sort} onSort={onSort} className="p-2 text-left">상품명</SortableTh>
            <SortableTh sortKey="exposure" sort={sort} onSort={onSort} className="p-2 text-right">검색어 노출</SortableTh>
            <SortableTh sortKey="clicks" sort={sort} onSort={onSort} className="p-2 text-right">클릭</SortableTh>
            <SortableTh sortKey="ctr" sort={sort} onSort={onSort} className="p-2 text-right">CTR</SortableTh>
            <SortableTh sortKey="winner_price" sort={sort} onSort={onSort} className="p-2 text-right">위너가</SortableTh>
            <SortableTh sortKey="review_score" sort={sort} onSort={onSort} className="p-2 text-right">평점</SortableTh>
            <SortableTh sortKey="review_count" sort={sort} onSort={onSort} className="p-2 text-right">리뷰 수</SortableTh>
            <SortableTh sortKey="keywords_count" sort={sort} onSort={onSort} className="p-2 text-right">키워드</SortableTh>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const isOpen = openProductIds.has(p.id);
            return (
              <Fragment key={p.id}>
                <tr
                  className={`border-t hover:bg-gray-50 ${p.is_my_product ? 'bg-blue-50' : ''}`}
                >
                  <td
                    className="p-2 text-center cursor-pointer"
                    onClick={() => onToggleProduct(p.id)}
                  >
                    {p.keywords.length > 0 ? (
                      isOpen ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronRight className="w-3 h-3 inline" />
                    ) : null}
                  </td>
                  <td
                    className="p-2 font-medium cursor-pointer"
                    onClick={() => onToggleProduct(p.id)}
                  >
                    {p.rank}
                    {p.is_my_product && <span className="ml-1 text-blue-600 font-semibold">내</span>}
                  </td>
                  <td
                    className="p-2 max-w-[400px] truncate cursor-pointer"
                    title={p.name}
                    onClick={() => onToggleProduct(p.id)}
                  >
                    {p.name}
                  </td>
                  <td
                    className="p-2 text-right cursor-pointer"
                    onClick={() => onToggleProduct(p.id)}
                  >
                    {fmt(p.exposure)}
                  </td>
                  <td
                    className="p-2 text-right cursor-pointer"
                    onClick={() => onToggleProduct(p.id)}
                  >
                    {fmt(p.clicks)}
                  </td>
                  <td
                    className="p-2 text-right cursor-pointer"
                    onClick={() => onToggleProduct(p.id)}
                  >
                    {fmtPct(p.ctr)}
                  </td>
                  <td className="p-2 text-right">
                    <WinnerPriceCell
                      value={p.winner_price}
                      onSave={(v) => onWinnerPriceChange(p.id, v)}
                    />
                  </td>
                  <td
                    className="p-2 text-right cursor-pointer"
                    onClick={() => onToggleProduct(p.id)}
                  >
                    {p.review_score ?? '-'}
                  </td>
                  <td
                    className="p-2 text-right cursor-pointer"
                    onClick={() => onToggleProduct(p.id)}
                  >
                    {fmt(p.review_count)}
                  </td>
                  <td
                    className="p-2 text-right cursor-pointer"
                    onClick={() => onToggleProduct(p.id)}
                  >
                    {p.keywords.length}
                  </td>
                </tr>
                {isOpen && p.keywords.length > 0 && (
                  <tr>
                    <td colSpan={10} className="p-0">
                      <div className="bg-blue-50/40 px-4 py-2 border-l-4 border-blue-300">
                        <KeywordsTable keywords={p.keywords} />
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
}

// 위너가 셀 — 클릭하면 input으로 전환, blur/Enter 시 저장
function WinnerPriceCell({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (next: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value == null ? '' : String(value));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value == null ? '' : String(value));
  }, [value]);

  const commit = async () => {
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : Number(trimmed.replace(/[,\s₩]/g, ''));
    if (next !== null && !Number.isFinite(next)) {
      setDraft(value == null ? '' : String(value));
      setEditing(false);
      return;
    }
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(value == null ? '' : String(value));
            setEditing(false);
          }
        }}
        disabled={saving}
        className="w-24 px-1 py-0.5 text-xs text-right border border-blue-400 rounded outline-none"
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      className="hover:bg-yellow-50 hover:underline px-1 rounded"
      title="클릭하여 수정"
    >
      {fmtWon(value)}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 키워드 표
// ────────────────────────────────────────────────────────────────────────────

function KeywordsTable({ keywords }: { keywords: KeywordDetail[] }) {
  const [sort, setSort] = useState<SortState<KeywordColKey>>(null);
  const sorted = useMemo(() => {
    if (!sort) return keywords;
    const k = sort.key;
    const d = sort.dir;
    return [...keywords].sort((a, b) => cmp(getKeywordValue(a, k), getKeywordValue(b, k), d));
  }, [keywords, sort]);
  const onSort = (k: KeywordColKey) => setSort((p) => nextSort(p, k));

  return (
    <div className="overflow-x-auto bg-white border rounded">
      <table className="w-full text-xs">
        <thead className="bg-gray-100 text-gray-600">
          <tr>
            <SortableTh sortKey="rank" sort={sort} onSort={onSort} className="p-2 w-12 text-left">순위</SortableTh>
            <SortableTh sortKey="keyword" sort={sort} onSort={onSort} className="p-2 text-left">키워드</SortableTh>
            <SortableTh sortKey="search_volume" sort={sort} onSort={onSort} className="p-2 text-right">검색량</SortableTh>
            <SortableTh sortKey="exposure" sort={sort} onSort={onSort} className="p-2 text-right">노출</SortableTh>
            <SortableTh sortKey="clicks" sort={sort} onSort={onSort} className="p-2 text-right">클릭</SortableTh>
            <SortableTh sortKey="ctr" sort={sort} onSort={onSort} className="p-2 text-right">CTR</SortableTh>
            <SortableTh sortKey="avg_price" sort={sort} onSort={onSort} className="p-2 text-right">평균가</SortableTh>
            <SortableTh sortKey="contributing_count" sort={sort} onSort={onSort} className="p-2 text-right">기여 #</SortableTh>
          </tr>
        </thead>
        <tbody>
          {sorted.map((k, idx) => (
            <tr key={k.id} className="border-t">
              <td className="p-2 font-medium">{k.rank ?? idx + 1}</td>
              <td className="p-2">{k.keyword}</td>
              <td className="p-2 text-right">{fmt(k.search_volume)}</td>
              <td className="p-2 text-right">{fmt(k.exposure)}</td>
              <td className="p-2 text-right">{fmt(k.clicks)}</td>
              <td className="p-2 text-right">{fmtPct(ctr(k.clicks, k.exposure))}</td>
              <td className="p-2 text-right">{fmtWon(k.avg_price)}</td>
              <td className="p-2 text-right">{k.contributing_count ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
