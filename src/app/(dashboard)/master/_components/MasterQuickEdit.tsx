'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, Loader2, Plus, RefreshCw, Save, Search, Sparkles, Trash2, Undo2, Wand2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn, skuOptionLabel } from '@/lib/utils';
import type { Product } from '@/types';
import Link from 'next/link';
import { autoSkuCode } from '@/components/products/AddProductDialog';
import { toCouponChannel, unitDiscount, type Effective } from '@/lib/settlement/coupons';

/**
 * 마스터 시트 "빠른 입력" — 손으로 적어야 하는 칸만 모아 놓은 화면.
 *  - 문제 필터(원가 없음·옵션ID 없음·판매가 없음·상품명 없음)로 할 일만 남기고, Enter 로 같은 열 아래 칸으로 이동
 *  - 쿠팡 옵션ID 는 여러 개(쉼표) — 첫 번째가 기본, 나머지는 추가 옵션ID
 *  - 마켓이 쓰는 상품명(RG 재고·광고 보고서)을 한 번에 채우는 "이름 자동 채우기"
 *  - 연동 상품명(별칭)을 줄 안에서 바로 추가/삭제
 *  - 바뀐 행만 저장, Ctrl+S
 *  - "빠른 추가": 팝업 없이 상품명·옵션명·원가·마켓 옵션ID·판매가만 넣어 한 번에 등록 (공급처·리드타임은 나중에)
 *  - 쿠폰(오늘) 열: 정산 › 쿠폰·할인 관리의 오늘 유효 쿠폰을 읽기 전용으로 보여준다 (마스터에서 쿠폰을 적지 않는다)
 */
interface Channel { id: string; name: string; type: string }
interface Supplier { id: string; name: string; alias: string | null }
interface Entry { name: string; ids: string; productId: string; price: string; rate: string }
interface QuickAdd { productName: string; option: string; cost: string; ch: Record<string, { ids: string; productId: string; price: string }> }
interface Row { skuId: string; productId: string; productName: string; optionLabel: string; skuCode: string; cost: string; lead: string; supplierId: string; ch: Record<string, Entry>; aliases: { id: string; name: string }[] }
type Field = 'cost' | 'lead' | 'supplierId' | `${string}:${keyof Entry}`;
type Problem = 'cost' | 'coupangId' | 'tossId' | 'price' | 'name' | 'dirty';

const emptyEntry = (): Entry => ({ name: '', ids: '', productId: '', price: '', rate: '' });
const emptyQuick = (): QuickAdd => ({ productName: '', option: '', cost: '', ch: {} });
const DETAIL_KEY = 'lv-erp-master-detail-cols';
const COST_VAT_KEY = 'lv-erp-master-cost-vat';
const COLS_KEY = 'lv-erp-master-quick-cols';
const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;
const splitIds = (v: string) => v.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);

