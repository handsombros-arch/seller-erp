'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, LayoutGrid, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtNum } from '../_lib/settlement';

/**
 * 데이터 현황판 — 달 × 출처. "무엇을 올렸고 무엇이 빠졌나"를 한 화면에서.
 * 출처: 시트 저장/마감(입력 탭), 매출 파일(입력 탭 매입원가 카드, 플랫폼별), 쿠팡 광고(광고 분석 쿠팡 → 월 집계 저장), 토스 광고(광고 분석 토스 → 자동 집계), B2B 줄.
 */
interface Sales { rows: number; qty: number; revenue: number; unmatched: number; updated_at: string | null }
interface Cov { sheet: { saved: boolean; items: number }; closed: string | null; sales: Record<string, Sales>; coupangAds: { rows: number; cost: number; updated_at: string | null } | null; tossAds: { rawRows: number; days: number; daysInMonth: number; first: string | null; last: string | null; cost: number; aggregated: boolean } | null; b2b: { lines: number; qty: number } | null }
const SALES_COLS: { id: string; label: string }[] = [{ id: 'coupang', label: '쿠팡 매출' }, { id: 'toss', label: '토스 매출' }, { id: 'smartstore', label: '스스 매출' }, { id: 'esm', label: 'ESM 매출' }];
const LOCAL_INFO_KEY = 'lv-erp-settlement-ad-local-info';
const OPEN_KEY = 'lv-erp-settlement-coverage-open';   // 숨김 상태 기억

