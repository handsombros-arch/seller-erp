'use client';

import { useEffect, useState } from 'react';
import { Plus, Loader2, Trash2, ChevronDown, ChevronRight, ClipboardPaste, Lock, Unlock, RotateCcw, GripVertical } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { type MCost, type Snapshot, ymLabel } from '../_lib/settlement';
import { TagPicker } from './TagPicker';

// ───────────────── 월 정산 입력 트리 ─────────────────

type CostCategory = 'revenue' | 'cogs' | 'ad' | 'fixed' | 'variable';
const CATEGORIES: { id: CostCategory; label: string; color: string; bgColor: string }[] = [
  { id: 'revenue', label: '매출', color: 'text-emerald-700', bgColor: 'bg-emerald-50 border-emerald-200' },
  { id: 'cogs', label: '매입원가', color: 'text-orange-700', bgColor: 'bg-orange-50 border-orange-200' },
  { id: 'ad', label: '광고/마케팅', color: 'text-violet-700', bgColor: 'bg-violet-50 border-violet-200' },
  { id: 'fixed', label: '고정비', color: 'text-slate-700', bgColor: 'bg-slate-50 border-slate-200' },
  { id: 'variable', label: '변동비', color: 'text-cyan-700', bgColor: 'bg-cyan-50 border-cyan-200' },
];

// 부모 항목 카테고리 분류
function detectCategory(label: string): CostCategory {
  if (/매출/.test(label)) return 'revenue';
  if (/매입원가|원가/.test(label)) return 'cogs';
  if (/마케팅|광고|플랫폼 광고/.test(label)) return 'ad';
  if (/인건비|창고비/.test(label)) return 'fixed';
  if (/SW비용|택배비|로켓 그로스|세이버|토스|스스|기타비/.test(label)) return 'variable';
  return 'variable';
}

// 자식(leaf) 항목 카테고리 분류
function detectLeafCategory(label: string): CostCategory {
  if (/광고비|트래픽|가구매|마케팅|판매수수료/.test(label)) return 'ad';
  if (/매입원가|원가/.test(label)) return 'cogs';
  if (/매출|판매자 할인쿠폰/.test(label)) return 'revenue';
  // leaf는 기본적으로 부모 카테고리를 따르므로 여기서는 판별 불가 시 'none' 역할
  return 'fixed';
}
interface CostEditorProps {
  reloadKey?: number;
  selectedYm: string;
  /** 저장 안 한 변경 여부 — 페이지가 탭/월 이동 가드에 사용 */
  onDirtyChange?: (dirty: boolean) => void;
  /** 저장 완료 후 (분석 데이터 재조회용) */
  onSaved?: () => void;
}

