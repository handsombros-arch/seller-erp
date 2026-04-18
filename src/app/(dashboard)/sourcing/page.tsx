'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus, RefreshCw, Trash2, ExternalLink, GitCompareArrows } from 'lucide-react';

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
  const [loading, setLoading] = useState(true);
  const [urls, setUrls] = useState('');
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
    const r = await fetch('/api/sourcing');
    if (r.ok) setItems(await r.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // 진행 중 항목 있으면 5초마다 폴링
    const id = setInterval(() => {
      setItems((cur) => {
        if (cur.some((i) => i.status === 'pending' || i.status === 'crawling' || i.status === 'analyzing')) {
          load();
        }
        return cur;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  async function submit() {
    const list = urls.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) return;
    setSubmitting(true);
    const r = await fetch('/api/sourcing', { method: 'POST', body: JSON.stringify({ urls: list }), headers: { 'Content-Type': 'application/json' } });
    if (r.ok) {
      setUrls('');
      load();
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
          <h2 className="font-semibold">URL 추가 (여러 개는 줄바꿈 또는 쉼표로 구분)</h2>
        </div>
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder={'https://www.coupang.com/vp/products/...\nhttps://smartstore.naver.com/.../products/...'}
          className="w-full min-h-[100px] border rounded p-2 text-sm font-mono"
        />
        <div className="flex justify-between items-center">
          <p className="text-xs text-gray-500">⚠️ 워커 (`python sourcing/worker.py --watch`) 가 켜져있어야 분석이 진행됩니다.</p>
          <Button onClick={submit} disabled={submitting || !urls.trim()}>
            {submitting ? '추가 중...' : '큐에 추가'}
          </Button>
        </div>
      </div>

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
