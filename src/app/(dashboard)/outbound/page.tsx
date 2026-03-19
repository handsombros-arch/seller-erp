'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { Plus, Loader2, Package, X, ChevronDown, Edit3, Trash2 } from 'lucide-react';
import { formatNumber, formatCurrency, formatDate, skuOptionLabel } from '@/lib/utils';
import type { OutboundRecord, Sku, Warehouse, Channel } from '@/types';

// ─── Types ───────────────────────────────────────────────────────────────────

type SkuOption = Omit<Sku, 'product'> & {
  product: { id: string; name: string };
};

// 쿠팡그로스 출고 항목 (여러 센터/SKU 동시 등록)
interface CoupangEntry {
  coupang_center: string;
  sku_id: string;
  quantity: string;
  box_count: string;
  arrival_date: string;
}

const TODAY = new Date().toISOString().split('T')[0];
const THIS_MONTH = new Date().toISOString().slice(0, 7);

// ─── SKU Selector ─────────────────────────────────────────────────────────────

function SkuSelector({ skus, value, onChange }: {
  skus: SkuOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = skus.find((s) => s.id === value);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return skus.filter((s) => {
      const name = s.product?.name ?? '';
      const label = `${name} ${s.sku_code} ${skuOptionLabel(s.option_values ?? {})}`.toLowerCase();
      return label.includes(q);
    }).slice(0, 20);
  }, [skus, search]);

  // 외부 클릭 시 닫기
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[#EBF1FE] rounded-xl border border-[#3182F6]/20">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[#191F28] truncate">{selected.product?.name}</p>
          <p className="text-[11.5px] text-[#3182F6]">
            {selected.sku_code}{skuOptionLabel(selected.option_values ?? '') ? ` · ${skuOptionLabel(selected.option_values ?? {})}` : ''}
            {selected.cost_price > 0 && <span className="text-[#6B7684]"> · 원가 {formatCurrency(selected.cost_price)}</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange('')}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-100 text-[#B0B8C1] hover:text-red-500 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          type="text"
          placeholder="상품명 또는 SKU코드 검색..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="w-full h-10 pl-3 pr-8 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors bg-white"
        />
        <ChevronDown className="absolute right-2.5 top-3 h-4 w-4 text-[#B0B8C1] pointer-events-none" />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-white border border-[#E5E8EB] rounded-xl shadow-lg max-h-48 overflow-y-auto">
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { onChange(s.id); setOpen(false); setSearch(''); }}
              className="w-full text-left px-3 py-2.5 hover:bg-[#F2F4F6] transition-colors first:rounded-t-xl last:rounded-b-xl"
            >
              <p className="text-[13px] font-medium text-[#191F28]">{s.product?.name}</p>
              <p className="text-[11.5px] text-[#6B7684]">
                {s.sku_code}{skuOptionLabel(s.option_values ?? '') ? ` · ${skuOptionLabel(s.option_values ?? {})}` : ''}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Dialog ──────────────────────────────────────────────────────────────────

function Dialog({ open, onClose, children }: {
  open: boolean; onClose: () => void; children: React.ReactNode;
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
      <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OutboundPage() {
  const [records, setRecords]   = useState<OutboundRecord[]>([]);
  const [skus, setSkus]         = useState<SkuOption[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading]   = useState(true);
  const [open, setOpen]         = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editTarget, setEditTarget] = useState<OutboundRecord | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState('');

  // 출고 유형
  const [outboundType, setOutboundType] = useState<'coupang_growth' | 'other'>('coupang_growth');

  // 쿠팡그로스 공통 필드
  const [warehouseId, setWarehouseId] = useState('');
  const [outboundDate, setOutboundDate] = useState(TODAY);
  const [note, setNote] = useState('');

  // 쿠팡그로스 항목 (복수)
  const [entries, setEntries] = useState<CoupangEntry[]>([
    { coupang_center: '', sku_id: '', quantity: '', box_count: '', arrival_date: TODAY },
  ]);

  // 기타 출고 단일 폼
  const [otherForm, setOtherForm] = useState({
    sku_id: '', warehouse_id: '', channel_id: '',
    quantity: '', outbound_date: TODAY, note: '',
  });

  async function fetchAll() {
    setLoading(true);
    try {
      const [r, s, w, c] = await Promise.all([
        fetch('/api/outbound').then((res) => res.json()),
        fetch('/api/skus').then((res) => res.json()),
        fetch('/api/settings/warehouses').then((res) => res.json()),
        fetch('/api/settings/channels').then((res) => res.json()),
      ]);
      setRecords(Array.isArray(r) ? r : []);
      setSkus(Array.isArray(s) ? s : []);
      setWarehouses(Array.isArray(w) ? w : []);
      setChannels(Array.isArray(c) ? c : []);
      if (Array.isArray(w) && w.length > 0) setWarehouseId(w[0].id);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchAll(); }, []);

  // ── 쿠팡 항목 조작 ──────────────────────────────────────────────────────────

  function addEntry() {
    setEntries((prev) => [...prev, { coupang_center: '', sku_id: '', quantity: '', box_count: '', arrival_date: TODAY }]);
  }

  function removeEntry(i: number) {
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateEntry(i: number, patch: Partial<CoupangEntry>) {
    setEntries((prev) => prev.map((e, idx) => idx === i ? { ...e, ...patch } : e));
  }

  function handleSkuSelect(i: number, skuId: string) {
    const sku = skus.find((s) => s.id === skuId);
    updateEntry(i, { sku_id: skuId });
    // 이전 센터명 자동 복사 (편의)
    if (i > 0 && !entries[i].coupang_center && entries[i - 1].coupang_center) {
      updateEntry(i, { sku_id: skuId, coupang_center: entries[i - 1].coupang_center });
    }
    void sku;
  }

  // ── 재고 조회 ────────────────────────────────────────────────────────────────

  function getStock(skuId: string, whId: string): number {
    const sku = skus.find((s) => s.id === skuId) as any;
    const inv = (sku?.inventory ?? []).find((i: any) => (i.warehouse?.id ?? i.warehouse_id) === whId);
    return inv?.quantity ?? 0;
  }

  // ── 제출 ────────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError('');

    try {
      if (outboundType === 'coupang_growth') {
        const valid = entries.filter((en) => en.sku_id && Number(en.quantity) > 0);
        if (valid.length === 0) { setSubmitError('출고 항목을 1개 이상 입력하세요.'); return; }

        // 재고 부족 체크
        const overStockItems = valid.filter((en) => Number(en.quantity) > getStock(en.sku_id, warehouseId));
        if (overStockItems.length > 0) {
          const msgs = overStockItems.map((en) => {
            const s = skus.find((x) => x.id === en.sku_id) as any;
            const nm = s?.product?.name ?? en.sku_id;
            return `${nm}: 재고 ${getStock(en.sku_id, warehouseId)}개 < 출고 ${en.quantity}개`;
          }).join('\n');
          if (!window.confirm(`재고 부족!\n${msgs}\n\n계속 진행하시겠습니까?`)) return;
        }

        const results = await Promise.all(valid.map(async (en) => {
          const sku = skus.find((s) => s.id === en.sku_id);
          const res = await fetch('/api/outbound', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sku_id: en.sku_id,
              warehouse_id: warehouseId,
              outbound_type: 'coupang_growth',
              coupang_center: en.coupang_center || null,
              quantity: Number(en.quantity),
              box_count: en.box_count ? Number(en.box_count) : null,
              unit_price: sku?.cost_price ?? null,
              outbound_date: outboundDate,
              arrival_date: en.arrival_date || null,
              note: note || null,
            }),
          });
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            return (d.error || `서버 오류 (${res.status})`) as string;
          }
          return null;
        }));
        const errs = results.filter(Boolean);
        if (errs.length > 0) { setSubmitError(errs[0] as string); return; }
      } else {
        if (!otherForm.sku_id || !otherForm.quantity) { setSubmitError('상품과 수량을 입력하세요.'); return; }
        const whId = otherForm.warehouse_id || warehouseId;
        const stock = getStock(otherForm.sku_id, whId);
        if (Number(otherForm.quantity) > stock) {
          const s = skus.find((x) => x.id === otherForm.sku_id) as any;
          const nm = s?.product?.name ?? otherForm.sku_id;
          if (!window.confirm(`재고 부족!\n${nm}: 재고 ${stock}개 < 출고 ${otherForm.quantity}개\n\n계속 진행하시겠습니까?`)) return;
        }
        const sku = skus.find((s) => s.id === otherForm.sku_id);
        const res = await fetch('/api/outbound', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sku_id: otherForm.sku_id,
            warehouse_id: otherForm.warehouse_id || warehouseId,
            channel_id: otherForm.channel_id || null,
            outbound_type: 'other',
            quantity: Number(otherForm.quantity),
            unit_price: sku?.cost_price ?? null,
            outbound_date: otherForm.outbound_date,
            note: otherForm.note || null,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setSubmitError(d.error || `서버 오류 (${res.status})`);
          return;
        }
      }

      closeForm();
      fetchAll();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  function closeForm() {
    setOpen(false);
    setSubmitError('');
    setOutboundType('coupang_growth');
    setOutboundDate(TODAY);
    setNote('');
    setEntries([{ coupang_center: '', sku_id: '', quantity: '', box_count: '', arrival_date: TODAY }]);
    setOtherForm({ sku_id: '', warehouse_id: '', channel_id: '', quantity: '', outbound_date: TODAY, note: '' });
  }

  // ── 수정 / 삭제 ──────────────────────────────────────────────────────────────

  async function handleDelete(record: OutboundRecord) {
    if (!confirm('이 출고 내역을 삭제하고 재고를 복구할까요?')) return;
    setDeleting(record.id);
    await fetch(`/api/outbound/${record.id}`, { method: 'DELETE' });
    setDeleting(null);
    fetchAll();
  }

  // ── 통계 ─────────────────────────────────────────────────────────────────────

  const coupangMonthly = useMemo(() => {
    const items = records.filter((r) =>
      r.outbound_date?.startsWith(THIS_MONTH) && r.outbound_type === 'coupang_growth'
    );
    return {
      qty:   items.reduce((s, r) => s + r.quantity, 0),
      boxes: items.reduce((s, r) => s + (r.box_count ?? 0), 0),
      count: items.length,
    };
  }, [records]);

  const inputCls = 'w-full h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors bg-white';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-[#191F28]">출고 관리</h1>
          <p className="text-[13.5px] text-[#6B7684] mt-0.5">창고에서 쿠팡 및 판매처로 나가는 출고를 관리합니다</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-[#3182F6] text-white text-[13.5px] font-semibold rounded-xl hover:bg-[#1B64DA] transition-colors"
        >
          <Plus className="w-4 h-4" />
          출고 등록
        </button>
      </div>

      {/* 쿠팡 이번달 통계 */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '쿠팡그로스 이번달 총 수량', value: `${formatNumber(coupangMonthly.qty)}개`, color: 'text-red-600' },
          { label: '이번달 총 박스수',           value: `${formatNumber(coupangMonthly.boxes)}박스`, color: 'text-blue-600' },
          { label: '이번달 출고 횟수',           value: `${formatNumber(coupangMonthly.count)}회`, color: 'text-[#191F28]' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <p className="text-[13px] text-[#6B7684] mb-1">{label}</p>
            <p className={`text-[22px] font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* 출고 목록 */}
      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-[#3182F6]" />
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#B0B8C1]">
            <Package className="w-10 h-10 mb-3" />
            <p className="text-[13.5px]">출고 내역이 없습니다</p>
          </div>
        ) : (
          <div className="divide-y divide-[#F2F4F6]">
            <div className="grid grid-cols-[1fr_1.4fr_80px_70px_100px_90px_72px] gap-3 px-5 py-3 bg-[#F9FAFB]">
              {['센터 / 채널', '상품 / SKU', '수량', '박스', '출고일', '쿠팡도착', ''].map((h, i) => (
                <span key={i} className="text-[12px] font-semibold text-[#6B7684]">{h}</span>
              ))}
            </div>
            {records.map((record) => {
              const productName = (record.sku as { product?: { name?: string } })?.product?.name ?? '-';
              const skuCode     = (record.sku as { sku_code?: string })?.sku_code ?? '';
              const optVals     = (record.sku as { option_values?: Record<string, string> })?.option_values ?? {};
              const isCoupang   = record.outbound_type === 'coupang_growth';
              return (
                <div
                  key={record.id}
                  className="grid grid-cols-[1fr_1.4fr_80px_70px_100px_90px_72px] gap-3 px-5 py-4 hover:bg-[#F9FAFB] transition-colors items-center"
                >
                  {/* 센터 / 채널 */}
                  <div>
                    {isCoupang ? (
                      <p className="text-[13.5px] font-bold text-[#191F28]">
                        {record.coupang_center?.replace(/^쿠팡\s*/i, '') ?? '센터 미지정'}
                      </p>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-lg text-[12px] font-medium bg-gray-100 text-gray-600">
                        {(record.channel as { name?: string })?.name ?? '기타'}
                      </span>
                    )}
                    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-md mt-1 ${isCoupang ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                      {isCoupang ? '쿠팡그로스' : '기타'}
                    </span>
                  </div>

                  {/* 상품 / SKU */}
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[#191F28] truncate">{productName}</p>
                    <p className="text-[11.5px] text-[#B0B8C1] mt-0.5">
                      {skuCode}{skuOptionLabel(optVals) ? ` · ${skuOptionLabel(optVals)}` : ''}
                    </p>
                  </div>

                  <span className="text-[13.5px] font-semibold text-[#191F28]">{formatNumber(record.quantity)}<span className="text-[11px] font-normal text-[#B0B8C1]">개</span></span>
                  <span className="text-[13px] text-[#6B7684]">{record.box_count != null ? `${record.box_count}박스` : '-'}</span>
                  <span className="text-[12.5px] text-[#6B7684]">{formatDate(record.outbound_date)}</span>
                  <span className="text-[12.5px] text-[#6B7684]">{record.arrival_date ? formatDate(record.arrival_date) : '-'}</span>

                  {/* 수정 / 삭제 */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditTarget(record)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#F2F4F6] text-[#B0B8C1] hover:text-[#3182F6] transition-colors"
                      title="수정"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(record)}
                      disabled={deleting === record.id}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-[#B0B8C1] hover:text-red-500 transition-colors disabled:opacity-40"
                      title="삭제 (재고 복구)"
                    >
                      {deleting === record.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 출고 등록 다이얼로그 ─────────────────────────────────────────────── */}
      <Dialog open={open} onClose={closeForm}>
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
          <h2 className="text-[16px] font-bold text-[#191F28]">출고 등록</h2>
          <button onClick={closeForm} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6] transition-colors">
            <X className="h-4 w-4 text-[#6B7684]" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 space-y-5">

            {/* 출고 유형 선택 */}
            <div>
              <label className="block text-[13px] font-medium text-[#191F28] mb-2">출고 유형</label>
              <div className="flex gap-2">
                {([['coupang_growth', '쿠팡 로켓그로스'], ['other', '기타']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setOutboundType(val)}
                    className={`flex-1 h-10 rounded-xl text-[13px] font-medium border transition-colors ${
                      outboundType === val
                        ? 'bg-[#3182F6] text-white border-[#3182F6]'
                        : 'bg-white text-[#6B7684] border-[#E5E8EB] hover:bg-[#F2F4F6]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 쿠팡그로스 폼 ─────────────────────────────────────────────── */}
            {outboundType === 'coupang_growth' && (
              <>
                {/* 공통 필드 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">출발 창고 *</label>
                    <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required className={inputCls}>
                      <option value="">창고 선택</option>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">출고일 *</label>
                    <input type="date" value={outboundDate} onChange={(e) => setOutboundDate(e.target.value)} required className={inputCls} />
                  </div>
                </div>

                {/* 항목 목록 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[13px] font-medium text-[#191F28]">출고 항목 *</label>
                    <button
                      type="button"
                      onClick={addEntry}
                      className="flex items-center gap-1 text-[12.5px] text-[#3182F6] font-medium hover:underline"
                    >
                      <Plus className="h-3.5 w-3.5" /> 항목 추가
                    </button>
                  </div>

                  <div className="space-y-3">
                    {entries.map((en, i) => {
                      return (
                        <div key={i} className="bg-[#F8F9FB] rounded-xl p-3 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] font-semibold text-[#6B7684]">항목 {i + 1}</span>
                            {entries.length > 1 && (
                              <button type="button" onClick={() => removeEntry(i)} className="text-[#B0B8C1] hover:text-red-500 transition-colors">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>

                          {/* 쿠팡센터 (메인) */}
                          <div>
                            <label className="block text-[12px] font-medium text-[#6B7684] mb-1">쿠팡 센터명 *</label>
                            <input
                              type="text"
                              placeholder="예: 쿠팡 군포, 쿠팡 인천2..."
                              value={en.coupang_center}
                              onChange={(e) => updateEntry(i, { coupang_center: e.target.value })}
                              className={inputCls}
                            />
                          </div>

                          {/* SKU */}
                          <div>
                            <label className="block text-[12px] font-medium text-[#6B7684] mb-1">상품 / SKU *</label>
                            <SkuSelector
                              skus={skus}
                              value={en.sku_id}
                              onChange={(id) => handleSkuSelect(i, id)}
                            />
                          </div>

                          {/* 수량 / 박스 / 도착예정일 */}
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[12px] font-medium text-[#6B7684] mb-1">수량 *</label>
                              <input
                                type="number" min="1" placeholder="0"
                                value={en.quantity}
                                onChange={(e) => updateEntry(i, { quantity: e.target.value })}
                                className={inputCls}
                              />
                            </div>
                            <div>
                              <label className="block text-[12px] font-medium text-[#6B7684] mb-1">박스수</label>
                              <input
                                type="number" min="1" placeholder="0"
                                value={en.box_count}
                                onChange={(e) => updateEntry(i, { box_count: e.target.value })}
                                className={inputCls}
                              />
                            </div>
                            <div>
                              <label className="block text-[12px] font-medium text-[#6B7684] mb-1">쿠팡도착 예정</label>
                              <input
                                type="date"
                                value={en.arrival_date}
                                onChange={(e) => updateEntry(i, { arrival_date: e.target.value })}
                                className={inputCls}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 메모 */}
                <div>
                  <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">메모</label>
                  <textarea
                    value={note} onChange={(e) => setNote(e.target.value)}
                    rows={2} placeholder="메모 (선택사항)"
                    className="w-full px-3 py-2 text-[13px] border border-[#E5E8EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6] resize-none"
                  />
                </div>
              </>
            )}

            {/* ── 기타 출고 폼 ──────────────────────────────────────────────── */}
            {outboundType === 'other' && (
              <>
                <div>
                  <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">상품 / SKU *</label>
                  <SkuSelector
                    skus={skus}
                    value={otherForm.sku_id}
                    onChange={(id) => setOtherForm((f) => ({ ...f, sku_id: id }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">창고 *</label>
                    <select value={otherForm.warehouse_id} onChange={(e) => setOtherForm((f) => ({ ...f, warehouse_id: e.target.value }))} className={inputCls}>
                      <option value="">창고 선택</option>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">채널</label>
                    <select value={otherForm.channel_id} onChange={(e) => setOtherForm((f) => ({ ...f, channel_id: e.target.value }))} className={inputCls}>
                      <option value="">채널 선택</option>
                      {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">수량 *</label>
                    <input type="number" min="1" value={otherForm.quantity} onChange={(e) => setOtherForm((f) => ({ ...f, quantity: e.target.value }))} required placeholder="0" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">출고일 *</label>
                    <input type="date" value={otherForm.outbound_date} onChange={(e) => setOtherForm((f) => ({ ...f, outbound_date: e.target.value }))} required className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">메모</label>
                  <textarea
                    value={otherForm.note} onChange={(e) => setOtherForm((f) => ({ ...f, note: e.target.value }))}
                    rows={2} placeholder="메모 (선택사항)"
                    className="w-full px-3 py-2 text-[13px] border border-[#E5E8EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6] resize-none"
                  />
                </div>
              </>
            )}
          </div>

          {submitError && (
            <p className="px-6 pb-2 text-[13px] text-red-500">{submitError}</p>
          )}
          <div className="px-6 pb-6 pt-2 flex gap-2">
            <button type="button" onClick={closeForm} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[13.5px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
              취소
            </button>
            <button type="submit" disabled={submitting} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[13.5px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {outboundType === 'coupang_growth' ? `등록 (${entries.filter(e => e.sku_id && e.quantity).length}건)` : '등록'}
            </button>
          </div>
        </form>
      </Dialog>

      {/* ── 수정 다이얼로그 ─────────────────────────────────────────────────── */}
      {editTarget && (
        <EditDialog
          record={editTarget}
          skus={skus}
          warehouses={warehouses}
          channels={channels}
          inputCls={inputCls}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); fetchAll(); }}
        />
      )}
    </div>
  );
}

// ─── Edit Dialog ──────────────────────────────────────────────────────────────

function EditDialog({ record, skus, warehouses, channels, inputCls, onClose, onSaved }: {
  record: OutboundRecord;
  skus: any[];
  warehouses: Warehouse[];
  channels: Channel[];
  inputCls: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCoupang = record.outbound_type === 'coupang_growth';
  const [form, setForm] = useState({
    coupang_center:  record.coupang_center ?? '',
    sku_id:          record.sku_id,
    warehouse_id:    record.warehouse_id,
    channel_id:      (record as any).channel_id ?? '',
    quantity:        String(record.quantity),
    box_count:       record.box_count != null ? String(record.box_count) : '',
    outbound_date:   record.outbound_date,
    arrival_date:    record.arrival_date ?? '',
    note:            record.note ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.quantity || Number(form.quantity) <= 0) { setError('수량을 입력하세요.'); return; }
    setSaving(true); setError('');
    const body: Record<string, any> = {
      quantity:      Number(form.quantity),
      outbound_date: form.outbound_date,
      note:          form.note || null,
    };
    if (isCoupang) {
      body.coupang_center = form.coupang_center || null;
      body.box_count      = form.box_count ? Number(form.box_count) : null;
      body.arrival_date   = form.arrival_date || null;
    } else {
      body.warehouse_id = form.warehouse_id;
      body.channel_id   = form.channel_id || null;
    }
    const res = await fetch(`/api/outbound/${record.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json(); setError(d.error ?? '오류 발생'); setSaving(false); return; }
    onSaved();
  }

  return (
    <Dialog open onClose={onClose}>
      <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
        <h2 className="text-[16px] font-bold text-[#191F28]">출고 수정</h2>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6] transition-colors">
          <X className="h-4 w-4 text-[#6B7684]" />
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="px-6 py-5 space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F2F4F6] text-[12px] font-medium text-[#6B7684]">
            {isCoupang ? '쿠팡 로켓그로스' : '기타 출고'}
          </div>

          {isCoupang && (
            <div>
              <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">쿠팡 센터명</label>
              <input value={form.coupang_center} onChange={(e) => set('coupang_center', e.target.value)}
                placeholder="예: 쿠팡 군포" className={inputCls} />
            </div>
          )}

          {!isCoupang && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">창고</label>
                <select value={form.warehouse_id} onChange={(e) => set('warehouse_id', e.target.value)} className={inputCls}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">채널</label>
                <select value={form.channel_id} onChange={(e) => set('channel_id', e.target.value)} className={inputCls}>
                  <option value="">채널 선택</option>
                  {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">수량 *</label>
              <input type="number" min="1" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} required className={inputCls} />
            </div>
            {isCoupang && (
              <div>
                <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">박스수</label>
                <input type="number" min="1" value={form.box_count} onChange={(e) => set('box_count', e.target.value)} className={inputCls} />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">출고일 *</label>
              <input type="date" value={form.outbound_date} onChange={(e) => set('outbound_date', e.target.value)} required className={inputCls} />
            </div>
            {isCoupang && (
              <div>
                <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">쿠팡도착 예정</label>
                <input type="date" value={form.arrival_date} onChange={(e) => set('arrival_date', e.target.value)} className={inputCls} />
              </div>
            )}
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">메모</label>
            <textarea value={form.note} onChange={(e) => set('note', e.target.value)} rows={2}
              className="w-full px-3 py-2 text-[13px] border border-[#E5E8EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6] resize-none" />
          </div>

          {error && <p className="text-[13px] text-red-500">{error}</p>}
        </div>

        <div className="px-6 pb-6 pt-2 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[13.5px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
            취소
          </button>
          <button type="submit" disabled={saving} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[13.5px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} 저장
          </button>
        </div>
      </form>
    </Dialog>
  );
}
