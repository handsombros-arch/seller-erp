'use client';

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw, Play, ExternalLink } from 'lucide-react';

type Keyword = {
  id: string;
  keyword: string;
  top_n: number;
  status: string;
  auto_interval_minutes: number | null;
  last_snapshot_at: string | null;
  last_error: string | null;
};

type SnapshotMeta = {
  id: string;
  checked_at: string;
  top_n: number;
  items_count: number | null;
  error: string | null;
};

type Item = {
  rank: number;
  product_id: string | null;
  title: string | null;
  price: string | null;
  is_ad: boolean;
  is_rocket: boolean;
  thumbnail_url: string | null;
  product_url: string | null;
  rating: number | null;
  review_count: number | null;
};

function formatChecked(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function KeywordSnapshotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [keyword, setKeyword] = useState<Keyword | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [selectedSnapId, setSelectedSnapId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);

  const loadMeta = useCallback(async () => {
    const r = await fetch(`/api/keyword-snapshots/${id}`);
    if (r.ok) {
      const data = await r.json();
      setKeyword(data.keyword);
      setSnapshots(data.snapshots || []);
      setSelectedSnapId((prev) => {
        if (prev && (data.snapshots || []).some((s: SnapshotMeta) => s.id === prev)) return prev;
        return (data.snapshots || [])[0]?.id || null;
      });
    }
    setLoading(false);
  }, [id]);

  const loadItems = useCallback(async (snapId: string) => {
    setItemsLoading(true);
    const r = await fetch(`/api/keyword-snapshots/${id}/snapshots/${snapId}`);
    if (r.ok) {
      const data = await r.json();
      setItems(data.items || []);
    }
    setItemsLoading(false);
  }, [id]);

  useEffect(() => {
    loadMeta();
    const timer = setInterval(() => {
      setKeyword((kw) => {
        if (kw && (kw.status === 'queued' || kw.status === 'running')) loadMeta();
        return kw;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [loadMeta]);

  useEffect(() => {
    if (selectedSnapId) loadItems(selectedSnapId);
    else setItems([]);
  }, [selectedSnapId, loadItems]);

  async function recheck() {
    await fetch(`/api/keyword-snapshots/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'queue' }),
    });
    loadMeta();
  }

  if (loading) return <div className="p-6 text-gray-500">로딩...</div>;
  if (!keyword) return <div className="p-6 text-gray-500">키워드를 찾을 수 없습니다.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/rank-tracking/keywords" className="text-gray-500 hover:text-gray-900">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold">{keyword.keyword}</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Top {keyword.top_n} · 자동 간격: {keyword.auto_interval_minutes ? `${keyword.auto_interval_minutes}분` : '수동'}
              {keyword.last_error && <span className="ml-2 text-red-600">· {keyword.last_error}</span>}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={recheck}
            disabled={keyword.status === 'queued' || keyword.status === 'running'}
            size="sm"
          >
            <Play className="w-4 h-4 mr-1" />
            지금 스냅샷
            {keyword.status === 'queued' && ' (큐)'}
            {keyword.status === 'running' && ' (실행중)'}
          </Button>
          <Button onClick={loadMeta} variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-1" />새로고침</Button>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium">스냅샷 시점:</label>
          <select
            value={selectedSnapId || ''}
            onChange={(e) => setSelectedSnapId(e.target.value || null)}
            className="border rounded px-2 py-1.5 text-sm min-w-[260px]"
            disabled={snapshots.length === 0}
          >
            {snapshots.length === 0 && <option value="">아직 스냅샷 없음</option>}
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {formatChecked(s.checked_at)} · {s.items_count ?? 0}개
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500">총 {snapshots.length}개 이력</span>
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-3 py-2 font-medium w-12">#</th>
              <th className="text-left px-3 py-2 font-medium">상품</th>
              <th className="text-left px-3 py-2 font-medium w-28">가격</th>
              <th className="text-left px-3 py-2 font-medium w-24">평점/리뷰</th>
              <th className="text-left px-3 py-2 font-medium w-24">태그</th>
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            {itemsLoading && <tr><td colSpan={6} className="text-center py-6 text-gray-500">불러오는 중...</td></tr>}
            {!itemsLoading && items.length === 0 && (
              <tr><td colSpan={6} className="text-center py-6 text-gray-500">
                {snapshots.length === 0 ? '스냅샷을 찍으려면 "지금 스냅샷" 클릭 (워커 기동 필요)' : '항목 없음'}
              </td></tr>
            )}
            {!itemsLoading && items.map((it) => (
              <tr key={it.rank} className="border-b hover:bg-gray-50">
                <td className="px-3 py-2 font-semibold text-gray-700">{it.rank}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-2 items-start">
                    {it.thumbnail_url && (
                      <img src={it.thumbnail_url} alt="" className="w-12 h-12 object-cover rounded border flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium line-clamp-2">{it.title || '(제목 없음)'}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">pid: {it.product_id}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {it.price ? `${it.price}원` : '-'}
                </td>
                <td className="px-3 py-2 text-xs">
                  {it.rating != null && <div>★ {it.rating}</div>}
                  {it.review_count != null && <div className="text-gray-500">({it.review_count.toLocaleString()})</div>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1 flex-wrap">
                    {it.is_ad && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">광고</span>}
                    {it.is_rocket && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">로켓</span>}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  {it.product_url && (
                    <a href={it.product_url} target="_blank" rel="noopener noreferrer" className="inline-block p-1 hover:bg-gray-200 rounded">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
