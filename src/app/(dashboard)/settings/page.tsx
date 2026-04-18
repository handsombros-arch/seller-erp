'use client';

import { useEffect, useState } from 'react';
import { Plus, Loader2, Pencil, Warehouse, Radio, User, Link2, CheckCircle2, AlertCircle, Trash2, RefreshCw, Save } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { Warehouse as WarehouseType, Channel } from '@/types';

const WAREHOUSE_TYPE_LABELS: Record<string, string> = {
  own:      '자사창고',
  coupang:  '쿠팡그로스',
  '3pl':    '3PL',
  other:    '기타',
};

const CHANNEL_TYPE_LABELS: Record<string, string> = {
  coupang:    '쿠팡',
  toss:       '토스',
  smartstore: '스마트스토어',
  other:      '기타',
};

const WAREHOUSE_TYPE_BADGE: Record<string, string> = {
  own:      'bg-blue-100 text-blue-700',
  coupang:  'bg-red-100 text-red-700',
  '3pl':    'bg-purple-100 text-purple-700',
  other:    'bg-gray-100 text-gray-600',
};

const CHANNEL_TYPE_BADGE: Record<string, string> = {
  coupang:    'bg-red-100 text-red-700',
  toss:       'bg-blue-100 text-blue-700',
  smartstore: 'bg-green-100 text-green-700',
  other:      'bg-gray-100 text-gray-600',
};

// ───────────────── Warehouse section ─────────────────

