'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, History, Loader2, Lock, Plus, Trash2, Upload, X } from 'lucide-react';
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
 *  - 전체 ROAS = 순매출(오가닉 포함) ÷ 광고비(VAT 포함). 광고 ROAS = 광고 전환매출 ÷ 광고비 (쿠팡 광고센터 ROAS 와 같은 개념).
 *  - 윙(판매자배송)과 그로스는 옵션ID 가 달라 따로 집계되며, 빈박스는 윙 옵션 행에 적는다.
 *  - 빈박스 원천 = empty_box_events(날짜 × 옵션ID). 기간이 두 달에 걸치면 어느 달에 넣을지 고른다(정산 월 귀속).
 */
interface Period { period_from: string; period_to: string; rows: number; qty: number; revenue: number; updated_at: string }
interface Row { id: string; vendor_item_id: string; option_name: string | null; product_name: string | null; sales_method: string | null; revenue: number; orders: number; qty: number; gross_qty: number; cancel_qty: number; empty_qty?: number | null; visitors: number; views: number; sku_id: string | null; sku?: { sku_code: string; option_values?: Record<string, string> | null; product?: { id: string; name: string } | null } | null }
interface AdAgg { q1: number; q14: number; cost: number; clicks: number; imps: number; rev1: number; rev14: number }
interface EbEvent { id: string; date: string; vendor_item_id: string; qty: number; note: string | null }
type Basis = '1d' | '14d';
type Group = 'product' | 'method' | 'option';
type MethodFilter = 'all' | '그로스' | '윙';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pct = (n: number | null, d = 0) => n == null || !isFinite(n) ? '-' : `${n.toFixed(d)}%`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const methodLabel = (m: string | null) => m === '로켓그로스' ? '그로스' : m === '판매자배송' ? '윙' : (m ?? '');
const monthsBetween = (from: string, to: string) => { const out: string[] = []; let [y, m] = from.slice(0, 7).split('-').map(Number); const end = to.slice(0, 7); for (let i = 0; i < 36; i++) { const ym = `${y}-${String(m).padStart(2, '0')}`; out.push(ym); if (ym >= end) break; m += 1; if (m > 12) { m = 1; y += 1; } } return out; };
const lastDayOf = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };
const roasColor = (r: number | null) => r == null ? 'text-fg-5' : r < 300 ? 'text-danger' : r >= 500 ? 'text-success' : 'text-fg';

