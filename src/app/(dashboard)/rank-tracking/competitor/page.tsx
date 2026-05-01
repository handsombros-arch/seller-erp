'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronDown, ChevronRight, Download, Eye, Loader2, Save, Trash2 } from 'lucide-react';
import { parseCompetitorSnapshot, type ParsedProduct } from '@/lib/coupang/parse-competitor-snapshot';

function TabNav() {
  return (
    <div className="flex gap-1 border-b">
      <Link href="/rank-tracking" className="px-3 py-2 text-sm text-gray-500 hover:text-gray-900">
        내 상품 추적
      </Link>
      <Link href="/rank-tracking/keywords" className="px-3 py-2 text-sm text-gray-500 hover:text-gray-900">
        키워드 Top N 스냅샷
      </Link>
      <Link href="/rank-tracking/competitor" className="px-3 py-2 text-sm font-semibold border-b-2 border-blue-600 text-gray-900">
        경쟁상품 스냅샷
      </Link>
    </div>
  );
}

type SnapshotMeta = {
  id: string;
  captured_at: string;
  my_product_name: string | null;
  my_product_id: string | null;
  memo: string | null;
  products_count: number;
  keywords_count: number;
};

type ProductDetail = Omit<ParsedProduct, 'keywords'> & { id: string; keywords: KeywordDetail[] };

