'use client';

import type { ReactNode } from 'react';
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
  avg_winner_price: number | null;
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

// ────────────────────────────────────────────────────────────────────────────
// Tree (카테고리 path 5단계 트리)
// ────────────────────────────────────────────────────────────────────────────

type TreeNode = {
  key: string;              // path joined ('패션의류잡화|여성패션')
  segment: string;          // 마지막 path 한 칸
  fullPath: string[];
  depth: number;            // 1~5
  isLeaf: boolean;          // depth === path.length (저장된 카테고리 자체)
  leafSnapshot: SnapshotMeta | null; // isLeaf 인 경우 그 snap
  children: TreeNode[];
  // 합산 (자기 노드 산하 모든 leaf snapshot 기준)
  total_impression: number;
  top100_impression: number;
  total_click: number;
  top100_search_pct: number | null; // top100_impression 가중평균
  top100_ad_pct: number | null;     // top100_impression 가중평균
  avg_winner_price: number | null;  // 산하 leaf의 avg_winner_price 단순평균
  leaf_count: number;
};

function buildTree(leafs: SnapshotMeta[]): TreeNode[] {
  const all = new Map<string, TreeNode>();

  // 1) 모든 노드 생성
  for (const snap of leafs) {
    const path = snap.category_path || [];
    for (let i = 0; i < path.length; i++) {
      const cur = path.slice(0, i + 1);
      const key = cur.join('|');
      if (!all.has(key)) {
        all.set(key, {
          key,
          segment: path[i],
          fullPath: cur,
          depth: i + 1,
          isLeaf: false,
          leafSnapshot: null,
          children: [],
          total_impression: 0,
          top100_impression: 0,
          total_click: 0,
          top100_search_pct: null,
          top100_ad_pct: null,
          avg_winner_price: null,
          leaf_count: 0,
        });
      }
    }
  }

  // 2) leaf 표시 + parent-child 연결
  for (const snap of leafs) {
    const path = snap.category_path || [];
    if (path.length === 0) continue;
    const leafKey = path.join('|');
    const leafNode = all.get(leafKey);
    if (leafNode) {
      leafNode.isLeaf = true;
      leafNode.leafSnapshot = snap;
    }
    for (let i = 1; i < path.length; i++) {
      const parent = all.get(path.slice(0, i).join('|'));
      const child = all.get(path.slice(0, i + 1).join('|'));
      if (parent && child && !parent.children.includes(child)) parent.children.push(child);
    }
  }

  // 3) 합산: 각 snap이 그 path의 모든 ancestor에 가산
  for (const snap of leafs) {
    const path = snap.category_path || [];
    for (let i = 0; i < path.length; i++) {
      const node = all.get(path.slice(0, i + 1).join('|'));
      if (!node) continue;
      node.total_impression += snap.total_impression || 0;
      node.top100_impression += snap.top100_impression || 0;
      node.total_click += snap.total_click || 0;
      node.leaf_count += 1;
    }
  }

  // 4) 가중평균 (Search/Ad는 top100_imp 가중) + 평균판매가 단순평균
  for (const node of all.values()) {
    let sumSearchW = 0, sumAdW = 0, wSum = 0;
    let hasSearch = false, hasAd = false;
    let sumPrice = 0, countPrice = 0;
    for (const snap of leafs) {
      const sp = snap.category_path || [];
      if (sp.length < node.depth) continue;
      let under = true;
      for (let i = 0; i < node.depth; i++) {
        if (sp[i] !== node.fullPath[i]) { under = false; break; }
      }
      if (!under) continue;
      const w = snap.top100_impression || 0;
      if (w > 0) {
        wSum += w;
        if (snap.top100_search_pct != null) { sumSearchW += snap.top100_search_pct * w; hasSearch = true; }
        if (snap.top100_ad_pct != null) { sumAdW += snap.top100_ad_pct * w; hasAd = true; }
      }
      if (snap.avg_winner_price != null) { sumPrice += snap.avg_winner_price; countPrice += 1; }
    }
    node.top100_search_pct = hasSearch && wSum > 0 ? sumSearchW / wSum : null;
    node.top100_ad_pct = hasAd && wSum > 0 ? sumAdW / wSum : null;
    node.avg_winner_price = countPrice > 0 ? Math.round(sumPrice / countPrice) : null;
  }

  // 5) children 정렬 (한글 가나다)
  for (const node of all.values()) {
    node.children.sort((a, b) => a.segment.localeCompare(b.segment, 'ko'));
  }

  return Array.from(all.values())
    .filter((n) => n.depth === 1)
    .sort((a, b) => a.segment.localeCompare(b.segment, 'ko'));
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

  // 트리뷰 펼침 상태 (각 노드 key)
  const [openTreeKeys, setOpenTreeKeys] = useState<Set<string>>(new Set());

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

  // 트리: 카테고리당 최신 1개씩만 뽑은 leaf
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

  const tree = useMemo(() => buildTree(leafSnapshots), [leafSnapshots]);

  const handleToggleTreeNode = (key: string) => {
    setOpenTreeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAllTree = () => {
    const keys = new Set<string>();
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.children.length > 0) {
          keys.add(n.key);
          walk(n.children);
        }
      }
    };
    walk(tree);
    setOpenTreeKeys(keys);
  };
  const collapseAllTree = () => setOpenTreeKeys(new Set());

  // 트리 노드 렌더링 (재귀)
  const renderTreeNode = (node: TreeNode): ReactNode => {
    const isOpen = openTreeKeys.has(node.key);
    const hasChildren = node.children.length > 0;
    const snap = node.leafSnapshot;
    const isSnapOpen = snap ? openSnapId === snap.id : false;
    const isSel = snap ? selected.has(snap.id) : false;
    const products = snap ? productsBySnap[snap.id] : null;
    // 클릭 동작: 자식 있으면 트리 펼침, 없으면(leaf) 상품 표 펼침
    const onRowClick = () => {
      if (hasChildren) handleToggleTreeNode(node.key);
      else if (snap) handleToggleSnap(snap.id);
    };

    const showChevron = hasChildren || (node.isLeaf && snap);
    const chevronOpen = hasChildren ? isOpen : isSnapOpen;

    return (
      <Fragment key={node.key}>
        <tr
          className={`border-t hover:bg-gray-50 cursor-pointer ${
            node.depth === 1 ? 'bg-emerald-50/30' : node.depth === 2 ? 'bg-blue-50/20' : ''
          }`}
          onClick={onRowClick}
        >
          <td className="p-2 text-center">
            {node.isLeaf && snap ? (
              <input
                type="checkbox"
                checked={isSel}
                onChange={() => {}}
                onClick={(e) => handleToggleSelect(snap.id, e)}
              />
            ) : null}
          </td>
          <td className="p-2 text-center">
            {showChevron ? (
              chevronOpen ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronRight className="w-3 h-3 inline" />
            ) : null}
          </td>
          <td
            className={`p-2 ${node.depth === 1 ? 'font-semibold text-emerald-900' : node.isLeaf ? 'text-emerald-800' : 'text-gray-700'}`}
            style={{ paddingLeft: `${0.5 + (node.depth - 1) * 1.25}rem` }}
          >
            {node.segment}
          </td>
          <td className="p-2 text-right text-gray-500">
            {node.isLeaf && snap ? fmtDate(snap.captured_at) : `${node.leaf_count}개`}
          </td>
          <td className="p-2 text-right font-medium">{fmt(node.total_impression)}</td>
          <td className="p-2 text-right">{fmt(node.total_click)}</td>
          <td className="p-2 text-right">{fmtPct(ctr(node.total_click, node.total_impression))}</td>
          <td className="p-2 text-right">{fmt(node.top100_impression)}</td>
          <td className="p-2 text-right">{fmtPct(top100Share(node.top100_impression, node.total_impression))}</td>
          <td className="p-2 text-right">{fmtPct(node.top100_search_pct)}</td>
          <td className="p-2 text-right">{fmtPct(node.top100_ad_pct)}</td>
          <td className="p-2 text-right">{fmtWon(node.avg_winner_price)}</td>
          <td className="p-2 text-gray-500 truncate max-w-[140px]">
            {node.isLeaf && snap ? snap.memo || '' : ''}
          </td>
          <td className="p-2 text-center">
            {node.isLeaf && snap ? (
              <button
                onClick={(e) => handleDelete(snap.id, e)}
                className="text-red-500 hover:text-red-700"
                title="삭제"
              >
                <Trash2 className="w-4 h-4 inline" />
              </button>
            ) : null}
          </td>
        </tr>

        {/* 트리 자식 펼침 */}
        {hasChildren && isOpen && node.children.map((c) => renderTreeNode(c))}

        {/* leaf 카테고리의 상품 표 펼침 */}
        {node.isLeaf && snap && isSnapOpen && (
          <tr>
            <td colSpan={14} className="p-0 bg-gray-50">
              <div className="p-3">
                {loadingDetailFor === snap.id || !products ? (
                  <div className="text-sm text-gray-500">상품 불러오는 중...</div>
                ) : (
                  <ProductsTable
                    products={products}
                    openProductIds={openProductIds}
                    onToggleProduct={handleToggleProduct}
                    onWinnerPriceChange={(pid, v) => handleWinnerPriceChange(snap.id, pid, v)}
                  />
                )}
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };
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

      {/* 카테고리 트리 분석 */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="font-medium">카테고리 분석 ({leafSnapshots.length}개 카테고리)</h2>
            <span className="text-xs text-gray-500">선택 {selected.size}개</span>
            <span className="text-xs text-gray-400">트리 합산은 카테고리당 최신 1건 기준</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={expandAllTree}>전체 펼침</Button>
            <Button variant="outline" size="sm" onClick={collapseAllTree}>전체 접기</Button>
            <Button onClick={handleDownloadCsv} disabled={selected.size === 0} size="sm">
              <Download className="w-4 h-4 mr-1" />
              선택 카테고리 CSV
            </Button>
          </div>
        </div>
        {loading ? (
          <div className="p-6 text-center text-gray-500 text-sm">불러오는 중...</div>
        ) : tree.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">저장된 카테고리가 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="p-2 w-8"></th>
                  <th className="p-2 w-8"></th>
                  <th className="p-2 text-left">카테고리</th>
                  <th className="p-2 text-right">캡처일/하위</th>
                  <th className="p-2 text-right">전체 노출</th>
                  <th className="p-2 text-right">전체 클릭</th>
                  <th className="p-2 text-right">CTR</th>
                  <th className="p-2 text-right">Top100 노출</th>
                  <th className="p-2 text-right">Top100 점유율</th>
                  <th className="p-2 text-right">Search</th>
                  <th className="p-2 text-right">Ad</th>
                  <th className="p-2 text-right">평균 판매가</th>
                  <th className="p-2 text-left">메모</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {tree.map((node) => renderTreeNode(node))}
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
