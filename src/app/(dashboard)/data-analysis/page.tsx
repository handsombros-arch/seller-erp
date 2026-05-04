'use client';

import type { ReactNode } from 'react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Download, GripVertical, Info, Loader2, Save, Search, Trash2 } from 'lucide-react';
import {
  parseCompetitorSnapshot,
  splitMultipleSnapshots,
} from '@/lib/coupang/parse-competitor-snapshot';

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

// 카테고리 dedup 키. 같은 leaf 이름이라도 path 가 한 단계라도 다르면 다른 카테고리.
// 예: 해외직구>가방>여성백팩 vs 여성잡화>여성백팩 — leaf 이름은 같아도 별개여야 함.
const categoryKey = (s: SnapshotMeta): string => {
  if (s.category_path && s.category_path.length > 0) return s.category_path.join('|');
  return s.category_name ?? '';
};

// depth 별 좌측 borderLeft 색상 — Apple Blue 톤 그라디언트.
// depth 1 (최상위) 진한 파랑 → 깊을수록 옅어짐. cap 6.
const DEPTH_COLORS = [
  '#0071E3', // depth 1 — 패션의류잡화 등
  '#3D8FE8',
  '#7FB6EE',
  '#B8D6F4',
  '#DCE9F8',
  '#EFF4FB', // depth 6+
];

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

// 일반 퍼센트 (점유율, Search%, Ad%, 변화율 등) — 정수
function fmtPct(n: number | null | undefined): string {
  if (n == null) return '-';
  return `${Math.round(n)}%`;
}

