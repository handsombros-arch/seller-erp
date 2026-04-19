'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus, RefreshCw, Trash2, Play, ChevronRight } from 'lucide-react';

type Keyword = {
  id: string;
  keyword: string;
  top_n: number;
  is_active: boolean;
  auto_interval_minutes: number | null;
  status: 'idle' | 'queued' | 'running' | 'done' | 'failed';
  last_snapshot_at: string | null;
  last_error: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<Keyword['status'], string> = {
  idle: '대기',
  queued: '큐',
  running: '실행중',
  done: '완료',
  failed: '실패',
};
const STATUS_COLOR: Record<Keyword['status'], string> = {
  idle: 'bg-gray-100 text-gray-700',
  queued: 'bg-yellow-100 text-yellow-700',
  running: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

function TabNav() {
  return (
    <div className="flex gap-1 border-b">
      <Link href="/rank-tracking" className="px-3 py-2 text-sm text-gray-500 hover:text-gray-900">
        내 상품 추적
      </Link>
      <Link href="/rank-tracking/keywords" className="px-3 py-2 text-sm font-semibold border-b-2 border-blue-600 text-gray-900">
        키워드 Top N 스냅샷
      </Link>
    </div>
  );
}

export default function KeywordSnapshotListPage() {
  const [items, setItems] = useState<Keyword[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ keyword: '', top_n: '40', auto_interval_minutes: '60' });

  const load = useCallback(async () => {
    const r = await fetch('/api/keyword-snapshots');
    if (r.ok) {
      const data = await r.json();
      setItems(data.keywords || []);
      setCounts(data.snapshotCounts || {});
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      setItems((cur) => {
        if (cur.some((i) => i.status === 'queued' || i.status === 'running')) load();
        return cur;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  async function submit() {
    if (!form.keyword.trim()) return;
    setSubmitting(true);
    const r = await fetch('/api/keyword-snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword: form.keyword.trim(),
        top_n: Number(form.top_n) || 40,
        auto_interval_minutes: form.auto_interval_minutes ? Number(form.auto_interval_minutes) : null,
      }),
    });
    if (r.ok) {
      setForm({ keyword: '', top_n: '40', auto_interval_minutes: '60' });
      load();
    } else {
      const err = await r.json().catch(() => ({ error: 'unknown' }));
      alert('추가 실패: ' + (err.error || r.status));
    }
    setSubmitting(false);
  }

  async function recheck(id: string) {
    const r = await fetch('/api/keyword-snapshots/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'queue' }),
    });
    if (r.ok) load();
  }

  async function remove(id: string) {
    if (!confirm('삭제하시겠습니까? (모든 스냅샷 이력 함께 삭제)')) return;
    await fetch('/api/keyword-snapshots/' + id, { method: 'DELETE' });
    load();
  }

  async function toggleAuto(id: string, minutes: number | null) {
    await fetch('/api/keyword-snapshots/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_interval_minutes: minutes }),
    });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">쿠팡 키워드 순위 추적</h1>
        <p className="text-sm text-gray-500 mt-1">
          시크릿 Chrome 기준 (로그인/개인화 없음). `python sourcing/keyword_snapshot_worker.py --watch` 실행 필요.
        </p>
      </div>

      <TabNav />

      <div className="bg-white border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          <h2 className="font-semibold">키워드 추가</h2>
        </div>
        <div className="grid grid-cols-12 gap-2">
          <input
            value={form.keyword}
            onChange={(e) => setForm({ ...form, keyword: e.target.value })}
            placeholder="검색 키워드 (예: 여성 백팩)"
            className="col-span-5 border rounded px-2 py-1.5 text-sm"
          />
          <input
            value={form.top_n}
            onChange={(e) => setForm({ ...form, top_n: e.target.value })}
            placeholder="Top N"
            type="number"
            className="col-span-2 border rounded px-2 py-1.5 text-sm"
          />
          <input
            value={form.auto_interval_minutes}
            onChange={(e) => setForm({ ...form, auto_interval_minutes: e.target.value })}
            placeholder="자동 간격(분)"
            type="number"
            className="col-span-3 border rounded px-2 py-1.5 text-sm"
          />
          <Button onClick={submit} disabled={submitting || !form.keyword.trim()} className="col-span-2">
            {submitting ? '...' : '추가 & 큐 등록'}
          </Button>
        </div>
        <p className="text-[11px] text-gray-500">
          자동 간격을 설정하면 워커가 폴링 시 해당 주기로 자동 스냅샷을 찍습니다 (5분 이상). 비워두면 수동 트리거만.
        </p>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-3 py-2 font-medium">키워드</th>
              <th className="text-left px-3 py-2 font-medium w-20">Top</th>
              <th className="text-left px-3 py-2 font-medium w-20">상태</th>
              <th className="text-left px-3 py-2 font-medium w-24">자동 간격</th>
              <th className="text-left px-3 py-2 font-medium w-20">스냅샷</th>
              <th className="text-left px-3 py-2 font-medium w-36">마지막 스냅샷</th>
              <th className="w-32"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="text-center py-6 text-gray-500">로딩...</td></tr>}
            {!loading && items.length === 0 && (
              <tr><td colSpan={7} className="text-center py-6 text-gray-500">등록된 키워드 없음</td></tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="border-b hover:bg-gray-50">
                <td className="px-3 py-2">
                  <Link href={`/rank-tracking/keywords/${it.id}`} className="text-blue-600 hover:underline font-medium flex items-center gap-1">
                    {it.keyword}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                  {it.last_error && (
                    <div className="text-[10px] text-red-600 mt-1 max-w-[300px] truncate" title={it.last_error}>
                      {it.last_error}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{it.top_n}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs inline-block ${STATUS_COLOR[it.status]}`}>
                    {STATUS_LABEL[it.status]}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {it.auto_interval_minutes ? (
                    <button onClick={() => toggleAuto(it.id, null)} className="text-blue-600 hover:underline">
                      {it.auto_interval_minutes}분
                    </button>
                  ) : (
                    <button onClick={() => toggleAuto(it.id, 60)} className="text-gray-400 hover:text-gray-700">
                      수동 → 60분?
                    </button>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{counts[it.id] ?? 0}</td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {it.last_snapshot_at
                    ? new Date(it.last_snapshot_at).toLocaleString('ko-KR', {
                        year: '2-digit', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })
                    : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => recheck(it.id)}
                    disabled={it.status === 'queued' || it.status === 'running'}
                    className="inline-block p-1 hover:bg-gray-200 rounded disabled:opacity-40"
                    title="지금 스냅샷"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => remove(it.id)} className="inline-block p-1 hover:bg-gray-200 rounded text-red-600" title="삭제">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
