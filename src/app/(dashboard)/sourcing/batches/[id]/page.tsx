'use client';

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw, ExternalLink, Trash2 } from 'lucide-react';

type Batch = {
  id: string;
  source_url: string;
  source_type: string;
  title: string | null;
  expand_limit: number;
  total_items: number | null;
  status: string;
  error: string | null;
  progress: Record<string, unknown> | null;
  created_at: string;
  expanded_at: string | null;
};

type Item = {
  id: string;
  url: string;
  platform: string;
  product_id: string | null;
  status: 'pending' | 'crawling' | 'analyzing' | 'done' | 'failed';
  error: string | null;
  product_info: { title?: string; price?: string; finalPrice?: string; thumbnailUrl?: string } | null;
  review_stats: { total?: number; avgRating?: number } | null;
  reviews_count: number | null;
  inquiries_count: number | null;
  batch_rank: number | null;
  analyzed_at: string | null;
};

const STATUS_LABEL: Record<Item['status'], string> = {
  pending: '대기',
  crawling: '크롤링',
  analyzing: '분석중',
  done: '완료',
  failed: '실패',
};
const STATUS_COLOR: Record<Item['status'], string> = {
  pending: 'bg-gray-100 text-gray-700',
  crawling: 'bg-blue-100 text-blue-700',
  analyzing: 'bg-purple-100 text-purple-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await fetch(`/api/sourcing/batches/${id}`);
    if (r.ok) {
      const data = await r.json();
      setBatch(data.batch);
      setItems(data.items || []);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      setItems((cur) => {
        const active = cur.some((i) => i.status === 'pending' || i.status === 'crawling' || i.status === 'analyzing');
        if (active || batch?.status === 'pending' || batch?.status === 'expanding') load();
        return cur;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [load, batch?.status]);

  async function removeBatch() {
    if (!confirm(`배치 전체와 ${items.length}개 분석 결과를 모두 삭제합니다. 계속?`)) return;
    const r = await fetch(`/api/sourcing/batches/${id}`, { method: 'DELETE' });
    if (r.ok) window.location.href = '/sourcing';
  }

  if (loading) return <div className="p-6 text-gray-500">로딩...</div>;
  if (!batch) return <div className="p-6 text-gray-500">배치를 찾을 수 없습니다.</div>;

  const stats = items.reduce(
    (acc, it) => {
      acc.total++;
      acc[it.status]++;
      return acc;
    },
    { total: 0, pending: 0, crawling: 0, analyzing: 0, done: 0, failed: 0 },
  );
  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  const avgRating = (() => {
    const doneItems = items.filter((i) => i.status === 'done' && i.review_stats?.avgRating);
    if (!doneItems.length) return null;
    const sum = doneItems.reduce((a, b) => a + (b.review_stats?.avgRating || 0), 0);
    return (sum / doneItems.length).toFixed(2);
  })();
  const totalReviews = items.reduce((a, b) => a + (b.review_stats?.total || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/sourcing" className="text-gray-500 hover:text-gray-900 flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">
              {batch.title || batch.source_type}
            </h1>
            <a href={batch.source_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-400 hover:underline truncate block">
              {batch.source_url}
            </a>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={load} variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-1" />새로고침</Button>
          <Button onClick={removeBatch} variant="outline" size="sm" className="text-red-600 hover:bg-red-50">
            <Trash2 className="w-4 h-4 mr-1" />배치 삭제
          </Button>
        </div>
      </div>

      {/* 진행 요약 */}
      <div className="bg-white border rounded-lg p-4">
        <div className="flex gap-4 items-center flex-wrap">
          <div>
            <div className="text-xs text-gray-500">진행률</div>
            <div className="text-2xl font-bold">{pct}%</div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="w-full bg-gray-200 rounded h-2 overflow-hidden">
              <div className="bg-green-500 h-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex gap-3 mt-2 text-xs">
              <span className="text-green-600">완료 {stats.done}</span>
              <span className="text-blue-600">크롤링 {stats.crawling}</span>
              <span className="text-purple-600">분석중 {stats.analyzing}</span>
              <span className="text-gray-500">대기 {stats.pending}</span>
              {stats.failed > 0 && <span className="text-red-600">실패 {stats.failed}</span>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-xs text-gray-500">상품</div>
              <div className="font-semibold">{stats.total}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">총 리뷰</div>
              <div className="font-semibold">{totalReviews.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">평균 별점</div>
              <div className="font-semibold">{avgRating ? `${avgRating}★` : '-'}</div>
            </div>
          </div>
        </div>
        {batch.error && <div className="mt-3 text-xs text-red-600">오류: {batch.error}</div>}
      </div>

      {/* 배치 상태 — 아직 확장 안 됨 */}
      {batch.status !== 'expanded' && items.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
          {batch.status === 'pending' && (
            <>
              <div className="font-semibold text-blue-900">카테고리 확장 대기 중</div>
              <div className="text-xs text-blue-700 mt-1">
                로컬에서 <code className="bg-white px-1">python sourcing/expand_category.py --watch</code> 실행 필요.
              </div>
            </>
          )}
          {batch.status === 'expanding' && (
            <div className="font-semibold text-blue-900">확장 중... {batch.expand_limit}개 상품 URL 추출 진행</div>
          )}
          {batch.status === 'failed' && (
            <div className="font-semibold text-red-700">확장 실패: {batch.error || 'unknown'}</div>
          )}
        </div>
      )}

      {/* 상품 목록 */}
      {items.length > 0 && (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2 font-medium w-12">#</th>
                <th className="text-left px-3 py-2 font-medium">상품</th>
                <th className="text-left px-3 py-2 font-medium w-24">상태</th>
                <th className="text-left px-3 py-2 font-medium w-20">리뷰</th>
                <th className="text-left px-3 py-2 font-medium w-16">★</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2 font-semibold text-gray-700">{it.batch_rank ?? '-'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2 items-start">
                      {it.product_info?.thumbnailUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.product_info.thumbnailUrl} alt="" className="w-12 h-12 object-cover rounded border flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <Link href={`/sourcing/${it.id}`} className="text-blue-600 hover:underline line-clamp-2">
                          {it.product_info?.title || '(분석 대기)'}
                        </Link>
                        {(it.product_info?.finalPrice || it.product_info?.price) && (
                          <span className="text-xs text-gray-500 ml-1">{it.product_info?.finalPrice || it.product_info?.price}</span>
                        )}
                        {it.error && <div className="text-xs text-red-600 mt-0.5">{it.error}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLOR[it.status]}`}>
                      {STATUS_LABEL[it.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{it.review_stats?.total ?? '-'}</td>
                  <td className="px-3 py-2 text-xs">{it.review_stats?.avgRating ?? '-'}</td>
                  <td className="px-3 py-2 text-right">
                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="inline-block p-1 hover:bg-gray-200 rounded">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