type KeywordDetail = {
  id: string;
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

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function CompetitorSnapshotPage() {
  const [rawText, setRawText] = useState('');
  const [myProductName, setMyProductName] = useState('');
  const [myProductId, setMyProductId] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSnapId, setOpenSnapId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ snapshotId: string; products: ProductDetail[] } | null>(null);
  const [openProductIds, setOpenProductIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    if (!rawText.trim()) return null;
    return parseCompetitorSnapshot(rawText);
  }, [rawText]);

  const loadSnapshots = useCallback(async () => {
    const r = await fetch('/api/rank-tracking/competitor');
    if (r.ok) {
      const data = await r.json();
      setSnapshots(data.snapshots || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const loadDetail = useCallback(async (id: string) => {
    const r = await fetch(`/api/rank-tracking/competitor/${id}`);
    if (!r.ok) return;
    const data = await r.json();
    setDetail({ snapshotId: id, products: data.products || [] });
    setOpenProductIds(new Set());
  }, []);

  const handleToggleSnapshot = useCallback(
    async (id: string) => {
      if (openSnapId === id) {
        setOpenSnapId(null);
        setDetail(null);
        return;
      }
      setOpenSnapId(id);
      setDetail(null);
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

  const handleSave = async () => {
    if (!preview || preview.products.length === 0) {
      setError('파싱된 상품이 없습니다. 텍스트를 확인하세요.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const r = await fetch('/api/rank-tracking/competitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw_text: rawText,
          my_product_name: myProductName || null,
          my_product_id: myProductId || null,
          memo: memo || null,
        }),
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

  const handleDelete = async (id: string) => {
    if (!confirm('이 스냅샷을 삭제하시겠습니까?')) return;
    const r = await fetch(`/api/rank-tracking/competitor/${id}`, { method: 'DELETE' });
    if (r.ok) {
      if (openSnapId === id) {
        setOpenSnapId(null);
        setDetail(null);
      }
      await loadSnapshots();
    }
  };

  const handleExport = (id: string) => {
    window.location.href = `/api/rank-tracking/competitor/${id}/export`;
  };

  return (
    <div className="p-6 space-y-6">
      <TabNav />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">경쟁상품 스냅샷</h1>
          <p className="text-sm text-gray-500 mt-1">
            쿠팡 셀러 광고진단 페이지의 "TOP 20 경쟁상품" 텍스트를 통째로 붙여넣으면 파싱·저장되고 엑셀로 내려받을 수 있습니다.
          </p>
        </div>
      </div>

      {/* 새 스냅샷 입력 */}
      <div className="border rounded-lg p-4 bg-white space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="my-product-name">내 상품명 (선택)</Label>
            <Input
              id="my-product-name"
              value={myProductName}
              onChange={(e) => setMyProductName(e.target.value)}
              placeholder="예: 그랑누보 데일리 백팩"
            />
          </div>
          <div>
            <Label htmlFor="my-product-id">내 상품 ID (선택)</Label>
            <Input
              id="my-product-id"
              value={myProductId}
              onChange={(e) => setMyProductId(e.target.value)}
              placeholder="쿠팡 productId"
            />
          </div>
          <div>
            <Label htmlFor="memo">메모 (선택)</Label>
            <Input
              id="memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="예: 5월 1주차 광고 분석"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="raw">텍스트 붙여넣기</Label>
          <textarea
            id="raw"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            className="w-full min-h-[200px] mt-1 px-3 py-2 text-sm border rounded-md font-mono"
            placeholder={`스위스톤 대용량 노트북 백팩 확장형 ST4D18, 블랙, 1\n출시일: 2024.12.26\n상품평:\n4.5 (564)\n31.36만\n검색어 노출\n12.21%\n...`}
          />
        </div>

        {preview && (
          <div className="text-sm text-gray-600 flex items-center gap-4 flex-wrap">
            <span>
              파싱 결과: 상품 <b className="text-gray-900">{preview.products.length}</b>개,
              키워드 <b className="text-gray-900">
                {preview.products.reduce((s, p) => s + p.keywords.length, 0)}
              </b>개
            </span>
            {preview.products.find((p) => p.is_my_product) && (
              <span className="text-blue-600">내 상품 인식됨</span>
            )}
            {preview.warnings.length > 0 && (
              <span className="text-orange-600">경고 {preview.warnings.length}건</span>
            )}
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
          <Button onClick={handleSave} disabled={saving || !preview || preview.products.length === 0}>
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            저장
          </Button>
        </div>
      </div>

      {/* 스냅샷 목록 */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-medium">저장된 스냅샷 ({snapshots.length})</h2>
        </div>
        {loading ? (
          <div className="p-6 text-center text-gray-500 text-sm">불러오는 중...</div>
        ) : snapshots.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">저장된 스냅샷이 없습니다.</div>
        ) : (
          <div className="divide-y">
            {snapshots.map((s) => {
              const isOpen = openSnapId === s.id;
              return (
                <div key={s.id}>
                  <div className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50">
                    <button
                      onClick={() => handleToggleSnapshot(s.id)}
                      className="flex-1 flex items-center gap-2 text-left"
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
                        <span className="font-medium">{fmtDateTime(s.captured_at)}</span>
                        <span className="text-gray-600 truncate">{s.my_product_name || '-'}</span>
                        <span className="text-gray-500">상품 {s.products_count} / 키워드 {s.keywords_count}</span>
                        <span className="text-gray-500 truncate">{s.memo || ''}</span>
                      </div>
                    </button>
                    <Button variant="ghost" size="sm" onClick={() => handleExport(s.id)} title="엑셀 다운로드">
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)} title="삭제">
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                  {isOpen && (
                    <div className="bg-gray-50 px-4 py-3 border-t">
                      {!detail || detail.snapshotId !== s.id ? (
                        <div className="text-sm text-gray-500">불러오는 중...</div>
                      ) : (
                        <SnapshotDetailView
                          products={detail.products}
                          openProductIds={openProductIds}
                          onToggleProduct={handleToggleProduct}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SnapshotDetailView({
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
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-100 text-gray-600">
          <tr>
            <th className="p-2 w-10"></th>
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
                  className={`border-t cursor-pointer hover:bg-white ${p.is_my_product ? 'bg-blue-50' : ''}`}
                  onClick={() => onToggleProduct(p.id)}
                >
                  <td className="p-2 text-center">
                    {p.keywords.length > 0 ? (
                      isOpen ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronRight className="w-3 h-3 inline" />
                    ) : null}
                  </td>
                  <td className="p-2">
                    {p.rank}
                    {p.is_my_product && <span className="ml-1 text-blue-600 font-semibold">내</span>}
                  </td>
                  <td className="p-2 max-w-[400px] truncate" title={p.name}>{p.name}</td>
                  <td className="p-2 text-right">
                    {fmt(p.exposure)}
                    {p.exposure_change_pct != null && (
                      <span className={`ml-1 text-[10px] ${p.exposure_change_pct < 0 ? 'text-red-500' : 'text-blue-500'}`}>
                        {fmtPct(p.exposure_change_pct)}
                      </span>
                    )}
                  </td>
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
                      <div className="bg-white px-4 py-2 border-l-4 border-blue-200">
                        <table className="w-full text-xs">
                          <thead className="text-gray-500">
                            <tr>
                              <th className="p-1 text-left">키워드</th>
                              <th className="p-1 text-right">검색량</th>
                              <th className="p-1 text-right">노출</th>
                              <th className="p-1 text-right">클릭</th>
                              <th className="p-1 text-right">평균가</th>
                              <th className="p-1 text-right">기여 #</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.keywords.map((k) => (
                              <tr key={k.id} className="border-t">
                                <td className="p-1">{k.keyword}</td>
                                <td className="p-1 text-right">{fmt(k.search_volume)}</td>
                                <td className="p-1 text-right">{fmt(k.exposure)}</td>
                                <td className="p-1 text-right">{fmt(k.clicks)}</td>
                                <td className="p-1 text-right">{fmtWon(k.avg_price)}</td>
                                <td className="p-1 text-right">{k.contributing_count ?? '-'}</td>
                              </tr>
                            ))}
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
  );
}

