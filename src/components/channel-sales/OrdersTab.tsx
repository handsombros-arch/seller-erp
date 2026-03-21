'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { formatNumber, formatCurrency, formatDate } from '@/lib/utils';
import {
  Upload, X, Download, AlertCircle, CheckCircle2, Loader2,
  MapPin, SlidersHorizontal, Search, Trash2,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChannelOrder {
  id: string; channel: string; order_date: string;
  product_name: string; option_name: string | null;
  order_number: string | null; recipient: string | null;
  buyer_phone: string | null;
  quantity: number; shipping_cost: number; orig_shipping: number;
  jeju_surcharge: boolean; tracking_number: string | null;
  order_status: string | null; claim_status: string | null; claim_type: string | null; address: string | null;
  created_at: string;
  sku?: { id: string; sku_code: string; option_values: Record<string, string>; product: { name: string }; platform_skus: { platform_product_name: string; channel: { type: string } | null }[] } | null;
}

interface ParsedOrderRow {
  order_date: string; product_name: string; option_name: string;
  order_number: string; recipient: string; quantity: number;
  shipping_cost: number; orig_shipping: number; jeju_surcharge: boolean;
  tracking_number: string; order_status: string; address: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const JEJU_KEYWORDS = ['제주특별자치도', '제주도', '제주시', '서귀포', '제주 ', '도서산간', '울릉', '독도'];
const JEJU_SURCHARGE = 3000;

const ALL_COLS = [
  { key: 'order_date',      label: '주문일자' },
  { key: 'product_name',    label: '상품명' },
  { key: 'master_name',     label: '관리용 상품명' },
  { key: 'option_name',     label: '옵션명' },
  { key: 'order_number',    label: '주문번호' },
  { key: 'recipient',       label: '수하인명' },
  { key: 'quantity',        label: '수량' },
  { key: 'shipping_cost',   label: '택배운임' },
  { key: 'tracking_number', label: '송장번호' },
  { key: 'order_status',    label: '주문상태' },
] as const;

type ColKey = (typeof ALL_COLS)[number]['key'];

function isRemoteArea(addr: string) {
  return JEJU_KEYWORDS.some((k) => addr.includes(k));
}

function parseDateStr(v: string): string {
  if (!v) return '';
  const s = String(v).trim();
  // Excel numeric date (days since 1900-01-01)
  if (/^\d{5,6}$/.test(s)) {
    const d = new Date((Number(s) - 25569) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  // YYYY-MM-DD or YYYY/MM/DD or YYYYMMDD
  const m = s.match(/(\d{4})[-./]?(\d{2})[-./]?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s.slice(0, 10);
}

const CLAIM_LABEL: Record<string, { label: string; cls: string }> = {
  CANCEL_REQUEST:   { label: '취소요청',  cls: 'bg-yellow-100 text-yellow-700' },
  CANCELED:         { label: '취소완료',  cls: 'bg-gray-100 text-gray-500' },
  RETURN_REQUEST:   { label: '반품요청',  cls: 'bg-orange-100 text-orange-600' },
  RETURNED:         { label: '반품완료',  cls: 'bg-red-100 text-red-600' },
  EXCHANGE_REQUEST: { label: '교환요청',  cls: 'bg-purple-100 text-purple-600' },
  EXCHANGED:        { label: '교환완료',  cls: 'bg-purple-100 text-purple-500' },
};

const inputCls = 'h-9 px-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] focus:outline-none focus:border-[#3182F6] transition-colors bg-white';
const selectCls = inputCls + ' pr-8';

// ─── Upload Dialog ────────────────────────────────────────────────────────────

function OrderUploadDialog({ open, channel, onClose, onUploaded }: {
  open: boolean; channel: string;
  onClose: () => void; onUploaded: (n: number) => void;
}) {
  const [rows, setRows] = useState<ParsedOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [colMap, setColMap] = useState<Record<string, string>>({});
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, any>[]>([]);
  const skuLogisticsRef = useRef<Map<string, number>>(new Map()); // productName.lower → logistics_cost

  useEffect(() => {
    if (!open) { setRows([]); setError(''); setHeaders([]); setRawRows([]); return; }
    // 상품별 물류비(logistics_cost) 로드
    fetch('/api/products').then((r) => r.json()).then((products: any[]) => {
      const map = new Map<string, number>();
      for (const p of products ?? []) {
        const pname = (p.name ?? '').toLowerCase();
        if (!pname) continue;
        const maxCost = (p.skus ?? []).reduce((mx: number, s: any) => Math.max(mx, s.logistics_cost ?? 0), 0);
        if (maxCost > 0) map.set(pname, maxCost);
      }
      skuLogisticsRef.current = map;
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, any>[];
      if (!json.length) { setError('데이터가 없습니다.'); return; }
      const hdrs = Object.keys(json[0]);
      setHeaders(hdrs);
      setRawRows(json);

      const findCol = (kws: string[]) => hdrs.find((h) => kws.some((k) => h.includes(k))) ?? '';
      const cm: Record<string, string> = {
        order_date:      findCol(['주문일자', '결제일자', '주문일', '결제일']),
        product_name:    findCol(['상품명', '상품 명']),
        option_name:     findCol(['옵션명', '옵션정보', '옵션']),
        order_number:    findCol(['주문번호', '주문 번호']),
        recipient:       findCol(['수하인', '수취인', '받는 분', '받는분', '수령인']),
        quantity:        findCol(['수량', '주문수량', '주문 수량']),
        shipping_cost:   findCol(['택배운임', '배송비', '택배비', '배송료', '운임']),
        tracking_number: findCol(['송장번호', '운송장번호', '송장']),
        order_status:    findCol(['주문상태', '처리상태', '배송상태', '상태']),
        address:         findCol(['수취인주소', '배송지', '배송주소', '주소', '수령인주소']),
      };
      setColMap(cm);
      parseRows(json, cm);
    } catch {
      setError('파일을 읽을 수 없습니다. xlsx, xls, csv 파일을 선택하세요.');
    }
    e.target.value = '';
  }

  function parseRows(raw: Record<string, any>[], cm: Record<string, string>) {
    const parsed: ParsedOrderRow[] = raw.map((row) => {
      const product_name = String(row[cm.product_name] ?? '').trim();
      const qty = parseInt(String(row[cm.quantity] ?? '1').replace(/,/g, ''), 10) || 1;
      // 상품별 물류비 조회 (SKU 상품명이 CSV 상품명에 포함되면 매칭)
      const pnLower = product_name.toLowerCase();
      let origShip = 0;
      for (const [name, cost] of skuLogisticsRef.current) {
        if (pnLower.includes(name)) { origShip = cost; break; }
      }
      const addr = String(row[cm.address] ?? '').trim();
      const jeju = addr ? isRemoteArea(addr) : false;
      const shipping_cost = origShip + (jeju ? JEJU_SURCHARGE : 0);

      return {
        order_date:      parseDateStr(String(row[cm.order_date] ?? '')),
        product_name,
        option_name:     String(row[cm.option_name] ?? '').trim(),
        order_number:    String(row[cm.order_number] ?? '').trim(),
        recipient:       String(row[cm.recipient] ?? '').trim(),
        quantity:        qty,
        shipping_cost,
        orig_shipping:   origShip,
        jeju_surcharge:  jeju,
        tracking_number: String(row[cm.tracking_number] ?? '').trim(),
        order_status:    String(row[cm.order_status] ?? '').trim(),
        address:         addr,
      };
    }).filter((r) => r.product_name && r.order_date);

    setRows(parsed);
  }

  // Re-parse when column mapping changes
  useEffect(() => {
    if (rawRows.length && Object.values(colMap).some(Boolean)) parseRows(rawRows, colMap);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colMap]);

  async function handleUpload() {
    if (!rows.length) return;
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/channel-orders/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, records: rows }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const d = await res.json();
      onUploaded(d.inserted ?? 0);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally { setLoading(false); }
  }

  const jejuCount = rows.filter((r) => r.jeju_surcharge).length;
  const totalQty = rows.reduce((s, r) => s + r.quantity, 0);
  const totalShip = rows.reduce((s, r) => s + r.shipping_cost, 0);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
          <h2 className="text-[15px] font-bold text-[#191F28]">주문 엑셀 업로드</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6]">
            <X className="h-4 w-4 text-[#6B7684]" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">

          {/* 양식 다운로드 */}
          <div className="flex items-center justify-between bg-[#F8F9FB] rounded-xl px-4 py-3">
            <div>
              <p className="text-[13px] font-semibold text-[#191F28]">주문일자, 상품명, 옵션명, 주문번호, 수하인명, 수량, 택배운임, 송장번호, 주문상태, 배송주소</p>
              <p className="text-[12px] text-[#6B7684] mt-0.5">배송주소에 <strong>제주/도서산간</strong> 포함 시 택배운임 +3,000원 자동 적용</p>
            </div>
            <a href="/api/csv-template?type=channel-orders" download
              className="flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-[#3182F6] text-[12px] font-semibold text-[#3182F6] hover:bg-[#EBF1FE] transition-colors shrink-0 ml-3">
              <Download className="h-3.5 w-3.5" /> 양식
            </a>
          </div>

          {/* 파일 선택 */}
          {!rows.length && (
            <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-[#E5E8EB] rounded-xl cursor-pointer hover:border-[#3182F6] hover:bg-[#EBF1FE]/30 transition-colors">
              <Upload className="h-5 w-5 text-[#B0B8C1] mb-2" />
              <span className="text-[13px] text-[#6B7684]">xlsx / xls / csv 파일 선택</span>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
            </label>
          )}

          {/* 컬럼 매핑 (파일 로드 후) */}
          {rows.length > 0 && (
            <div className="bg-[#F8F9FB] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-[#191F28]">컬럼 매핑 확인</p>
                <button onClick={() => { setRows([]); setHeaders([]); setRawRows([]); }}
                  className="text-[12px] text-[#6B7684] hover:text-red-500 flex items-center gap-1">
                  <X className="h-3.5 w-3.5" /> 파일 변경
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'order_date', label: '주문일자 *' },
                  { key: 'product_name', label: '상품명 *' },
                  { key: 'option_name', label: '옵션명' },
                  { key: 'order_number', label: '주문번호' },
                  { key: 'recipient', label: '수하인명' },
                  { key: 'quantity', label: '수량' },
                  { key: 'shipping_cost', label: '택배운임' },
                  { key: 'tracking_number', label: '송장번호' },
                  { key: 'order_status', label: '주문상태' },
                  { key: 'address', label: '배송주소 (제주감지)' },
                ].map(({ key, label }) => (
                  <div key={key} className="space-y-0.5">
                    <p className="text-[11px] font-medium text-[#6B7684]">{label}</p>
                    <select value={colMap[key] ?? ''} onChange={(e) => setColMap((prev) => ({ ...prev, [key]: e.target.value }))}
                      className="w-full h-8 px-2 rounded-lg border border-[#E5E8EB] text-[12px] bg-white focus:outline-none focus:border-[#3182F6]">
                      <option value="">선택 안 함</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 제주 할증 & 집계 */}
          {rows.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 px-3 py-2 bg-[#F8F9FB] rounded-xl">
                <span className="text-[12px] text-[#6B7684]">총 주문</span>
                <span className="text-[13px] font-bold text-[#191F28]">{formatNumber(rows.length)}건</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 bg-[#F8F9FB] rounded-xl">
                <span className="text-[12px] text-[#6B7684]">수량 합계</span>
                <span className="text-[13px] font-bold text-[#191F28]">{formatNumber(totalQty)}개</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 bg-[#F8F9FB] rounded-xl">
                <span className="text-[12px] text-[#6B7684]">택배운임 합계</span>
                <span className="text-[13px] font-bold text-[#191F28]">{formatCurrency(totalShip)}</span>
              </div>
              {jejuCount > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 rounded-xl">
                  <MapPin className="h-3.5 w-3.5 text-blue-500" />
                  <span className="text-[12px] text-blue-700 font-medium">제주/도서산간 {jejuCount}건 (+{formatCurrency(jejuCount * JEJU_SURCHARGE)} 할증)</span>
                </div>
              )}
            </div>
          )}

          {/* 미리보기 */}
          {rows.length > 0 && (
            <div>
              <p className="text-[13px] font-semibold text-[#191F28] mb-2">미리보기 (상위 5행)</p>
              <div className="border border-[#F2F4F6] rounded-xl overflow-hidden overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#F8F9FB] border-b border-[#F2F4F6]">
                    <tr>
                      {['주문일자', '상품명', '옵션', '수하인', '수량', '택배운임', '주문상태'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold text-[#6B7684] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F4F6]">
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className={r.jeju_surcharge ? 'bg-blue-50/60' : ''}>
                        <td className="px-3 py-2 text-[12px] text-[#6B7684] whitespace-nowrap">{r.order_date}</td>
                        <td className="px-3 py-2 text-[12px] text-[#191F28] max-w-[120px] truncate">{r.product_name}</td>
                        <td className="px-3 py-2 text-[12px] text-[#6B7684] whitespace-nowrap">{r.option_name || '-'}</td>
                        <td className="px-3 py-2 text-[12px] text-[#191F28] whitespace-nowrap">
                          {r.recipient || '-'}
                          {r.jeju_surcharge && <MapPin className="inline h-3 w-3 text-blue-500 ml-1" />}
                        </td>
                        <td className="px-3 py-2 text-[12px] font-semibold text-[#191F28] whitespace-nowrap">{r.quantity}</td>
                        <td className="px-3 py-2 text-[12px] text-[#191F28] whitespace-nowrap">
                          {formatCurrency(r.shipping_cost)}
                          {r.jeju_surcharge && <span className="text-[11px] text-blue-600 ml-1">(+3,000)</span>}
                        </td>
                        <td className="px-3 py-2 text-[12px] text-[#6B7684] whitespace-nowrap">{r.order_status || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 5 && (
                  <p className="text-center text-[11px] text-[#B0B8C1] py-2 border-t border-[#F2F4F6]">+ {rows.length - 5}행 더</p>
                )}
              </div>
              {jejuCount > 0 && (
                <p className="text-[11px] text-blue-600 mt-1.5 flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> 파란 행 = 제주/도서산간 +3,000원 할증 적용됨
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 bg-red-50 rounded-xl px-4 py-3">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
              <p className="text-[13px] text-red-700">{error}</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">닫기</button>
            <button onClick={handleUpload} disabled={!rows.length || loading}
              className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] disabled:opacity-60 flex items-center justify-center gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              업로드 ({rows.length}건)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Orders Tab ───────────────────────────────────────────────────────────────

const CHANNEL_OPTIONS = [
  { value: 'all',        label: '전체 채널' },
  { value: 'smartstore', label: '스마트스토어' },
  { value: 'toss',       label: '토스' },
  { value: 'coupang',    label: '쿠팡(직배)' },
  { value: 'coupang_rg', label: '쿠팡(그로스)' },
  { value: 'other',      label: '기타' },
];

// platform_skus entry (with sku+product info from API)
interface PlatformSkuEntry {
  sku_id: string;
  channel_id: string;
  platform_product_name: string;
  channel: { id: string; name: string; type: string } | null;
  sku: { id: string; sku_code: string; product: { name: string } } | null;
}

export default function OrdersTab() {
  const [orders, setOrders] = useState<ChannelOrder[]>([]);
  const [allPlatformSkus, setAllPlatformSkus] = useState<PlatformSkuEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [channel, setChannel] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [q, setQ] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [selectedMasterName, setSelectedMasterName] = useState('');
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('orders-visible-cols') : null;
      if (saved) {
        const arr = JSON.parse(saved) as string[];
        const valid = arr.filter((k) => ALL_COLS.some((c) => c.key === k)) as ColKey[];
        if (valid.length) return new Set(valid);
      }
    } catch {}
    return new Set(ALL_COLS.map((c) => c.key));
  });
  const [colPanelOpen, setColPanelOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toast, setToast] = useState('');
  // 교환 처리
  const [exchangeOrder, setExchangeOrder] = useState<ChannelOrder | null>(null);
  const [exchangeSkuId, setExchangeSkuId] = useState('');
  const [exchangeSearch, setExchangeSearch] = useState('');
  const [exchangeLoading, setExchangeLoading] = useState(false);
  const [exchangeProcessed, setExchangeProcessed] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set(JSON.parse(localStorage.getItem('exchange_processed') ?? '[]')); } catch { return new Set(); }
  });
  const [skuOptions, setSkuOptions] = useState<{ id: string; label: string }[]>([]);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>({
    order_date: 90, product_name: 200, master_name: 160, option_name: 140,
    order_number: 160, recipient: 90, quantity: 60, shipping_cost: 90,
    tracking_number: 140, order_status: 110,
  });
  const resizingCol = useRef<{ key: ColKey; startX: number; startWidth: number } | null>(null);
  const colPanelRef = useRef<HTMLDivElement>(null);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000); }

  function handleResizeStart(e: React.MouseEvent, key: ColKey) {
    e.preventDefault();
    resizingCol.current = { key, startX: e.clientX, startWidth: colWidths[key] };
    function onMove(ev: MouseEvent) {
      if (!resizingCol.current) return;
      const delta = ev.clientX - resizingCol.current.startX;
      setColWidths((prev) => ({
        ...prev,
        [resizingCol.current!.key]: Math.max(50, resizingCol.current!.startWidth + delta),
      }));
    }
    function onUp() {
      resizingCol.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // 플랫폼 상품명 맵: platform_product_name+channel_type → master product name
  const platformSkuMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ps of allPlatformSkus) {
      if (ps.platform_product_name && ps.channel?.type && ps.sku?.product?.name) {
        map.set(`${ps.platform_product_name.toLowerCase()}|${ps.channel.type}`, ps.sku.product.name);
      }
    }
    return map;
  }, [allPlatformSkus]);

  function resolveAdminName(o: ChannelOrder): string | null {
    if (o.sku?.product?.name) return o.sku.product.name;
    const channelType = o.channel === 'coupang_direct' ? 'coupang' : o.channel;
    return platformSkuMap.get(`${o.product_name.toLowerCase()}|${channelType}`) ?? null;
  }

  function isExchangeOrder(o: ChannelOrder) {
    const s = (o.claim_status ?? o.order_status ?? '').toUpperCase();
    return s.includes('EXCHANGE') || s.includes('교환');
  }

  async function processExchange() {
    if (!exchangeOrder || !exchangeSkuId) return;
    setExchangeLoading(true);
    try {
      const res = await fetch('/api/inventory/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_number: exchangeOrder.order_number,
          original_sku_id: exchangeOrder.sku?.id,
          replacement_sku_id: exchangeSkuId,
          quantity: exchangeOrder.quantity,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setExchangeProcessed((prev) => {
        const next = new Set(prev);
        next.add(exchangeOrder!.order_number!);
        try { localStorage.setItem('exchange_processed', JSON.stringify([...next])); } catch {}
        return next;
      });
      setToast(`교환 처리 완료: ${exchangeOrder.product_name} → 재고 복구, 교환품 차감`);
      setExchangeOrder(null);
      setExchangeSkuId('');
      setExchangeSearch('');
    } catch (err: any) {
      setToast(`교환 처리 실패: ${err.message}`);
    }
    setExchangeLoading(false);
  }


  useEffect(() => {
    fetch('/api/skus').then(r => r.json()).then((data: any[]) => {
      setSkuOptions((data ?? []).map((s: any) => ({
        id: s.id,
        label: `${s.product?.name ?? ''} · ${s.sku_code}${s.option_values ? ' · ' + Object.values(s.option_values).join('/') : ''}`,
      })));
    }).catch(() => {});
    fetch('/api/platform-skus')
      .then((r) => r.json())
      .then((data) => setAllPlatformSkus(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setApiError('');
    const params = new URLSearchParams();
    if (channel !== 'all') params.set('channel', channel);
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    if (q) params.set('q', q);
    try {
      const res = await fetch(`/api/channel-orders?${params}`);
      const data = await res.json();
      if (!res.ok) { setApiError(data.error ?? '오류가 발생했습니다.'); setOrders([]); }
      else setOrders(Array.isArray(data) ? data : []);
    } catch {
      setApiError('서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, [channel, dateFrom, dateTo, q]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) setColPanelOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 상품명 목록
  const productOptions = [...new Set(
    orders.map((o) => o.product_name).filter(Boolean)
  )].sort() as string[];

  // 관리용 상품명 목록 (sku.product.name 기준)
  const masterNameOptions = [...new Set(
    orders.map((o) => resolveAdminName(o)).filter(Boolean)
  )].sort() as string[];

  // 필터링된 주문
  const filtered = orders.filter((o) => {
    if (selectedStatuses.length && !selectedStatuses.includes(o.order_status ?? '')) return false;
    if (selectedProduct && o.product_name !== selectedProduct) return false;
    if (selectedMasterName && resolveAdminName(o) !== selectedMasterName) return false;
    if (q) {
      const lower = q.toLowerCase();
      const adminName = resolveAdminName(o) ?? '';
      if (
        !o.product_name.toLowerCase().includes(lower) &&
        !adminName.toLowerCase().includes(lower) &&
        !(o.order_number ?? '').includes(q) &&
        !(o.recipient ?? '').includes(q)
      ) return false;
    }
    return true;
  });

  // 집계 합계
  const totalQty   = filtered.reduce((s, o) => s + o.quantity, 0);
  const totalShip  = filtered.reduce((s, o) => s + (o.shipping_cost ?? 0), 0);
  const jejuCount  = filtered.filter((o) => o.jeju_surcharge).length;

  // 주문상태 목록 (실제 데이터에서)
  const statusOptions = [...new Set(orders.map((o) => o.order_status).filter(Boolean))] as string[];

  // 복수 선택 토글
  async function handleClearData() {
    const channelLabel = channel === 'all' ? '전체' : (CHANNEL_OPTIONS.find(c => c.value === channel)?.label ?? channel);
    const first = window.confirm(`[1/2] ${channelLabel} 주문 데이터를 모두 삭제합니다.\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`);
    if (!first) return;
    const second = window.confirm(`[2/2] 정말로 삭제합니다.\n"확인"을 누르면 ${channelLabel} 데이터가 즉시 삭제됩니다.`);
    if (!second) return;

    try {
      const params = channel !== 'all' ? `?channel=${channel}` : '';
      const res = await fetch(`/api/channel-orders${params}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      showToast(`${channelLabel} 주문 데이터 삭제 완료`);
      load();
    } catch (err: any) {
      alert('삭제 실패: ' + err.message);
    }
  }

  function toggleStatus(s: string) {
    setSelectedStatuses((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  function toggleCol(k: ColKey) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      try { localStorage.setItem('orders-visible-cols', JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  // 필터 변경 시 첫 페이지로
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [selectedStatuses, selectedProduct, selectedMasterName, q, channel, dateFrom, dateTo]);

  const visibleColList = ALL_COLS.filter((c) => visibleCols.has(c.key));
  const totalPages = pageSize === 0 ? 1 : Math.ceil(filtered.length / pageSize);
  const paged = pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-[15px] font-bold text-[#191F28]">주문 내역</h3>
          <p className="text-[13px] text-[#6B7684] mt-0.5">스마트스토어, 토스 주문 데이터를 관리합니다</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleClearData}
            className="flex items-center gap-2 h-10 px-4 rounded-xl border border-red-200 text-[13px] font-medium text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 className="h-4 w-4" />
            {channel === 'all' ? '전체 초기화' : `${CHANNEL_OPTIONS.find(c => c.value === channel)?.label ?? channel} 초기화`}
          </button>
          <button onClick={() => setUploadOpen(true)}
            className="flex items-center gap-2 h-10 px-4 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] transition-colors">
            <Upload className="h-4 w-4" /> 엑셀 업로드
          </button>
        </div>
      </div>

      {/* 필터 바 */}
      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-5 py-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 채널 */}
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className={selectCls}>
            {CHANNEL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>

          {/* 날짜 */}
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
          <span className="text-[12px] text-[#B0B8C1]">~</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="h-10 w-9 flex items-center justify-center rounded-xl border border-[#E5E8EB] hover:bg-[#F2F4F6]">
              <X className="h-4 w-4 text-[#6B7684]" />
            </button>
          )}

          {/* 검색 */}
          <div className="relative ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#B0B8C1]" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="상품명, 주문번호, 수하인 검색"
              className="h-10 pl-8 pr-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] focus:outline-none focus:border-[#3182F6] transition-colors w-56"
            />
          </div>

          {/* 컬럼 토글 */}
          <div className="relative" ref={colPanelRef}>
            <button onClick={() => setColPanelOpen((v) => !v)}
              className="h-10 px-3 flex items-center gap-1.5 rounded-xl border border-[#E5E8EB] text-[13px] text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
              <SlidersHorizontal className="h-3.5 w-3.5" /> 컬럼
            </button>
            {colPanelOpen && (
              <div className="absolute right-0 top-11 z-30 bg-white rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] border border-[#F2F4F6] p-3 w-44">
                <p className="text-[12px] font-semibold text-[#6B7684] mb-2">표시 항목</p>
                {ALL_COLS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 py-1.5 cursor-pointer">
                    <input type="checkbox" checked={visibleCols.has(c.key)} onChange={() => toggleCol(c.key)}
                      className="w-3.5 h-3.5 rounded accent-[#3182F6]" />
                    <span className="text-[13px] text-[#191F28]">{c.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 상품명 필터 + 주문상태 필터 */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* 상품명 드롭다운 */}
          {productOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-[#6B7684] shrink-0">상품명:</span>
              <select value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}
                className="h-8 px-2.5 rounded-xl border border-[#E5E8EB] text-[12px] text-[#191F28] bg-white focus:outline-none focus:border-[#3182F6] transition-colors max-w-[200px]">
                <option value="">전체</option>
                {productOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}

          {masterNameOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-[#6B7684] shrink-0">관리용:</span>
              <select value={selectedMasterName} onChange={(e) => setSelectedMasterName(e.target.value)}
                className="h-8 px-2.5 rounded-xl border border-[#E5E8EB] text-[12px] text-[#191F28] bg-white focus:outline-none focus:border-[#3182F6] transition-colors max-w-[200px]">
                <option value="">전체</option>
                {masterNameOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}

          {/* 주문상태 */}
          {statusOptions.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] text-[#6B7684] shrink-0">주문상태:</span>
              {statusOptions.map((s) => (
                <button key={s} onClick={() => toggleStatus(s)}
                  className={`h-7 px-3 rounded-full text-[12px] font-medium transition-colors ${selectedStatuses.includes(s) ? 'bg-[#3182F6] text-white' : 'bg-[#F2F4F6] text-[#6B7684] hover:bg-[#E5E8EB]'}`}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-[#F8F9FB] border-b border-[#F2F4F6]">
                {visibleColList.map((c) => (
                  <th key={c.key} style={{ width: colWidths[c.key], minWidth: colWidths[c.key] }}
                    className={`relative px-4 py-3 text-left text-[12px] font-semibold text-[#6B7684] whitespace-nowrap select-none ${c.key === 'quantity' || c.key === 'shipping_cost' ? 'text-right' : ''}`}>
                    {c.label}
                    <div onMouseDown={(e) => handleResizeStart(e, c.key)}
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center group/resize">
                      <div className="w-[2px] h-4 rounded-full bg-[#D1D5DB] group-hover/resize:bg-[#3182F6] group-hover/resize:h-full transition-all duration-100" />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={visibleColList.length} className="text-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-[#3182F6] mx-auto" />
                </td></tr>
              ) : apiError ? (
                <tr><td colSpan={visibleColList.length} className="text-center py-16">
                  <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
                  <p className="text-[13px] font-medium text-[#6B7684]">데이터를 불러올 수 없습니다</p>
                  <p className="text-[12px] text-red-500 mt-1 font-mono">{apiError}</p>
                  <p className="text-[12px] text-[#B0B8C1] mt-2">Supabase에서 <strong>00013_channel_orders.sql</strong> 마이그레이션을 실행해 주세요.</p>
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={visibleColList.length} className="text-center py-16">
                  <p className="text-[13px] font-medium text-[#6B7684]">주문 내역이 없습니다</p>
                  <p className="text-[13px] text-[#B0B8C1] mt-1">위의 엑셀 업로드 버튼으로 주문 데이터를 불러오세요</p>
                </td></tr>
              ) : (
                paged.map((o) => (
                  <tr key={o.id} className={`border-b border-[#F2F4F6] hover:bg-[#FAFAFA] transition-colors ${o.jeju_surcharge ? 'bg-blue-50/30' : ''}`}>
                    {visibleColList.map((c) => {
                      if (c.key === 'order_date') return (
                        <td key={c.key} className="px-4 py-3 whitespace-nowrap">
                          <span className="text-[13px] text-[#6B7684]">{formatDate(o.order_date)}</span>
                        </td>
                      );
                      if (c.key === 'product_name') return (
                        <td key={c.key} className="px-4 py-3 overflow-hidden">
                          <p className="truncate text-[13px] font-medium text-[#191F28]">{o.product_name}</p>
                          {o.sku && (
                            <span className="truncate text-[11px] font-mono text-[#3182F6] mt-0.5 block">{o.sku.sku_code}</span>
                          )}
                        </td>
                      );
                      if (c.key === 'master_name') {
                        const adminName = resolveAdminName(o);
                        return (
                          <td key={c.key} className="px-4 py-3 overflow-hidden">
                            {adminName
                              ? <div className="truncate text-[13px] text-[#191F28]">{adminName}</div>
                              : <span className="text-[12px] text-[#D0D5DD]">-</span>}
                          </td>
                        );
                      }
                      if (c.key === 'quantity') return (
                        <td key={c.key} className="px-4 py-3 text-right text-[13px] font-semibold text-[#191F28] tabular-nums overflow-hidden">{formatNumber(o.quantity)}</td>
                      );
                      if (c.key === 'shipping_cost') return (
                        <td key={c.key} className="px-4 py-3 text-right tabular-nums overflow-hidden">
                          <div className="truncate">
                            <span className="text-[13px] text-[#191F28]">{formatCurrency(o.shipping_cost)}</span>
                            {o.jeju_surcharge && (
                              <span className="ml-1.5 text-[11px] font-semibold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">+3,000</span>
                            )}
                          </div>
                        </td>
                      );
                      if (c.key === 'order_status') return (
                        <td key={c.key} className="px-4 py-3 overflow-hidden">
                          <div className="flex flex-col gap-1 overflow-hidden">
                            {o.order_status && (
                              <span className="truncate text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#F2F4F6] text-[#6B7684] w-fit max-w-full">{o.order_status}</span>
                            )}
                            {o.claim_status && CLAIM_LABEL[o.claim_status] && (
                              <span className={`truncate text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit max-w-full ${CLAIM_LABEL[o.claim_status].cls}`}>
                                {CLAIM_LABEL[o.claim_status].label}
                              </span>
                            )}
                            {isExchangeOrder(o) && o.sku?.id && (
                              exchangeProcessed.has(o.order_number ?? '') ? (
                                <span className="text-[11px] text-green-600 font-medium">교환 처리됨</span>
                              ) : (
                                <button onClick={() => { setExchangeOrder(o); setExchangeSkuId(''); setExchangeSearch(''); }}
                                  className="text-[11px] text-purple-600 font-semibold hover:underline w-fit">교환 처리</button>
                              )
                            )}
                          </div>
                        </td>
                      );
                      if (c.key === 'recipient') return (
                        <td key={c.key} className="px-4 py-3 overflow-hidden">
                          <div className="truncate text-[13px] text-[#191F28]">
                            {o.recipient || '-'}
                            {o.jeju_surcharge && <MapPin className="inline h-3 w-3 text-blue-500 ml-1 shrink-0" />}
                          </div>
                        </td>
                      );
                      if (c.key === 'tracking_number') return (
                        <td key={c.key} className="px-4 py-3 overflow-hidden">
                          {o.tracking_number
                            ? <a href={`https://www.ilogen.com/web/personal/trace/${o.tracking_number}`} target="_blank" rel="noreferrer"
                                className="truncate block text-[13px] text-[#3182F6] hover:underline font-mono">
                                {o.tracking_number}
                              </a>
                            : <span className="text-[13px] text-[#B0B8C1]">-</span>}
                        </td>
                      );
                      const val = (o as unknown as Record<string, unknown>)[c.key];
                      return (
                        <td key={c.key} className="px-4 py-3 overflow-hidden">
                          <div className="truncate text-[13px] text-[#6B7684]">{val != null ? String(val) : '-'}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>

          </table>
        </div>

        {/* 페이지네이션 */}
        {!loading && !apiError && filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-[#F2F4F6] flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-[#6B7684]">페이지당</span>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="h-8 px-2 rounded-xl border border-[#E5E8EB] text-[12px] text-[#191F28] bg-white focus:outline-none focus:border-[#3182F6]">
                {[20, 50, 100, 200].map((n) => <option key={n} value={n}>{n}개</option>)}
                <option value={0}>전체</option>
              </select>
              <span className="text-[12px] text-[#B0B8C1]">총 {filtered.length}건</span>
            </div>
            {pageSize !== 0 && totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={page === 1}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#E5E8EB] text-[13px] text-[#6B7684] hover:bg-[#F2F4F6] disabled:opacity-30 disabled:cursor-not-allowed">«</button>
                <button onClick={() => setPage((p) => p - 1)} disabled={page === 1}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#E5E8EB] text-[13px] text-[#6B7684] hover:bg-[#F2F4F6] disabled:opacity-30 disabled:cursor-not-allowed">‹</button>
                <span className="text-[12px] text-[#6B7684] px-3">{page} / {totalPages}</span>
                <button onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#E5E8EB] text-[13px] text-[#6B7684] hover:bg-[#F2F4F6] disabled:opacity-30 disabled:cursor-not-allowed">›</button>
                <button onClick={() => setPage(totalPages)} disabled={page >= totalPages}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#E5E8EB] text-[13px] text-[#6B7684] hover:bg-[#F2F4F6] disabled:opacity-30 disabled:cursor-not-allowed">»</button>
              </div>
            )}
          </div>
        )}
      </div>

      <OrderUploadDialog
        open={uploadOpen} channel={channel === 'all' ? 'smartstore' : channel}
        onClose={() => setUploadOpen(false)}
        onUploaded={(n) => { load(); showToast(`${n}건 업로드 완료`); }}
      />

      {/* 플로팅 합계 바 */}
      {filtered.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 bg-white border border-[#E5E8EB] shadow-[0_4px_20px_rgba(0,0,0,0.12)] rounded-2xl px-5 py-3">
          <span className="text-[12px] font-semibold text-[#6B7684]">합계 {formatNumber(filtered.length)}건</span>
          {jejuCount > 0 && <span className="text-[11px] text-blue-600 font-medium">제주 {jejuCount}건</span>}
          <div className="w-px h-4 bg-[#E5E8EB]" />
          <span className="text-[13px] text-[#6B7684]">수량 <span className="font-bold text-[#191F28]">{formatNumber(totalQty)}개</span></span>
          <span className="text-[13px] text-[#6B7684]">택배운임 <span className="font-bold text-[#191F28]">{formatCurrency(totalShip)}</span></span>
        </div>
      )}

      {/* 교환 처리 모달 */}
      {exchangeOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setExchangeOrder(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-96 p-6">
            <h3 className="text-[15px] font-bold text-[#191F28] mb-2">교환 처리</h3>
            <div className="bg-[#F8F9FB] rounded-xl p-3 mb-4 space-y-1">
              <p className="text-[13px] font-medium text-[#191F28]">{exchangeOrder.product_name}</p>
              <p className="text-[12px] text-[#6B7684]">주문번호: {exchangeOrder.order_number}</p>
              <p className="text-[12px] text-[#6B7684]">수량: {exchangeOrder.quantity}개 → 원래 상품 재고 복구됨</p>
            </div>
            <p className="text-[13px] font-medium text-[#191F28] mb-2">교환 발송 상품 선택 (재고 차감)</p>
            <input
              autoFocus
              value={exchangeSearch}
              onChange={(e) => setExchangeSearch(e.target.value)}
              placeholder="상품명 또는 SKU 검색..."
              className="w-full h-10 px-3 text-[13px] border border-[#E5E8EB] rounded-xl outline-none focus:border-[#3182F6] mb-2"
            />
            <div className="max-h-[20rem] overflow-y-auto space-y-0.5 mb-4">
              {skuOptions
                .filter(o => !exchangeSearch || o.label.toLowerCase().includes(exchangeSearch.toLowerCase()))
                .slice(0, 30)
                .map(o => (
                  <button key={o.id} onClick={() => setExchangeSkuId(o.id)}
                    className={`w-full text-left px-3 py-2 text-[12px] rounded-lg transition-colors ${exchangeSkuId === o.id ? 'bg-[#EBF1FE] text-[#3182F6] font-medium' : 'text-[#191F28] hover:bg-[#F2F4F6]'}`}>
                    {o.label}
                  </button>
                ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setExchangeOrder(null)} className="flex-1 h-10 rounded-xl border border-[#E5E8EB] text-[13px] text-[#6B7684]">취소</button>
              <button onClick={processExchange} disabled={!exchangeSkuId || exchangeLoading}
                className="flex-1 h-10 rounded-xl bg-purple-500 text-white text-[13px] font-semibold hover:bg-purple-600 disabled:opacity-60">
                {exchangeLoading ? '처리 중...' : '교환 처리'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-[#191F28] text-white text-[13px] font-medium px-5 py-3 rounded-2xl shadow-lg z-50 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-400" /> {toast}
        </div>
      )}
    </div>
  );
}
