'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardPaste, Loader2, Plus, ScanSearch, Settings2, Trash2, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/tabs';
import { inputClassName } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { effectiveTags, effectiveVatMode, fmtNum, itemVatMode, nextVatMode, vatSplitMode, VAT_MODE_LABEL, ymLabel, type MCost, type PlLine, type Snapshot, type Tags, type VatMode } from '../_lib/settlement';
import { TagPicker } from './TagPicker';

/**
 * 정산 시트 입력 — 계산서 단위 카드에 금액만 적는 화면.
 * - 입력 모드: 항목명 · 비고 · 금액. 전월 값은 회색 안내로 보이고 한 번에 가져온다.
 * - 구조 편집 모드: 이름 · 순서 · 부호 · VAT · 매월 이월 · 분류/마켓 · 추가/삭제.
 * - 매월 이월(carry_forward) 항목은 새 달을 열면 전월 값이 자동으로 들어온다.
 */

interface Props {
  items: MCost[];
  snapshots: Snapshot[];
  loading: boolean;
  selectedYm: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
  /** 마감된 달 — 읽기 전용 */
  closed?: { closed_at: string; note?: string | null } | null;
  onToggleClosed?: (closed: boolean) => Promise<void>;
}

type SectionKey = 'revenue' | 'cogs' | 'market' | 'ad' | 'fixed';
const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: 'revenue', label: '매출', hint: '마켓 정산 화면의 월 매출. 쿠폰 차감은 로켓그로스 카드에서' },
  { key: 'cogs', label: '매입원가', hint: '위 "플랫폼별 매입원가" 업로드 → 적용으로 자동 입력' },
  { key: 'market', label: '마켓 비용 · 물류', hint: '마켓 정산서·택배 계산서 그대로' },
  { key: 'ad', label: '광고 · 마케팅', hint: '광고 플랫폼 월 청구액, 가구매·트래픽 지출' },
  { key: 'fixed', label: '고정비 · 기타', hint: '급여·구독·창고 등. 매월 같은 항목은 "매월 이월"로' },
];
const sectionOf = (line: PlLine): SectionKey =>
  line === 'revenue' || line === 'coupon' ? 'revenue' : line === 'cogs' ? 'cogs' : line === 'market_fee' || line === 'logistics' ? 'market' : line === 'ad' || line === 'marketing' ? 'ad' : 'fixed';

const SOURCE_HINTS: [RegExp, string][] = [
  [/로켓 ?그로스/, '쿠팡 윙 > 정산 > 로켓그로스 월 정산서'],
  [/택배비/, '택배사 월 계산서 — 대형은 쿠팡 입고, 소형은 자사 출고분'],
  [/플랫폼 광고비/, '각 광고센터 월 청구액 (아래 raw 집계와 비교)'],
  [/마케팅비/, '가구매·트래픽·사은품 지출 내역'],
  [/인건비/, '급여 지급액 (유류비 등 포함 시 비고에)'],
  [/SW ?비용/, '카드 명세의 구독 결제'],
  [/창고비/, '창고 임대·전기 등'],
  [/기타비/, '부자재·샘플 등 그 외 지출'],
  [/^매출$/, '각 마켓 정산 화면의 월 매출 (쿠폰 차감 전)'],
];
const sourceHint = (label: string) => SOURCE_HINTS.find(([re]) => re.test(label))?.[1];

// ── 대조(cross-check) ──
interface Ref { value: number; source: 'API' | '파일' | '설정'; detail: string }
type CheckState = { refs: Record<string, Ref>; orders: Record<string, { orders: number; qty: number }> } | null;
type Verdict = { kind: 'match' | 'diff' | 'soft' | 'none'; ref?: Ref; key?: string; diff?: number; pct?: number };
// 기준 통일: 시트·매출 파일·광고 raw·설정 = 마켓 확정 기준(구매확정/정산). API 주문 집계 = 주문일 기준 → 이월·확정 시차가 있어 "참고"로만

/** 말단 항목 → 기준값 키. 태그(손익 라인·마켓) + 라벨로 결정. */
function refKeyFor(leaf: MCost, tags: Tags, parentLabel: string): string[] {
  const L = leaf.label, P = parentLabel, m = tags.market;
  if (tags.pl_line === 'revenue') return [`revenue_file:${m}`, `revenue:${m}`];
  if (tags.pl_line === 'coupon') return [`coupon:${m}`];
  if (tags.pl_line === 'cogs') return [`cogs_file:${m}`, `cogs:${m}`];
  if (tags.pl_line === 'ad' && m === 'coupang') return ['ad:coupang'];
  if (/빈박스/.test(L) && m !== 'common') return [`emptybox:${m}`];
  if (/세이버/.test(L)) return ['saver:coupang'];
  if (/판매수수료|^수수료$/.test(L) && m !== 'common') return [`commission:${m}`];
  if (/로켓 ?그로스/.test(P) || m === 'coupang') {
    if (/입출고/.test(L)) return ['rg_inout:coupang'];
    if (/^배송비/.test(L)) return ['rg_shipping:coupang'];
    if (/반출 배송|발송/.test(L)) return ['rg_send:coupang'];
    if (/바코드|포장/.test(L)) return ['rg_packing:coupang'];
  }
  if (tags.pl_line === 'logistics' && /택배비/.test(L) && !/대형/.test(L) && m !== 'coupang') return ['shipping_small'];
  return [];
}
function verdictFor(amount: number, vatMode: VatMode, keys: string[], refs: Record<string, Ref>): Verdict {
  const key = keys.find(k => refs[k]);
  if (!key) return { kind: 'none' };
  const ref = refs[key];
  // 기준값은 대부분 VAT 포함 실거래가 → 입력이 VAT 별도면 포함가로 환산해 비교
  const mine = vatMode === 'ex' ? Math.round(amount * 1.1) : amount;
  const diff = mine - ref.value;
  const pct = ref.value ? (diff / ref.value) * 100 : 0;
  const ok = Math.abs(diff) <= 10000 || Math.abs(pct) <= 3;
  return { kind: ok ? 'match' : ref.source === 'API' ? 'soft' : 'diff', ref, key, diff, pct };
}

