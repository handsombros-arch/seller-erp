'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus, RefreshCw, Trash2, Play, ExternalLink } from 'lucide-react';

function TabNav() {
  return (
    <div className="flex gap-1 border-b">
      <Link href="/rank-tracking" className="px-3 py-2 text-sm font-semibold border-b-2 border-blue-600 text-gray-900">
        내 상품 추적
      </Link>
      <Link href="/rank-tracking/keywords" className="px-3 py-2 text-sm text-gray-500 hover:text-gray-900">
        키워드 Top N 스냅샷
      </Link>
      <Link href="/rank-tracking/competitor" className="px-3 py-2 text-sm text-gray-500 hover:text-gray-900">
        경쟁상품 스냅샷
      </Link>
    </div>
  );
}

type Keyword = {
  id: string;
  keyword: string;
  product_id: string;
  product_name: string | null;
  target_rank: number | null;
  max_pages: number;
  is_active: boolean;
  status: 'idle' | 'queued' | 'checking' | 'done' | 'failed';
  last_checked_at: string | null;
  last_rank: number | null;
  last_is_ad: boolean | null;
  last_page: number | null;
  last_error: string | null;
  created_at: string;
};

type HistoryPoint = { checked_date: string; rank: number | null; is_ad: boolean | null; page: number | null };

const STATUS_LABEL: Record<Keyword['status'], string> = {
  idle: '대기',
  queued: '큐',
  checking: '확인중',
  done: '완료',
  failed: '실패',
};

const STATUS_COLOR: Record<Keyword['status'], string> = {
  idle: 'bg-gray-100 text-gray-700',
  queued: 'bg-yellow-100 text-yellow-700',
  checking: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

function Sparkline({ points }: { points: HistoryPoint[] }) {
  const series = [...points].reverse().slice(-14);
  if (series.length < 2) return <span className="text-xs text-gray-400">데이터 부족</span>;
  const maxRank = Math.max(...series.map((p) => p.rank ?? 999));
  const minRank = Math.min(...series.filter((p) => p.rank != null).map((p) => p.rank as number));
  const range = Math.max(1, maxRank - minRank);
  const W = 110;
  const H = 28;
  const stepX = series.length > 1 ? W / (series.length - 1) : 0;
  const coords = series.map((p, i) => {
    const x = i * stepX;
    const rank = p.rank ?? maxRank;
    const y = ((rank - minRank) / range) * (H - 6) + 3;
    return { x, y, p };
  });
  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  return (
    <svg width={W} height={H} className="inline-block">
      <path d={path} fill="none" stroke="#3182F6" strokeWidth={1.5} />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={c.p.rank == null ? 2.5 : 2} fill={c.p.rank == null ? '#ef4444' : '#3182F6'} />
      ))}
    </svg>
  );
}

