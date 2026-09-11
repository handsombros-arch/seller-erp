'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { readLocalAdRows } from '../../settlement/_lib/adRawLocal';

/**
 * 오가닉 vs 광고 — 쿠팡 비즈니스 인사이트(총 판매) 와 광고 raw(광고 전환 판매)를 옵션ID 로 맞댄다.
 * 기준(정산 앱 공통):
 *  - 총 판매 = 인사이트 '총 판매수' (취소 전). 광고 전환 판매도 취소 전 주문 기준이라 같은 잣대.
 *  - 순판매 = 총 판매 − 취소 − 빈박스(리뷰용 발송). 순매출 = 매출(원, 취소 반영) − 빈박스 × 평균 단가.
 *  - 오가닉 = 총 판매 − 광고 전환 판매(당일 / 14일). 두 기준 사이가 실제 범위.
 *  - ROAS(순) = 순매출 ÷ 광고비(VAT 포함). 광고 효율은 이 값으로 본다.
 *  - 윙(판매자배송)과 그로스는 옵션ID 가 달라 따로 집계되며, 빈박스는 윙 옵션 행에 적는다.
 */
interface Period { period_from: string; period_to: string; rows: number; qty: number; revenue: number; updated_at: string }
interface Row { id: string; vendor_item_id: string; option_name: string | null; product_name: string | null; sales_method: string | null; revenue: number; orders: number; qty: number; gross_qty: number; cancel_qty: number; empty_qty?: number | null; visitors: number; views: number; sku_id: string | null; sku?: { sku_code: string; option_values?: Record<string, string> | null; product?: { id: string; name: string } | null } | null }
interface AdAgg { q1: number; q14: number; cost: number; clicks: number; rev14: number }
type Basis = '1d' | '14d';
type Group = 'product' | 'method' | 'option';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pct = (n: number | null) => n == null || !isFinite(n) ? '-' : `${n.toFixed(0)}%`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const methodLabel = (m: string | null) => m === '로켓그로스' ? '그로스' : m === '판매자배송' ? '윙' : (m ?? '');

