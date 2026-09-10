'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { AppDialog } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { SearchSelect, type SelectOption } from '@/components/ui/search-select';
import { inputClassName } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { fmtNum, ymLabel } from '../_lib/settlement';

/**
 * B2B 직거래 출고 내역 — 마스터 SKU 를 골라 수량·공급단가를 적으면 원가는 마스터에서 가져온다.
 * 저장하면 그 달의 b2b_lines 가 이 목록으로 맞춰지고, 합계는 시트 B2B 매출·매입원가의 기준값(대조)이 된다.
 * 재고는 건드리지 않는다 (출고 구조 정리 때 일괄 예정).
 */
export interface B2bTotals { qty: number; count: number; supply: number; cogs: number }

interface LineDraft { key: string; id?: string; sku_id: string | null; display_name: string; qty: number; unit_cost: number; unit_price: number; price_incl_vat: boolean; note: string }
/** 줄의 공급가액 단가 — 단가에 VAT 포함이면 ÷1.1 */
const supplyUnit = (l: { unit_price: number; price_incl_vat?: boolean }) => l.price_incl_vat ? (Number(l.unit_price) || 0) / 1.1 : (Number(l.unit_price) || 0);
const PRICE_VAT_KEY = 'lv-erp-b2b-price-incl-vat';   // 새 줄 기본값 (마지막 선택 기억)
interface SkuRow { id: string; sku_code: string; cost_price: number | null; option_values?: Record<string, string> | null; is_active?: boolean; product?: { id: string; name: string } | null }

export const b2bTotals = (lines: { qty: number; unit_cost: number; unit_price: number; price_incl_vat?: boolean }[]): B2bTotals => ({
  qty: lines.reduce((s, l) => s + (Number(l.qty) || 0), 0),
  count: lines.length,
  supply: lines.reduce((s, l) => s + (Number(l.qty) || 0) * supplyUnit(l), 0),
  cogs: lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0),
});

const skuLabel = (s: SkuRow) => {
  const opts = s.option_values ? Object.values(s.option_values).filter(Boolean) : [];
  return `${s.product?.name ?? '(상품명 없음)'}${opts.length ? ' ' + opts.join(' ') : ''}`;
};

interface B2bLineApi { id: string; sku_id: string | null; display_name: string; qty: number; unit_cost: number; unit_price: number; price_incl_vat?: boolean | null; note: string | null }
const toDraft = (l: B2bLineApi): LineDraft => ({ key: l.id, id: l.id, sku_id: l.sku_id, display_name: l.display_name, qty: Number(l.qty) || 0, unit_cost: Number(l.unit_cost) || 0, unit_price: Number(l.unit_price) || 0, price_incl_vat: !!l.price_incl_vat, note: l.note ?? '' });

