'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import type { Product } from '@/types';
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

/**
 * 상품만 만든다 (SKU 는 만들지 않음). 저장 후 onSave(product) → 호출한 쪽이 옵션(SKU) 추가 창을 바로 연다.
 * 옵션 없이 기본 SKU 를 자동 생성하던 방식은 폐지 (사용자: 옵션은 매번 직접 기입).
 */
export function AddProductDialog({ open, onClose, onSave }: {
  open: boolean; onClose: () => void; onSave: (product: Product) => void;
}) {
  const [form, setForm] = useState({ name: '', brand: '', optionName: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setForm({ name: '', brand: '', optionName: '' }); setError(''); } }, [open]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('상품명을 입력해주세요.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), brand: form.brand.trim() || null, category: form.optionName.trim() || null }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const product = await res.json() as Product;
      onSave(product);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="상품 추가" description="저장하면 바로 옵션(SKU) 추가 창이 열립니다. 원가·공급처·바코드는 옵션마다 거기서 넣습니다.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <InputField label="상품명" required placeholder="예: 그랑누보 데일리 백팩" value={form.name} onChange={(e) => set('name', e.target.value)} />
        <InputField label="브랜드" placeholder="예: 그랑누보" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
        <InputField label="옵션명" hint="(색상, 사이즈 등 옵션 종류 이름 · 다음 창에서 값을 넣습니다)" placeholder="예: 색상" value={form.optionName} onChange={(e) => set('optionName', e.target.value)} />
        {error && <p className="text-[13px] text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="lg" className="flex-1" type="button" onClick={onClose}>취소</Button>
          <Button size="lg" className="flex-1" type="submit" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}다음: 옵션 추가
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
