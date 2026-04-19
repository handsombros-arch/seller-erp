'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus, RefreshCw, Trash2, ExternalLink, GitCompareArrows, FolderOpen, ChevronRight } from 'lucide-react';

type BatchStats = { total: number; done: number; failed: number; pending: number; crawling: number; analyzing: number };
type Batch = {
  id: string;
  source_url: string;
  source_type: string;
  title: string | null;
  expand_limit: number;
  total_items: number | null;
  status: 'pending' | 'expanding' | 'expanded' | 'failed';
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
  product_info: { title?: string; price?: string; finalPrice?: string; originalPrice?: string; thumbnailUrl?: string } | null;
  review_stats: { total?: number; avgRating?: number; ratingDist?: Record<string, number> } | null;
  reviews_count: number | null;
  created_at: string;
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

const STATUS_PERCENT: Record<Item['status'], number> = {
  pending: 5,
  crawling: 35,
  analyzing: 75,
  done: 100,
  failed: 0,
};

export default function SourcingListPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchStats, setBatchStats] = useState<Record<string, BatchStats>>({});
  const [loading, setLoading] = useState(true);
  const [urls, setUrls] = useState('');
  const [expandLimit, setExpandLimit] = useState('40');
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((s) => {
      const doneItems = items.filter((i) => i.status === 'done').map((i) => i.id);
      if (s.size === doneItems.length) return new Set();
      return new Set(doneItems);
    });
  }
  function compare() {
    if (selected.size < 2) { alert('비교할 상품 2개 이상 선택하세요.'); return; }
    router.push('/sourcing/compare?ids=' + Array.from(selected).join(','));
  }

  const load = useCallback(async () => {
    const [r1, r2] = await Promise.all([
      fetch('/api/sourcing'),
      fetch('/api/sourcing/batches'),
    ]);
    if (r1.ok) setItems(await r1.json());
    if (r2.ok) {
      const data = await r2.json();
      setBatches(data.batches || []);
      setBatchStats(data.statsByBatch || {});
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      setItems((cur) => {
        const hasActiveItem = cur.some((i) => i.status === 'pending' || i.status === 'crawling' || i.status === 'analyzing');
        const hasActiveBatch = batches.some((b) => b.status === 'pending' || b.status === 'expanding');
        if (hasActiveItem || hasActiveBatch) load();
        return cur;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [load, batches]);

  async function submit() {
    const list = urls.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) return;
    setSubmitting(true);
    const r = await fetch('/api/sourcing', {
      method: 'POST',
      body: JSON.stringify({ urls: list, expand_limit: Number(expandLimit) || 40 }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (r.ok) {
      const data = await r.json();
      setUrls('');
      load();
      if (data.batches?.length) {
        alert(`카테고리 URL ${data.batches.length}개 감지. expand_category 워커가 상품 ${expandLimit}개씩 추출합니다.`);
      }
    } else {
      alert('추가 실패: ' + (await r.text()));
    }
    setSubmitting(false);
  }

  async function remove(id: string) {
    if (!confirm('삭제하시겠습니까?')) return;
    await fetch('/api/sourcing/' + id, { method: 'DELETE' });
    load();
  }

  async function retry(id: string) {
    await fetch('/api/sourcing/' + id, { method: 'PATCH', body: JSON.stringify({ action: 'retry' }), headers: { 'Content-Type': 'application/json' } });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">소싱 분석</h1>
          <p className="text-sm text-gray-500 mt-1">쿠팡/네이버 상품 URL을 입력하면 상세페이지 + 전체 리뷰를 AI가 분석합니다</p>
        </div>
        <div className="flex gap-2">
          {selected.size >= 2 && (
            <Button onClick={compare} size="sm">
              <GitCompareArrows className="w-4 h-4 mr-1" />선택한 {selected.size}개 비교
            </Button>
          )}
          <Button onClick={load} variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-1" />새로고침</Button>
        </div>
      </div>

      {/* 추가 폼 */}
      <div className="bg-white border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          <h2 className="font-semibold">URL 추가</h2>
          <span className="text-xs text-gray-500 ml-2">상품 URL · 베스트100 · 카테고리 · 캠페인 URL 모두 OK (줄바꿈/쉼표로 여러 개)</span>
        </div>
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder={'https://www.coupang.com/vp/products/...  (단일 상품)\nhttps://www.coupang.com/np/best100/bestseller/178591  (카테고리 40개 자동 확장)'}
          className="w-full min-h-[100px] border rounded p-2 text-sm font-mono"
        />
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>카테고리는 상위</span>
            <input
              type="number"
              value={expandLimit}
              onChange={(e) => setExpandLimit(e.target.value)}
              className="w-16 border rounded px-2 py-1 text-xs"
              min={5}
              max={100}
            />
            <span>개 자동 추출</span>
          </div>
          <p className="text-xs text-gray-500 flex-1">
            ⚠️ 워커 2개 필요: <code className="bg-gray-100 px-1">worker.py --watch</code> (상품 분석) +
            <code className="bg-gray-100 px-1 ml-1">expand_category.py --watch</code> (카테고리 확장)
          </p>
          <Button onClick={submit} disabled={submitting || !urls.trim()}>
            {submitting ? '추가 중...' : '큐에 추가'}
          </Button>
        </div>
      </div>

      {/* 배치 섹션 */}
      {batches.length > 0 && (
        <div className="bg-white border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 border-b flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-gray-600" />
            <h2 className="font-semibold text-sm">카테고리 배치 (묶음)</h2>
            <span className="text-xs text-gray-500">{batches.length}개</span>
          </div>
          <div className="divide-y">
            {batches.map((b) => {
              const stats = batchStats[b.id] || { total: 0, done: 0, failed: 0, pending: 0, crawling: 0, analyzing: 0 };
              const inProgress = stats.pending + stats.crawling + stats.analyzing;
              const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
              return (
                <Link
                  key={b.id}
                  href={`/sourcing/batches/${b.id}`}
                  className="block px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">{b.source_type}</span>
                        <span className="font-medium">{b.title || '(제목 분석중)'}</span>
                        {b.status === 'pending' && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">확장 대기</span>}
                        {b.status === 'expanding' && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">확장 중</span>}
                        {b.status === 'failed' && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">확장 실패</span>}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5 truncate" title={b.source_url}>{b.source_url}</div>
                      {b.error && <div className="text-xs text-red-600 mt-1">{b.error}</div>}
                      {b.status === 'expanded' && stats.total > 0 && (
                        <div className="mt-2 flex items-center gap-3 text-xs">
                          <div className="flex-1 max-w-md">
                            <div className="flex justify-between mb-0.5">
                              <span className="text-gray-600">{stats.done}/{stats.total} 완료</span>
                              <span className="text-gray-400">{pct}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded h-1.5 overflow-hidden">
                              <div className="bg-green-500 h-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                          {inProgress > 0 && <span className="text-blue-600">진행중 {inProgress}</span>}
                          {stats.failed > 0 && <span className="text-red-600">실패 {stats.failed}</span>}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* 목록 */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === items.filter((i) => i.status === 'done').length}
                  onChange={toggleAll}
                  className="cursor-pointer"
                />
              </th>
              <th className="text-left px-3 py-2 font-medium">상품</th>
              <th className="text-left px-3 py-2 font-medium w-20">플랫폼</th>
              <th className="text-left px-3 py-2 font-medium w-20">상태</th>
              <th className="text-left px-3 py-2 font-medium w-28">리뷰</th>
              <th className="text-left px-3 py-2 font-medium w-24">평균</th>
              <th className="text-left px-3 py-2 font-medium w-32">생성</th>
              <th className="w-24"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="text-center py-6 text-gray-500">로딩...</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={8} className="text-center py-6 text-gray-500">아직 등록된 항목이 없습니다.</td></tr>
            )}
            {items.map((it) => {
              const pct = STATUS_PERCENT[it.status];
              const inProgress = it.status === 'pending' || it.status === 'crawling' || it.status === 'analyzing';
              return (
              <tr key={it.id} className="border-b hover:bg-gray-50">
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={selected.has(it.id)}
                    onChange={() => toggle(it.id)}
                    disabled={it.status !== 'done'}
                    className="cursor-pointer"
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-3 items-start">
                    {it.product_info?.thumbnailUrl && (
                      <img src={it.product_info.thumbnailUrl} alt="" className="w-12 h-12 object-cover rounded flex-shrink-0 border" />
                    )}
                    <div className="flex-1 min-w-0">
                      <Link href={`/sourcing/${it.id}`} className="text-blue-600 hover:underline font-medium">
                        {it.product_info?.title || '(분석 중...)'}
                      </Link>
                      {(it.product_info?.finalPrice || it.product_info?.price) && (
                        <span className="ml-2 text-xs text-gray-500">{it.product_info?.finalPrice || it.product_info?.price}</span>
                      )}
                      <div className="text-[11px] text-gray-400 mt-0.5 truncate max-w-[500px]" title={it.url}>{it.url}</div>
                      {it.error && <div className="text-xs text-red-600 mt-1">{it.error}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs">{it.platform}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    <span className={`px-2 py-0.5 rounded text-xs inline-block w-fit ${STATUS_COLOR[it.status]}`}>
                      {STATUS_LABEL[it.status]}
                      {inProgress && <span className="ml-1">{pct}%</span>}
                    </span>
                    {inProgress && (
                      <div className="w-full bg-gray-200 rounded-full h-1 overflow-hidden">
                        <div className="bg-blue-500 h-full transition-all duration-500" style={{width: `${pct}%`}} />
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs">
                  {it.review_stats?.total ?? '-'}
                </td>
                <td className="px-3 py-2 text-xs">
                  {it.review_stats?.avgRating ? `${it.review_stats.avgRating}★` : '-'}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {new Date(it.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-3 py-2 text-right">
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="inline-block p-1 hover:bg-gray-200 rounded" title="원본 열기">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  {(it.status === 'failed' || it.status === 'done') && (
                    <button onClick={() => retry(it.id)} className="inline-block p-1 hover:bg-gray-200 rounded" title="재분석">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => remove(it.id)} className="inline-block p-1 hover:bg-gray-200 rounded text-red-600" title="삭제">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
    </div>
  );
}
