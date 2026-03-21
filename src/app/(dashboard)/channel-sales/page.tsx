'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatNumber, formatCurrency, formatDate, skuOptionLabel } from '@/lib/utils';
import type { ChannelSale } from '@/types';
import {
  ShoppingCart, Plus, Upload, X, Loader2, ChevronDown, AlertCircle, CheckCircle2, Trash2, Clock,
  RefreshCw, RotateCcw,
} from 'lucide-react';
import OrdersTab from '@/components/channel-sales/OrdersTab';
import OrdersChartTab from '@/components/channel-sales/OrdersChartTab';

// ─── Constants ──────────────────────────────────────────────────────────────

const CHANNELS = [
  { value: 'all',            label: '전체' },
  { value: 'smartstore',     label: '스마트스토어' },
  { value: 'toss',           label: '토스' },
  { value: 'coupang_direct', label: '쿠팡직접' },
  { value: 'other',          label: '기타' },
] as const;

const CHANNEL_BADGE: Record<string, { label: string; cls: string }> = {
  smartstore:     { label: '스마트스토어', cls: 'bg-green-50 text-green-700' },
  toss:           { label: '토스',         cls: 'bg-blue-50 text-blue-700' },
  coupang_direct: { label: '쿠팡직접',     cls: 'bg-yellow-50 text-yellow-700' },
  other:          { label: '기타',         cls: 'bg-[#F2F4F6] text-[#6B7684]' },
};

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

const TODAY_DATE = new Date().toISOString().slice(0, 10);

function resolvePlatformName(sku: any, channel: string): string | null {
  if (!sku?.platform_skus?.length) return null;
  const channelType = channel === 'coupang_direct' ? 'coupang' : channel;
  const match = sku.platform_skus.find((ps: any) => ps.channel?.type === channelType);
  return match?.platform_product_name ?? null;
}

// ─── Dialog wrapper ─────────────────────────────────────────────────────────

