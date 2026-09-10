'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import { AppDialog as Dialog } from '@/components/ui/app-dialog';
import { inputClassName } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/**
 * 상품 추가 다이얼로그 + 공용 입력 필드. 상품 페이지와 마스터 시트에서 같이 쓴다.
 * 상품(products) 1건 + 기본 SKU 1건을 만든다. 옵션이 여러 개면 상품 페이지의 "SKU 추가"로 이어서 만든다.
 */
export function autoSkuCode(name: string) {
  const prefix = name.replace(/\s/g, '').slice(0, 4).toUpperCase();
  return `${prefix}-${Date.now().toString().slice(-5)}`;
}

const VAT_RATE = 0.1;


export function InputField({ label, hint, required, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label className="text-[13px] font-medium text-fg">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
        {hint && <span className="text-[11px] text-fg-5">{hint}</span>}
      </div>
      <input
        lang="ko"
        {...props}
        className="w-full h-11 px-3.5 rounded-xl border border-line text-[13px] text-fg placeholder:text-fg-5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-colors"
      />
    </div>
  );
}

// VAT 연동 원가 입력 컴포넌트
export function VatCostFields({ exclVat, onChange }: {
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

  const inputCls = cn(inputClassName, 'h-10');

  return (
    <div className="space-y-2">
      <label className="text-[13px] font-medium text-fg">
        원가 <span className="text-[11px] text-fg-5 font-normal">(VAT 미포함 · 최종 도착가)</span>
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <p className="text-[11px] text-fg-3 font-medium">VAT 제외</p>
          <input type="number" min="0" value={localExcl} onChange={(e) => handleExclChange(e.target.value)} placeholder="0" className={inputCls} />
        </div>
        <div className="space-y-1">
          <p className="text-[11px] text-fg-3 font-medium">VAT 포함 (×1.1)</p>
          <input type="number" min="0" value={localIncl} onChange={(e) => handleInclChange(e.target.value)} placeholder="0" className={inputCls} />
        </div>
      </div>
      {localExcl && (
        <p className="text-[11px] text-fg-5">
          VAT 제외 {formatCurrency(Number(localExcl))} → 포함 {formatCurrency(Math.round(Number(localExcl) * 1.1))}
        </p>
      )}
    </div>
  );
}


export type NewSkuInfo = { id: string; sku_code: string; option_label: string };

export function AddProductDialog({ open, onClose, onSave }: {
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

  const selectCls = cn(inputClassName, 'h-10');

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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-fg">공급처 <span className="text-[11px] text-fg-5 font-normal">(선택)</span></label>
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
          <Button variant="outline" size="lg" className="flex-1" type="button" onClick={onClose}>취소</Button>
          <Button size="lg" className="flex-1" type="submit" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}저장
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