export default function OrganicPage() {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [sel, setSel] = useState<Period | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [ads, setAds] = useState<Map<string, AdAgg> | null>(null);
  const [adInfo, setAdInfo] = useState<{ rows: number; days: number; missingDays: string[]; hasRev1: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [basis, setBasis] = useState<Basis>('1d');
  const [group, setGroup] = useState<Group>('method');
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('all');
  const [uploading, setUploading] = useState(false);
  const [uFrom, setUFrom] = useState(''); const [uTo, setUTo] = useState('');
  const [emptyDraft, setEmptyDraft] = useState<Record<string, string>>({});
  const [emptyByVid, setEmptyByVid] = useState<Record<string, number>>({});   // 빈박스 기록(empty_box_events) 기간 합계 — 정산과 같은 원천
  const [ebEvents, setEbEvents] = useState<EbEvent[]>([]);
  const [ebClosed, setEbClosed] = useState<string[]>([]);                       // 기간이 걸친 달 중 정산 마감된 달
  const [ebMonth, setEbMonth] = useState<string>('');                           // 기간이 두 달에 걸칠 때 빈박스를 넣을 달
  const [recVid, setRecVid] = useState<string | null>(null);                    // 날짜별 기록 편집 중인 옵션
  const [recDraft, setRecDraft] = useState<{ date: string; qty: string }>({ date: '', qty: '' });
  const [showRules, setShowRules] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const spans = useMemo(() => sel ? monthsBetween(sel.period_from, sel.period_to) : [], [sel]);
  const multiMonth = spans.length > 1;
  const targetMonth = multiMonth ? (ebMonth || spans[spans.length - 1]) : (spans[0] ?? '');
  const targetDate = sel ? (multiMonth ? (lastDayOf(targetMonth) < sel.period_to ? lastDayOf(targetMonth) : sel.period_to) : sel.period_to) : '';
  const targetClosed = ebClosed.includes(targetMonth);

  const loadPeriods = useCallback(async () => {
    const j = await fetch('/api/coupang/insight?periods=1').then(r => r.json()).catch(() => ({ periods: [] }));
    setNeedsMigration(!!j.needsMigration);
    const ps: Period[] = j.periods ?? [];
    setPeriods(ps);
    setSel(prev => prev && ps.some(p => p.period_from === prev.period_from && p.period_to === prev.period_to) ? prev : (ps[0] ?? null));
  }, []);
  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  const loadEmpty = useCallback(async (p: Period) => {
    const eb = await fetch(`/api/empty-box?from=${p.period_from}&to=${p.period_to}`).then(r => r.json()).catch(() => ({ byVid: {}, events: [], closed: [] }));
    setEmptyByVid(eb.byVid ?? {}); setEbEvents(eb.events ?? []); setEbClosed(eb.closed ?? []);
  }, []);

  // 기간 선택 → 인사이트 행 + 빈박스 기록 + 광고 raw 집계
  useEffect(() => {
    if (!sel) { setRows([]); setAds(null); return; }
    let cancelled = false; setLoading(true); setEbMonth(''); setRecVid(null);
    (async () => {
      const j = await fetch(`/api/coupang/insight?from=${sel.period_from}&to=${sel.period_to}`).then(r => r.json()).catch(() => ({ rows: [] }));
      if (cancelled) return;
      setRows(j.rows ?? []); setEmptyDraft({});
      await loadEmpty(sel);
      if (cancelled) return;
      const raw = await readLocalAdRows();
      if (cancelled) return;
      const from = sel.period_from.replace(/-/g, ''), to = sel.period_to.replace(/-/g, '');
      const agg = new Map<string, AdAgg>(); const days = new Set<string>(); let hasRev1 = false;
      // 키워드 보고서('-' 비검색)가 있는 날의 비검색 일별 행('')은 중복 → 제외 (광고 분석·월 집계와 같은 규칙)
      const kwDates = new Set<string>();
      for (const r of raw) if (String(r['키워드'] ?? '').trim() === '-' && String(r['광고 노출 지면'] ?? '').trim() === '비검색 영역') kwDates.add(String(r['날짜'] ?? ''));
      const get = (k: string) => { let a = agg.get(k); if (!a) { a = { q1: 0, q14: 0, cost: 0, clicks: 0, imps: 0, rev1: 0, rev14: 0 }; agg.set(k, a); } return a; };
      for (const r of raw) {
        const d = String(r['날짜'] ?? '').replace(/\D/g, '').slice(0, 8); if (d < from || d > to) continue;
        const kw = String(r['키워드'] ?? '').trim();
        if (kw === '' && String(r['광고 노출 지면'] ?? '').trim() === '비검색 영역' && kwDates.has(String(r['날짜'] ?? ''))) continue;
        days.add(d);
        if ('총 전환매출액(1일)' in r) hasRev1 = true;
        const conv = String(r['광고전환매출발생 옵션ID'] ?? '').replace(/\.0$/, '').trim();
        const exec = String(r['광고집행 옵션ID'] ?? '').replace(/\.0$/, '').trim();
        if (conv) { const a = get(conv); a.q1 += Number(r['총 판매수량(1일)']) || 0; a.q14 += Number(r['총 판매수량(14일)']) || 0; a.rev1 += Number(r['총 전환매출액(1일)']) || 0; a.rev14 += Number(r['총 전환매출액(14일)']) || 0; }
        // 광고비·노출·클릭은 집행 옵션 기준 (전환 옵션과 다를 수 있음)
        if (exec || conv) { const e = get(exec || conv); e.cost += (Number(r['광고비']) || 0) * 1.1; e.clicks += Number(r['클릭수']) || 0; e.imps += Number(r['노출수']) || 0; }
      }
      const missing: string[] = []; const s = new Date(sel.period_from), e = new Date(sel.period_to);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) { const k = ymd(d).replace(/-/g, ''); if (!days.has(k)) missing.push(ymd(d).slice(5)); }
      setAds(agg); setAdInfo({ rows: raw.length, days: days.size, missingDays: missing, hasRev1 }); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sel, loadEmpty]);

  // 판매방식 필터 (전체 / 그로스만 / 윙만) — 표·합계·KPI 에 적용
  const vrows = useMemo(() => methodFilter === 'all' ? rows : rows.filter(r => methodLabel(r.sales_method) === methodFilter), [rows, methodFilter]);
  const useRev1 = basis === '1d' && !!adInfo?.hasRev1;

  // 표 행 (상품 / 상품×판매방식 / 옵션)
  type T = { key: string; name: string; sub: string; method: string; gross: number; cancel: number; empty: number; net: number; revenue: number; netRevenue: number; visitors: number; orders: number; ad: number; ad14: number; cost: number; clicks: number; imps: number; rev1: number; rev14: number; unmatched: boolean; rowIds: { id: string; vid: string; empty: number; method: string }[] };
  const table = useMemo(() => {
    const m = new Map<string, T>();
    for (const r of vrows) {
      const pname = r.sku?.product?.name ?? r.product_name ?? '(상품명 없음)';
      const opt = r.sku?.option_values ? Object.values(r.sku.option_values).filter(Boolean).join(' / ') : (r.option_name ?? '');
      const meth = methodLabel(r.sales_method);
      const pid = r.sku?.product?.id ?? `__${pname}`;
      const key = group === 'product' ? pid : group === 'method' ? `${pid}|${meth}` : r.vendor_item_id;
      let t = m.get(key);
      if (!t) { t = { key, name: pname, sub: group === 'option' ? `${opt || '기본'} · ${r.vendor_item_id}` : '', method: '', gross: 0, cancel: 0, empty: 0, net: 0, revenue: 0, netRevenue: 0, visitors: 0, orders: 0, ad: 0, ad14: 0, cost: 0, clicks: 0, imps: 0, rev1: 0, rev14: 0, unmatched: false, rowIds: [] }; m.set(key, t); }
      const gross = Number(r.gross_qty) || 0, cancel = Math.abs(Number(r.cancel_qty) || 0), empty = emptyByVid[r.vendor_item_id] ?? 0;
      const netQty = Math.max(0, gross - cancel - empty);
      const unit = r.qty > 0 ? r.revenue / r.qty : 0;   // 취소 반영 평균 단가
      t.gross += gross; t.cancel += cancel; t.empty += empty; t.net += netQty; t.revenue += r.revenue; t.netRevenue += Math.max(0, r.revenue - empty * unit); t.visitors += r.visitors; t.orders += r.orders;
      t.rowIds.push({ id: r.id, vid: r.vendor_item_id, empty, method: meth });
      if (!r.sku_id) t.unmatched = true;
      if (meth && !t.method.includes(meth)) t.method = t.method ? `${t.method}+${meth}` : meth;
      const a = ads?.get(r.vendor_item_id); if (a) { t.ad += a.q1; t.ad14 += a.q14; t.cost += a.cost; t.clicks += a.clicks; t.imps += a.imps; t.rev1 += a.rev1; t.rev14 += a.rev14; }
    }
    const list = [...m.values()].map(t => {
      const adQ = basis === '1d' ? t.ad : t.ad14; const organic = Math.max(0, t.gross - adQ); const adRev = useRev1 ? t.rev1 : t.rev14;
      return { ...t, adQ, organic, adRev, organicPct: t.gross > 0 ? (organic / t.gross) * 100 : null, roas: t.cost > 0 ? (t.netRevenue / t.cost) * 100 : null, adRoas: t.cost > 0 ? (adRev / t.cost) * 100 : null, adRate: t.netRevenue > 0 ? (t.cost / t.netRevenue) * 100 : null, ctr: t.imps > 0 ? (t.clicks / t.imps) * 100 : null, cvr: t.visitors > 0 ? (t.orders / t.visitors) * 100 : null };
    });
    return list.sort((a, b) => (a.name === b.name ? (a.method > b.method ? 1 : -1) : b.gross - a.gross));
  }, [vrows, ads, group, basis, emptyByVid, useRev1]);
  const tot = useMemo(() => table.reduce((s, t) => ({ gross: s.gross + t.gross, cancel: s.cancel + t.cancel, empty: s.empty + t.empty, net: s.net + t.net, ad: s.ad + t.adQ, revenue: s.revenue + t.revenue, netRevenue: s.netRevenue + t.netRevenue, cost: s.cost + t.cost, clicks: s.clicks + t.clicks, imps: s.imps + t.imps, adRev: s.adRev + t.adRev, visitors: s.visitors + t.visitors, orders: s.orders + t.orders }), { gross: 0, cancel: 0, empty: 0, net: 0, ad: 0, revenue: 0, netRevenue: 0, cost: 0, clicks: 0, imps: 0, adRev: 0, visitors: 0, orders: 0 }), [table]);
  const orgTot = Math.max(0, tot.gross - tot.ad);
  const totRoas = tot.cost ? (tot.netRevenue / tot.cost) * 100 : null;
  const totAdRoas = tot.cost ? (tot.adRev / tot.cost) * 100 : null;

  // 판매방식별(통합·그로스·윙) 요약 — 필터·보기 방식과 무관하게 원 행에서 직접 집계
  const byMethod = useMemo(() => {
    const out: Record<string, { gross: number; net: number; empty: number; ad: number; netRevenue: number; adRev: number; cost: number }> = {};
    const add = (k: string, r: Row) => {
      const o = out[k] ?? (out[k] = { gross: 0, net: 0, empty: 0, ad: 0, netRevenue: 0, adRev: 0, cost: 0 });
      const gross = Number(r.gross_qty) || 0, cancel = Math.abs(Number(r.cancel_qty) || 0), empty = emptyByVid[r.vendor_item_id] ?? 0; const unit = r.qty > 0 ? r.revenue / r.qty : 0;
      o.gross += gross; o.net += Math.max(0, gross - cancel - empty); o.empty += empty; o.netRevenue += Math.max(0, r.revenue - empty * unit);
      const a = ads?.get(r.vendor_item_id); if (a) { o.ad += basis === '1d' ? a.q1 : a.q14; o.cost += a.cost; o.adRev += useRev1 ? a.rev1 : a.rev14; }
    };
    for (const r of rows) { add('통합', r); const m = methodLabel(r.sales_method); if (m) add(m, r); }
    return out;
  }, [rows, ads, basis, emptyByVid, useRev1]);

  const afterEmptyChange = (synced: Record<string, { skipped?: string }> | undefined) => {
    if (!sel) return;
    loadEmpty(sel);
    const ms = Object.entries(synced ?? {}); const done = ms.filter(([, v]) => !v.skipped).map(([k]) => k); const skipped = ms.filter(([, v]) => v.skipped).map(([k]) => k);
    return `${done.length ? `정산 ${done.join(', ')} 빈박스 갱신` : ''}${skipped.length ? ` · ${skipped.join(', ')} 은 마감이라 건너뜀` : ''}`;
  };

  /** 빈박스 입력 → empty_box_events (기간 합계가 n 이 되도록 targetDate 기록 조정). 정산 월 빈박스도 같이 갱신된다 */
  async function saveEmpty(vid: string, v: string) {
    if (!sel) return;
    const n = Math.max(0, Number(v.replace(/[^0-9]/g, '')) || 0);
    const cur = emptyByVid[vid] ?? 0;
    if (cur === n) return;
    if (n < cur && !(await confirmDialog(`빈박스는 보통 늘어나기만 합니다. ${cur}개 → ${n}개로 줄일까요?\n잘못 넣은 수량을 고칠 때만 줄이세요. 정산 ${targetMonth} 매입원가·재고도 같이 바뀝니다.`))) { setEmptyDraft(d => { const x = { ...d }; delete x[vid]; return x; }); return; }
    const r = await fetch('/api/empty-box', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period_from: sel.period_from, period_to: sel.period_to, vendor_item_id: vid, total: n, date: targetDate }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error ?? '빈박스 저장 실패'); setEmptyDraft(d => { const x = { ...d }; delete x[vid]; return x; }); return; }
    setEmptyDraft(d => { const x = { ...d }; delete x[vid]; return x; });
    toast.success(`빈박스 ${n}개 저장 (${j.date} 기록) — ${afterEmptyChange(j.synced)}`);
  }
  /** 날짜별 기록 하나 추가/수정 (POST) */
  async function saveRecord(vid: string, date: string, qtyStr: string) {
    const qty = Math.max(0, Number(qtyStr.replace(/[^0-9]/g, '')) || 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast.warning('날짜를 넣어 주세요'); return; }
    if (sel && (date < sel.period_from || date > sel.period_to) && !(await confirmDialog(`${date} 는 지금 보는 기간(${sel.period_from}~${sel.period_to}) 밖입니다. 그래도 기록할까요? (이 화면 합계에는 안 보입니다)`))) return;
    const r = await fetch('/api/empty-box', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, vendor_item_id: vid, qty }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error ?? '기록 저장 실패'); return; }
    setRecDraft({ date: '', qty: '' });
    toast.success(`${date} 빈박스 ${qty}개 기록 — ${afterEmptyChange(j.synced)}`);
  }
  async function deleteRecord(ev: EbEvent) {
    if (!(await confirmDialog(`${ev.date} 빈박스 ${ev.qty}개 기록을 지울까요?`))) return;
    const r = await fetch(`/api/empty-box?id=${ev.id}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error ?? '삭제 실패'); return; }
    toast.success(`기록 삭제 — ${afterEmptyChange(j.synced)}`);
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
  const basisLabel = basis === '1d' ? '당일' : '14일';
  const filterLabel = methodFilter === 'all' ? '윙+그로스' : `${methodFilter}만`;
  const salesKpis = [
    { l: '총 판매 (취소 전)', v: `${fmt(tot.gross)}개`, s: `취소 ${fmt(tot.cancel)} · 빈박스 ${fmt(tot.empty)}` },
    { l: '순판매', v: `${fmt(tot.net)}개`, s: `순매출 ${fmt(tot.netRevenue)}원`, hi: true },
    { l: `광고 판매 (${basisLabel} 전환)`, v: `${fmt(tot.ad)}개`, s: `총 판매의 ${pct(tot.gross ? (Math.min(tot.ad, tot.gross) / tot.gross) * 100 : null)}` },
    { l: '오가닉 판매', v: `${fmt(orgTot)}개`, s: `총 판매의 ${pct(tot.gross ? (orgTot / tot.gross) * 100 : null)}`, hi: true },
  ];
  const adKpis = [
    { l: '광고비 (VAT 포함)', v: `${fmt(tot.cost)}원`, s: `순매출 대비 ${pct(tot.netRevenue ? (tot.cost / tot.netRevenue) * 100 : null)}` },
    { l: '전체 ROAS', v: pct(totRoas), s: '순매출(오가닉 포함) ÷ 광고비', hi: true, c: roasColor(totRoas) },
    { l: `광고 ROAS (${useRev1 ? '당일' : '14일'})`, v: pct(totAdRoas), s: `광고 전환매출 ${fmt(tot.adRev)}원 ÷ 광고비`, hi: true, c: roasColor(totAdRoas) },
    { l: '노출 → 클릭', v: `${fmt(tot.imps)} → ${fmt(tot.clicks)}`, s: `클릭률 ${pct(tot.imps ? (tot.clicks / tot.imps) * 100 : null, 2)}` },
    { l: '방문자 (인사이트)', v: fmt(tot.visitors), s: tot.visitors ? `구매전환 ${pct((tot.orders / tot.visitors) * 100, 1)}` : '' },
  ];
  const Kpi = ({ k }: { k: { l: string; v: string; s: string; hi?: boolean; c?: string } }) => (
    <div className={cn('rounded-xl border border-line px-3 py-2.5 min-w-0', k.hi && 'bg-brand-bg/50 border-brand/30')}>
      <div className="text-[11px] text-fg-4 truncate">{k.l}</div>
      <div className={cn('text-[18px] font-bold tabular-nums leading-tight mt-0.5 truncate', k.c ?? 'text-fg')}>{k.v}</div>
      <div className="text-[11px] text-fg-3 truncate">{k.s}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* ── 리포트 올리기 / 기간 고르기 ── */}
      <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="text-[15px] font-bold text-fg">오가닉 vs 광고 (쿠팡)</h2>
            <p className="text-[12px] text-fg-3 mt-0.5">윙 › 비즈니스 인사이트 › 엑셀 다운로드 › <b>상품별 판매 리포트</b>를 기간과 함께 올립니다. 정산에서 적용한 달은 자동으로 들어옵니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-app px-3 py-2">
            <span className="text-[11px] font-semibold text-fg-4">리포트 기간</span>
            <input type="date" value={uFrom} onChange={e => setUFrom(e.target.value)} className="h-8 px-2 rounded-lg border border-line bg-card text-[12px]" title="리포트 기간 시작" />
            <span className="text-fg-5">~</span>
            <input type="date" value={uTo} onChange={e => setUTo(e.target.value)} className="h-8 px-2 rounded-lg border border-line bg-card text-[12px]" title="리포트 기간 끝" />
            <button onClick={() => { const y = new Date(); y.setDate(y.getDate() - 1); setUFrom(ymd(y)); setUTo(ymd(y)); }} className="text-[11px] text-brand hover:underline">어제</button>
            <button onClick={() => { const e = new Date(); e.setDate(e.getDate() - 1); const s = new Date(e); s.setDate(s.getDate() - 6); setUFrom(ymd(s)); setUTo(ymd(e)); }} className="text-[11px] text-brand hover:underline">최근 7일</button>
            <button onClick={() => { const n = new Date(); const s = new Date(n.getFullYear(), n.getMonth(), 1); const e = new Date(n); e.setDate(e.getDate() - 1); setUFrom(ymd(s)); setUTo(ymd(e < s ? s : e)); }} className="text-[11px] text-brand hover:underline">이번 달</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} 리포트 올리기</Button>
          </div>
        </div>
        {needsMigration && <p className="text-[12px] text-warn">coupang_insight_metrics 테이블이 없습니다. 마이그레이션 00072 를 적용해 주세요.</p>}
        {periods && periods.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-fg-4 mr-1">저장된 기간</span>
            {periods.slice(0, 16).map(p => { const on = sel?.period_from === p.period_from && sel?.period_to === p.period_to; const label = p.period_from === p.period_to ? p.period_from.slice(5) : `${p.period_from.slice(5)}~${p.period_to.slice(5)}`;
              return <span key={`${p.period_from}|${p.period_to}`} className={cn('h-7 pl-2.5 pr-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1', on ? 'bg-brand text-white border-brand' : 'bg-card text-fg-3 border-line hover:bg-app')}>
                <button onClick={() => setSel(p)} title={`옵션 ${p.rows}개 · 판매 ${fmt(p.qty)}개 · 매출 ${fmt(p.revenue)}원 · ${p.updated_at.slice(0, 10)}`}>{label}</button>
                <button onClick={() => removePeriod(p)} className={cn('p-0.5 rounded', on ? 'hover:bg-white/20' : 'hover:text-danger')} title="삭제"><Trash2 className="h-3 w-3" /></button>
              </span>; })}
            <span className="text-[11px] text-fg-5 ml-1">같은 기간을 다시 올리면 새 파일로 교체됩니다. 시작·끝이 다르면 별개 기간입니다.</span>
          </div>
        )}
        <button onClick={() => setShowRules(v => !v)} className="flex items-center gap-1 text-[11px] text-fg-4 hover:text-fg">
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showRules && 'rotate-180')} /> 계산 기준 보기
        </button>
        {showRules && (
          <div className="rounded-xl bg-app px-3 py-2.5 text-[11px] text-fg-3 leading-relaxed grid gap-1 md:grid-cols-2">
            <div><b className="text-fg">총 판매</b> = 인사이트 총 판매수(취소 전)</div>
            <div><b className="text-fg">순판매</b> = 총 판매 − 취소 − 빈박스(리뷰용 발송)</div>
            <div><b className="text-fg">순매출</b> = 매출(취소 반영) − 빈박스 × 평균 단가</div>
            <div><b className="text-fg">오가닉</b> = 총 판매 − 광고 전환 판매 (광고 전환도 취소 전 주문 기준)</div>
            <div><b className="text-fg">전체 ROAS</b> = 순매출(오가닉 포함) ÷ 광고비(VAT 포함) — 광고가 가게 전체에 만든 효율</div>
            <div><b className="text-fg">광고 ROAS</b> = 광고 전환매출 ÷ 광고비 — 쿠팡 광고센터의 ROAS 와 같은 개념</div>
            <div><b className="text-fg">노출·클릭</b> = 광고 raw 의 노출수·클릭수 (집행 옵션 기준)</div>
            <div><b className="text-fg">빈박스</b> — 옵션 보기의 윙 행에 적습니다. 여기 기록이 정산 월 빈박스(매입원가·재고 되돌리기)에 그대로 쓰이므로 한 번만 적으면 됩니다. 기간이 두 달에 걸치면 넣을 달을 고릅니다.</div>
            <div className="md:col-span-2">당일 전환은 광고 클릭 당일 판매만 잡아 오가닉이 조금 크게, 14일 전환은 기간 밖 판매까지 광고일에 붙어 오가닉이 작게 나옵니다. 14일 귀속은 보고서를 나중에 다시 내려받아야 채워지므로 최신 보고서를 광고 분석에 다시 올려 두는 게 정확합니다.</div>
          </div>
        )}
      </section>

      {sel && (
        <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-5 py-4 space-y-4">
          {/* ── 기간 + 보기 조작 ── */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="mr-auto">
              <div className="text-[14px] font-bold text-fg">{sel.period_from} ~ {sel.period_to} <span className="text-[12px] font-semibold text-fg-4 ml-1">{filterLabel}</span></div>
              <div className="text-[11px] text-fg-4">{adInfo ? `광고 raw ${adInfo.days}일치${adInfo.missingDays.length ? ` · 없는 날 ${adInfo.missingDays.join(', ')}` : ''}` : '광고 raw 읽는 중'}{adInfo && adInfo.rows === 0 ? ' — 이 PC 에 광고 raw 가 없습니다. 광고 분석 › 쿠팡에 보고서를 올리면 광고 판매가 채워집니다' : ''}{ebClosed.length ? ` · 🔒 ${ebClosed.join(', ')} 정산 마감` : ''}</div>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-fg-4">판매방식
              <SegmentedControl items={[{ value: 'all', label: '전체' }, { value: '그로스', label: '그로스만' }, { value: '윙', label: '윙만' }] as const} value={methodFilter} onChange={setMethodFilter} />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-fg-4">광고 판매 기준
              <SegmentedControl items={[{ value: '1d', label: '당일 전환' }, { value: '14d', label: '14일 전환' }] as const} value={basis} onChange={setBasis} />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-fg-4">보기
              <SegmentedControl items={[{ value: 'product', label: '상품' }, { value: 'method', label: '상품 × 윙/그로스' }, { value: 'option', label: '옵션 (빈박스 입력)' }] as const} value={group} onChange={setGroup} />
            </label>
          </div>

          {/* ── KPI ── */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-fg-4">판매 · {filterLabel}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">{salesKpis.map(k => <Kpi key={k.l} k={k} />)}</div>
            <div className="text-[11px] font-semibold text-fg-4 pt-1">광고 · 유입</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">{adKpis.map(k => <Kpi key={k.l} k={k} />)}</div>
          </div>

          {/* ── 통합 / 그로스 / 윙 요약 ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {['통합', '그로스', '윙'].map(m => { const v = byMethod[m]; const roas = v && v.cost ? (v.netRevenue / v.cost) * 100 : null; const adRoas = v && v.cost ? (v.adRev / v.cost) * 100 : null; const org = v && v.gross ? (Math.max(0, v.gross - v.ad) / v.gross) * 100 : null; const active = methodFilter === 'all' ? m === '통합' : methodFilter === m;
              return <div key={m} className={cn('rounded-xl border px-3 py-2.5', active ? 'border-brand/40 bg-brand-bg/40' : 'border-line')}>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-[12px] font-bold text-fg w-10">{m}</span>
                  <span className="text-[11px] text-fg-4">전체 ROAS <b className={cn('text-[18px] tabular-nums', roasColor(roas))}>{v ? pct(roas) : '-'}</b></span>
                  <span className="text-[11px] text-fg-4">광고 ROAS <b className={cn('text-[18px] tabular-nums', roasColor(adRoas))}>{v ? pct(adRoas) : '-'}</b></span>
                </div>
                {v ? <div className="text-[11px] text-fg-3 mt-0.5">순매출 {fmt(v.netRevenue)}원 · 광고비 {fmt(v.cost)}원 · 순판매 {fmt(v.net)}개{v.empty ? ` (빈박스 ${fmt(v.empty)} 제외)` : ''} · 광고 {fmt(v.ad)} · 오가닉 {pct(org)}</div> : <div className="text-[11px] text-fg-5 mt-0.5">이 기간 {m} 판매 없음</div>}
              </div>; })}
          </div>

          {/* ── 빈박스 입력 안내 (옵션 보기) ── */}
          {group === 'option' && (
            <div className="rounded-xl bg-warn/[0.06] border border-warn/30 px-3 py-2 text-[11px] text-fg-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <b className="text-fg">빈박스 입력</b>
              <span>윙 행의 칸에 이 기간 합계를 적고 Enter. 날짜별로 나눠 적거나 지우려면 <History className="inline h-3 w-3" /> 기록.</span>
              {multiMonth && <label className="flex items-center gap-1">넣을 달
                <select value={targetMonth} onChange={e => setEbMonth(e.target.value)} className="h-7 px-1.5 rounded-lg border border-line bg-card text-[11px]">{spans.map(ym => <option key={ym} value={ym}>{ym}{ebClosed.includes(ym) ? ' 🔒' : ''}</option>)}</select>
                <span className="text-fg-5">→ {targetDate} 기록</span>
              </label>}
              {!multiMonth && <span className="text-fg-5">{targetDate} 날짜로 기록 → 정산 {targetMonth}</span>}
              {targetClosed && <span className="text-danger flex items-center gap-1"><Lock className="h-3 w-3" /> {targetMonth} 은 정산 마감이라 입력할 수 없습니다. 정산에서 해제 후 고치세요.</span>}
            </div>
          )}

          {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div> : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-[12px] border-collapse min-w-[1350px]">
                <thead><tr className="h-9 border-b border-line">
                  <th className={cn(th, 'text-left sticky left-0')}>{group === 'option' ? '옵션' : '상품'}</th><th className={cn(th, 'text-left')}>판매방식</th>
                  <th className={th} title="총 판매수 (취소 전)">총 판매</th><th className={th}>취소</th><th className={th} title="리뷰용 빈박스 — 옵션 보기에서 입력">빈박스</th><th className={th} title="총 판매 − 취소 − 빈박스">순판매</th>
                  <th className={th} title={`광고 전환 판매 (${basisLabel})`}>광고 판매</th><th className={th}>오가닉</th><th className={th} title="오가닉 ÷ 총 판매">오가닉 비율</th>
                  <th className={th} title="매출(취소 반영) − 빈박스 × 평균 단가">순매출</th><th className={th} title="VAT 포함">광고비</th>
                  <th className={th} title="순매출(오가닉 포함) ÷ 광고비">전체 ROAS</th><th className={th} title="광고 전환매출 ÷ 광고비 (광고센터 ROAS)">광고 ROAS</th><th className={th} title="광고비 ÷ 순매출">광고비율</th>
                  <th className={th}>노출</th><th className={th}>클릭</th><th className={th} title="클릭 ÷ 노출">클릭률</th><th className={th}>방문자</th><th className={th}>구매전환</th>
                </tr></thead>
                <tbody>
                  {table.map(t => { const one = group === 'option' && t.rowIds.length === 1 ? t.rowIds[0] : null; const evs = one ? ebEvents.filter(e => e.vendor_item_id === one.vid) : [];
                    return [
                    <tr key={t.key} className="h-9 border-b border-line-2 hover:bg-app/60">
                      <td className="px-2 sticky left-0 bg-card whitespace-nowrap"><div className="text-fg font-medium truncate max-w-[280px]" title={t.name}>{t.name}{t.unmatched && <span className="ml-1 text-[10px] text-warn" title="옵션ID 가 마스터에 없음 — 등록 큐에서 연결">미연결</span>}</div>{t.sub && <div className="text-[10px] text-fg-5 truncate max-w-[280px]">{t.sub}</div>}</td>
                      <td className={cn('px-2 whitespace-nowrap', t.method === '윙' ? 'text-warn' : 'text-fg-4')}>{t.method}</td>
                      <td className={cn(td, 'font-semibold')}>{fmt(t.gross)}</td>
                      <td className={cn(td, 'text-fg-4')}>{t.cancel ? fmt(t.cancel) : '-'}</td>
                      <td className="px-1 whitespace-nowrap">{one ? (
                        <span className="inline-flex items-center gap-1">
                          <input type="text" inputMode="numeric" value={emptyDraft[one.vid] ?? (t.empty ? String(t.empty) : '')} placeholder="0" disabled={targetClosed}
                            onChange={e => setEmptyDraft(d => ({ ...d, [one.vid]: e.target.value.replace(/[^0-9]/g, '') }))}
                            onBlur={e => saveEmpty(one.vid, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
                            title={targetClosed ? `${targetMonth} 정산 마감` : t.method === '윙' ? '윙(판매자배송) 리뷰용 빈박스 — 이 기간 합계' : '그로스는 보통 0'}
                            className={cn('h-7 w-14 px-2 rounded-lg border text-right text-[12px] tabular-nums focus:outline-none focus:border-brand disabled:opacity-50', t.method === '윙' ? 'border-warn/50 bg-warn/[0.06]' : 'border-line bg-card')} />
                          <button onClick={() => { setRecVid(v => v === one.vid ? null : one.vid); setRecDraft({ date: targetDate, qty: '' }); }} className={cn('p-1 rounded-md hover:bg-app', recVid === one.vid ? 'text-brand' : evs.length ? 'text-fg-3' : 'text-fg-5')} title={`날짜별 기록 ${evs.length}건 보기·고치기`}><History className="h-3.5 w-3.5" /></button>
                        </span>
                      ) : <span className={cn(td, 'block', t.empty ? 'text-warn font-semibold' : 'text-fg-5')}>{t.empty ? fmt(t.empty) : '-'}</span>}</td>
                      <td className={cn(td, 'font-semibold text-fg')}>{fmt(t.net)}</td>
                      <td className={td}>{fmt(t.adQ)}</td>
                      <td className={td}>{fmt(t.organic)}</td>
                      <td className={cn(td, t.organicPct != null && t.organicPct < 20 ? 'text-warn' : t.organicPct != null && t.organicPct >= 50 ? 'text-success' : '')}>{pct(t.organicPct)}</td>
                      <td className={td}>{fmt(t.netRevenue)}</td>
                      <td className={cn(td, 'text-fg-3')}>{fmt(t.cost)}</td>
                      <td className={cn(td, 'font-semibold', roasColor(t.roas))}>{pct(t.roas)}</td>
                      <td className={cn(td, 'font-semibold', roasColor(t.adRoas))}>{pct(t.adRoas)}</td>
                      <td className={cn(td, t.adRate != null && t.adRate > 30 ? 'text-danger' : '')}>{pct(t.adRate)}</td>
                      <td className={cn(td, 'text-fg-3')}>{t.imps ? fmt(t.imps) : '-'}</td>
                      <td className={cn(td, 'text-fg-3')}>{t.clicks ? fmt(t.clicks) : '-'}</td>
                      <td className={cn(td, 'text-fg-3')}>{pct(t.ctr, 2)}</td>
                      <td className={cn(td, 'text-fg-3')}>{fmt(t.visitors)}</td>
                      <td className={cn(td, 'text-fg-3')}>{pct(t.cvr, 1)}</td>
                    </tr>,
                    one && recVid === one.vid ? (
                      <tr key={`${t.key}|rec`} className="border-b border-line-2 bg-app/40">
                        <td colSpan={19} className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]">
                            <span className="font-semibold text-fg flex items-center gap-1"><History className="h-3.5 w-3.5" /> {t.name} · 빈박스 날짜별 기록</span>
                            {evs.length === 0 && <span className="text-fg-5">이 기간에 기록 없음</span>}
                            {evs.map(ev => { const closed = ebClosed.includes(ev.date.slice(0, 7));
                              return <span key={ev.id} className="inline-flex items-center gap-1 h-7 pl-2 pr-1 rounded-lg border border-line bg-card tabular-nums">
                                {ev.date} <b>{ev.qty}</b>개
                                {closed ? <Lock className="h-3 w-3 text-fg-5 ml-0.5" /> : <button onClick={() => deleteRecord(ev)} className="p-0.5 rounded hover:text-danger" title="이 기록 삭제"><X className="h-3 w-3" /></button>}
                              </span>; })}
                            <span className="inline-flex items-center gap-1.5 ml-auto">
                              <span className="text-fg-4">추가·수정</span>
                              <input type="date" value={recDraft.date} onChange={e => setRecDraft(d => ({ ...d, date: e.target.value }))} className="h-7 px-1.5 rounded-lg border border-line bg-card text-[11px]" />
                              <input type="text" inputMode="numeric" value={recDraft.qty} placeholder="수량" onChange={e => setRecDraft(d => ({ ...d, qty: e.target.value.replace(/[^0-9]/g, '') }))} onKeyDown={e => { if (e.key === 'Enter') saveRecord(one.vid, recDraft.date, recDraft.qty); }} className="h-7 w-14 px-2 rounded-lg border border-line bg-card text-right text-[11px] tabular-nums" />
                              <Button size="sm" variant="outline" onClick={() => saveRecord(one.vid, recDraft.date, recDraft.qty)}><Plus className="h-3 w-3" /> 기록</Button>
                              <span className="text-fg-5">같은 날짜면 그 값으로 바뀝니다. 0 이면 삭제.</span>
                            </span>
                          </div>
                        </td>
                      </tr>
                    ) : null,
                  ]; })}
                  <tr className="h-9 font-semibold bg-card-2/60"><td className="px-2 sticky left-0 bg-card-2">합계 {table.length}</td><td />
                    <td className={td}>{fmt(tot.gross)}</td><td className={td}>{fmt(tot.cancel)}</td><td className={td}>{fmt(tot.empty)}</td><td className={td}>{fmt(tot.net)}</td>
                    <td className={td}>{fmt(tot.ad)}</td><td className={td}>{fmt(orgTot)}</td><td className={td}>{pct(tot.gross ? (orgTot / tot.gross) * 100 : null)}</td>
                    <td className={td}>{fmt(tot.netRevenue)}</td><td className={td}>{fmt(tot.cost)}</td><td className={cn(td, roasColor(totRoas))}>{pct(totRoas)}</td><td className={cn(td, roasColor(totAdRoas))}>{pct(totAdRoas)}</td><td className={td}>{pct(tot.netRevenue ? (tot.cost / tot.netRevenue) * 100 : null)}</td>
                    <td className={td}>{fmt(tot.imps)}</td><td className={td}>{fmt(tot.clicks)}</td><td className={td}>{pct(tot.imps ? (tot.clicks / tot.imps) * 100 : null, 2)}</td><td className={td}>{fmt(tot.visitors)}</td><td /></tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-fg-5">ROAS 색: 300% 미만 빨강(대부분 적자 구간), 500% 이상 초록. 상품별 손익분기는 정산 › 상품별 순이익의 손익분기 ROAS 를 보세요.{basis === '1d' && adInfo && !adInfo.hasRev1 ? ' 광고 raw 에 당일 전환매출 열이 없어 광고 ROAS 는 14일 전환매출로 계산했습니다.' : ''}</p>
        </section>
      )}
      {periods && periods.length === 0 && !needsMigration && <p className="text-[12px] text-fg-4 px-1">아직 올린 리포트가 없습니다. 위에서 기간을 넣고 파일을 올려 주세요.</p>}
    </div>
  );
}
