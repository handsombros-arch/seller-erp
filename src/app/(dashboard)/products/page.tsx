'use client';

import { useState, useEffect } from 'react';
import { formatCurrency, formatNumber, skuOptionLabel, cn } from '@/lib/utils';
import type { Product, Sku } from '@/types';
import {
  Package, Plus, Edit, Trash2, ChevronDown, ChevronUp, Loader2, X, Check, Upload,
} from 'lucide-react';
import CsvImportDialog from '@/components/CsvImportDialog';
import { AddProductDialog, InputField, VatCostFields, type NewSkuInfo } from '@/components/products/AddProductDialog';
import { AddSkuDialog } from '@/components/products/AddSkuDialog';

import { PageHeader } from '@/components/ui/page-header';

import { AppDialog as Dialog } from '@/components/ui/app-dialog';

import { inputClassName } from '@/components/ui/input';

import { Button } from '@/components/ui/button';

// ─── Helpers ───────────────────────────────────────────────────────────────

function totalInventory(skus: Sku[] | undefined): number {
  if (!skus) return 0;
  return skus.reduce((sum, sku) => {
    return sum + (sku.inventory ?? []).reduce((s, i) => s + (i.quantity ?? 0), 0);
  }, 0);
}

// ─── Dialog ─────────────────────────────────────────────────────────────────


// ─── Add Product Dialog ─────────────────────────────────────────────────────

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
          <Button variant="outline" size="lg" className="flex-1" type="button" onClick={onClose}>취소</Button>
          <Button size="lg" className="flex-1" type="submit" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}저장
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Add SKU Dialog ─────────────────────────────────────────────────────────

