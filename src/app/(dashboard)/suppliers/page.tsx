'use client';

import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Loader2, X, Building2, Phone, Mail, Clock, MapPin, Upload, Package } from 'lucide-react';
import type { SupplierAddress } from '@/types';
import type { Supplier } from '@/types';
import CsvImportDialog from '@/components/CsvImportDialog';

// ─── Dialog ──────────────────────────────────────────────────────────────────

function Dialog({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
          <h2 className="text-[15px] font-bold text-[#191F28]">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6]">
            <X className="h-4 w-4 text-[#6B7684]" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[13px] font-medium text-[#191F28]">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = 'w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors';

// ─── Supplier Form ────────────────────────────────────────────────────────────

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

interface FormState {
  name: string; contact_person: string;
  phone_country_code: string; phone: string;
  email: string; country: string; lead_time_days: string;
  main_products: string; note: string;
  addresses: SupplierAddress[];
}

const EMPTY_FORM: FormState = {
  name: '', contact_person: '',
  phone_country_code: '+86', phone: '',
  email: '', country: '중국', lead_time_days: '21',
  main_products: '', note: '',
  addresses: [],
};

function SupplierForm({ initial, onSave, onCancel, loading }: {
  initial: FormState;
  onSave: (f: FormState) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [form, setForm] = useState(initial);
  const [addrInput, setAddrInput] = useState({ type: 'office' as SupplierAddress['type'], label: '쇼룸/사무실', address: '' });
  const set = (k: keyof FormState, v: any) => setForm((f) => ({ ...f, [k]: v }));

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
      <Field label="회사명 / 제조사명" required>
        <input lang="ko" className={inputCls} placeholder="예: 선전전자공장" value={form.name} onChange={(e) => set('name', e.target.value)} required />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="담당자">
          <input lang="ko" className={inputCls} placeholder="담당자 이름" value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
        </Field>
        <Field label="국가">
          <input lang="ko" className={inputCls} placeholder="중국" value={form.country} onChange={(e) => set('country', e.target.value)} />
        </Field>
      </div>
      {/* 연락처 (국가번호 + 번호) */}
      <Field label="연락처">
        <div className="flex gap-2">
          <select
            value={form.phone_country_code}
            onChange={(e) => set('phone_country_code', e.target.value)}
            className="h-11 px-2 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] bg-white focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors shrink-0"
          >
            {COUNTRY_CODES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
          <input
            className={inputCls}
            placeholder="010-1234-5678"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
        </div>
      </Field>
      <Field label="이메일">
        <input className={inputCls} type="email" placeholder="example@email.com" value={form.email} onChange={(e) => set('email', e.target.value)} />
      </Field>
      <Field label="기본 리드타임 (일)">
        <div className="flex items-center gap-2">
          <input className={inputCls} type="number" min="1" max="365" placeholder="21" value={form.lead_time_days} onChange={(e) => set('lead_time_days', e.target.value)} />
          <span className="text-[13px] text-[#6B7684] whitespace-nowrap">일</span>
        </div>
        <p className="text-[11px] text-[#B0B8C1] mt-1">발주일로부터 입고까지 평균 소요 기간</p>
      </Field>

      <Field label="주요 상품">
        <input lang="ko" className={inputCls} placeholder="예: 백팩, 가방류, 의류" value={form.main_products} onChange={(e) => set('main_products', e.target.value)} />
      </Field>

      {/* 주소 관리 */}
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
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div className="border border-[#E5E8EB] rounded-xl p-3 space-y-2">
          <div className="flex gap-2">
            <select
              value={addrInput.type}
              onChange={(e) => handleAddrTypeChange(e.target.value as SupplierAddress['type'])}
              className="h-10 px-2 rounded-xl border border-[#E5E8EB] text-[13px] bg-white focus:outline-none focus:border-[#3182F6] transition-colors shrink-0"
            >
              {ADDRESS_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input
              lang="ko"
              className="flex-1 h-10 px-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] transition-colors"
              placeholder="주소 입력"
              value={addrInput.address}
              onChange={(e) => setAddrInput((a) => ({ ...a, address: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAddress(); } }}
            />
            <button type="button" onClick={addAddress} className="h-10 w-9 flex items-center justify-center rounded-xl bg-[#EBF1FE] text-[#3182F6] hover:bg-[#3182F6] hover:text-white transition-colors shrink-0">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <Field label="메모">
        <textarea
          lang="ko"
          className="w-full px-3.5 py-3 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors resize-none"
          rows={2} placeholder="특이사항, 계좌 정보 등"
          value={form.note} onChange={(e) => set('note', e.target.value)}
        />
      </Field>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
          취소
        </button>
        <button type="submit" disabled={loading} className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          저장
        </button>
      </div>
    </form>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SuppliersPage() {
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

  function formToBody(form: FormState) {
    return {
      name: form.name.trim(),
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

  async function handleAdd(form: FormState) {
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

  async function handleEdit(form: FormState) {
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold tracking-[-0.03em] text-[#191F28]">공급처 관리</h2>
          <p className="mt-1 text-[13px] text-[#6B7684]">제조사 / 공급처 정보를 등록하고 발주 시 불러옵니다</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setCsvOpen(true)} className="flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors whitespace-nowrap">
            <Upload className="h-4 w-4" /> CSV 업로드
          </button>
          <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 h-10 px-4 rounded-xl bg-[#3182F6] text-white text-[13px] font-semibold hover:bg-[#1B64DA] transition-colors whitespace-nowrap">
            <Plus className="h-4 w-4" /> 공급처 추가
          </button>
        </div>
      </div>

      {/* List */}
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
                      {s.country && (
                        <span className="text-[11px] font-medium px-2 py-0.5 bg-[#F2F4F6] text-[#6B7684] rounded-full">{s.country}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-2 flex-wrap">
                      {s.contact_person && (
                        <span className="flex items-center gap-1 text-[12px] text-[#6B7684]">
                          <span className="text-[#B0B8C1]">담당자</span> {s.contact_person}
                        </span>
                      )}
                      {s.phone && (
                        <span className="flex items-center gap-1 text-[12px] text-[#6B7684]">
                          <Phone className="h-3.5 w-3.5 text-[#B0B8C1]" />
                          {s.phone_country_code && `${s.phone_country_code} `}{s.phone}
                        </span>
                      )}
                      {s.email && (
                        <span className="flex items-center gap-1 text-[12px] text-[#6B7684]">
                          <Mail className="h-3.5 w-3.5 text-[#B0B8C1]" /> {s.email}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-[12px] font-medium text-[#3182F6]">
                        <Clock className="h-3.5 w-3.5" /> 리드타임 {s.lead_time_days}일
                      </span>
                      {s.main_products && (
                        <span className="flex items-center gap-1 text-[12px] text-[#6B7684]">
                          <Package className="h-3.5 w-3.5 text-[#B0B8C1]" /> {s.main_products}
                        </span>
                      )}
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
                    {s.note && (
                      <p className="text-[12px] text-[#B0B8C1] mt-1.5 line-clamp-1">{s.note}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setEditTarget(s)}
                    className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6] text-[#B0B8C1] hover:text-[#6B7684] transition-colors"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setDeleteId(s.id)}
                    className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-red-50 text-[#B0B8C1] hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 추가 다이얼로그 */}
      <CsvImportDialog
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        onImported={load}
        title="공급처 CSV 일괄 등록"
        templateType="suppliers"
        importUrl="/api/suppliers/import"
        columns={['업체명', '담당자', '국가코드', '전화번호', '이메일', '국가', '리드타임(일)']}
        description="업체명이 중복되면 건너뜁니다."
      />

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="공급처 추가">
        <SupplierForm
          initial={EMPTY_FORM}
          onSave={handleAdd}
          onCancel={() => setAddOpen(false)}
          loading={saving}
        />
      </Dialog>

      {/* 수정 다이얼로그 */}
      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)} title="공급처 수정">
        {editTarget && (
          <SupplierForm
            initial={{
              name: editTarget.name,
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
            onSave={handleEdit}
            onCancel={() => setEditTarget(null)}
            loading={saving}
          />
        )}
      </Dialog>

      {/* 삭제 확인 */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDeleteId(null)} />
          <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full max-w-sm mx-4 p-6">
            <h3 className="text-[15px] font-bold text-[#191F28] mb-2">공급처 삭제</h3>
            <p className="text-[13px] text-[#6B7684]">삭제 후 복구할 수 없습니다. 이 공급처를 사용하는 SKU와의 연결도 해제됩니다.</p>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setDeleteId(null)} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[13px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
                취소
              </button>
              <button onClick={() => handleDelete(deleteId)} className="flex-1 h-11 rounded-xl bg-red-500 text-white text-[13px] font-semibold hover:bg-red-600 transition-colors">
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
