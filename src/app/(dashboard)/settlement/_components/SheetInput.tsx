'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardPaste, Loader2, Plus, ScanSearch, Settings2, Trash2, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { effectiveTags, fmtNum, vatSplit, ymLabel, type MCost, type PlLine, type Snapshot, type Tags } from '../_lib/settlement';
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
type Verdict = { kind: 'match' | 'diff' | 'none'; ref?: Ref; key?: string; diff?: number; pct?: number };

/** 말단 항목 → 기준값 키. 태그(손익 라인·마켓) + 라벨로 결정. */
function refKeyFor(leaf: MCost, tags: Tags, parentLabel: string): string[] {
  const L = leaf.label, P = parentLabel, m = tags.market;
  if (tags.pl_line === 'revenue') return [`revenue_file:${m}`, `revenue:${m}`];
  if (tags.pl_line === 'coupon') return [`coupon:${m}`];
  if (tags.pl_line === 'cogs') return [`cogs_file:${m}`, `cogs:${m}`];
  if (tags.pl_line === 'ad' && m === 'coupang') return ['ad:coupang'];
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
function verdictFor(amount: number, vatApplicable: boolean, keys: string[], refs: Record<string, Ref>): Verdict {
  const key = keys.find(k => refs[k]);
  if (!key) return { kind: 'none' };
  const ref = refs[key];
  // 기준값은 대부분 VAT 포함 실거래가 → 입력이 VAT 별도면 포함가로 환산해 비교
  const mine = vatApplicable ? Math.round(amount * 1.1) : amount;
  const diff = mine - ref.value;
  const pct = ref.value ? (diff / ref.value) * 100 : 0;
  const ok = Math.abs(diff) <= 10000 || Math.abs(pct) <= 3;
  return { kind: ok ? 'match' : 'diff', ref, key, diff, pct };
}

const prevOf = (ym: string) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export function SheetInput({ items, snapshots, loading, selectedYm, onDirtyChange, onSaved }: Props) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [mode, setMode] = useState<'input' | 'structure'>('input');
  const [local, setLocal] = useState<MCost[]>([]);
  const [amounts, setAmounts] = useState<Map<string, number>>(new Map());
  const [carried, setCarried] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [adRaw, setAdRaw] = useState<Map<string, number>>(new Map());
  const [newLabel, setNewLabel] = useState<{ parent: string | null; value: string } | null>(null);
  const [check, setCheck] = useState<CheckState>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => { setCheck(null); }, [selectedYm]);
  async function runCheck() {
    setChecking(true);
    try {
      const r = await fetch(`/api/settlement/crosscheck?year_month=${selectedYm}`);
      const j = await r.json();
      if (!r.ok) { toast.error(j.error ?? '대조 실패'); return; }
      setCheck({ refs: j.refs ?? {}, orders: j.orders ?? {} });
      setMode('input');
    } finally { setChecking(false); }
  }
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
    setCarried(auto);
    if (auto.size > 0) setDirty(true);
  }, [items, loading, selectedYm, snapFor, hasSnapshot, prevAmounts]);

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
  const leafValue = (leaf: MCost) => vatSplit(amounts.get(leaf.id) ?? 0, !!leaf.vat_applicable).ex * (leaf.is_income ? -1 : 1);

  const patch = (id: string, p: Partial<MCost>) => { setLocal(prev => prev.map(i => i.id === id ? { ...i, ...p } : i)); setDirty(true); };
  const setAmount = (id: string, v: number) => { setAmounts(prev => { const n = new Map(prev); n.set(id, v); return n; }); setCarried(prev => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n; }); setDirty(true); };

  const fillFrom = (ym: string, ids?: string[]) => {
    const src = snapFor(ym);
    if (!src.size) { toast.warning(`${ymLabel(ym)} 저장된 값이 없습니다`); return; }
    setAmounts(prev => { const n = new Map(prev); for (const it of local) { if (ids && !ids.includes(it.id)) continue; if (src.has(it.id)) n.set(it.id, src.get(it.id)!); } return n; });
    setDirty(true); setFillOpen(false);
    toast.success(`${ymLabel(ym)} 값을 가져왔습니다${ids ? '' : ' (전체)'}`);
  };
  const clearAll = async () => {
    if (!(await confirmDialog(`${ymLabel(selectedYm)} 입력값을 모두 지울까요?\n저장 전까지는 DB 에 반영되지 않습니다.`))) return;
    setAmounts(new Map(local.map(i => [i.id, 0]))); setDirty(true);
  };

  async function save() {
    setSaving(true);
    try {
      const put = await fetch('/api/monthly-costs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: local }) });
      const pj = await put.json().catch(() => ({}));
      if (!put.ok) { toast.error(`저장 실패: ${pj.error ?? put.status}`); return; }
      const post = await fetch('/api/monthly-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'snapshot_items', year_month: selectedYm, amounts: local.map(i => ({ id: i.id, amount: amounts.get(i.id) ?? 0 })) }) });
      if (!post.ok) { toast.error('금액 저장 실패'); return; }
      setDirty(false); setCarried(new Set());
      toast.success(`${ymLabel(selectedYm)} 저장 완료${pj.needsMigration ? ' (분류 태그는 마이그레이션 후 저장됩니다)' : ''}`);
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
    return verdictFor(amounts.get(leaf.id) ?? 0, !!leaf.vat_applicable, refKeyFor(leaf, tagsOf(leaf), parent?.label ?? ''), check.refs);
  };
  const checkStats = check ? allLeaves.reduce((s, l) => { const v = verdictOf(l); s[v.kind] += 1; return s; }, { match: 0, diff: 0, none: 0 }) : null;

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
        <div className="relative">
          <Button variant="outline" size="sm" onClick={() => setFillOpen(o => !o)}><ClipboardPaste /> 다른 달 값 가져오기</Button>
          {fillOpen && (
            <div className="absolute right-0 top-full mt-1 z-40 w-48 rounded-xl border border-line bg-card shadow-lg py-1">
              {savedMonths.length === 0 ? <p className="px-3 py-2 text-[12px] text-fg-4">저장된 달이 없습니다</p> :
                savedMonths.map(ym => <button key={ym} onClick={() => fillFrom(ym)} className="w-full text-left px-3 py-2 text-[12px] text-fg hover:bg-app">{ymLabel(ym)}{ym === prevYm && <span className="text-fg-4"> · 전월</span>}</button>)}
              <div className="border-t border-line-2 mt-1 pt-1">
                <button onClick={() => { setFillOpen(false); clearAll(); }} className="w-full text-left px-3 py-2 text-[12px] text-danger hover:bg-app">이 달 값 모두 지우기</button>
              </div>
            </div>
          )}
        </div>
        {check ? (
          <Button variant="outline" size="sm" onClick={() => setCheck(null)} className="border-brand/40 text-brand"><X /> 대조 끄기</Button>
        ) : (
          <Button variant="outline" size="sm" onClick={runCheck} disabled={checking} title="주문 동기화(API)·매출 파일·광고 raw·설정으로 계산한 기준값과 비교합니다">
            {checking ? <Loader2 className="animate-spin" /> : <ScanSearch />} API 대조
          </Button>
        )}
        <Button variant={mode === 'structure' ? 'default' : 'outline'} size="sm" onClick={() => setMode(m => m === 'input' ? 'structure' : 'input')}>
          <Settings2 /> {mode === 'structure' ? '입력으로 돌아가기' : '항목 구조 편집'}
        </Button>
      </div>

      {mode === 'structure' && (
        <div className="rounded-xl border border-brand/30 bg-brand-soft px-4 py-2.5 text-[12px] text-fg-2">
          구조 편집: 항목 이름·순서·부호(+ 수입 / − 비용)·VAT·매월 이월·분류/마켓을 바꿉니다. 여기서 바꾼 이름과 분류는 모든 달에 적용됩니다. 저장을 눌러야 반영됩니다.
        </div>
      )}

      {check && checkStats && (
        <div className="rounded-xl border border-line bg-card px-4 py-2.5 text-[12px] text-fg-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-semibold text-fg">대조 결과</span>
          <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm bg-success/70" /> 일치 {checkStats.match}</span>
          <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm bg-danger/70" /> 차이 {checkStats.diff}</span>
          <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm bg-warn/70" /> 대조 불가 · 수기 확인 {checkStats.none}</span>
          <span className="text-fg-4">기준: 채널 주문 동기화(API) × 마스터 단가·수수료·건당 요금, 매출 파일, 광고 raw, 세이버 설정. 3% 또는 1만 원 이내면 일치.</span>
        </div>
      )}

      {sections.map(sec => (
        <section key={sec.key}>
          <div className="flex items-baseline gap-2 mb-2 px-1">
            <h4 className="text-[13px] font-bold text-fg">{sec.label}</h4>
            <span className="text-[11px] text-fg-4">{sec.hint}</span>
            {(() => { const v = sec.groups.reduce((s, g) => s + leavesOf(g).reduce((t, l) => t + leafValue(l), 0), 0); return <span className={cn('ml-auto text-[12px] tabular-nums font-semibold', v < 0 ? 'text-success' : 'text-fg-2')}>{v < 0 ? '+' : ''}{fmtNum(Math.abs(v))}원</span>; })()}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {sec.groups.map(g => (
              <GroupCard key={g.id} group={g} leaves={leavesOf(g)} isSingle={childrenOf(g.id).length === 0} mode={mode}
                amounts={amounts} prevAmounts={prevAmounts} carried={carried} adRaw={adRaw.get(selectedYm)}
                tagsOf={tagsOf} leafValue={leafValue} setAmount={setAmount} patch={patch} move={move} removeItem={removeItem} verdictOf={check ? verdictOf : undefined}
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
          </div>
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
            <Button onClick={save} disabled={saving || !changed}>{saving ? <Loader2 className="animate-spin" /> : null} {ymLabel(selectedYm)} 저장</Button>
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
  setAmount: (id: string, v: number) => void; patch: (id: string, p: Partial<MCost>) => void; move: (id: string, d: -1 | 1) => void; removeItem: (id: string) => void;
  onFillPrev: () => void; prevYm: string; verdictOf?: (l: MCost) => Verdict;
  newLabel: { parent: string | null; value: string } | null; setNewLabel: (v: { parent: string | null; value: string } | null) => void; addItem: (parent: string | null) => void;
}

function GroupCard({ group, leaves, isSingle, mode, amounts, prevAmounts, carried, adRaw, tagsOf, leafValue, setAmount, patch, move, removeItem, onFillPrev, prevYm, verdictOf, newLabel, setNewLabel, addItem }: CardProps) {
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
            <div className="min-w-0 mr-auto">
              <div className="text-[13px] font-bold text-fg truncate">{group.label}</div>
              {hint && <div className="text-[11px] text-fg-4 truncate" title={hint}>{hint}</div>}
            </div>
            {prevHas && blanks > 0 && <button onClick={onFillPrev} className="text-[11px] text-brand hover:underline whitespace-nowrap" title={`${ymLabel(prevYm)} 값으로 채우기`}>전월 값 채우기</button>}
            <span className={cn('text-[13px] font-semibold tabular-nums whitespace-nowrap', subtotal < 0 ? 'text-success' : 'text-fg')}>{subtotal < 0 ? '+' : ''}{fmtNum(Math.abs(subtotal))}원</span>
          </>
        )}
      </div>
      <div className="px-2 py-1">
        {leaves.map(leaf => {
          const tags = tagsOf(leaf);
          const isAdCoupang = tags.pl_line === 'ad' && tags.market === 'coupang';
          const amt = amounts.get(leaf.id) ?? 0;
          const prev = prevAmounts.get(leaf.id);
          const incl = vatSplit(amt, !!leaf.vat_applicable).incl;
          const v = verdictOf?.(leaf);
          const blockCls = !v ? '' : v.kind === 'match' ? 'bg-success/10 border-l-4 border-success' : v.kind === 'diff' ? 'bg-danger/10 border-l-4 border-danger' : 'bg-warn/15 border-l-4 border-warn';
          return (
            <div key={leaf.id} className={cn('rounded-lg', blockCls)}>
            <div className={cn('flex items-center gap-2 px-2 py-1.5 rounded-lg', carried.has(leaf.id) && !v && 'bg-brand-soft')}>
              {mode === 'structure' ? (
                <>
                  {!isSingle && <span className="flex flex-col"><button onClick={() => move(leaf.id, -1)} className="text-fg-5 hover:text-fg"><ArrowUp className="h-3 w-3" /></button><button onClick={() => move(leaf.id, 1)} className="text-fg-5 hover:text-fg"><ArrowDown className="h-3 w-3" /></button></span>}
                  <input lang="ko" value={leaf.label} onChange={e => patch(leaf.id, { label: e.target.value })} className={cn(inputClassName, 'h-7 w-36 text-[12px]')} />
                  <Chip on={!!leaf.is_income} onClick={() => patch(leaf.id, { is_income: !leaf.is_income })} title="+ 수입(차감) / − 비용">{leaf.is_income ? '+ 수입' : '− 비용'}</Chip>
                  <Chip on={!!leaf.vat_applicable} onClick={() => patch(leaf.id, { vat_applicable: !leaf.vat_applicable })} title="입력값이 VAT 별도이면 켜기">{leaf.vat_applicable ? 'VAT별도' : 'VAT포함'}</Chip>
                  <Chip on={!!leaf.carry_forward} onClick={() => patch(leaf.id, { carry_forward: !leaf.carry_forward })} title="새 달을 열면 전월 값 자동 입력">매월 이월</Chip>
                  <span className="ml-auto"><TagPicker item={leaf} parent={isSingle ? null : group} onChange={p => patch(leaf.id, p)} /></span>
                  {!isSingle && <button onClick={() => removeItem(leaf.id)} className="text-fg-5 hover:text-danger" title="삭제"><Trash2 className="h-3.5 w-3.5" /></button>}
                </>
              ) : (
                <>
                  <div className="w-36 shrink-0 min-w-0">
                    <div className="text-[13px] text-fg truncate" title={leaf.label}>{leaf.label}</div>
                    <div className="text-[10px] text-fg-5 truncate">
                      {leaf.is_income ? '수입 · ' : ''}{leaf.vat_applicable ? 'VAT별도' : 'VAT포함'}{leaf.carry_forward ? ' · 이월' : ''}
                    </div>
                  </div>
                  <input lang="ko" value={leaf.note ?? ''} onChange={e => patch(leaf.id, { note: e.target.value })} placeholder="비고"
                    className="flex-1 min-w-0 h-7 px-2 rounded-md text-[11px] text-fg-3 bg-transparent border border-transparent hover:border-line focus:border-brand focus:bg-card focus:outline-none" />
                  {isAdCoupang && adRaw != null && (
                    <span className="text-[10px] text-fg-4 whitespace-nowrap" title="광고분석 raw 월 집계 (참고)">raw {fmtNum(adRaw)}</span>
                  )}
                  {!amt && prev ? (
                    <button onClick={() => setAmount(leaf.id, prev)} className="text-[10px] text-fg-4 hover:text-brand whitespace-nowrap flex items-center gap-0.5" title={`${ymLabel(prevYm)} 값 가져오기`}><Undo2 className="h-3 w-3" />{fmtNum(prev)}</button>
                  ) : carried.has(leaf.id) ? <span className="text-[10px] text-brand whitespace-nowrap">이월</span> : null}
                  <MoneyInput value={amt} onChange={v => setAmount(leaf.id, v)} income={!!leaf.is_income} />
                  <span className="w-20 text-right text-[10px] text-fg-5 tabular-nums whitespace-nowrap hidden sm:inline" title="VAT 포함 환산 (VAT 별도 항목만)">{amt && leaf.vat_applicable ? `≈${fmtNum(incl)}` : ''}</span>
                </>
              )}
            </div>
            {v && mode === 'input' && (
              <div className="px-3 pb-1.5 -mt-0.5 text-[11px] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {v.kind === 'none' ? (
                  <span className="text-warn font-semibold">대조 불가 · 계산서로 직접 확인</span>
                ) : (
                  <>
                    <span className={cn('font-semibold', v.kind === 'match' ? 'text-success' : 'text-danger')}>{v.kind === 'match' ? '일치' : `차이 ${v.diff! > 0 ? '+' : ''}${fmtNum(v.diff!)} (${v.pct! > 0 ? '+' : ''}${v.pct!.toFixed(1)}%)`}</span>
                    <span className="text-fg-3">기준 {fmtNum(v.ref!.value)}원 · <span className="rounded bg-app px-1 text-[10px] text-fg-4">{v.ref!.source}</span> {v.ref!.detail}</span>
                    {v.kind === 'diff' && <button onClick={() => setAmount(leaf.id, leaf.vat_applicable ? Math.round(v.ref!.value / 1.1) : v.ref!.value)} className="text-brand hover:underline">기준값으로</button>}
                  </>
                )}
              </div>
            )}
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
      </div>
    </div>
  );
}

function Chip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} title={title} className={cn('h-6 px-2 rounded-md text-[10px] font-semibold whitespace-nowrap transition-colors', on ? 'bg-brand text-white' : 'bg-app text-fg-3 hover:bg-line')}>{children}</button>;
}

/** 콤마 표시 금액 입력. Enter → 다음 금액 칸. */
function MoneyInput({ value, onChange, income }: { value: number; onChange: (v: number) => void; income: boolean }) {
  const [text, setText] = useState(value ? fmtNum(value) : '');
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(value ? fmtNum(value) : ''); }, [value, focus]);
  return (
    <input type="text" inputMode="numeric" data-money value={text} placeholder="0"
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
      className={cn(inputClassName, 'w-32 text-right tabular-nums font-semibold', income ? 'text-success' : 'text-fg', !value && 'font-normal')} />
  );
}
