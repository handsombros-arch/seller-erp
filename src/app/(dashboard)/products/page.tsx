'use client';

import { useState, useEffect } from 'react';
import { formatCurrency, formatNumber, skuOptionLabel } from '@/lib/utils';
import type { Product, Sku } from '@/types';
import {
  Package, Plus, Edit, Trash2, ChevronDown, ChevronUp, Loader2, X, Check, Info, Upload,
} from 'lucide-react';
import CsvImportDialog from '@/components/CsvImportDialog';

// ─── Helpers ───────────────────────────────────────────────────────────────

function totalInventory(skus: Sku[] | undefined): number {
  if (!skus) return 0;
  return skus.reduce((sum, sku) => {
    return sum + (sku.inventory ?? []).reduce((s, i) => s + (i.quantity ?? 0), 0);
  }, 0);
}

function autoSkuCode(name: string) {
  const prefix = name.replace(/\s/g, '').slice(0, 4).toUpperCase();
  return `${prefix}-${Date.now().toString().slice(-5)}`;
}

const VAT_RATE = 0.1;

// ─── Dialog ─────────────────────────────────────────────────────────────────

function Dialog({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
          <h2 className="text-[16px] font-bold text-[#191F28] tracking-[-0.02em]">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6] transition-colors">
            <X className="h-4 w-4 text-[#6B7684]" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function InputField({ label, hint, required, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label className="text-[13px] font-medium text-[#191F28]">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
        {hint && <span className="text-[11.5px] text-[#B0B8C1]">{hint}</span>}
      </div>
      <input
        {...props}
        className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors"
      />
    </div>
  );
}

// VAT 연동 원가 입력 컴포넌트
function VatCostFields({ exclVat, onChange }: {
  exclVat: string;
  onChange: (exclVat: string) => void;
}) {
  const [localExcl, setLocalExcl] = useState(exclVat);
  const [localIncl, setLocalIncl] = useState('');

  useEffect(() => {
    setLocalExcl(exclVat);
    if (exclVat) setLocalIncl(String(Math.round(Number(exclVat) * (1 + VAT_RATE))));
    else setLocalIncl('');
  }, [exclVat]);

  function handleExclChange(v: string) {
    setLocalExcl(v);
    setLocalIncl(v ? String(Math.round(Number(v) * (1 + VAT_RATE))) : '');
    onChange(v);
  }

  function handleInclChange(v: string) {
    setLocalIncl(v);
    const excl = v ? String(Math.round(Number(v) / (1 + VAT_RATE))) : '';
    setLocalExcl(excl);
    onChange(excl);
  }

  const inputCls = 'w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors';

  return (
    <div className="space-y-2">
      <label className="text-[13px] font-medium text-[#191F28]">
        원가 <span className="text-[11.5px] text-[#B0B8C1] font-normal">(VAT 미포함 · 최종 도착가)</span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <p className="text-[11.5px] text-[#6B7684] font-medium">VAT 제외</p>
          <input type="number" min="0" value={localExcl} onChange={(e) => handleExclChange(e.target.value)} placeholder="0" className={inputCls} />
        </div>
        <div className="space-y-1">
          <p className="text-[11.5px] text-[#6B7684] font-medium">VAT 포함 (×1.1)</p>
          <input type="number" min="0" value={localIncl} onChange={(e) => handleInclChange(e.target.value)} placeholder="0" className={inputCls} />
        </div>
      </div>
      {localExcl && (
        <p className="text-[11.5px] text-[#B0B8C1]">
          VAT 제외 {formatCurrency(Number(localExcl))} → 포함 {formatCurrency(Math.round(Number(localExcl) * 1.1))}
        </p>
      )}
    </div>
  );
}

// ─── Add Product Dialog ─────────────────────────────────────────────────────

type NewSkuInfo = { id: string; sku_code: string; option_label: string };

function AddProductDialog({ open, onClose, onSave }: {
  open: boolean; onClose: () => void; onSave: (skus: NewSkuInfo[]) => void;
}) {
  const [form, setForm] = useState({ name: '', brand: '', optionName: '', barcode: '', skuCode: '', cost_price: '', logistics_cost: '2409', lead_time_days: '', supplier_id: '' });
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; alias: string | null; lead_time_days: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/suppliers').then((r) => r.json()).then((d) => setSuppliers(d ?? []));
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('상품명을 입력해주세요.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          brand: form.brand.trim() || null,
          category: form.optionName.trim() || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const product = await res.json();

      const skuCode = form.skuCode.trim() || autoSkuCode(form.name);
      const leadTime = form.lead_time_days
        ? Number(form.lead_time_days)
        : (suppliers.find((s) => s.id === form.supplier_id)?.lead_time_days ?? 21);
      const skuRes = await fetch('/api/skus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: product.id,
          sku_code: skuCode,
          barcode: form.barcode.trim() || null,
          option_values: {},
          cost_price: Number(form.cost_price) || 0,
          logistics_cost: Number(form.logistics_cost) || 0,
          lead_time_days: leadTime,
          supplier_id: form.supplier_id || null,
          reorder_point: 0,
          safety_stock: 0,
          is_active: true,
        }),
      });
      if (!skuRes.ok) { const d = await skuRes.json(); throw new Error(d.error); }
      const newSku = await skuRes.json();
      setForm({ name: '', brand: '', optionName: '', barcode: '', skuCode: '', cost_price: '', logistics_cost: '2409', lead_time_days: '', supplier_id: '' });
      onSave([{ id: newSku.id, sku_code: newSku.sku_code, option_label: '' }]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally { setLoading(false); }
  }

  const selectCls = 'w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] bg-white focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors';

  return (
    <Dialog open={open} onClose={onClose} title="상품 추가">
      <form onSubmit={handleSubmit} className="space-y-4">
        <InputField label="상품명" required placeholder="예: 그랑누보 데일리 백팩" value={form.name} onChange={(e) => set('name', e.target.value)} />
        <InputField label="브랜드" placeholder="예: 그랑누보" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
        <InputField label="옵션명" placeholder="예: 색상, 사이즈 (없으면 비워두세요)" value={form.optionName} onChange={(e) => set('optionName', e.target.value)} />

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
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">공급처 <span className="text-[11.5px] text-[#B0B8C1] font-normal">(선택)</span></label>
            <select value={form.supplier_id} onChange={(e) => {
              const sup = suppliers.find((s) => s.id === e.target.value);
              set('supplier_id', e.target.value);
              if (sup && !form.lead_time_days) set('lead_time_days', String(sup.lead_time_days));
            }} className={selectCls}>
              <option value="">공급처 선택</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.alias ?? s.name}</option>)}
            </select>
          </div>
          <InputField label="리드타임 (일)" type="number" min="1" placeholder="21" value={form.lead_time_days} onChange={(e) => set('lead_time_days', e.target.value)} />
        </div>

        <InputField label="바코드" hint="(쿠팡만 기입)" placeholder="쿠팡 바코드 번호" value={form.barcode} onChange={(e) => set('barcode', e.target.value)} />
        <InputField label="제품코드" hint="(선택 · 없으면 자동 생성)" placeholder="예: PROD-001" value={form.skuCode} onChange={(e) => set('skuCode', e.target.value)} />
        {error && <p className="text-[13px] text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[14px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">취소</button>
          <button type="submit" disabled={loading} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[14px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}저장
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Edit Product Dialog ────────────────────────────────────────────────────

function EditProductDialog({ open, onClose, product, onSave }: {
  open: boolean; onClose: () => void; product: Product | null; onSave: () => void;
}) {
  const [form, setForm] = useState({ name: '', brand: '', optionName: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (product) setForm({ name: product.name, brand: product.brand ?? '', optionName: product.category ?? '' });
  }, [product]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !product) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), brand: form.brand.trim() || null, category: form.optionName.trim() || null }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      onSave();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="상품 수정">
      <form onSubmit={handleSubmit} className="space-y-4">
        <InputField label="상품명" required placeholder="상품명 입력" value={form.name} onChange={(e) => set('name', e.target.value)} />
        <InputField label="브랜드" placeholder="예: 그랑누보" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
        <InputField label="옵션명" placeholder="예: 색상, 사이즈" value={form.optionName} onChange={(e) => set('optionName', e.target.value)} />
        {error && <p className="text-[13px] text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[14px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">취소</button>
          <button type="submit" disabled={loading} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[14px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}저장
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Add SKU Dialog ─────────────────────────────────────────────────────────

interface OptionRow { key: string; value: string; }
interface OptionType { key: string; values: string[]; inputVal: string; }

// 카르테시안 곱으로 모든 옵션 조합 생성
function cartesianOptions(opts: OptionType[]): Record<string, string>[] {
  const valid = opts.filter((o) => o.key.trim() && o.values.length > 0);
  if (!valid.length) return [{}];
  return valid.reduce<Record<string, string>[]>((acc, opt) => {
    return acc.flatMap((combo) => opt.values.map((v) => ({ ...combo, [opt.key.trim()]: v })));
  }, [{}]);
}

function AddSkuDialog({ open, onClose, product, onSave }: {
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

  const inputCls = 'h-9 px-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] transition-colors';

  return (
    <Dialog open={open} onClose={onClose} title="SKU 추가">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 상품 컨텍스트 */}
        <div className="bg-[#F8F9FB] rounded-xl px-4 py-3">
          <p className="text-[13px] font-semibold text-[#191F28]">{product.name}</p>
          {product.brand && <p className="text-[12px] text-[#6B7684] mt-0.5">{product.brand}</p>}
        </div>

        {/* 옵션 타입 추가 */}
        <div className="space-y-3">
          <label className="text-[13px] font-medium text-[#191F28]">옵션 설정 <span className="text-[11.5px] text-[#B0B8C1] font-normal">(없으면 비워두세요)</span></label>
          {optTypes.map((opt, i) => (
            <div key={i} className="border border-[#E5E8EB] rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[#191F28]">{opt.key}</span>
                <button type="button" onClick={() => removeOptType(i)} className="text-[11.5px] text-red-400 hover:text-red-600">삭제</button>
              </div>
              {/* 값 태그들 */}
              <div className="flex flex-wrap gap-1.5">
                {opt.values.map((v, vi) => (
                  <span key={vi} className="inline-flex items-center gap-1 bg-[#EBF1FE] text-[#3182F6] text-[12.5px] font-medium px-2.5 py-1 rounded-lg">
                    {v}
                    <button type="button" onClick={() => removeValue(i, vi)} className="hover:text-red-500 transition-colors">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <div className="flex items-center gap-1">
                  <input
                    value={opt.inputVal}
                    onChange={(e) => setInputVal(i, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addValue(i); } }}
                    placeholder="값 입력 후 Enter"
                    className={`${inputCls} w-36`}
                  />
                  <button type="button" onClick={() => addValue(i)} className="h-9 w-9 flex items-center justify-center rounded-xl bg-[#EBF1FE] text-[#3182F6] hover:bg-[#3182F6] hover:text-white transition-colors">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {/* 옵션 타입 추가 */}
          <div className="flex gap-2">
            <input
              value={newOptKey}
              onChange={(e) => setNewOptKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOptType(); } }}
              placeholder="옵션명 추가 (예: 색상, 사이즈)"
              className={`${inputCls} flex-1`}
            />
            <button type="button" onClick={addOptType} className="h-9 px-3 rounded-xl border border-[#3182F6] text-[#3182F6] text-[13px] font-medium hover:bg-[#EBF1FE] transition-colors whitespace-nowrap">
              + 옵션 추가
            </button>
          </div>
        </div>

        {/* 조합 미리보기 */}
        {comboCount > 1 && (
          <div className="bg-[#EBF1FE] rounded-xl px-4 py-3">
            <p className="text-[13px] font-semibold text-[#3182F6]">총 {comboCount}개 SKU가 생성됩니다</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {combos.map((c, i) => (
                <span key={i} className="text-[11.5px] bg-white text-[#6B7684] px-2 py-0.5 rounded-lg">
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
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">공급처 <span className="text-[11.5px] text-[#B0B8C1] font-normal">(선택)</span></label>
            <select value={form.supplier_id} onChange={(e) => {
              const sup = suppliers.find((s) => s.id === e.target.value);
              set('supplier_id', e.target.value);
              if (sup && !form.lead_time_days) set('lead_time_days', String(sup.lead_time_days));
            }}
              className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] bg-white focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors">
              <option value="">공급처 선택</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.alias ?? s.name}</option>)}
            </select>
          </div>
          <InputField label="리드타임 (일)" hint="(일)" type="number" min="1" placeholder="21" value={form.lead_time_days} onChange={(e) => set('lead_time_days', e.target.value)} />
        </div>

        {/* 발주점/안전재고 */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">발주점 / 안전재고</label>
            <span className="text-[11.5px] text-[#B0B8C1] font-normal">(선택)</span>
          </div>
          <div className="flex items-start gap-2 bg-[#F8F9FB] rounded-xl px-3 py-2.5">
            <Info className="h-3.5 w-3.5 text-[#B0B8C1] mt-0.5 shrink-0" />
            <p className="text-[12px] text-[#6B7684]">
              판매 데이터 입력 후 <span className="text-[#3182F6] font-medium">재고 예측</span>에서 자동 계산됩니다.
              직접 설정하려면 마스터 시트를 이용하세요.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InputField label="발주점" type="number" placeholder="0" value={form.reorder_point} onChange={(e) => set('reorder_point', e.target.value)} />
            <InputField label="안전재고" type="number" placeholder="0" value={form.safety_stock} onChange={(e) => set('safety_stock', e.target.value)} />
          </div>
        </div>

        {error && <p className="text-[13px] text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[14px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">취소</button>
          <button type="submit" disabled={loading} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[14px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {comboCount > 1 ? `SKU ${comboCount}개 생성` : '저장'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Platform Setup Dialog ───────────────────────────────────────────────────

interface ChannelEntry { name: string; product_id: string; price: string; }

function PlatformSetupDialog({ skus, onClose }: {
  skus: NewSkuInfo[];
  onClose: () => void;
}) {
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [entries, setEntries] = useState<Record<string, Record<string, ChannelEntry>>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch('/api/settings/channels').then((r) => r.json()).then((data: { id: string; name: string }[]) => {
      setChannels(data ?? []);
      const init: Record<string, Record<string, ChannelEntry>> = {};
      for (const sku of skus) {
        init[sku.id] = {};
        for (const ch of data ?? []) {
          init[sku.id][ch.id] = { name: '', product_id: '', price: '' };
        }
      }
      setEntries(init);
    });
  }, [skus]);

  function updateEntry(skuId: string, chId: string, field: keyof ChannelEntry, val: string) {
    setEntries((prev) => ({
      ...prev,
      [skuId]: { ...prev[skuId], [chId]: { ...prev[skuId][chId], [field]: val } },
    }));
  }

  async function handleSave() {
    setSaving(true);
    const tasks: Promise<unknown>[] = [];
    for (const sku of skus) {
      for (const ch of channels) {
        const e = entries[sku.id]?.[ch.id];
        if (!e?.name.trim() && !e?.product_id.trim() && !e?.price.trim()) continue;
        tasks.push(
          fetch('/api/platform-skus', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sku_id: sku.id,
              channel_id: ch.id,
              platform_product_name: e.name.trim() || null,
              platform_product_id: e.product_id.trim() || null,
              price: e.price.trim() ? Number(e.price) : null,
            }),
          })
        );
        if (e.name.trim()) {
          tasks.push(
            fetch('/api/sku-aliases', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ channel_name: e.name.trim(), sku_id: sku.id }),
            })
          );
        }
      }
    }
    await Promise.all(tasks);
    setSaving(false);
    setDone(true);
    setTimeout(onClose, 800);
  }

  const inputCls = 'w-full h-8 px-2.5 rounded-lg border border-[#E5E8EB] text-[12.5px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] transition-colors';

  if (!channels.length) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.14)] w-full max-w-xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6] shrink-0">
          <div>
            <h2 className="text-[16px] font-bold text-[#191F28]">플랫폼 상품 정보 등록</h2>
            <p className="text-[12.5px] text-[#6B7684] mt-0.5">각 채널의 상품명과 판매가를 입력하면 주문 자동 매칭에 사용됩니다</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6] transition-colors ml-3 shrink-0">
            <X className="h-4 w-4 text-[#6B7684]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {skus.map((sku) => (
            <div key={sku.id} className="space-y-2">
              {/* SKU 헤더 */}
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] bg-[#F2F4F6] text-[#6B7684] px-2 py-1 rounded-lg">{sku.sku_code}</span>
                {sku.option_label && <span className="text-[12px] text-[#191F28] font-medium">{sku.option_label}</span>}
              </div>
              {/* 채널별 입력 */}
              <div className="border border-[#E5E8EB] rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-[#F8F9FB] border-b border-[#F2F4F6]">
                      <th className="text-left text-[11px] font-semibold text-[#6B7684] px-3 py-2 w-[100px]">채널</th>
                      <th className="text-left text-[11px] font-semibold text-[#6B7684] px-3 py-2">플랫폼 상품명</th>
                      <th className="text-left text-[11px] font-semibold text-[#6B7684] px-3 py-2 w-[120px]">상품 ID</th>
                      <th className="text-left text-[11px] font-semibold text-[#6B7684] px-3 py-2 w-[90px]">판매가</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F4F6]">
                    {channels.map((ch) => {
                      const e = entries[sku.id]?.[ch.id] ?? { name: '', product_id: '', price: '' };
                      return (
                        <tr key={ch.id}>
                          <td className="px-3 py-2">
                            <span className="text-[12.5px] font-medium text-[#191F28]">{ch.name}</span>
                          </td>
                          <td className="px-2 py-1.5">
                            <input value={e.name} onChange={(ev) => updateEntry(sku.id, ch.id, 'name', ev.target.value)}
                              placeholder="플랫폼에 등록된 상품명" className={inputCls} />
                          </td>
                          <td className="px-2 py-1.5">
                            <input value={e.product_id} onChange={(ev) => updateEntry(sku.id, ch.id, 'product_id', ev.target.value)}
                              placeholder="상품 ID" className={inputCls} />
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" min="0" value={e.price} onChange={(ev) => updateEntry(sku.id, ch.id, 'price', ev.target.value)}
                              placeholder="0" className={inputCls} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#F2F4F6] flex gap-2 shrink-0">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[14px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
            나중에 하기
          </button>
          <button onClick={handleSave} disabled={saving || done}
            className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[14px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {done ? <><Check className="h-4 w-4" /> 저장완료</> : saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit SKU Dialog ────────────────────────────────────────────────────────

function EditSkuDialog({ open, onClose, sku, product, onSave }: {
  open: boolean; onClose: () => void; sku: Sku | null; product: Product | null; onSave: () => void;
}) {
  const [form, setForm] = useState({ sku_code: '', barcode: '', cost_price: '', reorder_point: '', safety_stock: '' });
  const [options, setOptions] = useState<OptionRow[]>([{ key: '', value: '' }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (sku) {
      setForm({
        sku_code: sku.sku_code,
        barcode: (sku as any).barcode ?? '',
        cost_price: String(sku.cost_price ?? ''),
        reorder_point: String(sku.reorder_point ?? ''),
        safety_stock: String(sku.safety_stock ?? ''),
      });
      const entries = Object.entries(sku.option_values ?? {});
      setOptions(entries.length > 0 ? entries.map(([k, v]) => ({ key: k, value: v })) : [{ key: '', value: '' }]);
    }
  }, [sku]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  function addOption() { setOptions((o) => [...o, { key: '', value: '' }]); }
  function removeOption(i: number) { setOptions((o) => o.filter((_, idx) => idx !== i)); }
  function setOption(i: number, field: 'key' | 'value', v: string) {
    setOptions((o) => o.map((row, idx) => idx === i ? { ...row, [field]: v } : row));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.sku_code.trim() || !sku) return;
    setLoading(true); setError('');
    try {
      const option_values: Record<string, string> = {};
      options.forEach((o) => { if (o.key.trim()) option_values[o.key.trim()] = o.value.trim(); });

      const res = await fetch(`/api/skus/${sku.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku_code: form.sku_code.trim(),
          barcode: form.barcode.trim() || null,
          option_values,
          cost_price: form.cost_price ? Number(form.cost_price) : 0,
          reorder_point: form.reorder_point ? Number(form.reorder_point) : 0,
          safety_stock: form.safety_stock ? Number(form.safety_stock) : 0,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      onSave();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="SKU 수정">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 상품 컨텍스트 */}
        {product && (
          <div className="bg-[#F8F9FB] rounded-xl px-4 py-3">
            <p className="text-[13px] font-semibold text-[#191F28]">{product.name}</p>
            {product.brand && <p className="text-[12px] text-[#6B7684] mt-0.5">{product.brand}</p>}
          </div>
        )}

        <InputField label="제품코드" required placeholder="SKU 코드" value={form.sku_code} onChange={(e) => set('sku_code', e.target.value)} />
        <InputField label="바코드" hint="(쿠팡만 기입)" placeholder="쿠팡 바코드 번호" value={form.barcode} onChange={(e) => set('barcode', e.target.value)} />

        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-[#191F28]">옵션 값</label>
          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input placeholder="옵션명" value={opt.key} onChange={(e) => setOption(i, 'key', e.target.value)}
                  className="flex-1 h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] transition-colors" />
                <input placeholder="값" value={opt.value} onChange={(e) => setOption(i, 'value', e.target.value)}
                  className="flex-1 h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] transition-colors" />
                {options.length > 1 && (
                  <button type="button" onClick={() => removeOption(i)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-[#B0B8C1] hover:text-red-500 transition-colors">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addOption} className="mt-1 text-[12.5px] text-[#3182F6] font-medium flex items-center gap-1 hover:underline">
            <Plus className="h-3.5 w-3.5" /> 옵션 추가
          </button>
        </div>

        <VatCostFields exclVat={form.cost_price} onChange={(v) => set('cost_price', v)} />

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">발주점 / 안전재고</label>
            <span className="text-[11.5px] text-[#B0B8C1]">(선택)</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InputField label="발주점" type="number" placeholder="0" value={form.reorder_point} onChange={(e) => set('reorder_point', e.target.value)} />
            <InputField label="안전재고" type="number" placeholder="0" value={form.safety_stock} onChange={(e) => set('safety_stock', e.target.value)} />
          </div>
        </div>

        {error && <p className="text-[13px] text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[14px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">취소</button>
          <button type="submit" disabled={loading} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[14px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}저장
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── SKU Row ─────────────────────────────────────────────────────────────────

function SkuRow({ sku, onEdit, onDelete }: { sku: Sku; onEdit: () => void; onDelete: () => void }) {
  const inv = (sku.inventory ?? []).reduce((s, i) => s + (i.quantity ?? 0), 0);
  const barcode = (sku as any).barcode;

  return (
    <div className="flex items-center justify-between px-5 py-3 bg-[#F8F9FB] border-b border-[#F2F4F6] last:border-0">
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-1.5 h-1.5 rounded-full bg-[#B0B8C1] shrink-0 ml-1" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-[#191F28] font-mono">{sku.sku_code}</span>
            {Object.keys(sku.option_values ?? {}).length > 0 && (
              <span className="text-[11.5px] text-[#6B7684] bg-white border border-[#E5E8EB] px-2 py-0.5 rounded-lg">
                {skuOptionLabel(sku.option_values)}
              </span>
            )}
            {barcode && (
              <span className="text-[11px] text-[#B0B8C1] bg-white border border-[#E5E8EB] px-2 py-0.5 rounded-lg font-mono">{barcode}</span>
            )}
          </div>
          <p className="text-[12px] text-[#B0B8C1] mt-0.5">
            원가(VAT제외) {formatCurrency(sku.cost_price ?? 0)} · VAT포함 {formatCurrency(Math.round((sku.cost_price ?? 0) * 1.1))} · 발주점 {formatNumber(sku.reorder_point)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-3">
        <div className="text-right">
          <span className="text-[14px] font-bold text-[#191F28] tabular-nums">{formatNumber(inv)}</span>
          <span className="text-[11px] text-[#B0B8C1] ml-1">개</span>
        </div>
        <button onClick={onEdit} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#EBF1FE] text-[#6B7684] hover:text-[#3182F6] transition-colors">
          <Edit className="h-3.5 w-3.5" />
        </button>
        <button onClick={onDelete} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-red-50 text-[#6B7684] hover:text-red-500 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Product Row ──────────────────────────────────────────────────────────────

function ProductRow({ product, onEdit, onDelete, onAddSku, onEditSku, onDeleteSku }: {
  product: Product;
  onEdit: () => void; onDelete: () => void; onAddSku: () => void;
  onEditSku: (sku: Sku) => void; onDeleteSku: (sku: Sku) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const inv = totalInventory(product.skus);

  return (
    <div className="border-b border-[#F2F4F6] last:border-0">
      <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-[#FAFAFA] transition-colors" onClick={() => setExpanded((v) => !v)}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#EBF1FE] flex items-center justify-center shrink-0">
            <Package className="h-[18px] w-[18px] text-[#3182F6]" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-semibold text-[#191F28] tracking-[-0.02em]">{product.name}</span>
              {product.brand && <span className="text-[11.5px] text-[#6B7684] bg-[#F2F4F6] px-2 py-0.5 rounded-lg">{product.brand}</span>}
              {product.category && <span className="text-[11.5px] text-[#6B7684] bg-[#F2F4F6] px-2 py-0.5 rounded-lg">옵션: {product.category}</span>}
            </div>
            <p className="text-[12px] text-[#B0B8C1] mt-0.5">SKU {formatNumber((product.skus ?? []).length)}개 · 총 재고 {formatNumber(inv)}개</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
          <button onClick={onEdit} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#EBF1FE] text-[#6B7684] hover:text-[#3182F6] transition-colors">
            <Edit className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-red-50 text-[#6B7684] hover:text-red-500 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <div className="w-px h-4 bg-[#E5E8EB]" />
          {expanded ? <ChevronUp className="h-4 w-4 text-[#B0B8C1]" /> : <ChevronDown className="h-4 w-4 text-[#B0B8C1]" />}
        </div>
      </div>

      {expanded && (
        <div>
          {(product.skus ?? []).length === 0 ? (
            <div className="px-5 py-4 text-[13px] text-[#B0B8C1] bg-[#F8F9FB]">등록된 SKU가 없습니다.</div>
          ) : (
            (product.skus ?? []).map((sku) => (
              <SkuRow key={sku.id} sku={sku} onEdit={() => onEditSku(sku)} onDelete={() => onDeleteSku(sku)} />
            ))
          )}
          <div className="px-5 py-3 bg-[#F8F9FB]">
            <button onClick={(e) => { e.stopPropagation(); onAddSku(); }} className="flex items-center gap-1.5 text-[12.5px] text-[#3182F6] font-medium hover:underline">
              <Plus className="h-3.5 w-3.5" /> SKU 추가
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [addSkuProduct, setAddSkuProduct] = useState<Product | null>(null);
  const [editSkuState, setEditSkuState] = useState<{ sku: Sku; product: Product } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'product' | 'sku'; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [platformSetupSkus, setPlatformSetupSkus] = useState<NewSkuInfo[] | null>(null);

  async function loadProducts() {
    setLoading(true);
    try { setProducts(await fetch('/api/products').then((r) => r.json())); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadProducts(); }, []);

  async function handleDelete() {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await fetch(deleteConfirm.type === 'product' ? `/api/products/${deleteConfirm.id}` : `/api/skus/${deleteConfirm.id}`, { method: 'DELETE' });
      await loadProducts();
    } finally { setDeleting(false); setDeleteConfirm(null); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-[#3182F6]" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[20px] font-bold tracking-[-0.03em] text-[#191F28]">상품 관리</h2>
          <p className="mt-1 text-[13.5px] text-[#6B7684]">상품과 SKU를 관리하세요</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCsvOpen(true)} className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13.5px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
            <Upload className="h-4 w-4" /> CSV 업로드
          </button>
          <button onClick={() => setAddProductOpen(true)} className="flex items-center gap-2 h-10 px-4 rounded-xl bg-[#3182F6] text-white text-[13.5px] font-semibold hover:bg-[#1B64DA] transition-colors">
            <Plus className="h-4 w-4" /> 상품 추가
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <p className="text-[12px] text-[#6B7684] font-medium mb-1">총 상품 수</p>
          <div className="flex items-baseline gap-1">
            <span className="text-[24px] font-bold text-[#3182F6] tracking-[-0.04em]">{formatNumber(products.length)}</span>
            <span className="text-[13px] text-[#B0B8C1]">개</span>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <p className="text-[12px] text-[#6B7684] font-medium mb-1">총 SKU 수</p>
          <div className="flex items-baseline gap-1">
            <span className="text-[24px] font-bold text-[#191F28] tracking-[-0.04em]">{formatNumber(products.reduce((s, p) => s + (p.skus ?? []).length, 0))}</span>
            <span className="text-[13px] text-[#B0B8C1]">개</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-[#F2F4F6] flex items-center justify-center mb-3">
              <Package className="h-6 w-6 text-[#B0B8C1]" />
            </div>
            <p className="text-[14px] font-medium text-[#6B7684]">등록된 상품이 없습니다</p>
            <button onClick={() => setAddProductOpen(true)} className="mt-4 flex items-center gap-2 h-10 px-4 rounded-xl bg-[#3182F6] text-white text-[13.5px] font-semibold hover:bg-[#1B64DA] transition-colors">
              <Plus className="h-4 w-4" /> 상품 추가
            </button>
          </div>
        ) : (
          products.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              onEdit={() => setEditProduct(product)}
              onDelete={() => setDeleteConfirm({ type: 'product', id: product.id, name: product.name })}
              onAddSku={() => setAddSkuProduct(product)}
              onEditSku={(sku) => setEditSkuState({ sku, product })}
              onDeleteSku={(sku) => setDeleteConfirm({ type: 'sku', id: sku.id, name: sku.sku_code })}
            />
          ))
        )}
      </div>

      <AddProductDialog open={addProductOpen} onClose={() => setAddProductOpen(false)}
        onSave={(skus) => { setAddProductOpen(false); loadProducts(); setPlatformSetupSkus(skus); }} />
      <EditProductDialog open={!!editProduct} onClose={() => setEditProduct(null)} product={editProduct} onSave={() => { setEditProduct(null); loadProducts(); }} />
      {addSkuProduct && (
        <AddSkuDialog open={true} onClose={() => setAddSkuProduct(null)} product={addSkuProduct}
          onSave={(skus) => { setAddSkuProduct(null); loadProducts(); setPlatformSetupSkus(skus); }} />
      )}
      {platformSetupSkus && (
        <PlatformSetupDialog skus={platformSetupSkus} onClose={() => setPlatformSetupSkus(null)} />
      )}
      {editSkuState && (
        <EditSkuDialog open={true} onClose={() => setEditSkuState(null)} sku={editSkuState.sku} product={editSkuState.product} onSave={() => { setEditSkuState(null); loadProducts(); }} />
      )}

      <CsvImportDialog
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        onImported={loadProducts}
        title="상품 CSV 일괄 등록"
        templateType="products"
        importUrl="/api/products/import"
        columns={['상품명', 'SKU코드', '사이즈', '색상', '기타옵션', '원가', '물류비', '리드타임(일)', '발주점', '안전재고', '공급처명', '초기재고']}
        description="행 1개 = SKU 1개. 같은 상품명은 자동으로 묶입니다. 템플릿 다운로드 후 # 설명 행을 참고하세요."
      />

      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="삭제 확인">
        <div className="space-y-4">
          <p className="text-[14px] text-[#191F28]"><span className="font-semibold">{deleteConfirm?.name}</span>을(를) 삭제하시겠습니까?</p>
          <p className="text-[13px] text-[#6B7684]">삭제된 데이터는 복구할 수 없습니다.</p>
          <div className="flex gap-2">
            <button onClick={() => setDeleteConfirm(null)} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[14px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">취소</button>
            <button onClick={handleDelete} disabled={deleting} className="flex-1 h-11 rounded-xl bg-red-500 text-white text-[14px] font-semibold hover:bg-red-600 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}삭제
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
