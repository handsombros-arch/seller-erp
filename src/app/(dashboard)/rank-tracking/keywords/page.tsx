'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Search, ExternalLink, Clock, LayoutGrid, TableProperties, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

type Progress = {
  phase?: string;
  page?: number;
  collected?: number;
  target?: number;
};

type Keyword = {
  id: string;
  keyword: string;
  top_n: number;
  status: 'idle' | 'queued' | 'running' | 'done' | 'failed';
  last_snapshot_at: string | null;
  last_error: string | null;
  auto_interval_minutes: number | null;
  progress: Progress | null;
  queued_at: string | null;
  started_at: string | null;
};

const PHASE_LABEL: Record<string, string> = {
  starting: '시작 준비',
  launching_chrome: '시크릿 Chrome 기동',
  loading: '페이지 로딩',
  parsing: '상품 파싱',
  scanning: '상품 수집',
  saving: 'DB 저장',
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

type MatrixCell = {
  snapshot_id: string;
  rank: number;
  product_id: string | null;
  title: string | null;
  price: string | null;
  is_ad: boolean;
  is_rocket: boolean;
  thumbnail_url: string | null;
};

type MatrixData = {
  snapshots: { id: string; checked_at: string; items_count: number | null }[];
  rows: { rank: number; cells: (MatrixCell | null)[] }[];
  traces: { product_id: string; title: string | null; ranksBySnap: (number | null)[]; bestRank: number }[];
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
  const [viewMode, setViewMode] = useState<'single' | 'matrix'>('single');
  const [matrix, setMatrix] = useState<MatrixData | null>(null);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
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

  const loadMatrix = useCallback(async (kwId: string) => {
    setLoadingMatrix(true);
    const r = await fetch(`/api/keyword-snapshots/${kwId}/matrix?limit=8`);
    if (r.ok) {
      const data = await r.json();
      setMatrix(data);
    }
    setLoadingMatrix(false);
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

  useEffect(() => {
    if (currentKw && viewMode === 'matrix') {
      loadMatrix(currentKw.id);
    }
  }, [currentKw, viewMode, snapshots.length, loadMatrix]);

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
        {running && currentKw && (() => {
          const queuedSec = currentKw.queued_at ? Math.floor((Date.now() - new Date(currentKw.queued_at).getTime()) / 1000) : elapsedSec;
          const isQueued = currentKw.status === 'queued';
          const workerStuck = isQueued && queuedSec > 15;
          if (workerStuck) {
            return (
              <div className="mt-2 p-2 border border-orange-300 bg-orange-50 rounded text-xs text-orange-900">
                <div className="font-semibold">⚠️ 워커가 큐를 잡지 않습니다 ({queuedSec}s 대기).</div>
                <div className="mt-1">
                  본인 PC 터미널에서 <code className="bg-white px-1">python sourcing/keyword_snapshot_worker.py --watch</code> 가 실행 중인지 확인하세요.
                </div>
              </div>
            );
          }
          const p = currentKw.progress;
          const phaseTxt = p?.phase ? (PHASE_LABEL[p.phase] || p.phase) : '큐 대기';
          const pct = p?.target ? Math.min(100, Math.round(((p.collected || 0) / p.target) * 100)) : null;
          return (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2 text-xs text-blue-700">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <span className="font-medium">
                  {isQueued ? '큐 대기' : phaseTxt}
                </span>
                {p?.page ? <span className="text-gray-500">· 페이지 {p.page}</span> : null}
                {p?.collected != null && p?.target ? (
                  <span className="text-gray-500">· {p.collected}/{p.target}개</span>
                ) : null}
                <span className="text-gray-400 ml-auto">경과 {elapsedSec}s</span>
              </div>
              {pct != null && (
                <div className="w-full bg-gray-200 rounded-full h-1">
                  <div className="bg-blue-500 h-1 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          );
        })()}
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

      {/* 뷰 토글 + 이력 선택 */}
      {currentKw && snapshots.length > 0 && (
        <div className="bg-white border rounded-lg p-3 flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 border rounded-md p-0.5">
            <button
              onClick={() => setViewMode('single')}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${viewMode === 'single' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <TableProperties className="w-3.5 h-3.5" />
              단일 시점
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${viewMode === 'matrix' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              시점 비교 (최근 8회)
            </button>
          </div>
          {viewMode === 'single' && (
            <>
              <div className="w-px h-6 bg-gray-200" />
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
            </>
          )}
          <span className="text-xs text-gray-400 ml-auto">총 {snapshots.length}회 수집</span>
        </div>
      )}

      {/* 시점 비교 매트릭스 */}
      {currentKw && viewMode === 'matrix' && (
        <div className="bg-white border rounded-lg overflow-auto">
          {loadingMatrix && <div className="text-center py-8 text-gray-500">불러오는 중...</div>}
          {!loadingMatrix && matrix && matrix.snapshots.length === 0 && (
            <div className="text-center py-8 text-gray-500">스냅샷이 아직 없습니다.</div>
          )}
          {!loadingMatrix && matrix && matrix.snapshots.length > 0 && (
            <table className="text-xs border-collapse min-w-full">
              <thead className="bg-gray-50 border-b sticky top-0 z-10">
                <tr>
                  <th className="text-left px-2 py-2 font-medium w-12 sticky left-0 bg-gray-50 z-20 border-r">#</th>
                  {matrix.snapshots.map((s) => (
                    <th key={s.id} className="text-left px-2 py-2 font-medium border-r min-w-[160px]">
                      <div className="font-semibold">{formatChecked(s.checked_at).replace(/년.*월/, '월').slice(4)}</div>
                      <div className="text-[10px] text-gray-400 font-normal">{s.items_count ?? 0}개</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.rank} className="border-b hover:bg-blue-50/30">
                    <td className="px-2 py-1.5 font-semibold text-gray-700 sticky left-0 bg-white border-r">{row.rank}</td>
                    {row.cells.map((cell, i) => {
                      const prev = i > 0 ? row.cells[i - 1] : null;
                      const changed = prev && cell && prev.product_id !== cell.product_id;
                      return (
                        <td key={i} className={`px-2 py-1.5 border-r align-top ${changed ? 'bg-yellow-50' : ''}`}>
                          {cell ? (
                            <div>
                              <div className="font-medium line-clamp-2 leading-tight" title={cell.title || ''}>
                                {cell.title || '(제목없음)'}
                              </div>
                              <div className="flex gap-1 mt-0.5 items-center">
                                {cell.price && <span className="text-[10px] text-gray-600 font-semibold">{cell.price}원</span>}
                                {cell.is_ad && <span className="text-[9px] bg-orange-100 text-orange-700 px-1 rounded">광고</span>}
                                {cell.is_rocket && <span className="text-[9px] bg-blue-100 text-blue-700 px-1 rounded">로켓</span>}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loadingMatrix && matrix && matrix.traces.length > 0 && (
            <div className="border-t">
              <div className="px-3 py-2 text-xs font-semibold bg-gray-50 border-b flex items-center gap-2">
                <span>상품별 순위 변동 (Top 20 제품)</span>
                <span className="text-gray-400 font-normal">· 노란 셀 = 직전 시점 대비 상품 변경</span>
              </div>
              <table className="text-xs w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium">상품</th>
                    {matrix.snapshots.map((s) => (
                      <th key={s.id} className="text-center px-2 py-1.5 font-medium w-14">
                        {new Date(s.checked_at).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                      </th>
                    ))}
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.traces.slice(0, 20).map((t) => {
                    const latestRank = t.ranksBySnap[t.ranksBySnap.length - 1];
                    const prevRank = t.ranksBySnap[t.ranksBySnap.length - 2];
                    const delta = prevRank != null && latestRank != null ? prevRank - latestRank : null;
                    return (
                      <tr key={t.product_id} className="border-b hover:bg-gray-50">
                        <td className="px-2 py-1.5">
                          <div className="line-clamp-1" title={t.title || ''}>{t.title || t.product_id}</div>
                          <div className="text-[10px] text-gray-400">pid: {t.product_id}</div>
                        </td>
                        {t.ranksBySnap.map((r, i) => (
                          <td key={i} className="text-center px-1 py-1.5">
                            {r != null ? (
                              <span className={`inline-block px-1.5 py-0.5 rounded ${r <= 10 ? 'bg-green-100 text-green-700 font-semibold' : r <= 20 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                {r}
                              </span>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                        ))}
                        <td className="px-1 py-1.5 text-center">
                          {delta != null && delta > 0 && <ArrowUpRight className="w-3.5 h-3.5 text-green-600 inline" />}
                          {delta != null && delta < 0 && <ArrowDownRight className="w-3.5 h-3.5 text-red-600 inline" />}
                          {delta === 0 && <Minus className="w-3.5 h-3.5 text-gray-400 inline" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 결과 테이블 (단일 시점) */}
      {currentKw && viewMode === 'single' && (
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
