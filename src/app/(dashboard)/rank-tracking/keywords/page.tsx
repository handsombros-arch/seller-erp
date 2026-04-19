'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Search, ExternalLink, Trash2, Clock } from 'lucide-react';

type Keyword = {
  id: string;
  keyword: string;
  top_n: number;
  status: 'idle' | 'queued' | 'running' | 'done' | 'failed';
  last_snapshot_at: string | null;
  last_error: string | null;
  auto_interval_minutes: number | null;
};

type SnapshotMeta = { id: string; checked_at: string; top_n: number; items_count: number | null };

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

function TabNav() {
  return (
    <div className="flex gap-1 border-b">
      <Link href="/rank-tracking" className="px-3 py-2 text-sm text-gray-500 hover:text-gray-900">
        내 상품 추적
      </Link>
      <Link href="/rank-tracking/keywords" className="px-3 py-2 text-sm font-semibold border-b-2 border-blue-600 text-gray-900">
        키워드 Top N
      </Link>
    </div>
  );
}

function formatChecked(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function KeywordSearchPage() {
  const [savedKeywords, setSavedKeywords] = useState<Keyword[]>([]);
  const [input, setInput] = useState('');
  const [topN, setTopN] = useState('40');
  const [currentKw, setCurrentKw] = useState<Keyword | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [selectedSnapId, setSelectedSnapId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [runStartAt, setRunStartAt] = useState<number | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const loadSaved = useCallback(async () => {
    const r = await fetch('/api/keyword-snapshots');
    if (r.ok) {
      const data = await r.json();
      setSavedKeywords(data.keywords || []);
    }
  }, []);

  const loadKeywordDetail = useCallback(async (kwId: string) => {
    const r = await fetch(`/api/keyword-snapshots/${kwId}`);
    if (!r.ok) return null;
    const data = await r.json();
    setCurrentKw(data.keyword);
    setSnapshots(data.snapshots || []);
    const latest = (data.snapshots || [])[0]?.id || null;
    setSelectedSnapId(latest);
    return data;
  }, []);

  const loadItems = useCallback(async (kwId: string, snapId: string) => {
    setLoadingItems(true);
    const r = await fetch(`/api/keyword-snapshots/${kwId}/snapshots/${snapId}`);
    if (r.ok) {
      const data = await r.json();
      setItems(data.items || []);
    }
    setLoadingItems(false);
  }, []);

  useEffect(() => {
    loadSaved();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [loadSaved]);

  useEffect(() => {
    if (currentKw && selectedSnapId) {
      loadItems(currentKw.id, selectedSnapId);
    } else {
      setItems([]);
    }
  }, [currentKw, selectedSnapId, loadItems]);

  async function runSearch(keyword?: string) {
    const kw = (keyword ?? input).trim();
    if (!kw || running) return;
    setInput(kw);
    setRunning(true);
    setRunStartAt(Date.now());

    const r = await fetch('/api/keyword-snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: kw, top_n: Number(topN) || 40 }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'unknown' }));
      alert('실행 실패: ' + (err.error || r.status));
      setRunning(false);
      return;
    }
    const data = await r.json();
    setCurrentKw(data);
    loadSaved();

    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      const info = await loadKeywordDetail(data.id);
      const freshKw: Keyword | null = info?.keyword ?? null;
      if (!freshKw) return;
      if (freshKw.status === 'done' || freshKw.status === 'failed') {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        setRunning(false);
      }
    }, 2500);
  }

  async function selectSaved(kw: Keyword) {
    setInput(kw.keyword);
    setTopN(String(kw.top_n));
    await loadKeywordDetail(kw.id);
  }

  async function removeSaved(id: string) {
    if (!confirm('삭제하시겠습니까? (모든 스냅샷 이력 포함)')) return;
    await fetch('/api/keyword-snapshots/' + id, { method: 'DELETE' });
    if (currentKw?.id === id) {
      setCurrentKw(null);
      setSnapshots([]);
      setItems([]);
      setSelectedSnapId(null);
    }
    loadSaved();
  }

  const elapsedSec = runStartAt ? Math.floor((Date.now() - runStartAt) / 1000) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">쿠팡 키워드 Top N</h1>
        <p className="text-sm text-gray-500 mt-1">
          키워드 입력 → 시크릿 Chrome 기준 1~N위 상품 즉시 수집 (워커 실행 중이어야 함). 매번 실행 = 이력 자동 누적.
        </p>
      </div>

      <TabNav />

      {/* 검색 박스 */}
      <div className="bg-white border rounded-lg p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
              placeholder="검색 키워드 (예: 여성 백팩)"
              className="w-full border rounded pl-9 pr-3 py-2 text-sm"
              disabled={running}
            />
          </div>
          <input
            value={topN}
            onChange={(e) => setTopN(e.target.value)}
            placeholder="Top N"
            type="number"
            className="w-20 border rounded px-2 py-2 text-sm text-center"
            disabled={running}
          />
          <Button onClick={() => runSearch()} disabled={running || !input.trim()} className="w-24">
            {running ? `실행중 ${elapsedSec}s` : '검색'}
          </Button>
        </div>
        {running && (
          <div className="mt-2 text-xs text-blue-600">
            워커가 쿠팡에서 {topN}위까지 수집 중입니다 (보통 10~40초)... 상태: {currentKw?.status || 'queued'}
          </div>
        )}
        {currentKw?.last_error && !running && (
          <div className="mt-2 text-xs text-red-600">오류: {currentKw.last_error}</div>
        )}

        {/* 저장된 키워드 빠른 전환 */}
        {savedKeywords.length > 0 && (
          <div className="mt-3 flex gap-1.5 flex-wrap">
            <span className="text-[11px] text-gray-400 self-center">저장됨:</span>
            {savedKeywords.map((kw) => (
              <button
                key={kw.id}
                onClick={() => selectSaved(kw)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  currentKw?.id === kw.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-400 text-gray-700'
                }`}
              >
                {kw.keyword}
                <span className="ml-1 text-gray-400">({kw.top_n})</span>
                <span
                  onClick={(e) => { e.stopPropagation(); removeSaved(kw.id); }}
                  className="ml-1 text-gray-400 hover:text-red-600 cursor-pointer"
                  title="삭제"
                >
                  ✕
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 이력 선택 */}
      {currentKw && snapshots.length > 0 && (
        <div className="bg-white border rounded-lg p-3 flex items-center gap-3">
          <Clock className="w-4 h-4 text-gray-400" />
          <label className="text-sm font-medium">시점:</label>
          <select
            value={selectedSnapId || ''}
            onChange={(e) => setSelectedSnapId(e.target.value || null)}
            className="border rounded px-2 py-1 text-sm min-w-[260px]"
          >
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {formatChecked(s.checked_at)} · {s.items_count ?? 0}개
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-400">총 {snapshots.length}회 수집</span>
        </div>
      )}

      {/* 결과 테이블 */}
      {currentKw && (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2 font-medium w-14">순위</th>
                <th className="text-left px-3 py-2 font-medium">상품명</th>
                <th className="text-right px-3 py-2 font-medium w-28">최종가</th>
                <th className="text-left px-3 py-2 font-medium w-24">평점/리뷰</th>
                <th className="text-left px-3 py-2 font-medium w-24">태그</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {loadingItems && (
                <tr><td colSpan={6} className="text-center py-6 text-gray-500">불러오는 중...</td></tr>
              )}
              {!loadingItems && items.length === 0 && running && (
                <tr><td colSpan={6} className="text-center py-6 text-blue-600">수집 대기 중... (워커가 처리 중)</td></tr>
              )}
              {!loadingItems && items.length === 0 && !running && (
                <tr><td colSpan={6} className="text-center py-6 text-gray-500">결과 없음. 다시 검색해보세요.</td></tr>
              )}
              {!loadingItems && items.map((it) => (
                <tr key={it.rank} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2 font-semibold text-gray-700">{it.rank}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2 items-start">
                      {it.thumbnail_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.thumbnail_url} alt="" className="w-12 h-12 object-cover rounded border flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium line-clamp-2">{it.title || '(제목 없음)'}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">pid: {it.product_id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">
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
      )}

      {!currentKw && !running && (
        <div className="bg-gray-50 border border-dashed rounded-lg p-10 text-center text-gray-500">
          키워드를 입력하고 검색하세요. 결과는 자동으로 저장되어 시간별 이력이 쌓입니다.
        </div>
      )}
    </div>
  );
}