interface OptionRow { key: string; value: string; }
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

  const inputCls = cn(inputClassName, 'text-[12px] px-2.5');

  if (!channels.length) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-card rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.14)] w-full max-w-xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-line-2 shrink-0">
          <div>
            <h2 className="text-[15px] font-bold text-fg">플랫폼 상품 정보 등록</h2>
            <p className="text-[12px] text-fg-3 mt-0.5">각 채널의 상품명과 판매가를 입력하면 주문 자동 매칭에 사용됩니다</p>
          </div>
          <Button variant="ghost" size="icon" className="ml-3 shrink-0" onClick={onClose}>
            <X className="h-4 w-4 text-fg-3" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {skus.map((sku) => (
            <div key={sku.id} className="space-y-2">
              {/* SKU 헤더 */}
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] bg-app text-fg-3 px-2 py-1 rounded-lg">{sku.sku_code}</span>
                {sku.option_label && <span className="text-[12px] text-fg font-medium">{sku.option_label}</span>}
              </div>
              {/* 채널별 입력 */}
              <div className="border border-line rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-card-2 border-b border-line-2">
                      <th className="text-left text-[11px] font-semibold text-fg-3 px-3 py-2 w-[100px]">채널</th>
                      <th className="text-left text-[11px] font-semibold text-fg-3 px-3 py-2">플랫폼 상품명</th>
                      <th className="text-left text-[11px] font-semibold text-fg-3 px-3 py-2 w-[120px]">상품 ID</th>
                      <th className="text-left text-[11px] font-semibold text-fg-3 px-3 py-2 w-[90px]">판매가</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-2">
                    {channels.map((ch) => {
                      const e = entries[sku.id]?.[ch.id] ?? { name: '', product_id: '', price: '' };
                      return (
                        <tr key={ch.id}>
                          <td className="px-3 py-2">
                            <span className="text-[12px] font-medium text-fg">{ch.name}</span>
                          </td>
                          <td className="px-2 py-1.5">
                            <input lang="ko" value={e.name} onChange={(ev) => updateEntry(sku.id, ch.id, 'name', ev.target.value)}
                              placeholder="플랫폼에 등록된 상품명" className={inputCls} />
                          </td>
                          <td className="px-2 py-1.5">
                            <input lang="ko" value={e.product_id} onChange={(ev) => updateEntry(sku.id, ch.id, 'product_id', ev.target.value)}
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
        <div className="px-6 py-4 border-t border-line-2 flex gap-2 shrink-0">
          <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
            나중에 하기
          </Button>
          <Button size="lg" className="flex-1" onClick={handleSave} disabled={saving || done}
           >
            {done ? <><Check className="h-4 w-4" /> 저장완료</> : saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '저장'}
          </Button>
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
          <div className="bg-card-2 rounded-xl px-4 py-3">
            <p className="text-[13px] font-semibold text-fg">{product.name}</p>
            {product.brand && <p className="text-[12px] text-fg-3 mt-0.5">{product.brand}</p>}
          </div>
        )}

        <InputField label="제품코드" required placeholder="SKU 코드" value={form.sku_code} onChange={(e) => set('sku_code', e.target.value)} />
        <InputField label="바코드" hint="(쿠팡만 기입)" placeholder="쿠팡 바코드 번호" value={form.barcode} onChange={(e) => set('barcode', e.target.value)} />

        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-fg">옵션 값</label>
          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input lang="ko" placeholder="옵션명" value={opt.key} onChange={(e) => setOption(i, 'key', e.target.value)}
                  className="flex-1 h-10 px-3 rounded-xl border border-line text-[13px] placeholder:text-fg-5 focus:outline-none focus:border-brand transition-colors" />
                <input lang="ko" placeholder="값" value={opt.value} onChange={(e) => setOption(i, 'value', e.target.value)}
                  className="flex-1 h-10 px-3 rounded-xl border border-line text-[13px] placeholder:text-fg-5 focus:outline-none focus:border-brand transition-colors" />
                {options.length > 1 && (
                  <button type="button" onClick={() => removeOption(i)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-fg-5 hover:text-red-500 transition-colors">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addOption} className="mt-1 text-[12px] text-brand font-medium flex items-center gap-1 hover:underline">
            <Plus className="h-3.5 w-3.5" /> 옵션 추가
          </button>
        </div>

        <VatCostFields exclVat={form.cost_price} onChange={(v) => set('cost_price', v)} />

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <label className="text-[13px] font-medium text-fg">발주점 / 안전재고</label>
            <span className="text-[11px] text-fg-5">(선택)</span>
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
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}저장
          </Button>
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
    <div className="flex items-center justify-between px-5 py-3 bg-card-2 border-b border-line-2 last:border-0">
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-1.5 h-1.5 rounded-full bg-fg-5 shrink-0 ml-1" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-fg font-mono">{sku.sku_code}</span>
            {Object.keys(sku.option_values ?? {}).length > 0 && (
              <span className="text-[11px] text-fg-3 bg-card border border-line px-2 py-0.5 rounded-lg">
                {skuOptionLabel(sku.option_values)}
              </span>
            )}
            {barcode && (
              <span className="text-[11px] text-fg-5 bg-card border border-line px-2 py-0.5 rounded-lg font-mono">{barcode}</span>
            )}
          </div>
          <p className="text-[12px] text-fg-5 mt-0.5">
            원가(VAT제외) {formatCurrency(sku.cost_price ?? 0)} · VAT포함 {formatCurrency(Math.round((sku.cost_price ?? 0) * 1.1))} · 발주점 {formatNumber(sku.reorder_point)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-3">
        <div className="text-right">
          <span className="text-[13px] font-bold text-fg tabular-nums">{formatNumber(inv)}</span>
          <span className="text-[11px] text-fg-5 ml-1">개</span>
        </div>
        <Button variant="ghost" size="icon" className="hover:bg-brand-bg hover:text-brand" onClick={onEdit}>
          <Edit className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="hover:bg-danger/10 hover:text-danger" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
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
    <div className="border-b border-line-2 last:border-0">
      <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-card-2 transition-colors" onClick={() => setExpanded((v) => !v)}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-10 rounded-xl bg-brand-bg flex items-center justify-center shrink-0">
            <Package className="h-[18px] w-[18px] text-brand" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-semibold text-fg tracking-[-0.02em]">{product.name}</span>
              {product.brand && <span className="text-[11px] text-fg-3 bg-app px-2 py-0.5 rounded-lg">{product.brand}</span>}
              {product.category && <span className="text-[11px] text-fg-3 bg-app px-2 py-0.5 rounded-lg">옵션: {product.category}</span>}
            </div>
            <p className="text-[12px] text-fg-5 mt-0.5">SKU {formatNumber((product.skus ?? []).length)}개 · 총 재고 {formatNumber(inv)}개</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="hover:bg-brand-bg hover:text-brand" onClick={onEdit}>
            <Edit className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="hover:bg-danger/10 hover:text-danger" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <div className="w-px h-4 bg-line" />
          {expanded ? <ChevronUp className="h-4 w-4 text-fg-5" /> : <ChevronDown className="h-4 w-4 text-fg-5" />}
        </div>
      </div>

      {expanded && (
        <div>
          {(product.skus ?? []).length === 0 ? (
            <div className="px-5 py-4 text-[13px] text-fg-5 bg-card-2">등록된 SKU가 없습니다.</div>
          ) : (
            (product.skus ?? []).map((sku) => (
              <SkuRow key={sku.id} sku={sku} onEdit={() => onEditSku(sku)} onDelete={() => onDeleteSku(sku)} />
            ))
          )}
          <div className="px-5 py-3 bg-card-2">
            <button onClick={(e) => { e.stopPropagation(); onAddSku(); }} className="flex items-center gap-1.5 text-[12px] text-brand font-medium hover:underline">
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
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div className="min-w-0">
          <PageHeader title="상품 관리" />
          <p className="mt-1 text-[13px] text-fg-3">상품과 SKU를 관리하세요</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="lg" onClick={() => setCsvOpen(true)}>
            <Upload className="h-4 w-4" /> CSV 업로드
          </Button>
          <button onClick={() => setAddProductOpen(true)} className="flex items-center gap-2 h-10 px-4 rounded-xl bg-brand text-white text-[13px] font-semibold hover:bg-brand-hover transition-colors whitespace-nowrap">
            <Plus className="h-4 w-4" /> 상품 추가
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-card rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <p className="text-[12px] text-fg-3 font-medium mb-1">총 상품 수</p>
          <div className="flex items-baseline gap-1">
            <span className="text-[24px] font-bold text-brand tracking-[-0.04em]">{formatNumber(products.length)}</span>
            <span className="text-[13px] text-fg-5">개</span>
          </div>
        </div>
        <div className="bg-card rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <p className="text-[12px] text-fg-3 font-medium mb-1">총 SKU 수</p>
          <div className="flex items-baseline gap-1">
            <span className="text-[24px] font-bold text-fg tracking-[-0.04em]">{formatNumber(products.reduce((s, p) => s + (p.skus ?? []).length, 0))}</span>
            <span className="text-[13px] text-fg-5">개</span>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-app flex items-center justify-center mb-3">
              <Package className="h-6 w-6 text-fg-5" />
            </div>
            <p className="text-[13px] font-medium text-fg-3">등록된 상품이 없습니다</p>
            <button onClick={() => setAddProductOpen(true)} className="mt-4 flex items-center gap-2 h-10 px-4 rounded-xl bg-brand text-white text-[13px] font-semibold hover:bg-brand-hover transition-colors">
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
          <p className="text-[13px] text-fg"><span className="font-semibold">{deleteConfirm?.name}</span>을(를) 삭제하시겠습니까?</p>
          <p className="text-[13px] text-fg-3">삭제된 데이터는 복구할 수 없습니다.</p>
          <div className="flex gap-2">
            <Button variant="outline" size="lg" className="flex-1" onClick={() => setDeleteConfirm(null)}>취소</Button>
            <Button variant="destructive" size="lg" className="flex-1 bg-danger text-white hover:bg-danger/90" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}삭제
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