export default function OrganicPage() {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [sel, setSel] = useState<Period | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [ads, setAds] = useState<Map<string, AdAgg> | null>(null);
  const [adInfo, setAdInfo] = useState<{ rows: number; days: number; missingDays: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [basis, setBasis] = useState<Basis>('1d');
  const [group, setGroup] = useState<Group>('method');
  const [uploading, setUploading] = useState(false);
  const [uFrom, setUFrom] = useState(''); const [uTo, setUTo] = useState('');
  const [emptyDraft, setEmptyDraft] = useState<Record<string, string>>({});
  const [emptyByVid, setEmptyByVid] = useState<Record<string, number>>({});   // 빈박스 기록(empty_box_events) 기간 합계 — 정산과 같은 원천
  const fileRef = useRef<HTMLInputElement>(null);

  const loadPeriods = useCallback(async () => {
    const j = await fetch('/api/coupang/insight?periods=1').then(r => r.json()).catch(() => ({ periods: [] }));
    setNeedsMigration(!!j.needsMigration);
    const ps: Period[] = j.periods ?? [];
    setPeriods(ps);
    setSel(prev => prev && ps.some(p => p.period_from === prev.period_from && p.period_to === prev.period_to) ? prev : (ps[0] ?? null));
  }, []);
  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  // 기간 선택 → 인사이트 행 + 광고 raw 집계
  useEffect(() => {
    if (!sel) { setRows([]); setAds(null); return; }
    let cancelled = false; setLoading(true);
    (async () => {
      const j = await fetch(`/api/coupang/insight?from=${sel.period_from}&to=${sel.period_to}`).then(r => r.json()).catch(() => ({ rows: [] }));
      if (cancelled) return;
      setRows(j.rows ?? []); setEmptyDraft({});
      const eb = await fetch(`/api/empty-box?from=${sel.period_from}&to=${sel.period_to}`).then(r => r.json()).catch(() => ({ byVid: {} }));
      if (cancelled) return;
      setEmptyByVid(eb.byVid ?? {});
      const raw = await readLocalAdRows();
      if (cancelled) return;
      const from = sel.period_from.replace(/-/g, ''), to = sel.period_to.replace(/-/g, '');
      const agg = new Map<string, AdAgg>(); const days = new Set<string>();
      // 키워드 보고서('-' 비검색)가 있는 날의 비검색 일별 행('')은 중복 → 제외 (광고 분석·월 집계와 같은 규칙)
      const kwDates = new Set<string>();
      for (const r of raw) if (String(r['키워드'] ?? '').trim() === '-' && String(r['광고 노출 지면'] ?? '').trim() === '비검색 영역') kwDates.add(String(r['날짜'] ?? ''));
      const get = (k: string) => { let a = agg.get(k); if (!a) { a = { q1: 0, q14: 0, cost: 0, clicks: 0, rev14: 0 }; agg.set(k, a); } return a; };
      for (const r of raw) {
        const d = String(r['날짜'] ?? '').replace(/\D/g, '').slice(0, 8); if (d < from || d > to) continue;
        const kw = String(r['키워드'] ?? '').trim();
        if (kw === '' && String(r['광고 노출 지면'] ?? '').trim() === '비검색 영역' && kwDates.has(String(r['날짜'] ?? ''))) continue;
        days.add(d);
        const conv = String(r['광고전환매출발생 옵션ID'] ?? '').replace(/\.0$/, '').trim();
        const exec = String(r['광고집행 옵션ID'] ?? '').replace(/\.0$/, '').trim();
        if (conv) { const a = get(conv); a.q1 += Number(r['총 판매수량(1일)']) || 0; a.q14 += Number(r['총 판매수량(14일)']) || 0; a.rev14 += Number(r['총 전환매출액(14일)']) || 0; }
        // 광고비·클릭은 집행 옵션 기준 (전환 옵션과 다를 수 있음)
        if (exec || conv) { const e = get(exec || conv); e.cost += (Number(r['광고비']) || 0) * 1.1; e.clicks += Number(r['클릭수']) || 0; }
      }
      const missing: string[] = []; const s = new Date(sel.period_from), e = new Date(sel.period_to);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) { const k = ymd(d).replace(/-/g, ''); if (!days.has(k)) missing.push(ymd(d).slice(5)); }
      setAds(agg); setAdInfo({ rows: raw.length, days: days.size, missingDays: missing }); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sel]);

  // 표 행 (상품 / 상품×판매방식 / 옵션)
  type T = { key: string; name: string; sub: string; method: string; gross: number; cancel: number; empty: number; net: number; revenue: number; netRevenue: number; visitors: number; orders: number; ad: number; ad14: number; cost: number; rev14: number; unmatched: boolean; rowIds: { id: string; vid: string; empty: number; method: string }[] };
  const table = useMemo(() => {
    const m = new Map<string, T>();
    for (const r of rows) {
      const pname = r.sku?.product?.name ?? r.product_name ?? '(상품명 없음)';
      const opt = r.sku?.option_values ? Object.values(r.sku.option_values).filter(Boolean).join(' / ') : (r.option_name ?? '');
      const meth = methodLabel(r.sales_method);
      const pid = r.sku?.product?.id ?? `__${pname}`;
      const key = group === 'product' ? pid : group === 'method' ? `${pid}|${meth}` : r.vendor_item_id;
      let t = m.get(key);
      if (!t) { t = { key, name: pname, sub: group === 'option' ? `${opt || '기본'} · ${r.vendor_item_id}` : '', method: '', gross: 0, cancel: 0, empty: 0, net: 0, revenue: 0, netRevenue: 0, visitors: 0, orders: 0, ad: 0, ad14: 0, cost: 0, rev14: 0, unmatched: false, rowIds: [] }; m.set(key, t); }
      const gross = Number(r.gross_qty) || 0, cancel = Math.abs(Number(r.cancel_qty) || 0), empty = emptyByVid[r.vendor_item_id] ?? 0;
      const netQty = Math.max(0, gross - cancel - empty);
      const unit = r.qty > 0 ? r.revenue / r.qty : 0;   // 취소 반영 평균 단가
      t.gross += gross; t.cancel += cancel; t.empty += empty; t.net += netQty; t.revenue += r.revenue; t.netRevenue += Math.max(0, r.revenue - empty * unit); t.visitors += r.visitors; t.orders += r.orders;
      t.rowIds.push({ id: r.id, vid: r.vendor_item_id, empty, method: meth });
      if (!r.sku_id) t.unmatched = true;
      if (meth && !t.method.includes(meth)) t.method = t.method ? `${t.method}+${meth}` : meth;
      const a = ads?.get(r.vendor_item_id); if (a) { t.ad += a.q1; t.ad14 += a.q14; t.cost += a.cost; t.rev14 += a.rev14; }
    }
    const list = [...m.values()].map(t => { const adQ = basis === '1d' ? t.ad : t.ad14; const organic = Math.max(0, t.gross - adQ); return { ...t, adQ, organic, organicPct: t.gross > 0 ? (organic / t.gross) * 100 : null, roas: t.cost > 0 ? (t.netRevenue / t.cost) * 100 : null, adRate: t.netRevenue > 0 ? (t.cost / t.netRevenue) * 100 : null, cvr: t.visitors > 0 ? (t.orders / t.visitors) * 100 : null }; });
    return list.sort((a, b) => (a.name === b.name ? (a.method > b.method ? 1 : -1) : b.gross - a.gross));
  }, [rows, ads, group, basis, emptyByVid]);
  const tot = useMemo(() => table.reduce((s, t) => ({ gross: s.gross + t.gross, cancel: s.cancel + t.cancel, empty: s.empty + t.empty, net: s.net + t.net, ad: s.ad + t.adQ, revenue: s.revenue + t.revenue, netRevenue: s.netRevenue + t.netRevenue, cost: s.cost + t.cost, visitors: s.visitors + t.visitors, orders: s.orders + t.orders }), { gross: 0, cancel: 0, empty: 0, net: 0, ad: 0, revenue: 0, netRevenue: 0, cost: 0, visitors: 0, orders: 0 }), [table]);
  const orgTot = Math.max(0, tot.gross - tot.ad);
  // 판매방식별(통합·그로스·윙) 요약 — 보기 방식과 무관하게 원 행에서 직접 집계
  const byMethod = useMemo(() => {
    const out: Record<string, { gross: number; net: number; empty: number; ad: number; netRevenue: number; cost: number }> = {};
    const add = (k: string, r: Row) => {
      const o = out[k] ?? (out[k] = { gross: 0, net: 0, empty: 0, ad: 0, netRevenue: 0, cost: 0 });
      const gross = Number(r.gross_qty) || 0, cancel = Math.abs(Number(r.cancel_qty) || 0), empty = emptyByVid[r.vendor_item_id] ?? 0; const unit = r.qty > 0 ? r.revenue / r.qty : 0;
      o.gross += gross; o.net += Math.max(0, gross - cancel - empty); o.empty += empty; o.netRevenue += Math.max(0, r.revenue - empty * unit);
      const a = ads?.get(r.vendor_item_id); if (a) { o.ad += basis === '1d' ? a.q1 : a.q14; o.cost += a.cost; }
    };
    for (const r of rows) { add('통합', r); const m = methodLabel(r.sales_method); if (m) add(m, r); }
    return out;
  }, [rows, ads, basis, emptyByVid]);

  /** 빈박스 입력 → empty_box_events (기간 합계가 n 이 되도록 기간 마지막 날 기록). 정산 월 빈박스도 같이 갱신된다 */
  async function saveEmpty(vid: string, v: string) {
    if (!sel) return;
    const n = Math.max(0, Number(v.replace(/[^0-9]/g, '')) || 0);
    if ((emptyByVid[vid] ?? 0) === n) return;
    const r = await fetch('/api/empty-box', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period_from: sel.period_from, period_to: sel.period_to, vendor_item_id: vid, total: n }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error ?? '빈박스 저장 실패'); return; }
    setEmptyByVid(prev => ({ ...prev, [vid]: Number(j.total) || 0 }));
    const months = Object.keys(j.synced ?? {}).join(', ');
    toast.success(`빈박스 ${n}개 저장 — 정산 ${months} 빈박스도 같이 갱신됨`);
  }

  async function upload(f: File) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(uFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(uTo)) { toast.warning('리포트를 내려받을 때 설정한 기간(시작·끝)을 먼저 넣어 주세요'); return; }
    setUploading(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const rowsX = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as Record<string, unknown>[];
      const r = await fetch('/api/coupang/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period_from: uFrom, period_to: uTo, rows: rowsX, source: 'upload' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.error ?? '업로드 실패'); setNeedsMigration(!!j.needsMigration); return; }
      toast.success(`${uFrom}~${uTo} 저장: 옵션 ${j.saved}개 (SKU 연결 ${j.matched}, 미연결 ${j.unmatched}) · 판매 ${fmt(j.qty)}개`);
      await loadPeriods(); setSel({ period_from: uFrom, period_to: uTo, rows: j.saved, qty: j.qty, revenue: j.revenue, updated_at: '' });
    } catch (e) { toast.error(e instanceof Error ? e.message : '파일을 읽지 못했습니다'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function removePeriod(p: Period) {
    if (!(await confirmDialog(`${p.period_from}~${p.period_to} 리포트(${p.rows}행)를 지울까요?`))) return;
    const r = await fetch(`/api/coupang/insight?from=${p.period_from}&to=${p.period_to}`, { method: 'DELETE' });
    if (!r.ok) { toast.error('삭제 실패'); return; }
    toast.success('삭제됨'); loadPeriods();
  }

  const th = 'px-2 py-2 text-[11px] font-semibold text-fg-4 whitespace-nowrap text-right bg-card-2';
  const td = 'px-2 text-right tabular-nums';
  const kpis = [
    { l: '총 판매 (취소 전)', v: `${fmt(tot.gross)}개`, s: `취소 ${fmt(tot.cancel)} · 빈박스 ${fmt(tot.empty)}` },
    { l: '순판매', v: `${fmt(tot.net)}개`, s: `순매출 ${fmt(tot.netRevenue)}원`, hi: true },
    { l: `광고 판매 (${basis === '1d' ? '당일' : '14일'})`, v: `${fmt(tot.ad)}개`, s: pct(tot.gross ? (Math.min(tot.ad, tot.gross) / tot.gross) * 100 : null) + ' (총 판매 대비)' },
    { l: '오가닉 판매', v: `${fmt(orgTot)}개`, s: pct(tot.gross ? (orgTot / tot.gross) * 100 : null) + ' (총 판매 대비)', hi: true },
    { l: 'ROAS (순매출 ÷ 광고비)', v: pct(tot.cost ? (tot.netRevenue / tot.cost) * 100 : null), s: `광고비 ${fmt(tot.cost)}원 (VAT 포함) · 광고비율 ${pct(tot.netRevenue ? (tot.cost / tot.netRevenue) * 100 : null)}`, hi: true },
    { l: '방문자', v: fmt(tot.visitors), s: tot.visitors ? `구매전환 ${pct((tot.orders / tot.visitors) * 100)}` : '' },
  ];

  return (
    <div className="space-y-4">
      <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto">
            <h2 className="text-[15px] font-bold text-fg">오가닉 vs 광고 (쿠팡)</h2>
            <p className="text-[12px] text-fg-3 mt-0.5">윙 › 비즈니스 인사이트 › 엑셀 다운로드 › 기간 설정 › <b>상품별 판매 리포트</b>. 정산 입력의 쿠팡 매출 파일과 같은 파일이며, 정산에서 적용한 달은 여기에도 자동으로 들어옵니다. 파일에 기간이 없어 내려받을 때 설정한 기간을 같이 넣습니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={uFrom} onChange={e => setUFrom(e.target.value)} className="h-9 px-2 rounded-lg border border-line text-[12px]" title="리포트 기간 시작" />
            <span className="text-fg-5">~</span>
            <input type="date" value={uTo} onChange={e => setUTo(e.target.value)} className="h-9 px-2 rounded-lg border border-line text-[12px]" title="리포트 기간 끝" />
            <button onClick={() => { const y = new Date(); y.setDate(y.getDate() - 1); setUFrom(ymd(y)); setUTo(ymd(y)); }} className="text-[11px] text-brand hover:underline">어제</button>
            <button onClick={() => { const e = new Date(); e.setDate(e.getDate() - 1); const s = new Date(e); s.setDate(s.getDate() - 6); setUFrom(ymd(s)); setUTo(ymd(e)); }} className="text-[11px] text-brand hover:underline">최근 7일</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} 리포트 올리기</Button>
          </div>
        </div>
        {needsMigration && <p className="text-[12px] text-warn">coupang_insight_metrics 테이블이 없습니다. 마이그레이션 00072 를 적용해 주세요.</p>}
        {periods && periods.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-fg-4">저장된 기간</span>
            {periods.slice(0, 16).map(p => { const on = sel?.period_from === p.period_from && sel?.period_to === p.period_to; const label = p.period_from === p.period_to ? p.period_from.slice(5) : `${p.period_from.slice(5)}~${p.period_to.slice(5)}`;
              return <span key={`${p.period_from}|${p.period_to}`} className={cn('h-7 pl-2.5 pr-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1', on ? 'bg-brand text-white border-brand' : 'bg-card text-fg-3 border-line hover:bg-app')}>
                <button onClick={() => setSel(p)} title={`옵션 ${p.rows}개 · 판매 ${fmt(p.qty)}개 · 매출 ${fmt(p.revenue)}원 · ${p.updated_at.slice(0, 10)}`}>{label}</button>
                <button onClick={() => removePeriod(p)} className={cn('p-0.5 rounded', on ? 'hover:bg-white/20' : 'hover:text-danger')} title="삭제"><Trash2 className="h-3 w-3" /></button>
              </span>; })}
          </div>
        )}
        <div className="rounded-xl bg-app px-3 py-2 text-[11px] text-fg-3 leading-relaxed">
          <b className="text-fg">기준 (정산 앱 공통)</b> · 총 판매 = 인사이트 총 판매수(취소 전) · <b className="text-fg">순판매 = 총 판매 − 취소 − 빈박스(리뷰용 발송)</b> · 순매출 = 매출(취소 반영) − 빈박스 × 평균 단가 · 오가닉 = 총 판매 − 광고 전환 판매(광고 전환도 취소 전 주문 기준) · <b className="text-fg">ROAS = 순매출 ÷ 광고비(VAT 포함)</b> · 윙(판매자배송)과 그로스는 옵션ID 가 달라 따로 잡히고, 빈박스는 옵션 보기에서 윙 행에 적습니다. 빈박스는 한 번만 적으면 됩니다 — 여기 기록이 정산 월 빈박스(매입원가·빈박스 환불·재고 되돌리기)에 그대로 쓰입니다.
        </div>
      </section>

      {sel && (
        <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-5 py-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <div className="text-[13px] font-bold text-fg">{sel.period_from} ~ {sel.period_to}</div>
              <div className="text-[11px] text-fg-4">{adInfo ? `광고 raw ${adInfo.days}일치${adInfo.missingDays.length ? ` · 없는 날 ${adInfo.missingDays.join(', ')}` : ''}` : '광고 raw 읽는 중'}{adInfo && adInfo.rows === 0 ? ' — 이 PC 에 광고 raw 가 없습니다. 광고 분석 › 쿠팡에 보고서를 올리면 광고 판매가 채워집니다' : ''}</div>
            </div>
            <span className="text-[11px] text-fg-4">광고 판매 기준</span>
            <SegmentedControl items={[{ value: '1d', label: '당일 전환' }, { value: '14d', label: '14일 전환' }] as const} value={basis} onChange={setBasis} />
            <SegmentedControl items={[{ value: 'product', label: '상품' }, { value: 'method', label: '상품 × 윙/그로스' }, { value: 'option', label: '옵션 (빈박스 입력)' }] as const} value={group} onChange={setGroup} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {kpis.map(k => <div key={k.l} className={cn('rounded-xl border border-line px-3 py-2', k.hi && 'bg-brand-bg/50 border-brand/30')}><div className="text-[11px] text-fg-4">{k.l}</div><div className="text-[18px] font-bold text-fg tabular-nums">{k.v}</div><div className="text-[11px] text-fg-3">{k.s}</div></div>)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {['통합', '그로스', '윙'].map(m => { const v = byMethod[m]; const roas = v && v.cost ? (v.netRevenue / v.cost) * 100 : null; const org = v && v.gross ? (Math.max(0, v.gross - v.ad) / v.gross) * 100 : null;
              return <div key={m} className={cn('rounded-xl border px-3 py-2', m === '통합' ? 'border-brand/40 bg-brand-bg/40' : 'border-line')}>
                <div className="flex items-baseline gap-2"><span className="text-[12px] font-bold text-fg">{m} ROAS</span><span className={cn('text-[20px] font-bold tabular-nums', roas == null ? 'text-fg-5' : roas < 300 ? 'text-danger' : roas >= 500 ? 'text-success' : 'text-fg')}>{v ? pct(roas) : '-'}</span></div>
                {v ? <div className="text-[11px] text-fg-3 mt-0.5">순매출 {fmt(v.netRevenue)}원 ÷ 광고비 {fmt(v.cost)}원 · 순판매 {fmt(v.net)}개{v.empty ? ` (빈박스 ${fmt(v.empty)} 제외)` : ''} · 광고 {fmt(v.ad)} · 오가닉 {pct(org)}</div> : <div className="text-[11px] text-fg-5 mt-0.5">이 기간 {m} 판매 없음</div>}
              </div>; })}
          </div>
          <p className="text-[11px] text-fg-4">당일 전환은 광고 클릭 당일 판매만 잡아 오가닉이 조금 크게, 14일 전환은 기간 밖 판매까지 광고일에 붙어 오가닉이 작게 나옵니다. 광고 raw 의 전환 수는 보고서를 나중에 다시 내려받으면 늘어나므로(14일 귀속) 최신 보고서를 광고 분석에 다시 올려 두는 게 정확합니다.</p>

          {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div> : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-[12px] border-collapse min-w-[1100px]">
                <thead><tr className="h-9 border-b border-line">
                  <th className={cn(th, 'text-left sticky left-0')}>{group === 'option' ? '옵션' : '상품'}</th><th className={cn(th, 'text-left')}>판매방식</th>
                  <th className={th} title="총 판매수 (취소 전)">총 판매</th><th className={th}>취소</th><th className={th} title="리뷰용 빈박스 — 옵션 보기에서 입력">빈박스</th><th className={th} title="총 판매 − 취소 − 빈박스">순판매</th>
                  <th className={th}>광고 판매</th><th className={th}>오가닉</th><th className={th} title="오가닉 ÷ 총 판매">오가닉 비율</th>
                  <th className={th} title="매출(취소 반영) − 빈박스 × 평균 단가">순매출</th><th className={th}>광고비</th><th className={th} title="순매출 ÷ 광고비">ROAS</th><th className={th} title="광고비 ÷ 순매출">광고비율</th><th className={th}>방문자</th><th className={th}>구매전환</th>
                </tr></thead>
                <tbody>
                  {table.map(t => <tr key={t.key} className="h-9 border-b border-line-2 hover:bg-app/60">
                    <td className="px-2 sticky left-0 bg-card whitespace-nowrap"><div className="text-fg font-medium truncate max-w-[280px]" title={t.name}>{t.name}{t.unmatched && <span className="ml-1 text-[10px] text-warn" title="옵션ID 가 마스터에 없음 — 등록 큐에서 연결">미연결</span>}</div>{t.sub && <div className="text-[10px] text-fg-5 truncate max-w-[280px]">{t.sub}</div>}</td>
                    <td className={cn('px-2 whitespace-nowrap', t.method === '윙' ? 'text-warn' : 'text-fg-4')}>{t.method}</td>
                    <td className={cn(td, 'font-semibold')}>{fmt(t.gross)}</td>
                    <td className={cn(td, 'text-fg-4')}>{t.cancel ? fmt(t.cancel) : '-'}</td>
                    <td className="px-1">{group === 'option' && t.rowIds.length === 1 ? (
                      <input type="text" inputMode="numeric" value={emptyDraft[t.rowIds[0].vid] ?? (t.empty ? String(t.empty) : '')} placeholder="0"
                        onChange={e => setEmptyDraft(d => ({ ...d, [t.rowIds[0].vid]: e.target.value.replace(/[^0-9]/g, '') }))}
                        onBlur={e => saveEmpty(t.rowIds[0].vid, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
                        title={t.method === '윙' ? '윙(판매자배송) 리뷰용 빈박스 수량' : '그로스는 보통 0'}
                        className={cn('h-7 w-16 px-2 rounded-lg border text-right text-[12px] tabular-nums focus:outline-none focus:border-brand', t.method === '윙' ? 'border-warn/50 bg-warn/[0.06]' : 'border-line bg-card')} />
                    ) : <span className={cn(td, 'block', t.empty ? 'text-warn font-semibold' : 'text-fg-5')}>{t.empty ? fmt(t.empty) : '-'}</span>}</td>
                    <td className={cn(td, 'font-semibold text-fg')}>{fmt(t.net)}</td>
                    <td className={td}>{fmt(t.adQ)}</td>
                    <td className={td}>{fmt(t.organic)}</td>
                    <td className={cn(td, t.organicPct != null && t.organicPct < 20 ? 'text-warn' : t.organicPct != null && t.organicPct >= 50 ? 'text-success' : '')}>{pct(t.organicPct)}</td>
                    <td className={td}>{fmt(t.netRevenue)}</td>
                    <td className={cn(td, 'text-fg-3')}>{fmt(t.cost)}</td>
                    <td className={cn(td, 'font-semibold', t.roas != null && t.roas < 300 ? 'text-danger' : t.roas != null && t.roas >= 500 ? 'text-success' : '')}>{pct(t.roas)}</td>
                    <td className={cn(td, t.adRate != null && t.adRate > 30 ? 'text-danger' : '')}>{pct(t.adRate)}</td>
                    <td className={cn(td, 'text-fg-3')}>{fmt(t.visitors)}</td>
                    <td className={cn(td, 'text-fg-3')}>{pct(t.cvr)}</td>
                  </tr>)}
                  <tr className="h-9 font-semibold bg-card-2/60"><td className="px-2 sticky left-0 bg-card-2">합계 {table.length}</td><td />
                    <td className={td}>{fmt(tot.gross)}</td><td className={td}>{fmt(tot.cancel)}</td><td className={td}>{fmt(tot.empty)}</td><td className={td}>{fmt(tot.net)}</td>
                    <td className={td}>{fmt(tot.ad)}</td><td className={td}>{fmt(orgTot)}</td><td className={td}>{pct(tot.gross ? (orgTot / tot.gross) * 100 : null)}</td>
                    <td className={td}>{fmt(tot.netRevenue)}</td><td className={td}>{fmt(tot.cost)}</td><td className={td}>{pct(tot.cost ? (tot.netRevenue / tot.cost) * 100 : null)}</td><td className={td}>{pct(tot.netRevenue ? (tot.cost / tot.netRevenue) * 100 : null)}</td><td className={td}>{fmt(tot.visitors)}</td><td /></tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-fg-5">ROAS 색: 300% 미만 빨강(대부분 적자 구간), 500% 이상 초록. 상품별 손익분기는 정산 › 상품별 순이익의 손익분기 ROAS 를 보세요.</p>
        </section>
      )}
      {periods && periods.length === 0 && !needsMigration && <p className="text-[12px] text-fg-4 px-1">아직 올린 리포트가 없습니다. 위에서 기간을 넣고 파일을 올려 주세요.</p>}
    </div>
  );
}
