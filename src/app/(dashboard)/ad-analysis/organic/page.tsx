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
 *  - 총 판매·매출·방문자·전환율: 인사이트 상품별 판매 리포트 (기간 합계, 취소 반영 판매량)
 *  - 광고 판매: 이 PC 의 광고 raw 에서 같은 기간의 '총 판매수량(1일)'(당일 전환) 과 '(14일)' 을 옵션ID 로 합산
 *  - 오가닉 = 총 판매 − 광고 판매(당일). 14일 기준은 광고일 귀속이라 기간 경계에서 앞뒤로 새므로 참고로만.
 */
interface Period { period_from: string; period_to: string; rows: number; qty: number; revenue: number; updated_at: string }
interface Row { vendor_item_id: string; option_name: string | null; product_name: string | null; sales_method: string | null; revenue: number; orders: number; qty: number; visitors: number; views: number; conv_rate: number | null; cancel_qty: number; sku_id: string | null; sku?: { sku_code: string; option_values?: Record<string, string> | null; product?: { id: string; name: string } | null } | null }
interface AdAgg { q1: number; q14: number; cost: number; clicks: number; rev14: number }
type Basis = '1d' | '14d';
type Group = 'product' | 'option';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pct = (n: number | null) => n == null || !isFinite(n) ? '-' : `${n.toFixed(0)}%`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
  const [group, setGroup] = useState<Group>('product');
  const [uploading, setUploading] = useState(false);
  const [uFrom, setUFrom] = useState(''); const [uTo, setUTo] = useState('');
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
      setRows(j.rows ?? []);
      const raw = await readLocalAdRows();
      if (cancelled) return;
      const from = sel.period_from.replace(/-/g, ''), to = sel.period_to.replace(/-/g, '');
      const agg = new Map<string, AdAgg>(); const days = new Set<string>();
      // 키워드 보고서('-' 비검색)가 있는 날의 비검색 일별 행('')은 중복 → 제외 (광고 분석·월 집계와 같은 규칙)
      const kwDates = new Set<string>();
      for (const r of raw) if (String(r['키워드'] ?? '').trim() === '-' && String(r['광고 노출 지면'] ?? '').trim() === '비검색 영역') kwDates.add(String(r['날짜'] ?? ''));
      for (const r of raw) {
        const d = String(r['날짜'] ?? '').replace(/\D/g, '').slice(0, 8); if (d < from || d > to) continue;
        const kw = String(r['키워드'] ?? '').trim();
        if (kw === '' && String(r['광고 노출 지면'] ?? '').trim() === '비검색 영역' && kwDates.has(String(r['날짜'] ?? ''))) continue;
        days.add(d);
        const vid = String(r['광고전환매출발생 옵션ID'] ?? '').replace(/\.0$/, '').trim(); if (!vid) continue;
        const a = agg.get(vid) ?? { q1: 0, q14: 0, cost: 0, clicks: 0, rev14: 0 };
        a.q1 += Number(r['총 판매수량(1일)']) || 0; a.q14 += Number(r['총 판매수량(14일)']) || 0; a.rev14 += Number(r['총 전환매출액(14일)']) || 0; a.clicks += Number(r['클릭수']) || 0;
        // 광고비는 집행 옵션 기준 — 전환 옵션과 다를 수 있어 집행 옵션ID 에 붙인다
        const execVid = String(r['광고집행 옵션ID'] ?? '').replace(/\.0$/, '').trim() || vid;
        const e = agg.get(execVid) ?? { q1: 0, q14: 0, cost: 0, clicks: 0, rev14: 0 }; e.cost += (Number(r['광고비']) || 0) * 1.1; if (execVid !== vid) agg.set(execVid, e); else a.cost += (Number(r['광고비']) || 0) * 1.1;
        agg.set(vid, a);
      }
      // 기간 안에 raw 가 없는 날
      const missing: string[] = []; const s = new Date(sel.period_from), e = new Date(sel.period_to);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) { const k = ymd(d).replace(/-/g, ''); if (!days.has(k)) missing.push(ymd(d).slice(5)); }
      setAds(agg); setAdInfo({ rows: raw.length, days: days.size, missingDays: missing }); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sel]);

  // 표 행 (상품 또는 옵션 단위)
  const table = useMemo(() => {
    type T = { key: string; name: string; sub: string; method: string; qty: number; revenue: number; visitors: number; orders: number; ad: number; ad14: number; cost: number; rev14: number; unmatched: boolean };
    const m = new Map<string, T>();
    for (const r of rows) {
      const pname = r.sku?.product?.name ?? r.product_name ?? '(상품명 없음)';
      const opt = r.sku?.option_values ? Object.values(r.sku.option_values).filter(Boolean).join(' / ') : (r.option_name ?? '');
      const key = group === 'product' ? (r.sku?.product?.id ?? `__${pname}`) : r.vendor_item_id;
      let t = m.get(key);
      if (!t) { t = { key, name: pname, sub: group === 'option' ? `${opt || '기본'} · ${r.vendor_item_id}` : '', method: '', qty: 0, revenue: 0, visitors: 0, orders: 0, ad: 0, ad14: 0, cost: 0, rev14: 0, unmatched: false }; m.set(key, t); }
      t.qty += r.qty; t.revenue += r.revenue; t.visitors += r.visitors; t.orders += r.orders;
      if (!r.sku_id) t.unmatched = true;
      const meth = r.sales_method === '로켓그로스' ? '그로스' : r.sales_method === '판매자배송' ? '윙' : (r.sales_method ?? '');
      if (meth && !t.method.includes(meth)) t.method = t.method ? `${t.method}+${meth}` : meth;
      const a = ads?.get(r.vendor_item_id); if (a) { t.ad += a.q1; t.ad14 += a.q14; t.cost += a.cost; t.rev14 += a.rev14; }
    }
    const list = [...m.values()].map(t => { const adQ = basis === '1d' ? t.ad : t.ad14; const organic = Math.max(0, t.qty - adQ); return { ...t, adQ, organic, organicPct: t.qty > 0 ? (organic / t.qty) * 100 : null, adPct: t.qty > 0 ? (Math.min(adQ, t.qty) / t.qty) * 100 : null, cvr: t.visitors > 0 ? (t.orders / t.visitors) * 100 : null }; });
    return list.sort((a, b) => b.qty - a.qty);
  }, [rows, ads, group, basis]);
  const tot = useMemo(() => table.reduce((s, t) => ({ qty: s.qty + t.qty, ad: s.ad + t.adQ, revenue: s.revenue + t.revenue, cost: s.cost + t.cost, rev14: s.rev14 + t.rev14, visitors: s.visitors + t.visitors }), { qty: 0, ad: 0, revenue: 0, cost: 0, rev14: 0, visitors: 0 }), [table]);
  const orgTot = Math.max(0, tot.qty - tot.ad);

  // 업로드 (엑셀 → JSON → API). 기간은 파일에 없어 직접 입력
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
  return (
    <div className="space-y-4">
      {/* 업로드 + 기간 */}
      <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto">
            <h2 className="text-[15px] font-bold text-fg">오가닉 vs 광고 (쿠팡)</h2>
            <p className="text-[12px] text-fg-3 mt-0.5">윙 › 비즈니스 인사이트 › 엑셀 다운로드 › 기간 설정 › <b>상품별 판매 리포트</b> 파일을 올리면 총 판매(오가닉+광고)가 들어오고, 이 PC 의 광고 raw 와 옵션ID 로 맞대 오가닉 비중을 냅니다. 파일에 기간이 없어서 내려받을 때 설정한 기간을 같이 넣습니다.</p>
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
            <SegmentedControl items={[{ value: 'product', label: '상품' }, { value: 'option', label: '옵션' }] as const} value={group} onChange={setGroup} />
          </div>

          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { l: '총 판매', v: `${fmt(tot.qty)}개`, s: `매출 ${fmt(tot.revenue)}원` },
              { l: `광고 판매 (${basis === '1d' ? '당일' : '14일'})`, v: `${fmt(tot.ad)}개`, s: pct(tot.qty ? (Math.min(tot.ad, tot.qty) / tot.qty) * 100 : null) },
              { l: '오가닉 판매', v: `${fmt(orgTot)}개`, s: pct(tot.qty ? (orgTot / tot.qty) * 100 : null), hi: true },
              { l: '광고비 (VAT 포함)', v: `${fmt(tot.cost)}원`, s: tot.revenue ? `매출 대비 ${pct((tot.cost / tot.revenue) * 100)}` : '' },
              { l: '방문자', v: fmt(tot.visitors), s: tot.visitors ? `구매전환 ${pct((table.reduce((s, t) => s + t.orders, 0) / tot.visitors) * 100)}` : '' },
            ].map(k => <div key={k.l} className={cn('rounded-xl border border-line px-3 py-2', k.hi && 'bg-brand-bg/50 border-brand/30')}><div className="text-[11px] text-fg-4">{k.l}</div><div className="text-[18px] font-bold text-fg tabular-nums">{k.v}</div><div className="text-[11px] text-fg-3">{k.s}</div></div>)}
          </div>
          <p className="text-[11px] text-fg-4">오가닉 = 인사이트 총 판매 − 광고 전환 판매. 당일 전환은 광고 클릭 당일 판매만 잡아 오가닉이 조금 크게, 14일 전환은 기간 밖 판매까지 광고일에 붙어 오가닉이 작게 나옵니다. 둘 사이가 실제 범위입니다. 총 판매는 취소 반영 판매량입니다.</p>

          {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div> : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-[12px] border-collapse min-w-[900px]">
                <thead><tr className="h-9 border-b border-line">
                  <th className={cn(th, 'text-left sticky left-0')}>{group === 'product' ? '상품' : '옵션'}</th><th className={cn(th, 'text-left')}>판매방식</th>
                  <th className={th}>총 판매</th><th className={th}>광고 판매</th><th className={th}>오가닉</th><th className={th}>오가닉 비율</th><th className={th}>매출</th><th className={th}>광고비</th><th className={th} title="광고비 ÷ 매출">광고비율</th><th className={th}>방문자</th><th className={th}>구매전환</th>
                </tr></thead>
                <tbody>
                  {table.map(t => <tr key={t.key} className="h-9 border-b border-line-2 hover:bg-app/60">
                    <td className="px-2 sticky left-0 bg-card whitespace-nowrap"><div className="text-fg font-medium truncate max-w-[280px]" title={t.name}>{t.name}{t.unmatched && <span className="ml-1 text-[10px] text-warn" title="옵션ID 가 마스터에 없음 — 등록 큐에서 연결">미연결</span>}</div>{t.sub && <div className="text-[10px] text-fg-5 truncate max-w-[280px]">{t.sub}</div>}</td>
                    <td className="px-2 text-fg-4 whitespace-nowrap">{t.method}</td>
                    <td className="px-2 text-right tabular-nums font-semibold">{fmt(t.qty)}</td>
                    <td className="px-2 text-right tabular-nums">{fmt(t.adQ)}</td>
                    <td className="px-2 text-right tabular-nums">{fmt(t.organic)}</td>
                    <td className={cn('px-2 text-right tabular-nums', t.organicPct != null && t.organicPct < 20 ? 'text-warn' : t.organicPct != null && t.organicPct >= 50 ? 'text-success' : '')}>{pct(t.organicPct)}</td>
                    <td className="px-2 text-right tabular-nums">{fmt(t.revenue)}</td>
                    <td className="px-2 text-right tabular-nums text-fg-3">{fmt(t.cost)}</td>
                    <td className={cn('px-2 text-right tabular-nums', t.revenue && t.cost / t.revenue > 0.3 ? 'text-danger' : '')}>{t.revenue ? pct((t.cost / t.revenue) * 100) : '-'}</td>
                    <td className="px-2 text-right tabular-nums text-fg-3">{fmt(t.visitors)}</td>
                    <td className="px-2 text-right tabular-nums text-fg-3">{pct(t.cvr)}</td>
                  </tr>)}
                  <tr className="h-9 font-semibold bg-card-2/60"><td className="px-2 sticky left-0 bg-card-2">합계 {table.length}</td><td />
                    <td className="px-2 text-right tabular-nums">{fmt(tot.qty)}</td><td className="px-2 text-right tabular-nums">{fmt(tot.ad)}</td><td className="px-2 text-right tabular-nums">{fmt(orgTot)}</td><td className="px-2 text-right tabular-nums">{pct(tot.qty ? (orgTot / tot.qty) * 100 : null)}</td>
                    <td className="px-2 text-right tabular-nums">{fmt(tot.revenue)}</td><td className="px-2 text-right tabular-nums">{fmt(tot.cost)}</td><td className="px-2 text-right tabular-nums">{tot.revenue ? pct((tot.cost / tot.revenue) * 100) : '-'}</td><td className="px-2 text-right tabular-nums">{fmt(tot.visitors)}</td><td /></tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {periods && periods.length === 0 && !needsMigration && <p className="text-[12px] text-fg-4 px-1">아직 올린 리포트가 없습니다. 위에서 기간을 넣고 파일을 올려 주세요.</p>}
    </div>
  );
}
