'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import Link from 'next/link';
import { formatCurrency, formatNumber, skuOptionLabel } from '@/lib/utils';
import { FileSpreadsheet, Save, Check, Loader2, RefreshCw, Search, Link2, Building2, Plus, Edit2, Trash2, Phone, Mail, Clock, MapPin, Package, Upload, Download, X as XIcon, ChevronDown, ChevronRight, GripVertical, Zap, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Supplier, SupplierAddress } from '@/types';
import CsvImportDialog from '@/components/CsvImportDialog';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Warehouse { id: string; name: string; }
interface Channel { id: string; name: string; type: string; }

interface ChannelEntry {
  name: string; product_id: string; price: string; coupon_discount: string; sku_id_return: string;
  rg_fee_fulfill: string; rg_fee_return: string; rg_fee_restock: string; rg_fee_send: string; rg_fee_packing: string;
}

interface ChannelInfo { id: string; name: string; type: string; }

interface UnifiedRow {
  // From SkuRow
  id: string; // sku_id
  sku_code: string;
  product_name: string;
  option_label: string;
  cost_price: string;
  lead_time_days: string;
  reorder_point: string;
  safety_stock: string;
  supplier_id: string;
  sales_30d: string;
  inventory: Record<string, string>;
  // From PlatformRow
  entries: Record<string, ChannelEntry>;
  // State
  skuDirty: boolean;
  platformDirty: boolean;
  saving: boolean;
  saved: boolean;
  error: string;
}

const EMPTY_ENTRY: ChannelEntry = { name: '', product_id: '', price: '', coupon_discount: '', sku_id_return: '', rg_fee_fulfill: '', rg_fee_return: '', rg_fee_restock: '', rg_fee_send: '', rg_fee_packing: '' };

// ─── Cell Input ─────────────────────────────────────────────────────────────

function NumCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      min="0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="0"
      className="w-full h-10 px-2.5 rounded-lg border border-transparent bg-transparent text-[13px] tabular-nums text-right
        hover:border-[#E5E8EB] hover:bg-white
        focus:outline-none focus:border-[#3182F6] focus:bg-white focus:ring-2 focus:ring-[#3182F6]/10
        transition-all placeholder:text-[#D0D5DD]"
    />
  );
}

function SelectCell({ value, onChange, options, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-10 px-2 rounded-lg border border-transparent bg-transparent text-[13px]
        hover:border-[#E5E8EB] hover:bg-white
        focus:outline-none focus:border-[#3182F6] focus:bg-white focus:ring-2 focus:ring-[#3182F6]/10
        transition-all text-[#191F28]"
    >
      <option value="">{placeholder ?? '–'}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ─── Grade Discount Tab ─────────────────────────────────────────────────────

const GRADES = ['최상', '상', '중', '미개봉'] as const;

function GradeDiscountTab({ skuOptions }: { skuOptions: { id: string; label: string; sku_code: string; product_name: string; option_label: string }[] }) {
  const [data, setData] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [toast, setToast] = useState('');

  async function load() {
    setLoading(true);
    const res = await fetch('/api/sku-grade-discounts');
    const rows: any[] = res.ok ? await res.json() : [];
    const map: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      if (!map[r.sku_id]) map[r.sku_id] = {};
      map[r.sku_id][r.grade] = Number(r.rate);
    }
    setData(map);
    setLoading(false);
    setDirty(false);
  }

  useEffect(() => { load(); }, []);

  function updateRate(skuId: string, grade: string, value: number) {
    setData(prev => ({ ...prev, [skuId]: { ...(prev[skuId] ?? {}), [grade]: value } }));
    setDirty(true);
  }

  async function handleSaveAll() {
    setSaving(true);
    const items: any[] = [];
    for (const [skuId, grades] of Object.entries(data)) {
      for (const [grade, rate] of Object.entries(grades)) {
        if (rate > 0) items.push({ sku_id: skuId, grade, rate });
      }
    }
    await fetch('/api/sku-grade-discounts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    setSaving(false);
    setDirty(false);
    setToast('저장 완료'); setTimeout(() => setToast(''), 2000);
  }

  const filtered = q
    ? skuOptions.filter(s => `${s.product_name} ${s.sku_code} ${s.option_label}`.toLowerCase().includes(q.toLowerCase()))
    : skuOptions;

  // 상품별 그루핑
  const groups = (() => {
    const map = new Map<string, typeof skuOptions>();
    for (const s of filtered) {
      if (!map.has(s.product_name)) map.set(s.product_name, []);
      map.get(s.product_name)!.push(s);
    }
    return [...map.entries()].map(([name, skus]) => ({ name, skus }));
  })();

  const inputCls = 'h-9 w-20 px-2 rounded-lg border border-transparent hover:border-[#E5E8EB] focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 text-[12px] text-center bg-transparent focus:bg-white transition-colors tabular-nums';

  return (
    <div className="space-y-4">
      <div className="bg-[#EBF1FE] rounded-xl px-4 py-3 flex items-start gap-2.5">
        <AlertCircle className="h-4 w-4 text-[#3182F6] mt-0.5 shrink-0" />
        <p className="text-[13px] text-[#3182F6]">
          <span className="font-semibold">SKU별 등급별 할인율</span>을 입력하세요. 신상품 판매가 대비 비율(%)로 입력합니다. 예: 85 = 신상품가의 85%
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#F2F4F6]">
          <span className="text-[13px] font-semibold text-[#191F28]">반품 재판매 할인율 (%)</span>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#B0B8C1]" />
              <input lang="ko" value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색"
                className="h-8 pl-8 pr-3 rounded-xl border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6] w-36" />
            </div>
            <a href="/api/sku-grade-discounts?format=csv" download
              className="flex items-center gap-1.5 h-8 px-3.5 rounded-xl border border-[#E5E8EB] text-[12px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors whitespace-nowrap">
              <Download className="h-3.5 w-3.5" /> CSV
            </a>
            <button onClick={() => setImportOpen(true)}
              className="flex items-center gap-1.5 h-8 px-3.5 rounded-xl border border-[#E5E8EB] text-[12px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors whitespace-nowrap">
              <Upload className="h-3.5 w-3.5" /> 업로드
            </button>
            <button onClick={handleSaveAll} disabled={saving || !dirty}
              className={`h-8 px-4 rounded-xl text-[12px] font-semibold transition-all ${dirty ? 'bg-[#3182F6] text-white hover:bg-[#1B64DA]' : 'bg-[#F2F4F6] text-[#B0B8C1]'}`}>
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-[#3182F6]" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#F8F9FB] border-b border-[#F2F4F6]">
                  <th className="text-left px-5 py-2.5 text-[12px] font-semibold text-[#6B7684] min-w-[200px]">상품 / SKU</th>
                  {GRADES.map(g => (
                    <th key={g} className="text-center px-3 py-2.5 text-[12px] font-semibold text-[#6B7684] min-w-[90px]">{g}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.name}>
                    <tr className="bg-[#F8F9FB] border-y border-[#E5E8EB]">
                      <td colSpan={1 + GRADES.length} className="px-5 py-2">
                        <span className="text-[12px] font-semibold text-[#191F28]">{group.name}</span>
                        <span className="text-[11px] text-[#B0B8C1] ml-2">{group.skus.length}개</span>
                      </td>
                    </tr>
                    {group.skus.map((sku) => (
                      <tr key={sku.id} className="border-b border-[#F2F4F6] hover:bg-[#FAFAFA]">
                        <td className="px-5 py-2.5">
                          <p className="text-[13px] text-[#191F28]">{sku.option_label || '기본'}</p>
                          <p className="text-[11px] text-[#B0B8C1] font-mono">{sku.sku_code}</p>
                        </td>
                        {GRADES.map(g => (
                          <td key={g} className="text-center px-2 py-2">
                            <input type="number" min="0" max="100"
                              value={data[sku.id]?.[g] ?? ''}
                              onChange={(e) => updateRate(sku.id, g, Number(e.target.value) || 0)}
                              placeholder="-"
                              className={inputCls} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => { setImportOpen(false); load(); }}
        title="반품 할인율 업로드"
        templateType="grade-discounts"
        templateUrl="/api/sku-grade-discounts?format=csv"
        importUrl="/api/sku-grade-discounts/import"
        columns={['SKU코드', '최상', '상', '중', '미개봉']}
        description="SKU코드는 필수입니다. 할인율은 신상품 판매가 대비 비율(%)로 입력합니다."
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#191F28] text-white text-[13px] font-medium px-5 py-3 rounded-2xl shadow-lg z-50 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-400" /> {toast}
        </div>
      )}
    </div>
  );
}

// ─── Suppliers Tab ───────────────────────────────────────────────────────────

const COUNTRY_CODES = [
  { code: '+82', label: '+82 한국' },
  { code: '+86', label: '+86 중국' },
  { code: '+1',  label: '+1 미국' },
  { code: '+81', label: '+81 일본' },
  { code: '+84', label: '+84 베트남' },
  { code: '+66', label: '+66 태국' },
  { code: '+60', label: '+60 말레이시아' },
  { code: '+62', label: '+62 인도네시아' },
  { code: '+91', label: '+91 인도' },
  { code: '+44', label: '+44 영국' },
];

const ADDRESS_TYPES = [
  { value: 'office',  label: '쇼룸/사무실' },
  { value: 'factory', label: '공장/출고지' },
  { value: 'other',   label: '기타' },
] as const;

interface SupplierFormState {
  name: string; alias: string; contact_person: string;
  phone_country_code: string; phone: string;
  email: string; country: string; lead_time_days: string;
  main_products: string; note: string;
  addresses: SupplierAddress[];
}

const EMPTY_SUPPLIER_FORM: SupplierFormState = {
  name: '', alias: '', contact_person: '',
  phone_country_code: '+86', phone: '',
  email: '', country: '중국', lead_time_days: '21',
  main_products: '', note: '',
  addresses: [],
};

const sfInputCls = 'w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors';

function SfField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[13px] font-medium text-[#191F28]">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function SupplierFormDialog({ initial, onSave, onCancel, saving }: {
  initial: SupplierFormState;
  onSave: (f: SupplierFormState) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(initial);
  const [addrInput, setAddrInput] = useState({ type: 'office' as SupplierAddress['type'], label: '쇼룸/사무실', address: '' });
  const set = (k: keyof SupplierFormState, v: any) => setForm((f) => ({ ...f, [k]: v }));

  function addAddress() {
    if (!addrInput.address.trim()) return;
    set('addresses', [...form.addresses, { ...addrInput, address: addrInput.address.trim() }]);
    setAddrInput((a) => ({ ...a, address: '' }));
  }

  function removeAddress(i: number) {
    set('addresses', form.addresses.filter((_, idx) => idx !== i));
  }

  function handleAddrTypeChange(type: SupplierAddress['type']) {
    const found = ADDRESS_TYPES.find((t) => t.value === type);
    setAddrInput((a) => ({ ...a, type, label: found?.label ?? type }));
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-4">
      <SfField label="회사명 / 제조사명" required>
        <input lang="ko" className={sfInputCls} placeholder="예: 선전전자공장" value={form.name} onChange={(e) => set('name', e.target.value)} required />
      </SfField>
      <SfField label="별칭">
        <input lang="ko" className={sfInputCls} placeholder="예: 선전공장, 중국A업체 (짧게 부르는 이름)" value={form.alias} onChange={(e) => set('alias', e.target.value)} />
      </SfField>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SfField label="담당자">
          <input lang="ko" className={sfInputCls} placeholder="담당자 이름" value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
        </SfField>
        <SfField label="국가">
          <input lang="ko" className={sfInputCls} placeholder="중국" value={form.country} onChange={(e) => set('country', e.target.value)} />
        </SfField>
      </div>
      <SfField label="연락처">
        <div className="flex gap-2">
          <select value={form.phone_country_code} onChange={(e) => set('phone_country_code', e.target.value)}
            className="h-11 px-2 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] bg-white focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors shrink-0">
            {COUNTRY_CODES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <input lang="ko" className={sfInputCls} placeholder="010-1234-5678" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
      </SfField>
      <SfField label="이메일">
        <input className={sfInputCls} type="email" placeholder="example@email.com" value={form.email} onChange={(e) => set('email', e.target.value)} />
      </SfField>
      <SfField label="기본 리드타임 (일)">
        <div className="flex items-center gap-2">
          <input className={sfInputCls} type="number" min="1" max="365" placeholder="21" value={form.lead_time_days} onChange={(e) => set('lead_time_days', e.target.value)} />
          <span className="text-[13px] text-[#6B7684] whitespace-nowrap">일</span>
        </div>
        <p className="text-[11px] text-[#B0B8C1] mt-1">발주일로부터 입고까지 평균 소요 기간</p>
      </SfField>
      <SfField label="주요 상품">
        <input lang="ko" className={sfInputCls} placeholder="예: 백팩, 가방류, 의류" value={form.main_products} onChange={(e) => set('main_products', e.target.value)} />
      </SfField>
      <div className="space-y-2">
        <label className="text-[13px] font-medium text-[#191F28]">주소</label>
        {form.addresses.map((addr, i) => (
          <div key={i} className="flex items-start gap-2 bg-[#F8F9FB] rounded-xl px-3 py-2.5">
            <MapPin className="h-3.5 w-3.5 text-[#B0B8C1] mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-[#6B7684]">{addr.label}</p>
              <p className="text-[13px] text-[#191F28] break-all">{addr.address}</p>
            </div>
            <button type="button" onClick={() => removeAddress(i)} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-50 text-[#B0B8C1] hover:text-red-500 transition-colors shrink-0">
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div className="border border-[#E5E8EB] rounded-xl p-3 space-y-2">
          <div className="flex gap-2">
            <select value={addrInput.type} onChange={(e) => handleAddrTypeChange(e.target.value as SupplierAddress['type'])}
              className="h-10 px-2 rounded-xl border border-[#E5E8EB] text-[13px] bg-white focus:outline-none focus:border-[#3182F6] transition-colors shrink-0">
              {ADDRESS_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input
              lang="ko"
              className="flex-1 h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] transition-colors"
              placeholder="주소 입력" value={addrInput.address}
              onChange={(e) => setAddrInput((a) => ({ ...a, address: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAddress(); } }}
            />
            <button type="button" onClick={addAddress} className="h-10 w-9 flex items-center justify-center rounded-xl bg-[#EBF1FE] text-[#3182F6] hover:bg-[#3182F6] hover:text-white transition-colors shrink-0">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <SfField label="메모">
        <textarea lang="ko" className="w-full px-3.5 py-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors resize-none"
          rows={2} placeholder="특이사항, 계좌 정보 등" value={form.note} onChange={(e) => set('note', e.target.value)} />
      </SfField>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">취소</button>
        <button type="submit" disabled={saving} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          저장
        </button>
      </div>
    </form>
  );
}

function SuppliersTab() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Supplier | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/suppliers');
    setSuppliers(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function formToBody(form: SupplierFormState) {
    return {
      name: form.name.trim(),
      alias: form.alias.trim() || null,
      contact_person: form.contact_person.trim() || null,
      phone_country_code: form.phone_country_code || '+86',
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      country: form.country.trim() || '중국',
      lead_time_days: Number(form.lead_time_days) || 21,
      main_products: form.main_products.trim() || null,
      note: form.note.trim() || null,
      addresses: form.addresses,
    };
  }

  async function handleAdd(form: SupplierFormState) {
    setSaving(true);
    const res = await fetch('/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formToBody(form)),
    });
    if (res.ok) {
      const data = await res.json();
      setSuppliers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setAddOpen(false);
    }
    setSaving(false);
  }

  async function handleEdit(form: SupplierFormState) {
    if (!editTarget) return;
    setSaving(true);
    const res = await fetch(`/api/suppliers/${editTarget.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formToBody(form)),
    });
    if (res.ok) {
      const data = await res.json();
      setSuppliers((prev) => prev.map((s) => s.id === data.id ? data : s));
      setEditTarget(null);
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/suppliers/${id}`, { method: 'DELETE' });
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
    setDeleteId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-[#6B7684]">제조사 / 공급처 정보를 등록하고 발주 시 불러옵니다</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setCsvOpen(true)} className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
            <Upload className="h-3.5 w-3.5" /> CSV 업로드
          </button>
          <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 h-10 px-4 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] transition-colors">
            <Plus className="h-3.5 w-3.5" /> 공급처 추가
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-[#3182F6]" />
        </div>
      ) : suppliers.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col items-center justify-center py-16">
          <Building2 className="h-10 w-10 text-[#B0B8C1] mb-3" />
          <p className="text-[13px] font-medium text-[#6B7684]">등록된 공급처가 없습니다</p>
          <p className="text-[13px] text-[#B0B8C1] mt-1">공급처 추가 버튼을 눌러 시작하세요</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {suppliers.map((s) => (
            <div key={s.id} className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#F2F4F6] flex items-center justify-center shrink-0">
                    <Building2 className="h-5 w-5 text-[#6B7684]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-[15px] font-bold text-[#191F28]">{s.name}</h3>
                      {s.alias && <span className="text-[11px] font-medium px-2 py-0.5 bg-[#EBF1FE] text-[#3182F6] rounded-full">{s.alias}</span>}
                      {s.country && <span className="text-[11px] font-medium px-2 py-0.5 bg-[#F2F4F6] text-[#6B7684] rounded-full">{s.country}</span>}
                    </div>
                    <div className="flex items-center gap-4 mt-2 flex-wrap">
                      {s.contact_person && <span className="text-[12px] text-[#6B7684]"><span className="text-[#B0B8C1]">담당자</span> {s.contact_person}</span>}
                      {s.phone && <span className="flex items-center gap-1 text-[12px] text-[#6B7684]"><Phone className="h-3.5 w-3.5 text-[#B0B8C1]" />{s.phone_country_code && `${s.phone_country_code} `}{s.phone}</span>}
                      {s.email && <span className="flex items-center gap-1 text-[12px] text-[#6B7684]"><Mail className="h-3.5 w-3.5 text-[#B0B8C1]" /> {s.email}</span>}
                      <span className="flex items-center gap-1 text-[12px] font-medium text-[#3182F6]"><Clock className="h-3.5 w-3.5" /> 리드타임 {s.lead_time_days}일</span>
                      {s.main_products && <span className="flex items-center gap-1 text-[12px] text-[#6B7684]"><Package className="h-3.5 w-3.5 text-[#B0B8C1]" /> {s.main_products}</span>}
                    </div>
                    {(s.addresses ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {s.addresses.map((addr, i) => (
                          <span key={i} className="flex items-center gap-1 text-[12px] text-[#6B7684]">
                            <MapPin className="h-3 w-3 text-[#B0B8C1]" />
                            <span className="text-[#B0B8C1] font-medium">{addr.label}</span> {addr.address}
                          </span>
                        ))}
                      </div>
                    )}
                    {s.note && <p className="text-[12px] text-[#B0B8C1] mt-1.5 line-clamp-1">{s.note}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => setEditTarget(s)} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6] text-[#B0B8C1] hover:text-[#6B7684] transition-colors">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => setDeleteId(s.id)} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-red-50 text-[#B0B8C1] hover:text-red-500 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <CsvImportDialog
        open={csvOpen} onClose={() => setCsvOpen(false)} onImported={load}
        title="공급처 CSV 일괄 등록" templateType="suppliers" importUrl="/api/suppliers/import"
        columns={['업체명', '담당자', '국가코드', '전화번호', '이메일', '국가', '리드타임(일)']}
        description="업체명이 중복되면 건너뜁니다."
      />

      {/* 추가 다이얼로그 */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setAddOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
              <h2 className="text-[15px] font-bold text-[#191F28]">공급처 추가</h2>
              <button onClick={() => setAddOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6]">
                <XIcon className="h-4 w-4 text-[#6B7684]" />
              </button>
            </div>
            <div className="px-6 py-5">
              <SupplierFormDialog initial={EMPTY_SUPPLIER_FORM} onSave={handleAdd} onCancel={() => setAddOpen(false)} saving={saving} />
            </div>
          </div>
        </div>
      )}

      {/* 수정 다이얼로그 */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setEditTarget(null)} />
          <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
              <h2 className="text-[15px] font-bold text-[#191F28]">공급처 수정</h2>
              <button onClick={() => setEditTarget(null)} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6]">
                <XIcon className="h-4 w-4 text-[#6B7684]" />
              </button>
            </div>
            <div className="px-6 py-5">
              <SupplierFormDialog
                initial={{
                  name: editTarget.name,
                  alias: editTarget.alias ?? '',
                  contact_person: editTarget.contact_person ?? '',
                  phone_country_code: editTarget.phone_country_code ?? '+86',
                  phone: editTarget.phone ?? '',
                  email: editTarget.email ?? '',
                  country: editTarget.country ?? '중국',
                  lead_time_days: String(editTarget.lead_time_days),
                  main_products: editTarget.main_products ?? '',
                  note: editTarget.note ?? '',
                  addresses: editTarget.addresses ?? [],
                }}
                onSave={handleEdit} onCancel={() => setEditTarget(null)} saving={saving}
              />
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDeleteId(null)} />
          <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full max-w-sm mx-4 p-6">
            <h3 className="text-[15px] font-bold text-[#191F28] mb-2">공급처 삭제</h3>
            <p className="text-[13px] text-[#6B7684]">삭제 후 복구할 수 없습니다. 이 공급처를 사용하는 SKU와의 연결도 해제됩니다.</p>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setDeleteId(null)} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">취소</button>
              <button onClick={() => handleDelete(deleteId)} className="flex-1 h-11 rounded-xl bg-red-500 text-white text-[13px] font-semibold hover:bg-red-600 transition-colors">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function MasterPage() {
  const [tab, setTab] = useState<'master' | 'discount' | 'supplier'>('master');
  const [rows, setRows] = useState<UnifiedRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [skuOptions, setSkuOptions] = useState<{ id: string; label: string; sku_code: string; product_name: string; option_label: string }[]>([]);

  // Platform state (moved from PlatformTab)
  const [aliases, setAliases] = useState<Record<string, { id: string; channel_name: string }[]>>({});
  const [aliasModal, setAliasModal] = useState<{ skuId: string; productName: string; optionLabel: string; skuCode: string } | null>(null);
  const [newAlias, setNewAlias] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDiscount, setBulkDiscount] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [rgVatIncluded, setRgVatIncluded] = useState(false);
  const [rgSaverEnabled, setRgSaverEnabled] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // ── 컬럼 너비 조절 ──────────────────────────────────────────────────────────
  const resizingCol = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    name: 200, supplier: 140, cost: 120,
    lead: 100, reorder: 100, safety: 100, sales30: 110, avg: 90,
  });

  function handleResizeStart(e: React.MouseEvent, key: string) {
    e.preventDefault();
    resizingCol.current = { key, startX: e.clientX, startWidth: colWidths[key] ?? 100 };
    function onMove(ev: MouseEvent) {
      if (!resizingCol.current) return;
      const delta = ev.clientX - resizingCol.current.startX;
      setColWidths((prev) => ({ ...prev, [resizingCol.current!.key]: Math.max(60, resizingCol.current!.startWidth + delta) }));
    }
    function onUp() {
      resizingCol.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  const rTh = (key: string, children: React.ReactNode, className = '') => (
    <th style={{ width: colWidths[key] ?? 100, minWidth: colWidths[key] ?? 100 }}
      className={`relative px-3 py-2 text-[11px] font-medium text-[#6B7684] whitespace-nowrap select-none overflow-hidden ${className}`}>
      {children}
      <div onMouseDown={(e) => handleResizeStart(e, key)}
        className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center group/resize">
        <div className="w-[2px] h-4 rounded-full bg-[#D1D5DB] group-hover/resize:bg-[#3182F6] group-hover/resize:h-full transition-all duration-100" />
      </div>
    </th>
  );

  const coupangChannel = channels.find((c) => c.type === 'coupang');

  // ── Load ─────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [products, whs, chs, supplierData, platformRes, aliasRes, credRes] = await Promise.all([
        fetch('/api/products').then((r) => r.json()).catch(() => []),
        fetch('/api/settings/warehouses').then((r) => r.json()).catch(() => []),
        fetch('/api/settings/channels').then((r) => r.json()).catch(() => []),
        fetch('/api/suppliers').then((r) => r.json()).catch(() => []),
        fetch('/api/platform-skus'),
        fetch('/api/sku-aliases'),
        fetch('/api/coupang/credentials'),
      ]);
      setSuppliers(supplierData ?? []);

      const warehouseList: Warehouse[] = whs ?? [];
      const channelList: Channel[] = chs ?? [];
      setWarehouses(warehouseList);
      setChannels(channelList);

      // Coupang credentials
      if (credRes.ok) {
        const cred = await credRes.json().catch(() => null);
        if (cred?.rg_saver_enabled != null) setRgSaverEnabled(!!cred.rg_saver_enabled);
      }

      // Platform data
      const platformData: any[] = platformRes.ok ? await platformRes.json().catch(() => []) : [];
      const bySkuId: Record<string, Record<string, ChannelEntry>> = {};
      for (const p of platformData ?? []) {
        if (!bySkuId[p.sku_id]) bySkuId[p.sku_id] = {};
        const isCoupang = p.channel?.type === 'coupang';
        bySkuId[p.sku_id][p.channel_id] = {
          name:          p.platform_product_name ?? '',
          product_id:    (isCoupang ? p.platform_sku_id : p.platform_product_id) ?? '',
          price:         p.price != null ? String(p.price) : '',
          coupon_discount: p.coupon_discount != null ? String(p.coupon_discount) : '',
          sku_id_return: p.platform_sku_id_return ?? '',
          rg_fee_fulfill:  (p.rg_fee_inout != null || p.rg_fee_shipping != null) ? String(Number(p.rg_fee_inout ?? 0) + Number(p.rg_fee_shipping ?? 0)) : '',
          rg_fee_return:   p.rg_fee_return != null ? String(p.rg_fee_return) : '',
          rg_fee_restock:  p.rg_fee_restock != null ? String(p.rg_fee_restock) : '',
          rg_fee_send:     p.rg_fee_send != null ? String(p.rg_fee_send) : '',
          rg_fee_packing:  p.rg_fee_packing != null ? String(p.rg_fee_packing) : '',
        };
      }

      // Aliases
      const aliasData: any[] = aliasRes.ok ? await aliasRes.json().catch(() => []) : [];
      const aliasMap: Record<string, { id: string; channel_name: string }[]> = {};
      for (const a of aliasData) {
        if (!aliasMap[a.sku_id]) aliasMap[a.sku_id] = [];
        aliasMap[a.sku_id].push({ id: a.id, channel_name: a.channel_name });
      }
      setAliases(aliasMap);

      // Build unified rows
      const flat: UnifiedRow[] = [];
      for (const product of (products ?? [])) {
        for (const sku of (product.skus ?? [])) {
          const inv: Record<string, string> = {};
          warehouseList.forEach((w) => { inv[w.id] = ''; });
          for (const i of (sku.inventory ?? [])) {
            const whId = i.warehouse?.id ?? warehouseList.find((w: Warehouse) => w.name === i.warehouse?.name)?.id;
            if (whId) inv[whId] = String(i.quantity ?? 0);
          }

          flat.push({
            id: sku.id,
            sku_code: sku.sku_code,
            product_name: product.name,
            option_label: skuOptionLabel(sku.option_values ?? {}),
            cost_price: String(sku.cost_price ?? ''),
            lead_time_days: String(sku.lead_time_days ?? ''),
            reorder_point: String(sku.reorder_point ?? ''),
            safety_stock: String(sku.safety_stock ?? ''),
            supplier_id: sku.supplier_id ?? '',
            sales_30d: sku.manual_daily_avg != null
              ? String(Math.round(sku.manual_daily_avg * 30))
              : '',
            inventory: inv,
            entries: Object.fromEntries(channelList.map((c) => [c.id, bySkuId[sku.id]?.[c.id] ?? { ...EMPTY_ENTRY }])),
            skuDirty: false,
            platformDirty: false,
            saving: false,
            saved: false,
            error: '',
          });
        }
      }
      setRows(flat);

      // SKU options for other tabs
      const opts = flat.map((r) => ({
        id: r.id,
        label: `${r.product_name}${r.option_label ? ' · ' + r.option_label : ''} (${r.sku_code})`,
        sku_code: r.sku_code,
        product_name: r.product_name,
        option_label: r.option_label,
      }));
      setSkuOptions(opts);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Dirty tracking ──────────────────────────────────────────────────────────
  function markDirty(id: string, patch: Partial<UnifiedRow>) {
    setRows((prev) => prev.map((r) => r.id === id
      ? { ...r, ...patch, skuDirty: true, saved: false }
      : r
    ));
  }

  function updatePlatformEntry(skuId: string, channelId: string, field: keyof ChannelEntry, value: string) {
    setRows((prev) => prev.map((r) => r.id !== skuId ? r : {
      ...r,
      entries: { ...r.entries, [channelId]: { ...r.entries[channelId], [field]: value } },
      platformDirty: true,
      saved: false,
    }));
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function saveRow(row: UnifiedRow) {
    setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, saving: true, error: '' } : r));
    const errors: string[] = [];
    try {
      // Save SKU master fields
      if (row.skuDirty) {
        const manual_daily_avg = row.sales_30d.trim() ? Number(row.sales_30d) / 30 : null;
        const skuRes = await fetch(`/api/skus/${row.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cost_price: row.cost_price ? Number(row.cost_price) : 0,
            lead_time_days: row.lead_time_days ? Number(row.lead_time_days) : null,
            reorder_point: row.reorder_point !== '' ? Number(row.reorder_point) : 0,
            safety_stock: row.safety_stock !== '' ? Number(row.safety_stock) : 0,
            supplier_id: row.supplier_id || null,
            manual_daily_avg,
          }),
        });
        if (!skuRes.ok) {
          const d = await skuRes.json().catch(() => ({}));
          errors.push(`SKU: ${d.error ?? skuRes.status}`);
        }
      }

      // Save platform fields
      if (row.platformDirty) {
        await Promise.all(
          channels.map(async (c) => {
            const e = row.entries[c.id];
            if (!e) return;
            const name       = e.name.trim();
            const product_id = e.product_id.trim() || null;
            const price      = e.price.trim() ? Number(e.price.replace(/,/g, '')) : null;
            const coupon_discount = e.coupon_discount?.trim() ? Number(e.coupon_discount.replace(/,/g, '')) : 0;
            const sku_id_return = e.sku_id_return.trim() || null;
            const isCoupang = c.type === 'coupang';
            const body: Record<string, any> = {
              sku_id: row.id,
              channel_id: c.id,
              platform_product_name: name || null,
              platform_product_id:   isCoupang ? null : product_id,
              platform_sku_id:       isCoupang ? product_id : null,
              price,
              coupon_discount,
              platform_sku_id_return: sku_id_return,
            };
            if (isCoupang) {
              body.rg_fee_inout    = e.rg_fee_fulfill?.trim()   ? Number(e.rg_fee_fulfill.replace(/,/g, '')) : 0;
              body.rg_fee_shipping = 0;
              body.rg_fee_return   = e.rg_fee_return?.trim()   ? Number(e.rg_fee_return.replace(/,/g, ''))   : 0;
              body.rg_fee_restock  = e.rg_fee_restock?.trim()  ? Number(e.rg_fee_restock.replace(/,/g, ''))  : 0;
              body.rg_fee_send     = e.rg_fee_send?.trim()     ? Number(e.rg_fee_send.replace(/,/g, ''))     : 0;
              body.rg_fee_packing  = e.rg_fee_packing?.trim()  ? Number(e.rg_fee_packing.replace(/,/g, ''))  : 0;
            }
            const res = await fetch('/api/platform-skus', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            if (!res.ok) {
              const d = await res.json().catch(() => ({}));
              errors.push(`${c.name}: ${d.error ?? res.status}`);
            }
            if (name) {
              await fetch('/api/sku-aliases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel_name: name, sku_id: row.id }),
              });
            }
          })
        );
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : '알 수 없는 오류');
    }

    if (errors.length) {
      setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, saving: false, error: errors.join(', ') } : r));
    } else {
      setRows((prev) => prev.map((r) => r.id === row.id
        ? { ...r, saving: false, saved: true, skuDirty: false, platformDirty: false, error: '' }
        : r
      ));
      setTimeout(() => {
        setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, saved: false } : r));
      }, 2000);
      load();
    }
  }

  async function saveAllDirty() {
    const dirty = rows.filter((r) => r.skuDirty || r.platformDirty);
    if (!dirty.length) return;
    setSavingAll(true);
    await Promise.all(dirty.map(saveRow));
    setSavingAll(false);
  }

  const dirtyCount = rows.filter((r) => r.skuDirty || r.platformDirty).length;

  // ── Platform helper functions (moved from PlatformTab) ─────────────────────
  async function syncIds() {
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch('/api/coupang/sync-platform-prices', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? '오류');
      setSyncResult(`${d.updated}개 ID 갱신 (상품 ${d.productsScanned ?? '?'}개 스캔 · 스킵 ${d.skipped ?? 0}개)`);
      load();
    } catch (err: any) {
      setSyncResult(`실패: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  function toggleSelect(skuId: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(skuId) ? next.delete(skuId) : next.add(skuId); return next; });
  }

  async function applyBulkDiscount() {
    if (!bulkDiscount.trim() || !coupangChannel || selected.size === 0) return;
    const val = bulkDiscount.trim();
    setBulkSaving(true);
    setRows((prev) => prev.map((r) => {
      if (!selected.has(r.id)) return r;
      return { ...r, entries: { ...r.entries, [coupangChannel.id]: { ...r.entries[coupangChannel.id], coupon_discount: val } }, platformDirty: false };
    }));
    await Promise.all(
      rows.filter((r) => selected.has(r.id)).map(async (row) => {
        const e = row.entries[coupangChannel.id];
        if (!e) return;
        const price = e.price.trim() ? Number(e.price.replace(/,/g, '')) : null;
        await fetch('/api/platform-skus', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sku_id: row.id,
            channel_id: coupangChannel.id,
            platform_product_name: e.name.trim() || null,
            platform_product_id: null,
            platform_sku_id: e.product_id.trim() || null,
            price,
            coupon_discount: Number(val.replace(/,/g, '')) || 0,
            platform_sku_id_return: e.sku_id_return?.trim() || null,
          }),
        });
      })
    );
    setBulkSaving(false);
    setSelected(new Set());
    setBulkDiscount('');
  }

  async function addAlias(skuId: string, name: string) {
    if (!name.trim()) return;
    await fetch('/api/sku-aliases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_name: name.trim(), sku_id: skuId }),
    });
    setAliases((prev) => ({
      ...prev,
      [skuId]: [...(prev[skuId] ?? []), { id: '', channel_name: name.trim() }],
    }));
    setNewAlias('');
  }

  async function removeAlias(skuId: string, aliasId: string, channelName: string) {
    if (aliasId) {
      await fetch(`/api/sku-aliases?id=${aliasId}`, { method: 'DELETE' });
    }
    setAliases((prev) => ({
      ...prev,
      [skuId]: (prev[skuId] ?? []).filter((a) => a.channel_name !== channelName),
    }));
  }

  // ── Search ──────────────────────────────────────────────────────────────────
  const [searchQ, setSearchQ] = useState('');

  // ── Expand/collapse ─────────────────────────────────────────────────────────
  const [expandedMaster, setExpandedMaster] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const saved = localStorage.getItem('master_expanded');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  function toggleMaster(name: string) {
    setExpandedMaster((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      try { localStorage.setItem('master_expanded', JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  // ── Drag & drop group reordering ──────────────────────────────────────────
  const [productOrder, setProductOrder] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('master_product_order');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  useEffect(() => {
    if (!rows.length) return;
    const names = [...new Set(rows.map((r) => r.product_name))];
    setProductOrder((prev) => {
      const existing = prev.filter((n) => names.includes(n));
      const newOnes = names.filter((n) => !prev.includes(n));
      const merged = [...existing, ...newOnes];
      try { localStorage.setItem('master_product_order', JSON.stringify(merged)); } catch {}
      return merged;
    });
  }, [rows]);

  const dragGroup = useRef<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  function handleDragStart(name: string) {
    dragGroup.current = name;
  }
  function handleDragOver(e: React.DragEvent, name: string) {
    e.preventDefault();
    setDragOverGroup(name);
  }
  function handleDrop(name: string) {
    const from = dragGroup.current;
    dragGroup.current = null;
    setDragOverGroup(null);
    if (!from || from === name) return;
    setProductOrder((prev) => {
      const next = [...prev];
      const fi = next.indexOf(from);
      const ti = next.indexOf(name);
      if (fi === -1 || ti === -1) return prev;
      next.splice(fi, 1);
      next.splice(ti, 0, from);
      try { localStorage.setItem('master_product_order', JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // ── Groups ──────────────────────────────────────────────────────────────────
  const masterGroups = (() => {
    const map = new Map<string, UnifiedRow[]>();
    for (const row of rows) {
      if (!map.has(row.product_name)) map.set(row.product_name, []);
      map.get(row.product_name)!.push(row);
    }
    let groups = Array.from(map.entries()).map(([name, skus]) => ({ name, skus }));

    if (productOrder.length) {
      const orderMap = new Map(productOrder.map((n, i) => [n, i]));
      groups.sort((a, b) => {
        const ai = orderMap.has(a.name) ? orderMap.get(a.name)! : Infinity;
        const bi = orderMap.has(b.name) ? orderMap.get(b.name)! : Infinity;
        return ai - bi;
      });
    }

    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      groups = groups.filter((g) =>
        g.name.toLowerCase().includes(q) ||
        g.skus.some((s) => s.sku_code.toLowerCase().includes(q) || s.option_label.toLowerCase().includes(q))
      );
    }

    return groups;
  })();

  // Filtered flat rows for select-all checkbox
  const filteredRows = masterGroups.flatMap((g) => g.skus);
  const allSelected = filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.id));
  function toggleSelectAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filteredRows.map((r) => r.id)));
  }

  // ── Column counts for colSpan ─────────────────────────────────────────────
  // SKU basic cols: supplier, cost, lead, reorder, safety, sales30, avg = 7
  const skuBasicColCount = 7;
  // total columns for group header row colSpan
  const totalCols = 1 /* checkbox */ + 1 /* name */ + skuBasicColCount + warehouses.length
    + channels.reduce((s, c) => s + (c.type === 'coupang' ? 10 : 3), 0) + 1 /* save */;

  const platformInputCls = 'w-full h-10 px-2.5 rounded-lg border border-[#E5E8EB] text-[12px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors bg-white';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-[#3182F6]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="sticky top-[60px] z-20 bg-[#F2F4F6] pb-3 -mb-2 space-y-3">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div className="min-w-0">
            <h2 className="text-[20px] font-bold tracking-[-0.03em] text-[#191F28]">마스터 시트</h2>
            <p className="mt-1 text-[13px] text-[#6B7684]">원가·재고·플랫폼 상품명을 한 화면에서 관리하세요</p>
          </div>
          <div className="flex items-center gap-1 bg-[#F2F4F6] p-1 rounded-xl shrink-0">
            {([['master', 'SKU 마스터'], ['discount', '반품 할인율'], ['supplier', '공급처']] as const).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`h-8 px-4 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap ${tab === t ? 'bg-white text-[#191F28] shadow-sm' : 'text-[#6B7684] hover:bg-white/60'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {tab === 'master' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[140px] max-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#B0B8C1]" />
              <input
                lang="ko"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="상품명·SKU 검색"
                className="w-full h-10 pl-8 pr-3 rounded-xl border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6]"
              />
            </div>
            <button onClick={load} className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors whitespace-nowrap">
              <RefreshCw className="h-4 w-4" /> 새로고침
            </button>
            {channels.some((c) => c.type === 'coupang') && (
              <button onClick={syncIds} disabled={syncing}
                title={syncResult ?? '쿠팡 옵션ID 자동 매핑 (externalSkuId -> vendorItemId)'}
                className="flex items-center gap-1.5 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] disabled:opacity-60 transition-colors whitespace-nowrap">
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                쿠팡 ID 동기화
              </button>
            )}
            <button onClick={() => setImportOpen(true)}
              className="flex items-center gap-1.5 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors whitespace-nowrap">
              <Upload className="h-4 w-4" /> 엑셀 업로드
            </button>
            {dirtyCount > 0 && (
              <button onClick={saveAllDirty} disabled={savingAll} className="flex items-center gap-2 h-10 px-4 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60 whitespace-nowrap">
                {savingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                저장 ({dirtyCount})
              </button>
            )}
          </div>
        )}
      </div>

      {/* 반품 할인율 탭 */}
      {tab === 'discount' && <GradeDiscountTab skuOptions={skuOptions} />}

      {/* 공급처 탭 */}
      {tab === 'supplier' && <SuppliersTab />}

      {/* SKU 마스터 (unified) 탭 */}
      {tab === 'master' && <>
      {/* 안내 */}
      <div className="bg-[#EBF1FE] rounded-xl px-4 py-3 flex items-start gap-2.5">
        <FileSpreadsheet className="h-4 w-4 text-[#3182F6] mt-0.5 shrink-0" />
        <p className="text-[13px] text-[#3182F6]">
          <span className="font-semibold">원가·리드타임·발주점·안전재고</span>와 <span className="font-semibold">플랫폼 상품정보</span>를 한 화면에서 관리하세요.
          창고 재고 수량은 조회만 가능하며, 수정은{' '}
          <Link href="/inventory" className="font-semibold underline underline-offset-2">재고현황</Link>에서 합니다.
        </p>
      </div>

      {/* 일괄 쿠폰할인 바 */}
      {selected.size > 0 && coupangChannel && (
        <div className="flex items-center gap-3 px-5 py-2.5 bg-[#EBF1FE] rounded-xl border border-[#D4E2FC]">
          <span className="text-[12px] font-semibold text-[#3182F6]">{selected.size}개 선택</span>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[#6B7684]">쿠폰할인 일괄:</span>
            <input type="text" inputMode="numeric" value={bulkDiscount} onChange={(e) => setBulkDiscount(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="금액" className="h-8 w-24 px-2.5 rounded-lg border border-[#D4E2FC] text-[12px] focus:outline-none focus:border-[#3182F6]" />
            <button onClick={applyBulkDiscount} disabled={bulkSaving || !bulkDiscount.trim()}
              className="h-8 px-3.5 rounded-lg bg-[#3182F6] text-white text-[12px] font-medium hover:bg-[#1B64DA] disabled:opacity-50 whitespace-nowrap">
              {bulkSaving ? '저장중...' : '일괄 적용'}
            </button>
          </div>
          <button onClick={() => { setSelected(new Set()); setBulkDiscount(''); }}
            className="text-[12px] text-[#6B7684] hover:text-[#191F28] ml-auto">취소</button>
        </div>
      )}

      {/* Dirty rows warning */}
      {dirtyCount > 0 && (
        <div className="flex items-center gap-3 px-5 py-2.5 bg-[#FFF7ED] rounded-xl border border-[#FED7AA]">
          <AlertCircle className="h-4 w-4 text-[#F97316] shrink-0" />
          <span className="text-[12px] font-medium text-[#9A3412]">
            {dirtyCount}개 행 수정됨 — 저장하지 않으면 사라집니다
          </span>
          <button onClick={saveAllDirty} disabled={rows.some((r) => r.saving)}
            className="ml-auto h-8 px-4 rounded-lg bg-[#F97316] text-white text-[12px] font-semibold hover:bg-[#EA580C] disabled:opacity-60 flex items-center gap-1.5 whitespace-nowrap">
            {rows.some((r) => r.saving) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            전체 저장
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col items-center justify-center py-16">
          <FileSpreadsheet className="h-10 w-10 text-[#B0B8C1] mb-3" />
          <p className="text-[13px] font-medium text-[#6B7684]">상품 관리에서 상품을 먼저 등록하세요</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                {/* Row 1: Group headers */}
                <tr className="bg-[#F8F9FB]">
                  <th rowSpan={2} className="w-10 px-2 py-2 border-b border-[#F2F4F6] sticky left-0 bg-[#F8F9FB] z-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                      className="w-3.5 h-3.5 rounded border-[#D0D5DD] text-[#3182F6] focus:ring-[#3182F6]/20 cursor-pointer" />
                  </th>
                  <th rowSpan={2} className="text-left px-5 py-2 text-[12px] font-semibold text-[#6B7684] whitespace-nowrap min-w-[180px] sticky left-[40px] bg-[#F8F9FB] z-10 border-b border-[#F2F4F6] border-r border-r-[#E5E8EB]">
                    상품 / SKU
                  </th>
                  <th colSpan={skuBasicColCount} className="text-center px-3 py-2 text-[12px] font-semibold text-[#6B7684] whitespace-nowrap border-b border-[#E5E8EB] border-l border-[#F2F4F6]">
                    SKU 기본
                  </th>
                  {warehouses.length > 0 && (
                    <th colSpan={warehouses.length} className="text-center px-3 py-2 text-[12px] font-semibold text-[#6B7684] whitespace-nowrap border-b border-[#E5E8EB] border-l border-[#F2F4F6]">
                      창고재고
                    </th>
                  )}
                  {channels.map((c) => (
                    <th key={c.id} colSpan={c.type === 'coupang' ? 10 : 3} className="text-center px-3 py-2 text-[12px] font-semibold text-[#6B7684] whitespace-nowrap border-b border-[#E5E8EB] border-l border-[#E5E8EB]">
                      {c.name}
                      {c.type === 'coupang' && (<>
                        <button onClick={() => setRgVatIncluded(!rgVatIncluded)}
                          className={`ml-2 px-2 py-0.5 rounded text-[10px] font-semibold transition-all active:scale-95 ${rgVatIncluded ? 'bg-[#F97316] text-white ring-2 ring-[#F97316]/30' : 'bg-[#F2F4F6] text-[#6B7684] hover:bg-[#E5E8EB]'}`}>
                          VAT {rgVatIncluded ? '포함' : '제외'}
                        </button>
                        {rgSaverEnabled && (
                          <span className="ml-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#3182F6]/10 text-[#3182F6]">세이버</span>
                        )}
                      </>)}
                    </th>
                  ))}
                  <th rowSpan={2} className="border-b border-[#F2F4F6] min-w-[60px]" />
                </tr>
                {/* Row 2: Sub-headers */}
                <tr className="bg-[#F8F9FB] border-b border-[#F2F4F6]">
                  {/* SKU basic sub-headers */}
                  {rTh('supplier', '공급처', 'text-left border-l border-[#F2F4F6]')}
                  {rTh('cost', <span>원가 <span className="font-normal text-[#B0B8C1]">(VAT제외)</span></span>, 'text-right')}
                  {rTh('lead', '리드타임', 'text-right')}
                  {rTh('reorder', '발주점', 'text-right')}
                  {rTh('safety', '안전재고', 'text-right')}
                  {rTh('sales30', '30일 판매', 'text-right')}
                  {rTh('avg', '일일평균', 'text-right')}

                  {/* Warehouse sub-headers */}
                  {warehouses.map((w) => (
                    <th key={w.id} style={{ width: colWidths[`wh_${w.id}`] ?? 110, minWidth: colWidths[`wh_${w.id}`] ?? 110 }}
                      className={`relative text-right px-3 py-2 text-[11px] font-medium text-[#6B7684] whitespace-nowrap select-none overflow-hidden ${warehouses.indexOf(w) === 0 ? 'border-l border-[#F2F4F6]' : ''}`}>
                      <span>{w.name}</span>
                      <span className="ml-1 text-[10px] font-normal text-[#B0B8C1]">조회</span>
                      <div onMouseDown={(e) => handleResizeStart(e, `wh_${w.id}`)}
                        className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center group/resize">
                        <div className="w-[2px] h-4 rounded-full bg-[#D1D5DB] group-hover/resize:bg-[#3182F6] group-hover/resize:h-full transition-all duration-100" />
                      </div>
                    </th>
                  ))}

                  {/* Channel sub-headers */}
                  {channels.map((c) => (
                    <Fragment key={c.id}>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-[#B0B8C1] whitespace-nowrap min-w-[180px] border-l border-[#E5E8EB]">플랫폼상품명</th>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-[#B0B8C1] whitespace-nowrap min-w-[130px]">{c.type === 'coupang' ? '옵션ID (vendorItemId)' : '상품ID'}</th>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-[#B0B8C1] whitespace-nowrap min-w-[100px]">판매가</th>
                      {c.type === 'coupang' && <th className="text-left px-3 py-2 text-[11px] font-medium text-[#B0B8C1] whitespace-nowrap min-w-[80px]">쿠폰할인</th>}
                      {c.type === 'coupang' && <>
                        <th className="text-left px-3 py-2 text-[11px] font-medium text-[#F97316] whitespace-nowrap min-w-[70px]">입출고배송</th>
                        <th className="text-left px-3 py-2 text-[11px] font-medium text-[#F97316] whitespace-nowrap min-w-[70px]">반품회수</th>
                        <th className="text-left px-3 py-2 text-[11px] font-medium text-[#F97316] whitespace-nowrap min-w-[70px]">반품재입고</th>
                        <th className="text-left px-3 py-2 text-[11px] font-medium text-[#F97316] whitespace-nowrap min-w-[70px]">창고발송</th>
                        <th className="text-left px-3 py-2 text-[11px] font-medium text-[#F97316] whitespace-nowrap min-w-[70px]">포장비</th>
                      </>}
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F4F6]">
                {masterGroups.map((group, gIdx) => (
                  <Fragment key={group.name}>
                    {/* 상품 그룹 헤더 */}
                    <tr
                      className={`bg-[#F8F9FB] border-y border-[#E5E8EB] select-none transition-colors ${dragOverGroup === group.name ? 'outline outline-2 outline-[#3182F6]' : 'hover:bg-[#F0F3FA]'}`}
                      draggable
                      onDragStart={() => handleDragStart(group.name)}
                      onDragOver={(e) => handleDragOver(e, group.name)}
                      onDrop={() => handleDrop(group.name)}
                      onDragEnd={() => { dragGroup.current = null; setDragOverGroup(null); }}
                    >
                      <td colSpan={totalCols} className="px-4 py-2.5 sticky left-0 bg-inherit">
                        <div className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-[#B0B8C1] shrink-0 cursor-grab" />
                          <button onClick={() => toggleMaster(group.name)} className="flex items-center gap-2">
                            {!expandedMaster.has(group.name) ? <ChevronRight className="h-3.5 w-3.5 text-[#6B7684] shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-[#6B7684] shrink-0" />}
                          </button>
                          <span className="text-[12px] font-bold text-[#3182F6]">{gIdx + 1}.</span>
                          <button onClick={() => toggleMaster(group.name)} className="text-[13px] font-semibold text-[#191F28] hover:text-[#3182F6] transition-colors">
                            {group.name}
                          </button>
                          <span className="text-[11px] text-[#B0B8C1]">{group.skus.length}개 옵션</span>
                        </div>
                      </td>
                    </tr>
                    {expandedMaster.has(group.name) && group.skus.map((row, sIdx) => {
                  const dailyAvg = row.sales_30d.trim() ? Number(row.sales_30d) / 30 : null;
                  const isDirty = row.skuDirty || row.platformDirty;

                  return (
                    <tr key={row.id} className={`transition-colors border-b border-[#F2F4F6] ${selected.has(row.id) ? 'bg-[#EBF1FE]/30' : isDirty ? 'bg-[#EBF1FE]/20' : 'hover:bg-[#FAFAFA]'}`}>
                      {/* Checkbox */}
                      <td className={`w-10 px-2 py-2.5 sticky left-0 z-10 ${selected.has(row.id) ? 'bg-[#EBF1FE]/40' : isDirty ? 'bg-[#EBF1FE]/30' : 'bg-white'}`}>
                        <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)}
                          className="w-3.5 h-3.5 rounded border-[#D0D5DD] text-[#3182F6] focus:ring-[#3182F6]/20 cursor-pointer" />
                      </td>
                      {/* 상품/SKU */}
                      <td className={`px-4 py-2.5 sticky left-[40px] z-10 border-r border-[#E5E8EB] ${selected.has(row.id) ? 'bg-[#EBF1FE]/40' : isDirty ? 'bg-[#EBF1FE]/30' : 'bg-white'}`}>
                        <div className="flex items-center gap-2 pl-2">
                          <span className="text-[11px] text-[#B0B8C1] tabular-nums w-7 shrink-0">{gIdx + 1}-{sIdx + 1}</span>
                          <div className="min-w-0">
                            {row.option_label
                              ? <p className="text-[13px] font-medium text-[#191F28]">{row.option_label}</p>
                              : <p className="text-[12px] text-[#B0B8C1]">기본</p>}
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[11px] text-[#B0B8C1] font-mono">{row.sku_code}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); setAliasModal({ skuId: row.id, productName: row.product_name, optionLabel: row.option_label, skuCode: row.sku_code }); setNewAlias(''); }}
                                className="text-[11px] text-[#3182F6] hover:underline whitespace-nowrap"
                              >
                                연동 {(aliases[row.id] ?? []).length}개
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* ── SKU basic columns ── */}
                      {/* 공급처 */}
                      <td className="px-2 py-2 border-l border-[#F2F4F6]">
                        <SelectCell
                          value={row.supplier_id}
                          onChange={(v) => {
                            const sup = suppliers.find((s) => s.id === v);
                            markDirty(row.id, {
                              supplier_id: v,
                              lead_time_days: !row.lead_time_days && sup ? String(sup.lead_time_days) : row.lead_time_days,
                            });
                          }}
                          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                          placeholder="공급처 선택"
                        />
                      </td>

                      {/* 원가 */}
                      <td className="px-2 py-2">
                        <NumCell value={row.cost_price} onChange={(v) => markDirty(row.id, { cost_price: v })} />
                        {row.cost_price && (
                          <p className="text-[11px] text-[#B0B8C1] text-right pr-2.5">
                            {formatCurrency(Number(row.cost_price))} · VAT포함 {formatCurrency(Math.round(Number(row.cost_price) * 1.1))}
                          </p>
                        )}
                      </td>

                      {/* 리드타임 */}
                      <td className="px-2 py-2">
                        <NumCell value={row.lead_time_days} onChange={(v) => markDirty(row.id, { lead_time_days: v })} />
                        {row.lead_time_days && (
                          <p className="text-[11px] text-[#B0B8C1] text-right pr-2.5">{row.lead_time_days}일</p>
                        )}
                      </td>

                      {/* 발주점 */}
                      <td className="px-2 py-2">
                        <NumCell value={row.reorder_point} onChange={(v) => markDirty(row.id, { reorder_point: v })} />
                        {row.reorder_point && (
                          <p className="text-[11px] text-[#B0B8C1] text-right pr-2.5">{formatNumber(Number(row.reorder_point))}개</p>
                        )}
                      </td>

                      {/* 안전재고 */}
                      <td className="px-2 py-2">
                        <NumCell value={row.safety_stock} onChange={(v) => markDirty(row.id, { safety_stock: v })} />
                        {row.safety_stock && (
                          <p className="text-[11px] text-[#B0B8C1] text-right pr-2.5">{formatNumber(Number(row.safety_stock))}개</p>
                        )}
                      </td>

                      {/* 30일 판매 */}
                      <td className="px-2 py-2">
                        <NumCell value={row.sales_30d} onChange={(v) => markDirty(row.id, { sales_30d: v })} />
                        {row.sales_30d && (
                          <p className="text-[11px] text-[#B0B8C1] text-right pr-2.5">{formatNumber(Number(row.sales_30d))}개</p>
                        )}
                      </td>

                      {/* 일일 평균 (읽기전용) */}
                      <td className="px-3 py-2 text-right">
                        <span className="text-[13px] text-[#6B7684] tabular-nums">
                          {dailyAvg !== null ? `${Math.round(dailyAvg * 10) / 10}개` : '–'}
                        </span>
                      </td>

                      {/* ── 창고별 재고 (읽기 전용) ── */}
                      {warehouses.map((w, wIdx) => (
                        <td key={w.id} className={`px-4 py-2.5 text-right ${wIdx === 0 ? 'border-l border-[#F2F4F6]' : ''}`}>
                          {row.inventory[w.id]
                            ? <span className="text-[13px] font-semibold text-[#191F28] tabular-nums">{formatNumber(Number(row.inventory[w.id]))}<span className="text-[11px] font-normal text-[#B0B8C1] ml-0.5">개</span></span>
                            : <span className="text-[13px] text-[#D0D5DD]">–</span>
                          }
                        </td>
                      ))}

                      {/* ── Platform columns per channel ── */}
                      {channels.map((c) => {
                        const e = row.entries[c.id] ?? { ...EMPTY_ENTRY };
                        return (
                          <Fragment key={c.id}>
                            <td className="px-2 py-2 border-l border-[#E5E8EB]">
                              <input lang="ko" value={e.name} onChange={(ev) => updatePlatformEntry(row.id, c.id, 'name', ev.target.value)}
                                placeholder="플랫폼 상품명" className={platformInputCls} />
                            </td>
                            <td className="px-2 py-2">
                              <input lang="ko" value={e.product_id} onChange={(ev) => updatePlatformEntry(row.id, c.id, 'product_id', ev.target.value)}
                                placeholder="상품ID" className={platformInputCls} />
                            </td>
                            <td className="px-2 py-2">
                              <input type="text" inputMode="numeric" value={e.price} onChange={(ev) => updatePlatformEntry(row.id, c.id, 'price', ev.target.value.replace(/[^0-9]/g, ''))}
                                placeholder="0" className={platformInputCls} />
                            </td>
                            {c.type === 'coupang' && (
                              <td className="px-2 py-2">
                                <input type="text" inputMode="numeric" value={e.coupon_discount} onChange={(ev) => updatePlatformEntry(row.id, c.id, 'coupon_discount', ev.target.value.replace(/[^0-9]/g, ''))}
                                  placeholder="0" className={platformInputCls} />
                              </td>
                            )}
                            {c.type === 'coupang' && <>
                              {(['rg_fee_fulfill', 'rg_fee_return', 'rg_fee_restock', 'rg_fee_send', 'rg_fee_packing'] as const).map((field) => {
                                const saverZero = rgSaverEnabled && (field === 'rg_fee_return' || field === 'rg_fee_restock');
                                const raw = (e as any)[field] ?? '';
                                const display = saverZero ? '0' : rgVatIncluded && raw !== '' ? String(Math.round(Number(raw) * 1.1)) : raw;
                                return (
                                  <td key={field} className="px-2 py-2">
                                    <input type="text" inputMode="numeric" value={display}
                                      disabled={saverZero}
                                      onChange={(ev) => {
                                        const v = ev.target.value.replace(/[^0-9]/g, '');
                                        const stored = rgVatIncluded && v !== '' ? String(Math.round(Number(v) / 1.1)) : v;
                                        updatePlatformEntry(row.id, c.id, field as keyof ChannelEntry, stored);
                                      }}
                                      placeholder="0" className={`${platformInputCls} ${saverZero ? 'bg-[#F2F4F6] text-[#B0B8C1]' : ''}`} />
                                  </td>
                                );
                              })}
                            </>}
                          </Fragment>
                        );
                      })}

                      {/* 저장 */}
                      <td className="px-3 py-2 text-center">
                        {row.error && <p className="text-[11px] text-red-500 mb-1 max-w-[100px] truncate" title={row.error}>{row.error}</p>}
                        {row.saving ? (
                          <Loader2 className="h-4 w-4 animate-spin text-[#3182F6] mx-auto" />
                        ) : row.saved ? (
                          <Check className="h-4 w-4 text-green-500 mx-auto" />
                        ) : row.error ? (
                          <button onClick={() => saveRow(row)}
                            className="h-8 px-3 rounded-lg bg-red-500 text-white text-[12px] font-medium hover:bg-red-600 whitespace-nowrap">
                            재시도
                          </button>
                        ) : isDirty ? (
                          <button onClick={() => saveRow(row)}
                            className="h-8 px-3 rounded-lg bg-[#3182F6] text-white text-[12px] font-medium hover:bg-[#1B64DA] whitespace-nowrap">
                            저장
                          </button>
                        ) : (
                          <Check className="h-4 w-4 text-[#D0D5DD] mx-auto" />
                        )}
                      </td>
                    </tr>
                  );
                })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-3 bg-[#F8F9FB] border-t border-[#F2F4F6]">
            <span className="text-[12px] text-[#6B7684]">총 {formatNumber(rows.length)}개 SKU</span>
            {dirtyCount > 0 && (
              <span className="text-[12px] text-[#3182F6] font-medium">{dirtyCount}개 행 변경됨</span>
            )}
          </div>
        </div>
      )}

      {/* 연동 상품명 모달 */}
      {aliasModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setAliasModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-[480px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
              <div>
                <h3 className="text-[15px] font-bold text-[#191F28]">연동 상품명 관리</h3>
                <p className="text-[12px] text-[#6B7684] mt-0.5">{aliasModal.productName} · {aliasModal.optionLabel || '기본'} <span className="text-[#B0B8C1] font-mono">({aliasModal.skuCode})</span></p>
              </div>
              <button onClick={() => setAliasModal(null)} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6]">
                <XIcon className="h-4 w-4 text-[#6B7684]" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
              {(aliases[aliasModal.skuId] ?? []).length === 0 ? (
                <p className="text-[13px] text-[#B0B8C1] text-center py-6">등록된 연동 상품명이 없습니다</p>
              ) : (
                (aliases[aliasModal.skuId] ?? []).map((a, i) => (
                  <div key={a.channel_name} className="flex items-center gap-3 px-3 py-2.5 bg-[#F8F9FB] rounded-xl group">
                    <span className="text-[11px] text-[#B0B8C1] w-5 shrink-0 tabular-nums">{i + 1}</span>
                    <span className="text-[13px] text-[#191F28] flex-1 break-all">{a.channel_name}</span>
                    <button onClick={() => removeAlias(aliasModal.skuId, a.id, a.channel_name)}
                      className="opacity-0 group-hover:opacity-100 text-[12px] text-red-400 hover:text-red-600 shrink-0 transition-opacity">삭제</button>
                  </div>
                ))
              )}
            </div>
            <div className="px-6 py-4 border-t border-[#F2F4F6]">
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={newAlias}
                  onChange={(e) => setNewAlias(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newAlias.trim()) addAlias(aliasModal.skuId, newAlias); }}
                  placeholder="채널에서 사용하는 상품명 입력"
                  className="flex-1 h-10 px-3 text-[13px] rounded-xl border border-[#E5E8EB] outline-none focus:border-[#3182F6]"
                />
                <button onClick={() => { if (newAlias.trim()) addAlias(aliasModal.skuId, newAlias); }}
                  className="h-10 px-4 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA]">추가</button>
              </div>
              <p className="text-[11px] text-[#B0B8C1] mt-2">플랫폼에서 사용하는 상품명을 등록하면 주문 동기화 시 자동 매칭됩니다.</p>
            </div>
          </div>
        </div>
      )}

      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => { setImportOpen(false); load(); }}
        title="플랫폼 상품정보 엑셀 업로드"
        templateType="platform-skus"
        templateUrl="/api/platform-skus/template"
        importUrl="/api/platform-skus/import"
        columns={['SKU코드', '채널명', '플랫폼상품명', '플랫폼상품ID', '판매가', '쿠폰할인', '수수료율(%)', '입출고배송비', '반품회수비', '반품재입고비', '창고발송비', '포장비']}
        description="SKU코드와 채널명은 필수입니다. 채널명은 설정>채널에 등록된 이름과 동일해야 합니다."
      />

      </>}

    </div>
  );
}