export function B2bLinesDialog({ open, onClose, ym, readOnly, onSaved }: { open: boolean; onClose: () => void; ym: string; readOnly: boolean; onSaved?: (t: B2bTotals) => void }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [defaultIncl, setDefaultIncl] = useState(false);   // 새 줄의 단가 VAT 기본값
  useEffect(() => { try { setDefaultIncl(localStorage.getItem(PRICE_VAT_KEY) === 'incl'); } catch {} }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setDirty(false);
    (async () => {
      const [lr, sr] = await Promise.all([
        fetch(`/api/settlement/b2b-lines?year_month=${ym}`).then(r => r.json()).catch(() => ({ lines: [] })),
        fetch('/api/skus').then(r => r.ok ? r.json() : []).catch(() => []),
      ]);
      if (cancelled) return;
      setNeedsMigration(!!lr.needsMigration);
      setLines((lr.lines ?? []).map(toDraft));
      setSkus(Array.isArray(sr) ? sr : []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, ym]);

  const options = useMemo<SelectOption[]>(() => skus.filter(s => s.is_active !== false).map(s => ({ id: s.id, label: skuLabel(s), sub: s.sku_code, extra: `원가 ${fmtNum(Number(s.cost_price) || 0)}` })), [skus]);
  const totals = useMemo(() => b2bTotals(lines), [lines]);

  const update = (key: string, p: Partial<LineDraft>) => { setLines(prev => prev.map(l => l.key === key ? { ...l, ...p } : l)); setDirty(true); };
  const add = (skuId: string) => {
    if (!skuId) return;
    const s = skus.find(x => x.id === skuId); if (!s) return;
    setLines(prev => {
      const hit = prev.find(l => l.sku_id === skuId);
      if (hit) return prev.map(l => l === hit ? { ...l, qty: l.qty + 1 } : l);   // 같은 SKU 는 수량 +1
      return [...prev, { key: `new:${Date.now()}:${prev.length}`, sku_id: skuId, display_name: skuLabel(s), qty: 1, unit_cost: Number(s.cost_price) || 0, unit_price: 0, price_incl_vat: defaultIncl, note: '' }];
    });
    setDirty(true);
  };
  const remove = (key: string) => { setLines(prev => prev.filter(l => l.key !== key)); setDirty(true); };
  const toggleVat = (key: string) => { setLines(prev => prev.map(l => { if (l.key !== key) return l; const incl = !l.price_incl_vat; setDefaultIncl(incl); try { localStorage.setItem(PRICE_VAT_KEY, incl ? 'incl' : 'ex'); } catch {} return { ...l, price_incl_vat: incl }; })); setDirty(true); };

  const save = async () => {
    if (lines.some(l => l.qty <= 0)) { toast.error('수량이 0인 줄이 있습니다'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/settlement/b2b-lines', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year_month: ym, lines: lines.map(l => ({ id: l.id, sku_id: l.sku_id, display_name: l.display_name, qty: l.qty, unit_cost: l.unit_cost, unit_price: l.unit_price, price_incl_vat: l.price_incl_vat, note: l.note })) }) });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error ?? '저장 실패'); return; }
      setLines((j.lines ?? []).map(toDraft));
      setDirty(false);
      toast.success(`${ymLabel(ym)} B2B 내역 ${(j.lines ?? []).length}줄 저장`);
      onSaved?.(b2bTotals(j.lines ?? []));
    } catch { toast.error('저장 실패'); }
    finally { setSaving(false); }
  };

  const num = (v: string) => Number(v.replace(/[^0-9]/g, '')) || 0;
  const cell = 'h-8 px-2 text-right text-[12px] tabular-nums';

  return (
    <AppDialog open={open} onClose={async () => { if (saving) return; if (dirty && !(await confirmDialog('저장하지 않은 변경이 있습니다. 닫을까요?'))) return; onClose(); }} title={`B2B 출고 내역 · ${ymLabel(ym)}`} wide className="max-w-4xl"
      description="마스터 SKU 를 고르면 줄이 추가됩니다 (같은 SKU 는 수량 +1). 공급단가 옆 칩으로 VAT별도(공급가액)·VAT포함(합계 단가)을 줄마다 고를 수 있고, 원가는 마스터 값이 들어오고 고칠 수 있습니다. 합계는 시트 B2B 매출·매입원가의 기준값이 되고 재고는 바뀌지 않습니다.">
      {needsMigration && <div className="mb-3 rounded-lg bg-warn/10 text-warn text-[12px] px-3 py-2">b2b_lines 테이블이 아직 없습니다. 마이그레이션 00069 를 적용해 주세요.</div>}
      {!readOnly && (
        <div className="mb-3">
          <SearchSelect options={options} value="" onChange={add} placeholder="상품명 · SKU 코드로 검색해 추가…" className="w-full" maxItems={80} />
        </div>
      )}
      {loading ? (
        <div className="py-8 text-center text-fg-4 text-[12px]"><Loader2 className="h-4 w-4 animate-spin inline mr-1" />불러오는 중</div>
      ) : lines.length === 0 ? (
        <div className="py-8 text-center text-fg-4 text-[12px]">이 달 B2B 출고 내역이 없습니다.{!readOnly && ' 위에서 SKU 를 골라 추가하세요.'}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-fg-4 text-[11px] border-b border-line-2">
                <th className="text-left px-2 py-1.5 font-medium">상품</th>
                <th className="text-right px-2 py-1.5 font-medium w-20">수량</th>
                <th className="text-right px-2 py-1.5 font-medium w-40">공급단가 · VAT</th>
                <th className="text-right px-2 py-1.5 font-medium w-28">원가</th>
                <th className="text-right px-2 py-1.5 font-medium w-28">공급가액</th>
                <th className="text-right px-2 py-1.5 font-medium w-28">원가 소계</th>
                <th className="text-left px-2 py-1.5 font-medium w-32">비고</th>
                {!readOnly && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.key} className="border-b border-line-2/60">
                  <td className="px-2 py-1 text-fg truncate max-w-[260px]" title={l.display_name}>{l.display_name}{!l.sku_id && <span className="ml-1 text-[10px] text-warn">(SKU 없음)</span>}</td>
                  <td className="px-1 py-1"><input type="text" inputMode="numeric" disabled={readOnly} value={l.qty || ''} onChange={e => update(l.key, { qty: num(e.target.value) })} className={cn(inputClassName, cell, 'w-full')} /></td>
                  <td className="px-1 py-1"><span className="flex items-center gap-1"><input type="text" inputMode="numeric" disabled={readOnly} value={l.unit_price ? fmtNum(l.unit_price) : ''} placeholder="0" onChange={e => update(l.key, { unit_price: num(e.target.value) })} className={cn(inputClassName, cell, 'flex-1 min-w-0', !l.unit_price && 'border-warn')} /><button type="button" disabled={readOnly} onClick={() => toggleVat(l.key)} title={l.price_incl_vat ? '단가에 VAT 포함 → 공급가액 = 단가 ÷ 1.1' : '단가 = 공급가액 (VAT 별도)'} className={cn('shrink-0 rounded px-1.5 h-6 text-[10px] font-semibold border', l.price_incl_vat ? 'bg-brand text-white border-brand' : 'bg-card text-fg-4 border-line')}>{l.price_incl_vat ? '포함' : '별도'}</button></span></td>
                  <td className="px-1 py-1"><input type="text" inputMode="numeric" disabled={readOnly} value={l.unit_cost ? fmtNum(l.unit_cost) : ''} placeholder="0" onChange={e => update(l.key, { unit_cost: num(e.target.value) })} className={cn(inputClassName, cell, 'w-full')} /></td>
                  <td className="px-2 py-1 text-right tabular-nums text-fg" title={l.price_incl_vat ? `${fmtNum(l.qty * l.unit_price)} ÷ 1.1` : ''}>{fmtNum(Math.round(l.qty * supplyUnit(l)))}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-fg-3">{fmtNum(l.qty * l.unit_cost)}</td>
                  <td className="px-1 py-1"><input lang="ko" disabled={readOnly} value={l.note} onChange={e => update(l.key, { note: e.target.value })} placeholder="거래처 등" className={cn(inputClassName, 'h-8 px-2 text-[11px] w-full')} /></td>
                  {!readOnly && <td className="px-1 text-center"><button onClick={() => remove(l.key)} className="text-fg-5 hover:text-danger" title="줄 삭제"><Trash2 className="h-3.5 w-3.5" /></button></td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-[12px] font-semibold">
                <td className="px-2 py-2 text-fg">합계 {totals.count}줄</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtNum(totals.qty)}</td>
                <td colSpan={2} />
                <td className="px-2 py-2 text-right tabular-nums text-fg">{fmtNum(Math.round(totals.supply))}</td>
                <td className="px-2 py-2 text-right tabular-nums text-fg-3">{fmtNum(Math.round(totals.cogs))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-4">
        <span>공급가액 <b className="text-fg tabular-nums">{fmtNum(Math.round(totals.supply))}</b></span>
        <span>부가세 <b className="text-fg tabular-nums">{fmtNum(Math.round(totals.supply * 0.1))}</b></span>
        <span>합계(VAT 포함) <b className="text-fg tabular-nums">{fmtNum(Math.round(totals.supply * 1.1))}</b></span>
        <span>원가 <b className="text-fg tabular-nums">{fmtNum(Math.round(totals.cogs))}</b></span>
        <span>매출총이익 <b className={cn('tabular-nums', totals.supply - totals.cogs >= 0 ? 'text-success' : 'text-danger')}>{fmtNum(Math.round(totals.supply - totals.cogs))}</b></span>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>{readOnly ? '닫기' : '취소'}</Button>
        {!readOnly && <Button size="sm" onClick={save} disabled={saving || loading || needsMigration}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '저장'}</Button>}
      </div>
    </AppDialog>
  );
}
