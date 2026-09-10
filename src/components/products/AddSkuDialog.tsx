'use client';

import { useState, useEffect } from 'react';
import { Loader2, Plus, X, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Product } from '@/types';
import { AppDialog as Dialog } from '@/components/ui/app-dialog';
import { inputClassName } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { InputField, VatCostFields, autoSkuCode, type NewSkuInfo } from './AddProductDialog';

/**
 * 옵션(SKU) 추가 다이얼로그 — 옵션 타입(색상·사이즈…)과 값을 넣으면 조합별 SKU 를 만든다.
 * 상품 페이지와 마스터 시트(상품 행의 "+ 옵션")에서 같이 쓴다.
 */
interface OptionType { key: string; values: string[]; inputVal: string; }

// 카르테시안 곱으로 모든 옵션 조합 생성
function cartesianOptions(opts: OptionType[]): Record<string, string>[] {
  const valid = opts.filter((o) => o.key.trim() && o.values.length > 0);
  if (!valid.length) return [{}];
  return valid.reduce<Record<string, string>[]>((acc, opt) => {
    return acc.flatMap((combo) => opt.values.map((v) => ({ ...combo, [opt.key.trim()]: v })));
  }, [{}]);
}

export function AddSkuDialog({ open, onClose, product, onSave }: {
  open: boolean; onClose: () => void; product: Product; onSave: (skus: NewSkuInfo[]) => void;
}) {
  const [form, setForm] = useState({ barcode: '', cost_price: '', logistics_cost: '2409', lead_time_days: '', supplier_id: '', reorder_point: '', safety_stock: '' });
  const [optTypes, setOptTypes] = useState<OptionType[]>([]);
  const [newOptKey, setNewOptKey] = useState('');
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; alias: string | null; lead_time_days: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/suppliers').then((r) => r.json()).then((d) => setSuppliers(d ?? []));
  }, []);

  useEffect(() => {
    if (open) {
      setOptTypes(product.category ? [{ key: product.category, values: [], inputVal: '' }] : []);
      setNewOptKey('');
      setForm({ barcode: '', cost_price: '', logistics_cost: '2409', lead_time_days: '', supplier_id: '', reorder_point: '', safety_stock: '' });
      setError('');
    }
  }, [open, product.category]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const combos = cartesianOptions(optTypes);
  const comboCount = combos.length;

  function addOptType() {
    const key = newOptKey.trim();
    if (!key || optTypes.some((o) => o.key === key)) return;
    setOptTypes((o) => [...o, { key, values: [], inputVal: '' }]);
    setNewOptKey('');
  }

  function removeOptType(i: number) { setOptTypes((o) => o.filter((_, idx) => idx !== i)); }

  function addValue(i: number) {
    const val = optTypes[i].inputVal.trim();
    if (!val || optTypes[i].values.includes(val)) return;
    setOptTypes((o) => o.map((opt, idx) => idx === i ? { ...opt, values: [...opt.values, val], inputVal: '' } : opt));
  }

  function removeValue(optIdx: number, valIdx: number) {
    setOptTypes((o) => o.map((opt, idx) => idx === optIdx ? { ...opt, values: opt.values.filter((_, vi) => vi !== valIdx) } : opt));
  }

  function setInputVal(i: number, v: string) {
    setOptTypes((o) => o.map((opt, idx) => idx === i ? { ...opt, inputVal: v } : opt));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const base = {
        product_id: product.id,
        barcode: form.barcode.trim() || null,
        cost_price: Number(form.cost_price) || 0,
        logistics_cost: Number(form.logistics_cost) || 0,
        lead_time_days: form.lead_time_days ? Number(form.lead_time_days) : (suppliers.find((s) => s.id === form.supplier_id)?.lead_time_days ?? 21),
        supplier_id: form.supplier_id || null,
        reorder_point: Number(form.reorder_point) || 0,
        safety_stock: Number(form.safety_stock) || 0,
        is_active: true,
      };
      const results = await Promise.all(combos.map(async (option_values) => {
        const suffix = Object.values(option_values).join('-').replace(/\s/g, '').slice(0, 8).toUpperCase();
        const sku_code = autoSkuCode(product.name) + (suffix ? '-' + suffix : '');
        const r = await fetch('/api/skus', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...base, sku_code, option_values }),
        });
        if (!r.ok) return null;
        const data = await r.json();
        return { id: data.id as string, sku_code: data.sku_code as string, option_values };
      }));
      const failed = results.filter((r) => !r);
      if (failed.length) throw new Error(`${failed.length}개 SKU 생성 실패`);
      const created: NewSkuInfo[] = (results.filter(Boolean) as { id: string; sku_code: string; option_values: Record<string, string> }[]).map((r) => ({
        id: r.id,
        sku_code: r.sku_code,
        option_label: Object.values(r.option_values).join(' / '),
      }));
      onSave(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally { setLoading(false); }
  }

  const inputCls = cn(inputClassName, 'w-auto');

  return (
    <Dialog open={open} onClose={onClose} title="SKU 추가">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 상품 컨텍스트 */}
        <div className="bg-card-2 rounded-xl px-4 py-3">
          <p className="text-[13px] font-semibold text-fg">{product.name}</p>
          {product.brand && <p className="text-[12px] text-fg-3 mt-0.5">{product.brand}</p>}
        </div>

        {/* 옵션 타입 추가 */}
        <div className="space-y-3">
          <label className="text-[13px] font-medium text-fg">옵션 설정 <span className="text-[11px] text-fg-5 font-normal">(없으면 비워두세요)</span></label>
          {optTypes.map((opt, i) => (
            <div key={i} className="border border-line rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-fg">{opt.key}</span>
                <button type="button" onClick={() => removeOptType(i)} className="text-[11px] text-red-400 hover:text-red-600">삭제</button>
              </div>
              {/* 값 태그들 */}
              <div className="flex flex-wrap gap-1.5">
                {opt.values.map((v, vi) => (
                  <span key={vi} className="inline-flex items-center gap-1 bg-brand-bg text-brand text-[12px] font-medium px-2.5 py-1 rounded-lg">
                    {v}
                    <button type="button" onClick={() => removeValue(i, vi)} className="hover:text-red-500 transition-colors">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <div className="flex items-center gap-1">
                  <input
                    lang="ko"
                    value={opt.inputVal}
                    onChange={(e) => setInputVal(i, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addValue(i); } }}
                    placeholder="값 입력 후 Enter"
                    className={`${inputCls} w-36`}
                  />
                  <button type="button" onClick={() => addValue(i)} className="h-10 w-9 flex items-center justify-center rounded-xl bg-brand-bg text-brand hover:bg-brand hover:text-white transition-colors">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {/* 옵션 타입 추가 */}
          <div className="flex gap-2">
            <input
              lang="ko"
              value={newOptKey}
              onChange={(e) => setNewOptKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOptType(); } }}
              placeholder="옵션명 추가 (예: 색상, 사이즈)"
              className={`${inputCls} flex-1`}
            />
            <Button variant="outline" size="lg" className="border-brand text-brand hover:bg-brand-bg" type="button" onClick={addOptType}>
              + 옵션 추가
            </Button>
          </div>
        </div>

        {/* 조합 미리보기 */}
        {comboCount > 1 && (
          <div className="bg-brand-bg rounded-xl px-4 py-3">
            <p className="text-[13px] font-semibold text-brand">총 {comboCount}개 SKU가 생성됩니다</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {combos.map((c, i) => (
                <span key={i} className="text-[11px] bg-card text-fg-3 px-2 py-0.5 rounded-lg">
                  {Object.values(c).join(' / ')}
                </span>
              ))}
            </div>
          </div>
        )}

        <InputField label="바코드" hint="(쿠팡만 기입)" placeholder="쿠팡 바코드 번호" value={form.barcode} onChange={(e) => set('barcode', e.target.value)} />

        {/* 원가 + 물류비 */}
        <VatCostFields exclVat={form.cost_price} onChange={(v) => set('cost_price', v)} />
        <InputField
          label="물류비"
          hint="(VAT 미포함 · 자사창고→고객 배송비)"
          type="number" min="0"
          placeholder="2409"
          value={form.logistics_cost}
          onChange={(e) => set('logistics_cost', e.target.value)}
        />

        {/* 공급처 + 리드타임 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-fg">공급처 <span className="text-[11px] text-fg-5 font-normal">(선택)</span></label>
            <select value={form.supplier_id} onChange={(e) => {
              const sup = suppliers.find((s) => s.id === e.target.value);
              set('supplier_id', e.target.value);
              if (sup && !form.lead_time_days) set('lead_time_days', String(sup.lead_time_days));
            }}
              className="w-full h-11 px-3.5 rounded-xl border border-line text-[13px] text-fg bg-card focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-colors">
              <option value="">공급처 선택</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.alias ?? s.name}</option>)}
            </select>
          </div>
          <InputField label="리드타임 (일)" hint="(일)" type="number" min="1" placeholder="21" value={form.lead_time_days} onChange={(e) => set('lead_time_days', e.target.value)} />
        </div>

        {/* 발주점/안전재고 */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <label className="text-[13px] font-medium text-fg">발주점 / 안전재고</label>
            <span className="text-[11px] text-fg-5 font-normal">(선택)</span>
          </div>
          <div className="flex items-start gap-2 bg-card-2 rounded-xl px-3 py-2.5">
            <Info className="h-3.5 w-3.5 text-fg-5 mt-0.5 shrink-0" />
            <p className="text-[12px] text-fg-3">
              판매 데이터 입력 후 <span className="text-brand font-medium">재고 예측</span>에서 자동 계산됩니다.
              직접 설정하려면 마스터 시트를 이용하세요.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InputField label="발주점" type="number" placeholder="0" value={form.reorder_point} onChange={(e) => set('reorder_point', e.target.value)} />
            <InputField label="안전재고" type="number" placeholder="0" value={form.safety_stock} onChange={(e) => set('safety_stock', e.target.value)} />
          </div>
        </div>

        {error && <p className="text-[13px] text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="lg" className="flex-1" type="button" onClick={onClose}>취소</Button>
          <Button size="lg" className="flex-1" type="submit" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {comboCount > 1 ? `SKU ${comboCount}개 생성` : '저장'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
