'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatNumber, formatCurrency, skuOptionLabel } from '@/lib/utils';
import { useVat } from '@/components/layout/vat-provider';
import type { InventoryItem, Warehouse } from '@/types';
import type { InventorySummaryRow } from '@/app/api/inventory/summary/route';
import {
  Warehouse as WarehouseIcon, Package, TrendingUp, BarChart3, SlidersHorizontal,
  Download, Upload, Loader2, X, Plus, LayoutGrid, List, RefreshCw,
  ChevronUp, ChevronDown, ChevronsUpDown, GripVertical,
} from 'lucide-react';
import { SearchSelect } from '@/components/ui/search-select';
import dynamic from 'next/dynamic';

const TrendsTab = dynamic(() => import('@/components/inventory/TrendsTab'), { loading: () => <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" /></div> });
const ForecastTab = dynamic(() => import('@/components/inventory/ForecastTab'), { loading: () => <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" /></div> });

// ─── Types ─────────────────────────────────────────────────────────────────

interface InventoryRow extends Omit<InventoryItem, 'sku' | 'warehouse'> {
  sku: {
    id: string; sku_code: string; option_values: Record<string, string>;
    cost_price: number; reorder_point: number; safety_stock: number;
    product: { id: string; name: string; category: string | null; brand: string | null };
  };
  warehouse: { id: string; name: string; type: string };
}

type RowHeight = 'compact' | 'normal' | 'comfortable';
const ROW_PY: Record<RowHeight, string> = { compact: 'py-1.5', normal: 'py-3', comfortable: 'py-5' };

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-30 shrink-0" />;
  return dir === 'asc'
    ? <ChevronUp className="h-3 w-3 text-[#3182F6] shrink-0" />
    : <ChevronDown className="h-3 w-3 text-[#3182F6] shrink-0" />;
}

function RowHeightButtons({ value, onChange }: { value: RowHeight; onChange: (v: RowHeight) => void }) {
  return (
    <div className="flex items-center gap-1 border border-[#E5E8EB] rounded-xl overflow-hidden">
      {(['compact', 'normal', 'comfortable'] as RowHeight[]).map((h) => (
        <button key={h} onClick={() => onChange(h)}
          className={`h-7 px-2.5 text-[11px] font-medium transition-colors ${value === h ? 'bg-[#3182F6] text-white' : 'text-[#6B7684] hover:bg-[#F2F4F6]'}`}>
          {h === 'compact' ? '좁게' : h === 'normal' ? '보통' : '넓게'}
        </button>
      ))}
    </div>
  );
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
          <h2 className="text-[15px] font-bold text-[#191F28] tracking-[-0.02em]">{title}</h2>
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

  const selectCls = 'w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] bg-white focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors';

  return (
    <Dialog open={open} onClose={onClose} title="재고 기입">
      {fetching ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" /></div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">상품 (SKU) <span className="text-red-500">*</span></label>
            <SearchSelect
              options={skuOptions}
              value={form.sku_id}
              onChange={(id) => set('sku_id', id)}
              placeholder="상품명 또는 SKU코드 검색..."
            />
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
              className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">사유 <span className="text-[#B0B8C1] font-normal">(선택)</span></label>
            <input type="text" value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="초기 재고 기입"
              className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors" />
          </div>
          {error && <p className="text-[13px] text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">취소</button>
            <button type="submit" disabled={loading} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] disabled:opacity-60 flex items-center justify-center gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} 기입
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

// ─── CSV Import Dialog ───────────────────────────────────────────────────────

interface ParsedRow { sku_code: string; warehouse_name: string; quantity: string; reason: string; valid: boolean; error?: string; }

function CsvImportDialog({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: () => void }) {
  const [csvText, setCsvText] = useState('');
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: number; errors: { row: number; message: string }[] } | null>(null);
  const [parseError, setParseError] = useState('');

  function parseCsv(text: string) {
    setResult(null); setParseError('');
    const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) { setParsed([]); return; }

    // Skip header if first cell looks like a label (not a SKU code)
    const firstCell = lines[0].split(',')[0].trim().replace(/"/g, '');
    const hasHeader = /[가-힣a-zA-Z]/.test(firstCell) && !/^\d/.test(firstCell) && !firstCell.includes('SKU') === false || firstCell.toLowerCase().includes('sku') || firstCell === 'SKU코드' || firstCell === '상품코드';
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const rows: ParsedRow[] = dataLines.map((line) => {
      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      const sku_code = cols[0] ?? '';
      const warehouse_name = cols[1] ?? '';
      const quantity = cols[2] ?? '';
      const reason = cols[3] ?? '';
      let error: string | undefined;
      if (!sku_code) error = 'SKU코드 필요';
      else if (!warehouse_name) error = '창고명 필요';
      else if (isNaN(Number(quantity)) || Number(quantity) < 0) error = '수량 오류';
      return { sku_code, warehouse_name, quantity, reason, valid: !error, error };
    });
    setParsed(rows);
  }

  async function handleSubmit() {
    const validRows = parsed.filter((r) => r.valid);
    if (validRows.length === 0) { setParseError('유효한 행이 없습니다.'); return; }
    setLoading(true); setResult(null);
    try {
      const res = await fetch('/api/inventory/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: validRows.map((r) => ({ sku_code: r.sku_code, warehouse_name: r.warehouse_name, quantity: Number(r.quantity), reason: r.reason || undefined })) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setResult(d);
      if (d.success > 0) onSave();
    } catch (err: any) {
      setParseError(err.message);
    } finally { setLoading(false); }
  }

  function handleClose() {
    setCsvText(''); setParsed([]); setResult(null); setParseError(''); onClose();
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      parseCsv(text);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  const validCount = parsed.filter((r) => r.valid).length;
  const invalidCount = parsed.filter((r) => !r.valid).length;

  return (
    <Dialog open={open} onClose={handleClose} title="재고 CSV 일괄 기입">
      <div className="space-y-4">
        {/* Format hint */}
        <div className="bg-[#F8F9FB] rounded-xl p-3 space-y-1">
          <p className="text-[12px] font-semibold text-[#6B7684]">CSV 형식</p>
          <p className="text-[11px] text-[#B0B8C1] font-mono">SKU코드, 창고명, 수량, 사유(선택)</p>
          <p className="text-[11px] text-[#B0B8C1] mt-1">• 헤더 행은 자동으로 건너뜁니다 · 수량은 절대값 기입 (현재 재고를 해당 수량으로 변경)</p>
        </div>

        {/* File upload */}
        <div className="flex gap-2">
          <label className="flex items-center gap-1.5 h-10 px-3 rounded-xl border border-[#E5E8EB] text-[12px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] cursor-pointer transition-colors">
            <Upload className="h-3.5 w-3.5" /> 파일 선택
            <input type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
          </label>
          <span className="text-[12px] text-[#B0B8C1] self-center">또는 아래에 직접 붙여넣기</span>
        </div>

        {/* Textarea */}
        <textarea
          value={csvText}
          onChange={(e) => { setCsvText(e.target.value); parseCsv(e.target.value); }}
          rows={6}
          placeholder={"SKU001,국내창고,100,초기 기입\nSKU002,국내창고,50"}
          className="w-full px-3 py-2.5 text-[12px] font-mono border border-[#E5E8EB] rounded-xl focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 resize-none placeholder:text-[#C5CAD3]"
        />

        {/* Parse preview */}
        {parsed.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-[#191F28]">{parsed.length}행 인식됨</span>
              {validCount > 0 && <span className="text-[12px] text-green-600 font-medium">✓ {validCount}행 유효</span>}
              {invalidCount > 0 && <span className="text-[12px] text-red-500 font-medium">✗ {invalidCount}행 오류</span>}
            </div>
            <div className="max-h-40 overflow-y-auto border border-[#E5E8EB] rounded-xl divide-y divide-[#F2F4F6]">
              {parsed.map((row, i) => (
                <div key={i} className={`flex items-center gap-2 px-3 py-2 text-[12px] ${row.valid ? '' : 'bg-red-50'}`}>
                  <span className="text-[#B0B8C1] w-5 shrink-0">{i + 1}</span>
                  <span className="font-mono text-[#191F28] w-24 truncate">{row.sku_code}</span>
                  <span className="text-[#6B7684] w-20 truncate">{row.warehouse_name}</span>
                  <span className="text-[#191F28] w-12 text-right">{row.quantity}</span>
                  {row.error ? (
                    <span className="text-red-500 flex-1 truncate">{row.error}</span>
                  ) : (
                    <span className="text-[#B0B8C1] flex-1 truncate">{row.reason || '-'}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {parseError && <p className="text-[13px] text-red-500">{parseError}</p>}

        {/* Result */}
        {result && (
          <div className={`rounded-xl p-3 ${result.success > 0 ? 'bg-green-50' : 'bg-red-50'}`}>
            <p className="text-[13px] font-semibold text-green-700">{result.success}개 재고 기입 완료</p>
            {result.errors.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {result.errors.map((e) => (
                  <p key={e.row} className="text-[12px] text-red-600">{e.row}행: {e.message}</p>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={handleClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">닫기</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || validCount === 0}
            className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] disabled:opacity-60 flex items-center justify-center gap-2 transition-colors"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {validCount > 0 ? `${validCount}개 기입` : '기입'}
          </button>
        </div>
      </div>
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
            className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors" />
          {newQty !== '' && !isNaN(Number(newQty)) && Number(newQty) !== item.quantity && (
            <p className={`text-[12px] font-medium ${diff > 0 ? 'text-green-600' : 'text-red-500'}`}>
              {diff > 0 ? '+' : ''}{formatNumber(diff)}개 조정
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-[#191F28]">조정 사유</label>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 실물 재고 확인 후 조정"
            className="w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors" />
        </div>
        {error && <p className="text-[13px] text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">취소</button>
          <button type="submit" disabled={loading} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} 조정 저장
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Summary Tab (종합 현황) ─────────────────────────────────────────────────

type SumCol = 'product' | 'warehouse' | 'coupang' | 'transit' | 'total' | 'safety' | 's30d' | 's7d' | 'daily';
const DEFAULT_SUM_COLS: SumCol[] = ['product', 'warehouse', 'coupang', 'transit', 'total', 'safety', 's30d', 's7d', 'daily'];
const SUM_LABELS: Record<SumCol, string> = {
  product: '상품 / SKU', warehouse: '자사창고', coupang: '쿠팡그로스',
  transit: '수입중', total: '총 재고', safety: '안전재고',
  s30d: '30일판매', s7d: '7일판매', daily: '일평균',
};
const SUM_SORTABLE: Record<SumCol, boolean> = {
  product: true, warehouse: true, coupang: true, transit: true,
  total: true, safety: true, s30d: true, s7d: true, daily: true,
};

function SummaryTab() {
  const { vatOn, vatMult } = useVat();
  const [rows, setRows] = useState<InventorySummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [colOrder, setColOrder] = useState<SumCol[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_SUM_COLS;
    try { const s = localStorage.getItem('inv_sum_cols'); return s ? JSON.parse(s) : DEFAULT_SUM_COLS; } catch { return DEFAULT_SUM_COLS; }
  });
  const [sort, setSort] = useState<{ col: SumCol; dir: 'asc' | 'desc' } | null>(null);
  const [rowH, setRowH] = useState<RowHeight>('normal');
  const [dragOver, setDragOver] = useState<SumCol | null>(null);
  const dragRef = useRef<SumCol | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/inventory/summary').then((r) => r.json()).then((d) => { setRows(d ?? []); setLoading(false); });
  }, []);

  function toggleSort(col: SumCol) {
    if (!SUM_SORTABLE[col]) return;
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return null;
    });
  }

  function onDragStart(col: SumCol) { dragRef.current = col; }
  function onDragOver(e: React.DragEvent, col: SumCol) { e.preventDefault(); setDragOver(col); }
  function onDragLeave() { setDragOver(null); }
  function onDrop(target: SumCol) {
    setDragOver(null);
    const from = dragRef.current;
    if (!from || from === target) return;
    setColOrder((prev) => {
      const next = [...prev];
      const fi = next.indexOf(from), ti = next.indexOf(target);
      if (fi < 0 || ti < 0) return prev;
      next.splice(fi, 1); next.splice(ti, 0, from);
      localStorage.setItem('inv_sum_cols', JSON.stringify(next));
      return next;
    });
  }

  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const getV = (r: InventorySummaryRow): number | string => {
        switch (sort.col) {
          case 'product': return r.product_name;
          case 'warehouse': return r.warehouse_stock;
          case 'coupang': return r.coupang_stock;
          case 'transit': return r.transit_stock;
          case 'total': return r.total_stock;
          case 'safety': return r.safety_stock;
          case 's30d': return r.sales_30d;
          case 's7d': return r.sales_7d;
          case 'daily': return r.sales_30d / 30;
          default: return 0;
        }
      };
      const av = getV(a), bv = getV(b);
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sort.dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, sort]);

  const thCls = (col: SumCol) =>
    `text-left px-4 text-[11px] font-semibold text-[#6B7684] whitespace-nowrap select-none cursor-pointer group transition-colors hover:bg-[#F0F3FA]
    ${dragOver === col ? 'border-l-2 border-l-[#3182F6]' : ''}`;

  if (loading) return <div className="flex items-center justify-center h-48"><Loader2 className="h-6 w-6 animate-spin text-[#3182F6]" /></div>;

  if (!rows.length) return (
    <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col items-center justify-center py-16">
      <Package className="h-10 w-10 text-[#B0B8C1] mb-3" />
      <p className="text-[13px] font-medium text-[#6B7684]">등록된 SKU가 없습니다</p>
    </div>
  );

  function renderCell(col: SumCol, row: InventorySummaryRow) {
    const dailyAvg = row.sales_30d > 0 ? Math.round(row.sales_30d / 30 * 10) / 10 : null;
    const daysLeft = dailyAvg && row.total_stock > 0 ? Math.floor(row.total_stock / dailyAvg) : null;
    const isLow = row.total_stock <= row.safety_stock && row.safety_stock > 0;
    const py = ROW_PY[rowH];

    switch (col) {
      case 'product': return (
        <td key={col} className={`px-4 ${py}`}>
          <p className="text-[13px] font-medium text-[#191F28]">{row.product_name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[11px] text-[#6B7684] font-mono">{row.sku_code}</span>
            {Object.keys(row.option_values ?? {}).length > 0 && (
              <span className="text-[11px] bg-[#F2F4F6] text-[#6B7684] px-1.5 py-0.5 rounded-md">{skuOptionLabel(row.option_values)}</span>
            )}
            {isLow && <span className="text-[11px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-md font-medium">재고부족</span>}
          </div>
        </td>
      );
      case 'warehouse': return (
        <td key={col} className={`px-4 ${py}`}>
          <span className="text-[13px] font-semibold text-[#191F28] tabular-nums">{formatNumber(row.warehouse_stock)}</span>
          <span className="text-[11px] text-[#B0B8C1] ml-0.5">개</span>
        </td>
      );
      case 'coupang': return (
        <td key={col} className={`px-4 ${py}`}>
          <span className="text-[13px] font-semibold text-[#3182F6] tabular-nums">{formatNumber(row.coupang_stock)}</span>
          <span className="text-[11px] text-[#B0B8C1] ml-0.5">개</span>
        </td>
      );
      case 'transit': return (
        <td key={col} className={`px-4 ${py}`}>
          {row.transit_stock > 0
            ? <><span className="text-[13px] font-semibold text-orange-500 tabular-nums">{formatNumber(row.transit_stock)}</span><span className="text-[11px] text-[#B0B8C1] ml-0.5">개</span></>
            : <span className="text-[13px] text-[#B0B8C1]">-</span>}
        </td>
      );
      case 'total': return (
        <td key={col} className={`px-4 ${py}`}>
          <span className={`text-[15px] font-bold tabular-nums ${isLow ? 'text-red-500' : 'text-[#191F28]'}`}>{formatNumber(row.total_stock)}</span>
          <span className="text-[11px] text-[#B0B8C1] ml-0.5">개</span>
          {daysLeft !== null && <p className="text-[11px] text-[#B0B8C1] mt-0.5">{daysLeft}일치</p>}
        </td>
      );
      case 'safety': return (
        <td key={col} className={`px-4 ${py}`}>
          <span className="text-[13px] text-[#6B7684] tabular-nums">{row.safety_stock > 0 ? formatNumber(row.safety_stock) : '-'}</span>
        </td>
      );
      case 's30d': return (
        <td key={col} className={`px-4 ${py}`}>
          <span className="text-[13px] text-[#6B7684] tabular-nums">{row.sales_30d > 0 ? formatNumber(row.sales_30d) : '-'}</span>
        </td>
      );
      case 's7d': return (
        <td key={col} className={`px-4 ${py}`}>
          <span className="text-[13px] text-[#6B7684] tabular-nums">{row.sales_7d > 0 ? formatNumber(row.sales_7d) : '-'}</span>
        </td>
      );
      case 'daily': return (
        <td key={col} className={`px-4 ${py}`}>
          <span className="text-[13px] text-[#6B7684]">{dailyAvg !== null ? `${dailyAvg}개` : '-'}</span>
        </td>
      );
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#F2F4F6]">
        <span className="text-[12px] text-[#B0B8C1]">헤더 드래그로 컬럼 순서 변경 · 클릭으로 정렬</span>
        <RowHeightButtons value={rowH} onChange={setRowH} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-[#F2F4F6] bg-[#F8F9FB]">
              {colOrder.map((col) => (
                <th
                  key={col}
                  draggable
                  onDragStart={() => onDragStart(col)}
                  onDragOver={(e) => onDragOver(e, col)}
                  onDragLeave={onDragLeave}
                  onDrop={() => onDrop(col)}
                  onClick={() => toggleSort(col)}
                  className={thCls(col)}
                >
                  <div className={`flex items-center gap-1 py-3 ${sort?.col === col ? 'text-[#3182F6]' : ''}`}>
                    <GripVertical className="h-3 w-3 opacity-20 group-hover:opacity-60 shrink-0 transition-opacity" />
                    {SUM_LABELS[col]}
                    {SUM_SORTABLE[col] && <SortIcon active={sort?.col === col} dir={sort?.dir ?? 'asc'} />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F2F4F6]">
            {sorted.map((row) => {
              const isLow = row.total_stock <= row.safety_stock && row.safety_stock > 0;
              return (
                <tr key={row.sku_id} className={`hover:bg-[#FAFAFA] transition-colors ${isLow ? 'bg-red-50/30' : ''}`}>
                  {colOrder.map((col) => renderCell(col, row))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── RG 그로스 재고 탭 ───────────────────────────────────────────────────────

type RgCol = 'product' | 'grade' | 'qty' | 'daily_changes' | 's30d' | 'daily_avg' | 'days_left';
const DEFAULT_RG_COLS: RgCol[] = ['product', 'qty', 'daily_changes', 's30d', 'daily_avg', 'days_left'];
const DEFAULT_RG_RETURN_COLS: RgCol[] = ['product', 'grade', 'qty', 'daily_changes', 's30d', 'daily_avg', 'days_left'];
const RG_LABELS: Record<RgCol, string> = {
  product: '상품명 / SKU', grade: '등급', qty: '현재 재고', daily_changes: '일자별 출고',
  s30d: '30일 판매', daily_avg: '일평균', days_left: '예상 소진',
};

interface RgInventoryItem {
  vendor_item_id: string;
  external_sku_id: string | null;
  item_name: string | null;
  sales_last_30d: number;
  sku_id: string | null;
  sku?: { sku_code: string; option_values?: Record<string, string>; product: { name: string } } | null;
  current_qty: number;
  days_remaining: number | null;
  daily: { date: string; qty: number; change: number | null }[];
  is_return: boolean;
  grade: string | null;
  linked_sku_id: string | null;
  linked_sku: { sku_code: string; option_values?: Record<string, string>; product: { name: string } } | null;
}

function RgInventoryTab() {
  const [items, setItems] = useState<RgInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [days, setDays] = useState(30);
  const [error, setError] = useState('');
  const [syncMsg, setSyncMsg] = useState('');
  const [subTab, setSubTab] = useState<'new' | 'return'>('new');
  const [colOrder, setColOrder] = useState<RgCol[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_RG_COLS;
    try { const s = localStorage.getItem('inv_rg_cols'); return s ? JSON.parse(s) : DEFAULT_RG_COLS; } catch { return DEFAULT_RG_COLS; }
  });
  const [sort, setSort] = useState<{ col: RgCol; dir: 'asc' | 'desc' } | null>(null);
  const [rowH, setRowH] = useState<RowHeight>('normal');
  const [dragOver, setDragOver] = useState<RgCol | null>(null);
  const dragRef = useRef<RgCol | null>(null);
  const [classifying, setClassifying] = useState<string | null>(null);
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [skuOptions, setSkuOptions] = useState<{ id: string; label: string }[]>([]);
  const [linkSearch, setLinkSearch] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [returnChecked, setReturnChecked] = useState<Set<string>>(new Set());
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkGrade, setBulkGrade] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const lastCheckedIdx = useRef<number | null>(null);

  const GRADES = ['미개봉', '최상', '상', '중'];
  const GRADE_STYLE: Record<string, { bg: string; text: string; border: string }> = {
    '미개봉': { bg: 'bg-blue-50',  text: 'text-blue-600',  border: 'border-l-blue-400' },
    '최상':   { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-l-emerald-400' },
    '상':     { bg: 'bg-amber-50',  text: 'text-amber-600',  border: 'border-l-amber-400' },
    '중':     { bg: 'bg-rose-50',   text: 'text-rose-500',   border: 'border-l-rose-400' },
  };
  const GRADE_DEFAULT_STYLE = { bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-l-gray-300' };
  function gradeStyle(g: string | null) { return g ? (GRADE_STYLE[g] ?? GRADE_DEFAULT_STYLE) : GRADE_DEFAULT_STYLE; }

  useEffect(() => {
    fetch('/api/skus').then(r => r.json()).then((data: any[]) => {
      setSkuOptions((data ?? []).map((s: any) => ({
        id: s.id,
        label: `${s.product?.name ?? ''} · ${s.sku_code}`,
      })));
    }).catch(() => {});
  }, []);

  // 단건 연결 (optimistic, 새로고침 없음)
  async function linkSku(vendorItemId: string, skuId: string) {
    const sku = skuOptions.find((s) => s.id === skuId);
    const skuData = sku ? { sku_code: sku.label.split(' · ')[1] ?? '', option_values: {}, product: { name: sku.label.split(' · ')[0] ?? '' } } : null;
    setItems((prev) => prev.map((i) => i.vendor_item_id === vendorItemId ? { ...i, linked_sku_id: skuId, linked_sku: skuData as any } : i));
    setLinkTarget(null);
    setLinkSearch('');
    fetch('/api/coupang/rg-return', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vendor_item_id: vendorItemId, sku_id: skuId }) });
  }

  // 단건 해제 (optimistic)
  async function unlinkSku(vendorItemId: string) {
    setItems((prev) => prev.map((i) => i.vendor_item_id === vendorItemId ? { ...i, linked_sku_id: null, linked_sku: null } : i));
    fetch('/api/coupang/rg-return', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vendor_item_id: vendorItemId, sku_id: null }) });
  }

  // 일괄 연결 (선택된 반품 항목을 하나의 SKU에 연결)
  const [bulkLinkOpen, setBulkLinkOpen] = useState(false);
  const [bulkLinkSearch, setBulkLinkSearch] = useState('');
  const [bulkLinkLoading, setBulkLinkLoading] = useState(false);

  async function bulkLinkSku(skuId: string) {
    setBulkLinkLoading(true);
    const sku = skuOptions.find((s) => s.id === skuId);
    const skuData = sku ? { sku_code: sku.label.split(' · ')[1] ?? '', option_values: {}, product: { name: sku.label.split(' · ')[0] ?? '' } } : null;
    const ids = [...returnChecked];
    // optimistic update
    setItems((prev) => prev.map((i) => ids.includes(i.vendor_item_id) ? { ...i, linked_sku_id: skuId, linked_sku: skuData as any } : i));
    // batch API calls
    await Promise.all(ids.map((id) =>
      fetch('/api/coupang/rg-return', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vendor_item_id: id, sku_id: skuId }) })
    ));
    setReturnChecked(new Set());
    setBulkLinkOpen(false);
    setBulkLinkSearch('');
    setBulkLinkLoading(false);
  }

  async function bulkUnlinkSku() {
    setBulkLinkLoading(true);
    const ids = [...returnChecked];
    setItems((prev) => prev.map((i) => ids.includes(i.vendor_item_id) ? { ...i, linked_sku_id: null, linked_sku: null } : i));
    await Promise.all(ids.map((id) =>
      fetch('/api/coupang/rg-return', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vendor_item_id: id, sku_id: null }) })
    ));
    setReturnChecked(new Set());
    setBulkLinkLoading(false);
  }

  function toggleCheck(id: string, idx: number, e: React.MouseEvent) {
    if (e.shiftKey && lastCheckedIdx.current !== null) {
      // Shift+click range selection
      const list = sorted.map((i) => i.vendor_item_id);
      const start = Math.min(lastCheckedIdx.current, idx);
      const end = Math.max(lastCheckedIdx.current, idx);
      setChecked((prev) => {
        const n = new Set(prev);
        for (let i = start; i <= end; i++) n.add(list[i]);
        return n;
      });
    } else {
      setChecked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    }
    lastCheckedIdx.current = idx;
  }
  function toggleAll() {
    setChecked((prev) => prev.size === newItems.length ? new Set() : new Set(newItems.map((i) => i.vendor_item_id)));
  }
  function toggleReturnCheck(id: string, idx: number, e: React.MouseEvent) {
    if (e.shiftKey && lastCheckedIdx.current !== null) {
      const list = sorted.map((i) => i.vendor_item_id);
      const start = Math.min(lastCheckedIdx.current, idx);
      const end = Math.max(lastCheckedIdx.current, idx);
      setReturnChecked((prev) => {
        const n = new Set(prev);
        for (let i = start; i <= end; i++) n.add(list[i]);
        return n;
      });
    } else {
      setReturnChecked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    }
    lastCheckedIdx.current = idx;
  }
  function toggleReturnAll() {
    setReturnChecked((prev) => prev.size === returnItems.length ? new Set() : new Set(returnItems.map((i) => i.vendor_item_id)));
  }
  async function unclassifyBulk() {
    setBulkLoading(true);
    await Promise.all([...returnChecked].map((id) =>
      fetch('/api/coupang/rg-return', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor_item_id: id }),
      })
    ));
    setReturnChecked(new Set());
    setBulkLoading(false);
    await load();
  }

  async function classifyBulk() {
    setBulkLoading(true);
    await Promise.all([...checked].map((id) =>
      fetch('/api/coupang/rg-return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor_item_id: id, grade: bulkGrade || null }),
      })
    ));
    setChecked(new Set());
    setBulkModal(false);
    setBulkGrade('');
    setBulkLoading(false);
    await load();
  }

  async function classify(vendorItemId: string, grade: string | null) {
    setClassifying(vendorItemId);
    await fetch('/api/coupang/rg-return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor_item_id: vendorItemId, grade }),
    });
    await load();
    setClassifying(null);
  }

  async function unclassify(vendorItemId: string) {
    setClassifying(vendorItemId);
    await fetch('/api/coupang/rg-return', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor_item_id: vendorItemId }),
    });
    await load();
    setClassifying(null);
  }

  async function updateGrade(vendorItemId: string, grade: string) {
    await fetch('/api/coupang/rg-return', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor_item_id: vendorItemId, grade }),
    });
    setItems((prev) => prev.map((i) => i.vendor_item_id === vendorItemId ? { ...i, grade } : i));
  }

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
      setSyncMsg(`${d.synced}개 동기화${d.auto_classified ? ` · 반품 ${d.auto_classified}개 자동분류` : ''}`);
      load();
    } catch (err: any) { setError(err.message); }
    setSyncing(false);
  }

  function toggleSort(col: RgCol) {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return null;
    });
  }

  function onDragStart(col: RgCol) { dragRef.current = col; }
  function onDragOver(e: React.DragEvent, col: RgCol) { e.preventDefault(); setDragOver(col); }
  function onDragLeave() { setDragOver(null); }
  function onDrop(target: RgCol) {
    setDragOver(null);
    const from = dragRef.current;
    if (!from || from === target) return;
    setColOrder((prev) => {
      const next = [...prev];
      const fi = next.indexOf(from), ti = next.indexOf(target);
      if (fi < 0 || ti < 0) return prev;
      next.splice(fi, 1); next.splice(ti, 0, from);
      localStorage.setItem('inv_rg_cols', JSON.stringify(next));
      return next;
    });
  }

  const newItems    = useMemo(() => items.filter((i) => !i.is_return), [items]);
  const returnItems = useMemo(() => items.filter((i) => i.is_return),  [items]);

  const showDays = Math.min(days, 7);

  const GRADE_ORDER = ['미개봉', '최상', '상', '중', ''];
  const activeColOrder = subTab === 'return' ? DEFAULT_RG_RETURN_COLS : colOrder;
  const sorted = useMemo(() => {
    const source = subTab === 'return' ? returnItems : newItems;
    // 기본: 재고 수량 내림차순
    if (!sort) {
      return [...source].sort((a, b) => b.current_qty - a.current_qty);
    }
    return [...source].sort((a, b) => {
      const getV = (item: RgInventoryItem): number | string => {
        switch (sort.col) {
          case 'product': return item.sku?.product?.name ?? item.external_sku_id ?? item.vendor_item_id;
          case 'grade': return GRADE_ORDER.indexOf(item.grade ?? '');
          case 'qty': return item.current_qty;
          case 's30d': return item.sales_last_30d;
          case 'daily_avg': return item.sales_last_30d / 30;
          case 'days_left': return item.days_remaining ?? 9999;
          default: return 0;
        }
      };
      const av = getV(a), bv = getV(b);
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sort.dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [items, sort, subTab]);

  const thCls = (col: RgCol) =>
    `text-left px-4 text-[12px] font-semibold text-[#6B7684] whitespace-nowrap select-none cursor-pointer group transition-colors hover:bg-[#F0F3FA] ${dragOver === col ? 'border-l-2 border-l-[#3182F6]' : ''}`;

  // 반품 아이템의 표시명 결정 (linked_sku 우선)
  function returnDisplayName(item: RgInventoryItem) {
    return item.linked_sku?.product?.name ?? item.sku?.product?.name ?? item.item_name ?? '';
  }
  function returnOptionLabel(item: RgInventoryItem) {
    if (item.linked_sku?.option_values) return skuOptionLabel(item.linked_sku.option_values);
    if (item.sku?.option_values) return skuOptionLabel(item.sku.option_values);
    return '';
  }

  function renderRgCell(col: RgCol, item: RgInventoryItem) {
    const dailyAvg = item.sales_last_30d > 0 ? Math.round((item.sales_last_30d / 30) * 10) / 10 : null;
    const isLow = item.days_remaining !== null && item.days_remaining <= 7;
    const isWarn = !isLow && item.days_remaining !== null && item.days_remaining <= 14;
    const productName = item.is_return
      ? (returnDisplayName(item) || item.external_sku_id || item.vendor_item_id)
      : (item.sku?.product?.name ?? item.item_name ?? item.external_sku_id ?? item.vendor_item_id);
    const recentChanges = item.daily.filter((d) => d.change !== null).slice(-showDays);
    const py = ROW_PY[rowH];

    const isClassifying = classifying === item.vendor_item_id;

    const optionLabel = item.is_return ? returnOptionLabel(item) : (item.sku?.option_values ? skuOptionLabel(item.sku.option_values) : '');

    switch (col) {
      case 'grade': return (
        <td key={col} className={`px-4 ${py}`}>
          <select
            value={item.grade ?? ''}
            onChange={(e) => updateGrade(item.vendor_item_id, e.target.value)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border-none outline-none cursor-pointer appearance-none ${gradeStyle(item.grade).bg} ${gradeStyle(item.grade).text}`}
          >
            <option value="">미지정</option>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </td>
      );
      case 'product': return (
        <td key={col} className={`px-4 ${py}`}>
          {item.is_return ? (
            <>
              <div className="flex items-center gap-2 group">
                <p className="text-[13px] font-medium text-[#191F28]">{productName}</p>
                <button
                  onClick={() => unclassify(item.vendor_item_id)}
                  disabled={isClassifying}
                  className="opacity-0 group-hover:opacity-100 text-[11px] text-[#B0B8C1] hover:text-red-500 transition-all ml-auto shrink-0"
                >해제</button>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                {optionLabel && <span className="text-[11px] bg-[#F2F4F6] text-[#6B7684] px-1.5 py-0.5 rounded-md">{optionLabel}</span>}
                <span className="text-[11px] text-[#D1D5DB] font-mono">{item.external_sku_id ?? item.vendor_item_id}</span>
                {!item.linked_sku && (
                  <div className="relative">
                    <button
                      onClick={() => { setLinkTarget(item.vendor_item_id); setLinkSearch(''); }}
                      className="text-[11px] text-[#B0B8C1] hover:text-blue-500 transition-colors"
                    >+ 연결</button>
                    {linkTarget === item.vendor_item_id && (
                      <div className="absolute left-0 top-5 z-20 bg-white border border-[#E5E8EB] rounded-xl shadow-lg w-72 p-3">
                        <input
                          autoFocus
                          value={linkSearch}
                          onChange={(e) => setLinkSearch(e.target.value)}
                          placeholder="상품명 또는 SKU 검색"
                          className="w-full h-8 px-3 text-[12px] border border-[#E5E8EB] rounded-lg outline-none focus:border-[#3182F6] mb-2"
                        />
                        <div className="max-h-[28rem] overflow-y-auto space-y-0.5">
                          {skuOptions
                            .filter(o => !linkSearch || o.label.toLowerCase().includes(linkSearch.toLowerCase()))
                            .slice(0, 30)
                            .map(o => (
                              <button key={o.id} onClick={() => linkSku(item.vendor_item_id, o.id)}
                                className="w-full text-left px-2 py-1.5 text-[12px] text-[#191F28] hover:bg-[#F2F4F6] rounded-lg truncate">
                                {o.label}
                              </button>
                            ))}
                        </div>
                        <button onClick={() => setLinkTarget(null)} className="mt-2 text-[11px] text-[#B0B8C1] hover:text-[#6B7684]">취소</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 group">
                <p className="text-[13px] font-medium text-[#191F28]">{productName}</p>
                <button
                  onClick={() => classify(item.vendor_item_id, null)}
                  disabled={isClassifying}
                  className="opacity-0 group-hover:opacity-100 text-[11px] text-[#B0B8C1] hover:text-orange-500 transition-all shrink-0 whitespace-nowrap"
                  title="반품재판매로 분류"
                >↗ 반품</button>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                {optionLabel && <span className="text-[11px] bg-[#F2F4F6] text-[#6B7684] px-1.5 py-0.5 rounded-md">{optionLabel}</span>}
                <span className="text-[11px] text-[#B0B8C1] font-mono">{item.external_sku_id ?? item.vendor_item_id}</span>
              </div>
            </>
          )}
        </td>
      );
      case 'qty': return (
        <td key={col} className={`px-4 ${py} whitespace-nowrap`}>
          <span className={`text-[15px] font-bold tabular-nums ${isLow ? 'text-red-500' : 'text-[#191F28]'}`}>{formatNumber(item.current_qty)}</span>
          <span className="text-[11px] text-[#B0B8C1] ml-0.5">개</span>
          {isLow  && <span className="ml-1.5 text-[11px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-md font-medium">부족</span>}
          {isWarn && <span className="ml-1.5 text-[11px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-md font-medium">주의</span>}
        </td>
      );
      case 'daily_changes': return (
        <td key={col} className={`px-4 ${py}`}>
          {recentChanges.length === 0 ? (
            <span className="text-[12px] text-[#B0B8C1]">스냅샷 2일 이상 필요</span>
          ) : (
            <div className="flex items-end gap-2">
              {recentChanges.map((d, i) => {
                const change = d.change ?? 0;
                const outflow = change < 0 ? Math.abs(change) : 0;
                const inflow = change > 0 ? change : 0;
                return (
                  <div key={i} className="flex flex-col items-center gap-0.5 min-w-[28px]">
                    <span className="text-[9.5px] text-[#B0B8C1]">{d.date.slice(5)}</span>
                    {outflow > 0 ? (
                      <span className="text-[11px] font-semibold text-red-500 tabular-nums">-{formatNumber(outflow)}</span>
                    ) : inflow > 0 ? (
                      <span className="text-[11px] font-semibold text-blue-500 tabular-nums">+{formatNumber(inflow)}</span>
                    ) : (
                      <span className="text-[11px] text-[#D1D5DB]">0</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </td>
      );
      case 's30d': return (
        <td key={col} className={`px-4 ${py}`}>
          <span className="text-[13px] text-[#6B7684] tabular-nums">{item.sales_last_30d > 0 ? formatNumber(item.sales_last_30d) + '개' : '-'}</span>
        </td>
      );
      case 'daily_avg': return (
        <td key={col} className={`px-4 ${py}`}>
          <span className="text-[13px] text-[#6B7684]">{dailyAvg !== null ? `${dailyAvg}개` : '-'}</span>
        </td>
      );
      case 'days_left': return (
        <td key={col} className={`px-4 ${py}`}>
          {item.days_remaining !== null ? (
            <span className={`text-[13px] font-semibold tabular-nums ${isLow ? 'text-red-500' : isWarn ? 'text-amber-500' : 'text-[#191F28]'}`}>
              {item.days_remaining}일
            </span>
          ) : (
            <span className="text-[13px] text-[#B0B8C1]">-</span>
          )}
        </td>
      );
    }
  }

  return (
    <div className="space-y-4">
      {/* 서브탭 */}
      <div className="flex items-center gap-1 border-b border-[#E5E8EB]">
        {([['new', '신상품', newItems.length], ['return', '반품재판매', returnItems.length]] as const).map(([v, label, cnt]) => (
          <button key={v} onClick={() => { setSubTab(v); setChecked(new Set()); setReturnChecked(new Set()); lastCheckedIdx.current = null; }}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors ${subTab === v ? 'border-[#3182F6] text-[#3182F6]' : 'border-transparent text-[#6B7684] hover:text-[#191F28]'}`}>
            {label}
            <span className={`ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full ${subTab === v ? 'bg-[#EBF3FF] text-[#3182F6]' : 'bg-[#F2F4F6] text-[#B0B8C1]'}`}>{cnt}</span>
          </button>
        ))}
      </div>

      {/* 신상품 일괄 분류 액션바 */}
      {subTab === 'new' && checked.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-[#EBF3FF] rounded-xl">
          <span className="text-[13px] font-medium text-[#3182F6]">{checked.size}개 선택됨</span>
          <span className="text-[11px] text-[#B0B8C1]">Shift+클릭으로 범위 선택</span>
          <button onClick={() => setBulkModal(true)}
            className="h-8 px-3 rounded-lg bg-orange-500 text-white text-[12px] font-semibold hover:bg-orange-600 transition-colors">
            반품재판매로 이동
          </button>
          <button onClick={() => setChecked(new Set())}
            className="h-8 px-3 rounded-lg border border-[#E5E8EB] text-[12px] text-[#6B7684] hover:bg-white transition-colors">
            선택 해제
          </button>
        </div>
      )}

      {/* 반품재판매 일괄 액션바 */}
      {subTab === 'return' && returnChecked.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-orange-50 rounded-xl flex-wrap">
          <span className="text-[13px] font-medium text-orange-600">{returnChecked.size}개 선택됨</span>
          <span className="text-[11px] text-[#B0B8C1]">Shift+클릭 범위선택</span>
          <div className="flex items-center gap-1.5 ml-auto">
            <button onClick={() => { setBulkLinkOpen(true); setBulkLinkSearch(''); }}
              className="h-8 px-3 rounded-lg bg-blue-500 text-white text-[12px] font-semibold hover:bg-blue-600 transition-colors">
              일괄 연결
            </button>
            <button onClick={bulkUnlinkSku} disabled={bulkLinkLoading}
              className="h-8 px-3 rounded-lg border border-[#E5E8EB] text-[12px] text-[#6B7684] hover:bg-white transition-colors disabled:opacity-60">
              연결 해제
            </button>
            <button onClick={unclassifyBulk} disabled={bulkLoading}
              className="h-8 px-3 rounded-lg bg-[#3182F6] text-white text-[12px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60">
              {bulkLoading ? '처리 중...' : '신상품으로 이동'}
            </button>
            <button onClick={() => setReturnChecked(new Set())}
              className="h-8 px-3 rounded-lg border border-[#E5E8EB] text-[12px] text-[#6B7684] hover:bg-white transition-colors">
              선택 해제
            </button>
          </div>
        </div>
      )}

      {/* 일괄 연결 모달 */}
      {bulkLinkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setBulkLinkOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-96 p-6">
            <h3 className="text-[15px] font-bold text-[#191F28] mb-1">신상품 일괄 연결</h3>
            <p className="text-[12px] text-[#6B7684] mb-4">{returnChecked.size}개 반품 항목을 선택한 신상품에 연결합니다.</p>
            <input
              autoFocus
              value={bulkLinkSearch}
              onChange={(e) => setBulkLinkSearch(e.target.value)}
              placeholder="상품명 또는 SKU 검색..."
              className="w-full h-10 px-3 text-[13px] border border-[#E5E8EB] rounded-xl outline-none focus:border-[#3182F6] mb-2"
            />
            <div className="max-h-[28rem] overflow-y-auto space-y-0.5">
              {skuOptions
                .filter(o => !bulkLinkSearch || o.label.toLowerCase().includes(bulkLinkSearch.toLowerCase()))
                .slice(0, 50)
                .map(o => (
                  <button key={o.id} onClick={() => bulkLinkSku(o.id)} disabled={bulkLinkLoading}
                    className="w-full text-left px-3 py-2 text-[13px] text-[#191F28] hover:bg-[#F2F4F6] rounded-lg truncate disabled:opacity-60">
                    {o.label}
                  </button>
                ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setBulkLinkOpen(false)} className="flex-1 h-10 rounded-xl border border-[#E5E8EB] text-[13px] text-[#6B7684]">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 일괄 분류 모달 */}
      {bulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setBulkModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-80 p-6">
            <h3 className="text-[15px] font-bold text-[#191F28] mb-4">반품재판매 등급 선택</h3>
            <p className="text-[12px] text-[#6B7684] mb-4">{checked.size}개 상품을 반품재판매로 분류합니다.</p>
            <div className="grid grid-cols-2 gap-2 mb-5">
              {GRADES.map((g) => (
                <button key={g} onClick={() => setBulkGrade(g)}
                  className={`h-11 rounded-xl text-[13px] font-semibold border-2 transition-colors ${bulkGrade === g ? 'border-orange-500 bg-orange-50 text-orange-600' : 'border-[#E5E8EB] text-[#6B7684] hover:border-orange-300'}`}>
                  {g}
                </button>
              ))}
              <button onClick={() => setBulkGrade('')}
                className={`h-11 rounded-xl text-[13px] font-semibold border-2 transition-colors col-span-2 ${bulkGrade === '' ? 'border-[#3182F6] bg-[#EBF3FF] text-[#3182F6]' : 'border-[#E5E8EB] text-[#B0B8C1] hover:border-[#3182F6]'}`}>
                등급 미지정
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setBulkModal(false)} className="flex-1 h-10 rounded-xl border border-[#E5E8EB] text-[13px] text-[#6B7684]">취소</button>
              <button onClick={classifyBulk} disabled={bulkLoading}
                className="flex-1 h-10 rounded-xl bg-orange-500 text-white text-[13px] font-semibold hover:bg-orange-600 disabled:opacity-60">
                {bulkLoading ? '처리 중...' : '이동'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#6B7684] font-medium">스냅샷 조회</span>
          {[7, 14, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`h-8 px-3 rounded-xl text-[12px] font-medium transition-colors ${days === d ? 'bg-[#3182F6] text-white' : 'bg-white border border-[#E5E8EB] text-[#6B7684] hover:bg-[#F2F4F6]'}`}>
              최근 {d}일
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {syncMsg && <span className="text-[12px] text-green-600 font-medium">{syncMsg}</span>}
          {error  && <span className="text-[12px] text-red-500">{error}</span>}
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors disabled:opacity-60">
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            재고 동기화
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#F2F4F6]">
          <span className="text-[12px] text-[#B0B8C1]">헤더 드래그로 컬럼 순서 변경 · 클릭으로 정렬</span>
          <RowHeightButtons value={rowH} onChange={setRowH} />
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" /></div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Package className="h-10 w-10 text-[#B0B8C1] mb-3" />
            {subTab === 'return' ? (
              <>
                <p className="text-[13px] font-medium text-[#6B7684]">반품재판매 상품이 없습니다</p>
                <p className="text-[12px] text-[#B0B8C1] mt-1">마스터 시트에서 반품재판매 옵션 ID를 등록하면 자동 분류됩니다</p>
              </>
            ) : (
              <>
                <p className="text-[13px] font-medium text-[#6B7684]">로켓그로스 재고 데이터가 없습니다</p>
                <p className="text-[12px] text-[#B0B8C1] mt-1">재고 동기화 버튼을 눌러 데이터를 가져오세요</p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="border-b border-[#F2F4F6] bg-[#F8F9FB]">
                  <th className="w-10 px-3">
                    <input type="checkbox"
                      checked={subTab === 'new' ? (newItems.length > 0 && checked.size === newItems.length) : (returnItems.length > 0 && returnChecked.size === returnItems.length)}
                      onChange={subTab === 'new' ? toggleAll : toggleReturnAll}
                      className="w-3.5 h-3.5 accent-[#3182F6] cursor-pointer" />
                  </th>
                  {activeColOrder.map((col) => (
                    <th key={col}
                      draggable={subTab === 'new'}
                      onDragStart={() => onDragStart(col)}
                      onDragOver={(e) => onDragOver(e, col)}
                      onDragLeave={onDragLeave}
                      onDrop={() => onDrop(col)}
                      onClick={() => toggleSort(col)}
                      className={thCls(col)}
                    >
                      <div className={`flex items-center gap-1 py-3 ${sort?.col === col ? 'text-[#3182F6]' : ''}`}>
                        {subTab === 'new' && <GripVertical className="h-3 w-3 opacity-20 group-hover:opacity-60 shrink-0 transition-opacity" />}
                        {col === 'daily_changes' ? `일자별 출고 (최근 ${showDays}일)` : RG_LABELS[col]}
                        <SortIcon active={sort?.col === col} dir={sort?.dir ?? 'asc'} />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F4F6]">
                {sorted.map((item, idx) => {
                  const isLow = item.days_remaining !== null && item.days_remaining <= 7;
                  const isWarn = !isLow && item.days_remaining !== null && item.days_remaining <= 14;
                  const isChecked = subTab === 'new' ? checked.has(item.vendor_item_id) : returnChecked.has(item.vendor_item_id);
                  return (
                    <tr key={item.vendor_item_id}
                      className={`hover:bg-[#FAFAFA] transition-colors ${isChecked ? 'bg-[#F0F7FF]' : isLow ? 'bg-red-50/30' : isWarn ? 'bg-amber-50/30' : ''}`}>
                      <td className="w-10 px-3">
                        <input type="checkbox" checked={isChecked}
                          onClick={(e) => subTab === 'new' ? toggleCheck(item.vendor_item_id, idx, e as any) : toggleReturnCheck(item.vendor_item_id, idx, e as any)}
                          readOnly
                          className="w-3.5 h-3.5 accent-[#3182F6] cursor-pointer" />
                      </td>
                      {activeColOrder.map((col) => renderRgCell(col, item))}
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

type WhCol = 'product' | 'warehouse' | 'qty' | 'cost' | 'value' | 'adjust';
const DEFAULT_WH_COLS: WhCol[] = ['product', 'warehouse', 'qty', 'cost', 'value', 'adjust'];
const WH_LABELS: Record<WhCol, string> = {
  product: '상품 / SKU', warehouse: '창고', qty: '수량', cost: '원가', value: '재고가치', adjust: '조정',
};

export default function InventoryPage() {
  const { vatOn, vatMult } = useVat();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<'summary' | 'warehouse' | 'rg' | 'trends' | 'forecast'>(() => {
    const t = searchParams.get('tab');
    return (t === 'warehouse' || t === 'rg' || t === 'trends' || t === 'forecast') ? t : 'summary';
  });
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('all');
  const [adjustItem, setAdjustItem] = useState<InventoryRow | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  // Warehouse table column features
  const [whColOrder, setWhColOrder] = useState<WhCol[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_WH_COLS;
    try { const s = localStorage.getItem('inv_wh_cols'); return s ? JSON.parse(s) : DEFAULT_WH_COLS; } catch { return DEFAULT_WH_COLS; }
  });
  const [whSort, setWhSort] = useState<{ col: WhCol; dir: 'asc' | 'desc' } | null>(null);
  const [whRowH, setWhRowH] = useState<RowHeight>('normal');
  const [whDragOver, setWhDragOver] = useState<WhCol | null>(null);
  const whDragRef = useRef<WhCol | null>(null);

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

  // Warehouse sort
  const whSorted = useMemo(() => {
    if (!whSort) return filtered;
    return [...filtered].sort((a, b) => {
      const getV = (item: InventoryRow): number | string => {
        switch (whSort.col) {
          case 'product': return item.sku?.product?.name ?? '';
          case 'warehouse': return item.warehouse?.name ?? '';
          case 'qty': return item.quantity;
          case 'cost': return item.sku?.cost_price ?? 0;
          case 'value': return item.quantity * (item.sku?.cost_price ?? 0);
          default: return 0;
        }
      };
      const av = getV(a), bv = getV(b);
      if (typeof av === 'string') return whSort.dir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return whSort.dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [filtered, whSort]);

  function toggleWhSort(col: WhCol) {
    if (col === 'adjust') return;
    setWhSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return null;
    });
  }
  function onWhDragStart(col: WhCol) { whDragRef.current = col; }
  function onWhDragOver(e: React.DragEvent, col: WhCol) { e.preventDefault(); setWhDragOver(col); }
  function onWhDragLeave() { setWhDragOver(null); }
  function onWhDrop(target: WhCol) {
    setWhDragOver(null);
    const from = whDragRef.current;
    if (!from || from === target) return;
    setWhColOrder((prev) => {
      const next = [...prev];
      const fi = next.indexOf(from), ti = next.indexOf(target);
      if (fi < 0 || ti < 0) return prev;
      next.splice(fi, 1); next.splice(ti, 0, from);
      localStorage.setItem('inv_wh_cols', JSON.stringify(next));
      return next;
    });
  }

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
      ['상품명', '브랜드', '카테고리', 'SKU코드', '옵션', '창고', '수량', '원가(VAT별도)', `재고가치${vatOn ? '(VAT포함)' : '(VAT별도)'}`],
      ...filtered.map((i) => [
        i.sku?.product?.name ?? '', i.sku?.product?.brand ?? '', i.sku?.product?.category ?? '',
        i.sku?.sku_code ?? '', skuOptionLabel(i.sku?.option_values ?? {}),
        i.warehouse?.name ?? '', String(i.quantity), String(i.sku?.cost_price ?? 0),
        String(Math.round(i.quantity * (i.sku?.cost_price ?? 0) * vatMult)),
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

  const whThCls = (col: WhCol) =>
    `text-left px-4 text-[12px] font-semibold text-[#6B7684] whitespace-nowrap select-none ${col !== 'adjust' ? 'cursor-pointer group hover:bg-[#F0F3FA]' : ''} transition-colors ${whDragOver === col ? 'border-l-2 border-l-[#3182F6]' : ''}`;

  function renderWhCell(col: WhCol, item: InventoryRow) {
    const value = item.quantity * (item.sku?.cost_price ?? 0);
    const isLow = item.quantity <= (item.sku?.reorder_point ?? 0);
    const isWarn = !isLow && item.quantity <= (item.sku?.safety_stock ?? 0) * 2;
    const py = ROW_PY[whRowH];

    switch (col) {
      case 'product': return (
        <td key={col} className={`px-4 ${py} min-w-0`}>
          <p className="text-[13px] font-medium text-[#191F28] truncate">{item.sku?.product?.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[11px] text-[#6B7684] font-mono">{item.sku?.sku_code}</span>
            {Object.keys(item.sku?.option_values ?? {}).length > 0 && (
              <span className="text-[11px] bg-[#F2F4F6] text-[#6B7684] px-1.5 py-0.5 rounded-md">{skuOptionLabel(item.sku?.option_values ?? {})}</span>
            )}
            {isLow && <span className="text-[11px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-md font-medium">발주점 이하</span>}
            {isWarn && <span className="text-[11px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-md font-medium">주의</span>}
          </div>
        </td>
      );
      case 'warehouse': return (
        <td key={col} className={`px-4 ${py}`}>
          <p className="text-[13px] text-[#191F28]">{item.warehouse?.name}</p>
        </td>
      );
      case 'qty': return (
        <td key={col} className={`px-4 ${py} text-right`}>
          <span className={`text-[15px] tabular-nums ${quantityColor(item)}`}>{formatNumber(item.quantity)}</span>
          <span className="text-[11px] text-[#B0B8C1] ml-0.5">개</span>
        </td>
      );
      case 'cost': return (
        <td key={col} className={`px-4 ${py} text-right`}>
          <span className="text-[13px] text-[#6B7684] tabular-nums">{formatCurrency(item.sku?.cost_price ?? 0)}</span>
          {vatOn && <p className="text-[11px] text-[#B0B8C1]">+VAT {formatCurrency((item.sku?.cost_price ?? 0) * 0.1)}</p>}
        </td>
      );
      case 'value': return (
        <td key={col} className={`px-4 ${py} text-right`}>
          <span className="text-[13px] font-medium text-[#191F28] tabular-nums">{formatCurrency(value * vatMult)}</span>
        </td>
      );
      case 'adjust': return (
        <td key={col} className={`px-4 ${py} text-center`}>
          <button onClick={() => setAdjustItem(item)} className="h-8 px-3 rounded-xl border border-[#E5E8EB] text-[12px] font-medium text-[#6B7684] hover:border-[#3182F6] hover:text-[#3182F6] hover:bg-[#EBF1FE] transition-colors whitespace-nowrap">조정</button>
        </td>
      );
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[20px] font-bold tracking-[-0.03em] text-[#191F28]">재고 현황</h2>
          <p className="mt-1 text-[13px] text-[#6B7684]">
            창고별 재고 및 채널별 재고를 확인하세요
            <span className="ml-2 text-[12px] text-[#B0B8C1]">· 원가·물류비는 부가세 별도 금액 기준</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEntryOpen(true)} className="flex items-center gap-2 h-10 px-4 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] transition-colors">
            <Plus className="h-4 w-4" /> 재고 기입
          </button>
          <button onClick={() => setCsvImportOpen(true)} className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
            <Upload className="h-4 w-4" /> CSV 기입
          </button>
          {tab === 'warehouse' && (
            <button onClick={exportCsv} className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
              <Download className="h-4 w-4" /> CSV
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#F2F4F6] rounded-xl p-1 w-fit">
        {([['summary', '종합 현황', LayoutGrid], ['warehouse', '창고별 상세', List], ['rg', '쿠팡그로스', Package], ['trends', '추이', BarChart3], ['forecast', '예측', TrendingUp]] as const).map(([value, label, Icon]) => (
          <button key={value} onClick={() => setTab(value)}
            className={`flex items-center gap-2 h-10 px-4 rounded-[10px] text-[13px] font-medium transition-all ${tab === value ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684] hover:text-[#191F28]'}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* Summary Cards (창고별 탭에서만) */}
      {tab === 'warehouse' && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="w-9 h-10 rounded-xl bg-[#EBF1FE] flex items-center justify-center mb-3">
              <Package className="h-[18px] w-[18px] text-[#3182F6]" strokeWidth={2.5} />
            </div>
            <p className="text-[11px] text-[#6B7684] font-medium mb-1">관리 SKU</p>
            <div className="flex items-baseline gap-1">
              <span className="text-[24px] font-bold text-[#3182F6] tracking-[-0.04em]">{formatNumber(stats.totalSkus)}</span>
              <span className="text-[13px] text-[#B0B8C1]">개</span>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="w-9 h-10 rounded-xl bg-green-50 flex items-center justify-center mb-3">
              <WarehouseIcon className="h-[18px] w-[18px] text-green-600" strokeWidth={2.5} />
            </div>
            <p className="text-[11px] text-[#6B7684] font-medium mb-1">총 재고 수량</p>
            <div className="flex items-baseline gap-1">
              <span className="text-[24px] font-bold text-green-600 tracking-[-0.04em]">{formatNumber(stats.totalQty)}</span>
              <span className="text-[13px] text-[#B0B8C1]">개</span>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="w-9 h-10 rounded-xl bg-orange-50 flex items-center justify-center mb-3">
              <TrendingUp className="h-[18px] w-[18px] text-[#FF6B00]" strokeWidth={2.5} />
            </div>
            <p className="text-[11px] text-[#6B7684] font-medium mb-1">
              재고 원가 총액 {vatOn && <span className="text-[11px] text-[#3182F6] font-semibold">(VAT+10%)</span>}
            </p>
            <div className="flex items-baseline gap-1">
              <span className="text-[18px] font-bold text-[#FF6B00] tracking-[-0.04em]">{formatCurrency(stats.totalValue * vatMult)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content */}
      {tab === 'rg' ? (
        <RgInventoryTab />
      ) : tab === 'trends' ? (
        <TrendsTab />
      ) : tab === 'forecast' ? (
        <ForecastTab />
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
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#F2F4F6]">
              <span className="text-[12px] text-[#B0B8C1]">
                헤더 드래그로 컬럼 순서 변경 · 클릭으로 정렬
                {vatOn && <span className="ml-2 text-[#3182F6] font-semibold">· VAT 포함 표시 중</span>}
              </span>
              <RowHeightButtons value={whRowH} onChange={setWhRowH} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-[#F2F4F6] bg-[#F8F9FB]">
                    {whColOrder.map((col) => (
                      <th
                        key={col}
                        draggable={col !== 'adjust'}
                        onDragStart={() => col !== 'adjust' && onWhDragStart(col)}
                        onDragOver={(e) => col !== 'adjust' && onWhDragOver(e, col)}
                        onDragLeave={onWhDragLeave}
                        onDrop={() => col !== 'adjust' && onWhDrop(col)}
                        onClick={() => toggleWhSort(col)}
                        className={whThCls(col)}
                      >
                        <div className={`flex items-center gap-1 py-3 ${whSort?.col === col ? 'text-[#3182F6]' : ''}`}>
                          {col !== 'adjust' && <GripVertical className="h-3 w-3 opacity-20 group-hover:opacity-60 shrink-0 transition-opacity" />}
                          {col === 'cost'
                            ? `원가 (VAT${vatOn ? '+10%' : ' 별도'})`
                            : col === 'value'
                            ? `재고가치 (VAT${vatOn ? '+10%' : ' 별도'})`
                            : WH_LABELS[col]}
                          {col !== 'adjust' && <SortIcon active={whSort?.col === col} dir={whSort?.dir ?? 'asc'} />}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                {loading ? (
                  <tbody><tr><td colSpan={whColOrder.length} className="h-64 text-center"><Loader2 className="h-6 w-6 animate-spin text-[#3182F6] mx-auto" /></td></tr></tbody>
                ) : whSorted.length === 0 ? (
                  <tbody><tr><td colSpan={whColOrder.length}>
                    <div className="flex flex-col items-center justify-center py-16">
                      <div className="w-14 h-14 rounded-2xl bg-[#F2F4F6] flex items-center justify-center mb-3">
                        <WarehouseIcon className="h-6 w-6 text-[#B0B8C1]" />
                      </div>
                      <p className="text-[13px] font-medium text-[#6B7684]">재고 데이터가 없습니다</p>
                      <button onClick={() => setEntryOpen(true)} className="mt-4 flex items-center gap-2 h-10 px-4 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] transition-colors">
                        <Plus className="h-4 w-4" /> 재고 기입
                      </button>
                    </div>
                  </td></tr></tbody>
                ) : (
                  <tbody className="divide-y divide-[#F2F4F6]">
                    {whSorted.map((item) => {
                      const isLow = item.quantity <= (item.sku?.reorder_point ?? 0);
                      const isWarn = !isLow && item.quantity <= (item.sku?.safety_stock ?? 0) * 2;
                      return (
                        <tr key={item.id} className={`hover:bg-[#FAFAFA] transition-colors ${isLow ? 'bg-red-50/40' : isWarn ? 'bg-amber-50/40' : ''}`}>
                          {whColOrder.map((col) => renderWhCell(col, item))}
                        </tr>
                      );
                    })}
                  </tbody>
                )}
              </table>
            </div>
            {whSorted.length > 0 && (
              <div className="flex items-center justify-between px-5 py-3 bg-[#F8F9FB] border-t border-[#F2F4F6]">
                <span className="text-[12px] text-[#6B7684]">총 {formatNumber(whSorted.length)}건</span>
                <span className="text-[13px] font-semibold text-[#191F28]">
                  합계 {formatCurrency(whSorted.reduce((s, i) => s + i.quantity * (i.sku?.cost_price ?? 0), 0) * vatMult)}
                  {vatOn && <span className="text-[11px] text-[#3182F6] ml-1">(VAT포함)</span>}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      <AdjustDialog open={!!adjustItem} onClose={() => setAdjustItem(null)} item={adjustItem} onSave={handleAdjusted} />
      <EntryDialog open={entryOpen} onClose={() => setEntryOpen(false)} onSave={() => { setEntryOpen(false); loadInventory(); }} />
      <CsvImportDialog open={csvImportOpen} onClose={() => setCsvImportOpen(false)} onSave={() => { setCsvImportOpen(false); loadInventory(); }} />
    </div>
  );
}