function WarehouseSection() {
  const [warehouses, setWarehouses] = useState<WarehouseType[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WarehouseType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'own', location: '' });

  async function fetchWarehouses() {
    const data = await fetch('/api/settings/warehouses').then((r) => r.json());
    setWarehouses(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => { fetchWarehouses(); }, []);

  function openAdd() {
    setEditTarget(null);
    setForm({ name: '', type: 'own', location: '' });
    setOpen(true);
  }

  function openEdit(w: WarehouseType) {
    setEditTarget(w);
    setForm({ name: w.name, type: w.type, location: w.location ?? '' });
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const body = { name: form.name, type: form.type, location: form.location || null };

    if (editTarget) {
      await fetch(`/api/settings/warehouses`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editTarget.id, ...body }),
      });
    } else {
      await fetch('/api/settings/warehouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    setSubmitting(false);
    setOpen(false);
    fetchWarehouses();
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Warehouse className="w-4 h-4 text-[#3182F6]" />
          <h2 className="text-[13px] font-bold text-[#191F28]">창고 관리</h2>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1 px-3.5 py-1.5 bg-[#3182F6] text-white text-[13px] font-medium rounded-xl hover:bg-[#1B64DA] transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          창고 추가
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-[#3182F6]" />
          </div>
        ) : warehouses.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-[#B0B8C1]">등록된 창고가 없습니다</div>
        ) : (
          <div className="divide-y divide-[#F2F4F6]">
            {warehouses.map((w) => (
              <div key={w.id} className="flex items-center justify-between px-5 py-4 hover:bg-[#F9FAFB] transition-colors">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium text-[#191F28]">{w.name}</p>
                    <span className={`inline-block px-2 py-0.5 rounded-lg text-[11px] font-medium ${WAREHOUSE_TYPE_BADGE[w.type] ?? 'bg-gray-100 text-gray-600'}`}>
                      {WAREHOUSE_TYPE_LABELS[w.type] ?? w.type}
                    </span>
                    {!w.is_active && (
                      <span className="inline-block px-2 py-0.5 rounded-lg text-[11px] font-medium bg-gray-100 text-gray-500">비활성</span>
                    )}
                  </div>
                  {w.location && (
                    <p className="text-[12px] text-[#B0B8C1] mt-0.5">{w.location}</p>
                  )}
                </div>
                <button
                  onClick={() => openEdit(w)}
                  className="flex items-center gap-1 px-3 py-1.5 text-[12px] text-[#6B7684] bg-[#F2F4F6] rounded-xl hover:bg-[#E5E8EB] transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  수정
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-white rounded-2xl max-w-sm p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
            <DialogTitle className="text-[15px] font-bold text-[#191F28]">
              {editTarget ? '창고 수정' : '창고 추가'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">창고명 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  placeholder="창고명 입력"
                  className="w-full px-3 py-2 text-[13px] border border-[#E5E8EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">유형 *</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2 text-[13px] border border-[#E5E8EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6] bg-white"
                >
                  {Object.entries(WAREHOUSE_TYPE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">위치</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="주소 또는 위치 설명 (선택사항)"
                  className="w-full px-3 py-2 text-[13px] border border-[#E5E8EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                />
              </div>
            </div>
            <DialogFooter className="px-6 pb-6 pt-0 gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 px-4 py-2.5 text-[13px] font-medium text-[#6B7684] bg-[#F2F4F6] rounded-xl hover:bg-[#E5E8EB] transition-colors"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-[13px] font-medium text-white bg-[#3182F6] rounded-xl hover:bg-[#1B64DA] transition-colors disabled:opacity-60"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {editTarget ? '저장' : '추가'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ───────────────── Channel section ─────────────────

function ChannelSection() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Channel | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'coupang' });

  async function fetchChannels() {
    const data = await fetch('/api/settings/channels').then((r) => r.json());
    setChannels(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => { fetchChannels(); }, []);

  function openAdd() {
    setEditTarget(null);
    setForm({ name: '', type: 'coupang' });
    setOpen(true);
  }

  function openEdit(c: Channel) {
    setEditTarget(c);
    setForm({ name: c.name, type: c.type });
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    if (editTarget) {
      await fetch('/api/settings/channels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editTarget.id, name: form.name, type: form.type }),
      });
    } else {
      await fetch('/api/settings/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, type: form.type }),
      });
    }
    setSubmitting(false);
    setOpen(false);
    setForm({ name: '', type: 'coupang' });
    fetchChannels();
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-[#3182F6]" />
          <h2 className="text-[13px] font-bold text-[#191F28]">채널 관리</h2>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1 px-3.5 py-1.5 bg-[#3182F6] text-white text-[13px] font-medium rounded-xl hover:bg-[#1B64DA] transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          채널 추가
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-[#3182F6]" />
          </div>
        ) : channels.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-[#B0B8C1]">등록된 채널이 없습니다</div>
        ) : (
          <div className="divide-y divide-[#F2F4F6]">
            {channels.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-5 py-4 hover:bg-[#F9FAFB] transition-colors">
                <div className="flex items-center gap-3">
                  <span className={`inline-block px-2 py-0.5 rounded-lg text-[11px] font-medium ${CHANNEL_TYPE_BADGE[c.type] ?? 'bg-gray-100 text-gray-600'}`}>
                    {CHANNEL_TYPE_LABELS[c.type] ?? c.type}
                  </span>
                  <p className="text-[13px] font-medium text-[#191F28]">{c.name}</p>
                  {!c.is_active && (
                    <span className="inline-block px-2 py-0.5 rounded-lg text-[11px] font-medium bg-gray-100 text-gray-500">비활성</span>
                  )}
                </div>
                <button
                  onClick={() => openEdit(c)}
                  className="flex items-center gap-1 px-3 py-1.5 text-[12px] text-[#6B7684] bg-[#F2F4F6] rounded-xl hover:bg-[#E5E8EB] transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  수정
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-white rounded-2xl max-w-sm p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
            <DialogTitle className="text-[15px] font-bold text-[#191F28]">{editTarget ? '채널 수정' : '채널 추가'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">채널명 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  placeholder="예: 쿠팡 공식스토어"
                  className="w-full px-3 py-2 text-[13px] border border-[#E5E8EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#191F28] mb-1.5">유형 *</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2 text-[13px] border border-[#E5E8EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6] bg-white"
                >
                  {Object.entries(CHANNEL_TYPE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <DialogFooter className="px-6 pb-6 pt-0 gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 px-4 py-2.5 text-[13px] font-medium text-[#6B7684] bg-[#F2F4F6] rounded-xl hover:bg-[#E5E8EB] transition-colors"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-[13px] font-medium text-white bg-[#3182F6] rounded-xl hover:bg-[#1B64DA] transition-colors disabled:opacity-60"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {editTarget ? '저장' : '추가'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ───────────────── Account section ─────────────────

function AccountSection() {
  const [email, setEmail] = useState<string>('');
  const [showPwForm, setShowPwForm] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => {
      if (d?.email) setEmail(d.email);
    }).catch(() => {});
  }, []);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (pwForm.next !== pwForm.confirm) {
      setPwMsg({ type: 'err', text: '새 비밀번호가 일치하지 않습니다' });
      return;
    }
    if (pwForm.next.length < 6) {
      setPwMsg({ type: 'err', text: '비밀번호는 6자 이상이어야 합니다' });
      return;
    }
    setPwLoading(true);
    setPwMsg(null);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwForm.next }),
      });
      if (res.ok) {
        setPwMsg({ type: 'ok', text: '비밀번호가 변경되었습니다' });
        setPwForm({ current: '', next: '', confirm: '' });
        setShowPwForm(false);
      } else {
        const d = await res.json();
        setPwMsg({ type: 'err', text: d.error ?? '변경 실패' });
      }
    } catch {
      setPwMsg({ type: 'err', text: '오류가 발생했습니다' });
    }
    setPwLoading(false);
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <User className="w-4 h-4 text-[#3182F6]" />
        <h2 className="text-[13px] font-bold text-[#191F28]">계정 정보</h2>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden divide-y divide-[#F2F4F6]">
        {/* Email row */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-[12px] text-[#6B7684] mb-0.5">이메일</p>
            <p className="text-[13px] font-medium text-[#191F28]">{email || '-'}</p>
          </div>
        </div>

        {/* Password row */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] text-[#6B7684] mb-0.5">비밀번호</p>
              <p className="text-[13px] text-[#191F28]">••••••••</p>
            </div>
            <button
              onClick={() => { setShowPwForm((v) => !v); setPwMsg(null); }}
              className="px-3.5 py-1.5 text-[13px] font-medium text-[#3182F6] bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors"
            >
              {showPwForm ? '취소' : '변경'}
            </button>
          </div>

          {showPwForm && (
            <form onSubmit={handlePasswordChange} className="mt-4 space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-[#6B7684] mb-1">새 비밀번호</label>
                <input
                  type="password"
                  value={pwForm.next}
                  onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))}
                  required
                  placeholder="새 비밀번호 (6자 이상)"
                  className="w-full px-3 py-2 text-[13px] border border-[#E5E8EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6B7684] mb-1">새 비밀번호 확인</label>
                <input
                  type="password"
                  value={pwForm.confirm}
                  onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
                  required
                  placeholder="새 비밀번호 재입력"
                  className="w-full px-3 py-2 text-[13px] border border-[#E5E8EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3182F6]"
                />
              </div>

              {pwMsg && (
                <p className={`text-[12px] ${pwMsg.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
                  {pwMsg.text}
                </p>
              )}

              <button
                type="submit"
                disabled={pwLoading}
                className="flex items-center justify-center gap-1.5 w-full py-2.5 text-[13px] font-medium text-white bg-[#3182F6] rounded-xl hover:bg-[#1B64DA] transition-colors disabled:opacity-60"
              >
                {pwLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                비밀번호 변경
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

// ───────────────── Coupang API section ─────────────────

const iCls = 'w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[13px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors';

function CoupangApiSection() {
  const [connected, setConnected] = useState<{ vendor_id: string; updated_at: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [form, setForm] = useState({ access_key: '', secret_key: '', vendor_id: '' });
  const [rgSaverEnabled, setRgSaverEnabled] = useState(false);
  const [rgSaverLoading, setRgSaverLoading] = useState(false);

  useEffect(() => {
    fetch('/api/coupang/credentials')
      .then((r) => r.json())
      .then((d) => { setConnected(d); setRgSaverEnabled(!!d?.rg_saver_enabled); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/coupang/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setConnected({ vendor_id: form.vendor_id, updated_at: new Date().toISOString() });
      setMsg({ type: 'ok', text: 'API 키가 저장되었습니다.' });
      setShowForm(false);
      setForm({ access_key: '', secret_key: '', vendor_id: '' });
    } catch (err: any) {
      setMsg({ type: 'err', text: err.message ?? '저장 실패' });
    }
    setSaving(false);
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Link2 className="w-4 h-4 text-[#3182F6]" />
        <h2 className="text-[13px] font-bold text-[#191F28]">쿠팡 Open API 연동</h2>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden divide-y divide-[#F2F4F6]">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-[#3182F6]" />
          </div>
        ) : (
          <div className="px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {connected ? (
                <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-[#B0B8C1] shrink-0" />
              )}
              <div>
                {connected ? (
                  <>
                    <p className="text-[13px] font-medium text-[#191F28]">연동됨 · Vendor ID: {connected.vendor_id}</p>
                    <p className="text-[12px] text-[#B0B8C1] mt-0.5">
                      마지막 업데이트 {new Date(connected.updated_at).toLocaleDateString('ko-KR')}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] font-medium text-[#191F28]">API 키 미등록</p>
                    <p className="text-[12px] text-[#B0B8C1] mt-0.5">쿠팡 Wing &gt; 개발자 센터에서 API 키를 발급받으세요</p>
                  </>
                )}
              </div>
            </div>
            <button
              onClick={() => { setShowForm((v) => !v); setMsg(null); }}
              className="px-3.5 py-1.5 text-[13px] font-medium text-[#3182F6] bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors"
            >
              {showForm ? '취소' : connected ? '재등록' : '등록'}
            </button>
          </div>
        )}

        {/* 로켓그로스 세이버 */}
        {connected && !showForm && (
          <div className="px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-[#191F28]">로켓그로스 세이버</p>
              <p className="text-[12px] text-[#B0B8C1] mt-0.5">월 99,000원(VAT별도) · 반품회수비/재입고비 면제</p>
            </div>
            <button
              disabled={rgSaverLoading}
              onClick={async () => {
                const next = !rgSaverEnabled;
                setRgSaverLoading(true);
                await fetch('/api/coupang/credentials', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rg_saver_enabled: next }) });
                setRgSaverEnabled(next);
                setRgSaverLoading(false);
              }}
              className={`px-4 py-2 rounded-xl text-[13px] font-semibold transition-all active:scale-95 ${
                rgSaverEnabled ? 'bg-[#3182F6] text-white ring-2 ring-[#3182F6]/30' : 'bg-[#F2F4F6] text-[#6B7684] hover:bg-[#E5E8EB]'
              }`}>
              {rgSaverLoading ? '...' : rgSaverEnabled ? '구독 중 ✓' : '미구독'}
            </button>
          </div>
        )}

        {showForm && (
          <form onSubmit={handleSave} className="px-5 py-5 space-y-4">
            <div className="bg-[#EBF1FE] rounded-xl px-4 py-3 text-[12px] text-[#3182F6] space-y-1">
              <p className="font-semibold">쿠팡 Wing API 키 발급 방법</p>
              <p>1. wing.coupang.com 로그인 → 상단 메뉴 &gt; 개발자 센터</p>
              <p>2. API 키 발급 → Access Key / Secret Key 복사</p>
              <p>3. Vendor ID = 업체코드 (Wing 우측 상단 업체정보에서 확인)</p>
            </div>
            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-[#191F28]">Access Key *</label>
              <input className={iCls} placeholder="Access Key" value={form.access_key}
                onChange={(e) => setForm((f) => ({ ...f, access_key: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-[#191F28]">Secret Key *</label>
              <input className={iCls} type="password" placeholder="Secret Key" value={form.secret_key}
                onChange={(e) => setForm((f) => ({ ...f, secret_key: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-[#191F28]">Vendor ID (업체코드) *</label>
              <input className={iCls} placeholder="예: A00012345" value={form.vendor_id}
                onChange={(e) => setForm((f) => ({ ...f, vendor_id: e.target.value }))} required />
            </div>
            {msg && (
              <p className={`text-[12px] ${msg.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</p>
            )}
            <button type="submit" disabled={saving}
              className="flex items-center justify-center gap-1.5 w-full py-2.5 text-[13px] font-medium text-white bg-[#3182F6] rounded-xl hover:bg-[#1B64DA] transition-colors disabled:opacity-60">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              API 키 저장
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

// ───────────────── Naver API section ─────────────────

function NaverApiSection() {
  const [connected, setConnected] = useState<{ client_id: string; updated_at: string } | null>(null);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [form, setForm]           = useState({ clientId: '', clientSecret: '' });

  useEffect(() => {
    fetch('/api/naver/credentials')
      .then((r) => r.json())
      .then((d) => { setConnected(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    try {
      const res = await fetch('/api/naver/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setConnected({ client_id: form.clientId, updated_at: new Date().toISOString() });
      setMsg({ type: 'ok', text: 'API 키가 저장되었습니다.' });
      setShowForm(false);
      setForm({ clientId: '', clientSecret: '' });
    } catch (err: any) {
      setMsg({ type: 'err', text: err.message ?? '저장 실패' });
    }
    setSaving(false);
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Link2 className="w-4 h-4 text-green-600" />
        <h2 className="text-[13px] font-bold text-[#191F28]">네이버 커머스 API 연동</h2>
      </div>
      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden divide-y divide-[#F2F4F6]">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-[#3182F6]" />
          </div>
        ) : (
          <div className="px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {connected ? (
                <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-[#B0B8C1] shrink-0" />
              )}
              <div>
                {connected ? (
                  <>
                    <p className="text-[13px] font-medium text-[#191F28]">연동됨 · Client ID: {connected.client_id}</p>
                    <p className="text-[12px] text-[#B0B8C1] mt-0.5">마지막 업데이트 {new Date(connected.updated_at).toLocaleDateString('ko-KR')}</p>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] font-medium text-[#191F28]">API 키 미등록</p>
                    <p className="text-[12px] text-[#B0B8C1] mt-0.5">네이버 스마트스토어센터 → 판매자 정보 → API 연동에서 발급</p>
                  </>
                )}
              </div>
            </div>
            <button onClick={() => { setShowForm((v) => !v); setMsg(null); }}
              className="px-3.5 py-1.5 text-[13px] font-medium text-green-700 bg-green-50 rounded-xl hover:bg-green-100 transition-colors">
              {showForm ? '취소' : connected ? '재등록' : '등록'}
            </button>
          </div>
        )}
        {showForm && (
          <form onSubmit={handleSave} className="px-5 py-5 space-y-4">
            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-[#191F28]">애플리케이션 ID (Client ID) *</label>
              <input className={iCls} placeholder="예: 3WVCb8BX18oosE3uvsYSnP" value={form.clientId}
                onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-[#191F28]">Client Secret *</label>
              <input className={iCls} type="password" placeholder="Client Secret" value={form.clientSecret}
                onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))} required />
            </div>
            {msg && <p className={`text-[12px] ${msg.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</p>}
            <button type="submit" disabled={saving}
              className="flex items-center justify-center gap-1.5 w-full py-2.5 text-[13px] font-medium text-white bg-green-600 rounded-xl hover:bg-green-700 transition-colors disabled:opacity-60">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              API 키 저장
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

// ───────────────── Data Reset section ─────────────────

function DataResetSection() {
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleReset() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/reset-data', { method: 'POST' });
      const d = await res.json();
      if (d.ok) {
        setResult({ ok: true, msg: `${d.cleared.length}개 테이블 초기화 완료` });
      } else {
        setResult({ ok: false, msg: (d.errors ?? [d.error ?? '오류']).join(', ') });
      }
    } catch {
      setResult({ ok: false, msg: '요청 실패' });
    }
    setLoading(false);
    setConfirm(false);
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Trash2 className="w-4 h-4 text-red-500" />
        <h2 className="text-[13px] font-bold text-[#191F28]">데이터 초기화</h2>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="px-5 py-4">
          <p className="text-[13px] text-[#6B7684]">
            상품·SKU·공급처·재고·입출고·채널판매 데이터를 모두 삭제합니다.<br />
            <span className="text-red-500 font-medium">창고·채널 설정은 유지됩니다. 이 작업은 되돌릴 수 없습니다.</span>
          </p>

          {!confirm ? (
            <button
              onClick={() => { setConfirm(true); setResult(null); }}
              className="mt-3 flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-red-600 bg-red-50 rounded-xl hover:bg-red-100 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              데이터 초기화
            </button>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[13px] text-red-600 font-medium">정말 삭제할까요?</span>
              <button
                onClick={handleReset}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors disabled:opacity-60"
              >
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                확인
              </button>
              <button
                onClick={() => setConfirm(false)}
                className="px-4 py-2 text-[13px] font-medium text-[#6B7684] bg-[#F2F4F6] rounded-xl hover:bg-[#E5E8EB] transition-colors"
              >
                취소
              </button>
            </div>
          )}

          {result && (
            <div className={`mt-3 flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium ${result.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
              {result.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              {result.msg}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ───────────────── Manual Sync section ─────────────────

const SYNC_CHANNELS = [
  { key: 'coupang_rg', label: '쿠팡 그로스', color: 'bg-red-100 text-red-700' },
  { key: 'coupang', label: '쿠팡 Wing', color: 'bg-red-100 text-red-700' },
  { key: 'smartstore', label: '스마트스토어', color: 'bg-green-100 text-green-700' },
  { key: 'toss', label: '토스', color: 'bg-blue-100 text-blue-700' },
] as const;

function ManualSyncSection() {
  const [syncing, setSyncing] = useState<string | null>(null); // 'all' | channel key | null
  const [results, setResults] = useState<Record<string, any> | null>(null);

  const runSync = async (channels: string[]) => {
    const key = channels.length === 4 ? 'all' : channels[0];
    setSyncing(key);
    setResults(null);
    try {
      const res = await fetch('/api/sync/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels }),
      });
      const json = await res.json();
      setResults(json);
    } catch (err: any) {
      setResults({ error: err.message });
    } finally {
      setSyncing(null);
    }
  };

  const isDisabled = syncing !== null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <RefreshCw className="w-5 h-5 text-[#333D4B]" />
        <h2 className="text-[15px] font-bold text-[#191F28]">수동 동기화</h2>
      </div>
      <div className="bg-white rounded-2xl border border-[#E5E8EB] p-5">
        <p className="text-[12px] text-[#6B7684] mb-4">
          자동 동기화(매일 08:00 KST)가 실패했을 때 수동으로 실행합니다. 최근 3일 주문을 동기화합니다.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            disabled={isDisabled}
            onClick={() => runSync(['coupang_rg', 'coupang', 'smartstore', 'toss'])}
            className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold text-white bg-[#333D4B] rounded-xl hover:bg-[#191F28] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {syncing === 'all' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            전체 동기화
          </button>

          {SYNC_CHANNELS.map((ch) => (
            <button
              key={ch.key}
              disabled={isDisabled}
              onClick={() => runSync([ch.key])}
              className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-xl border border-[#E5E8EB] hover:bg-[#F9FAFB] disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
            >
              {syncing === ch.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {ch.label}
            </button>
          ))}
        </div>

        {results && (
          <div className="space-y-1.5 p-3 bg-[#F9FAFB] rounded-xl text-[12px]">
            {results.error && (
              <div className="flex items-center gap-1.5 text-red-600">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {results.error}
              </div>
            )}
            {SYNC_CHANNELS.map((ch) => {
              const r = results[ch.key];
              if (!r) return null;
              const ok = !r.error;
              return (
                <div key={ch.key} className="flex items-center gap-2">
                  {ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  )}
                  <span className={`font-medium ${ch.color} px-1.5 py-0.5 rounded`}>{ch.label}</span>
                  <span className="text-[#4E5968]">
                    {ok ? `${r.synced ?? 0}건 동기화` : r.error}
                  </span>
                </div>
              );
            })}
            {results.inventory && (
              <div className="flex items-center gap-2 text-[#4E5968]">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
                <span>재고 차감 {results.inventory.deducted ?? 0}건 / 복구 {results.inventory.restored ?? 0}건</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// (Settlement components moved to /settlement/page.tsx)
// ───────────────── Main page ─────────────────

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[20px] font-bold text-[#191F28]">설정</h1>
        <p className="text-[13px] text-[#6B7684] mt-0.5">창고, 채널, 계정을 관리합니다</p>
      </div>
      <ManualSyncSection />
      <WarehouseSection />
      <ChannelSection />
      <CoupangApiSection />
      <NaverApiSection />
      <AccountSection />
      <DataResetSection />
    </div>
  );
}