export function CostEditor({ reloadKey, selectedYm, onDirtyChange, onSaved }: CostEditorProps) {
  const confirmDialog = useConfirm();
  const [items, setItems] = useState<MCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newParent, setNewParent] = useState('');
  const toast = useToast();
  const [sortKey, setSortKey] = useState<'label' | 'amount' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteMonths, setPasteMonths] = useState<string[]>([]);
  const [pasteLoading, setPasteLoading] = useState(false);

  const [needsMigration, setNeedsMigration] = useState(false);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // 브라우저 탭 닫기 / 페이지 이동 시 경고
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const fmt = (n: number) => n.toLocaleString('ko-KR');

  async function load(ym?: string, markDirty = false) {
    setLoading(true);
    const targetYm = ym || selectedYm;
    const res = await fetch('/api/monthly-costs');
    const structure: MCost[] = res.ok ? await res.json() : [];
    const snapRes = await fetch(`/api/monthly-costs?history=all`);
    const allSnaps: Snapshot[] = snapRes.ok ? await snapRes.json() : [];
    const monthSnaps = allSnaps.filter(s => s.year_month === targetYm);
    const snapMap = new Map(monthSnaps.map(s => [s.cost_id, Number(s.amount ?? 0)]));
    const merged = structure.map(item => ({
      ...item,
      amount: snapMap.has(item.id) ? snapMap.get(item.id)! : (monthSnaps.length > 0 ? 0 : Number(item.amount ?? 0)),
    }));
    setItems(merged);
    setLoading(false);
    setDirty(markDirty);
  }

  useEffect(() => { load(selectedYm); }, []);
  useEffect(() => { if (reloadKey) load(selectedYm, true); }, [reloadKey]);
  useEffect(() => { load(selectedYm); }, [selectedYm]);
  useEffect(() => {
    if (!pasteOpen) return;
    const h = () => setPasteOpen(false);
    const t = setTimeout(() => document.addEventListener('click', h), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', h); };
  }, [pasteOpen]);

  function updateItem(id: string, field: keyof MCost, value: any) {
    setItems(prev => {
      // 잠금된 항목은 is_locked 토글만 허용
      if (field !== 'is_locked') {
        const target = prev.find(i => i.id === id);
        if (target) {
          // 자기 자신이 잠금이거나, 부모가 잠금이면 수정 불가
          if (target.is_locked) return prev;
          if (target.parent_id) {
            const parent = prev.find(i => i.id === target.parent_id);
            if (parent?.is_locked) return prev;
          }
        }
      }
      const next = prev.map(i => i.id === id ? { ...i, [field]: value } : i);
      // 부모 잠금 토글 시 세부항목도 같이 잠금/해제
      if (field === 'is_locked') {
        return next.map(i => i.parent_id === id ? { ...i, is_locked: value } : i);
      }
      // 부모 카테고리 변경 시 세부항목도 같이 변경
      if (field === 'category') {
        return next.map(i => i.parent_id === id ? { ...i, category: value } : i);
      }
      return next;
    });
    setDirty(true);
  }

  async function handleSaveAll() {
    setSaving(true);
    setSaveProgress(30);
    // 1. 구조 일괄 저장 (태그 포함)
    const putRes = await fetch('/api/monthly-costs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const putJson = await putRes.json().catch(() => ({}));
    if (!putRes.ok) { toast.error(`저장 실패: ${putJson.error ?? putRes.status}`); setSaving(false); setSaveProgress(0); return; }
    if (putJson.needsMigration) setNeedsMigration(true);
    setSaveProgress(70);
    // 2. 선택된 월에 금액 스냅샷 일괄 저장
    await fetch('/api/monthly-costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'snapshot_items', year_month: selectedYm, amounts: items.map(i => ({ id: i.id, amount: i.amount })) }),
    });
    setSaveProgress(100);
    setDirty(false);
    setSaving(false);
    setSaveProgress(0);
    toast.success(`${ymLabel(selectedYm)} 저장 완료`);
    onSaved?.();
  }

  async function handleAdd(parentId?: string) {
    if (!newLabel.trim()) return;
    const res = await fetch('/api/monthly-costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel.trim(), amount: 0, parent_id: parentId || null }),
    });
    const created = await res.json().catch(() => null);
    if (created?.id) {
      setItems(prev => [...prev, { id: created.id, label: created.label, amount: 0, vat_applicable: created.vat_applicable ?? true, parent_id: created.parent_id ?? null, sort_order: created.sort_order ?? 999, note: '', is_income: created.is_income ?? false, is_locked: false }]);
    }
    setNewLabel('');
    setNewParent('');
  }

  async function handleDelete(id: string) {
    const target = items.find(i => i.id === id);
    // 서버가 이력(스냅샷) 개수를 알려준다 — 삭제하면 전월 이력까지 함께 사라지므로 반드시 확인
    const probe = await fetch(`/api/monthly-costs?id=${id}`, { method: 'DELETE' });
    const info = await probe.json().catch(() => ({}));
    if (probe.status !== 409) { toast.error(info.error ?? '삭제 확인 실패'); return; }
    const detail = [
      info.childCount > 0 ? `세부항목 ${info.childCount}개` : null,
      info.snapshotCount > 0 ? `저장된 월 이력 ${info.snapshotCount}건` : null,
    ].filter(Boolean).join(' · ');
    const ok = await confirmDialog(`'${target?.label ?? '항목'}' 을 삭제할까요?\n${detail ? detail + ' 이 함께 삭제되며 ' : ''}되돌릴 수 없습니다. 이번 달만 0으로 두려면 금액을 지우세요.`);
    if (!ok) return;
    const res = await fetch(`/api/monthly-costs?id=${id}&confirm=1`, { method: 'DELETE' });
    if (!res.ok) { toast.error('삭제 실패'); return; }
    setItems(prev => prev.filter(i => i.id !== id && i.parent_id !== id));
    toast.success('삭제했습니다');
  }


  async function openPaste() {
    setPasteOpen(true);
    setPasteLoading(true);
    const res = await fetch('/api/monthly-costs?history=all');
    const snaps: Snapshot[] = res.ok ? await res.json() : [];
    const months = [...new Set(snaps.map(s => s.year_month))].sort().reverse();
    setPasteMonths(months);
    setPasteLoading(false);
  }

  async function pasteFrom(ym: string) {
    setPasteOpen(false);
    const res = await fetch('/api/monthly-costs?history=all');
    const snaps: Snapshot[] = res.ok ? await res.json() : [];
    const monthSnaps = snaps.filter(s => s.year_month === ym);
    if (!monthSnaps.length) return;

    setItems(prev => {
      const lockedIds = new Set(prev.filter(i => i.is_locked).map(i => i.id));
      return prev.map(item => {
        if (item.is_locked || (item.parent_id && lockedIds.has(item.parent_id))) return item;
        const snap = monthSnaps.find(s => s.cost_id === item.id);
        if (snap) return { ...item, amount: Number(snap.amount ?? 0) };
        return item;
      });
    });
    setDirty(true);
    toast.success(`${ymLabel(ym)} 금액 붙여넣기 완료 (잠금 항목 제외)`);
  }

  async function handleReset() {
    if (!(await confirmDialog(`${ymLabel(selectedYm)} 금액을 초기화하시겠습니까?\n(잠금 항목 제외, 해당 월만)`))) return;

    // 잠금된 항목 ID 수집 (부모 잠금이면 자식도)
    const lockedIds = new Set<string>();
    for (const item of items) {
      if (item.is_locked) {
        lockedIds.add(item.id);
        // 부모 잠금이면 자식도
        items.filter(c => c.parent_id === item.id).forEach(c => lockedIds.add(c.id));
      }
    }

    // 잠금 안 된 항목만 0으로, 잠금된 항목은 현재 금액 유지
    const amounts = items.map(i => ({
      id: i.id,
      amount: lockedIds.has(i.id) ? i.amount : 0,
    }));

    // 스냅샷 덮어쓰기 (잠금 값 유지 + 나머지 0)
    await fetch('/api/monthly-costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'snapshot_items', year_month: selectedYm, amounts }),
    });

    await load(selectedYm);
    toast.success(`${ymLabel(selectedYm)} 초기화 완료 (잠금 항목 제외)`);
  }

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOver(null); return; }
    setItems(prev => {
      const parentItems = prev.filter(i => !i.parent_id);
      const fromIdx = parentItems.findIndex(i => i.id === dragId);
      const toIdx = parentItems.findIndex(i => i.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return prev;

      // Reorder parents
      const reordered = [...parentItems];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);

      // Assign new sort_order
      const orderMap = new Map<string, number>();
      reordered.forEach((item, idx) => orderMap.set(item.id, idx));

      return prev.map(i => {
        if (!i.parent_id && orderMap.has(i.id)) return { ...i, sort_order: orderMap.get(i.id)! };
        return i;
      });
    });
    setDirty(true);
    setDragId(null);
    setDragOver(null);
  }

  function toggleSort(key: 'label' | 'amount') {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const childrenOf = (pid: string) => items.filter(i => i.parent_id === pid);

  const signOf = (item: MCost) => item.is_income ? -1 : 1;

  const calcAmount = (item: MCost): number => {
    const children = childrenOf(item.id);
    if (children.length > 0) return children.reduce((s, c) => s + Number(c.amount ?? 0) * signOf(c), 0);
    return Number(item.amount ?? 0) * signOf(item);
  };

  const calcVat = (item: MCost): number => {
    const children = childrenOf(item.id);
    if (children.length > 0) return children.reduce((s, c) => {
      const amt = Number(c.amount ?? 0);
      const withVat = c.vat_applicable ? Math.round(amt * 1.1) : amt;
      return s + withVat * signOf(c);
    }, 0);
    const amt = Number(item.amount ?? 0);
    const withVat = item.vat_applicable ? Math.round(amt * 1.1) : amt;
    return withVat * signOf(item);
  };

  // 정렬된 parents
  const parents = (() => {
    const list = items.filter(i => !i.parent_id);
    if (!sortKey) return list;
    return [...list].sort((a, b) => {
      const av = sortKey === 'label' ? a.label : calcAmount(a);
      const bv = sortKey === 'label' ? b.label : calcAmount(b);
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  })();

  // 카테고리별 분류
  const catOf = (item: MCost): CostCategory => (item.category as CostCategory) || detectCategory(item.label);
  const parentsByCategory = CATEGORIES.map(cat => ({
    ...cat,
    items: parents.filter(p => catOf(p) === cat.id),
  }));

  // 카테고리별 합계 (개별 leaf 항목 기준, 자식은 자체 label로 재분류)
  const catTotals = (() => {
    const acc: Record<string, { exVat: number; inclVat: number }> = {};
    for (const cat of CATEGORIES) acc[cat.id] = { exVat: 0, inclVat: 0 };

    // 모든 leaf 항목(자식 없는 부모 + 자식 항목) 수집 + 부모 카테고리 추적
    const leaves: { item: MCost; parentCat: CostCategory }[] = [];
    for (const p of parents) {
      const pCat = catOf(p);
      const children = childrenOf(p.id);
      if (children.length > 0) {
        children.forEach(c => leaves.push({ item: c, parentCat: pCat }));
      } else {
        leaves.push({ item: p, parentCat: pCat });
      }
    }

    let discountExVat = 0;
    let discountInclVat = 0;

    for (const { item: leaf, parentCat } of leaves) {
      const isDiscount = /판매자 할인쿠폰/.test(leaf.label);
      const amt = Number(leaf.amount ?? 0);
      // VAT별도(vat_applicable=true): 입력값=VAT제외 → inclVat = ×1.1
      // VAT포함(vat_applicable=false): 입력값=VAT포함 → exVat = ÷1.1
      const exVat = leaf.vat_applicable ? amt : Math.round(amt / 1.1);
      const inclVat = leaf.vat_applicable ? Math.round(amt * 1.1) : amt;

      if (isDiscount) {
        discountExVat += exVat;
        discountInclVat += inclVat;
      } else {
        const leafCat = leaf.is_income ? 'revenue' : detectLeafCategory(leaf.label);
        const cat = leafCat === 'fixed' ? parentCat : leafCat;
        acc[cat].exVat += exVat;
        acc[cat].inclVat += inclVat;
      }
    }
    return { ...acc, _discount: { exVat: discountExVat, inclVat: discountInclVat } };
  })() as Record<string, { exVat: number; inclVat: number }>;

  const discountTotals = catTotals['_discount'] ?? { exVat: 0, inclVat: 0 };

  // VAT 변환 헬퍼: 입력값 → {exVat, inclVat}
  const vatCalc = (amt: number, vatApplicable: boolean) => ({
    exVat: vatApplicable ? amt : Math.round(amt / 1.1),
    inclVat: vatApplicable ? Math.round(amt * 1.1) : amt,
  });

  // 비용 합계
  const { totalCostExVat, totalCostInclVat } = parents.reduce((acc, p) => {
    const children = childrenOf(p.id);
    const leaves = children.length > 0 ? children.filter(c => !c.is_income) : (p.is_income ? [] : [p]);
    for (const leaf of leaves) {
      const v = vatCalc(Number(leaf.amount ?? 0), !!leaf.vat_applicable);
      acc.totalCostExVat += v.exVat;
      acc.totalCostInclVat += v.inclVat;
    }
    return acc;
  }, { totalCostExVat: 0, totalCostInclVat: 0 });

  // 수입 합계
  const { totalIncomeExVat, totalIncomeInclVat } = parents.reduce((acc, p) => {
    const children = childrenOf(p.id);
    const leaves = children.length > 0 ? children.filter(c => c.is_income) : (p.is_income ? [p] : []);
    for (const leaf of leaves) {
      const v = vatCalc(Number(leaf.amount ?? 0), !!leaf.vat_applicable);
      acc.totalIncomeExVat += v.exVat;
      acc.totalIncomeInclVat += v.inclVat;
    }
    return acc;
  }, { totalIncomeExVat: 0, totalIncomeInclVat: 0 });

  // 순합계 = 비용 - 수입
  const totalExVat = totalCostExVat - totalIncomeExVat;
  const totalInclVat = totalCostInclVat - totalIncomeInclVat;

  const inputCls = 'h-9 px-2.5 rounded-lg border border-line text-[13px] focus:outline-none focus:border-brand transition-colors';
  const W = { drag: 'w-5', num: 'w-6', label: 'w-36', type: 'w-12', amount: 'w-28', vat: 'w-16', real: 'w-28', note: 'flex-1 min-w-[60px]', tag: 'w-40', cat: 'w-20', lock: 'w-7', del: 'w-7' };
  const byId = new Map(items.map(i => [i.id, i]));
  const setTags = (id: string, patch: Partial<MCost>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
    setDirty(true);
  };
  const sortIcon = (key: 'label' | 'amount') => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-4 md:px-5 py-3 md:py-4 border-b border-line-2">
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <h3 className="text-[14px] md:text-[15px] font-bold text-fg">정산 시트 <span className="text-brand">{ymLabel(selectedYm)}</span></h3>
          <span className="text-[11px] text-fg-4 hidden md:inline">계산서·마켓 정산 화면의 실적을 그대로 적습니다. 분류·마켓 태그는 분석에만 쓰입니다.</span>
          <div className="relative">
            <button onClick={() => pasteOpen ? setPasteOpen(false) : openPaste()}
              className="h-8 md:h-9 px-2 md:px-3 rounded-lg border border-line text-[11px] md:text-[12px] font-medium text-fg-3 hover:bg-app flex items-center gap-1 md:gap-1.5 transition-colors">
              <ClipboardPaste className="h-3 w-3 md:h-3.5 md:w-3.5" /> <span className="hidden sm:inline">이전 월</span> 붙여넣기
            </button>
            {pasteOpen && (
              <div className="absolute top-full left-0 mt-1 bg-card rounded-xl shadow-lg border border-line z-50 min-w-[180px] py-1">
                {pasteLoading ? (
                  <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-brand" /></div>
                ) : pasteMonths.length === 0 ? (
                  <p className="px-4 py-3 text-[12px] text-fg-5">저장된 월이 없습니다</p>
                ) : (
                  pasteMonths.map(ym => (
                    <button key={ym} onClick={() => pasteFrom(ym)}
                      className="w-full text-left px-4 py-2.5 text-[13px] text-fg hover:bg-app transition-colors">
                      {ym.replace('-', '년 ')}월
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        {needsMigration && (
          <p className="mt-2 text-[11px] text-warn">분류·마켓 태그는 DB 마이그레이션(00057) 적용 전이라 저장되지 않았습니다. 금액은 정상 저장됐습니다.</p>
        )}
      </div>

      {(
        <div className="px-3 md:px-5 py-3 md:py-4 space-y-1 overflow-x-auto">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>
          ) : (
            <>
              {/* 헤더 */}
              <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold text-fg-5">
                <span className={W.drag} />
                <span className={W.num}>#</span>
                <button onClick={() => toggleSort('label')} className={`${W.label} text-left hover:text-fg transition-colors`}>항목{sortIcon('label')}</button>
                <span className={`${W.type} text-center`}>+/-</span>
                <button onClick={() => toggleSort('amount')} className={`${W.amount} text-right hover:text-fg transition-colors`}>금액{sortIcon('amount')}</button>
                <span className={`${W.vat} text-center`}>VAT</span>
                <span className={`${W.real} text-right`}>VAT포함</span>
                <span className={W.note}>비고</span>
                <span className={`${W.tag} text-center`} title="손익 라인 · 마켓 — 분석 화면 분류에 사용">분류 · 마켓</span>
                <span className={`${W.cat} text-center`}>그룹</span>
                <span className={W.lock} />
                <span className={W.del} />
              </div>

              {parentsByCategory.filter(cat => cat.items.length > 0).map(cat => (
                <div key={cat.id} className="mb-4">
                  {/* 카테고리 헤더 */}
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border mb-1 ${cat.bgColor}`}>
                    <span className={`text-[12px] font-bold ${cat.color}`}>{cat.label}</span>
                    <span className={`text-[11px] ${cat.color} opacity-70 ml-auto tabular-nums`}>
                      {cat.id === 'revenue' && discountTotals.exVat > 0
                        ? `${fmt(catTotals[cat.id]?.exVat ?? 0)}원 → 실매출 ${fmt((catTotals[cat.id]?.exVat ?? 0) - discountTotals.exVat)}원`
                        : `${fmt(catTotals[cat.id]?.exVat ?? 0)}원`}
                    </span>
                  </div>
              {cat.items.map((parent, pIdx) => {
                const children = childrenOf(parent.id);
                const hasChildren = children.length > 0;
                const amt = calcAmount(parent);
                const vatAmt = calcVat(parent);

                return (
                  <div key={parent.id}>
                    {/* 상위 항목 */}
                    <div
                      draggable
                      onDragStart={() => setDragId(parent.id)}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(parent.id); }}
                      onDragLeave={() => setDragOver(null)}
                      onDrop={(e) => { e.preventDefault(); handleDrop(parent.id); }}
                      onDragEnd={() => { setDragId(null); setDragOver(null); }}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl group transition-colors ${parent.is_locked ? 'bg-amber-50/40' : ''} ${dragOver === parent.id && dragId !== parent.id ? 'bg-brand-bg ring-2 ring-brand/30' : dragId === parent.id ? 'bg-app opacity-50' : !parent.is_locked ? 'bg-card-2' : ''}`}>
                      <span className={`${W.drag} flex items-center justify-center cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity`}>
                        <GripVertical className="h-3.5 w-3.5 text-fg-5" />
                      </span>
                      {hasChildren ? (
                        <button onClick={() => setCollapsed(prev => { const next = new Set(prev); next.has(parent.id) ? next.delete(parent.id) : next.add(parent.id); return next; })}
                          className={`${W.num} flex items-center justify-center`}>
                          {collapsed.has(parent.id) ? <ChevronRight className="h-3.5 w-3.5 text-fg-3" /> : <ChevronDown className="h-3.5 w-3.5 text-fg-3" />}
                        </button>
                      ) : (
                        <span className={`${W.num} text-[11px] text-fg-5 tabular-nums`}>{pIdx + 1}</span>
                      )}
                      <input lang="ko" value={parent.label} onChange={(e) => updateItem(parent.id, 'label', e.target.value)}
                        className={`${inputCls} ${W.label} font-medium bg-transparent border-transparent hover:border-line focus:bg-card`} />
                      {hasChildren ? (
                        <span className={W.type} />
                      ) : (
                        <button onClick={() => updateItem(parent.id, 'is_income', !parent.is_income)}
                          className={`${W.type} text-center px-1 py-1 rounded text-[10px] font-bold transition-all active:scale-95 ${
                            parent.is_income
                              ? 'bg-emerald-500 text-white ring-1 ring-emerald-500/30'
                              : 'bg-app text-fg-3 hover:bg-line'
                          }`}>
                          {parent.is_income ? '+' : '−'}
                        </button>
                      )}
                      {hasChildren ? (
                        <span className={`${W.amount} text-[13px] tabular-nums text-right ${amt < 0 ? 'text-emerald-600' : 'text-fg-3'}`}>{amt < 0 ? '+' : ''}{fmt(Math.abs(amt))}원</span>
                      ) : (
                        <input type="text" inputMode="numeric" value={parent.amount ? fmt(parent.amount) : ''} onChange={(e) => updateItem(parent.id, 'amount', Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                          disabled={!!parent.is_locked}
                          placeholder="0" className={`${inputCls} ${W.amount} text-right bg-transparent border-transparent hover:border-line focus:bg-card tabular-nums ${parent.is_locked ? 'opacity-60 cursor-not-allowed' : ''}`} />
                      )}
                      <button onClick={() => updateItem(parent.id, 'vat_applicable', !parent.vat_applicable)}
                        className={`${W.vat} text-center px-1.5 py-1 rounded text-[10px] font-semibold transition-all active:scale-95 ${
                          hasChildren ? 'invisible' : parent.vat_applicable
                            ? 'bg-brand text-white ring-1 ring-blue-500/30'
                            : 'bg-app text-fg-3 hover:bg-line'
                        }`}>
                        {parent.vat_applicable ? 'VAT별도' : 'VAT포함'}
                      </button>
                      <span className={`${W.real} text-[12px] tabular-nums text-right ${vatAmt < 0 ? 'text-emerald-600' : 'text-fg-3'}`}>{vatAmt < 0 ? '+' : ''}{fmt(Math.abs(vatAmt))}원</span>
                      <span className={W.note} />
                      <span className={W.tag}>{!hasChildren && <TagPicker item={parent} parent={null} onChange={(patch) => setTags(parent.id, patch)} />}</span>
                      <select value={catOf(parent)} onChange={(e) => { updateItem(parent.id, 'category', e.target.value); }}
                        className={`${W.cat} h-7 px-1 rounded text-[9px] font-semibold border-0 bg-transparent cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand ${CATEGORIES.find(c => c.id === catOf(parent))?.color || ''}`}>
                        {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                      <button onClick={() => updateItem(parent.id, 'is_locked', !parent.is_locked)}
                        className={`${W.lock} flex justify-center transition-opacity ${parent.is_locked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        {parent.is_locked
                          ? <Lock className="h-3 w-3 text-amber-500" />
                          : <Unlock className="h-3 w-3 text-fg-5 hover:text-amber-500" />}
                      </button>
                      <button onClick={() => handleDelete(parent.id)} className={`${W.del} flex justify-center opacity-0 group-hover:opacity-100`}>
                        <Trash2 className="h-3.5 w-3.5 text-red-400 hover:text-red-600" />
                      </button>
                    </div>

                    {/* 세부항목 (접기/펼치기) */}
                    {!collapsed.has(parent.id) && <>
                      {children.map((child, cIdx) => (
                        <div key={child.id} className="flex items-center gap-2 px-3 py-2 ml-6 border-l-2 border-line group">
                          <span className={`${W.num} text-[10px] text-line tabular-nums`}>{pIdx + 1}-{cIdx + 1}</span>
                          <input lang="ko" value={child.label} onChange={(e) => updateItem(child.id, 'label', e.target.value)}
                            className={`${inputCls} ${W.label} text-[12px] bg-transparent border-transparent hover:border-line focus:bg-card`} />
                          <button onClick={() => updateItem(child.id, 'is_income', !child.is_income)}
                            className={`${W.type} text-center px-1 py-1 rounded text-[10px] font-bold transition-all active:scale-95 ${
                              child.is_income
                                ? 'bg-emerald-500 text-white ring-1 ring-emerald-500/30'
                                : 'bg-app text-fg-3 hover:bg-line'
                            }`}>
                            {child.is_income ? '+' : '−'}
                          </button>
                          <input type="text" inputMode="numeric" value={child.amount ? fmt(child.amount) : ''} onChange={(e) => updateItem(child.id, 'amount', Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                            disabled={!!(child.is_locked || parent.is_locked)}
                            placeholder="0" className={`${inputCls} ${W.amount} text-right text-[12px] bg-transparent border-transparent hover:border-line focus:bg-card tabular-nums ${(child.is_locked || parent.is_locked) ? 'opacity-60 cursor-not-allowed' : ''}`} />
                          <button onClick={() => updateItem(child.id, 'vat_applicable', !child.vat_applicable)}
                            className={`${W.vat} text-center px-1.5 py-1 rounded text-[10px] font-semibold transition-all active:scale-95 ${
                              child.vat_applicable
                                ? 'bg-brand text-white ring-1 ring-blue-500/30'
                                : 'bg-app text-fg-3 hover:bg-line'
                            }`}>
                            {child.vat_applicable ? 'VAT별도' : 'VAT포함'}
                          </button>
                          <span className={`${W.real} text-[11px] tabular-nums text-right ${child.is_income ? 'text-emerald-600' : 'text-fg-5'}`}>
                            {child.is_income ? '+' : ''}{fmt(child.vat_applicable ? Math.round(Number(child.amount ?? 0) * 1.1) : Number(child.amount ?? 0))}원
                          </span>
                          <input lang="ko" value={child.note ?? ''} onChange={(e) => updateItem(child.id, 'note', e.target.value)}
                            placeholder="비고" className={`${inputCls} ${W.note} text-[11px] bg-transparent border-transparent hover:border-line focus:bg-card text-fg-3`} />
                          <span className={W.tag}><TagPicker item={child} parent={byId.get(parent.id) ?? parent} onChange={(patch) => setTags(child.id, patch)} /></span>
                          <span className={W.cat} />
                          <button onClick={() => updateItem(child.id, 'is_locked', !child.is_locked)}
                            className={`${W.lock} flex justify-center transition-opacity ${child.is_locked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                            {child.is_locked
                              ? <Lock className="h-2.5 w-2.5 text-amber-500" />
                              : <Unlock className="h-2.5 w-2.5 text-fg-5 hover:text-amber-500" />}
                          </button>
                          <button onClick={() => handleDelete(child.id)} className={`${W.del} flex justify-center opacity-0 group-hover:opacity-100`}>
                            <Trash2 className="h-3 w-3 text-red-300 hover:text-red-500" />
                          </button>
                        </div>
                      ))}

                      {/* 세부항목 추가 */}
                      {newParent === parent.id ? (
                        <div className="flex items-center gap-2 ml-6 pl-3 py-1.5 border-l-2 border-line">
                          <span className={W.num} />
                          <input lang="ko" autoFocus value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(parent.id); if (e.key === 'Escape') { setNewParent(''); setNewLabel(''); } }}
                            placeholder="세부항목명" className={`${inputCls} ${W.label} text-[12px]`} />
                          <button onClick={() => handleAdd(parent.id)} className="text-[12px] text-brand font-medium hover:underline">추가</button>
                          <button onClick={() => { setNewParent(''); setNewLabel(''); }} className="text-[12px] text-fg-3">취소</button>
                        </div>
                      ) : (
                        <button onClick={() => { setNewParent(parent.id); setNewLabel(''); }}
                          className="ml-6 pl-3 py-1 text-[11px] text-brand hover:underline border-l-2 border-transparent">
                          + 세부항목
                        </button>
                      )}
                    </>}
                  </div>
                );
              })}
                </div>
              ))}

              {/* 합계 */}
              {(() => {
                const netExVat = totalIncomeExVat - totalCostExVat;
                const netInclVat = totalIncomeInclVat - totalCostInclVat;
                return (
                <div className="space-y-0.5 border-t border-line mt-3 pt-3">
                  {totalIncomeExVat > 0 && <>
                    <div className="flex items-center gap-2 px-3 py-1.5">
                      <span className={W.drag} /><span className={W.num} />
                      <span className={`${W.label} text-[12px] text-emerald-600`}>수입 소계</span>
                      <span className={W.type} />
                      <span className={`${W.amount} text-[12px] text-emerald-600 tabular-nums text-right`}>+{fmt(totalIncomeExVat)}원</span>
                      <span className={W.vat} />
                      <span className={`${W.real} text-[11px] text-emerald-600 tabular-nums text-right`}>+{fmt(totalIncomeInclVat)}원</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5">
                      <span className={W.drag} /><span className={W.num} />
                      <span className={`${W.label} text-[12px] text-fg-3`}>비용 소계</span>
                      <span className={W.type} />
                      <span className={`${W.amount} text-[12px] text-red-500 tabular-nums text-right`}>-{fmt(totalCostExVat)}원</span>
                      <span className={W.vat} />
                      <span className={`${W.real} text-[11px] text-red-400 tabular-nums text-right`}>-{fmt(totalCostInclVat)}원</span>
                    </div>
                  </>}
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className={W.drag} /><span className={W.num} />
                    <span className={`${W.label} text-[13px] font-bold text-fg`}>{totalIncomeExVat > 0 ? '순합계' : '합계'}</span>
                    <span className={W.type} />
                    <span className={`${W.amount} text-[13px] font-bold tabular-nums text-right ${netExVat >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{netExVat >= 0 ? '+' : ''}{fmt(netExVat)}원</span>
                    <span className={W.vat} />
                    <span className={`${W.real} text-[12px] font-bold tabular-nums text-right ${netInclVat >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{netInclVat >= 0 ? '+' : ''}{fmt(netInclVat)}원</span>
                  </div>
                </div>
                );
              })()}

              {/* 하단 액션 */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-line-2">
                <div className="flex flex-wrap items-center gap-2">
                  {newParent === '' && newParent !== '__root__' ? (
                    <button onClick={() => { setNewParent('__root__'); setNewLabel(''); }}
                      className="h-9 px-3.5 rounded-lg border border-line text-[12px] font-medium text-fg-3 hover:bg-app flex items-center gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> 항목 추가
                    </button>
                  ) : newParent === '__root__' ? (
                    <div className="flex items-center gap-2">
                      <input lang="ko" autoFocus value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { handleAdd(); setNewParent(''); } if (e.key === 'Escape') { setNewParent(''); setNewLabel(''); } }}
                        placeholder="새 항목명" className={`${inputCls} w-36`} />
                      <button onClick={() => { handleAdd(); setNewParent(''); }} disabled={!newLabel.trim()}
                        className="h-9 px-3 rounded-lg bg-brand text-white text-[12px] font-medium hover:bg-brand-hover disabled:opacity-50">추가</button>
                      <button onClick={() => { setNewParent(''); setNewLabel(''); }} className="text-[12px] text-fg-3">취소</button>
                    </div>
                  ) : null}
                  <button onClick={handleReset}
                    className="h-9 px-3.5 rounded-lg border border-red-200 text-[12px] font-medium text-red-400 hover:bg-red-50 flex items-center gap-1.5 transition-colors">
                    <RotateCcw className="h-3.5 w-3.5" /> {selectedYm.replace('-', '.')} 초기화
                  </button>
                </div>
                <button onClick={handleSaveAll} disabled={saving || !dirty}
                  className={`h-9 px-5 rounded-lg text-[13px] font-semibold transition-all relative overflow-hidden ${dirty ? 'bg-brand text-white hover:bg-brand-hover' : 'bg-app text-fg-5 cursor-default'}`}>
                  {saving && <span className="absolute inset-0 bg-brand-hover transition-all" style={{ width: `${saveProgress}%` }} />}
                  <span className="relative">{saving ? `${saveProgress}%` : `${selectedYm.replace('-', '.')} 저장`}</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