// CTR 만 소수 2자리 유지 (사용자가 정밀도 요구하는 단일 지표)
function fmtCTR(n: number | null | undefined): string {
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

  // 관리 모드 — 끄면 삭제 버튼 자체가 안 보임. 켜도 삭제는 카테고리명 타이핑 확인 필요.
  const [adminMode, setAdminMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; path: string[] } | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');

  // 드릴다운: 카테고리(=스냅샷) 펼침 / 상품 펼침
  const [openSnapId, setOpenSnapId] = useState<string | null>(null);
  const [productsBySnap, setProductsBySnap] = useState<Record<string, ProductDetail[]>>({});
  const [loadingDetailFor, setLoadingDetailFor] = useState<string | null>(null);
  const [openProductIds, setOpenProductIds] = useState<Set<string>>(new Set());

  // 비교용 선택
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 트리뷰 펼침 상태 (각 노드 key)
  const [openTreeKeys, setOpenTreeKeys] = useState<Set<string>>(new Set());

  // 여러 카테고리 한 번에 paste 모드
  const [batchMode, setBatchMode] = useState(false);
  const [batchSaving, setBatchSaving] = useState<{ done: number; total: number } | null>(null);

  const preview = useMemo(() => {
    if (!rawText.trim()) return null;
    return parseCompetitorSnapshot(rawText);
  }, [rawText]);

  // batch 모드: splitter 결과 수
  const batchPreview = useMemo(() => {
    if (!batchMode || !rawText.trim()) return null;
    const chunks = splitMultipleSnapshots(rawText);
    return { count: chunks.length };
  }, [batchMode, rawText]);

  const loadSnapshots = useCallback(async () => {
    const r = await fetch('/api/rank-tracking/competitor');
    if (r.ok) {
      const data = await r.json();
      const list: SnapshotMeta[] = data.snapshots || [];
      setSnapshots(list);
      // 디폴트: 카테고리별 가장 최신 스냅샷 1개씩 선택 (full path 기준 — 같은 leaf 이름이라도
      // 한 단계라도 path 가 다르면 별개로 취급)
      const latest = new Map<string, string>();
      for (const s of list) {
        if (!s.category_name) continue;
        const k = categoryKey(s);
        if (!k) continue;
        if (!latest.has(k)) latest.set(k, s.id);
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
    // ── batch 모드: 여러 카테고리 한 번에 ───────────────────────
    if (batchMode) {
      if (!batchPreview || batchPreview.count === 0) {
        setError('카테고리 헤더가 하나도 인식되지 않았습니다.');
        return;
      }
      setError(null);
      setSaving(true);
      setBatchSaving({ done: 0, total: batchPreview.count });
      try {
        const r = await fetch('/api/rank-tracking/competitor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw_text: rawText, memo: memo || null, batch: true }),
        });
        const data = await r.json();
        if (!r.ok) {
          setError(data.error || '저장 실패');
          return;
        }
        const savedN = (data.saved ?? []).length;
        const failedN = (data.failed ?? []).length;
        if (failedN > 0) {
          const firstErr = (data.failed ?? [])[0]?.error || '';
          setError(`${savedN}개 저장됨, ${failedN}개 실패. ${firstErr}`);
        } else {
          setError(null);
        }
        if (savedN > 0) {
          setRawText('');
          setMemo('');
        }
        await loadSnapshots();
      } finally {
        setSaving(false);
        setBatchSaving(null);
      }
      return;
    }

    // ── 단일 paste 모드: 기존 그대로 ────────────────────────────
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

  // 삭제 트리거 — 다이얼로그 띄움 (실제 DELETE 는 다이얼로그 confirm 핸들러에서)
  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const snap = snapshots.find((s) => s.id === id);
    if (!snap) return;
    setDeleteTarget({
      id,
      name: snap.category_name ?? '(이름 없음)',
      path: snap.category_path ?? [],
    });
    setDeleteConfirmInput('');
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteConfirmInput !== deleteTarget.name) return; // 안전장치
    const r = await fetch(`/api/rank-tracking/competitor/${deleteTarget.id}`, { method: 'DELETE' });
    if (r.ok) {
      if (openSnapId === deleteTarget.id) setOpenSnapId(null);
      await loadSnapshots();
      setProductsBySnap((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
    }
    setDeleteTarget(null);
    setDeleteConfirmInput('');
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
  // dedup 키는 full path. 같은 leaf 이름이라도 path 가 한 단계라도 다르면 다른 카테고리로 별도 보존.
  const leafSnapshots = useMemo(() => {
    const seen = new Set<string>();
    const out: SnapshotMeta[] = [];
    // snapshots는 captured_at desc이므로 첫 등장이 최신
    for (const s of withCategoryRaw) {
      const k = categoryKey(s);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }, [withCategoryRaw]);

  const tree = useMemo(() => buildTree(leafSnapshots), [leafSnapshots]);

  // ── 카테고리 실시간 검색 ────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  // debounce 150ms — 빠른 타자에서 트리 재계산 부하 완화
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 150);
    return () => clearTimeout(t);
  }, [searchInput]);
  // 검색 시작 전 사용자가 손으로 펼친 상태 보존 → 검색어 비우면 복원
  const expandSnapshotRef = useRef<Set<string> | null>(null);
  const lastAutoExpandRef = useRef<Set<string>>(new Set());

  // 트리 필터: post-order. 자기 segment 또는 fullPath 가 term 포함하면 keep,
  // 자식 중 매칭이 있으면 ancestor 도 keep. 매칭 없으면 prune.
  const { filteredTree, autoExpandKeys, matchCount } = useMemo(() => {
    const term = searchTerm.toLowerCase();
    if (!term) return { filteredTree: tree, autoExpandKeys: new Set<string>(), matchCount: 0 };
    const auto = new Set<string>();
    let matches = 0;
    const visit = (node: TreeNode): TreeNode | null => {
      const segMatch = node.segment.toLowerCase().includes(term);
      const pathMatch = node.fullPath.join(' > ').toLowerCase().includes(term);
      const childResults: TreeNode[] = [];
      for (const c of node.children) {
        const r = visit(c);
        if (r) childResults.push(r);
      }
      const keep = segMatch || pathMatch || childResults.length > 0;
      if (!keep) return null;
      if (segMatch || pathMatch) matches += 1;
      // 매칭된 자식이 있으면 이 노드 자동 펼침
      if (childResults.length > 0) auto.add(node.key);
      return { ...node, children: childResults };
    };
    const out: TreeNode[] = [];
    for (const n of tree) {
      const r = visit(n);
      if (r) out.push(r);
    }
    return { filteredTree: out, autoExpandKeys: auto, matchCount: matches };
  }, [tree, searchTerm]);

  // 검색어 변하면 자동 펼침 적용. 검색어 비우면 직전 사용자 펼침 상태로 복원.
  useEffect(() => {
    if (searchTerm) {
      // 검색 시작 시점 1회만 사용자 상태 백업
      if (expandSnapshotRef.current === null) {
        expandSnapshotRef.current = new Set(openTreeKeys);
      }
      // 직전 자동 펼침 키들 빼고 새 자동 펼침 키들 추가
      setOpenTreeKeys((prev) => {
        const next = new Set(prev);
        for (const k of lastAutoExpandRef.current) next.delete(k);
        for (const k of autoExpandKeys) next.add(k);
        return next;
      });
      lastAutoExpandRef.current = autoExpandKeys;
    } else {
      // 검색어 비움 — 백업된 사용자 상태 복원
      if (expandSnapshotRef.current !== null) {
        setOpenTreeKeys(expandSnapshotRef.current);
        expandSnapshotRef.current = null;
        lastAutoExpandRef.current = new Set();
      }
    }
  }, [searchTerm, autoExpandKeys]); // eslint-disable-line react-hooks/exhaustive-deps

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
          className={`border-t border-black/5 hover:bg-[#F5F5F7] cursor-pointer transition-colors ${
            node.depth === 1 ? 'bg-[#FBFBFD]' : ''
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
            className={`p-2 ${node.depth === 1 ? 'font-semibold text-[#1D1D1F]' : node.isLeaf ? 'text-[#1D1D1F]' : 'text-[#6E6E73]'}`}
            style={{
              paddingLeft: `${0.5 + (node.depth - 1) * 1}rem`,
              borderLeft: `2px solid ${DEPTH_COLORS[Math.min(node.depth - 1, DEPTH_COLORS.length - 1)]}`,
            }}
          >
            {node.isLeaf && node.fullPath.length > 1 ? (
              <span className="inline-flex items-center gap-1">
                <span className="text-[#86868B] text-[11px]">
                  {node.fullPath.slice(0, -1).join(' › ')} ›
                </span>
                <span className="font-medium">{node.segment}</span>
              </span>
            ) : (
              <span className={node.depth === 1 ? 'font-semibold' : node.isLeaf ? 'font-medium' : ''}>
                {node.segment}
              </span>
            )}
          </td>
          <td className="p-2 text-right text-gray-500">
            {node.isLeaf && snap ? fmtDate(snap.captured_at) : `${node.leaf_count}개`}
          </td>
          <td className="p-2 text-right font-medium">{fmt(node.total_impression)}</td>
          <td className="p-2 text-right">{fmt(node.total_click)}</td>
          <td className="p-2 text-right">{fmtCTR(ctr(node.total_click, node.total_impression))}</td>
          <td className="p-2 text-right">{fmt(node.top100_impression)}</td>
          <td className="p-2 text-right">{fmtPct(top100Share(node.top100_impression, node.total_impression))}</td>
          <td className="p-2 text-right">{fmtPct(node.top100_search_pct)}</td>
          <td className="p-2 text-right">{fmtPct(node.top100_ad_pct)}</td>
          <td
            className="p-2 text-right"
            title={
              node.avg_winner_price == null
                ? '아이템위너 가격이 파싱되지 않은 카테고리 — 페이스트 텍스트에 가격 범위만 있었거나 광고제외 상품들이라 winner_price 가 비어있습니다.'
                : undefined
            }
          >
            {fmtWon(node.avg_winner_price)}
          </td>
          <td className="p-2 text-gray-500 truncate max-w-[140px]">
            {node.isLeaf && snap ? snap.memo || '' : ''}
          </td>
          <td className="p-2 text-center">
            {adminMode && node.isLeaf && snap ? (
              <button
                onClick={(e) => handleDelete(snap.id, e)}
                className="text-red-500 hover:text-red-700"
                title="삭제 (관리 모드)"
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
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-medium">새 데이터 추가</h2>
          <label
            className={`inline-flex items-center gap-2 text-xs px-2.5 h-8 rounded-md border cursor-pointer select-none transition-colors ${
              batchMode
                ? 'bg-[#0071E3] border-[#0071E3] text-white'
                : 'bg-white border-[#E5E5E7] text-[#6E6E73] hover:bg-[#F5F5F7]'
            }`}
            title="여러 카테고리 결과를 이어붙여서 한 번에 저장 (자동 분리)"
          >
            <input
              type="checkbox"
              checked={batchMode}
              onChange={(e) => setBatchMode(e.target.checked)}
              className="sr-only"
            />
            여러 카테고리 한 번에
          </label>
        </div>
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
          <Label htmlFor="raw">
            {batchMode
              ? '여러 카테고리 텍스트를 이어붙여서 붙여넣기 (헤더 기준 자동 분리)'
              : '텍스트 붙여넣기 (카테고리 결과 + TOP 20 상품 + TOP 10 키워드)'}
          </Label>
          <textarea
            id="raw"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            className="w-full min-h-[180px] mt-1 px-3 py-2 text-sm border rounded-md font-mono"
            placeholder={`"여성백팩" 카테고리 결과\n패션의류잡화\n여성패션\n...\nimpression\n1733.99만\n검색어 노출\n6.11%\n...`}
          />
        </div>

        {batchMode && batchPreview && (
          <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-900">
            인식된 카테고리: <b>{batchPreview.count}</b>개
          </div>
        )}

        {batchSaving && (
          <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-900">
            저장 중... {batchSaving.done} / {batchSaving.total}
          </div>
        )}

        {!batchMode && preview && (
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
            disabled={
              saving ||
              (batchMode
                ? !batchPreview || batchPreview.count === 0
                : !preview || preview.products.length === 0 || !preview.category)
            }
          >
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            {batchMode && batchPreview && batchPreview.count > 0
              ? `${batchPreview.count}개 카테고리 저장`
              : '저장'}
          </Button>
        </div>
      </div>

      {/* 카테고리 트리 분석 */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="font-medium">카테고리 분석 ({leafSnapshots.length}개 카테고리)</h2>
            <span className="text-xs text-gray-500">선택 {selected.size}개</span>
            {searchTerm && (
              <span className="text-xs text-blue-600 font-medium">{matchCount}개 매칭</span>
            )}
            <span className="text-xs text-gray-400">트리 합산은 카테고리당 최신 1건 기준</span>
          </div>
          <div className="flex gap-2 items-center">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="카테고리 검색 (실시간)"
                className="h-8 pl-7 pr-2.5 text-xs border rounded-md w-56 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                  aria-label="검색 지우기"
                >
                  ×
                </button>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={expandAllTree}>전체 펼침</Button>
            <Button variant="outline" size="sm" onClick={collapseAllTree}>전체 접기</Button>
            <Button onClick={handleDownloadCsv} disabled={selected.size === 0} size="sm">
              <Download className="w-4 h-4 mr-1" />
              선택 카테고리 CSV
            </Button>
            <label
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 h-8 rounded-md border cursor-pointer select-none transition-colors ${
                adminMode
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-white border-[#E5E5E7] text-[#6E6E73] hover:bg-[#F5F5F7]'
              }`}
              title="관리 모드: 삭제 버튼이 보이고, 카테고리명 타이핑 확인 후 삭제 가능"
            >
              <input
                type="checkbox"
                checked={adminMode}
                onChange={(e) => setAdminMode(e.target.checked)}
                className="sr-only"
              />
              <span className={`w-1.5 h-1.5 rounded-full ${adminMode ? 'bg-red-500' : 'bg-gray-300'}`} />
              관리 모드
            </label>
          </div>
        </div>
        {loading ? (
          <div className="p-6 text-center text-gray-500 text-sm">불러오는 중...</div>
        ) : tree.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">저장된 카테고리가 없습니다.</div>
        ) : filteredTree.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">
            &quot;{searchTerm}&quot; 검색 결과 없음
          </div>
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
                  <th
                    className="p-2 text-right"
                    title="복사한 텍스트에서 '아이템위너' 가격을 추출하지 못한 상품이 있는 경우 비어있을 수 있습니다 (Coupang이 가격 범위만 표시했거나 광고제외 상품)."
                  >
                    <span className="inline-flex items-center gap-1">
                      평균 판매가
                      <Info className="w-3 h-3 text-gray-400" />
                    </span>
                  </th>
                  <th className="p-2 text-left">메모</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filteredTree.map((node) => renderTreeNode(node))}
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
                {adminMode && (
                  <button
                    onClick={(e) => handleDelete(s.id, e)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 삭제 확인 다이얼로그 — 카테고리명 정확히 타이핑해야 활성화 */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteConfirmInput('');
          }
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#1D1D1F]">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              카테고리 스냅샷 삭제
            </DialogTitle>
            <DialogDescription className="text-[#6E6E73]">
              이 작업은 되돌릴 수 없습니다. 정말 삭제하시려면 아래에 카테고리명을 정확히 입력하세요.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-3 py-2">
              <div className="text-xs text-[#86868B]">카테고리 경로</div>
              <div className="text-sm text-[#1D1D1F] bg-[#F5F5F7] rounded-md px-3 py-2 break-all">
                {deleteTarget.path.length > 0 ? deleteTarget.path.join(' › ') : deleteTarget.name}
              </div>
              <div className="text-xs text-[#86868B] pt-1">
                확인을 위해 <b className="text-[#1D1D1F]">{deleteTarget.name}</b> 을(를) 정확히 입력
              </div>
              <Input
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                placeholder={deleteTarget.name}
                autoFocus
              />
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteConfirmInput('');
              }}
            >
              취소
            </Button>
            <Button
              onClick={handleConfirmDelete}
              disabled={!deleteTarget || deleteConfirmInput !== deleteTarget.name}
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-40"
            >
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
                    {fmtCTR(p.ctr)}
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
              <td className="p-2 text-right">{fmtCTR(ctr(k.clicks, k.exposure))}</td>
              <td className="p-2 text-right">{fmtWon(k.avg_price)}</td>
              <td className="p-2 text-right">{k.contributing_count ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
