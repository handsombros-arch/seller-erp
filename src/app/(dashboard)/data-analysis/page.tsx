'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronDown, ChevronRight, Download, Loader2, Save, Trash2 } from 'lucide-react';
import { parseCompetitorSnapshot } from '@/lib/coupang/parse-competitor-snapshot';

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

  const withCategory = useMemo(
    () => snapshots.filter((s) => s.category_name),
    [snapshots],
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
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-medium">카테고리 분석 ({withCategory.length})</h2>
            <span className="text-xs text-gray-500">선택 {selected.size}개</span>
          </div>
          <Button onClick={handleDownloadCsv} disabled={selected.size === 0} size="sm">
            <Download className="w-4 h-4 mr-1" />
            선택 카테고리 CSV
          </Button>
        </div>
        {loading ? (
          <div className="p-6 text-center text-gray-500 text-sm">불러오는 중...</div>
        ) : withCategory.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">저장된 카테고리가 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="p-2 w-8"></th>
                  <th className="p-2 w-8"></th>
                  <th className="p-2 text-left">카테고리</th>
                  <th className="p-2 text-left">캡처일</th>
                  <th className="p-2 text-right">전체 노출</th>
                  <th className="p-2 text-right">전체 클릭</th>
                  <th className="p-2 text-right">전체 CTR</th>
                  <th className="p-2 text-right">Top100 노출</th>
                  <th className="p-2 text-right">Top100 점유율</th>
                  <th className="p-2 text-right">Search</th>
                  <th className="p-2 text-right">Ad</th>
                  <th className="p-2 text-right">상품/키워드</th>
                  <th className="p-2 text-left">메모</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {withCategory.map((s) => {
                  const isOpen = openSnapId === s.id;
                  const isSel = selected.has(s.id);
                  const products = productsBySnap[s.id];
                  return (
                    <Fragment key={s.id}>
                      <tr
                        className="border-t hover:bg-gray-50 cursor-pointer"
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
}: {
  products: ProductDetail[];
  openProductIds: Set<string>;
  onToggleProduct: (id: string) => void;
}) {
  if (products.length === 0) {
    return <div className="text-sm text-gray-500">상품이 없습니다.</div>;
  }
  return (
    <div className="overflow-x-auto bg-white border rounded">
      <table className="w-full text-xs">
        <thead className="bg-gray-100 text-gray-600">
          <tr>
            <th className="p-2 w-8"></th>
            <th className="p-2 w-12 text-left">순위</th>
            <th className="p-2 text-left">상품명</th>
            <th className="p-2 text-right">검색어 노출</th>
            <th className="p-2 text-right">클릭</th>
            <th className="p-2 text-right">CTR</th>
            <th className="p-2 text-right">위너가</th>
            <th className="p-2 text-right">리뷰</th>
            <th className="p-2 text-right">키워드</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const isOpen = openProductIds.has(p.id);
            return (
              <Fragment key={p.id}>
                <tr
                  className={`border-t cursor-pointer hover:bg-gray-50 ${p.is_my_product ? 'bg-blue-50' : ''}`}
                  onClick={() => onToggleProduct(p.id)}
                >
                  <td className="p-2 text-center">
                    {p.keywords.length > 0 ? (
                      isOpen ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronRight className="w-3 h-3 inline" />
                    ) : null}
                  </td>
                  <td className="p-2 font-medium">
                    {p.rank}
                    {p.is_my_product && <span className="ml-1 text-blue-600 font-semibold">내</span>}
                  </td>
                  <td className="p-2 max-w-[400px] truncate" title={p.name}>{p.name}</td>
                  <td className="p-2 text-right">{fmt(p.exposure)}</td>
                  <td className="p-2 text-right">{fmt(p.clicks)}</td>
                  <td className="p-2 text-right">{fmtPct(p.ctr)}</td>
                  <td className="p-2 text-right">{fmtWon(p.winner_price)}</td>
                  <td className="p-2 text-right">
                    {p.review_score ?? '-'} ({fmt(p.review_count)})
                  </td>
                  <td className="p-2 text-right">{p.keywords.length}</td>
                </tr>
                {isOpen && p.keywords.length > 0 && (
                  <tr>
                    <td colSpan={9} className="p-0">
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

// ────────────────────────────────────────────────────────────────────────────
// 키워드 표
// ────────────────────────────────────────────────────────────────────────────

function KeywordsTable({ keywords }: { keywords: KeywordDetail[] }) {
  return (
    <div className="overflow-x-auto bg-white border rounded">
      <table className="w-full text-xs">
        <thead className="bg-gray-100 text-gray-600">
          <tr>
            <th className="p-2 w-12 text-left">순위</th>
            <th className="p-2 text-left">키워드</th>
            <th className="p-2 text-right">검색량</th>
            <th className="p-2 text-right">노출</th>
            <th className="p-2 text-right">클릭</th>
            <th className="p-2 text-right">CTR</th>
            <th className="p-2 text-right">평균가</th>
            <th className="p-2 text-right">기여 #</th>
          </tr>
        </thead>
        <tbody>
          {keywords.map((k, idx) => (
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