export function DataCoverageCard({ selectedYm, refreshKey }: { selectedYm: string; refreshKey?: number }) {
  const [open, setOpenState] = useState(true);
  useEffect(() => { try { if (localStorage.getItem(OPEN_KEY) === 'off') setOpenState(false); } catch {} }, []);
  const setOpen = (v: boolean) => { setOpenState(v); try { localStorage.setItem(OPEN_KEY, v ? 'on' : 'off'); } catch {} };
  const [data, setData] = useState<{ months: string[]; coverage: Record<string, Cov> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pcDays, setPcDays] = useState<Record<string, number>>({});
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch('/api/settlement/coverage?months=12'); const j = await r.json(); if (r.ok) setData(j); } catch {} finally { setLoading(false); }
    try { const j = localStorage.getItem(LOCAL_INFO_KEY); if (j) { const info = JSON.parse(j); if (info?.daysByMonth) setPcDays(info.daysByMonth); } } catch {}
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const months = data ? [...data.months].sort() : [];
  const cell = 'px-2 py-1.5 text-center whitespace-nowrap tabular-nums';
  const ok = 'text-success font-semibold';
  const part = 'text-warn font-semibold';
  const none = 'text-fg-5';
  const missing = data ? months.filter(m => m < selectedYm.slice(0, 7) || m === selectedYm).slice(-6).flatMap(m => { const c = data.coverage[m]; const out: string[] = []; if (!c) return out; if (!c.sheet.saved) out.push(`${m.slice(2)} 시트`); if (!c.sales.coupang) out.push(`${m.slice(2)} 쿠팡 매출`); if (!c.sales.toss) out.push(`${m.slice(2)} 토스 매출`); if (!c.coupangAds) out.push(`${m.slice(2)} 쿠팡 광고`); if (!c.tossAds || c.tossAds.days < c.tossAds.daysInMonth * 0.9) out.push(`${m.slice(2)} 토스 광고${c.tossAds ? `(${c.tossAds.days}일치만)` : ''}`); return out; }) : [];

  return (
    <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-4 md:px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-left mr-auto">
          <LayoutGrid className="h-4 w-4 text-brand" />
          <span className="text-[15px] font-bold text-fg">데이터 현황</span>
          <span className="text-[12px] text-fg-3">달마다 무엇이 올라와 있는지 · 빠졌거나 일부만 있으면 주황{!open && missing.length ? ` · 최근 6개월 빠진 것 ${missing.length}건` : ''}</span>
          <span className="text-[11px] text-brand ml-1">{open ? '숨기기' : '보기'}</span>
        </button>
        <button onClick={load} disabled={loading} className="text-[11px] text-fg-4 hover:text-brand flex items-center gap-1">{loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} 새로고침</button>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-fg-4">
            올리는 곳: 매출 파일 → 아래 <b>플랫폼별 매입원가</b> 카드 · 쿠팡 광고 → <Link href="/ad-analysis" className="text-brand hover:underline">광고 분석 › 쿠팡</Link>에 올린 뒤 아래 광고비 raw 카드에서 월 집계 저장 · 토스 광고 → <Link href="/ad-analysis/toss" className="text-brand hover:underline">광고 분석 › 토스</Link>(자동 집계) · 시트 → 아래 정산 시트 저장.
          </p>
          {!data ? <div className="py-6 text-center text-fg-4 text-[12px]"><Loader2 className="h-4 w-4 animate-spin inline mr-1" />불러오는 중</div> : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-[12px] border-collapse">
                <thead><tr className="h-9 bg-card-2 border-b border-line text-[11px] font-semibold text-fg-4">
                  <th className="px-2 text-left sticky left-0 bg-card-2">월</th>
                  <th className={cell} title="정산 시트를 저장한 달">시트</th>
                  {SALES_COLS.map(c => <th key={c.id} className={cell} title="매출 파일을 올려 적용한 달 — 파일에 있던 상품 수, SKU 에 연결 안 된 상품 수">{c.label} 파일</th>)}
                  <th className={cell} title="쿠팡 광고 보고서 월 집계 광고비(VAT 별도). '며칠치'는 이 PC 브라우저 raw 의 날짜 수">쿠팡 광고 보고서</th>
                  <th className={cell} title="토스 광고 보고서에 들어 있는 날짜 수. 그 달 일수보다 적으면 일부만 올라온 것 (기간 표시)">토스 광고 보고서</th>
                  <th className={cell} title="B2B 출고 내역 줄 수">B2B</th>
                </tr></thead>
                <tbody>
                  {months.map(m => { const c = data.coverage[m]; const sel = m === selectedYm; const t = c?.tossAds; const tossFull = t && t.days >= t.daysInMonth * 0.9;
                    return <tr key={m} className={cn('h-9 border-b border-line-2', sel && 'bg-brand-bg/50')}>
                      <td className={cn('px-2 sticky left-0 whitespace-nowrap font-semibold', sel ? 'bg-brand-bg/50 text-brand' : 'bg-card text-fg')}>{m.slice(2).replace('-', '.')}{c?.closed && <span className="ml-1 text-[10px] text-fg-4" title={`마감 ${c.closed.slice(0, 10)}`}>🔒</span>}</td>
                      <td className={cn(cell, c?.sheet.saved ? ok : none)} title={c?.sheet.saved ? `${c.sheet.items}개 항목 저장` : '시트 저장 없음'}>{c?.sheet.saved ? '✓' : '–'}</td>
                      {SALES_COLS.map(col => { const s = c?.sales[col.id]; return <td key={col.id} className={cn(cell, s ? (s.unmatched ? part : ok) : none)} title={s ? `${s.rows}행 · ${fmtNum(s.qty)}개 · 매출 ${fmtNum(s.revenue)}원${s.unmatched ? ` · 미매칭 ${s.unmatched}행` : ''}${s.updated_at ? ` · ${s.updated_at.slice(0, 10)}` : ''}` : '매출 파일 없음'}>{s ? (s.unmatched ? `상품 ${s.rows}개 · ${s.unmatched}개 미연결` : `상품 ${s.rows}개 ✓`) : '–'}</td>; })}
                      <td className={cn(cell, c?.coupangAds ? ok : pcDays[m] ? part : none)} title={c?.coupangAds ? `월 집계 ${c.coupangAds.rows}옵션 · 광고비 ${fmtNum(c.coupangAds.cost)}원 (VAT 별도)${pcDays[m] ? ` · 이 PC raw ${pcDays[m]}일치` : ''}` : pcDays[m] ? `이 PC 에 raw ${pcDays[m]}일치 — 월 집계 저장 필요` : '광고 분석 › 쿠팡에 보고서 없음'}>{c?.coupangAds ? `${fmtNum(c.coupangAds.cost)}원${pcDays[m] ? ` · ${pcDays[m]}일치` : ''}` : pcDays[m] ? `PC 에만 ${pcDays[m]}일치` : '–'}</td>
                      <td className={cn(cell, t ? (tossFull ? ok : part) : none)} title={t ? `raw ${t.rawRows}행 · ${t.first ?? ''}~${t.last ?? ''} · 광고비 ${fmtNum(t.cost)}원${t.aggregated ? ' · 월 집계 ✓' : ' · 월 집계 없음(재저장 필요)'}` : '광고 분석 › 토스에 보고서 없음'}>{t ? (tossFull ? `${t.days}일치 전부 ✓` : `${t.days}일치만 (${(t.first ?? '').slice(5).replace('-', '/')}~${(t.last ?? '').slice(5).replace('-', '/')})`) : '–'}</td>
                      <td className={cn(cell, c?.b2b ? ok : none)} title={c?.b2b ? `${c.b2b.lines}줄 · ${fmtNum(c.b2b.qty)}개` : ''}>{c?.b2b ? `${c.b2b.lines}줄` : '–'}</td>
                    </tr>; })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-fg-4">읽는 법 — 매출 파일: 파일 안의 상품 종류 수, ‘미연결’은 아직 SKU 를 안 정한 상품(등록 큐에서 연결). 광고 보고서: 보고서에 날짜가 며칠 들어 있는지 — ‘14일치만’이면 그 달 절반만 올라온 것이라 나머지 날짜를 다시 올려야 합니다. ✓ 초록 = 다 있음, 주황 = 일부/미연결, – = 없음.</p>
          {data && missing.length > 0 && <p className="text-[11px] text-warn">최근 6개월 빠진 것: {missing.join(' · ')}</p>}
        </div>
      )}
    </section>
  );
}