function Dialog({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full mx-4 max-h-[90vh] overflow-y-auto ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
          <h2 className="text-[15px] font-bold text-[#191F28]">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6] transition-colors">
            <X className="h-4 w-4 text-[#6B7684]" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

const inputCls = 'w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors';
const selectCls = `${inputCls} bg-white`;

// ─── Manual Add Dialog ───────────────────────────────────────────────────────

interface SkuFlat { id: string; label: string; product_name: string; option_label: string; }

function AddDialog({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: (s: ChannelSale) => void;
}) {
  const [skus, setSkus] = useState<SkuFlat[]>([]);
  const [form, setForm] = useState({
    channel: 'smartstore', sku_id: '', product_name: '', option_name: '',
    quantity: '', revenue: '', sale_date: TODAY_DATE,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm({ channel: 'smartstore', sku_id: '', product_name: '', option_name: '', quantity: '', revenue: '', sale_date: TODAY_DATE });
    setError('');
    fetch('/api/products').then((r) => r.json()).then((products: any[]) => {
      const flat: SkuFlat[] = (products ?? []).flatMap((p) =>
        (p.skus ?? []).map((s: any) => {
          const opt = skuOptionLabel(s.option_values ?? {});
          return { id: s.id, label: `${p.name}${opt ? ' · ' + opt : ''} (${s.sku_code})`, product_name: p.name, option_label: opt };
        })
      );
      setSkus(flat);
    });
  }, [open]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function handleSkuSelect(skuId: string) {
    const sku = skus.find((s) => s.id === skuId);
    setForm((f) => ({
      ...f,
      sku_id: skuId,
      product_name: sku?.product_name ?? f.product_name,
      option_name: sku?.option_label ?? f.option_name,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.product_name.trim()) { setError('상품명을 입력하세요.'); return; }
    if (!Number(form.quantity)) { setError('수량을 입력하세요.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/channel-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: form.channel,
          sku_id: form.sku_id || null,
          product_name: form.product_name.trim(),
          option_name: form.option_name.trim() || null,
          quantity: Number(form.quantity),
          revenue: Number(form.revenue) || 0,
          sale_date: form.sale_date,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const data = await res.json();
      onSaved(data);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="판매 수동 추가">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-[#191F28]">채널 *</label>
          <select value={form.channel} onChange={(e) => set('channel', e.target.value)} className={selectCls}>
            {CHANNELS.filter((c) => c.value !== 'all').map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-[#191F28]">SKU 연결 <span className="text-[#B0B8C1] font-normal">(선택)</span></label>
          <select value={form.sku_id} onChange={(e) => handleSkuSelect(e.target.value)} className={selectCls}>
            <option value="">SKU 선택 (선택사항)</option>
            {skus.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">상품명 *</label>
            <input className={inputCls} value={form.product_name} onChange={(e) => set('product_name', e.target.value)} placeholder="상품명" required />
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">옵션</label>
            <input className={inputCls} value={form.option_name} onChange={(e) => set('option_name', e.target.value)} placeholder="색상, 사이즈 등" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">수량 *</label>
            <input type="number" min="1" className={inputCls} value={form.quantity} onChange={(e) => set('quantity', e.target.value)} placeholder="0" required />
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">매출액 <span className="text-[#B0B8C1] font-normal">(원)</span></label>
            <input type="number" min="0" className={inputCls} value={form.revenue} onChange={(e) => set('revenue', e.target.value)} placeholder="0" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-[#191F28]">판매일 *</label>
          <input type="date" className={inputCls} value={form.sale_date} onChange={(e) => set('sale_date', e.target.value)} required />
        </div>
        {error && <p className="text-[13px] text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">취소</button>
          <button type="submit" disabled={loading} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} 저장
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Upload Dialog ───────────────────────────────────────────────────────────

interface ParsedRow {
  product_name: string; option_name: string; quantity: number; revenue: number;
  sku_id?: string; matched: boolean;
  row_channel?: string;  // per-row channel (쿠팡 판매방식에서 자동 분류)
}

interface BatchRecord {
  batch_id: string;
  period_start: string;
  period_end: string;
  row_count: number;
  uploaded_at: string;
  channels: string[];
}

const SELLING_TYPE_CHANNEL: Record<string, string> = {
  '로켓그로스': 'coupang_direct',
  '판매자배송': 'other',
};

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return `${d}일 전`;
}

function doOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart <= bEnd && aEnd >= bStart;
}

function UploadDialog({ open, onClose, onUploaded }: {
  open: boolean; onClose: () => void; onUploaded: (count: number) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [channel, setChannel] = useState('smartstore');
  const [dateFrom, setDateFrom] = useState(yesterday());
  const [dateTo, setDateTo] = useState(yesterday());
  const [headers, setHeaders] = useState<string[]>([]);
  const [nameCol, setNameCol] = useState('');
  const [qtyCol, setQtyCol] = useState('');
  const [optCol, setOptCol] = useState('');
  const [revCol, setRevCol] = useState('');
  const [wayCol, setWayCol] = useState('');
  const [isCoupang, setIsCoupang] = useState(false);
  const [rawRows, setRawRows] = useState<Record<string, any>[]>([]);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [skuMap, setSkuMap] = useState<Map<string, string>>(new Map());
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [deletingBatch, setDeletingBatch] = useState<string | null>(null);
  const [skuOptions, setSkuOptions] = useState<{ id: string; label: string; sku_code: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  // 정확히 같은 기간이 이미 있는 배치 (덮어쓰기 대상)
  const normalizedTo = dateTo === dateFrom ? dateFrom : dateTo;
  const exactMatchBatch = batches.find(
    (b) => b.period_start === dateFrom && b.period_end === normalizedTo,
  ) ?? null;

  useEffect(() => {
    if (!open) {
      setStep(1); setHeaders([]); setRawRows([]); setParsedRows([]);
      setError(''); setIsCoupang(false); setConfirmOverwrite(false);
    } else {
      fetch('/api/channel-sales/batches')
        .then((r) => r.json())
        .then((d) => setBatches(Array.isArray(d) ? d : []));
    }
  }, [open]);

  // A: 마지막 업로드 종료일 + 1일을 시작일로 자동 제안 (최초 1회)
  useEffect(() => {
    if (!batches.length) return;
    const latest = batches.reduce((max, b) => b.period_end > max.period_end ? b : max);
    const next = new Date(latest.period_end + 'T00:00:00');
    next.setDate(next.getDate() + 1);
    const suggested = next.toISOString().slice(0, 10);
    const yest = yesterday();
    if (suggested <= yest) {
      setDateFrom(suggested);
      setDateTo(yest);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches]); // batches 첫 로드 시 1회만 실행

  useEffect(() => {
    if (!open) return;
    Promise.all([
      fetch('/api/products').then((r) => r.json()),
      fetch('/api/sku-aliases').then((r) => r.json()),
    ]).then(([products, aliases]: [any[], any[]]) => {
      const map = new Map<string, string>();
      const opts: { id: string; label: string; sku_code: string }[] = [];
      for (const p of products ?? []) {
        for (const s of p.skus ?? []) {
          map.set(p.name.trim().toLowerCase(), s.id);
          const optLabel = skuOptionLabel(s.option_values ?? {});
          opts.push({ id: s.id, sku_code: s.sku_code, label: `${p.name}${optLabel ? ' · ' + optLabel : ''} (${s.sku_code})` });
        }
      }
      // 마스터 별칭도 map에 추가 (채널 상품명 → sku_id)
      for (const a of aliases ?? []) {
        map.set(a.channel_name.trim().toLowerCase(), a.sku_id);
      }
      setSkuMap(map);
      setSkuOptions(opts);
    });
  }, [open]);

  async function handleDeleteBatch(batchId: string) {
    setDeletingBatch(batchId);
    await fetch(`/api/channel-sales/batches?batch_id=${batchId}`, { method: 'DELETE' });
    setBatches((prev) => prev.filter((b) => b.batch_id !== batchId));
    setDeletingBatch(null);
    onUploaded(0); // refresh main list
  }

  function manualMatchSku(rowIdx: number, skuId: string) {
    const row = parsedRows[rowIdx];
    setParsedRows((prev) => prev.map((r, i) => i === rowIdx ? { ...r, sku_id: skuId || undefined, matched: !!skuId } : r));
    // 마스터 별칭 자동 저장 - 다음 업로드 시 자동 매칭
    if (skuId && row?.product_name) {
      fetch('/api/sku-aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_name: row.product_name, sku_id: skuId }),
      });
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, any>[];
      if (!json.length) { setError('파일에 데이터가 없습니다.'); return; }
      const hdrs = Object.keys(json[0]);
      setHeaders(hdrs);
      setRawRows(json);
      const findCol = (keywords: string[]) => hdrs.find((h) => keywords.some((k) => h.toLowerCase().includes(k))) ?? '';
      const detectedName = findCol(['상품명', '상품 명', 'product']);
      const detectedQty  = findCol(['판매량', '판매수량', '수량', '주문수량', 'qty', 'quantity']);
      const detectedOpt  = findCol(['옵션명', '옵션', 'option']);
      const detectedRev  = findCol(['매출(원)', '매출', '판매금액', '결제금액', '정산금액', 'revenue', '금액']);
      const detectedWay  = findCol(['판매방식']);
      setNameCol(detectedName);
      setQtyCol(detectedQty);
      setOptCol(detectedOpt);
      setRevCol(detectedRev);
      setWayCol(detectedWay);
      // 쿠팡 파일 자동 감지
      const coupang = hdrs.includes('옵션 ID') || hdrs.includes('등록상품ID') || !!detectedWay;
      setIsCoupang(coupang);
      if (coupang) setChannel('coupang_direct');
      setStep(2);
    } catch {
      setError('파일을 읽을 수 없습니다. xlsx 또는 xls 파일을 선택하세요.');
    }
    e.target.value = '';
  }

  useEffect(() => {
    if (!rawRows.length || !nameCol || !qtyCol) return;
    const rows: ParsedRow[] = rawRows.map((row) => {
      const product_name = String(row[nameCol] ?? '').trim();
      const quantity = parseInt(String(row[qtyCol] ?? '0').replace(/,/g, ''), 10) || 0;
      const revenue = revCol ? parseInt(String(row[revCol] ?? '0').replace(/,/g, ''), 10) || 0 : 0;

      // 옵션 추출 - 쿠팡은 "상품명, 옵션1, 옵션2" 형식이므로 상품명 제거
      let option_name = optCol ? String(row[optCol] ?? '').trim() : '';
      if (option_name && product_name && option_name.startsWith(product_name)) {
        option_name = option_name.slice(product_name.length).replace(/^[,\s]+/, '').trim();
        // "One size" 는 의미 없으므로 제거
        if (option_name === 'One size' || option_name === 'One Size') option_name = '';
      }

      // 쿠팡 판매방식에서 채널 자동 분류
      const sellingType = wayCol ? String(row[wayCol] ?? '').trim() : '';
      const row_channel = sellingType ? (SELLING_TYPE_CHANNEL[sellingType] ?? 'other') : undefined;

      const sku_id = skuMap.get(product_name.toLowerCase());
      return { product_name, option_name, quantity, revenue, sku_id, matched: !!sku_id, row_channel };
    }).filter((r) => r.product_name && r.quantity > 0);
    setParsedRows(rows);
  }, [rawRows, nameCol, qtyCol, optCol, revCol, wayCol, skuMap]);

  async function handleUpload(deleteFirst = false) {
    if (!parsedRows.length) { setError('업로드할 데이터가 없습니다.'); return; }

    // B: 완전 동일 기간이고 아직 확인 전 → 확인 UI 표시
    if (exactMatchBatch && !deleteFirst && !confirmOverwrite) {
      setConfirmOverwrite(true);
      return;
    }

    setLoading(true); setError('');
    try {
      // B: 덮어쓰기 확인 후 → 기존 배치 먼저 삭제
      if ((deleteFirst || confirmOverwrite) && exactMatchBatch) {
        await fetch(`/api/channel-sales/batches?batch_id=${exactMatchBatch.batch_id}`, { method: 'DELETE' });
      }

      const res = await fetch('/api/channel-sales/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          sale_date: dateFrom,
          sale_date_end: dateTo !== dateFrom ? dateTo : undefined,
          records: parsedRows.map((r) => ({
            channel: r.row_channel,
            sku_id: r.sku_id,
            product_name: r.product_name,
            option_name: r.option_name || null,
            quantity: r.quantity,
            revenue: r.revenue,
          })),
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const d = await res.json();
      onUploaded(d.inserted ?? 0);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally { setLoading(false); setConfirmOverwrite(false); }
  }

  // 채널별 집계
  const channelStats = parsedRows.reduce<Record<string, { count: number; qty: number }>>((acc, r) => {
    const ch = r.row_channel ?? channel;
    if (!acc[ch]) acc[ch] = { count: 0, qty: 0 };
    acc[ch].count++;
    acc[ch].qty += r.quantity;
    return acc;
  }, {});

  return (
    <Dialog open={open} onClose={onClose} title="엑셀 업로드" wide>
      {step === 1 ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">판매 채널 *</label>
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className={selectCls}>
              {CHANNELS.filter((c) => c.value !== 'all').map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">판매 기간 *</label>
            <div className="flex items-center gap-2">
              <input type="date" className={inputCls} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <span className="text-[13px] text-[#6B7684] shrink-0">~</span>
              <input type="date" className={inputCls} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <p className="text-[11px] text-[#B0B8C1]">엑셀 파일에 날짜가 없으므로 업로드 시 직접 지정합니다.</p>
          </div>

          {/* 최근 업로드 이력 */}
          {batches.length > 0 && (() => {
            const overlapping = batches.filter((b) => dateFrom && dateTo && doOverlap(dateFrom, dateTo, b.period_start, b.period_end));
            return (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-[#6B7684]" />
                  <p className="text-[13px] font-semibold text-[#191F28]">최근 업로드 이력</p>
                  {overlapping.length > 0 && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                      {overlapping.length}건 기간 겹침
                    </span>
                  )}
                </div>
                <div className="border border-[#F2F4F6] rounded-xl overflow-hidden divide-y divide-[#F2F4F6]">
                  {batches.slice(0, 8).map((b) => {
                    const isOverlap = dateFrom && dateTo && doOverlap(dateFrom, dateTo, b.period_start, b.period_end);
                    const periodLabel = b.period_start === b.period_end
                      ? formatDate(b.period_start)
                      : `${formatDate(b.period_start)} ~ ${formatDate(b.period_end)}`;
                    return (
                      <div key={b.batch_id} className={`flex items-center justify-between px-3.5 py-2.5 ${isOverlap ? 'bg-amber-50' : ''}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          {isOverlap && <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                          <div className="min-w-0">
                            <span className="text-[13px] font-medium text-[#191F28]">{periodLabel}</span>
                            <span className="ml-2 text-[12px] text-[#6B7684]">{b.row_count}건</span>
                            {isOverlap && <span className="ml-2 text-[11px] font-semibold text-amber-600">기간 겹침 — 중복 주의</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-[#B0B8C1]">{relativeTime(b.uploaded_at)}</span>
                          <button
                            onClick={() => handleDeleteBatch(b.batch_id)}
                            disabled={deletingBatch === b.batch_id}
                            title="이 배치 전체 삭제"
                            className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-50 text-[#B0B8C1] hover:text-red-500 transition-colors disabled:opacity-40"
                          >
                            {deletingBatch === b.batch_id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {overlapping.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
                    <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[13px] font-semibold text-amber-800">중복 업로드 주의</p>
                      <p className="text-[12px] text-amber-700 mt-0.5">
                        선택한 기간과 겹치는 이전 업로드가 있습니다. 계속 진행하면 판매량이 중복 집계됩니다.
                        기존 데이터를 먼저 <strong>삭제(휴지통)</strong>한 뒤 업로드하세요.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-[#191F28]">파일 선택 *</label>
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-[#E5E8EB] rounded-xl cursor-pointer hover:border-[#3182F6] hover:bg-[#EBF1FE]/30 transition-colors">
              <Upload className="h-6 w-6 text-[#B0B8C1] mb-2" />
              <span className="text-[13px] text-[#6B7684]">xlsx / xls 파일을 선택하세요</span>
              <span className="text-[11px] text-[#B0B8C1] mt-0.5">쿠팡, 스마트스토어, 토스 판매내역 지원</span>
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
            </label>
          </div>
          {error && <p className="text-[13px] text-red-500 flex items-center gap-1.5"><AlertCircle className="h-4 w-4" />{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {/* 쿠팡 파일 감지 알림 */}
          {isCoupang && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-yellow-800">쿠팡 Seller Insights 파일 감지됨</p>
                <p className="text-[12px] text-yellow-700 mt-0.5">판매방식에 따라 자동 분류됩니다: 로켓그로스 → 쿠팡직접 / 판매자배송 → 기타</p>
              </div>
            </div>
          )}

          {/* Column mapping */}
          <div className="bg-[#F8F9FB] rounded-xl p-4 space-y-3">
            <p className="text-[13px] font-semibold text-[#191F28]">컬럼 매핑</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: '상품명 컬럼 *', val: nameCol, set: setNameCol },
                { label: '수량 컬럼 *',   val: qtyCol,  set: setQtyCol },
                { label: '옵션 컬럼',     val: optCol,  set: setOptCol },
                { label: '매출액 컬럼',   val: revCol,  set: setRevCol },
              ].map(({ label, val, set: setter }) => (
                <div key={label} className="space-y-1">
                  <label className="text-[12px] font-medium text-[#6B7684]">{label}</label>
                  <select value={val} onChange={(e) => setter(e.target.value)}
                    className="w-full h-10 px-2.5 rounded-lg border border-[#E5E8EB] text-[13px] bg-white focus:outline-none focus:border-[#3182F6]">
                    <option value="">선택 안 함</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* 채널별 집계 (쿠팡 자동분류) */}
          {isCoupang && Object.keys(channelStats).length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {Object.entries(channelStats).map(([ch, stat]) => {
                const badge = CHANNEL_BADGE[ch] ?? CHANNEL_BADGE.other;
                return (
                  <div key={ch} className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${ch === 'coupang_direct' ? 'border-yellow-200 bg-yellow-50' : 'border-[#E5E8EB] bg-[#F8F9FB]'}`}>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                    <span className="text-[12px] font-medium text-[#191F28]">{stat.count}건 · {formatNumber(stat.qty)}개</span>
                    {ch === 'coupang_direct' && <span className="text-[11px] text-yellow-700">쿠팡재고 차감</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Preview */}
          {parsedRows.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[13px] font-semibold text-[#191F28]">미리보기</p>
                <div className="flex items-center gap-3 text-[12px] text-[#6B7684]">
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> SKU매칭 {parsedRows.filter((r) => r.matched).length}</span>
                  <span className="flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5 text-amber-500" /> 미매칭 {parsedRows.filter((r) => !r.matched).length}</span>
                  <span className="font-medium text-[#191F28]">총 {parsedRows.length}건</span>
                </div>
              </div>
              <div className="border border-[#F2F4F6] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                <div className="grid grid-cols-[1.8fr_1.2fr_0.7fr_1fr_1fr_1.8fr] gap-2 px-3 py-2 bg-[#F8F9FB] border-b border-[#F2F4F6]">
                  {['상품명', '옵션', '수량', '매출액', '채널', 'SKU 연결'].map((h) => (
                    <span key={h} className="text-[11px] font-semibold text-[#6B7684]">{h}</span>
                  ))}
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-[#F2F4F6]">
                  {parsedRows.map((r, i) => {
                    const ch = r.row_channel ?? channel;
                    const badge = CHANNEL_BADGE[ch] ?? CHANNEL_BADGE.other;
                    const matchedSku = r.sku_id ? skuOptions.find((s) => s.id === r.sku_id) : null;
                    return (
                      <div key={i} className={`grid grid-cols-[1.8fr_1.2fr_0.7fr_1fr_1fr_1.8fr] gap-2 px-3 py-2 items-center ${!r.matched ? 'bg-amber-50/40' : ''}`}>
                        <span className="text-[12px] text-[#191F28] truncate">{r.product_name}</span>
                        <span className="text-[12px] text-[#6B7684] truncate">{r.option_name || '-'}</span>
                        <span className="text-[12px] font-semibold text-[#191F28]">{formatNumber(r.quantity)}</span>
                        <span className="text-[12px] text-[#6B7684]">{r.revenue ? formatCurrency(r.revenue) : '-'}</span>
                        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full w-fit ${badge.cls}`}>{badge.label}</span>
                        {/* SKU 매칭 셀 */}
                        {r.matched && matchedSku ? (
                          <div className="flex items-center gap-1 min-w-0">
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                            <span className="text-[11px] text-green-700 font-mono truncate">{matchedSku.sku_code}</span>
                          </div>
                        ) : (
                          <select
                            value={r.sku_id ?? ''}
                            onChange={(e) => manualMatchSku(i, e.target.value)}
                            className="w-full h-8 px-1.5 rounded-lg border border-amber-300 bg-white text-[11px] text-[#191F28] focus:outline-none focus:border-[#3182F6] transition-colors"
                          >
                            <option value="">SKU 선택...</option>
                            {skuOptions.map((s) => (
                              <option key={s.id} value={s.id}>{s.label}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
                </div>
                </div>
              </div>
              <p className="text-[11px] text-[#B0B8C1] mt-1.5">주황 행 = 자동 매칭 실패. 드롭다운으로 직접 SKU를 선택하세요.</p>
            </div>
          )}

          {error && <p className="text-[13px] text-red-500 flex items-center gap-1.5"><AlertCircle className="h-4 w-4" />{error}</p>}

          {/* B: 완전 동일 기간 덮어쓰기 확인 */}
          {confirmOverwrite && exactMatchBatch && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3.5 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[13px] font-semibold text-amber-800">동일 기간 데이터가 이미 있습니다</p>
                  <p className="text-[12px] text-amber-700 mt-0.5">
                    {formatDate(exactMatchBatch.period_start)}
                    {exactMatchBatch.period_end !== exactMatchBatch.period_start && ` ~ ${formatDate(exactMatchBatch.period_end)}`}
                    {' '}({exactMatchBatch.row_count}건) 데이터를 삭제하고 새 데이터로 교체합니다.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setConfirmOverwrite(false)}
                  className="flex-1 h-10 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-white transition-colors">
                  취소
                </button>
                <button onClick={() => handleUpload(true)} disabled={loading}
                  className="flex-1 h-10 rounded-xl bg-amber-500 text-white text-[13px] font-semibold hover:bg-amber-600 disabled:opacity-60 flex items-center justify-center gap-1.5">
                  {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  덮어쓰기 확인
                </button>
              </div>
            </div>
          )}

          {!confirmOverwrite && (
            <div className="flex gap-2 pt-1">
              <button onClick={() => setStep(1)} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">이전</button>
              <button onClick={() => handleUpload(false)} disabled={loading || !parsedRows.length}
                className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] disabled:opacity-60 flex items-center justify-center gap-2">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                업로드 완료 ({parsedRows.length}건)
              </button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ─── Coupang Sync Dialog ─────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysAgoStr(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── Seller Insights Upload Dialog ──────────────────────────────────────────

function InsightsUploadDialog({ open, onClose, onDone }: {
  open: boolean; onClose: () => void; onDone: (msg: string) => void;
}) {
  const todayVal = new Date().toISOString().slice(0, 10);
  const sevenAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(sevenAgo);
  const [endDate, setEndDate] = useState(todayVal);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const days = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1);
  const period: '7d' | '30d' = days <= 10 ? '7d' : '30d';

  async function handleUpload() {
    if (!file) return;
    if (new Date(endDate) < new Date(startDate)) { setError('종료일이 시작일보다 앞입니다.'); return; }
    setLoading(true); setResult(null); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('period', period);
      fd.append('days', String(days));
      const res = await fetch('/api/coupang/import-insights', { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? '업로드 실패');
      setResult(d);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full mx-4 max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
          <h2 className="text-[15px] font-bold text-[#191F28]">셀러 인사이트 업로드</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6]">
            <X className="h-4 w-4 text-[#6B7684]" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="bg-[#EBF1FE] rounded-xl px-4 py-3 text-[12px] text-[#3182F6] space-y-1">
            <p className="font-semibold">Wing &gt; 셀러 인사이트 &gt; 상품 성과 &gt; 기간 선택 후 다운로드</p>
            <p>다운로드한 VENDOR_ITEM_METRICS Excel 파일을 업로드하면 SKU별 판매량이 자동 업데이트됩니다.</p>
          </div>
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-[#191F28]">보고서 기간</label>
            <div className="flex items-center gap-2">
              <input type="date" value={startDate} max={endDate}
                onChange={(e) => { setStartDate(e.target.value); setResult(null); }}
                className="flex-1 h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] focus:outline-none focus:border-[#3182F6]" />
              <span className="text-[13px] text-[#B0B8C1]">~</span>
              <input type="date" value={endDate} min={startDate}
                onChange={(e) => { setEndDate(e.target.value); setResult(null); }}
                className="flex-1 h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] focus:outline-none focus:border-[#3182F6]" />
            </div>
            <p className="text-[12px] text-[#6B7684]">
              {days}일 기간 · <span className="font-medium text-[#3182F6]">{period === '7d' ? '7일 판매량' : '30일 판매량'}</span> 필드 업데이트
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-[#191F28]">Excel 파일 *</label>
            <label className="flex items-center justify-center gap-2 h-24 border-2 border-dashed border-[#E5E8EB] rounded-xl cursor-pointer hover:border-[#3182F6] hover:bg-[#F8FAFF] transition-colors">
              <input type="file" accept=".xlsx,.xls" className="sr-only"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
              {file ? (
                <p className="text-[13px] font-medium text-[#3182F6]">{file.name}</p>
              ) : (
                <p className="text-[13px] text-[#B0B8C1]">클릭하여 파일 선택 (.xlsx)</p>
              )}
            </label>
          </div>
          {error && <p className="text-[12px] text-red-500">{error}</p>}
          {result && (
            <div className="bg-[#F0FDF4] rounded-xl px-4 py-3 space-y-1">
              <p className="text-[13px] font-semibold text-green-700">SKU {result.updated}개 업데이트 완료</p>
              {result.return_count > 0 && (
                <p className="text-[12px] text-blue-600">반품재판매 {result.return_count}건 제외됨 (재고예측 미반영)</p>
              )}
              {result.unmatched_count > 0 && (
                <>
                  <p className="text-[12px] text-amber-600">미매칭 {result.unmatched_count}건 — 마스터 시트 &gt; 상품명 별칭에 등록하면 다음에 자동 매칭됩니다</p>
                  <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                    {result.unmatched.map((u: any, i: number) => (
                      <p key={i} className="text-[11px] text-[#6B7684]">· {u.optionName} ({u.qty}개)</p>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {result ? (
            <button onClick={() => onDone(`셀러 인사이트 업로드 완료 · ${result.days}일 기간 · SKU ${result.updated}개 판매량 업데이트 (미매칭 ${result.unmatched_count}건)`)}
              className="flex items-center justify-center gap-2 w-full h-11 rounded-xl bg-green-600 text-white text-[13px] font-semibold hover:bg-green-700 transition-colors">
              <CheckCircle2 className="h-4 w-4" /> 확인
            </button>
          ) : (
          <button onClick={handleUpload} disabled={!file || loading}
            className="flex items-center justify-center gap-2 w-full h-11 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {loading ? '처리 중...' : '업로드 및 판매량 업데이트'}
          </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Coupang Sync Dialog ─────────────────────────────────────────────────────

function CoupangSyncDialog({ open, onClose, onDone }: {
  open: boolean; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [from, setFrom] = useState(daysAgoStr(7));
  const [to, setTo] = useState(todayStr());
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function handleSync() {
    setSyncing(true);
    setResult(null);
    setError('');
    try {
      // 1) 주문 동기화
      const ordersRes = await fetch('/api/coupang/sync-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });

      const oData = await ordersRes.json();
      if (!ordersRes.ok) throw new Error(oData.error ?? '주문 동기화 실패');

      // 2) 판매량 집계 + SKU 매칭 (자동)
      const calcRes = await fetch('/api/coupang/calc-sales', { method: 'POST' });
      const calcData = await calcRes.json();

      const msg = `주문 ${oData.synced}건 동기화 · SKU ${calcData.updated}개 판매량 업데이트${oData.errors?.length ? ` (경고 ${oData.errors.length}건)` : ''}${calcData.unmatched > 0 ? ` · 미매칭 ${calcData.unmatched}건` : ''}`;
      setResult(msg);
      onDone(msg);
    } catch (err: any) {
      setError(err.message ?? '오류가 발생했습니다');
    }
    setSyncing(false);
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full mx-4 max-w-md">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
          <h2 className="text-[15px] font-bold text-[#191F28]">쿠팡 그로스 데이터 동기화</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6]">
            <X className="h-4 w-4 text-[#6B7684]" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="bg-[#EBF1FE] rounded-xl px-4 py-3 text-[12px] text-[#3182F6]">
            선택 기간의 주문 + 반품 데이터를 쿠팡 Open API에서 가져옵니다.
            중복 주문은 자동으로 건너뜁니다.
          </div>
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-[#191F28]">기간</label>
            <div className="flex items-center gap-2">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="flex-1 h-11 px-3 rounded-xl border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10" />
              <span className="text-[#B0B8C1]">~</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="flex-1 h-11 px-3 rounded-xl border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10" />
            </div>
          </div>
          {error && <p className="text-[12px] text-red-500">{error}</p>}
          {result && <p className="text-[12px] text-green-600 font-medium">{result}</p>}
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center justify-center gap-2 w-full h-11 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncing ? '동기화 중...' : '동기화 시작'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Naver Sync Dialog ───────────────────────────────────────────────────────

function NaverSyncDialog({ open, onClose, onDone }: {
  open: boolean; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [from, setFrom] = useState(daysAgoStr(7));
  const [to, setTo]     = useState(todayStr());
  const [syncing, setSyncing] = useState(false);
  const [result, setResult]   = useState<string | null>(null);
  const [error, setError]     = useState('');

  async function handleSync() {
    setSyncing(true); setResult(null); setError('');
    try {
      const res = await fetch('/api/naver/sync-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? '동기화 실패');
      const msg = `네이버 주문 ${d.synced}건 동기화 완료${d.skipped ? ` (중복 ${d.skipped}건 제외)` : ''}`;
      setResult(msg);
      onDone(msg);
    } catch (err: any) {
      setError(err.message ?? '오류가 발생했습니다');
    }
    setSyncing(false);
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full mx-4 max-w-md">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
          <h2 className="text-[15px] font-bold text-[#191F28]">네이버 스마트스토어 동기화</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6]">
            <X className="h-4 w-4 text-[#6B7684]" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="bg-[#F0FDF4] rounded-xl px-4 py-3 text-[12px] text-green-700">
            선택 기간의 주문 데이터를 네이버 커머스 API에서 가져옵니다. 중복 주문은 자동으로 건너뜁니다.
          </div>
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-[#191F28]">기간</label>
            <div className="flex items-center gap-2">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="flex-1 h-11 px-3 rounded-xl border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6]" />
              <span className="text-[#B0B8C1]">~</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="flex-1 h-11 px-3 rounded-xl border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6]" />
            </div>
          </div>
          {error  && <p className="text-[12px] text-red-500">{error}</p>}
          {result && <p className="text-[12px] text-green-600 font-medium">{result}</p>}
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center justify-center gap-2 w-full h-11 rounded-xl bg-green-600 text-white text-[13px] font-semibold hover:bg-green-700 transition-colors disabled:opacity-60">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncing ? '동기화 중...' : '동기화 시작'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Toss Sync Dialog ────────────────────────────────────────────────────────

function TossSyncDialog({ open, onClose, onDone }: {
  open: boolean; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [from, setFrom] = useState(daysAgoStr(7));
  const [to, setTo]     = useState(todayStr());
  const [syncing, setSyncing] = useState(false);
  const [result, setResult]   = useState<string | null>(null);
  const [error, setError]     = useState('');

  async function handleSync() {
    setSyncing(true); setResult(null); setError('');
    try {
      const res = await fetch('/api/toss/sync-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? '동기화 실패');
      const msg = `토스 주문 ${d.synced}건 동기화 완료${d.skipped ? ` (중복 ${d.skipped}건 제외)` : ''}`;
      setResult(msg);
      onDone(msg);
    } catch (err: any) {
      setError(err.message ?? '오류가 발생했습니다');
    }
    setSyncing(false);
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full mx-4 max-w-md">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
          <h2 className="text-[15px] font-bold text-[#191F28]">토스쇼핑 동기화</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6]">
            <X className="h-4 w-4 text-[#6B7684]" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="bg-[#F0F4FF] rounded-xl px-4 py-3 text-[12px] text-blue-700">
            선택 기간의 주문 데이터를 토스쇼핑 API에서 가져옵니다. 최대 31일 범위.
          </div>
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-[#191F28]">기간</label>
            <div className="flex items-center gap-2">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="flex-1 h-11 px-3 rounded-xl border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6]" />
              <span className="text-[#B0B8C1]">~</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="flex-1 h-11 px-3 rounded-xl border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6]" />
            </div>
          </div>
          {error  && <p className="text-[12px] text-red-500">{error}</p>}
          {result && <p className="text-[12px] text-blue-600 font-medium">{result}</p>}
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center justify-center gap-2 w-full h-11 rounded-xl bg-blue-600 text-white text-[13px] font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncing ? '동기화 중...' : '동기화 시작'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Returns Tab ─────────────────────────────────────────────────────────────

interface ChannelReturn {
  id: string;
  channel: string;
  returned_at: string;
  product_name: string;
  option_name: string | null;
  quantity: number;
  return_reason: string | null;
  return_type: string | null;
  status: string | null;
  order_number: string | null;
  sku_id: string | null;
  sku?: { id: string; sku_code: string; product: { name: string } } | null;
}

const RETURN_CHANNELS = [
  { value: 'all',         label: '전체' },
  { value: 'smartstore',  label: '스마트스토어' },
  { value: 'toss',        label: '토스' },
  { value: 'coupang',     label: '쿠팡' },
] as const;

const RETURN_CHANNEL_BADGE: Record<string, { label: string; cls: string }> = {
  smartstore: { label: '스마트스토어', cls: 'bg-green-50 text-green-700' },
  toss:       { label: '토스',         cls: 'bg-blue-50 text-blue-700' },
  coupang:    { label: '쿠팡',         cls: 'bg-yellow-50 text-yellow-700' },
};

const RETURN_STATUS_LABELS: Record<string, string> = {
  CANCEL_REQUEST:     '취소요청',
  CANCEL_DONE:        '취소완료',
  REFUND_REQUEST:     '반품요청',
  REFUND_PROCESSING:  '반품처리중',
  REFUND_DONE:        '반품완료',
  RETURN_REQUEST:     '반품요청',
  RETURN_PROCESSING:  '반품처리중',
  RETURN_DONE:        '반품완료',
};

function ReturnsTab() {
  const [returns, setReturns] = useState<ChannelReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [ch, setCh] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to)   params.set('to', to);
    if (q)    params.set('q', q);
    if (ch !== 'all') params.set('channel', ch);
    const data = await fetch(`/api/channel-returns?${params}`).then((r) => r.json());
    setReturns(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [from, to, q, ch]);

  useEffect(() => { load(); }, [load]);

  const totalQty = returns.reduce((a, r) => a + r.quantity, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        {/* 채널 필터 */}
        <div className="flex gap-1.5">
          {RETURN_CHANNELS.map((c) => (
            <button key={c.value} onClick={() => setCh(c.value)}
              className={`h-8 px-3 rounded-xl text-[12px] font-medium transition-colors ${ch === c.value ? 'bg-[#3182F6] text-white' : 'bg-white border border-[#E5E8EB] text-[#6B7684] hover:bg-[#F2F4F6]'}`}>
              {c.label}
            </button>
          ))}
        </div>
        {/* 날짜 */}
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6]" />
          <span className="text-[#B0B8C1] text-[13px]">~</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6]" />
          {(from || to) && (
            <button onClick={() => { setFrom(''); setTo(''); }}
              className="h-10 w-9 flex items-center justify-center rounded-xl border border-[#E5E8EB] hover:bg-[#F2F4F6]">
              <X className="h-4 w-4 text-[#6B7684]" />
            </button>
          )}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="상품명 검색"
          className="h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6] w-48" />
      </div>

      {returns.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="bg-white rounded-xl px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex items-center gap-3">
            <span className="text-[12px] text-[#6B7684]">반품/취소 건수</span>
            <span className="text-[15px] font-bold text-[#191F28]">{formatNumber(returns.length)}건</span>
          </div>
          <div className="bg-white rounded-xl px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex items-center gap-3">
            <span className="text-[12px] text-[#6B7684]">수량</span>
            <span className="text-[15px] font-bold text-[#191F28]">{formatNumber(totalQty)}개</span>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" />
          </div>
        ) : returns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <RotateCcw className="h-8 w-8 text-[#D0D5DD] mb-3" />
            <p className="text-[13px] font-medium text-[#6B7684]">반품/취소 데이터가 없습니다</p>
            <p className="text-[12px] text-[#B0B8C1] mt-1">우측 상단에서 채널별 동기화를 실행하세요</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8F9FB] border-b border-[#F2F4F6]">
                  {['반품일', '채널', '상품명', '수량', '반품사유', '유형', '상태'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[12px] font-semibold text-[#6B7684] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F4F6]">
                {returns.map((r) => {
                  const badge = RETURN_CHANNEL_BADGE[r.channel] ?? { label: r.channel, cls: 'bg-[#F2F4F6] text-[#6B7684]' };
                  return (
                    <tr key={r.id} className="hover:bg-[#FAFAFA] transition-colors">
                      <td className="px-4 py-3 text-[13px] text-[#191F28] whitespace-nowrap">{formatDate(r.returned_at)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-medium text-[#191F28]">{r.product_name}</p>
                        {r.sku && (
                          <p className="text-[11px] text-[#B0B8C1] font-mono mt-0.5">{r.sku.sku_code}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[13px] font-semibold text-[#191F28] tabular-nums">{formatNumber(r.quantity)}</td>
                      <td className="px-4 py-3 text-[13px] text-[#6B7684] max-w-[160px] truncate">{r.return_reason ?? '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-lg text-[11px] font-medium ${
                          (r.return_type ?? '').includes('CANCEL') ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                        }`}>
                          {(r.return_type ?? '').includes('CANCEL') ? '취소' : '반품'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-[#6B7684]">
                        {RETURN_STATUS_LABELS[r.status ?? ''] ?? r.status ?? '-'}
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

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ChannelSalesPage() {
  const [viewMode, setViewMode] = useState<'sales' | 'orders' | 'chart' | 'returns'>('orders');
  const [sales, setSales] = useState<ChannelSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [syncOpen, setSyncOpen]       = useState(false);
  const [naverOpen, setNaverOpen]     = useState(false);
  const [tossOpen, setTossOpen]       = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [toast, setToast] = useState('');

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (channel !== 'all') params.set('channel', channel);
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    const data = await fetch(`/api/channel-sales?${params}`).then((r) => r.json());
    setSales(data ?? []);
    setLoading(false);
  }, [channel, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const totalQty = sales.reduce((s, r) => s + r.quantity, 0);
  const totalRevenue = sales.reduce((s, r) => s + (r.revenue ?? 0), 0);
  const channelBreakdown = CHANNELS.filter((c) => c.value !== 'all').map((c) => ({
    ...c,
    qty: sales.filter((s) => s.channel === c.value).reduce((a, s) => a + s.quantity, 0),
  })).filter((c) => c.qty > 0);

  return (
    <div className="space-y-5">
      {/* ── 고정 헤더 (탭바 항상 동일 위치) ─────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[20px] font-bold tracking-[-0.03em] text-[#191F28]">채널 판매</h2>
          <p className="mt-1 text-[13px] text-[#6B7684]">스마트스토어, 토스, 쿠팡 등 채널별 판매 수량을 기록합니다</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 탭바 — 항상 고정 */}
          <div className="flex items-center gap-1 bg-[#F2F4F6] p-1 rounded-xl">
            {([['sales', '판매 집계'], ['orders', '주문 내역'], ['chart', '주문 분석'], ['returns', '반품']] as const).map(([mode, label]) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                className={`h-8 px-4 rounded-lg text-[13px] font-medium transition-colors ${viewMode === mode ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684] hover:bg-white/60'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* 뷰별 액션 버튼 */}
          {(viewMode === 'orders') && <>
            <button onClick={() => setInsightsOpen(true)}
              className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
              <Upload className="h-4 w-4" /> 인사이트 업로드
            </button>
            <button onClick={() => setNaverOpen(true)}
              className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-green-700 hover:bg-green-50 transition-colors">
              <RefreshCw className="h-4 w-4" /> 네이버 동기화
            </button>
            <button onClick={() => setTossOpen(true)}
              className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-blue-700 hover:bg-blue-50 transition-colors">
              <RefreshCw className="h-4 w-4" /> 토스 동기화
            </button>
            <button onClick={() => setSyncOpen(true)}
              className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
              <RefreshCw className="h-4 w-4" /> 쿠팡 동기화
            </button>
          </>}
          {(viewMode === 'returns') && <>
            <button onClick={() => setNaverOpen(true)}
              className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-green-700 hover:bg-green-50 transition-colors">
              <RefreshCw className="h-4 w-4" /> 네이버 동기화
            </button>
            <button onClick={() => setTossOpen(true)}
              className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-blue-700 hover:bg-blue-50 transition-colors">
              <RefreshCw className="h-4 w-4" /> 토스 동기화
            </button>
            <button onClick={() => setSyncOpen(true)}
              className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
              <RefreshCw className="h-4 w-4" /> 쿠팡 동기화
            </button>
          </>}
          {(viewMode === 'sales') && <>
            <button onClick={() => setSyncOpen(true)}
              className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
              <RefreshCw className="h-4 w-4" /> 쿠팡 동기화
            </button>
            <button onClick={() => setAddOpen(true)}
              className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
              <Plus className="h-4 w-4" /> 수동 추가
            </button>
            <button onClick={() => setUploadOpen(true)}
              className="flex items-center gap-2 h-10 px-4 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] transition-colors">
              <Upload className="h-4 w-4" /> 엑셀 업로드
            </button>
          </>}
        </div>
      </div>

      {/* ── 콘텐츠 ───────────────────────────────────────────────────────── */}
      {viewMode === 'orders' && <OrdersTab />}
      {viewMode === 'chart'  && <OrdersChartTab />}
      {viewMode === 'returns' && <ReturnsTab />}

      {/* ── 판매 집계 콘텐츠 ─────────────────────────────────────────────── */}
      {viewMode === 'sales' && <>

      {/* Stats */}
      {sales.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="bg-white rounded-xl px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex items-center gap-3">
            <span className="text-[12px] text-[#6B7684]">총 판매 수량</span>
            <span className="text-[15px] font-bold text-[#191F28]">{formatNumber(totalQty)}개</span>
          </div>
          {totalRevenue > 0 && (
            <div className="bg-white rounded-xl px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex items-center gap-3">
              <span className="text-[12px] text-[#6B7684]">총 매출</span>
              <span className="text-[15px] font-bold text-[#191F28]">{formatCurrency(totalRevenue)}</span>
            </div>
          )}
          {channelBreakdown.map((c) => (
            <div key={c.value} className="bg-white rounded-xl px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex items-center gap-2">
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${CHANNEL_BADGE[c.value]?.cls}`}>{c.label}</span>
              <span className="text-[13px] font-bold text-[#191F28]">{formatNumber(c.qty)}개</span>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-2">
          {CHANNELS.map((c) => (
            <button key={c.value} onClick={() => setChannel(c.value)}
              className={`h-8 px-3.5 rounded-xl text-[13px] font-medium transition-colors ${channel === c.value ? 'bg-[#3182F6] text-white' : 'bg-white border border-[#E5E8EB] text-[#6B7684] hover:bg-[#F2F4F6]'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] focus:outline-none focus:border-[#3182F6] transition-colors" />
          <span className="text-[13px] text-[#B0B8C1]">~</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] focus:outline-none focus:border-[#3182F6] transition-colors" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="h-10 w-9 flex items-center justify-center rounded-xl border border-[#E5E8EB] hover:bg-[#F2F4F6] transition-colors">
              <X className="h-4 w-4 text-[#6B7684]" />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="overflow-x-auto">
        <div className="min-w-[580px]">
        <div className="grid grid-cols-[1fr_1.5fr_2fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b border-[#F2F4F6] bg-[#F8F9FB]">
          {['판매일', '채널', '상품', '옵션', '수량', '매출액'].map((h) => (
            <span key={h} className="text-[12px] font-semibold text-[#6B7684]">{h}</span>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[#3182F6]" />
          </div>
        ) : sales.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <ShoppingCart className="h-10 w-10 text-[#B0B8C1] mb-3" />
            <p className="text-[13px] font-medium text-[#6B7684]">판매 내역이 없습니다</p>
            <p className="text-[13px] text-[#B0B8C1] mt-1">엑셀 업로드 또는 수동 추가로 시작하세요</p>
          </div>
        ) : (
          <div className="divide-y divide-[#F2F4F6]">
            {sales.map((s) => {
              const badge = CHANNEL_BADGE[s.channel] ?? CHANNEL_BADGE.other;
              return (
                <div key={s.id} className="grid grid-cols-[1fr_1.5fr_2fr_1fr_1fr_1fr] gap-3 px-5 py-3.5 items-center hover:bg-[#FAFAFA] transition-colors">
                  <span className="text-[13px] text-[#6B7684]">{formatDate(s.sale_date)}{s.sale_date_end && s.sale_date_end !== s.sale_date ? ` ~ ${formatDate(s.sale_date_end)}` : ''}</span>
                  <span className={`inline-flex items-center w-fit text-[11px] font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                  <div className="min-w-0">
                    {s.sku ? (() => {
                      const platformName = resolvePlatformName(s.sku, s.channel);
                      const displayName = platformName ?? (s.sku as any).product?.name ?? s.product_name;
                      return (
                        <>
                          <p className="text-[13px] font-medium text-[#191F28] truncate">{displayName}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[11px] text-[#3182F6] font-mono">{s.sku.sku_code}</span>
                            {s.product_name !== displayName && (
                              <span className="text-[11px] text-[#B0B8C1] truncate max-w-[120px]" title={s.product_name}>{s.product_name}</span>
                            )}
                          </div>
                        </>
                      );
                    })() : (
                      <p className="text-[13px] font-medium text-[#191F28] truncate">{s.product_name}</p>
                    )}
                  </div>
                  <span className="text-[13px] text-[#6B7684] truncate">{s.option_name ?? '-'}</span>
                  <span className="text-[13px] font-semibold text-[#191F28] tabular-nums">{formatNumber(s.quantity)}</span>
                  <span className="text-[13px] text-[#6B7684] tabular-nums">{s.revenue ? formatCurrency(s.revenue) : '-'}</span>
                </div>
              );
            })}
          </div>
        )}

        {sales.length > 0 && (
          <div className="flex items-center justify-between px-5 py-3 bg-[#F8F9FB] border-t border-[#F2F4F6]">
            <span className="text-[12px] text-[#6B7684]">총 {formatNumber(sales.length)}건</span>
            <div className="flex items-center gap-4">
              <span className="text-[13px] text-[#6B7684]">합계 {formatNumber(totalQty)}개</span>
              {totalRevenue > 0 && <span className="text-[13px] font-semibold text-[#191F28]">{formatCurrency(totalRevenue)}</span>}
            </div>
          </div>
        )}
        </div>
        </div>
      </div>
      </>}

      {/* Dialogs — outside viewMode conditional so they work from any tab */}
      <AddDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={(s) => { setSales((p) => [s, ...p]); showToast('판매 내역이 추가되었습니다.'); }} />
      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={(n) => { load(); showToast(`${n}건이 업로드되었습니다.`); }} />
      <NaverSyncDialog open={naverOpen} onClose={() => setNaverOpen(false)} onDone={(msg) => { showToast(msg); setNaverOpen(false); load(); }} />
      <TossSyncDialog open={tossOpen} onClose={() => setTossOpen(false)} onDone={(msg) => { showToast(msg); setTossOpen(false); }} />
      <CoupangSyncDialog open={syncOpen} onClose={() => setSyncOpen(false)} onDone={(msg) => { showToast(msg); setSyncOpen(false); load(); }} />

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#191F28] text-white text-[13px] font-medium px-5 py-3 rounded-2xl shadow-lg z-50 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-400" /> {toast}
        </div>
      )}
    </div>
  );
}