export function MasterQuickEdit() {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [orig, setOrig] = useState<Map<string, Row>>(new Map());
  const [channels, setChannels] = useState<Channel[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [names, setNames] = useState<Record<string, { name: string; source: string; platform: string }>>({});
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Problem | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [visibleCh, setVisibleCh] = useState<Set<string> | null>(null);
  const [costVat, setCostVat] = useState<'ex' | 'incl'>('ex');
  const [saving, setSaving] = useState(false);
  const [aliasOpen, setAliasOpen] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState('');
  const [needsMigration, setNeedsMigration] = useState(false);
  const [couponToday, setCouponToday] = useState<Record<string, Effective>>({});   // 정산 › 쿠폰·할인 관리: 오늘 유효 쿠폰 (읽기 전용)
  const [detailCols, setDetailCols] = useState(false);                               // 공급처·리드 열 (기본 숨김)
  const [quick, setQuick] = useState<QuickAdd | null>(null);                        // 빠른 추가 패널
  const [quickSaving, setQuickSaving] = useState(false);

  useEffect(() => { try { if (localStorage.getItem(COST_VAT_KEY) === 'incl') setCostVat('incl'); if (localStorage.getItem(DETAIL_KEY) === '1') setDetailCols(true); const c = localStorage.getItem(COLS_KEY); if (c) setVisibleCh(new Set(JSON.parse(c))); } catch {} }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
      const [prods, chs, sups, ps, aliases, extra, nm, cp] = await Promise.all([
        fetch('/api/products').then(r => r.json()).catch(() => []),
        fetch('/api/settings/channels').then(r => r.json()).catch(() => []),
        fetch('/api/suppliers').then(r => r.json()).catch(() => []),
        fetch('/api/platform-skus').then(r => r.json()).catch(() => []),
        fetch('/api/sku-aliases').then(r => r.json()).catch(() => []),
        fetch('/api/platform-sku-ids').then(r => r.json()).catch(() => ({ ids: [] })),
        fetch('/api/master/names').then(r => r.json()).catch(() => ({ names: {} })),
        fetch(`/api/coupons/effective?from=${today}&to=${today}`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      setCouponToday(cp?.byVid ?? {});
      const chList: Channel[] = Array.isArray(chs) ? chs : [];
      setChannels(chList); setSuppliers(Array.isArray(sups) ? sups : []); setProducts(Array.isArray(prods) ? prods : []); setNames(nm?.names ?? {});
      setNeedsMigration(!!extra?.needsMigration);
      const extrasBy: Record<string, Record<string, string[]>> = {};
      for (const e of (extra?.ids ?? []) as any[]) { const a = (extrasBy[e.sku_id] = extrasBy[e.sku_id] ?? {}); (a[e.channel_id] = a[e.channel_id] ?? []).push(String(e.platform_sku_id)); }
      const psBy: Record<string, Record<string, any>> = {};
      for (const p of (Array.isArray(ps) ? ps : []) as any[]) (psBy[p.sku_id] = psBy[p.sku_id] ?? {})[p.channel_id] = p;
      const aliasBy: Record<string, { id: string; name: string }[]> = {};
      for (const a of (Array.isArray(aliases) ? aliases : []) as any[]) (aliasBy[a.sku_id] = aliasBy[a.sku_id] ?? []).push({ id: a.id, name: a.channel_name });
      const out: Row[] = [];
      for (const prod of (Array.isArray(prods) ? prods : []) as any[]) for (const sku of prod.skus ?? []) {
        const ch: Record<string, Entry> = {};
        for (const c of chList) {
          const p = psBy[sku.id]?.[c.id];
          const isC = c.type === 'coupang';
          const ids = [p?.platform_sku_id, ...(extrasBy[sku.id]?.[c.id] ?? [])].filter(Boolean).join(', ');
          ch[c.id] = { name: p?.platform_product_name ?? '', ids: isC ? ids : (p?.platform_sku_id ?? ''), productId: isC ? '' : (p?.platform_product_id ?? ''), price: p?.price != null ? String(p.price) : '', rate: p?.commission_rate != null ? String(p.commission_rate) : '' };
        }
        out.push({ skuId: sku.id, productId: prod.id, productName: prod.name, optionLabel: skuOptionLabel(sku.option_values ?? {}), skuCode: sku.sku_code, cost: sku.cost_price != null ? String(sku.cost_price) : '', lead: sku.lead_time_days != null ? String(sku.lead_time_days) : '', supplierId: sku.supplier_id ?? '', ch, aliases: aliasBy[sku.id] ?? [] });
      }
      setRows(out); setOrig(new Map(out.map(r => [r.skuId, JSON.parse(JSON.stringify(r))])));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const shownChannels = useMemo(() => channels.filter(c => !visibleCh || visibleCh.has(c.id)), [channels, visibleCh]);
  const toggleCh = (id: string) => setVisibleCh(prev => { const base = prev ?? new Set(channels.map(c => c.id)); const n = new Set(base); if (n.has(id)) n.delete(id); else n.add(id); try { localStorage.setItem(COLS_KEY, JSON.stringify([...n])); } catch {} return n; });
  const coupangCh = channels.find(c => c.type === 'coupang'); const tossCh = channels.find(c => c.type === 'toss');

  const isDirty = (r: Row) => JSON.stringify(r) !== JSON.stringify(orig.get(r.skuId));
  const problemsOf = (r: Row): Problem[] => {
    const p: Problem[] = [];
    if (!num(r.cost)) p.push('cost');
    if (coupangCh && !splitIds(r.ch[coupangCh.id]?.ids ?? '').length) p.push('coupangId');
    if (tossCh && !(r.ch[tossCh.id]?.productId || r.ch[tossCh.id]?.ids)) p.push('tossId');
    if (shownChannels.some(c => (r.ch[c.id]?.ids || r.ch[c.id]?.productId) && !num(r.ch[c.id]?.price ?? ''))) p.push('price');
    if (shownChannels.some(c => (r.ch[c.id]?.ids || r.ch[c.id]?.productId) && !(r.ch[c.id]?.name ?? '').trim())) p.push('name');
    if (isDirty(r)) p.push('dirty');
    return p;
  };
  const counts = useMemo(() => { const c: Record<Problem, number> = { cost: 0, coupangId: 0, tossId: 0, price: 0, name: 0, dirty: 0 }; for (const r of rows) for (const p of problemsOf(r)) c[p] += 1; return c; }, [rows, orig, shownChannels]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return rows.filter(r => (!k || `${r.productName} ${r.optionLabel} ${r.skuCode} ${Object.values(r.ch).map(e => e.name + ' ' + e.ids + ' ' + e.productId).join(' ')}`.toLowerCase().includes(k)) && (!filter || problemsOf(r).includes(filter)));
  }, [rows, q, filter, orig, shownChannels]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => { const m = new Map<string, Row[]>(); for (const r of filtered) { const a = m.get(r.productId) ?? []; a.push(r); m.set(r.productId, a); } return [...m.entries()]; }, [filtered]);

  const setField = (skuId: string, field: Field, v: string) => setRows(prev => prev.map(r => {
    if (r.skuId !== skuId) return r;
    if (field === 'cost' || field === 'lead' || field === 'supplierId') return { ...r, [field]: v };
    const [chId, key] = field.split(':') as [string, keyof Entry];
    return { ...r, ch: { ...r.ch, [chId]: { ...(r.ch[chId] ?? emptyEntry()), [key]: v } } };
  }));
  const revertRow = (skuId: string) => { const o = orig.get(skuId); if (o) setRows(prev => prev.map(r => r.skuId === skuId ? JSON.parse(JSON.stringify(o)) : r)); };
  const costShown = (ex: string) => !ex ? '' : costVat === 'incl' ? String(Math.round(num(ex) * 1.1)) : ex;
  const costStore = (typed: string) => !typed ? '' : costVat === 'incl' ? String(Math.round(num(typed) / 1.1 * 100) / 100) : typed;
  const toggleCostVat = () => setCostVat(v => { const n = v === 'ex' ? 'incl' : 'ex'; try { localStorage.setItem(COST_VAT_KEY, n); } catch {} return n; });

  /** 이름 자동 채우기: 옵션ID 로 알려진 마켓 상품명을 빈 칸에 넣는다 (있는 값은 유지) */
  const autoFillNames = (only?: string) => {
    let n = 0;
    setRows(prev => prev.map(r => {
      if (only && r.skuId !== only) return r;
      let ch = r.ch;
      for (const c of channels) {
        const e = ch[c.id]; if (!e || e.name.trim()) continue;
        const vid = c.type === 'coupang' ? splitIds(e.ids)[0] : e.ids;
        const hit = vid ? names[vid] : undefined;
        if (hit && hit.platform === c.type) { ch = { ...ch, [c.id]: { ...e, name: hit.name } }; n++; }
      }
      return ch === r.ch ? r : { ...r, ch };
    }));
    setTimeout(() => toast[n ? 'success' : 'info'](n ? `상품명 ${n}칸 채움 — 저장을 눌러 확정하세요` : '채울 수 있는 빈 상품명이 없습니다 (옵션ID 가 있고 RG 재고·광고 보고서에 이름이 있는 경우만)'), 0);
  };

  /** 빠른 추가: 상품(없으면 생성) → SKU → 마켓 연결. 공급처·리드타임 등은 기본값 */
  const setQuickCh = (chId: string, key: 'ids' | 'productId' | 'price', v: string) => setQuick(q => q && { ...q, ch: { ...q.ch, [chId]: { ...(q.ch[chId] ?? { ids: '', productId: '', price: '' }), [key]: v } } });
  const quickSave = async () => {
    if (!quick) return; const name = quick.productName.trim(); if (!name) return;
    const H = { 'Content-Type': 'application/json' };
    setQuickSaving(true);
    try {
      let prod: Product | null = products.find(p => p.name.trim() === name) ?? null;
      if (!prod) {
        const r = await fetch('/api/products', { method: 'POST', headers: H, body: JSON.stringify({ name }) });
        const j = await r.json().catch(() => ({})); if (!r.ok) { toast.error(j.error ?? '상품 추가 실패'); return; }
        prod = j as Product;
      }
      const option = quick.option.trim();
      const suffix = option.replace(/\s/g, '').slice(0, 8).toUpperCase();
      const sr = await fetch('/api/skus', { method: 'POST', headers: H, body: JSON.stringify({ product_id: prod.id, sku_code: autoSkuCode(name) + (suffix ? '-' + suffix : ''), option_values: option ? { 옵션: option } : {}, cost_price: num(costStore(quick.cost)), logistics_cost: 0, lead_time_days: 7, reorder_point: 0, safety_stock: 0, is_active: true }) });
      const sku = await sr.json().catch(() => ({})); if (!sr.ok) { toast.error(sku.error ?? '옵션 추가 실패'); return; }
      const errors: string[] = [];
      for (const c of channels) {
        const e = quick.ch[c.id]; if (!e) continue;
        const isC = c.type === 'coupang'; const ids = splitIds(e.ids);
        if (!ids.length && !e.productId.trim()) continue;
        const price = e.price.trim() ? num(e.price) : null;
        const r = await fetch('/api/platform-skus', { method: 'POST', headers: H, body: JSON.stringify({ sku_id: sku.id, channel_id: c.id, price, platform_sku_id: isC ? (ids[0] ?? null) : (e.ids.trim() || null), platform_product_id: isC ? null : (e.productId.trim() || null) }) });
        if (!r.ok) errors.push(c.name);
        if (isC && ids.length > 1) await fetch('/api/platform-sku-ids', { method: 'PUT', headers: H, body: JSON.stringify({ sku_id: sku.id, channel_id: c.id, ids: ids.slice(1).map(v => ({ platform_sku_id: v, price })) }) }).catch(() => {});
      }
      if (errors.length) toast.error(`마켓 연결 일부 실패: ${errors.join(', ')}`); else toast.success(`${name} · ${option || '기본'} 추가됨 — 이어서 다음 옵션을 넣을 수 있습니다`);
      setQuick({ ...emptyQuick(), productName: name });
      await load();
    } finally { setQuickSaving(false); }
  };

  /** Enter: 같은 열 아래 칸으로 */
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' || e.shiftKey === undefined) return;
    const el = e.currentTarget as HTMLElement; const col = el.dataset.col; if (!col) return;
    e.preventDefault();
    const all = [...document.querySelectorAll<HTMLElement>(`[data-col="${col}"]`)];
    const i = all.indexOf(el); const next = all[e.shiftKey ? i - 1 : i + 1];
    if (next) { next.focus(); if (next instanceof HTMLInputElement) next.select(); }
  };

  const save = useCallback(async () => {
    const dirty = rows.filter(isDirty);
    if (!dirty.length) { toast.info('바뀐 행이 없습니다'); return; }
    setSaving(true);
    const errors: string[] = [];
    try {
      for (const r of dirty) {
        const o = orig.get(r.skuId)!;
        if (r.cost !== o.cost || r.lead !== o.lead || r.supplierId !== o.supplierId) {
          const res = await fetch(`/api/skus/${r.skuId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cost_price: num(r.cost), lead_time_days: r.lead ? Number(r.lead) : null, supplier_id: r.supplierId || null }) });
          if (!res.ok) errors.push(`${r.skuCode} 원가/리드타임: ${(await res.json().catch(() => ({}))).error ?? res.status}`);
        }
        for (const c of channels) {
          const e = r.ch[c.id], oe = o.ch[c.id];
          if (JSON.stringify(e) === JSON.stringify(oe)) continue;
          const isC = c.type === 'coupang';
          const ids = splitIds(e.ids);
          const body: any = { sku_id: r.skuId, channel_id: c.id, platform_product_name: e.name.trim() || null, price: e.price.trim() ? num(e.price) : null, commission_rate: e.rate.trim() ? Number(e.rate) : null };   // 쿠폰은 정산 › 쿠폰·할인 관리에서 (coupon_discount 는 더 이상 쓰지 않음)
          if (isC) { body.platform_sku_id = ids[0] ?? null; body.platform_product_id = null; } else { body.platform_sku_id = e.ids.trim() || null; body.platform_product_id = e.productId.trim() || null; }
          const res = await fetch('/api/platform-skus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (!res.ok) errors.push(`${r.skuCode} ${c.name}: ${(await res.json().catch(() => ({}))).error ?? res.status}`);
          if (isC && (ids.length > 1 || splitIds(oe?.ids ?? '').length > 1)) {
            const er = await fetch('/api/platform-sku-ids', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku_id: r.skuId, channel_id: c.id, ids: ids.slice(1).map(v => ({ platform_sku_id: v })) }) });
            if (!er.ok) errors.push(`${r.skuCode} 추가 옵션ID: ${(await er.json().catch(() => ({}))).error ?? er.status}`);
          }
        }
      }
      if (errors.length) toast.error(`일부 실패: ${errors.slice(0, 3).join(' · ')}${errors.length > 3 ? ` 외 ${errors.length - 3}` : ''}`);
      else toast.success(`${dirty.length}행 저장`);
      await load();
    } finally { setSaving(false); }
  }, [rows, orig, channels, load, toast]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [save]);

  const addAlias = async (r: Row) => {
    const name = aliasDraft.trim(); if (!name) return;
    const res = await fetch('/api/sku-aliases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel_name: name, sku_id: r.skuId }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(j.error ?? '연동 상품명 추가 실패'); return; }
    setAliasDraft('');
    setRows(prev => prev.map(x => x.skuId === r.skuId ? { ...x, aliases: [...x.aliases, { id: j.id ?? String(Date.now()), name }] } : x));
    setOrig(prev => { const n = new Map(prev); const o = n.get(r.skuId); if (o) n.set(r.skuId, { ...o, aliases: [...o.aliases, { id: j.id ?? String(Date.now()), name }] }); return n; });
  };
  const removeAlias = async (r: Row, a: { id: string; name: string }) => {
    if (!(await confirmDialog(`연동 상품명 "${a.name}" 을 지울까요? 이 이름으로 들어오는 주문·매출 매칭이 끊깁니다.`))) return;
    const res = await fetch(`/api/sku-aliases?id=${a.id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('삭제 실패'); return; }
    const strip = (x: Row) => ({ ...x, aliases: x.aliases.filter(y => y.id !== a.id) });
    setRows(prev => prev.map(x => x.skuId === r.skuId ? strip(x) : x));
    setOrig(prev => { const n = new Map(prev); const o = n.get(r.skuId); if (o) n.set(r.skuId, strip(o)); return n; });
  };

  const dirtyCount = counts.dirty;
  const chip = (key: Problem, label: string, tone: string) => counts[key] > 0 && (
    <button key={key} onClick={() => setFilter(f => f === key ? null : key)} className={cn('h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition-colors', filter === key ? 'bg-brand text-white border-brand' : `${tone} bg-card hover:bg-app`)}>{label} {counts[key]}</button>
  );
  const inp = 'h-8 px-2 rounded-lg border border-transparent bg-transparent text-[12px] text-fg hover:border-line focus:border-brand focus:bg-card focus:outline-none focus:ring-2 focus:ring-brand/10 w-full';
  const warnInp = 'border-warn/60 bg-warn/[0.06]';
  const th = 'px-2 py-2 text-[11px] font-semibold text-fg-4 whitespace-nowrap text-left bg-card-2';

  if (loading) return <div className="flex items-center justify-center h-48"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>;

  return (
    <div className="space-y-3">
      {/* 도구줄 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-5" /><input lang="ko" value={q} onChange={e => setQ(e.target.value)} placeholder="상품명·옵션·SKU·옵션ID 검색" className="w-full h-8 pl-8 pr-2 rounded-lg border border-line text-[12px] focus:outline-none focus:border-brand" /></div>
        <span className="text-[11px] text-fg-4">할 일</span>
        {chip('cost', '원가 없음', 'text-danger border-danger/30')}
        {chip('coupangId', '쿠팡 옵션ID 없음', 'text-warn border-warn/40')}
        {chip('tossId', '토스 상품ID 없음', 'text-warn border-warn/40')}
        {chip('price', '판매가 없음', 'text-warn border-warn/40')}
        {chip('name', '상품명 없음', 'text-warn border-warn/40')}
        {chip('dirty', '변경됨', 'text-brand border-brand/40')}
        {filter && <button onClick={() => setFilter(null)} className="text-[11px] text-fg-4 hover:text-fg flex items-center gap-0.5"><X className="h-3 w-3" />필터 해제</button>}
        <span className="ml-auto flex items-center gap-1.5">
          <span className="text-[11px] text-fg-4">마켓 열</span>
          {channels.map(c => <button key={c.id} onClick={() => toggleCh(c.id)} className={cn('h-7 px-2 rounded-lg text-[11px] border', shownChannels.includes(c) ? 'bg-brand-bg text-brand border-brand/30' : 'bg-card text-fg-4 border-line')}>{c.name}</button>)}
          <Button size="sm" variant="outline" onClick={() => autoFillNames()} title="옵션ID 가 있는데 상품명이 빈 칸을 RG 재고·광고 보고서의 이름으로 채웁니다"><Wand2 className="h-3.5 w-3.5" /> 이름 자동 채우기</Button>
          <button onClick={() => setDetailCols(v => { const n = !v; try { localStorage.setItem(DETAIL_KEY, n ? '1' : '0'); } catch {} return n; })} className={cn('h-7 px-2 rounded-lg text-[11px] border', detailCols ? 'bg-brand-bg text-brand border-brand/30' : 'bg-card text-fg-4 border-line')} title="공급처·리드타임 열 보이기/숨기기">공급처·리드</button>
          <Button size="sm" onClick={() => setQuick(q => q ? null : emptyQuick())}><Plus className="h-3.5 w-3.5" /> 빠른 추가</Button>
          <Button size="sm" variant="outline" onClick={load} title="다시 불러오기 (저장 안 한 변경은 사라짐)"><RefreshCw className="h-3.5 w-3.5" /></Button>
        </span>
      </div>
      {needsMigration && <p className="text-[11px] text-warn flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5" /> 추가 옵션ID(00071) 테이블이 없습니다. 쉼표로 여러 옵션ID 를 넣어도 첫 번째만 저장됩니다.</p>}
      <p className="text-[11px] text-fg-4">Enter ↓ 같은 열 다음 칸 · Shift+Enter ↑ · Ctrl+S 저장 · 노란 칸 = 비어 있는 필수값 · 쿠팡 옵션ID 는 쉼표로 여러 개(첫 번째가 기본)</p>

      {quick && (
        <div className="bg-card rounded-2xl border border-brand/30 shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-fg">빠른 추가</span>
            <span className="text-[11px] text-fg-4">상품명 · 옵션명 · 원가 · 마켓 옵션ID · 판매가만 넣습니다. 공급처·리드타임은 나중에 표에서 채워도 됩니다.</span>
            <button onClick={() => setQuick(null)} className="ml-auto text-fg-4 hover:text-fg" title="닫기"><X className="h-3.5 w-3.5" /></button>
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(220px,1.5fr)_minmax(140px,1fr)_110px] items-end">
            <label className="space-y-0.5"><span className="text-[11px] text-fg-4">상품명 <span className="text-fg-5">— 있는 상품 이름을 고르면 그 상품에 옵션이 추가됩니다</span></span>
              <input lang="ko" list="quick-products" autoFocus value={quick.productName} onChange={e => setQuick(q => q && { ...q, productName: e.target.value })} className="h-8 px-2 rounded-lg border border-line bg-card text-[12px] w-full focus:outline-none focus:border-brand" placeholder="예: 그랑누보 데일리 백팩" />
              <datalist id="quick-products">{products.map(p => <option key={p.id} value={p.name} />)}</datalist></label>
            <label className="space-y-0.5"><span className="text-[11px] text-fg-4">옵션명 <span className="text-fg-5">(없으면 기본)</span></span>
              <input lang="ko" value={quick.option} onChange={e => setQuick(q => q && { ...q, option: e.target.value })} className="h-8 px-2 rounded-lg border border-line bg-card text-[12px] w-full focus:outline-none focus:border-brand" placeholder="예: 블랙" /></label>
            <label className="space-y-0.5"><span className="text-[11px] text-fg-4">원가 ({costVat === 'incl' ? 'VAT포함' : 'VAT제외'})</span>
              <input inputMode="numeric" value={quick.cost} onChange={e => setQuick(q => q && { ...q, cost: e.target.value.replace(/[^0-9]/g, '') })} className="h-8 px-2 rounded-lg border border-line bg-card text-[12px] w-full text-right tabular-nums focus:outline-none focus:border-brand" placeholder="0" /></label>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {shownChannels.map(c => { const e = quick.ch[c.id] ?? { ids: '', productId: '', price: '' }; const isC = c.type === 'coupang'; const qi = 'h-8 px-2 rounded-lg border border-line bg-card text-[12px] focus:outline-none focus:border-brand min-w-0 flex-1';
              return <div key={c.id} className="rounded-xl bg-app px-3 py-2 space-y-1">
                <div className="text-[11px] font-semibold text-fg-3">{c.name} <span className="font-normal text-fg-5">{isC ? '옵션ID (쉼표로 여러 개) · 판매가(정가)' : c.type === 'toss' ? '상품ID · 옵션ID · 판매가' : '상품번호 · 판매가'}</span></div>
                <div className="flex gap-1">
                  {isC ? <input value={e.ids} onChange={ev => setQuickCh(c.id, 'ids', ev.target.value)} placeholder="옵션ID, 옵션ID" className={cn(qi, 'font-mono text-[11px]')} />
                    : c.type === 'toss' ? <><input value={e.productId} onChange={ev => setQuickCh(c.id, 'productId', ev.target.value)} placeholder="상품ID" className={cn(qi, 'font-mono text-[11px]')} /><input value={e.ids} onChange={ev => setQuickCh(c.id, 'ids', ev.target.value)} placeholder="옵션ID" className={cn(qi, 'font-mono text-[11px]')} /></>
                    : <input value={e.productId} onChange={ev => setQuickCh(c.id, 'productId', ev.target.value)} placeholder="상품번호" className={cn(qi, 'font-mono text-[11px]')} />}
                  <input inputMode="numeric" value={e.price} onChange={ev => setQuickCh(c.id, 'price', ev.target.value.replace(/[^0-9]/g, ''))} onKeyDown={ev => { if (ev.key === 'Enter') quickSave(); }} placeholder="판매가" className={cn(qi, 'w-24 flex-none text-right tabular-nums')} />
                </div>
              </div>; })}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={quickSave} disabled={quickSaving || !quick.productName.trim()}>{quickSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} 추가</Button>
            <span className="text-[11px] text-fg-5">판매가는 마켓 정가(쿠폰 차감 전). 쿠폰은 정산 › 쿠폰·할인 관리에서. 마켓 상품명은 추가 뒤 "이름 자동 채우기"로.</span>
          </div>
        </div>
      )}

      {/* 표 */}
      <div className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="border-b border-line">
                <th className={cn(th, 'sticky left-0 z-10 min-w-[220px]')}>상품 / 옵션</th>
                <th className={cn(th, 'min-w-[110px]')}>원가 <button onClick={toggleCostVat} className={cn('rounded px-1 font-semibold', costVat === 'incl' ? 'bg-brand text-white' : 'text-fg-5 hover:text-brand')} title="원가 칸 입력 기준 (저장은 항상 VAT 제외)">{costVat === 'incl' ? 'VAT포함' : 'VAT제외'}</button></th>
                {detailCols && <th className={cn(th, 'min-w-[120px]')}>공급처</th>}
                {detailCols && <th className={cn(th, 'w-16')}>리드</th>}
                {shownChannels.map(c => <Fragment key={c.id}>
                  <th className={cn(th, 'min-w-[220px] border-l border-line')}>{c.name} 상품명</th>
                  <th className={cn(th, 'min-w-[150px]')}>{c.type === 'coupang' ? '옵션ID (쉼표로 여러 개)' : c.type === 'toss' ? '상품ID · 옵션ID' : '상품번호'}</th>
                  <th className={cn(th, 'w-24')} title="마켓 정가 (쿠폰 차감 전)">판매가</th>
                  <th className={cn(th, 'w-20')} title="정산 › 쿠폰·할인 관리에 등록된 오늘 유효 쿠폰 — 개당 할인액 (읽기 전용)">쿠폰(오늘)</th>
                  {c.type === 'coupang' && <th className={cn(th, 'w-16')} title="비우면 기본 12%">수수료%</th>}
                </Fragment>)}
                <th className={cn(th, 'min-w-[90px] border-l border-line')}>연동 이름</th>
                <th className={cn(th, 'w-10')} />
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && <tr><td colSpan={20} className="py-10 text-center text-fg-4">{filter ? '해당하는 행이 없습니다' : '상품이 없습니다'}</td></tr>}
              {groups.map(([pid, list]) => {
                const prod = products.find(p => p.id === pid);
                const open = !collapsed.has(pid);
                return <Fragment key={pid}>
                  <tr className="bg-card-2 border-y border-line">
                    <td colSpan={20} className="px-2 py-1.5">
                      <div className="flex items-center gap-2 sticky left-2 w-max">
                        <button onClick={() => setCollapsed(prev => { const n = new Set(prev); if (n.has(pid)) n.delete(pid); else n.add(pid); return n; })} className="text-fg-3">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>
                        <span className="font-semibold text-fg">{list[0].productName}</span>
                        <span className="text-[11px] text-fg-5">{list.length}개 옵션</span>
                        {prod && <button onClick={() => { setQuick({ ...emptyQuick(), productName: prod.name }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="text-[11px] text-brand hover:underline flex items-center gap-0.5"><Plus className="h-3 w-3" />옵션</button>}
                      </div>
                    </td>
                  </tr>
                  {open && list.map(r => {
                    const probs = problemsOf(r); const dirty = probs.includes('dirty');
                    return <tr key={r.skuId} className={cn('border-b border-line-2 h-10', dirty && 'bg-brand-bg/30')}>
                      <td className={cn('px-2 sticky left-0 z-10 whitespace-nowrap', dirty ? 'bg-brand-bg/60' : 'bg-card')}>
                        <div className="flex items-center gap-1.5">
                          <span className="text-fg font-medium">{r.optionLabel || '기본'}</span>
                          <span className="text-[10px] text-fg-5 font-mono">{r.skuCode}</span>
                          {dirty && <button onClick={() => revertRow(r.skuId)} className="text-fg-5 hover:text-fg" title="이 행 되돌리기"><Undo2 className="h-3 w-3" /></button>}
                        </div>
                      </td>
                      <td className="px-1"><input data-col="cost" inputMode="numeric" value={costShown(r.cost)} onChange={e => setField(r.skuId, 'cost', costStore(e.target.value.replace(/[^0-9]/g, '')))} onKeyDown={onKey} placeholder="원가" className={cn(inp, 'text-right tabular-nums', probs.includes('cost') && warnInp)} /></td>
                      {detailCols && <td className="px-1"><select data-col="sup" value={r.supplierId} onChange={e => setField(r.skuId, 'supplierId', e.target.value)} onKeyDown={onKey} className={cn(inp, 'pr-6')}><option value="">-</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.alias ?? s.name}</option>)}</select></td>}
                      {detailCols && <td className="px-1"><input data-col="lead" inputMode="numeric" value={r.lead} onChange={e => setField(r.skuId, 'lead', e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={onKey} placeholder="일" className={cn(inp, 'text-right tabular-nums')} /></td>}
                      {shownChannels.map(c => { const e = r.ch[c.id] ?? emptyEntry(); const isC = c.type === 'coupang'; const vid = isC ? splitIds(e.ids)[0] : e.ids; const sug = vid ? names[vid] : undefined; const has = !!(e.ids || e.productId);
                        return <Fragment key={c.id}>
                          <td className="px-1 border-l border-line-2">
                            <div className="flex items-center gap-1">
                              <input data-col={`name:${c.id}`} lang="ko" value={e.name} onChange={ev => setField(r.skuId, `${c.id}:name`, ev.target.value)} onKeyDown={onKey} placeholder={sug ? sug.name.slice(0, 30) : `${c.name} 상품명`} title={sug ? `${sug.source}: ${sug.name}` : ''} className={cn(inp, has && !e.name.trim() && warnInp)} />
                              {sug && sug.platform === c.type && sug.name !== e.name && <button onClick={() => setField(r.skuId, `${c.id}:name`, sug.name)} className="text-brand hover:text-brand shrink-0" title={`${sug.source} 이름으로: ${sug.name}`}><Sparkles className="h-3.5 w-3.5" /></button>}
                            </div>
                          </td>
                          <td className="px-1">
                            {isC ? (
                              <input data-col={`ids:${c.id}`} value={e.ids} onChange={ev => setField(r.skuId, `${c.id}:ids`, ev.target.value)} onKeyDown={onKey} placeholder="옵션ID, 옵션ID" className={cn(inp, 'font-mono text-[11px]', !splitIds(e.ids).length && warnInp)} />
                            ) : c.type === 'toss' ? (
                              <div className="flex gap-1">
                                <input data-col={`pid:${c.id}`} value={e.productId} onChange={ev => setField(r.skuId, `${c.id}:productId`, ev.target.value)} onKeyDown={onKey} placeholder="상품ID" className={cn(inp, 'font-mono text-[11px]', !e.productId && !e.ids && warnInp)} />
                                <input data-col={`ids:${c.id}`} value={e.ids} onChange={ev => setField(r.skuId, `${c.id}:ids`, ev.target.value)} onKeyDown={onKey} placeholder="옵션ID" className={cn(inp, 'font-mono text-[11px]')} />
                              </div>
                            ) : (
                              <input data-col={`pid:${c.id}`} value={e.productId} onChange={ev => setField(r.skuId, `${c.id}:productId`, ev.target.value)} onKeyDown={onKey} placeholder="상품번호" className={cn(inp, 'font-mono text-[11px]')} />
                            )}
                          </td>
                          <td className="px-1"><input data-col={`price:${c.id}`} inputMode="numeric" value={e.price} onChange={ev => setField(r.skuId, `${c.id}:price`, ev.target.value.replace(/[^0-9]/g, ''))} onKeyDown={onKey} placeholder="판매가" className={cn(inp, 'text-right tabular-nums', has && !num(e.price) && warnInp)} /></td>
                          <td className="px-1 whitespace-nowrap text-right">{(() => { const cc = toCouponChannel(c.type); const eff = cc && vid ? couponToday[`${cc}|${vid}`] : undefined; if (!eff) return <span className="text-[11px] text-fg-5 px-1">-</span>; const per = unitDiscount(eff, num(e.price)); return <Link href="/settlement?tab=coupons" className="text-[11px] text-brand hover:underline tabular-nums px-1" title={eff.parts.map(p => `${p.name} (${p.kind === 'instant' ? '즉시할인' : '다운로드'}) ${p.discount_type === 'rate' ? `${p.value}%` : `${p.value}원`}`).join('\n') + '\n정산 › 쿠폰·할인 관리에서 수정'}>−{Math.round(per).toLocaleString('ko-KR')}</Link>; })()}</td>
                          {isC && <td className="px-1"><input data-col={`rate:${c.id}`} inputMode="decimal" value={e.rate} onChange={ev => setField(r.skuId, `${c.id}:rate`, ev.target.value.replace(/[^0-9.]/g, ''))} onKeyDown={onKey} placeholder="12" className={cn(inp, 'text-right tabular-nums')} /></td>}
                        </Fragment>; })}
                      <td className="px-2 border-l border-line-2 relative">
                        <button onClick={() => { setAliasOpen(v => v === r.skuId ? null : r.skuId); setAliasDraft(''); }} className={cn('text-[11px] whitespace-nowrap hover:underline', r.aliases.length ? 'text-brand' : 'text-fg-4')} title="마켓이 쓰는 다른 이름들 — 매출 파일·주문 매칭에 사용">연동 {r.aliases.length}</button>
                        {aliasOpen === r.skuId && (
                          <div className="absolute right-0 top-9 z-30 w-80 bg-card border border-line rounded-xl shadow-lg p-3 space-y-2">
                            <div className="text-[11px] text-fg-3">이 SKU 로 잡을 마켓 상품명 (파일·주문에 나오는 그대로)</div>
                            {r.aliases.length === 0 ? <div className="text-[11px] text-fg-5">없음</div> : r.aliases.map(a => <div key={a.id} className="flex items-center gap-2 text-[12px]"><span className="flex-1 truncate" title={a.name}>{a.name}</span><button onClick={() => removeAlias(r, a)} className="text-fg-5 hover:text-danger"><Trash2 className="h-3 w-3" /></button></div>)}
                            <div className="flex gap-1"><input lang="ko" autoFocus value={aliasDraft} onChange={e => setAliasDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addAlias(r); if (e.key === 'Escape') setAliasOpen(null); }} placeholder="이름 붙여넣기 후 Enter" className="flex-1 h-8 px-2 rounded-lg border border-line text-[12px] focus:outline-none focus:border-brand" /><Button size="sm" onClick={() => addAlias(r)}>추가</Button></div>
                          </div>
                        )}
                      </td>
                      <td className="px-1 text-center">{probs.filter(p => p !== 'dirty').length === 0 ? <Check className="h-3.5 w-3.5 text-success inline" /> : <span className="text-[10px] text-warn" title={probs.filter(p => p !== 'dirty').join(', ')}>{probs.filter(p => p !== 'dirty').length}</span>}</td>
                    </tr>; })}
                </Fragment>; })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 저장 바 */}
      <div className="fixed bottom-0 left-0 right-0 z-30 md:left-[var(--sidebar-w)]">
        <div className="mx-4 md:mx-6 mb-4 rounded-2xl bg-card border border-line shadow-[0_8px_24px_rgba(0,0,0,0.12)] px-4 py-2.5 flex items-center gap-3">
          <span className="text-[12px] text-fg-3">{dirtyCount ? <><b className="text-brand">{dirtyCount}행</b> 변경됨</> : '변경 없음'}</span>
          <span className="text-[11px] text-fg-5">원가 없음 {counts.cost} · 쿠팡 옵션ID 없음 {counts.coupangId} · 판매가 없음 {counts.price}</span>
          <span className="ml-auto flex items-center gap-2">
            {dirtyCount > 0 && <Button variant="outline" size="sm" onClick={async () => { if (await confirmDialog(`${dirtyCount}행의 변경을 모두 되돌릴까요?`)) load(); }}>모두 되돌리기</Button>}
            <Button size="sm" onClick={save} disabled={saving || !dirtyCount}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 저장 (Ctrl+S)</Button>
          </span>
        </div>
      </div>
      <div className="h-14" />

    </div>
  );
}
