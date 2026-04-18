'use client';

import { useEffect, useState } from 'react';
import { Plus, Loader2, CheckCircle2, Trash2, Save, ChevronDown, ChevronRight, ClipboardPaste, Lock, Unlock, RotateCcw, Upload, GripVertical } from 'lucide-react';
import { BarChart, Bar, Line, ComposedChart, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

// ───────────────── Interactive Chart ─────────────────
const METRIC_COLORS: Record<string, string> = {
  '실매출': '#10b981', '매입원가': '#f97316', '광고비': '#8b5cf6', '고정비': '#64748b',
  '변동비': '#06b6d4', '순이익': '#3b82f6', '순이익률': '#ef4444', 'ROAS': '#f97316',
};

function InteractiveChart({ data, metrics, defaultBars, defaultLines, unit = '원' }: {
  data: any[]; metrics: string[]; defaultBars: string[]; defaultLines: string[]; unit?: string;
}) {
  const [bars, setBars] = useState<Set<string>>(new Set(defaultBars));
  const [lines, setLines] = useState<Set<string>>(new Set(defaultLines));
  const [rightKeys, setRightKeys] = useState<Set<string>>(new Set());
  const pctMetrics = new Set(['순이익률', 'ROAS']);
  const activeMetrics = [...bars, ...lines];
  const hasRight = activeMetrics.some(m => rightKeys.has(m)) || activeMetrics.some(m => pctMetrics.has(m));

  const toggleMetric = (m: string) => {
    const inBars = bars.has(m);
    const inLines = lines.has(m);
    if (inBars) { const n = new Set(bars); n.delete(m); setBars(n); const l = new Set(lines); l.add(m); setLines(l); }
    else if (inLines) { const n = new Set(lines); n.delete(m); setLines(n); }
    else { const n = new Set(bars); n.add(m); setBars(n); }
  };

  const getAxis = (m: string) => rightKeys.has(m) || pctMetrics.has(m) ? 'right' : 'left';
  const fmt = (n: number) => n.toLocaleString('ko-KR');

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {metrics.map(m => {
          const inBars = bars.has(m);
          const inLines = lines.has(m);
          const active = inBars || inLines;
          return (
            <button key={m} onClick={() => toggleMetric(m)}
              className={`h-6 px-2 rounded text-[10px] font-semibold transition-all ${active ? 'text-white' : 'bg-[#F2F4F6] text-[#6B7684] hover:bg-[#E5E8EB]'}`}
              style={active ? { backgroundColor: METRIC_COLORS[m] || '#6B7684' } : {}}>
              {m} {inBars ? '▊' : inLines ? '━' : ''}
            </button>
          );
        })}
        {activeMetrics.length > 0 && (
          <div className="flex items-center gap-1 ml-1 border-l border-[#E5E8EB] pl-1.5">
            <span className="text-[9px] text-[#6B7684]">보조축:</span>
            {activeMetrics.filter(m => !pctMetrics.has(m)).map(m => (
              <button key={m} onClick={() => setRightKeys(prev => { const n = new Set(prev); n.has(m) ? n.delete(m) : n.add(m); return n; })}
                className={`h-5 px-1.5 rounded text-[9px] font-semibold ${rightKeys.has(m) ? 'text-white' : 'bg-[#F2F4F6] text-[#6B7684]'}`}
                style={rightKeys.has(m) ? { backgroundColor: METRIC_COLORS[m] || '#6B7684' } : {}}>
                {m}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="h-64 md:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ left: 10, right: hasRight ? 10 : 0, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F6" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="left" tickFormatter={(v: number) => v >= 1000000 ? (v / 1000000).toFixed(0) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : String(v)} tick={{ fontSize: 9 }} />
            {hasRight && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} />}
            <Tooltip formatter={(v: number, name: string) => pctMetrics.has(name) ? v + '%' : fmt(v) + unit} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {[...bars].map(m => <Bar key={m} yAxisId={getAxis(m)} dataKey={m} fill={METRIC_COLORS[m] || '#6B7684'} radius={[3, 3, 0, 0]} />)}
            {[...lines].map(m => <Line key={m} yAxisId={getAxis(m)} type="monotone" dataKey={m} stroke={METRIC_COLORS[m] || '#6B7684'} strokeWidth={2} dot={{ r: 3 }} />)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ───────────────── Monthly Costs ─────────────────

interface MCost { id: string; label: string; amount: number; vat_applicable: boolean; parent_id: string | null; sort_order: number; note?: string; is_income?: boolean; is_locked?: boolean; category?: string; }

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
interface Snapshot { year_month: string; cost_id: string; amount: number; cost: { label: string; parent_id: string | null; vat_applicable: boolean } | null; }

function MonthlyCostsSection({ reloadKey, selectedYm, onSelectedYmChange }: { reloadKey?: number; selectedYm: string; onSelectedYmChange: (ym: string) => void }) {
  const [items, setItems] = useState<MCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newParent, setNewParent] = useState('');
  const [tab, setTab] = useState<'edit' | 'history' | 'analysis'>('edit');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapLoading, setSnapLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [sortKey, setSortKey] = useState<'label' | 'amount' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteMonths, setPasteMonths] = useState<string[]>([]);
  const [pasteLoading, setPasteLoading] = useState(false);
  const [compareYm, setCompareYm] = useState<string>('');
  const [analysisTab, setAnalysisTab] = useState<'current' | 'trend'>('current');
  const [trendFrom, setTrendFrom] = useState('');
  const [trendTo, setTrendTo] = useState('');

  const now = new Date();
  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const setSelectedYm = onSelectedYmChange;

  // 최근 12개월 옵션 생성
  const monthOptions = (() => {
    const opts: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return opts;
  })();

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

  async function loadHistory() {
    setSnapLoading(true);
    const res = await fetch('/api/monthly-costs?history=all');
    setSnapshots(res.ok ? await res.json() : []);
    setSnapLoading(false);
  }

  useEffect(() => { load(selectedYm); }, []);
  useEffect(() => { if (reloadKey) load(selectedYm, true); }, [reloadKey]);
  useEffect(() => { load(selectedYm); }, [selectedYm]);
  useEffect(() => { if (tab === 'history' || tab === 'analysis') loadHistory(); }, [tab]);
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
    // 1. 구조 일괄 저장
    await fetch('/api/monthly-costs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
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
    const ymLabel = selectedYm.replace('-', '년 ') + '월';
    setToast(`${ymLabel} 저장 완료`); setTimeout(() => setToast(''), 2000);
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
    setItems(prev => prev.filter(i => i.id !== id && i.parent_id !== id));
    fetch(`/api/monthly-costs?id=${id}`, { method: 'DELETE' });
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
    setToast(`${ym} 금액 붙여넣기 완료 (잠금 항목 제외)`); setTimeout(() => setToast(''), 2000);
  }

  async function handleReset() {
    const ymLabel = selectedYm.replace('-', '년 ') + '월';
    if (!confirm(`${ymLabel} 금액을 초기화하시겠습니까?\n(잠금 항목 제외, 해당 월만)`)) return;

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
    setToast(`${ymLabel} 초기화 완료 (잠금 항목 제외)`); setTimeout(() => setToast(''), 2000);
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

  const allHistoryMonths = [...new Set(snapshots.map(s => s.year_month))].filter(ym => ym !== curYm).sort().reverse();

  const inputCls = 'h-9 px-2.5 rounded-lg border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6] transition-colors';
  const W = { drag: 'w-5', num: 'w-6', label: 'w-36', type: 'w-12', amount: 'w-28', vat: 'w-16', real: 'w-28', note: 'flex-1 min-w-[60px]', cat: 'w-20', lock: 'w-7', del: 'w-7' };
  const sortIcon = (key: 'label' | 'amount') => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <section className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-4 md:px-5 py-3 md:py-4 border-b border-[#F2F4F6]">
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <h3 className="text-[14px] md:text-[15px] font-bold text-[#191F28]">월 정산</h3>
          <select value={selectedYm} onChange={(e) => setSelectedYm(e.target.value)}
            className="h-8 md:h-9 px-2 md:px-3 rounded-lg border border-[#E5E8EB] text-[12px] md:text-[13px] font-semibold text-[#3182F6] focus:outline-none focus:border-[#3182F6] bg-white cursor-pointer">
            {monthOptions.map(ym => <option key={ym} value={ym}>{ym.replace('-', '년 ')}월</option>)}
          </select>
          <div className="relative">
            <button onClick={() => pasteOpen ? setPasteOpen(false) : openPaste()}
              className="h-8 md:h-9 px-2 md:px-3 rounded-lg border border-[#E5E8EB] text-[11px] md:text-[12px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] flex items-center gap-1 md:gap-1.5 transition-colors">
              <ClipboardPaste className="h-3 w-3 md:h-3.5 md:w-3.5" /> <span className="hidden sm:inline">이전 월</span> 붙여넣기
            </button>
            {pasteOpen && (
              <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-[#E5E8EB] z-50 min-w-[180px] py-1">
                {pasteLoading ? (
                  <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-[#3182F6]" /></div>
                ) : pasteMonths.length === 0 ? (
                  <p className="px-4 py-3 text-[12px] text-[#B0B8C1]">저장된 월이 없습니다</p>
                ) : (
                  pasteMonths.map(ym => (
                    <button key={ym} onClick={() => pasteFrom(ym)}
                      className="w-full text-left px-4 py-2.5 text-[13px] text-[#191F28] hover:bg-[#F2F4F6] transition-colors">
                      {ym.replace('-', '년 ')}월
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2 md:mt-0">
          <div className="flex bg-[#F2F4F6] rounded-lg p-0.5">
            <button onClick={() => setTab('edit')}
              className={`px-2.5 md:px-3 py-1.5 rounded-md text-[11px] md:text-[12px] font-medium transition-all ${tab === 'edit' ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684]'}`}>
              편집
            </button>
            <button onClick={() => setTab('history')}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${tab === 'history' ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684]'}`}>
              월별 추이
            </button>
            <button onClick={() => setTab('analysis')}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${tab === 'analysis' ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684]'}`}>
              분석
            </button>
          </div>
        </div>
      </div>

      {tab === 'edit' ? (
        <div className="px-3 md:px-5 py-3 md:py-4 space-y-1 overflow-x-auto">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" /></div>
          ) : (
            <>
              {/* 헤더 */}
              <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold text-[#B0B8C1]">
                <span className={W.drag} />
                <span className={W.num}>#</span>
                <button onClick={() => toggleSort('label')} className={`${W.label} text-left hover:text-[#191F28] transition-colors`}>항목{sortIcon('label')}</button>
                <span className={`${W.type} text-center`}>+/-</span>
                <button onClick={() => toggleSort('amount')} className={`${W.amount} text-right hover:text-[#191F28] transition-colors`}>금액{sortIcon('amount')}</button>
                <span className={`${W.vat} text-center`}>VAT</span>
                <span className={`${W.real} text-right`}>VAT포함</span>
                <span className={W.note}>비고</span>
                <span className={`${W.cat} text-center`}>카테고리</span>
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
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl group transition-colors ${parent.is_locked ? 'bg-amber-50/40' : ''} ${dragOver === parent.id && dragId !== parent.id ? 'bg-blue-50 ring-2 ring-[#3182F6]/30' : dragId === parent.id ? 'bg-[#F2F4F6] opacity-50' : !parent.is_locked ? 'bg-[#F8F9FB]' : ''}`}>
                      <span className={`${W.drag} flex items-center justify-center cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity`}>
                        <GripVertical className="h-3.5 w-3.5 text-[#B0B8C1]" />
                      </span>
                      {hasChildren ? (
                        <button onClick={() => setCollapsed(prev => { const next = new Set(prev); next.has(parent.id) ? next.delete(parent.id) : next.add(parent.id); return next; })}
                          className={`${W.num} flex items-center justify-center`}>
                          {collapsed.has(parent.id) ? <ChevronRight className="h-3.5 w-3.5 text-[#6B7684]" /> : <ChevronDown className="h-3.5 w-3.5 text-[#6B7684]" />}
                        </button>
                      ) : (
                        <span className={`${W.num} text-[11px] text-[#B0B8C1] tabular-nums`}>{pIdx + 1}</span>
                      )}
                      <input lang="ko" value={parent.label} onChange={(e) => updateItem(parent.id, 'label', e.target.value)}
                        className={`${inputCls} ${W.label} font-medium bg-transparent border-transparent hover:border-[#E5E8EB] focus:bg-white`} />
                      {hasChildren ? (
                        <span className={W.type} />
                      ) : (
                        <button onClick={() => updateItem(parent.id, 'is_income', !parent.is_income)}
                          className={`${W.type} text-center px-1 py-1 rounded text-[10px] font-bold transition-all active:scale-95 ${
                            parent.is_income
                              ? 'bg-emerald-500 text-white ring-1 ring-emerald-500/30'
                              : 'bg-[#F2F4F6] text-[#6B7684] hover:bg-[#E5E8EB]'
                          }`}>
                          {parent.is_income ? '+' : '−'}
                        </button>
                      )}
                      {hasChildren ? (
                        <span className={`${W.amount} text-[13px] tabular-nums text-right ${amt < 0 ? 'text-emerald-600' : 'text-[#6B7684]'}`}>{amt < 0 ? '+' : ''}{fmt(Math.abs(amt))}원</span>
                      ) : (
                        <input type="text" inputMode="numeric" value={parent.amount ? fmt(parent.amount) : ''} onChange={(e) => updateItem(parent.id, 'amount', Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                          disabled={!!parent.is_locked}
                          placeholder="0" className={`${inputCls} ${W.amount} text-right bg-transparent border-transparent hover:border-[#E5E8EB] focus:bg-white tabular-nums ${parent.is_locked ? 'opacity-60 cursor-not-allowed' : ''}`} />
                      )}
                      <button onClick={() => updateItem(parent.id, 'vat_applicable', !parent.vat_applicable)}
                        className={`${W.vat} text-center px-1.5 py-1 rounded text-[10px] font-semibold transition-all active:scale-95 ${
                          hasChildren ? 'invisible' : parent.vat_applicable
                            ? 'bg-blue-500 text-white ring-1 ring-blue-500/30'
                            : 'bg-[#F2F4F6] text-[#6B7684] hover:bg-[#E5E8EB]'
                        }`}>
                        {parent.vat_applicable ? 'VAT별도' : 'VAT포함'}
                      </button>
                      <span className={`${W.real} text-[12px] tabular-nums text-right ${vatAmt < 0 ? 'text-emerald-600' : 'text-[#6B7684]'}`}>{vatAmt < 0 ? '+' : ''}{fmt(Math.abs(vatAmt))}원</span>
                      <span className={W.note} />
                      <select value={catOf(parent)} onChange={(e) => { updateItem(parent.id, 'category', e.target.value); }}
                        className={`${W.cat} h-7 px-1 rounded text-[9px] font-semibold border-0 bg-transparent cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#3182F6] ${CATEGORIES.find(c => c.id === catOf(parent))?.color || ''}`}>
                        {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                      <button onClick={() => updateItem(parent.id, 'is_locked', !parent.is_locked)}
                        className={`${W.lock} flex justify-center transition-opacity ${parent.is_locked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        {parent.is_locked
                          ? <Lock className="h-3 w-3 text-amber-500" />
                          : <Unlock className="h-3 w-3 text-[#B0B8C1] hover:text-amber-500" />}
                      </button>
                      <button onClick={() => handleDelete(parent.id)} className={`${W.del} flex justify-center opacity-0 group-hover:opacity-100`}>
                        <Trash2 className="h-3.5 w-3.5 text-red-400 hover:text-red-600" />
                      </button>
                    </div>

                    {/* 세부항목 (접기/펼치기) */}
                    {!collapsed.has(parent.id) && <>
                      {children.map((child, cIdx) => (
                        <div key={child.id} className="flex items-center gap-2 px-3 py-2 ml-6 border-l-2 border-[#E5E8EB] group">
                          <span className={`${W.num} text-[10px] text-[#D0D5DD] tabular-nums`}>{pIdx + 1}-{cIdx + 1}</span>
                          <input lang="ko" value={child.label} onChange={(e) => updateItem(child.id, 'label', e.target.value)}
                            className={`${inputCls} ${W.label} text-[12px] bg-transparent border-transparent hover:border-[#E5E8EB] focus:bg-white`} />
                          <button onClick={() => updateItem(child.id, 'is_income', !child.is_income)}
                            className={`${W.type} text-center px-1 py-1 rounded text-[10px] font-bold transition-all active:scale-95 ${
                              child.is_income
                                ? 'bg-emerald-500 text-white ring-1 ring-emerald-500/30'
                                : 'bg-[#F2F4F6] text-[#6B7684] hover:bg-[#E5E8EB]'
                            }`}>
                            {child.is_income ? '+' : '−'}
                          </button>
                          <input type="text" inputMode="numeric" value={child.amount ? fmt(child.amount) : ''} onChange={(e) => updateItem(child.id, 'amount', Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                            disabled={!!(child.is_locked || parent.is_locked)}
                            placeholder="0" className={`${inputCls} ${W.amount} text-right text-[12px] bg-transparent border-transparent hover:border-[#E5E8EB] focus:bg-white tabular-nums ${(child.is_locked || parent.is_locked) ? 'opacity-60 cursor-not-allowed' : ''}`} />
                          <button onClick={() => updateItem(child.id, 'vat_applicable', !child.vat_applicable)}
                            className={`${W.vat} text-center px-1.5 py-1 rounded text-[10px] font-semibold transition-all active:scale-95 ${
                              child.vat_applicable
                                ? 'bg-blue-500 text-white ring-1 ring-blue-500/30'
                                : 'bg-[#F2F4F6] text-[#6B7684] hover:bg-[#E5E8EB]'
                            }`}>
                            {child.vat_applicable ? 'VAT별도' : 'VAT포함'}
                          </button>
                          <span className={`${W.real} text-[11px] tabular-nums text-right ${child.is_income ? 'text-emerald-600' : 'text-[#B0B8C1]'}`}>
                            {child.is_income ? '+' : ''}{fmt(child.vat_applicable ? Math.round(Number(child.amount ?? 0) * 1.1) : Number(child.amount ?? 0))}원
                          </span>
                          <input lang="ko" value={child.note ?? ''} onChange={(e) => updateItem(child.id, 'note', e.target.value)}
                            placeholder="비고" className={`${inputCls} ${W.note} text-[11px] bg-transparent border-transparent hover:border-[#E5E8EB] focus:bg-white text-[#6B7684]`} />
                          <span className={W.cat} />
                          <button onClick={() => updateItem(child.id, 'is_locked', !child.is_locked)}
                            className={`${W.lock} flex justify-center transition-opacity ${child.is_locked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                            {child.is_locked
                              ? <Lock className="h-2.5 w-2.5 text-amber-500" />
                              : <Unlock className="h-2.5 w-2.5 text-[#B0B8C1] hover:text-amber-500" />}
                          </button>
                          <button onClick={() => handleDelete(child.id)} className={`${W.del} flex justify-center opacity-0 group-hover:opacity-100`}>
                            <Trash2 className="h-3 w-3 text-red-300 hover:text-red-500" />
                          </button>
                        </div>
                      ))}

                      {/* 세부항목 추가 */}
                      {newParent === parent.id ? (
                        <div className="flex items-center gap-2 ml-6 pl-3 py-1.5 border-l-2 border-[#E5E8EB]">
                          <span className={W.num} />
                          <input lang="ko" autoFocus value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(parent.id); if (e.key === 'Escape') { setNewParent(''); setNewLabel(''); } }}
                            placeholder="세부항목명" className={`${inputCls} ${W.label} text-[12px]`} />
                          <button onClick={() => handleAdd(parent.id)} className="text-[12px] text-[#3182F6] font-medium hover:underline">추가</button>
                          <button onClick={() => { setNewParent(''); setNewLabel(''); }} className="text-[12px] text-[#6B7684]">취소</button>
                        </div>
                      ) : (
                        <button onClick={() => { setNewParent(parent.id); setNewLabel(''); }}
                          className="ml-6 pl-3 py-1 text-[11px] text-[#3182F6] hover:underline border-l-2 border-transparent">
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
                <div className="space-y-0.5 border-t border-[#E5E8EB] mt-3 pt-3">
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
                      <span className={`${W.label} text-[12px] text-[#6B7684]`}>비용 소계</span>
                      <span className={W.type} />
                      <span className={`${W.amount} text-[12px] text-red-500 tabular-nums text-right`}>-{fmt(totalCostExVat)}원</span>
                      <span className={W.vat} />
                      <span className={`${W.real} text-[11px] text-red-400 tabular-nums text-right`}>-{fmt(totalCostInclVat)}원</span>
                    </div>
                  </>}
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className={W.drag} /><span className={W.num} />
                    <span className={`${W.label} text-[13px] font-bold text-[#191F28]`}>{totalIncomeExVat > 0 ? '순합계' : '합계'}</span>
                    <span className={W.type} />
                    <span className={`${W.amount} text-[13px] font-bold tabular-nums text-right ${netExVat >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{netExVat >= 0 ? '+' : ''}{fmt(netExVat)}원</span>
                    <span className={W.vat} />
                    <span className={`${W.real} text-[12px] font-bold tabular-nums text-right ${netInclVat >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{netInclVat >= 0 ? '+' : ''}{fmt(netInclVat)}원</span>
                  </div>
                </div>
                );
              })()}

              {/* 하단 액션 */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[#F2F4F6]">
                <div className="flex flex-wrap items-center gap-2">
                  {newParent === '' && newParent !== '__root__' ? (
                    <button onClick={() => { setNewParent('__root__'); setNewLabel(''); }}
                      className="h-9 px-3.5 rounded-lg border border-[#E5E8EB] text-[12px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] flex items-center gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> 항목 추가
                    </button>
                  ) : newParent === '__root__' ? (
                    <div className="flex items-center gap-2">
                      <input lang="ko" autoFocus value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { handleAdd(); setNewParent(''); } if (e.key === 'Escape') { setNewParent(''); setNewLabel(''); } }}
                        placeholder="새 항목명" className={`${inputCls} w-36`} />
                      <button onClick={() => { handleAdd(); setNewParent(''); }} disabled={!newLabel.trim()}
                        className="h-9 px-3 rounded-lg bg-[#3182F6] text-white text-[12px] font-medium hover:bg-[#1B64DA] disabled:opacity-50">추가</button>
                      <button onClick={() => { setNewParent(''); setNewLabel(''); }} className="text-[12px] text-[#6B7684]">취소</button>
                    </div>
                  ) : null}
                  <button onClick={handleReset}
                    className="h-9 px-3.5 rounded-lg border border-red-200 text-[12px] font-medium text-red-400 hover:bg-red-50 flex items-center gap-1.5 transition-colors">
                    <RotateCcw className="h-3.5 w-3.5" /> {selectedYm.replace('-', '.')} 초기화
                  </button>
                </div>
                <button onClick={handleSaveAll} disabled={saving || !dirty}
                  className={`h-9 px-5 rounded-lg text-[13px] font-semibold transition-all relative overflow-hidden ${dirty ? 'bg-[#3182F6] text-white hover:bg-[#1B64DA]' : 'bg-[#F2F4F6] text-[#B0B8C1] cursor-default'}`}>
                  {saving && <span className="absolute inset-0 bg-[#1B64DA] transition-all" style={{ width: `${saveProgress}%` }} />}
                  <span className="relative">{saving ? `${saveProgress}%` : `${selectedYm.replace('-', '.')} 저장`}</span>
                </button>
              </div>
            </>
          )}
        </div>
      ) : tab === 'history' ? (
        /* 월별 추이 탭 */
        <div className="px-3 md:px-5 py-3 md:py-4 space-y-3">
          {/* 기간 선택 */}
          {allHistoryMonths.length > 0 && (
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-[#6B7684]">기간:</span>
              <select value={trendFrom || allHistoryMonths[allHistoryMonths.length - 1] || ''} onChange={e => setTrendFrom(e.target.value)}
                className="h-8 px-2 rounded-lg border border-[#E5E8EB] text-[12px] bg-white">
                {allHistoryMonths.slice().reverse().map(ym => <option key={ym} value={ym}>{ym}</option>)}
              </select>
              <span className="text-[#6B7684]">~</span>
              <select value={trendTo || allHistoryMonths[0] || ''} onChange={e => setTrendTo(e.target.value)}
                className="h-8 px-2 rounded-lg border border-[#E5E8EB] text-[12px] bg-white">
                {allHistoryMonths.slice().reverse().map(ym => <option key={ym} value={ym}>{ym}</option>)}
              </select>
            </div>
          )}
          {snapLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" /></div>
          ) : allHistoryMonths.length === 0 ? (
            <p className="text-center text-[13px] text-[#B0B8C1] py-8">저장된 데이터가 없습니다. 편집 탭에서 저장하세요.</p>
          ) : (() => {
            const from = trendFrom || allHistoryMonths[allHistoryMonths.length - 1];
            const to = trendTo || allHistoryMonths[0];
            const filteredMonths = allHistoryMonths.filter(ym => ym >= from && ym <= to);
            return (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-[#E5E8EB]">
                    <th className="text-left px-3 py-2.5 text-[#6B7684] font-semibold min-w-[120px]">항목</th>
                    {filteredMonths.map(ym => (
                      <th key={ym} className="text-right px-3 py-2.5 text-[#6B7684] font-semibold min-w-[100px]">{ym}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const allCostIds = [...new Set(snapshots.map(s => s.cost_id))];
                    const costMeta = new Map<string, { label: string; parent_id: string | null }>();
                    // 현재 구조에서 parent_id 관계 먼저 설정
                    for (const item of items) {
                      costMeta.set(item.id, { label: item.label, parent_id: item.parent_id });
                    }
                    // 스냅샷의 label로 보완
                    for (const s of snapshots) {
                      if (s.cost && !costMeta.has(s.cost_id)) costMeta.set(s.cost_id, { label: s.cost.label, parent_id: s.cost.parent_id });
                    }
                    const parentIds = allCostIds.filter(id => !costMeta.get(id)?.parent_id);
                    const histChildrenOf = (pid: string) => allCostIds.filter(id => costMeta.get(id)?.parent_id === pid);
                    const getAmt = (ym: string, cid: string) => snapshots.find(s => s.year_month === ym && s.cost_id === cid)?.amount ?? 0;

                    const rows: JSX.Element[] = [];
                    for (const pid of parentIds) {
                      const kids = histChildrenOf(pid);
                      rows.push(
                        <tr key={pid} className="border-b border-[#F2F4F6] bg-[#F8F9FB]">
                          <td className="px-3 py-2.5 font-semibold text-[#191F28]">{costMeta.get(pid)?.label}</td>
                          {filteredMonths.map(ym => {
                            const val = kids.length > 0 ? kids.reduce((s, kid) => s + Number(getAmt(ym, kid)), 0) : Number(getAmt(ym, pid));
                            return <td key={ym} className="px-3 py-2.5 text-right tabular-nums text-[#191F28] font-medium">{fmt(val)}</td>;
                          })}
                        </tr>
                      );
                      for (const kid of kids) {
                        rows.push(
                          <tr key={kid} className="border-b border-[#F2F4F6]">
                            <td className="px-3 py-2 pl-7 text-[#6B7684]">{costMeta.get(kid)?.label}</td>
                            {filteredMonths.map(ym => (
                              <td key={ym} className="px-3 py-2 text-right tabular-nums text-[#6B7684]">{fmt(Number(getAmt(ym, kid)))}</td>
                            ))}
                          </tr>
                        );
                      }
                    }
                    rows.push(
                      <tr key="total" className="border-t-2 border-[#191F28]">
                        <td className="px-3 py-2.5 font-bold text-[#191F28]">합계</td>
                        {filteredMonths.map(ym => {
                          const total = snapshots.filter(s => s.year_month === ym).reduce((s, r) => {
                            const isChild = !!costMeta.get(r.cost_id)?.parent_id;
                            const isParentWithKids = !isChild && histChildrenOf(r.cost_id).length > 0;
                            return s + (isParentWithKids ? 0 : Number(r.amount ?? 0));
                          }, 0);
                          return <td key={ym} className="px-3 py-2.5 text-right tabular-nums font-bold text-[#191F28]">{fmt(total)}</td>;
                        })}
                      </tr>
                    );
                    return rows;
                  })()}
                </tbody>
              </table>
            </div>
            );
          })()}
        </div>
      ) : (
        /* 분석 탭 */
        <div className="px-3 md:px-5 py-3 md:py-4 space-y-4">
          <div className="flex bg-[#F2F4F6] rounded-lg p-0.5 w-fit">
            <button onClick={() => setAnalysisTab('current')}
              className={`px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-all ${analysisTab === 'current' ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684]'}`}>
              현재월 분석
            </button>
            <button onClick={() => setAnalysisTab('trend')}
              className={`px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-all ${analysisTab === 'trend' ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684]'}`}>
              월별 추이
            </button>
          </div>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" /></div>
          ) : (() => {
            const grossRevenue = catTotals['revenue']?.exVat ?? 0;
            const discount = discountTotals.exVat;
            const revenue = grossRevenue - discount;
            const cogs = catTotals['cogs']?.exVat ?? 0;
            const ad = catTotals['ad']?.exVat ?? 0;
            const fixed = catTotals['fixed']?.exVat ?? 0;
            const variable = catTotals['variable']?.exVat ?? 0;
            const totalExpense = cogs + ad + fixed + variable;
            const grossProfit = revenue - cogs;
            const netProfit = revenue - totalExpense;
            const cogsRate = revenue > 0 ? (cogs / revenue * 100) : 0;
            const adRate = revenue > 0 ? (ad / revenue * 100) : 0;
            const grossMargin = revenue > 0 ? (grossProfit / revenue * 100) : 0;
            const netMargin = revenue > 0 ? (netProfit / revenue * 100) : 0;
            const fixedRate = revenue > 0 ? (fixed / revenue * 100) : 0;
            const variableRate = revenue > 0 ? (variable / revenue * 100) : 0;
            const roas = ad > 0 ? (revenue / ad * 100) : 0;

            const barData = [
              { name: '실매출', value: revenue, fill: '#10b981' },
              { name: '매입원가', value: cogs, fill: '#f97316' },
              { name: '광고/마케팅', value: ad, fill: '#8b5cf6' },
              { name: '고정비', value: fixed, fill: '#64748b' },
              { name: '변동비', value: variable, fill: '#06b6d4' },
              { name: '순이익', value: netProfit, fill: netProfit >= 0 ? '#3b82f6' : '#ef4444' },
            ];

            const pieData = [
              { name: '매입원가', value: cogs, fill: '#f97316' },
              { name: '광고/마케팅', value: ad, fill: '#8b5cf6' },
              { name: '고정비', value: fixed, fill: '#64748b' },
              { name: '변동비', value: variable, fill: '#06b6d4' },
              { name: '순이익', value: Math.max(0, netProfit), fill: '#3b82f6' },
            ];

            return (
              <>
                {analysisTab === 'current' ? <>
                {/* KPI 카드 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
                  {[
                    { label: '실매출', value: fmt(revenue) + '원', color: 'text-emerald-700', sub: discount > 0 ? `총 ${fmt(grossRevenue)} - 쿠폰 ${fmt(discount)}` : undefined },
                    { label: 'ROAS', value: roas > 0 ? roas.toFixed(0) + '%' : '-', color: roas >= 300 ? 'text-emerald-600' : roas >= 200 ? 'text-blue-600' : 'text-red-600', sub: `매출/광고 ${fmt(revenue)}/${fmt(ad)}` },
                    { label: '매출총이익률', value: grossMargin.toFixed(1) + '%', color: 'text-blue-600', sub: `${fmt(grossProfit)}원` },
                    { label: '순이익률', value: netMargin.toFixed(1) + '%', color: netProfit >= 0 ? 'text-blue-600' : 'text-red-600', sub: `${fmt(netProfit)}원` },
                  ].map((kpi, i) => (
                    <div key={i} className="bg-[#F8F9FB] rounded-xl px-3 md:px-4 py-2.5 md:py-3">
                      <p className="text-[10px] text-[#6B7684] mb-0.5 md:mb-1">{kpi.label}</p>
                      <p className={`text-[15px] md:text-[18px] font-bold tabular-nums ${kpi.color}`}>{kpi.value}</p>
                      {kpi.sub && <p className="text-[9px] md:text-[10px] text-[#B0B8C1] tabular-nums mt-0.5 truncate">{kpi.sub}</p>}
                    </div>
                  ))}
                </div>

                {/* 손익 구조 바 차트 */}
                <div>
                  <h4 className="text-[13px] font-bold text-[#191F28] mb-3">손익 구조</h4>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} layout="vertical" margin={{ left: 70, right: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F6" />
                        <XAxis type="number" tickFormatter={(v: number) => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : String(v)} tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={60} />
                        <Tooltip formatter={(v: number) => fmt(v) + '원'} />
                        <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                          {barData.map((d, idx) => (<Cell key={idx} fill={d.fill} />))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 매출 구성비 도넛 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                  <div>
                    <h4 className="text-[13px] font-bold text-[#191F28] mb-3">매출 대비 비용 구성</h4>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2} dataKey="value"
                            label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(1)}%`} labelLine={false}>
                            {pieData.map((d, idx) => (<Cell key={idx} fill={d.fill} />))}
                          </Pie>
                          <Tooltip formatter={(v: number) => fmt(v) + '원'} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[13px] font-bold text-[#191F28] mb-3">상세 비율</h4>
                    <div className="space-y-3 mt-4">
                      {[
                        { label: '원가율 (매입원가 / 매출)', value: cogsRate, color: 'bg-orange-500' },
                        { label: '광고비 비중 (광고·마케팅 / 매출)', value: adRate, color: 'bg-violet-500' },
                        { label: '고정비 비중 (고정비 / 매출)', value: fixedRate, color: 'bg-slate-500' },
                        { label: '변동비 비중 (변동비 / 매출)', value: variableRate, color: 'bg-cyan-500' },
                        { label: '순이익률 (순이익 / 매출)', value: Math.max(0, netMargin), color: 'bg-blue-500' },
                      ].map((bar, i) => (
                        <div key={i}>
                          <div className="flex justify-between text-[11px] mb-1">
                            <span className="text-[#6B7684]">{bar.label}</span>
                            <span className="font-semibold text-[#191F28]">{bar.value.toFixed(1)}%</span>
                          </div>
                          <div className="h-2.5 bg-[#F2F4F6] rounded-full overflow-hidden">
                            <div className={`h-full ${bar.color} rounded-full transition-all`} style={{ width: `${Math.min(bar.value, 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 카테고리별 요약 테이블 */}
                <div>
                  <h4 className="text-[13px] font-bold text-[#191F28] mb-3">카테고리별 요약</h4>
                  <table className="w-full text-[12px] border-collapse">
                    <thead><tr className="border-b border-[#E5E8EB] text-[#6B7684]">
                      <th className="text-left py-2 px-3">카테고리</th>
                      <th className="text-right py-2 px-3">VAT제외</th>
                      <th className="text-right py-2 px-3">VAT포함</th>
                      <th className="text-right py-2 px-3">매출 대비</th>
                    </tr></thead>
                    <tbody>
                      {/* 매출 */}
                      <tr className="border-b border-[#F2F4F6]">
                        <td className="py-2.5 px-3 font-semibold text-emerald-700">총매출</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{fmt(grossRevenue)}원</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-[#6B7684]">{fmt(catTotals['revenue']?.inclVat ?? 0)}원</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">-</td>
                      </tr>
                      {discount > 0 && (
                        <tr className="border-b border-[#F2F4F6] text-[#6B7684]">
                          <td className="py-2 px-3 pl-6 text-[11px]">판매자 할인쿠폰</td>
                          <td className="py-2 px-3 text-right tabular-nums text-red-500">-{fmt(discount)}원</td>
                          <td className="py-2 px-3 text-right tabular-nums text-red-400">-{fmt(discountTotals.inclVat)}원</td>
                          <td className="py-2 px-3 text-right tabular-nums">{revenue > 0 ? (discount / grossRevenue * 100).toFixed(1) : 0}%</td>
                        </tr>
                      )}
                      <tr className="border-b border-[#E5E8EB] bg-emerald-50/50">
                        <td className="py-2.5 px-3 font-bold text-emerald-800">실매출</td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-bold text-emerald-800">{fmt(revenue)}원</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-emerald-700">{fmt((catTotals['revenue']?.inclVat ?? 0) - discountTotals.inclVat)}원</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">100%</td>
                      </tr>
                      {/* 비용 카테고리 */}
                      {CATEGORIES.filter(c => c.id !== 'revenue').map(cat => {
                        const t = catTotals[cat.id];
                        const ratio = revenue > 0 ? (t.exVat / revenue * 100) : 0;
                        return (
                          <tr key={cat.id} className="border-b border-[#F2F4F6]">
                            <td className={`py-2.5 px-3 font-semibold ${cat.color}`}>{cat.label}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{fmt(t.exVat)}원</td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-[#6B7684]">{fmt(t.inclVat)}원</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{ratio.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 border-[#191F28] font-bold">
                        <td className="py-2.5 px-3">순이익</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{fmt(netProfit)}원</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-[#6B7684]">{fmt((catTotals['revenue']?.inclVat ?? 0) - discountTotals.inclVat - (catTotals['cogs']?.inclVat ?? 0) - (catTotals['ad']?.inclVat ?? 0) - (catTotals['fixed']?.inclVat ?? 0) - (catTotals['variable']?.inclVat ?? 0))}원</td>
                        <td className={`py-2.5 px-3 text-right tabular-nums font-bold ${netProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{netMargin.toFixed(1)}%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                </> : <>
                {/* 월별 추이 시계열 */}
                {snapshots.length > 0 && (() => {
                  const allTrend = [...new Set(snapshots.map(s => s.year_month))].filter(ym => ym !== curYm).sort();
                  if (allTrend.length < 1) return null;
                  const tf = trendFrom || allTrend[0];
                  const tt = trendTo || allTrend[allTrend.length - 1];
                  const trendMonths = allTrend.filter(ym => ym >= tf && ym <= tt);

                  const monthlyData = trendMonths.map(ym => {
                    const monthSnaps = snapshots.filter(s => s.year_month === ym);
                    // 자식이 있는 부모 ID (이중집계 방지)
                    const parentWithKids = new Set(items.filter(i => !i.parent_id && items.some(c => c.parent_id === i.id)).map(i => i.id));
                    let rev = 0, cg = 0, adv = 0, fx = 0, vr = 0, disc = 0;
                    for (const snap of monthSnaps) {
                      const item = items.find(i => i.id === snap.cost_id);
                      if (!item) continue;
                      // 자식이 있는 부모는 스킵 (자식에서 합산)
                      if (parentWithKids.has(item.id)) continue;
                      const amt = Number(snap.amount ?? 0);
                      if (amt === 0) continue;
                      const exV = item.vat_applicable ? amt : Math.round(amt / 1.1);
                      if (/판매자 할인쿠폰/.test(item.label)) { disc += exV; continue; }
                      if (item.is_income) { rev += exV; continue; }
                      const pItem = item.parent_id ? items.find(p => p.id === item.parent_id) : item;
                      const pCat = catOf(pItem || item);
                      const lCat = detectLeafCategory(item.label);
                      const finalCat = lCat === 'fixed' ? pCat : lCat;
                      if (finalCat === 'revenue') rev += exV;
                      else if (finalCat === 'cogs') cg += exV;
                      else if (finalCat === 'ad') adv += exV;
                      else if (finalCat === 'fixed') fx += exV;
                      else vr += exV;
                    }
                    const netRev = rev - disc;
                    const net = netRev - cg - adv - fx - vr;
                    const margin = netRev > 0 ? (net / netRev * 100) : 0;
                    const roasM = adv > 0 ? (netRev / adv * 100) : 0;
                    return { month: ym.slice(5).replace(/^0/, '') + '월', 실매출: netRev, 매입원가: cg, 광고비: adv, 고정비: fx, 변동비: vr, 순이익: net, 순이익률: Math.round(margin * 10) / 10, ROAS: Math.round(roasM * 10) / 10 };
                  });
                  // 현재 선택월 추가
                  // 현재 월은 정산 전이므로 제외

                  return (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <h4 className="text-[13px] font-bold text-[#191F28]">월별 추이</h4>
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <select value={trendFrom || allTrend[0]} onChange={e => setTrendFrom(e.target.value)}
                            className="h-7 px-2 rounded border border-[#E5E8EB] text-[11px] bg-white">
                            {allTrend.map(ym => <option key={ym} value={ym}>{ym}</option>)}
                          </select>
                          <span className="text-[#6B7684]">~</span>
                          <select value={trendTo || allTrend[allTrend.length - 1]} onChange={e => setTrendTo(e.target.value)}
                            className="h-7 px-2 rounded border border-[#E5E8EB] text-[11px] bg-white">
                            {allTrend.map(ym => <option key={ym} value={ym}>{ym}</option>)}
                          </select>
                        </div>
                      </div>
                      <InteractiveChart
                        data={monthlyData}
                        metrics={['실매출', '매입원가', '광고비', '고정비', '변동비', '순이익', '순이익률', 'ROAS']}
                        defaultBars={['실매출', '매입원가', '광고비', '순이익']}
                        defaultLines={['순이익률']}
                      />
                      {/* 월별 수치 테이블 */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px] border-collapse">
                          <thead><tr className="border-b border-[#E5E8EB] text-[#6B7684]">
                            <th className="text-left py-2 px-2">월</th>
                            <th className="text-right py-2 px-2">실매출</th>
                            <th className="text-right py-2 px-2">매입원가</th>
                            <th className="text-right py-2 px-2">광고비</th>
                            <th className="text-right py-2 px-2">고정비</th>
                            <th className="text-right py-2 px-2">변동비</th>
                            <th className="text-right py-2 px-2">순이익</th>
                            <th className="text-right py-2 px-2">순이익률</th>
                            <th className="text-right py-2 px-2">ROAS</th>
                          </tr></thead>
                          <tbody>
                            {monthlyData.map((d) => (
                                <tr key={d.month} className={`border-b border-[#F2F4F6] ${d.month.includes('현재') ? 'bg-blue-50/30 font-semibold' : ''}`}>
                                  <td className="py-1.5 px-2 text-[#191F28]">{d.month}</td>
                                  <td className="py-1.5 px-2 text-right tabular-nums">{fmt(d.실매출)}</td>
                                  <td className="py-1.5 px-2 text-right tabular-nums text-[#6B7684]">{fmt(d.매입원가)}</td>
                                  <td className="py-1.5 px-2 text-right tabular-nums text-[#6B7684]">{fmt(d.광고비)}</td>
                                  <td className="py-1.5 px-2 text-right tabular-nums text-[#6B7684]">{fmt(d.고정비)}</td>
                                  <td className="py-1.5 px-2 text-right tabular-nums text-[#6B7684]">{fmt(d.변동비)}</td>
                                  <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${d.순이익 >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{fmt(d.순이익)}</td>
                                  <td className={`py-1.5 px-2 text-right tabular-nums ${d.순이익률 >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{d.순이익률}%</td>
                                  <td className={`py-1.5 px-2 text-right tabular-nums ${d.ROAS >= 300 ? 'text-emerald-600' : d.ROAS >= 200 ? 'text-blue-600' : 'text-red-600'}`}>{d.ROAS > 0 ? d.ROAS + '%' : '-'}</td>
                                </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                </>}

                {analysisTab === 'current' && <>
                {/* 플랫폼별 분석 */}
                <div>
                  <h4 className="text-[13px] font-bold text-[#191F28] mb-3">플랫폼별 매출·광고비 비중</h4>
                  {(() => {
                    // 매출 자식 항목 (플랫폼별)
                    const revenueParent = parents.find(p => catOf(p) === 'revenue' && childrenOf(p.id).length > 0);
                    const revChildren = revenueParent ? childrenOf(revenueParent.id).filter(c => c.is_income) : [];
                    // 광고비 자식 항목 (플랫폼별)
                    const adParents = parents.filter(p => catOf(p) === 'ad');
                    const adChildren: { label: string; amount: number }[] = [];
                    for (const ap of adParents) {
                      const kids = childrenOf(ap.id);
                      if (kids.length > 0) {
                        kids.forEach(k => adChildren.push({ label: `${k.label} (${ap.label})`, amount: Number(k.amount ?? 0) }));
                      } else {
                        adChildren.push({ label: ap.label, amount: Number(ap.amount ?? 0) });
                      }
                    }

                    // 쿠팡은 판매자 할인쿠폰 차감하여 실매출로 계산
                    const platData = revChildren.map(rc => {
                      let platRevenue = Number(rc.amount ?? 0);
                      if (/쿠팡/.test(rc.label)) platRevenue -= discountTotals.exVat;
                      if (platRevenue < 0) platRevenue = 0;
                      const platAd = adChildren.filter(a => a.label.includes(rc.label)).reduce((s, a) => s + a.amount, 0);
                      const roas = platAd > 0 ? (platRevenue / platAd * 100) : 0;
                      return { name: rc.label + (/쿠팡/.test(rc.label) && discountTotals.exVat > 0 ? ' (실매출)' : ''), revenue: platRevenue, ad: platAd, adRate: platRevenue > 0 ? (platAd / platRevenue * 100) : 0, share: revenue > 0 ? (platRevenue / revenue * 100) : 0, roas };
                    }).filter(d => d.revenue > 0).sort((a, b) => b.revenue - a.revenue);

                    if (platData.length === 0) return <p className="text-[12px] text-[#B0B8C1]">매출 하위 플랫폼 데이터가 없습니다</p>;

                    return (
                      <div className="space-y-4">
                        <table className="w-full text-[12px] border-collapse">
                          <thead><tr className="border-b border-[#E5E8EB] text-[#6B7684]">
                            <th className="text-left py-2 px-3">플랫폼</th>
                            <th className="text-right py-2 px-3">매출</th>
                            <th className="text-right py-2 px-3">매출 비중</th>
                            <th className="text-right py-2 px-3">광고비</th>
                            <th className="text-right py-2 px-3">광고비/매출</th>
                            <th className="text-right py-2 px-3">ROAS</th>
                          </tr></thead>
                          <tbody>
                            {platData.map(p => (
                              <tr key={p.name} className="border-b border-[#F2F4F6]">
                                <td className="py-2.5 px-3 font-semibold text-[#191F28]">{p.name}</td>
                                <td className="py-2.5 px-3 text-right tabular-nums">{fmt(p.revenue)}원</td>
                                <td className="py-2.5 px-3 text-right tabular-nums text-[#6B7684]">{p.share.toFixed(1)}%</td>
                                <td className="py-2.5 px-3 text-right tabular-nums">{fmt(p.ad)}원</td>
                                <td className={`py-2.5 px-3 text-right tabular-nums font-semibold ${p.adRate > 20 ? 'text-red-600' : p.adRate > 10 ? 'text-amber-600' : 'text-emerald-600'}`}>{p.adRate.toFixed(1)}%</td>
                                <td className={`py-2.5 px-3 text-right tabular-nums font-semibold ${p.roas >= 300 ? 'text-emerald-600' : p.roas >= 200 ? 'text-blue-600' : p.roas > 0 ? 'text-red-600' : 'text-[#6B7684]'}`}>{p.roas > 0 ? p.roas.toFixed(0) + '%' : '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={platData} margin={{ left: 10, right: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F6" />
                              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                              <YAxis tickFormatter={(v: number) => v >= 1000000 ? (v / 1000000).toFixed(0) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : String(v)} tick={{ fontSize: 10 }} />
                              <Tooltip formatter={(v: number) => fmt(v) + '원'} />
                              <Bar dataKey="revenue" name="매출" fill="#10b981" radius={[4, 4, 0, 0]} />
                              <Bar dataKey="ad" name="광고비" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                </>}
              </>
            );
          })()}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#191F28] text-white text-[13px] font-medium px-5 py-3 rounded-2xl shadow-lg z-50 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-400" /> {toast}
        </div>
      )}
    </section>
  );
}

// ───────────────── Platform Cost Calculator ─────────────────

interface CostProduct { name: string; qty: number; revenue: number; cost: number; unitCost: number; matched: boolean; method: string; }
interface CostResult { platform: string; totalRevenue: number; totalQty: number; matchCount: number; totalItems: number; products: CostProduct[]; }

const PLATFORMS = [
  { id: 'coupang', label: '쿠팡 그로스', accept: '.xlsx,.xls', hint: '셀러 인사이트 엑셀' },
  { id: 'toss', label: '토스', accept: '.xlsx,.xls', hint: '전체주문조회 엑셀 (구매확정)' },
  { id: 'smartstore', label: '스스', accept: '.xlsx,.xls,.csv', hint: '주문조회 엑셀 (구매확정)' },
];

function PlatformCostSection({ selectedYm, onApply }: { selectedYm: string; onApply?: () => void }) {
  const [platform, setPlatform] = useState(PLATFORMS[0].id);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<CostResult | null>(null);
  const [toast, setToast] = useState('');
  const [vatIncluded, setVatIncluded] = useState(false);
  const [applied, setApplied] = useState(false);

  const fmt = (n: number) => n.toLocaleString('ko-KR');
  const totalExVat = result ? result.products.reduce((s, p) => s + p.cost, 0) : 0;
  const total = vatIncluded ? Math.round(totalExVat * 1.1) : totalExVat;

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    setResult(null);
    setApplied(false);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('platform', platform);
    const res = await fetch('/api/monthly-costs/calc-cost', { method: 'POST', body: fd });
    const data = await res.json();
    setUploading(false);
    if (data.products) setResult(data);
    else { setToast('파일 처리 실패'); setTimeout(() => setToast(''), 2000); }
  }

  function updateProductUnitCost(idx: number, unitCost: number) {
    if (!result) return;
    const products = [...result.products];
    const p = products[idx];
    products[idx] = { ...p, unitCost, cost: unitCost * p.qty };
    setResult({ ...result, products });
    setApplied(false);
  }

  async function applyToSettlement() {
    if (!result) return;
    const pLabel = PLATFORMS.find(p => p.id === platform)?.label || platform;

    // 수기 입력/수정된 단가 매핑 저장
    const mappings = result.products
      .filter(p => p.unitCost > 0)
      .map(p => ({ name: p.name, unitCost: p.unitCost }));
    if (mappings.length) {
      await fetch('/api/monthly-costs/calc-cost', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, mappings }),
      });
    }

    const costRes = await fetch('/api/monthly-costs');
    const allItems: any[] = costRes.ok ? await costRes.json() : [];
    const amount = totalExVat;

    // cogs 항목에서 매칭 (정확 → top-level 부분 매칭)
    const cogsItems = allItems.filter((i: any) => i.category === 'cogs');
    const allCogsAndChildren = allItems.filter((i: any) => {
      if (i.category === 'cogs') return true;
      const parent = allItems.find((p: any) => p.id === i.parent_id);
      return parent?.category === 'cogs';
    });
    const cogsTopLevel = allCogsAndChildren.filter((i: any) => !i.parent_id);

    let target: any =
      // 정확 매칭 (전체 트리)
      allCogsAndChildren.find((i: any) => i.label === pLabel) ||
      // 부분 매칭 (top-level만, 자식에 잘못 매칭 방지)
      cogsTopLevel.find((i: any) => pLabel.includes(i.label) || i.label.includes(pLabel)) ||
      // 레거시
      allItems.find((i: any) => i.label === `매입원가 (${pLabel})`) ||
      null;

    // 정산시트에서 선택된 월에 저장
    const targetYm = selectedYm;

    if (target) {
      // 구조 업데이트
      await fetch('/api/monthly-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: target.id, amount, vat_applicable: vatIncluded }),
      });
      // 현재 월 스냅샷에도 저장
      await fetch('/api/monthly-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'snapshot_items', year_month: targetYm, amounts: [{ id: target.id, amount }] }),
      });
      setToast(`${target.label} 매입원가 → ${fmt(total)}원 적용 완료`);
    } else {
      // 새로 생성 (항상 top-level cogs)
      const res = await fetch('/api/monthly-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: pLabel, amount, vat_applicable: vatIncluded, parent_id: null, category: 'cogs' }),
      });
      const created = await res.json();
      // 생성된 항목도 스냅샷에 저장
      if (created?.id) {
        await fetch('/api/monthly-costs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'snapshot_items', year_month: targetYm, amounts: [{ id: created.id, amount }] }),
        });
      }
      setToast(`${pLabel} 매입원가 → ${fmt(total)}원 항목 생성 완료`);
    }
    setApplied(true);
    onApply?.();
    setTimeout(() => setToast(''), 2500);
  }

  const curPlatform = PLATFORMS.find(p => p.id === platform)!;

  return (
    <section className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#F2F4F6]">
        <h3 className="text-[15px] font-bold text-[#191F28]">플랫폼별 매입원가</h3>
        <p className="text-[12px] text-[#6B7684] mt-0.5">엑셀 업로드 → SKU 원가 자동 매칭 → 정산시트에 적용</p>
      </div>

      <div className="px-3 md:px-5 py-3 md:py-4 space-y-3 md:space-y-4">
        {/* 플랫폼 탭 */}
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div className="flex bg-[#F2F4F6] rounded-lg p-0.5">
            {PLATFORMS.map(p => (
              <button key={p.id} onClick={() => { setPlatform(p.id); setResult(null); }}
                className={`px-2.5 md:px-3.5 py-1.5 rounded-md text-[11px] md:text-[12px] font-medium transition-all ${platform === p.id ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684]'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="h-8 md:h-9 px-3 md:px-4 rounded-lg bg-[#3182F6] text-white text-[11px] md:text-[12px] font-semibold hover:bg-[#1B64DA] flex items-center gap-1.5 cursor-pointer transition-colors">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{curPlatform.hint}</span><span className="sm:hidden">업로드</span>
            <input type="file" accept={curPlatform.accept} onChange={handleUpload} className="hidden" />
          </label>
        </div>

        {/* 결과 */}
        {result && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
              <div className="bg-[#F8F9FB] rounded-lg px-3 py-2">
                <p className="text-[10px] text-[#6B7684]">총 판매량</p>
                <p className="text-[14px] font-bold text-[#191F28] tabular-nums">{fmt(result.totalQty)}건</p>
              </div>
              <div className="bg-[#F8F9FB] rounded-lg px-3 py-2">
                <p className="text-[10px] text-[#6B7684]">총 매출</p>
                <p className="text-[14px] font-bold text-[#191F28] tabular-nums">{fmt(result.totalRevenue)}원</p>
              </div>
              <div className="bg-[#F8F9FB] rounded-lg px-3 py-2">
                <p className="text-[10px] text-[#6B7684]">총 매입원가</p>
                <p className="text-[14px] font-bold text-[#F97316] tabular-nums">{fmt(total)}원</p>
              </div>
              <div className="bg-[#F8F9FB] rounded-lg px-3 py-2">
                <p className="text-[10px] text-[#6B7684]">매칭</p>
                <p className="text-[14px] font-bold text-[#191F28] tabular-nums">{result.matchCount}/{result.totalItems}</p>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto border border-[#E5E8EB] rounded-xl">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-[#F8F9FB]"><tr className="text-[#6B7684] border-b border-[#E5E8EB]">
                  <th className="text-left py-2 px-3 min-w-[200px]">상품 / 옵션</th>
                  <th className="text-right py-2 px-2 w-12">수량</th>
                  <th className="text-right py-2 px-2 w-24">매출</th>
                  <th className="text-right py-2 px-2 w-24">단가</th>
                  <th className="text-right py-2 px-2 w-28">매입원가</th>
                  <th className="text-center py-2 px-2 w-12">상태</th>
                </tr></thead>
                <tbody>
                  {result.products.map((p, i) => (
                    <tr key={i} className={`border-b border-[#F2F4F6] ${!p.matched ? 'bg-amber-50/50' : ''}`}>
                      <td className="py-1.5 px-3 text-[#191F28] text-[10px]">{p.name}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#6B7684]">{p.qty}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#6B7684]">{fmt(p.revenue)}</td>
                      <td className="py-0.5 px-1">
                        <input type="text" inputMode="numeric" value={p.unitCost ? fmt(p.unitCost) : ''}
                          onChange={(e) => updateProductUnitCost(i, Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                          placeholder="0"
                          className={`w-full h-7 px-2 text-right text-[11px] tabular-nums font-medium rounded border transition-colors focus:outline-none focus:border-[#3182F6] focus:bg-white ${!p.matched ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-transparent hover:border-[#E5E8EB] bg-transparent text-[#191F28]'}`} />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#6B7684]">{p.cost ? fmt(p.cost) : '-'}</td>
                      <td className="py-1.5 px-2 text-center">
                        {p.method === 'saved'
                          ? <span className="text-[9px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">누적</span>
                          : p.matched
                          ? <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">자동</span>
                          : <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">수기</span>}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-[#E5E8EB] font-bold bg-[#F8F9FB]">
                    <td className="py-2 px-3 text-[#191F28]">합계</td>
                    <td className="py-2 px-2 text-right tabular-nums">{result.totalQty}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{fmt(result.totalRevenue)}</td>
                    <td className="py-2 px-2" />
                    <td className="py-2 px-2 text-right tabular-nums text-[#F97316]">{fmt(total)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={() => setVatIncluded(!vatIncluded)}
                className={`h-10 px-4 rounded-lg text-[12px] font-semibold transition-all active:scale-95 ${
                  vatIncluded
                    ? 'bg-[#F97316] text-white ring-1 ring-[#F97316]/30'
                    : 'bg-[#F2F4F6] text-[#6B7684] hover:bg-[#E5E8EB]'
                }`}>
                {vatIncluded ? 'VAT 포함 ✓' : 'VAT 제외'}
              </button>
              {applied ? (
                <div className="flex-1 h-10 rounded-lg bg-emerald-500 text-white text-[13px] font-semibold flex items-center justify-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  정산시트 적용 완료: {fmt(total)}원{vatIncluded ? ' (VAT포함)' : ''}
                </div>
              ) : (
                <button onClick={applyToSettlement}
                  className="flex-1 h-10 rounded-lg bg-[#F97316] text-white text-[13px] font-semibold hover:bg-[#EA6C0B] transition-colors flex items-center justify-center gap-2">
                  <Save className="h-4 w-4" />
                  정산시트에 적용: {fmt(total)}원{vatIncluded ? ' (VAT포함)' : ''}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#191F28] text-white text-[13px] font-medium px-5 py-3 rounded-2xl shadow-lg z-50 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-400" /> {toast}
        </div>
      )}
    </section>
  );
}

// ───────────────── Settlement Page ─────────────────

export default function SettlementPage() {
  const [costReloadKey, setCostReloadKey] = useState(0);
  const now = new Date();
  const [selectedYm, setSelectedYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[20px] font-bold text-[#191F28]">정산</h1>
        <p className="text-[13px] text-[#6B7684] mt-0.5">월별 매출, 매입원가, 비용을 관리하고 분석합니다</p>
      </div>
      <PlatformCostSection selectedYm={selectedYm} onApply={() => setCostReloadKey(k => k + 1)} />
      <MonthlyCostsSection reloadKey={costReloadKey} selectedYm={selectedYm} onSelectedYmChange={setSelectedYm} />
    </div>
  );
}