const prevOf = (ym: string) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export function SheetInput({ items, snapshots, loading, selectedYm, onDirtyChange, onSaved, closed, onToggleClosed }: Props) {
  const readOnly = !!closed;
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [mode, setMode] = useState<'input' | 'structure'>('input');
  const [view, setView] = useState<'input' | 'compare'>('input');
  /** 기준값을 복사해 넣기 전의 수기 값 — 저장 전까지 되돌릴 수 있다 */
  const [undo, setUndo] = useState<Map<string, number>>(new Map());
  const [local, setLocal] = useState<MCost[]>([]);
  const [amounts, setAmounts] = useState<Map<string, number>>(new Map());
  const [notes, setNotes] = useState<Map<string, string>>(new Map()); // 월별 비고 (monthly_cost_snapshots.note)
  const [qtys, setQtys] = useState<Map<string, number>>(new Map());    // 단가 항목의 월 수량 (monthly_cost_snapshots.qty)
  const [vatOv, setVatOv] = useState<Map<string, VatMode>>(new Map()); // 이 달의 VAT 구분 (항목 기본값과 다를 때만)
  const COLLAPSE_KEY = 'lv-erp-settlement-collapsed';
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => { try { const j = localStorage.getItem(COLLAPSE_KEY); if (j) setCollapsed(new Set(JSON.parse(j))); } catch {} }, []);
  const toggleCollapse = (key: string) => setCollapsed(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...n])); } catch {} return n; });
  const [carried, setCarried] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [adRaw, setAdRaw] = useState<Map<string, number>>(new Map());
  const [newLabel, setNewLabel] = useState<{ parent: string | null; value: string } | null>(null);
  const [check, setCheck] = useState<CheckState>(null);
  const [checking, setChecking] = useState(false);
  const AUTO_KEY = 'lv-erp-settlement-autocheck';
  const [autoCheck, setAutoCheck] = useState(true);
  useEffect(() => { try { setAutoCheck(localStorage.getItem(AUTO_KEY) !== 'off'); } catch {} }, []);
  const toggleAuto = (v: boolean) => { setAutoCheck(v); try { localStorage.setItem(AUTO_KEY, v ? 'on' : 'off'); } catch {} if (!v) setCheck(null); };
  useEffect(() => { setCheck(null); }, [selectedYm]);
  const toastRef = useRef(toast); toastRef.current = toast;
  const ymRef = useRef(selectedYm); ymRef.current = selectedYm;
  const checkSeq = useRef(0);
  // 의존성 없는 안정 함수 — 효과가 렌더마다 다시 도는 것을 막는다
  const runCheck = useCallback(async (manual = false) => {
    const ym = ymRef.current; const seq = ++checkSeq.current;
    setChecking(true);
    try {
      const r = await fetch(`/api/settlement/crosscheck?year_month=${ym}`);
      const j = await r.json();
      if (seq !== checkSeq.current) return; // 그 사이 월이 바뀜
      if (!r.ok) { if (manual) toastRef.current.error(j.error ?? '대조 실패'); return; }
      setCheck({ refs: j.refs ?? {}, orders: j.orders ?? {} });
      if (manual) setMode('input');
    } catch { if (manual) toastRef.current.error('대조 실패'); }
    finally { if (seq === checkSeq.current) setChecking(false); }
  }, []);
  // 자동 대조: 시트 로드 완료(저장 후 재조회 포함)마다 한 번만
  const autoRef = useRef<{ items: MCost[] | null; ym: string }>({ items: null, ym: '' });
  useEffect(() => {
    if (!autoCheck || loading || !items.length) return;
    if (autoRef.current.items === items && autoRef.current.ym === selectedYm) return; // 같은 데이터면 다시 돌지 않음
    autoRef.current = { items, ym: selectedYm };
    runCheck(false);
  }, [autoCheck, loading, items, selectedYm, runCheck]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]); // 언마운트 시 페이지 가드 해제
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const prevYm = prevOf(selectedYm);
  const snapFor = useCallback((ym: string) => { const m = new Map<string, number>(); for (const s of snapshots) if (s.year_month === ym) m.set(s.cost_id, Number(s.amount) || 0); return m; }, [snapshots]);
  const notesFor = useCallback((ym: string) => { const m = new Map<string, string>(); for (const s of snapshots) if (s.year_month === ym && s.note) m.set(s.cost_id, s.note); return m; }, [snapshots]);
  const qtysFor = useCallback((ym: string) => { const m = new Map<string, number>(); for (const s of snapshots) if (s.year_month === ym && s.qty != null) m.set(s.cost_id, Number(s.qty)); return m; }, [snapshots]);
  const vatsFor = useCallback((ym: string) => { const m = new Map<string, VatMode>(); const byId = new Map(items.map(i => [i.id, i])); for (const s of snapshots) if (s.year_month === ym && (s.vat_applicable != null || s.vat_none != null)) { const it = byId.get(s.cost_id); if (it) m.set(s.cost_id, effectiveVatMode(it, s.vat_applicable, s.vat_none)); } return m; }, [snapshots, items]);
  /** 이 달에 적용되는 VAT 구분: 달별 값 → 없으면 항목 기본값 */
  const vatEff = (leaf: MCost): VatMode => vatOv.has(leaf.id) ? vatOv.get(leaf.id)! : itemVatMode(leaf);
  const prevAmounts = useMemo(() => snapFor(prevYm), [snapFor, prevYm]);
  const savedMonths = useMemo(() => [...new Set(snapshots.map(s => s.year_month))].filter(m => m !== selectedYm).sort().reverse(), [snapshots, selectedYm]);
  const hasSnapshot = useMemo(() => snapshots.some(s => s.year_month === selectedYm), [snapshots, selectedYm]);

  // 서버 데이터 → 로컬 (저장 안 한 변경이 없을 때만)
  useEffect(() => {
    if (loading || dirtyRef.current) return;
    setLocal(items.map(i => ({ ...i })));
    const cur = snapFor(selectedYm);
    const next = new Map<string, number>();
    const auto = new Set<string>();
    for (const it of items) {
      if (cur.has(it.id)) next.set(it.id, cur.get(it.id)!);
      else if (!hasSnapshot && it.carry_forward && prevAmounts.has(it.id)) { next.set(it.id, prevAmounts.get(it.id)!); auto.add(it.id); }
      else next.set(it.id, 0);
    }
    setAmounts(next);
    setNotes(notesFor(selectedYm));
    setQtys(qtysFor(selectedYm));
    setVatOv(vatsFor(selectedYm));
    setCarried(auto);
    if (auto.size > 0) setDirty(true);
  }, [items, loading, selectedYm, snapFor, notesFor, qtysFor, vatsFor, hasSnapshot, prevAmounts]);
  /** 입력 화면 VAT 칩: 이 달에만 적용 (구조 편집의 VAT 는 새 달 기본값) */
  const setVatMonth = (id: string, v: VatMode) => { setVatOv(prev => { const n = new Map(prev); n.set(id, v); return n; }); setDirty(true); };
  /** 단가 항목: 수량 입력 → 금액 = 수량 × 단가 */
  const setQty = (id: string, q: number) => {
    const it = byId.get(id); const unit = Number(it?.unit_price) || 0;
    setQtys(prev => { const n = new Map(prev); if (q > 0) n.set(id, q); else n.delete(id); return n; });
    if (unit > 0) setAmount(id, Math.round(q * unit));
    setDirty(true);
  };
  const setNote = (id: string, v: string) => { setNotes(prev => { const n = new Map(prev); if (v) n.set(id, v); else n.delete(id); return n; }); setDirty(true); };

  // 쿠팡 광고 raw 월 집계 (광고비 칸 옆 참고값)
  useEffect(() => {
    fetch('/api/settlement/product-ads?months=1').then(r => r.json()).then(j => {
      setAdRaw(new Map((j.months ?? []).map((m: any) => [m.year_month, Number(m.cost) || 0])));
    }).catch(() => {});
  }, []);

  // ── 구조 ──
  const byId = useMemo(() => new Map(local.map(i => [i.id, i])), [local]);
  const childrenOf = useCallback((pid: string) => local.filter(i => i.parent_id === pid).sort((a, b) => a.sort_order - b.sort_order), [local]);
  const parents = useMemo(() => local.filter(i => !i.parent_id).sort((a, b) => a.sort_order - b.sort_order), [local]);
  const leavesOf = (p: MCost) => { const k = childrenOf(p.id); return k.length ? k : [p]; };
  const tagsOf = (leaf: MCost) => effectiveTags(leaf, leaf.parent_id ? byId.get(leaf.parent_id) ?? null : null);
  const groupSection = (p: MCost): SectionKey => {
    const cnt: Partial<Record<SectionKey, number>> = {};
    for (const l of leavesOf(p)) { const s = sectionOf(tagsOf(l).pl_line); cnt[s] = (cnt[s] ?? 0) + 1; }
    return (Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] as SectionKey) ?? 'fixed';
  };
  const leafValue = (leaf: MCost) => vatSplitMode(amounts.get(leaf.id) ?? 0, vatEff(leaf)).ex * (leaf.is_income ? -1 : 1);

  const patch = (id: string, p: Partial<MCost>) => { setLocal(prev => prev.map(i => i.id === id ? { ...i, ...p } : i)); setDirty(true); };
  const setAmount = (id: string, v: number) => { setAmounts(prev => { const n = new Map(prev); n.set(id, v); return n; }); setCarried(prev => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n; }); setDirty(true); };

  /** 다른 달 값 가져오기 — 기본은 빈칸만. 이미 적은 수기 값은 overwrite=true + 확인 없이는 절대 건드리지 않는다 */
  const fillFrom = async (ym: string, ids?: string[], overwrite = false) => {
    const src = snapFor(ym);
    if (!src.size) { toast.warning(`${ymLabel(ym)} 저장된 값이 없습니다`); return; }
    const targets = local.filter(it => (!ids || ids.includes(it.id)) && src.has(it.id) && (src.get(it.id) ?? 0) !== 0);
    const empty = targets.filter(it => !(amounts.get(it.id) ?? 0));
    const filled = targets.length - empty.length;
    if (overwrite) {
      if (!(await confirmDialog(`${ymLabel(ym)} 값으로 ${targets.length}칸을 덮어쓸까요?\n이미 적은 ${filled}칸이 바뀝니다. 저장 전까지는 DB 에 반영되지 않습니다.`))) return;
    }
    const apply = overwrite ? targets : empty;
    if (!apply.length) { toast.info(filled ? `빈칸이 없어 가져올 값이 없습니다 (적힌 ${filled}칸은 그대로)` : '가져올 값이 없습니다'); setFillOpen(false); return; }
    setAmounts(prev => { const n = new Map(prev); for (const it of apply) n.set(it.id, src.get(it.id)!); return n; });
    setDirty(true); setFillOpen(false);
    toast.success(`${ymLabel(ym)} 값 ${apply.length}칸 가져옴${!overwrite && filled ? ` · 이미 적힌 ${filled}칸은 그대로` : ''}`);
  };
  const clearAll = async () => {
    if (!(await confirmDialog(`${ymLabel(selectedYm)} 입력값을 모두 지울까요?\n저장 전까지는 DB 에 반영되지 않습니다.`))) return;
    setAmounts(new Map(local.map(i => [i.id, 0]))); setDirty(true);
  };

  const structKey = (list: MCost[]) => JSON.stringify(list.map(i => [i.id, i.label, i.parent_id, i.sort_order, !!i.vat_applicable, !!i.is_income, !!i.carry_forward, i.pl_line ?? null, i.market ?? null, i.alloc_rule ?? null, i.note ?? '', i.unit_price ?? null, !!i.vat_none]).sort());
  async function save() {
    setSaving(true);
    try {
      let pj: any = {};
      // 구조(이름·순서·태그 등)가 바뀐 경우에만 PUT — 금액만 바뀌면 건너뛰어 1초 안쪽
      if (structKey(local) !== structKey(items)) {
        const put = await fetch('/api/monthly-costs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: local }) });
        pj = await put.json().catch(() => ({}));
        if (!put.ok) { toast.error(`저장 실패: ${pj.error ?? put.status}`); return; }
      }
      const post = await fetch('/api/monthly-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'snapshot_items', year_month: selectedYm, amounts: local.map(i => {
        const v = check ? verdictOf(i) : null;
        return { id: i.id, amount: amounts.get(i.id) ?? 0, note: notes.get(i.id) ?? null, qty: qtys.get(i.id) ?? null, vat_applicable: vatOv.has(i.id) ? vatOv.get(i.id) === 'ex' : null, vat_none: vatOv.has(i.id) ? vatOv.get(i.id) === 'none' : null, ...(check ? { ref_amount: v?.ref?.value ?? null, ref_source: v?.ref?.source ?? null, ref_detail: v?.ref?.detail ?? null } : {}) };
      }) }) });
      const sj = await post.json().catch(() => ({}));
      if (!post.ok) { toast.error(`금액 저장 실패: ${sj.error ?? post.status}`); return; }
      setDirty(false); setCarried(new Set()); setUndo(new Map());
      const warn = [pj.needsMigration ? '분류 태그' : null, sj.notesSaved === false ? '월별 비고' : null, sj.refsSaved === false ? '기준값' : null].filter(Boolean);
      toast.success(`${ymLabel(selectedYm)} 저장 완료${warn.length ? ` (${warn.join('·')}는 마이그레이션 00057/00059/00060 적용 후 저장됩니다)` : ''}`);
      onSaved?.();
    } finally { setSaving(false); }
  }

  async function addItem(parentId: string | null) {
    const label = newLabel?.value.trim();
    if (!label) return;
    const res = await fetch('/api/monthly-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, amount: 0, parent_id: parentId }) });
    const created = await res.json().catch(() => null);
    if (!created?.id) { toast.error('추가 실패'); return; }
    setLocal(prev => [...prev, { ...created, amount: 0 }]);
    setAmounts(prev => new Map(prev).set(created.id, 0));
    setNewLabel(null);
  }
  async function removeItem(id: string) {
    const target = byId.get(id);
    const probe = await fetch(`/api/monthly-costs?id=${id}`, { method: 'DELETE' });
    const info = await probe.json().catch(() => ({}));
    if (probe.status !== 409) { toast.error(info.error ?? '삭제 확인 실패'); return; }
    const detail = [info.childCount > 0 ? `세부항목 ${info.childCount}개` : null, info.snapshotCount > 0 ? `저장된 월 이력 ${info.snapshotCount}건` : null].filter(Boolean).join(' · ');
    if (!(await confirmDialog(`'${target?.label}' 을 삭제할까요?\n${detail ? detail + ' 이 함께 삭제되며 ' : ''}되돌릴 수 없습니다. 이번 달만 0 이면 금액을 비우세요.`))) return;
    const res = await fetch(`/api/monthly-costs?id=${id}&confirm=1`, { method: 'DELETE' });
    if (!res.ok) { toast.error('삭제 실패'); return; }
    setLocal(prev => prev.filter(i => i.id !== id && i.parent_id !== id));
    toast.success('삭제했습니다');
  }
  const move = (id: string, dir: -1 | 1) => {
    const it = byId.get(id); if (!it) return;
    const sib = local.filter(i => i.parent_id === it.parent_id).sort((a, b) => a.sort_order - b.sort_order);
    const idx = sib.findIndex(s => s.id === id); const j = idx + dir;
    if (j < 0 || j >= sib.length) return;
    const order = sib.map(s => s.id); [order[idx], order[j]] = [order[j], order[idx]];
    const om = new Map(order.map((sid, i) => [sid, i]));
    setLocal(prev => prev.map(i => om.has(i.id) ? { ...i, sort_order: om.get(i.id)! } : i)); setDirty(true);
  };

  // ── 통계 ──
  const allLeaves = parents.flatMap(leavesOf);
  const blanks = allLeaves.filter(l => !(amounts.get(l.id) ?? 0)).length;
  const changed = dirty;

  if (loading && local.length === 0) return <div className="bg-card rounded-2xl p-8 text-center text-[13px] text-fg-4">불러오는 중…</div>;

  const sections = SECTIONS.map(sec => ({ ...sec, groups: parents.filter(p => groupSection(p) === sec.key) })).filter(s => s.groups.length);
  const verdictOf = (leaf: MCost): Verdict => {
    if (!check) return { kind: 'none' };
    const parent = leaf.parent_id ? byId.get(leaf.parent_id) : null;
    return verdictFor(amounts.get(leaf.id) ?? 0, vatEff(leaf), refKeyFor(leaf, tagsOf(leaf), parent?.label ?? ''), check.refs);
  };
  const checkStats = check ? allLeaves.reduce((s, l) => { const v = verdictOf(l); s[v.kind] += 1; return s; }, { match: 0, diff: 0, soft: 0, none: 0 }) : null;

  return (
    <div className="space-y-4 pb-20">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h3 className="text-[15px] font-bold text-fg">정산 시트 <span className="text-brand">{ymLabel(selectedYm)}</span></h3>
          <p className="text-[12px] text-fg-3 mt-0.5">
            {hasSnapshot ? '저장된 달입니다. 고친 뒤 아래 저장을 누르세요.' : carried.size ? `새 달입니다. 매월 이월 항목 ${carried.size}개는 전월 값이 들어왔습니다.` : '새 달입니다. 전월 값을 가져온 뒤 바뀐 것만 고치면 빠릅니다.'}
            {blanks > 0 && <span className="text-fg-4"> · 빈칸 {blanks}</span>}
          </p>
        </div>
        {!readOnly && <div className="relative">
          <Button variant="outline" size="sm" onClick={() => setFillOpen(o => !o)}><ClipboardPaste /> 다른 달 값 가져오기</Button>
          {fillOpen && (
            <div className="absolute right-0 top-full mt-1 z-40 w-48 rounded-xl border border-line bg-card shadow-lg py-1">
              {savedMonths.length === 0 ? <p className="px-3 py-2 text-[12px] text-fg-4">저장된 달이 없습니다</p> :
                savedMonths.map(ym => (
                  <div key={ym} className="flex items-center hover:bg-app">
                    <button onClick={() => fillFrom(ym)} className="flex-1 text-left px-3 py-2 text-[12px] text-fg">{ymLabel(ym)}{ym === prevYm && <span className="text-fg-4"> · 전월</span>}</button>
                    <button onClick={() => fillFrom(ym, undefined, true)} className="px-2 py-2 text-[10px] text-fg-4 hover:text-danger" title="이미 적은 값까지 덮어쓰기 (확인창)">덮어쓰기</button>
                  </div>
                ))}
              <p className="px-3 py-1 text-[10px] text-fg-5">월 이름을 누르면 빈칸만 채웁니다</p>
              <div className="border-t border-line-2 mt-1 pt-1">
                <button onClick={() => { setFillOpen(false); clearAll(); }} className="w-full text-left px-3 py-2 text-[12px] text-danger hover:bg-app">이 달 값 모두 지우기</button>
              </div>
            </div>
          )}
        </div>}
        <label className="flex items-center gap-1.5 text-[12px] text-fg-3 cursor-pointer select-none mr-1" title="켜 두면 시트를 열거나 저장할 때마다 자동으로 대조합니다 (약 2~3초, 화면을 막지 않음)">
          <input type="checkbox" className="accent-brand" checked={autoCheck} onChange={e => toggleAuto(e.target.checked)} /> 자동 대조
        </label>
        {check && !autoCheck ? (
          <Button variant="outline" size="sm" onClick={() => setCheck(null)} className="border-brand/40 text-brand"><X /> 대조 끄기</Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => runCheck(true)} disabled={checking} title="주문 동기화(API)·매출 파일·광고 raw·설정으로 계산한 기준값과 비교합니다">
            {checking ? <Loader2 className="animate-spin" /> : <ScanSearch />} {checking ? '대조 중' : check ? '다시 대조' : 'API 대조'}
          </Button>
        )}
        {!readOnly && <Button variant={mode === 'structure' ? 'default' : 'outline'} size="sm" onClick={() => { setMode(m => m === 'input' ? 'structure' : 'input'); setView('input'); }}>
          <Settings2 /> {mode === 'structure' ? '입력으로 돌아가기' : '항목 구조 편집'}
        </Button>}
      </div>
      {mode === 'input' && (
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl items={[{ value: 'input', label: '입력' }, { value: 'compare', label: '수기 vs API 비교' }] as const} value={view} onChange={setView} />
          {view === 'compare' && <span className="text-[11px] text-fg-4">수기 값은 여기서 바꿀 수 없습니다. 기준값은 참고용이며 시트에 자동 반영되지 않습니다.</span>}
          {undo.size > 0 && <span className="text-[11px] text-warn">기준값을 복사한 칸 {undo.size}개 — 저장 전까지 각 칸에서 되돌릴 수 있습니다</span>}
        </div>
      )}

      {closed && (
        <div className="rounded-xl border border-fg/15 bg-card-2 px-4 py-2.5 text-[12px] text-fg-2 flex flex-wrap items-center gap-3">
          <span className="font-semibold text-fg">🔒 {ymLabel(selectedYm)} 마감됨</span>
          <span className="text-fg-4">{new Date(closed.closed_at).toLocaleString('ko-KR')}{closed.note ? ` · ${closed.note}` : ''} — 금액·비고를 바꿀 수 없습니다.</span>
          {onToggleClosed && <button onClick={async () => { if (await confirmDialog(`${ymLabel(selectedYm)} 마감을 해제할까요?\n해제하면 다시 수정할 수 있습니다. 수정 후 다시 마감하세요.`)) await onToggleClosed(false); }} className="ml-auto text-brand hover:underline">마감 해제</button>}
        </div>
      )}
      {mode === 'structure' && (
        <div className="rounded-xl border border-brand/30 bg-brand-soft px-4 py-2.5 text-[12px] text-fg-2">
          구조 편집: 항목 이름·순서·부호(+ 수입 / − 비용)·VAT·매월 이월·분류/마켓을 바꿉니다. 여기서 바꾼 이름과 분류는 모든 달에 적용됩니다. 저장을 눌러야 반영됩니다.
        </div>
      )}

      {check && checkStats && view === 'input' && (
        <div className="text-[12px] text-fg-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-success/70" /> 일치 {checkStats.match}</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-danger/70" /> 차이 {checkStats.diff}</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-fg-4/60" /> API 참고 {checkStats.soft}</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-warn/70" /> 대조 불가 {checkStats.none}</span>
          <button onClick={() => setView('compare')} className="text-brand hover:underline">자세히 · 수기 vs API 비교</button>
        </div>
      )}

      {view === 'compare' && mode === 'input' ? (
        <CompareView sections={sections} leavesOf={leavesOf} amounts={amounts} vatEff={vatEff} verdictOf={verdictOf} checking={checking} hasCheck={!!check} onRun={() => runCheck(true)} readOnly={readOnly} undo={undo}
          applyRef={async (id, refValue, vatApplicable) => {
            const cur = amounts.get(id) ?? 0; const next = vatApplicable ? Math.round(refValue / 1.1) : refValue;
            if (cur && !(await confirmDialog(`수기 입력 ${fmtNum(cur)}원을 기준값 ${fmtNum(next)}원으로 바꿀까요?\n저장 전까지 되돌릴 수 있습니다.`))) return;
            setUndo(prev => { const n = new Map(prev); if (!n.has(id)) n.set(id, cur); return n; });
            setAmount(id, next);
          }}
          revertRef={(id) => { const v = undo.get(id); if (v === undefined) return; setUndo(prev => { const n = new Map(prev); n.delete(id); return n; }); setAmount(id, v); }} />
      ) : sections.map(sec => (
        <section key={sec.key}>
          <div className="flex items-baseline gap-2 mb-2 px-1">
            <button onClick={() => toggleCollapse(`sec:${sec.key}`)} className="text-[13px] font-bold text-fg flex items-center gap-1" title={collapsed.has(`sec:${sec.key}`) ? '펼치기' : '접기'}>
              <span className="text-fg-4 text-[11px]">{collapsed.has(`sec:${sec.key}`) ? '▶' : '▼'}</span>{sec.label}
            </button>
            <span className="text-[11px] text-fg-4">{sec.hint}</span>
            {(() => { const v = sec.groups.reduce((s, g) => s + leavesOf(g).reduce((t, l) => t + leafValue(l), 0), 0); return <span className={cn('ml-auto text-[12px] tabular-nums font-semibold', v < 0 ? 'text-success' : 'text-fg-2')}>{v < 0 ? '+' : ''}{fmtNum(Math.abs(v))}원</span>; })()}
          </div>
          {!collapsed.has(`sec:${sec.key}`) && <div className="grid gap-3">
            {sec.groups.map(g => (
              <GroupCard key={g.id} group={g} leaves={leavesOf(g)} isSingle={childrenOf(g.id).length === 0} mode={mode} collapsed={collapsed.has(`grp:${g.id}`)} onToggle={() => toggleCollapse(`grp:${g.id}`)} vatEff={vatEff} setVatMonth={setVatMonth}
                amounts={amounts} prevAmounts={prevAmounts} carried={carried} adRaw={adRaw.get(selectedYm)} notes={notes} setNote={setNote} qtys={qtys} setQty={setQty}
                tagsOf={tagsOf} leafValue={leafValue} setAmount={setAmount} patch={patch} move={move} removeItem={removeItem} verdictOf={check ? verdictOf : undefined}
                readOnly={readOnly} undo={undo} applyRef={async (id, refValue, vatApplicable) => {
                  const cur = amounts.get(id) ?? 0; const next = vatApplicable ? Math.round(refValue / 1.1) : refValue;
                  if (cur && !(await confirmDialog(`수기 입력 ${fmtNum(cur)}원을 기준값 ${fmtNum(next)}원으로 바꿀까요?\n저장 전까지 이 칸에서 되돌릴 수 있습니다.`))) return;
                  setUndo(prev => { const n = new Map(prev); if (!n.has(id)) n.set(id, cur); return n; });
                  setAmount(id, next);
                }} revertRef={(id) => { const v = undo.get(id); if (v === undefined) return; setUndo(prev => { const n = new Map(prev); n.delete(id); return n; }); setAmount(id, v); }}
                onFillPrev={() => fillFrom(prevYm, leavesOf(g).map(l => l.id))} prevYm={prevYm}
                newLabel={newLabel} setNewLabel={setNewLabel} addItem={addItem} />
            ))}
            {mode === 'structure' && sec.key === 'fixed' && (
              <div className="rounded-2xl border border-dashed border-line p-4 flex items-center justify-center">
                {newLabel?.parent === null ? (
                  <div className="flex items-center gap-2 w-full">
                    <input autoFocus className={cn(inputClassName, 'flex-1')} placeholder="새 묶음 이름 (예: 택배비)" value={newLabel.value} onChange={e => setNewLabel({ parent: null, value: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') addItem(null); if (e.key === 'Escape') setNewLabel(null); }} />
                    <Button size="sm" onClick={() => addItem(null)}>추가</Button>
                    <Button size="sm" variant="ghost" onClick={() => setNewLabel(null)}>취소</Button>
                  </div>
                ) : <Button variant="ghost" size="sm" onClick={() => setNewLabel({ parent: null, value: '' })}><Plus /> 새 묶음 추가</Button>}
              </div>
            )}
          </div>}
        </section>
      ))}

      {/* 하단 고정 바 */}
      <div className="fixed bottom-0 left-0 right-0 z-30 md:left-[220px]">
        <div className="mx-auto max-w-[1100px] px-4 pb-4">
          <div className={cn('flex items-center gap-3 rounded-2xl border px-4 py-2.5 shadow-lg backdrop-blur', changed ? 'bg-card border-brand/40' : 'bg-card/90 border-line')}>
            <span className="text-[12px] text-fg-3">
              {changed ? <span className="text-fg font-semibold">저장하지 않은 변경이 있습니다</span> : '변경 없음'}
              {carried.size > 0 && <span className="text-fg-4"> · 이월 {carried.size}개</span>}
            </span>
            <span className="ml-auto text-[12px] tabular-nums text-fg-4 hidden sm:inline">빈칸 {blanks} / {allLeaves.length}</span>
            {readOnly ? (
              <span className="text-[12px] font-semibold text-fg-3">🔒 마감됨</span>
            ) : (
              <>
                {onToggleClosed && hasSnapshot && !changed && (
                  <Button variant="outline" onClick={async () => { if (await confirmDialog(`${ymLabel(selectedYm)} 을 마감할까요?\n마감하면 이 달 시트가 읽기 전용이 되고, 매출 파일 적용도 막힙니다. 필요하면 해제할 수 있습니다.`)) await onToggleClosed(true); }} title="저장이 끝난 달을 잠급니다">월 마감</Button>
                )}
                <Button onClick={save} disabled={saving || !changed}>{saving ? <Loader2 className="animate-spin" /> : null} {ymLabel(selectedYm)} 저장</Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── 카드 ─────────────────────────

interface CardProps {
  group: MCost; leaves: MCost[]; isSingle: boolean; mode: 'input' | 'structure';
  amounts: Map<string, number>; prevAmounts: Map<string, number>; carried: Set<string>; adRaw?: number;
  tagsOf: (l: MCost) => ReturnType<typeof effectiveTags>; leafValue: (l: MCost) => number;
  notes: Map<string, string>; setNote: (id: string, v: string) => void;
  qtys: Map<string, number>; setQty: (id: string, q: number) => void;
  setAmount: (id: string, v: number) => void; patch: (id: string, p: Partial<MCost>) => void; move: (id: string, d: -1 | 1) => void; removeItem: (id: string) => void;
  onFillPrev: () => void; prevYm: string; verdictOf?: (l: MCost) => Verdict;
  undo: Map<string, number>; applyRef: (id: string, refValue: number, vatApplicable: boolean) => void; revertRef: (id: string) => void;
  readOnly: boolean;
  collapsed: boolean; onToggle: () => void;
  vatEff: (l: MCost) => VatMode; setVatMonth: (id: string, v: VatMode) => void;
  newLabel: { parent: string | null; value: string } | null; setNewLabel: (v: { parent: string | null; value: string } | null) => void; addItem: (parent: string | null) => void;
}

function GroupCard({ group, leaves, isSingle, mode, amounts, prevAmounts, carried, adRaw, notes, setNote, qtys, setQty, tagsOf, leafValue, setAmount, patch, move, removeItem, onFillPrev, prevYm, verdictOf, undo, applyRef, revertRef, readOnly, collapsed, onToggle, vatEff, setVatMonth, newLabel, setNewLabel, addItem }: CardProps) {
  const subtotal = leaves.reduce((s, l) => s + leafValue(l), 0);
  const hint = sourceHint(group.label);
  const prevHas = leaves.some(l => prevAmounts.has(l.id) && prevAmounts.get(l.id));
  const blanks = leaves.filter(l => !(amounts.get(l.id) ?? 0)).length;
  return (
    <div className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line-2">
        {mode === 'structure' ? (
          <>
            <button onClick={() => move(group.id, -1)} className="text-fg-5 hover:text-fg" title="위로"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button onClick={() => move(group.id, 1)} className="text-fg-5 hover:text-fg" title="아래로"><ArrowDown className="h-3.5 w-3.5" /></button>
            <input lang="ko" value={group.label} onChange={e => patch(group.id, { label: e.target.value })} className={cn(inputClassName, 'h-7 w-40 font-bold')} />
            <button onClick={() => removeItem(group.id)} className="text-fg-5 hover:text-danger ml-auto" title="묶음 삭제"><Trash2 className="h-3.5 w-3.5" /></button>
          </>
        ) : (
          <>
            <button onClick={onToggle} className="min-w-0 mr-auto text-left flex items-start gap-1.5" title={collapsed ? '펼치기' : '접기'}>
              <span className="text-fg-4 text-[10px] mt-1">{collapsed ? '▶' : '▼'}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-fg truncate">{group.label}{collapsed && <span className="ml-1.5 text-[11px] font-normal text-fg-4">{leaves.length}항목</span>}</span>
                {hint && !collapsed && <span className="block text-[11px] text-fg-4 truncate" title={hint}>{hint}</span>}
              </span>
            </button>
            {prevHas && blanks > 0 && !readOnly && <button onClick={onFillPrev} className="text-[11px] text-brand hover:underline whitespace-nowrap" title={`${ymLabel(prevYm)} 값으로 채우기`}>전월 값 채우기</button>}
            <span className={cn('text-[13px] font-semibold tabular-nums whitespace-nowrap', subtotal < 0 ? 'text-success' : 'text-fg')}>{subtotal < 0 ? '+' : ''}{fmtNum(Math.abs(subtotal))}원</span>
          </>
        )}
      </div>
      {!(collapsed && mode === 'input') && <div className="px-2 py-1">
        {leaves.map(leaf => {
          const tags = tagsOf(leaf);
          const isAdCoupang = tags.pl_line === 'ad' && tags.market === 'coupang';
          const amt = amounts.get(leaf.id) ?? 0;
          const prev = prevAmounts.get(leaf.id);
          const incl = vatSplitMode(amt, vatEff(leaf)).incl;
          const v = verdictOf?.(leaf);
          const blockCls = !v ? '' : v.kind === 'match' ? 'border-l-[3px] border-success bg-success/[0.04]' : v.kind === 'diff' ? 'border-l-[3px] border-danger bg-danger/[0.06]' : v.kind === 'soft' ? 'border-l-[3px] border-fg-5 bg-card-2' : 'border-l-[3px] border-warn bg-warn/[0.07]';
          return (
            <div key={leaf.id} className={cn('rounded-lg', blockCls)}>
            <div className={cn('flex items-center gap-2 px-2 py-1.5 rounded-lg', carried.has(leaf.id) && !v && 'bg-brand-soft')}>
              {mode === 'structure' ? (
                <>
                  {!isSingle && <span className="flex flex-col"><button onClick={() => move(leaf.id, -1)} className="text-fg-5 hover:text-fg"><ArrowUp className="h-3 w-3" /></button><button onClick={() => move(leaf.id, 1)} className="text-fg-5 hover:text-fg"><ArrowDown className="h-3 w-3" /></button></span>}
                  <input lang="ko" value={leaf.label} onChange={e => patch(leaf.id, { label: e.target.value })} className={cn(inputClassName, 'h-7 w-36 text-[12px]')} />
                  <Chip on={!!leaf.is_income} onClick={() => patch(leaf.id, { is_income: !leaf.is_income })} title="+ 수입(차감) / − 비용">{leaf.is_income ? '+ 수입' : '− 비용'}</Chip>
                  <Chip on={itemVatMode(leaf) !== 'incl'} onClick={() => { const n = nextVatMode(itemVatMode(leaf)); patch(leaf.id, { vat_applicable: n === 'ex', vat_none: n === 'none' }); }} title="새 달 기본값. 포함 → 별도 → 없음 순으로 바뀝니다. VAT없음 = 급여·개인거래처럼 부가세가 없는 금액">{VAT_MODE_LABEL[itemVatMode(leaf)]}</Chip>
                  <Chip on={!!leaf.carry_forward} onClick={() => patch(leaf.id, { carry_forward: !leaf.carry_forward })} title="새 달을 열면 전월 값 자동 입력">매월 이월</Chip>
                  <input value={leaf.unit_price ?? ''} onChange={e => patch(leaf.id, { unit_price: e.target.value === '' ? null : Number(e.target.value.replace(/[^0-9.]/g, '')) })} placeholder="건당 단가" inputMode="numeric" title="건당 단가를 넣으면 입력 화면에서 수량만 적어 금액이 계산됩니다" className={cn(inputClassName, 'h-7 w-24 text-[11px] text-right')} />
                  <input lang="ko" value={leaf.note ?? ''} onChange={e => patch(leaf.id, { note: e.target.value })} placeholder="공통 메모 (모든 달)" className={cn(inputClassName, 'h-7 w-32 text-[11px]')} />
                  <span className="ml-auto"><TagPicker item={leaf} parent={isSingle ? null : group} onChange={p => patch(leaf.id, p)} /></span>
                  {!isSingle && <button onClick={() => removeItem(leaf.id)} className="text-fg-5 hover:text-danger" title="삭제"><Trash2 className="h-3.5 w-3.5" /></button>}
                </>
              ) : (
                <>
                  <div className="w-52 shrink-0 min-w-0">
                    <div className="text-[13px] text-fg truncate" title={leaf.label}>{leaf.label}</div>
                    <div className="text-[10px] text-fg-5 truncate" title={leaf.note ? `공통 메모: ${leaf.note}` : ''}>
                      {leaf.is_income ? '수입' : '비용'}{leaf.carry_forward ? ' · 매월 이월' : ''}{leaf.note ? ` · ${leaf.note}` : ''}
                    </div>
                  </div>
                  <Chip on={vatEff(leaf) !== 'incl'} onClick={() => !readOnly && setVatMonth(leaf.id, nextVatMode(vatEff(leaf)))} title={`이 달의 입력값 기준: VAT포함 = 세후 / VAT별도 = 세전 / VAT없음 = 부가세 없는 금액. 이 달에만 적용됩니다${vatOvMark(leaf, vatEff) ? ' (항목 기본값과 다름)' : ''}`}>{VAT_MODE_LABEL[vatEff(leaf)]}{vatOvMark(leaf, vatEff) ? '*' : ''}</Chip>
                  <input lang="ko" readOnly={readOnly} value={notes.get(leaf.id) ?? ''} onChange={e => setNote(leaf.id, e.target.value)} placeholder="이 달 비고" title="이 달에만 남는 메모 (공통 메모는 항목명 아래)"
                    className="flex-1 min-w-0 h-7 px-2 rounded-md text-[11px] text-fg-3 bg-transparent border border-transparent hover:border-line focus:border-brand focus:bg-card focus:outline-none" />
                  {isAdCoupang && adRaw != null && (
                    <span className="text-[10px] text-fg-4 whitespace-nowrap" title="광고분석 raw 월 집계 (참고)">raw {fmtNum(adRaw)}</span>
                  )}
                  {!amt && prev && !readOnly ? (
                    <button onClick={() => setAmount(leaf.id, prev)} className="text-[10px] text-fg-4 hover:text-brand whitespace-nowrap flex items-center gap-0.5" title={`${ymLabel(prevYm)} 값 가져오기`}><Undo2 className="h-3 w-3" />{fmtNum(prev)}</button>
                  ) : carried.has(leaf.id) ? <span className="text-[10px] text-brand whitespace-nowrap">이월</span> : null}
                  {Number(leaf.unit_price) > 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-fg-4 whitespace-nowrap">
                      <input type="text" inputMode="numeric" value={qtys.get(leaf.id) ?? ''} placeholder="수량" disabled={readOnly}
                        onChange={e => setQty(leaf.id, Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                        className={cn(inputClassName, 'h-9 w-16 text-right text-[13px] tabular-nums')} />
                      × {fmtNum(Number(leaf.unit_price))}
                    </span>
                  )}
                  <MoneyInput value={amt} onChange={v => setAmount(leaf.id, v)} income={!!leaf.is_income} disabled={readOnly} />
                  {v && <VerdictBadge v={v} />}
                  <span className="w-20 text-right text-[10px] text-fg-5 tabular-nums whitespace-nowrap hidden sm:inline" title="VAT 포함 환산 (VAT 별도 항목만)">{amt && vatEff(leaf) === 'ex' ? `≈${fmtNum(incl)}` : ''}</span>
                </>
              )}
            </div>
            </div>
          );
        })}
        {mode === 'structure' && !isSingle && (
          newLabel?.parent === group.id ? (
            <div className="flex items-center gap-2 px-2 py-1.5">
              <input autoFocus className={cn(inputClassName, 'h-7 w-40 text-[12px]')} placeholder="세부항목 이름" value={newLabel.value} onChange={e => setNewLabel({ parent: group.id, value: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') addItem(group.id); if (e.key === 'Escape') setNewLabel(null); }} />
              <Button size="sm" onClick={() => addItem(group.id)}>추가</Button>
              <Button size="sm" variant="ghost" onClick={() => setNewLabel(null)}>취소</Button>
            </div>
          ) : <button onClick={() => setNewLabel({ parent: group.id, value: '' })} className="px-2 py-1.5 text-[11px] text-brand hover:underline flex items-center gap-1"><Plus className="h-3 w-3" /> 세부항목</button>
        )}
      </div>}
    </div>
  );
}

// ───────────────────────── 수기 vs API 비교 뷰 (읽기 전용) ─────────────────────────
function CompareView({ sections, leavesOf, amounts, vatEff, verdictOf, checking, hasCheck, onRun, readOnly, undo, applyRef, revertRef }: {
  sections: { key: SectionKey; label: string; groups: MCost[] }[];
  leavesOf: (p: MCost) => MCost[];
  amounts: Map<string, number>;
  vatEff: (l: MCost) => VatMode;
  verdictOf: (l: MCost) => Verdict;
  checking: boolean; hasCheck: boolean; onRun: () => void;
  readOnly: boolean; undo: Map<string, number>; applyRef: (id: string, refValue: number, vatApplicable: boolean) => void; revertRef: (id: string) => void;
}) {
  if (!hasCheck) {
    return (
      <div className="bg-card rounded-2xl p-8 text-center text-[13px] text-fg-4">
        {checking ? '기준값을 계산하는 중입니다…' : <>아직 대조하지 않았습니다. <button onClick={onRun} className="text-brand font-semibold hover:underline">지금 대조</button></>}
      </div>
    );
  }
  const th = 'h-9 px-3 text-[11px] font-semibold text-fg-4 whitespace-nowrap';
  const mine = (leaf: MCost) => { const a = amounts.get(leaf.id) ?? 0; return vatEff(leaf) === 'ex' ? Math.round(a * 1.1) : a; };
  return (
    <div className="space-y-4">
      {sections.map(sec => {
        const rows = sec.groups.flatMap(g => leavesOf(g).map(l => ({ g, l, v: verdictOf(l) })));
        const sumMine = rows.reduce((s, r) => s + mine(r.l) * (r.l.is_income ? -1 : 1), 0);
        const sumRef = rows.reduce((s, r) => s + (r.v.ref ? r.v.ref.value * (r.l.is_income ? -1 : 1) : 0), 0);
        const refCount = rows.filter(r => r.v.ref).length;
        return (
          <section key={sec.key} className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-line-2">
              <h4 className="text-[13px] font-bold text-fg mr-auto">{sec.label}</h4>
              <span className="text-[11px] text-fg-4">수기 합 <b className="text-fg tabular-nums">{fmtNum(Math.abs(sumMine))}</b> · 기준 합 <b className="text-fg tabular-nums">{fmtNum(Math.abs(sumRef))}</b> ({refCount}/{rows.length}칸 대조)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] border-collapse min-w-[720px]">
                <thead><tr className="border-b border-line">
                  <th className={cn(th, 'text-left')}>항목</th>
                  <th className={cn(th, 'text-right')} title="시트에 적은 값 (VAT 포함 환산)">수기 입력</th>
                  <th className={cn(th, 'text-right')} title="API·파일·설정으로 계산한 값">기준값</th>
                  <th className={cn(th, 'text-right')}>차이</th>
                  <th className={cn(th, 'text-left')}>출처</th>
                  <th className={cn(th, 'text-right')} />
                </tr></thead>
                <tbody>
                  {rows.map(({ g, l, v }) => {
                    const m = mine(l);
                    const cls = v.kind === 'match' ? 'text-success' : v.kind === 'diff' ? 'text-danger' : v.kind === 'soft' ? 'text-fg-3' : 'text-fg-5';
                    return (
                      <tr key={l.id} className={cn('border-b border-line-2 h-10', v.kind === 'diff' && 'bg-danger/5', v.kind === 'none' && 'bg-warn/5')}>
                        <td className="px-3 text-fg whitespace-nowrap">{g.id !== l.id && <span className="text-fg-4">{g.label} · </span>}{l.label}{vatEff(l) === 'ex' && <span className="ml-1 text-[10px] text-fg-5">VAT별도→포함</span>}{vatEff(l) === 'none' && <span className="ml-1 text-[10px] text-fg-5">VAT없음</span>}</td>
                        <td className="px-3 text-right tabular-nums font-semibold text-fg">{m ? fmtNum(m) : <span className="text-fg-5">-</span>}</td>
                        <td className="px-3 text-right tabular-nums text-fg-2">{v.ref ? fmtNum(v.ref.value) : <span className="text-warn">대조 불가</span>}</td>
                        <td className={cn('px-3 text-right tabular-nums font-semibold', cls)}>{v.ref ? `${v.diff! > 0 ? '+' : ''}${fmtNum(v.diff!)} (${v.pct! > 0 ? '+' : ''}${v.pct!.toFixed(1)}%)` : '-'}</td>
                        <td className="px-3 text-[11px] text-fg-4 whitespace-nowrap">{v.ref ? <><span className={cn('rounded px-1 text-[10px] mr-1', v.ref.source === 'API' ? 'bg-app text-fg-4' : 'bg-brand-bg text-brand')}>{v.ref.source === 'API' ? 'API 참고' : v.ref.source}</span>{v.ref.detail}</> : '계산서로 직접 확인'}</td>
                        <td className="px-3 text-right text-[11px] whitespace-nowrap">
                          {undo.has(l.id) ? (
                            <button onClick={() => revertRef(l.id)} className="text-warn font-semibold hover:underline">수기 {fmtNum(undo.get(l.id)!)} 되돌리기</button>
                          ) : (v.kind === 'diff' || v.kind === 'soft') && !readOnly ? (
                            <button onClick={() => applyRef(l.id, v.ref!.value, vatEff(l) === 'ex')} className="text-brand hover:underline" title="확인 후 수기 값을 기준값으로 바꿉니다. 저장 전까지 되돌릴 수 있습니다">기준값 복사</button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** 입력 화면용 작은 대조 배지 — 자세한 내용은 툴팁과 비교 뷰에 */
function VerdictBadge({ v }: { v: Verdict }) {
  const tip = v.ref ? `기준 ${fmtNum(v.ref.value)}원 · ${v.ref.source === 'API' ? 'API 참고(주문일 기준)' : v.ref.source} · ${v.ref.detail}${v.diff != null ? ` · 차이 ${v.diff > 0 ? '+' : ''}${fmtNum(v.diff)} (${v.pct! > 0 ? '+' : ''}${v.pct!.toFixed(1)}%)` : ''}` : '대조할 데이터가 없습니다 · 계산서로 확인';
  const cls = v.kind === 'match' ? 'text-success' : v.kind === 'diff' ? 'text-danger' : v.kind === 'soft' ? 'text-fg-4' : 'text-warn';
  const text = v.kind === 'match' ? '✓' : v.kind === 'none' ? '?' : `${v.pct! > 0 ? '▲' : '▼'}${Math.abs(v.pct!).toFixed(0)}%`;
  return <span className={cn('w-12 text-right text-[11px] font-semibold tabular-nums cursor-help', cls)} title={tip}>{text}</span>;
}

const vatOvMark = (leaf: MCost, eff: (l: MCost) => VatMode) => eff(leaf) !== itemVatMode(leaf);

function Chip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} title={title} className={cn('h-6 px-2 rounded-md text-[10px] font-semibold whitespace-nowrap transition-colors', on ? 'bg-brand text-white' : 'bg-app text-fg-3 hover:bg-line')}>{children}</button>;
}

/** 콤마 표시 금액 입력. Enter → 다음 금액 칸. */
function MoneyInput({ value, onChange, income, disabled }: { value: number; onChange: (v: number) => void; income: boolean; disabled?: boolean }) {
  const [text, setText] = useState(value ? fmtNum(value) : '');
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(value ? fmtNum(value) : ''); }, [value, focus]);
  return (
    <input type="text" inputMode="numeric" data-money value={text} placeholder="0" disabled={disabled}
      onFocus={e => { setFocus(true); e.target.select(); }}
      onBlur={() => setFocus(false)}
      onChange={e => { const n = Number(e.target.value.replace(/[^0-9]/g, '')) || 0; setText(n ? fmtNum(n) : ''); onChange(n); }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const all = [...document.querySelectorAll<HTMLInputElement>('input[data-money]')];
          const i = all.indexOf(e.currentTarget); all[i + 1]?.focus();
        }
      }}
      className={cn(inputClassName, 'w-40 h-9 text-right text-[14px] tabular-nums font-semibold', income ? 'text-success' : 'text-fg', !value && 'font-normal')} />
  );
}
