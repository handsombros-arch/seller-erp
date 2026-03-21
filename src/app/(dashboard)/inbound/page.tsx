'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatNumber, formatCurrency, formatDate, skuOptionLabel } from '@/lib/utils';
import { useVat } from '@/components/layout/vat-provider';
import type { PurchaseOrder, PurchaseOrderItem, InboundRecord, Sku, Warehouse, Supplier } from '@/types';
import {
  PackageCheck, PackageMinus, Plus, ChevronDown, ChevronUp, Loader2, X, CalendarDays, Truck, Trash2,
} from 'lucide-react';
import { SearchSelect } from '@/components/ui/search-select';
import dynamic from 'next/dynamic';

const OutboundTab = dynamic(() => import('@/components/logistics/OutboundTab'), { loading: () => <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" /></div> });
const CalendarTab = dynamic(() => import('@/components/logistics/CalendarTab'), { loading: () => <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" /></div> });

// ─── Types ─────────────────────────────────────────────────────────────────

type POStatus = 'draft' | 'ordered' | 'transiting' | 'partial' | 'completed' | 'cancelled';

interface PORow extends PurchaseOrder {
  items: (PurchaseOrderItem & {
    sku: Sku & { product: { id: string; name: string } };
  })[];
}

interface InboundRow extends InboundRecord {
  sku: Sku & { product: { id: string; name: string } };
  warehouse: Warehouse;
}

interface SkuOption {
  id: string;
  sku_code: string;
  option_values: Record<string, string>;
  cost_price: number;
  logistics_cost: number;
  lead_time_days: number;
  product: { name: string };
}

// ─── Constants ─────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

const STATUS_MAP: Record<POStatus, { label: string; color: string }> = {
  draft:      { label: '초안',    color: 'bg-[#F2F4F6] text-[#6B7684]' },
  ordered:    { label: '발주완료', color: 'bg-blue-50 text-blue-600' },
  transiting: { label: '수입중',   color: 'bg-orange-50 text-orange-600' },
  partial:    { label: '부분입고', color: 'bg-amber-50 text-amber-600' },
  completed:  { label: '완료',    color: 'bg-green-50 text-green-600' },
  cancelled:  { label: '취소',    color: 'bg-red-50 text-red-500' },
};

// ─── Dialog Component ───────────────────────────────────────────────────────

function Dialog({ open, onClose, title, children, wide }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full mx-4 max-h-[90vh] overflow-y-auto ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
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

function InputField({ label, required, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[13px] font-medium text-[#191F28]">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        {...props}
        className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors"
      />
    </div>
  );
}

// ─── Add PO Dialog ──────────────────────────────────────────────────────────

interface POItemDraft { sku_id: string; quantity: string; unit_cost: string }

function calcExpectedDate(orderDate: string, leadTime: string, transit: string) {
  if (!orderDate) return '';
  const lt = parseInt(leadTime) || 0;
  const tr = parseInt(transit) || 0;
  const d = new Date(orderDate);
  d.setDate(d.getDate() + lt + tr);
  return d.toISOString().slice(0, 10);
}

function AddPODialog({ open, onClose, skus, onSave }: {
  open: boolean;
  onClose: () => void;
  skus: SkuOption[];
  onSave: (po: PORow) => void;
}) {
  const [form, setForm] = useState({ supplier: '', order_date: TODAY, expected_date: '', note: '', inbound_type: 'import', lead_time_days: '', transit_days: '10' });
  const [items, setItems] = useState<POItemDraft[]>([{ sku_id: '', quantity: '', unit_cost: '' }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');

  useEffect(() => {
    if (open) fetch('/api/suppliers').then((r) => r.json()).then(setSuppliers);
  }, [open]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function handleSupplierSelect(supplierId: string) {
    setSelectedSupplierId(supplierId);
    const supplier = suppliers.find((s) => s.id === supplierId);
    set('supplier', supplier?.name ?? '');
  }

  function handleOrderDateChange(v: string) {
    setForm((f) => ({ ...f, order_date: v, expected_date: calcExpectedDate(v, f.lead_time_days, f.transit_days) }));
  }

  function handleLeadTimeChange(v: string) {
    setForm((f) => ({ ...f, lead_time_days: v, expected_date: calcExpectedDate(f.order_date, v, f.transit_days) }));
  }

  function handleTransitDaysChange(v: string) {
    setForm((f) => ({ ...f, transit_days: v, expected_date: calcExpectedDate(f.order_date, f.lead_time_days, v) }));
  }

  function addItem() { setItems((i) => [...i, { sku_id: '', quantity: '', unit_cost: '' }]); }
  function removeItem(i: number) { setItems((prev) => prev.filter((_, idx) => idx !== i)); }
  function setItem(i: number, k: keyof POItemDraft, v: string) {
    setItems((prev) => prev.map((row, idx) => idx === i ? { ...row, [k]: v } : row));
  }
  function handleSkuSelect(i: number, skuId: string) {
    const sku = skus.find((s) => s.id === skuId);
    setItems((prev) => prev.map((row, idx) => idx === i ? {
      ...row,
      sku_id: skuId,
      unit_cost: sku && sku.cost_price ? String(sku.cost_price) : row.unit_cost,
    } : row));
  }

  const { vatMult, vatOn } = useVat();

  const skuOptions = useMemo(() => skus.map((s) => {
    const optLabel = skuOptionLabel(s.option_values ?? {});
    return {
      id: s.id,
      label: s.product.name,
      sub: s.sku_code + (optLabel ? ` · ${optLabel}` : ''),
      extra: s.cost_price > 0 ? `원가 ${formatCurrency(s.cost_price * vatMult)}` : undefined,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [skus, vatMult]);

  const total = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_cost) || 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter((i) => i.sku_id && Number(i.quantity) > 0);
    if (validItems.length === 0) { setError('최소 1개의 품목을 입력해주세요.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier: form.supplier.trim() || null,
          inbound_type: form.inbound_type,
          order_date: form.order_date || null,
          expected_date: form.expected_date || null,
          note: form.note.trim() || null,
          items: validItems.map((i) => ({
            sku_id: i.sku_id,
            quantity: Number(i.quantity),
            unit_cost: Number(i.unit_cost) || 0,
          })),
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const data = await res.json();
      onSave(data);
      setForm({ supplier: '', order_date: TODAY, expected_date: '', note: '', inbound_type: 'import', lead_time_days: '', transit_days: '10' });
      setItems([{ sku_id: '', quantity: '', unit_cost: '' }]);
      setSelectedSupplierId('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="발주서 생성" wide>
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 입고 유형 */}
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-[#191F28]">입고 유형 *</label>
          <div className="flex gap-2">
            {[
              { value: 'import', label: '해외수입 (중국 등)' },
              { value: 'local',  label: '국내구매' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set('inbound_type', opt.value)}
                className={`flex-1 h-10 rounded-xl text-[13px] font-medium border transition-colors ${
                  form.inbound_type === opt.value
                    ? 'bg-[#3182F6] text-white border-[#3182F6]'
                    : 'bg-white text-[#6B7684] border-[#E5E8EB] hover:bg-[#F2F4F6]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">공급사</label>
            <select
              value={selectedSupplierId}
              onChange={(e) => handleSupplierSelect(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors bg-white"
            >
              <option value="">공급사 선택</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <InputField label="발주일" type="date" value={form.order_date} onChange={(e) => handleOrderDateChange(e.target.value)} />
        </div>

        {/* 리드타임 + 운송기간 → 입고 예정일 자동 계산 */}
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">리드타임 (일)</label>
            <input
              type="number" min="0" placeholder="예: 30"
              value={form.lead_time_days}
              onChange={(e) => handleLeadTimeChange(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors"
            />
            <p className="text-[11px] text-[#B0B8C1]">품목 최대 리드타임 자동</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">운송기간 (일)</label>
            <input
              type="number" min="0" placeholder="10"
              value={form.transit_days}
              onChange={(e) => handleTransitDaysChange(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">입고 예정일</label>
            <input
              type="date"
              value={form.expected_date}
              onChange={(e) => set('expected_date', e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-[#3182F6] bg-[#EBF1FE] text-[14px] text-[#191F28] focus:outline-none focus:ring-2 focus:ring-[#3182F6]/10 transition-colors"
            />
            {form.lead_time_days && form.transit_days && (
              <p className="text-[11px] text-[#3182F6]">리드타임 {form.lead_time_days}일 + 운송 {form.transit_days}일</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <InputField label="비고" placeholder="메모" value={form.note} onChange={(e) => set('note', e.target.value)} />
        </div>

        {/* Items */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[13px] font-medium text-[#191F28]">품목 <span className="text-red-500">*</span></label>
            <button type="button" onClick={addItem} className="flex items-center gap-1 text-[12.5px] text-[#3182F6] font-medium hover:underline">
              <Plus className="h-3.5 w-3.5" /> 품목 추가
            </button>
          </div>
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="space-y-1">
                <div className="flex gap-2 items-start">
                  <div className="flex-1">
                    <SearchSelect
                      options={skuOptions}
                      value={item.sku_id}
                      onChange={(id) => handleSkuSelect(i, id)}
                      placeholder="상품명 또는 SKU코드 검색..."
                    />
                  </div>
                  <input
                    type="number"
                    min="1"
                    placeholder="수량"
                    value={item.quantity}
                    onChange={(e) => setItem(i, 'quantity', e.target.value)}
                    className="w-24 h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] transition-colors"
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder="단가"
                    value={item.unit_cost}
                    onChange={(e) => setItem(i, 'unit_cost', e.target.value)}
                    className="w-28 h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] transition-colors"
                  />
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeItem(i)} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-red-50 text-[#B0B8C1] hover:text-red-500 transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {item.sku_id && (() => {
                  const sku = skus.find((s) => s.id === item.sku_id);
                  if (!sku) return null;
                  return (
                    <p className="text-[11.5px] text-[#B0B8C1] pl-1">
                      마스터 원가 {formatCurrency(sku.cost_price * vatMult)}{vatOn ? ' (VAT포함)' : ''}
                      {sku.logistics_cost > 0 && ` · 물류비 ${formatCurrency(sku.logistics_cost * vatMult)}`}
                      {(sku.lead_time_days ?? 0) > 0 && <span className="text-[#6B7684]"> · 리드타임 {sku.lead_time_days}일</span>}
                    </p>
                  );
                })()}
              </div>
            ))}
          </div>
          {total > 0 && (
            <div className="flex justify-end pt-1">
              <span className="text-[13px] font-semibold text-[#191F28]">합계: {formatCurrency(total * vatMult)}{vatOn ? ' (VAT포함)' : ''}</span>
            </div>
          )}
        </div>

        {error && <p className="text-[13px] text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[14px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
            취소
          </button>
          <button type="submit" disabled={loading} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[14px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            발주서 생성
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Inbound Process Dialog ─────────────────────────────────────────────────

function InboundProcessDialog({ open, onClose, poItem, warehouses, onSave }: {
  open: boolean;
  onClose: () => void;
  poItem: PORow['items'][0] | null;
  warehouses: Warehouse[];
  onSave: () => void;
}) {
  const [form, setForm] = useState({ quantity: '', warehouse_id: '', unit_cost: '', inbound_date: '', note: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (poItem) {
      const remaining = poItem.quantity - (poItem.received_quantity ?? 0);
      setForm({
        quantity: String(remaining > 0 ? remaining : poItem.quantity),
        warehouse_id: warehouses[0]?.id ?? '',
        unit_cost: String(poItem.unit_cost ?? ''),
        inbound_date: new Date().toISOString().slice(0, 10),
        note: '',
      });
      setError('');
    }
  }, [poItem, warehouses]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!poItem) return;
    if (!form.warehouse_id) { setError('창고를 선택해주세요.'); return; }
    if (!form.quantity || Number(form.quantity) <= 0) { setError('수량을 입력해주세요.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/inbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku_id: poItem.sku_id,
          warehouse_id: form.warehouse_id,
          quantity: Number(form.quantity),
          unit_cost: form.unit_cost ? Number(form.unit_cost) : null,
          inbound_date: form.inbound_date,
          note: form.note.trim() || null,
          po_item_id: poItem.id,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      onSave();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  if (!poItem) return null;
  const remaining = poItem.quantity - (poItem.received_quantity ?? 0);

  return (
    <Dialog open={open} onClose={onClose} title="입고 처리">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-[#F2F4F6] rounded-xl p-4 space-y-1">
          <p className="text-[13px] font-semibold text-[#191F28]">{poItem.sku?.product?.name}</p>
          <p className="text-[12px] text-[#6B7684]">{poItem.sku?.sku_code} · {skuOptionLabel(poItem.sku?.option_values ?? {})}</p>
          <p className="text-[12px] text-[#6B7684]">
            발주수량: {formatNumber(poItem.quantity)} | 입고완료: {formatNumber(poItem.received_quantity ?? 0)} | 잔여: {formatNumber(remaining)}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-[#191F28]">입고 수량 <span className="text-red-500">*</span></label>
          <input
            type="number"
            min="1"
            value={form.quantity}
            onChange={(e) => set('quantity', e.target.value)}
            className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-[#191F28]">창고 <span className="text-red-500">*</span></label>
          <select
            value={form.warehouse_id}
            onChange={(e) => set('warehouse_id', e.target.value)}
            className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors bg-white"
          >
            <option value="">창고 선택</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>

        <InputField label="실제 단가" type="number" min="0" placeholder="0" value={form.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} />
        <InputField label="입고일" type="date" value={form.inbound_date} onChange={(e) => set('inbound_date', e.target.value)} />
        <InputField label="비고" placeholder="메모 (선택)" value={form.note} onChange={(e) => set('note', e.target.value)} />

        {error && <p className="text-[13px] text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[14px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
            취소
          </button>
          <button type="submit" disabled={loading} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[14px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            입고 처리
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── PO Card ────────────────────────────────────────────────────────────────

function POCard({ po, warehouses, onStatusChange, onInboundSave, onDelete }: {
  po: PORow;
  warehouses: Warehouse[];
  onStatusChange: (po: PORow, status: POStatus) => void;
  onInboundSave: (poId: string) => void;
  onDelete: (poId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [inboundItem, setInboundItem] = useState<PORow['items'][0] | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const { vatMult, vatOn } = useVat();

  const status = STATUS_MAP[po.status] ?? { label: po.status, color: 'bg-gray-100 text-gray-600' };
  const canOrder    = po.status === 'draft';
  const canTransit  = po.status === 'ordered';
  const canComplete = po.status === 'transiting' || po.status === 'ordered' || po.status === 'partial';
  const canReopen   = po.status === 'completed';
  const canCancel   = po.status !== 'completed' && po.status !== 'cancelled';

  async function updateStatus(newStatus: POStatus) {
    setStatusLoading(true);
    setStatusError('');
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) { setStatusError(data?.error ?? '상태 변경 실패'); return; }
      onStatusChange(data, newStatus);
    } catch {
      setStatusError('네트워크 오류가 발생했습니다.');
    } finally {
      setStatusLoading(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`발주서 ${po.po_number}를 삭제하시겠습니까?\n품목 데이터도 함께 삭제됩니다.`)) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}`, { method: 'DELETE' });
      if (!res.ok) return;
      onDelete(po.id);
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="border-b border-[#F2F4F6] last:border-0">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-[#FAFAFA] transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
            <Truck className="h-4 w-4 text-[#FF6B00]" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-semibold text-[#191F28] tracking-[-0.02em]">{po.po_number}</span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${status.color}`}>{status.label}</span>
            </div>
            <p className="text-[12px] text-[#B0B8C1] mt-0.5">
              {po.supplier ?? '공급사 미지정'} · 품목 {(po.items ?? []).length}개 · {formatCurrency(po.total_amount * vatMult)}{vatOn ? '(VAT+)' : ''}
              {po.expected_date && ` · 입고예정 ${formatDate(po.expected_date)}`}
              {po.inbound_type === 'import' && (
                <span className="ml-1.5 text-[10.5px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md">해외수입</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
          {canOrder && (
            <button
              onClick={() => updateStatus('ordered')}
              disabled={statusLoading}
              className="h-8 px-3 rounded-xl bg-[#3182F6] text-white text-[12px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60"
            >
              발주완료
            </button>
          )}
          {canTransit && (
            <button
              onClick={() => updateStatus('transiting')}
              disabled={statusLoading}
              className="h-8 px-3 rounded-xl bg-orange-500 text-white text-[12px] font-semibold hover:bg-orange-600 transition-colors disabled:opacity-60"
            >
              수입중
            </button>
          )}
          {canComplete && (
            <button
              onClick={() => updateStatus('completed')}
              disabled={statusLoading}
              className="h-8 px-3 rounded-xl bg-green-500 text-white text-[12px] font-semibold hover:bg-green-600 transition-colors disabled:opacity-60"
            >
              완료
            </button>
          )}
          {canReopen && (
            <button
              onClick={() => updateStatus('partial')}
              disabled={statusLoading}
              title="완료 상태를 부분입고로 되돌립니다"
              className="h-8 px-3 rounded-xl border border-[#E5E8EB] text-[12px] font-medium text-[#6B7684] hover:bg-amber-50 hover:border-amber-300 hover:text-amber-600 transition-colors disabled:opacity-60"
            >
              완료 취소
            </button>
          )}
          {canCancel && po.status !== 'draft' && (
            <button
              onClick={() => updateStatus('cancelled')}
              disabled={statusLoading}
              className="h-8 px-3 rounded-xl border border-[#E5E8EB] text-[12px] font-medium text-[#6B7684] hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition-colors disabled:opacity-60"
            >
              취소
            </button>
          )}
          <div className="w-px h-4 bg-[#E5E8EB]" />
          <button
            onClick={handleDelete}
            disabled={deleteLoading}
            title="발주서 삭제"
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-red-50 text-[#B0B8C1] hover:text-red-500 transition-colors disabled:opacity-60"
          >
            {deleteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
          <div className="w-px h-4 bg-[#E5E8EB]" />
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-[#B0B8C1]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[#B0B8C1]" />
          )}
        </div>
      </div>

      {statusError && (
        <div className="px-5 py-2 bg-red-50 border-t border-red-100">
          <p className="text-[12px] text-red-600">{statusError}</p>
        </div>
      )}

      {expanded && (
        <div className="bg-[#F8F9FB] border-t border-[#F2F4F6]">
          {(po.items ?? []).length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-[#B0B8C1]">품목이 없습니다.</p>
          ) : (
            (po.items ?? []).map((item) => {
              const received = item.received_quantity ?? 0;
              const remaining = item.quantity - received;
              const isComplete = remaining <= 0;

              return (
                <div key={item.id} className="flex items-center justify-between px-5 py-3.5 border-b border-[#F2F4F6] last:border-0">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[#191F28]">{item.sku?.product?.name}</p>
                    <p className="text-[12px] text-[#6B7684] mt-0.5">
                      {item.sku?.sku_code} · {skuOptionLabel(item.sku?.option_values ?? {})}
                    </p>
                    <p className="text-[12px] text-[#B0B8C1] mt-0.5">
                      발주 {formatNumber(item.quantity)} | 입고완료 {formatNumber(received)} | 잔여 {formatNumber(Math.max(0, remaining))}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <div className="text-right">
                      <p className="text-[13px] font-semibold text-[#191F28]">{formatCurrency(item.unit_cost * vatMult)}</p>
                      <p className="text-[11px] text-[#B0B8C1]">{vatOn ? 'VAT포함 단가' : '단가'}</p>
                    </div>
                    {po.status !== 'cancelled' && po.status !== 'draft' && (
                      <button
                        onClick={() => setInboundItem(item)}
                        className={`h-8 px-3 rounded-xl text-[12px] font-semibold transition-colors whitespace-nowrap ${isComplete ? 'bg-[#F2F4F6] text-[#6B7684] hover:bg-green-50 hover:text-green-600' : 'bg-green-500 text-white hover:bg-green-600'}`}
                      >
                        {isComplete ? '재입고' : '입고 처리'}
                      </button>
                    )}
                    {isComplete && po.status !== 'cancelled' && po.status !== 'draft' && (
                      <span className="text-[11px] font-semibold text-green-600 bg-green-50 px-2.5 py-1 rounded-lg">완료</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      <InboundProcessDialog
        open={!!inboundItem}
        onClose={() => setInboundItem(null)}
        poItem={inboundItem}
        warehouses={warehouses}
        onSave={() => {
          setInboundItem(null);
          onInboundSave(po.id);
        }}
      />
    </div>
  );
}

// ─── Tab 1: PO Management ───────────────────────────────────────────────────

function POManagementTab() {
  const [pos, setPos] = useState<PORow[]>([]);
  const [loading, setLoading] = useState(true);
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/purchase-orders').then((r) => r.json()),
      fetch('/api/skus').then((r) => r.json()),
      fetch('/api/settings/warehouses').then((r) => r.json()),
    ]).then(([poData, skuData, whData]) => {
      setPos(poData);
      setSkus(skuData);
      setWarehouses(whData ?? []);
    }).finally(() => setLoading(false));
  }, []);

  async function refreshPO(poId: string) {
    const res = await fetch('/api/purchase-orders');
    const data: PORow[] = await res.json();
    setPos(data);
    void poId;
  }

  function handleStatusChange(updated: PORow) {
    setPos((prev) => prev.map((p) => p.id === updated.id ? updated : p));
  }

  function handleDelete(poId: string) {
    setPos((prev) => prev.filter((p) => p.id !== poId));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-[#3182F6]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13.5px] text-[#6B7684]">총 {formatNumber(pos.length)}개의 발주서</p>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 h-10 px-4 rounded-xl bg-[#3182F6] text-white text-[13.5px] font-semibold hover:bg-[#1B64DA] transition-colors"
        >
          <Plus className="h-4 w-4" />
          발주서 생성
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {pos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-[#F2F4F6] flex items-center justify-center mb-3">
              <Truck className="h-6 w-6 text-[#B0B8C1]" />
            </div>
            <p className="text-[14px] font-medium text-[#6B7684]">발주서가 없습니다</p>
            <p className="text-[13px] text-[#B0B8C1] mt-1">발주서 생성 버튼을 눌러 시작하세요</p>
          </div>
        ) : (
          pos.map((po) => (
            <POCard
              key={po.id}
              po={po}
              warehouses={warehouses}
              onStatusChange={handleStatusChange}
              onInboundSave={refreshPO}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      <AddPODialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        skus={skus}
        onSave={(po) => {
          setPos((prev) => [po, ...prev]);
          setAddOpen(false);
        }}
      />
    </div>
  );
}

// ─── Tab 2: Inbound Records ─────────────────────────────────────────────────

function InboundRecordsTab() {
  const [records, setRecords] = useState<InboundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const { vatMult, vatOn } = useVat();

  useEffect(() => {
    fetch('/api/inbound')
      .then((r) => r.json())
      .then(setRecords)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return records.filter((r) => {
      if (dateFrom && r.inbound_date < dateFrom) return false;
      if (dateTo && r.inbound_date > dateTo) return false;
      if (q) {
        const name = r.sku?.product?.name ?? '';
        const code = r.sku?.sku_code ?? '';
        const wh   = r.warehouse?.name ?? '';
        if (!`${name} ${code} ${wh}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [records, dateFrom, dateTo, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-[#3182F6]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 검색 + 날짜 필터 */}
      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 space-y-3">
        {/* 텍스트 검색 */}
        <div className="relative">
          <input
            type="text"
            placeholder="상품명, SKU코드, 창고명으로 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-4 pr-10 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-3 text-[#B0B8C1] hover:text-[#6B7684]">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 기간 필터 */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[13px] text-[#6B7684]">
            <CalendarDays className="h-4 w-4" />
            <span className="font-medium">기간</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 px-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] focus:outline-none focus:border-[#3182F6] transition-colors"
            />
            <span className="text-[13px] text-[#B0B8C1]">~</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 px-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] focus:outline-none focus:border-[#3182F6] transition-colors"
            />
          </div>
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="h-9 px-3 rounded-xl border border-[#E5E8EB] text-[12.5px] text-[#6B7684] hover:bg-[#F2F4F6] transition-colors flex items-center gap-1"
            >
              <X className="h-3.5 w-3.5" /> 초기화
            </button>
          )}
          <span className="text-[12.5px] text-[#6B7684] ml-auto">{formatNumber(filtered.length)}건</span>
        </div>
      </div>

      {/* Records list */}
      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="overflow-x-auto">
        <div className="min-w-[560px]">
        {/* Header */}
        <div className="grid grid-cols-[1fr_1.5fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b border-[#F2F4F6] bg-[#F8F9FB]">
          <span className="text-[12px] font-semibold text-[#6B7684]">입고일</span>
          <span className="text-[12px] font-semibold text-[#6B7684]">상품 / SKU</span>
          <span className="text-[12px] font-semibold text-[#6B7684]">창고</span>
          <span className="text-[12px] font-semibold text-[#6B7684] text-right">수량</span>
          <span className="text-[12px] font-semibold text-[#6B7684] text-right">단가</span>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-[#F2F4F6] flex items-center justify-center mb-3">
              <PackageCheck className="h-6 w-6 text-[#B0B8C1]" />
            </div>
            <p className="text-[14px] font-medium text-[#6B7684]">입고 기록이 없습니다</p>
          </div>
        ) : (
          <div className="divide-y divide-[#F2F4F6]">
            {filtered.map((record) => (
              <div key={record.id} className="grid grid-cols-[1fr_1.5fr_1fr_1fr_1fr] gap-3 px-5 py-3.5 items-center hover:bg-[#FAFAFA] transition-colors">
                <div>
                  <span className="text-[13px] text-[#191F28]">{formatDate(record.inbound_date)}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[#191F28] truncate">{record.sku?.product?.name}</p>
                  <p className="text-[11.5px] text-[#6B7684] mt-0.5">
                    {record.sku?.sku_code} · {skuOptionLabel(record.sku?.option_values ?? {})}
                  </p>
                </div>
                <div>
                  <span className="text-[13px] text-[#6B7684]">{record.warehouse?.name}</span>
                </div>
                <div className="text-right">
                  <span className="text-[14px] font-bold text-[#191F28] tabular-nums">{formatNumber(record.quantity)}</span>
                  <span className="text-[11px] text-[#B0B8C1] ml-0.5">개</span>
                </div>
                <div className="text-right">
                  <span className="text-[13px] text-[#6B7684] tabular-nums">
                    {record.unit_cost != null ? formatCurrency(record.unit_cost * vatMult) : '-'}
                  </span>
                  {vatOn && record.unit_cost != null && (
                    <p className="text-[10.5px] text-[#B0B8C1]">VAT포함</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS: Array<{ id: string; label: string; icon: any }> = [
  { id: 'po', label: '발주 관리', icon: Truck },
  { id: 'inbound', label: '입고 기록', icon: PackageCheck },
  { id: 'outbound', label: '출고 관리', icon: PackageMinus },
  { id: 'calendar', label: '캘린더', icon: CalendarDays },
];

export default function InboundPage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab');
    return (t === 'inbound' || t === 'outbound' || t === 'calendar') ? t : 'po';
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-[20px] font-bold tracking-[-0.03em] text-[#191F28]">입출고 관리</h2>
        <p className="mt-1 text-[13.5px] text-[#6B7684]">발주, 입고, 출고를 한 곳에서 관리하세요</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#F2F4F6] p-1 rounded-xl w-fit">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 h-9 px-4 rounded-[10px] text-[13px] font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-[#191F28] shadow-sm'
                  : 'text-[#6B7684] hover:text-[#191F28]'
              }`}
            >
              <Icon className="h-4 w-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'po' ? <POManagementTab />
        : activeTab === 'inbound' ? <InboundRecordsTab />
        : activeTab === 'outbound' ? <OutboundTab />
        : <CalendarTab />}
    </div>
  );
}