export default function RankTrackingPage() {
  const [items, setItems] = useState<Keyword[]>([]);
  const [historyMap, setHistoryMap] = useState<Record<string, HistoryPoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ keyword: '', product_id: '', product_name: '', target_rank: '', max_pages: '5' });

  const load = useCallback(async () => {
    const r = await fetch('/api/rank-tracking');
    if (r.ok) {
      const data = await r.json();
      setItems(data.keywords || []);
      setHistoryMap(data.historyByKeyword || {});
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      setItems((cur) => {
        if (cur.some((i) => i.status === 'queued' || i.status === 'checking')) load();
        return cur;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  async function submit() {
    if (!form.keyword.trim() || !form.product_id.trim()) return;
    setSubmitting(true);
    const r = await fetch('/api/rank-tracking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword: form.keyword.trim(),
        product_id: form.product_id.trim(),
        product_name: form.product_name.trim() || null,
        target_rank: form.target_rank ? Number(form.target_rank) : null,
        max_pages: Number(form.max_pages) || 5,
      }),
    });
    if (r.ok) {
      setForm({ keyword: '', product_id: '', product_name: '', target_rank: '', max_pages: '5' });
      load();
    } else {
      const err = await r.json().catch(() => ({ error: 'unknown' }));
      alert('추가 실패: ' + (err.error || r.status));
    }
    setSubmitting(false);
  }

  async function recheck(id: string) {
    const r = await fetch('/api/rank-tracking/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'queue' }),
    });
    if (r.ok) load();
  }

  async function remove(id: string) {
    if (!confirm('삭제하시겠습니까?')) return;
    await fetch('/api/rank-tracking/' + id, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">쿠팡 키워드 순위 추적</h1>
          <p className="text-sm text-gray-500 mt-1">
            시크릿 Chrome 기준 (로그인/개인화 없음). `python sourcing/rank_worker.py --watch` 가 켜져있어야 동작합니다.
          </p>
        </div>
        <Button onClick={load} variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-1" />새로고침</Button>
      </div>

      <TabNav />

      {/* 추가 폼 */}
      <div className="bg-white border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          <h2 className="font-semibold">키워드 추가</h2>
        </div>
        <div className="grid grid-cols-12 gap-2">
          <input
            value={form.keyword}
            onChange={(e) => setForm({ ...form, keyword: e.target.value })}
            placeholder="검색 키워드 (예: 마스크팩)"
            className="col-span-3 border rounded px-2 py-1.5 text-sm"
          />
          <input
            value={form.product_id}
            onChange={(e) => setForm({ ...form, product_id: e.target.value })}
            placeholder="쿠팡 상품 ID (숫자)"
            className="col-span-3 border rounded px-2 py-1.5 text-sm"
          />
          <input
            value={form.product_name}
            onChange={(e) => setForm({ ...form, product_name: e.target.value })}
            placeholder="상품명 (선택, 식별용)"
            className="col-span-3 border rounded px-2 py-1.5 text-sm"
          />
          <input
            value={form.target_rank}
            onChange={(e) => setForm({ ...form, target_rank: e.target.value })}
            placeholder="목표순위"
            type="number"
            className="col-span-1 border rounded px-2 py-1.5 text-sm"
          />
          <input
            value={form.max_pages}
            onChange={(e) => setForm({ ...form, max_pages: e.target.value })}
            placeholder="페이지"
            type="number"
            className="col-span-1 border rounded px-2 py-1.5 text-sm"
          />
          <Button onClick={submit} disabled={submitting || !form.keyword.trim() || !form.product_id.trim()} className="col-span-1">
            {submitting ? '...' : '추가'}
          </Button>
        </div>
        <p className="text-[11px] text-gray-500">
          쿠팡 상품 URL <code>www.coupang.com/vp/products/<b>1234567</b></code> 에서 숫자 부분이 상품 ID. 광고 슬롯 포함 노출 순위로 기록됩니다.
        </p>
      </div>

      {/* 목록 */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-3 py-2 font-medium">키워드 / 상품</th>
              <th className="text-left px-3 py-2 font-medium w-20">상태</th>
              <th className="text-left px-3 py-2 font-medium w-24">현재 순위</th>
              <th className="text-left px-3 py-2 font-medium w-20">목표</th>
              <th className="text-left px-3 py-2 font-medium w-32">14일 추이</th>
              <th className="text-left px-3 py-2 font-medium w-32">마지막 체크</th>
              <th className="w-28"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="text-center py-6 text-gray-500">로딩...</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={7} className="text-center py-6 text-gray-500">아직 등록된 키워드가 없습니다.</td></tr>
            )}
            {items.map((it) => {
              const hits = (historyMap[it.id] || []).filter((h) => h.rank != null);
              const best = hits.length ? Math.min(...hits.map((h) => h.rank as number)) : null;
              const hitTarget = it.target_rank && it.last_rank && it.last_rank <= it.target_rank;
              return (
                <tr key={it.id} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="font-medium">{it.keyword}</div>
                    <div className="text-[11px] text-gray-500">
                      <a
                        href={`https://www.coupang.com/vp/products/${it.product_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline inline-flex items-center gap-0.5"
                      >
                        pid: {it.product_id}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                      {it.product_name && <span className="ml-2">· {it.product_name}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs inline-block ${STATUS_COLOR[it.status]}`}>
                      {STATUS_LABEL[it.status]}
                    </span>
                    {it.last_error && (
                      <div className="text-[10px] text-red-600 mt-1 max-w-[140px] truncate" title={it.last_error}>
                        {it.last_error}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {it.last_rank != null ? (
                      <div className="flex items-center gap-1">
                        <span className={`font-semibold ${hitTarget ? 'text-green-600' : ''}`}>{it.last_rank}위</span>
                        {it.last_is_ad && <span className="text-[10px] bg-orange-100 text-orange-700 px-1 rounded">광고</span>}
                        {best != null && best < it.last_rank && (
                          <span className="text-[10px] text-gray-400">최고 {best}</span>
                        )}
                      </div>
                    ) : it.last_checked_at ? (
                      <span className="text-xs text-gray-400">미노출 ({it.max_pages}p 내)</span>
                    ) : (
                      <span className="text-xs text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{it.target_rank ?? '-'}</td>
                  <td className="px-3 py-2">
                    <Sparkline points={historyMap[it.id] || []} />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {it.last_checked_at
                      ? new Date(it.last_checked_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : '-'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => recheck(it.id)}
                      disabled={it.status === 'queued' || it.status === 'checking'}
                      className="inline-block p-1 hover:bg-gray-200 rounded disabled:opacity-40"
                      title="지금 체크"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => remove(it.id)} className="inline-block p-1 hover:bg-gray-200 rounded text-red-600" title="삭제">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
