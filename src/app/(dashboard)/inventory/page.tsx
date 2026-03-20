'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { formatNumber, formatCurrency, skuOptionLabel } from '@/lib/utils';
import type { InventoryItem, Warehouse } from '@/types';
import type { InventorySummaryRow } from '@/app/api/inventory/summary/route';
import {
  Warehouse as WarehouseIcon, Package, TrendingUp, SlidersHorizontal,
  Download, Loader2, X, Plus, LayoutGrid, List, Edit3, Check, RefreshCw,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

interface InventoryRow extends Omit<InventoryItem, 'sku' | 'warehouse'> {
  sku: {
    id: string; sku_code: string; option_values: Record<string, string>;
    cost_price: number; reorder_point: number; safety_stock: number;
    product: { id: string; name: string; category: string | null; brand: string | null };
  };
  warehouse: { id: string; name: string; type: string };
}

// ─── Dialog ────────────────────────────────────────────────────────────────

function Dialog({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full max-w-md mx-4">
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

// ─── Entry Dialog ────────────────────────────────────────────────────────────

interface SkuOption { id: string; label: string; }

function EntryDialog({ open, onClose, onSave }: {
  open: boolean; onClose: () => void; onSave: () => void;
}) {
  const [skuOptions, setSkuOptions] = useState<SkuOption[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ sku_id: '', warehouse_id: '', quantity: '', reason: '' });
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm({ sku_id: '', warehouse_id: '', quantity: '', reason: '' });
    setError('');
    setFetching(true);
    Promise.all([
      fetch('/api/products').then((r) => r.json()),
      fetch('/api/settings/warehouses').then((r) => r.json()),
    ]).then(([products, whs]) => {
      const flat: SkuOption[] = (products ?? []).flatMap((p: any) =>
        (p.skus ?? []).map((s: any) => {
          const opts = skuOptionLabel(s.option_values ?? {});
          return { id: s.id, label: `${p.name}${opts ? ' · ' + opts : ''} (${s.sku_code})` };
        })
      );
      setSkuOptions(flat);
      setWarehouses(whs ?? []);
    }).finally(() => setFetching(false));
  }, [open]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.sku_id) { setError('상품(SKU)을 선택해주세요.'); return; }
    if (!form.warehouse_id) { setError('창고를 선택해주세요.'); return; }
    const qty = Number(form.quantity);
    if (isNaN(qty) || qty < 0) { setError('올바른 수량을 입력해주세요.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku_id: form.sku_id, warehouse_id: form.warehouse_id, new_quantity: qty, reason: form.reason.trim() || '초기 재고 기입' }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      onSave();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally { setLoading(false); }
  }

  const selectCls = 'w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] bg-white focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors';

  return (
    <Dialog open={open} onClose={onClose} title="재고 기입">
      {fetching ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" /></div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">상품 (SKU) <span className="text-red-500">*</span></label>
            <select value={form.sku_id} onChange={(e) => set('sku_id', e.target.value)} className={selectCls}>
              <option value="">상품을 선택하세요</option>
              {skuOptions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">창고 <span className="text-red-500">*</span></label>
            <select value={form.warehouse_id} onChange={(e) => set('warehouse_id', e.target.value)} className={selectCls}>
              <option value="">창고를 선택하세요</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">수량 <span className="text-red-500">*</span></label>
            <input type="number" min="0" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} placeholder="0"
              className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">사유 <span className="text-[#B0B8C1] font-normal">(선택)</span></label>
            <input type="text" value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="초기 재고 기입"
              className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors" />
          </div>
          {error && <p className="text-[13px] text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[14px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">취소</button>
            <button type="submit" disabled={loading} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[14px] font-semibold hover:bg-[#1B64DA] disabled:opacity-60 flex items-center justify-center gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} 기입
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

// ─── Adjust Dialog ──────────────────────────────────────────────────────────

function AdjustDialog({ open, onClose, item, onSave }: {
  open: boolean; onClose: () => void; item: InventoryRow | null; onSave: (updated: InventoryRow) => void;
}) {
  const [newQty, setNewQty] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (item) { setNewQty(String(item.quantity)); setReason(''); setError(''); }
  }, [item]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    const qty = Number(newQty);
    if (isNaN(qty) || qty < 0) { setError('올바른 수량을 입력해주세요.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku_id: item.sku_id, warehouse_id: item.warehouse_id, new_quantity: qty, reason: reason.trim() || '수동 조정' }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      onSave({ ...item, quantity: qty });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally { setLoading(false); }
  }

  if (!item) return null;
  const diff = Number(newQty) - item.quantity;

  return (
    <Dialog open={open} onClose={onClose} title="재고 조정">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-[#F2F4F6] rounded-xl p-4 space-y-1">
          <p className="text-[13px] font-semibold text-[#191F28]">{item.sku?.product?.name}</p>
          <p className="text-[12px] text-[#6B7684]">{item.sku?.sku_code} · {skuOptionLabel(item.sku?.option_values ?? {})}</p>
          <p className="text-[12px] text-[#6B7684]">{item.warehouse?.name}</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-[#191F28]">
            현재 재고: <span className="text-[#3182F6] font-bold">{formatNumber(item.quantity)}</span>개
          </label>
          <input type="number" min="0" value={newQty} onChange={(e) => setNewQty(e.target.value)} placeholder="새 재고 수량"
            className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors" />
          {newQty !== '' && !isNaN(Number(newQty)) && Number(newQty) !== item.quantity && (
            <p className={`text-[12.5px] font-medium ${diff > 0 ? 'text-green-600' : 'text-red-500'}`}>
              {diff > 0 ? '+' : ''}{formatNumber(diff)}개 조정
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-[#191F28]">조정 사유</label>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 실물 재고 확인 후 조정"
            className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors" />
        </div>
        {error && <p className="text-[13px] text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[14px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">취소</button>
          <button type="submit" disabled={loading} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[14px] font-semibold hover:bg-[#1B64DA] disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} 조정 저장
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Summary Tab (종합 현황) ─────────────────────────────────────────────────

function SummaryTab() {
  const [rows, setRows] = useState<InventorySummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVals, setEditVals] = useState({ sales_30d: '', sales_7d: '', safety_stock: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/inventory/summary').then((r) => r.json()).then((d) => {
      setRows(d ?? []);
      setLoading(false);
    });
  }, []);

  function startEdit(row: InventorySummaryRow) {
    setEditingId(row.sku_id);
    setEditVals({ sales_30d: String(row.sales_30d), sales_7d: String(row.sales_7d), safety_stock: String(row.safety_stock) });
  }

  async function saveEdit(skuId: string) {
    setSaving(true);
    await fetch(`/api/skus/${skuId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sales_30d: Number(editVals.sales_30d) || 0,
        sales_7d: Number(editVals.sales_7d) || 0,
        safety_stock: Number(editVals.safety_stock) || 0,
      }),
    });
    setRows((prev) => prev.map((r) => r.sku_id === skuId ? {
      ...r,
      sales_30d: Number(editVals.sales_30d) || 0,
      sales_7d: Number(editVals.sales_7d) || 0,
      safety_stock: Number(editVals.safety_stock) || 0,
    } : r));
    setEditingId(null);
    setSaving(false);
  }

  if (loading) return <div className="flex items-center justify-center h-48"><Loader2 className="h-6 w-6 animate-spin text-[#3182F6]" /></div>;

  if (!rows.length) return (
    <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col items-center justify-center py-16">
      <Package className="h-10 w-10 text-[#B0B8C1] mb-3" />
      <p className="text-[14px] font-medium text-[#6B7684]">등록된 SKU가 없습니다</p>
    </div>
  );

  return (
    <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-x-auto">
      <table className="w-full min-w-[900px]">
        <thead>
          <tr className="border-b border-[#F2F4F6] bg-[#F8F9FB]">
            {['상품 / SKU', '자사창고', '쿠팡그로스', '수입중', '총 재고', '안전재고', '30일판매', '7일판매', '일평균', '설정'].map((h) => (
              <th key={h} className="text-left text-[11.5px] font-semibold text-[#6B7684] px-4 py-3 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F2F4F6]">
          {rows.map((row) => {
            const dailyAvg = row.sales_30d > 0 ? Math.round(row.sales_30d / 30 * 10) / 10 : null;
            const daysLeft = dailyAvg && row.total_stock > 0 ? Math.floor(row.total_stock / dailyAvg) : null;
            const isLow = row.total_stock <= row.safety_stock && row.safety_stock > 0;
            const isEditing = editingId === row.sku_id;

            return (
              <tr key={row.sku_id} className={`hover:bg-[#FAFAFA] transition-colors ${isLow ? 'bg-red-50/30' : ''}`}>
                <td className="px-4 py-3">
                  <p className="text-[13.5px] font-medium text-[#191F28]">{row.product_name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[11.5px] text-[#6B7684] font-mono">{row.sku_code}</span>
                    {Object.keys(row.option_values ?? {}).length > 0 && (
                      <span className="text-[11px] bg-[#F2F4F6] text-[#6B7684] px-1.5 py-0.5 rounded-md">{skuOptionLabel(row.option_values)}</span>
                    )}
                    {isLow && <span className="text-[11px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-md font-medium">재고부족</span>}
                  </div>
                </td>
                {/* 자사창고 */}
                <td className="px-4 py-3">
                  <span className="text-[14px] font-semibold text-[#191F28] tabular-nums">{formatNumber(row.warehouse_stock)}</span>
                  <span className="text-[11px] text-[#B0B8C1] ml-0.5">개</span>
                </td>
                {/* 쿠팡그로스 */}
                <td className="px-4 py-3">
                  <span className="text-[14px] font-semibold text-[#3182F6] tabular-nums">{formatNumber(row.coupang_stock)}</span>
                  <span className="text-[11px] text-[#B0B8C1] ml-0.5">개</span>
                </td>
                {/* 수입중 */}
                <td className="px-4 py-3">
                  {row.transit_stock > 0
                    ? <><span className="text-[14px] font-semibold text-orange-500 tabular-nums">{formatNumber(row.transit_stock)}</span><span className="text-[11px] text-[#B0B8C1] ml-0.5">개</span></>
                    : <span className="text-[13px] text-[#B0B8C1]">-</span>}
                </td>
                {/* 총 재고 */}
                <td className="px-4 py-3">
                  <span className={`text-[15px] font-bold tabular-nums ${isLow ? 'text-red-500' : 'text-[#191F28]'}`}>{formatNumber(row.total_stock)}</span>
                  <span className="text-[11px] text-[#B0B8C1] ml-0.5">개</span>
                  {daysLeft !== null && (
                    <p className="text-[11px] text-[#B0B8C1] mt-0.5">{daysLeft}일치</p>
                  )}
                </td>
                {/* 안전재고 */}
                <td className="px-4 py-3">
                  {isEditing
                    ? <input type="number" min="0" value={editVals.safety_stock} onChange={(e) => setEditVals((v) => ({ ...v, safety_stock: e.target.value }))}
                        className="w-16 h-8 px-2 rounded-lg border border-[#3182F6] text-[13px] text-[#191F28] focus:outline-none" />
                    : <span className="text-[13px] text-[#6B7684] tabular-nums">{formatNumber(row.safety_stock)}</span>}
                </td>
                {/* 30일 판매 */}
                <td className="px-4 py-3">
                  {isEditing
                    ? <input type="number" min="0" value={editVals.sales_30d} onChange={(e) => setEditVals((v) => ({ ...v, sales_30d: e.target.value }))}
                        className="w-20 h-8 px-2 rounded-lg border border-[#3182F6] text-[13px] text-[#191F28] focus:outline-none" />
                    : <span className="text-[13px] text-[#6B7684] tabular-nums">{row.sales_30d > 0 ? formatNumber(row.sales_30d) : '-'}</span>}
                </td>
                {/* 7일 판매 */}
                <td className="px-4 py-3">
                  {isEditing
                    ? <input type="number" min="0" value={editVals.sales_7d} onChange={(e) => setEditVals((v) => ({ ...v, sales_7d: e.target.value }))}
                        className="w-20 h-8 px-2 rounded-lg border border-[#3182F6] text-[13px] text-[#191F28] focus:outline-none" />
                    : <span className="text-[13px] text-[#6B7684] tabular-nums">{row.sales_7d > 0 ? formatNumber(row.sales_7d) : '-'}</span>}
                </td>
                {/* 일평균 */}
                <td className="px-4 py-3">
                  <span className="text-[13px] text-[#6B7684]">{dailyAvg !== null ? `${dailyAvg}개` : '-'}</span>
                </td>
                {/* 설정 버튼 */}
                <td className="px-4 py-3">
                  {isEditing ? (
                    <button onClick={() => saveEdit(row.sku_id)} disabled={saving}
                      className="h-8 w-8 flex items-center justify-center rounded-xl bg-[#3182F6] text-white hover:bg-[#1B64DA] disabled:opacity-60 transition-colors">
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </button>
                  ) : (
                    <button onClick={() => startEdit(row)}
                      className="h-8 w-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6] text-[#B0B8C1] hover:text-[#6B7684] transition-colors">
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── RG 그로스 재고 탭 ───────────────────────────────────────────────────────

interface RgInventoryItem {
  vendor_item_id: string;
  external_sku_id: string | null;
  sales_last_30d: number;
  sku_id: string | null;
  sku?: { sku_code: string; product: { name: string } } | null;
  current_qty: number;
  days_remaining: number | null;
  daily: { date: string; qty: number; change: number | null }[];
}

function RgInventoryTab() {
  const [items, setItems] = useState<RgInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [days, setDays] = useState(30);
  const [error, setError] = useState('');
  const [syncMsg, setSyncMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetch(`/api/coupang/rg-inventory?days=${days}`).then((r) => r.json());
    setItems(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [days]);

  useEffect(() => { load(); }, [load]);

  async function handleSync() {
    setSyncing(true); setError(''); setSyncMsg('');
    try {
      const res = await fetch('/api/coupang/sync-rg-inventory', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? '동기화 실패');
      setSyncMsg(`${d.synced}개 상품 동기화 완료`);
      load();
    } catch (err: any) {
      setError(err.message);
    }
    setSyncing(false);
  }

  const showDays = Math.min(days, 7);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          {[7, 14, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`h-8 px-3 rounded-xl text-[12.5px] font-medium transition-colors ${days === d ? 'bg-[#3182F6] text-white' : 'bg-white border border-[#E5E8EB] text-[#6B7684] hover:bg-[#F2F4F6]'}`}>
              {d}일
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {syncMsg && <span className="text-[12.5px] text-green-600 font-medium">{syncMsg}</span>}
          {error  && <span className="text-[12.5px] text-red-500">{error}</span>}
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-2 h-9 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors disabled:opacity-60">
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            재고 동기화
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Package className="h-10 w-10 text-[#B0B8C1] mb-3" />
            <p className="text-[14px] font-medium text-[#6B7684]">로켓그로스 재고 데이터가 없습니다</p>
            <p className="text-[12.5px] text-[#B0B8C1] mt-1">재고 동기화 버튼을 눌러 데이터를 가져오세요</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="border-b border-[#F2F4F6] bg-[#F8F9FB]">
                  {['상품명 / SKU', '현재 재고', `일자별 출고 (최근 ${showDays}일)`, '30일 판매', '일평균', '예상 소진'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[12px] font-semibold text-[#6B7684] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F4F6]">
                {items.map((item) => {
                  const dailyAvg = item.sales_last_30d > 0 ? Math.round((item.sales_last_30d / 30) * 10) / 10 : null;
                  const isLow  = item.days_remaining !== null && item.days_remaining <= 7;
                  const isWarn = !isLow && item.days_remaining !== null && item.days_remaining <= 14;
                  const recentChanges = item.daily.filter((d) => d.change !== null).slice(-showDays);
                  const productName = item.sku?.product?.name ?? item.external_sku_id ?? item.vendor_item_id;

                  return (
                    <tr key={item.vendor_item_id}
                      className={`hover:bg-[#FAFAFA] transition-colors ${isLow ? 'bg-red-50/30' : isWarn ? 'bg-amber-50/30' : ''}`}>
                      {/* 상품명 */}
                      <td className="px-4 py-3">
                        <p className="text-[13.5px] font-medium text-[#191F28]">{productName}</p>
                        <p className="text-[11.5px] text-[#B0B8C1] font-mono mt-0.5">
                          {item.external_sku_id ?? item.vendor_item_id}
                        </p>
                      </td>
                      {/* 현재 재고 */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-[15px] font-bold tabular-nums ${isLow ? 'text-red-500' : 'text-[#191F28]'}`}>
                          {formatNumber(item.current_qty)}
                        </span>
                        <span className="text-[11px] text-[#B0B8C1] ml-0.5">개</span>
                        {isLow  && <span className="ml-1.5 text-[10.5px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-md font-medium">부족</span>}
                        {isWarn && <span className="ml-1.5 text-[10.5px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-md font-medium">주의</span>}
                      </td>
                      {/* 일자별 출고 */}
                      <td className="px-4 py-3">
                        {recentChanges.length === 0 ? (
                          <span className="text-[12px] text-[#B0B8C1]">스냅샷 2일 이상 필요</span>
                        ) : (
                          <div className="flex items-end gap-2">
                            {recentChanges.map((d, i) => {
                              const change  = d.change ?? 0;
                              const outflow = change < 0 ? Math.abs(change) : 0;
                              const inflow  = change > 0 ? change : 0;
                              return (
                                <div key={i} className="flex flex-col items-center gap-0.5 min-w-[28px]">
                                  <span className="text-[9.5px] text-[#B0B8C1]">{d.date.slice(5)}</span>
                                  {outflow > 0 ? (
                                    <span className="text-[11px] font-semibold text-red-500 tabular-nums">
                                      -{formatNumber(outflow)}
                                    </span>
                                  ) : inflow > 0 ? (
                                    <span className="text-[11px] font-semibold text-blue-500 tabular-nums">
                                      +{formatNumber(inflow)}
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-[#D1D5DB]">0</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      {/* 30일 판매 */}
                      <td className="px-4 py-3">
                        <span className="text-[13px] text-[#6B7684] tabular-nums">
                          {item.sales_last_30d > 0 ? formatNumber(item.sales_last_30d) + '개' : '-'}
                        </span>
                      </td>
                      {/* 일평균 */}
                      <td className="px-4 py-3">
                        <span className="text-[13px] text-[#6B7684]">{dailyAvg !== null ? `${dailyAvg}개` : '-'}</span>
                      </td>
                      {/* 예상 소진 */}
                      <td className="px-4 py-3">
                        {item.days_remaining !== null ? (
                          <span className={`text-[13px] font-semibold tabular-nums ${isLow ? 'text-red-500' : isWarn ? 'text-amber-500' : 'text-[#191F28]'}`}>
                            {item.days_remaining}일
                          </span>
                        ) : (
                          <span className="text-[13px] text-[#B0B8C1]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const [tab, setTab] = useState<'summary' | 'warehouse' | 'rg'>('summary');
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('all');
  const [adjustItem, setAdjustItem] = useState<InventoryRow | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch('/api/inventory').then((r) => r.json());
      setInventory(data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadInventory(); }, [loadInventory]);

  const warehouses = useMemo<Warehouse[]>(() => {
    const seen = new Set<string>();
    const list: Warehouse[] = [];
    inventory.forEach((item) => {
      if (item.warehouse && !seen.has(item.warehouse.id)) {
        seen.add(item.warehouse.id);
        list.push(item.warehouse as unknown as Warehouse);
      }
    });
    return list;
  }, [inventory]);

  const filtered = useMemo(() =>
    selectedWarehouse === 'all' ? inventory : inventory.filter((i) => i.warehouse_id === selectedWarehouse),
    [inventory, selectedWarehouse]
  );

  const stats = useMemo(() => {
    const totalSkus = new Set(inventory.map((i) => i.sku_id)).size;
    const totalQty = inventory.reduce((s, i) => s + i.quantity, 0);
    const totalValue = inventory.reduce((s, i) => s + i.quantity * (i.sku?.cost_price ?? 0), 0);
    return { totalSkus, totalQty, totalValue };
  }, [inventory]);

  function handleAdjusted(updated: InventoryRow) {
    setInventory((prev) => prev.map((i) =>
      i.sku_id === updated.sku_id && i.warehouse_id === updated.warehouse_id ? { ...i, quantity: updated.quantity } : i
    ));
    setAdjustItem(null);
  }

  function exportCsv() {
    const rows = [
      ['상품명', '브랜드', '카테고리', 'SKU코드', '옵션', '창고', '수량', '원가', '재고가치'],
      ...filtered.map((i) => [
        i.sku?.product?.name ?? '', i.sku?.product?.brand ?? '', i.sku?.product?.category ?? '',
        i.sku?.sku_code ?? '', skuOptionLabel(i.sku?.option_values ?? {}),
        i.warehouse?.name ?? '', String(i.quantity), String(i.sku?.cost_price ?? 0),
        String(i.quantity * (i.sku?.cost_price ?? 0)),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `inventory_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function quantityColor(item: InventoryRow): string {
    const rp = item.sku?.reorder_point ?? 0;
    const ss = item.sku?.safety_stock ?? 0;
    if (item.quantity <= rp) return 'text-red-500 font-bold';
    if (item.quantity <= ss * 2) return 'text-amber-500 font-semibold';
    return 'text-[#191F28] font-semibold';
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[20px] font-bold tracking-[-0.03em] text-[#191F28]">재고 현황</h2>
          <p className="mt-1 text-[13.5px] text-[#6B7684]">창고별 재고 및 채널별 재고를 확인하세요</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEntryOpen(true)} className="flex items-center gap-2 h-10 px-4 rounded-xl bg-[#3182F6] text-white text-[13.5px] font-semibold hover:bg-[#1B64DA] transition-colors">
            <Plus className="h-4 w-4" /> 재고 기입
          </button>
          {tab === 'warehouse' && (
            <button onClick={exportCsv} className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13.5px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
              <Download className="h-4 w-4" /> CSV
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#F2F4F6] rounded-xl p-1 w-fit">
        {([['summary', '종합 현황', LayoutGrid], ['warehouse', '창고별 상세', List], ['rg', '쿠팡그로스', Package]] as const).map(([value, label, Icon]) => (
          <button key={value} onClick={() => setTab(value)}
            className={`flex items-center gap-2 h-9 px-4 rounded-[10px] text-[13px] font-medium transition-all ${tab === value ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684] hover:text-[#191F28]'}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* Summary Cards (창고별 탭에서만) */}
      {tab === 'warehouse' && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="w-9 h-9 rounded-xl bg-[#EBF1FE] flex items-center justify-center mb-3">
              <Package className="h-[18px] w-[18px] text-[#3182F6]" strokeWidth={2.5} />
            </div>
            <p className="text-[11.5px] text-[#6B7684] font-medium mb-1">관리 SKU</p>
            <div className="flex items-baseline gap-1">
              <span className="text-[22px] font-bold text-[#3182F6] tracking-[-0.04em]">{formatNumber(stats.totalSkus)}</span>
              <span className="text-[13px] text-[#B0B8C1]">개</span>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center mb-3">
              <WarehouseIcon className="h-[18px] w-[18px] text-green-600" strokeWidth={2.5} />
            </div>
            <p className="text-[11.5px] text-[#6B7684] font-medium mb-1">총 재고 수량</p>
            <div className="flex items-baseline gap-1">
              <span className="text-[22px] font-bold text-green-600 tracking-[-0.04em]">{formatNumber(stats.totalQty)}</span>
              <span className="text-[13px] text-[#B0B8C1]">개</span>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center mb-3">
              <TrendingUp className="h-[18px] w-[18px] text-[#FF6B00]" strokeWidth={2.5} />
            </div>
            <p className="text-[11.5px] text-[#6B7684] font-medium mb-1">재고 원가 총액</p>
            <div className="flex items-baseline gap-1">
              <span className="text-[18px] font-bold text-[#FF6B00] tracking-[-0.04em]">{formatCurrency(stats.totalValue)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content */}
      {tab === 'rg' ? (
        <RgInventoryTab />
      ) : tab === 'summary' ? (
        <SummaryTab />
      ) : (
        <>
          {/* Warehouse filter */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-[#6B7684]" />
              <span className="text-[13px] font-medium text-[#6B7684]">창고</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setSelectedWarehouse('all')}
                className={`h-8 px-3.5 rounded-xl text-[13px] font-medium transition-colors ${selectedWarehouse === 'all' ? 'bg-[#3182F6] text-white' : 'bg-white border border-[#E5E8EB] text-[#6B7684] hover:bg-[#F2F4F6]'}`}>
                전체
              </button>
              {warehouses.map((w) => (
                <button key={w.id} onClick={() => setSelectedWarehouse(w.id)}
                  className={`h-8 px-3.5 rounded-xl text-[13px] font-medium transition-colors ${selectedWarehouse === w.id ? 'bg-[#3182F6] text-white' : 'bg-white border border-[#E5E8EB] text-[#6B7684] hover:bg-[#F2F4F6]'}`}>
                  {w.name}
                </button>
              ))}
            </div>
          </div>

          {/* Warehouse inventory table */}
          <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
            <div className="overflow-x-auto">
            <div className="min-w-[580px]">
            <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_auto] gap-3 px-5 py-3 border-b border-[#F2F4F6] bg-[#F8F9FB]">
              {['상품 / SKU', '창고', '수량', '원가', '재고가치', '조정'].map((h) => (
                <span key={h} className="text-[12px] font-semibold text-[#6B7684]">{h}</span>
              ))}
            </div>
            {loading ? (
              <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-[#3182F6]" /></div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="w-14 h-14 rounded-2xl bg-[#F2F4F6] flex items-center justify-center mb-3">
                  <WarehouseIcon className="h-6 w-6 text-[#B0B8C1]" />
                </div>
                <p className="text-[14px] font-medium text-[#6B7684]">재고 데이터가 없습니다</p>
                <button onClick={() => setEntryOpen(true)} className="mt-4 flex items-center gap-2 h-10 px-4 rounded-xl bg-[#3182F6] text-white text-[13.5px] font-semibold hover:bg-[#1B64DA] transition-colors">
                  <Plus className="h-4 w-4" /> 재고 기입
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[#F2F4F6]">
                {filtered.map((item) => {
                  const value = item.quantity * (item.sku?.cost_price ?? 0);
                  const isLow = item.quantity <= (item.sku?.reorder_point ?? 0);
                  const isWarn = !isLow && item.quantity <= (item.sku?.safety_stock ?? 0) * 2;
                  return (
                    <div key={item.id} className={`grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_auto] gap-3 px-5 py-3.5 items-center hover:bg-[#FAFAFA] transition-colors ${isLow ? 'bg-red-50/40' : isWarn ? 'bg-amber-50/40' : ''}`}>
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-medium text-[#191F28] truncate">{item.sku?.product?.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-[11.5px] text-[#6B7684] font-mono">{item.sku?.sku_code}</span>
                          {Object.keys(item.sku?.option_values ?? {}).length > 0 && (
                            <span className="text-[11px] bg-[#F2F4F6] text-[#6B7684] px-1.5 py-0.5 rounded-md">{skuOptionLabel(item.sku?.option_values ?? {})}</span>
                          )}
                          {isLow && <span className="text-[11px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-md font-medium">발주점 이하</span>}
                          {isWarn && <span className="text-[11px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-md font-medium">주의</span>}
                        </div>
                      </div>
                      <p className="text-[13px] text-[#191F28]">{item.warehouse?.name}</p>
                      <div className="text-right">
                        <span className={`text-[15px] tabular-nums ${quantityColor(item)}`}>{formatNumber(item.quantity)}</span>
                        <span className="text-[11px] text-[#B0B8C1] ml-0.5">개</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[13px] text-[#6B7684] tabular-nums">{formatCurrency(item.sku?.cost_price ?? 0)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[13px] font-medium text-[#191F28] tabular-nums">{formatCurrency(value)}</span>
                      </div>
                      <div className="flex justify-center">
                        <button onClick={() => setAdjustItem(item)} className="h-8 px-3 rounded-xl border border-[#E5E8EB] text-[12px] font-medium text-[#6B7684] hover:border-[#3182F6] hover:text-[#3182F6] hover:bg-[#EBF1FE] transition-colors whitespace-nowrap">조정</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {filtered.length > 0 && (
              <div className="flex items-center justify-between px-5 py-3 bg-[#F8F9FB] border-t border-[#F2F4F6]">
                <span className="text-[12.5px] text-[#6B7684]">총 {formatNumber(filtered.length)}건</span>
                <span className="text-[13px] font-semibold text-[#191F28]">합계 {formatCurrency(filtered.reduce((s, i) => s + i.quantity * (i.sku?.cost_price ?? 0), 0))}</span>
              </div>
            )}
            </div>
            </div>
          </div>
        </>
      )}

      <AdjustDialog open={!!adjustItem} onClose={() => setAdjustItem(null)} item={adjustItem} onSave={handleAdjusted} />
      <EntryDialog open={entryOpen} onClose={() => setEntryOpen(false)} onSave={() => { setEntryOpen(false); loadInventory(); }} />
    </div>
  );
}
