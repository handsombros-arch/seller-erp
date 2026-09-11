'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Loader2, Pencil, Plus, Power, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppDialog } from '@/components/ui/app-dialog';
import { SegmentedControl } from '@/components/ui/tabs';
import { InfoTip } from '@/components/ui/info-tip';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { CHANNEL_LABEL, KIND_LABEL, couponStatus, overlapFraction, type Coupon, type CouponChannel, type CouponKind, type DiscountType } from '@/lib/settlement/coupons';
import { currentYm, ymLabel } from '../_lib/settlement';

/**
 * 쿠폰·할인 관리 — 마스터 고정값 대신 기간이 있는 쿠폰을 채널별로 관리한다.
 * 엑셀(상품명·쿠폰명·옵션ID·종·할인률·시작·종료)을 그대로 가져오거나 손으로 추가. 상품별 순이익·오가닉 탭·대조 검산이 이 표를 쓴다.
 */
const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\. /g, '.').replace(/\.$/, '') : '종료일 없음';
const toLocal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromLocal = (s: string) => s ? new Date(s).toISOString() : null;
const discLabel = (c: Pick<Coupon, 'discount_type' | 'value'>) => c.discount_type === 'rate' ? `${c.value}%` : `${fmt(c.value)}원`;
const monthRange = (ym: string) => { const [y, m] = ym.split('-').map(Number); return { from: `${ym}-01`, to: `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }; };
const STATUS: Record<ReturnType<typeof couponStatus>, { label: string; cls: string }> = { active: { label: '진행 중', cls: 'bg-success/10 text-success' }, upcoming: { label: '예정', cls: 'bg-info/10 text-info' }, ended: { label: '종료', cls: 'bg-card-2 text-fg-4' } };

interface Form { id?: string; channel: CouponChannel; name: string; kind: CouponKind; discount_type: DiscountType; value: string; starts_at: string; ends_at: string; note: string; itemsText: string }
const emptyForm = (channel: CouponChannel, ym: string): Form => { const { from, to } = monthRange(ym); return { channel, name: '', kind: 'instant', discount_type: 'rate', value: '', starts_at: `${from}T00:00`, ends_at: `${to}T23:59`, note: '', itemsText: '' }; };
const itemsToText = (items: Coupon['items']) => items.map(i => i.product_name ? `${i.platform_sku_id}\t${i.product_name}` : i.platform_sku_id).join('\n');
const textToItems = (t: string) => t.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => { const m = /^(\d{6,})[\s,\t]*(.*)$/.exec(l); return m ? { platform_sku_id: m[1], product_name: m[2].trim() || null } : { platform_sku_id: l.split(/[\s,\t]/)[0], product_name: l.slice(l.split(/[\s,\t]/)[0].length).trim() || null }; });

export function CouponManager({ initialYm }: { initialYm?: string }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [channel, setChannel] = useState<CouponChannel>('coupang');
  const [ym, setYm] = useState(initialYm ?? currentYm());
  const [showAll, setShowAll] = useState(false);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [replaceAll, setReplaceAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const j = await fetch(`/api/coupons?channel=${channel}`).then(r => r.json()).catch(() => ({ coupons: [] }));
    setCoupons(j.coupons ?? []); setNeedsMigration(!!j.needsMigration); setLoading(false);
  }, [channel]);
  useEffect(() => { load(); }, [load]);

  const { from, to } = monthRange(ym);
  const shown = useMemo(() => showAll ? coupons : coupons.filter(c => overlapFraction(c, from, to) > 0), [coupons, showAll, from, to]);
  const summary = useMemo(() => {
    const vids = new Set<string>(); let unmatched = 0; let active = 0;
    for (const c of shown) { if (couponStatus(c) === 'active') active++; for (const i of c.items) { vids.add(i.platform_sku_id); if (!i.sku_id) unmatched++; } }
    return { active, options: vids.size, unmatched };
  }, [shown]);

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const body = { id: form.id, channel: form.channel, name: form.name, kind: form.kind, discount_type: form.discount_type, value: Number(form.value.replace(/[^0-9.]/g, '')), starts_at: fromLocal(form.starts_at), ends_at: fromLocal(form.ends_at), note: form.note || null, items: textToItems(form.itemsText) };
      const r = await fetch('/api/coupons', { method: form.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.error ?? '저장 실패'); setNeedsMigration(!!j.needsMigration); return; }
      toast.success(`${form.name} 저장 — 옵션 ${j.saved ?? 0}개 (SKU 연결 ${j.matched ?? 0})`);
      setForm(null); load();
    } finally { setSaving(false); }
  }
  async function endNow(c: Coupon) {
    if (!(await confirmDialog(`${c.name} 을 지금 종료할까요?\n종료 일시가 현재 시각으로 기록되고, 이후 기간에는 할인이 반영되지 않습니다.`))) return;
    const r = await fetch('/api/coupons', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, ends_at: new Date().toISOString() }) });
    if (!r.ok) { toast.error('종료 실패'); return; }
    toast.success('종료됨'); load();
  }
  function copyNext(c: Coupon) {
    const shift = (iso: string | null, months: number) => { if (!iso) return ''; const d = new Date(iso); d.setMonth(d.getMonth() + months); return toLocal(d.toISOString()); };
    setForm({ channel: c.channel, name: c.name, kind: c.kind, discount_type: c.discount_type, value: String(c.value), starts_at: shift(c.starts_at, 1), ends_at: shift(c.ends_at, 1), note: c.note ?? '', itemsText: itemsToText(c.items) });
  }
  async function remove(c: Coupon) {
    if (!(await confirmDialog(`${c.name} (${KIND_LABEL[c.kind]}, 옵션 ${c.items.length}개)를 지울까요?`))) return;
    const r = await fetch(`/api/coupons?id=${c.id}`, { method: 'DELETE' });
    if (!r.ok) { toast.error('삭제 실패'); return; }
    toast.success('삭제됨'); load();
  }
  async function importFile(f: File) {
    setImporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true }) as Record<string, unknown>[];
      if (!rows.length) { toast.warning('시트에 행이 없습니다'); return; }
      if (replaceAll && !(await confirmDialog(`${CHANNEL_LABEL[channel]} 쿠폰을 이 파일 기준으로 전체 교체합니다.\n파일에 없는 기존 쿠폰은 삭제됩니다. 계속할까요?`))) return;
      const r = await fetch('/api/coupons/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, rows: rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))), replace: replaceAll }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.error ?? '가져오기 실패'); setNeedsMigration(!!j.needsMigration); return; }
      toast.success(`쿠폰 ${j.coupons}개 (새로 ${j.created} · 갱신 ${j.updated}${j.removed ? ` · 삭제 ${j.removed}` : ''}) · 옵션 ${j.items}개 (SKU 연결 ${j.matched}, 미연결 ${j.unmatched})${j.skipped?.length ? ` · 건너뜀 ${j.skipped.length}행` : ''}`);
      if (j.skipped?.length) toast.warning(`건너뛴 행: ${j.skipped.slice(0, 5).join(', ')}`);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : '파일을 읽지 못했습니다'); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  const th = 'px-2 py-2 text-[11px] font-semibold text-fg-4 whitespace-nowrap text-left bg-card-2';
  const inp = 'h-8 px-2 rounded-lg border border-line bg-card text-[12px] focus:outline-none focus:border-brand w-full';
  return (
    <div className="space-y-4">
      <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="text-[15px] font-bold text-fg flex items-center gap-1">쿠폰·할인 관리<InfoTip text={'마켓에 등록한 즉시할인·다운로드 쿠폰을 기간과 함께 기록합니다.\n상품별 순이익·오가닉 vs 광고·대조 검산이 이 표로 상품 단위 쿠폰을 뺍니다. 월 정산 시트의 "판매자 할인쿠폰" 줄은 그대로 마켓 정산 금액을 씁니다.'} /></h2>
            <p className="text-[12px] text-fg-3 mt-0.5">쿠폰 하나에 옵션 여러 개. 즉시할인과 다운로드는 별개 쿠폰이며 둘 다 걸리면 합산됩니다. 시작·종료는 시각까지 기록합니다.</p>
          </div>
          <SegmentedControl items={[{ value: 'coupang', label: '쿠팡' }, { value: 'smartstore', label: '스스' }, { value: 'toss', label: '토스' }] as const} value={channel} onChange={setChannel} />
          <input type="month" value={ym} onChange={e => setYm(e.target.value)} className="h-8 px-2 rounded-lg border border-line bg-card text-[12px]" />
          <label className="flex items-center gap-1 text-[11px] text-fg-4"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> 전체 기간</label>
          <Button size="sm" onClick={() => setForm(emptyForm(channel, ym))}><Plus className="h-3.5 w-3.5" /> 쿠폰 추가</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-app px-3 py-2 text-[11px] text-fg-3">
          <span className="font-semibold text-fg-4">엑셀 가져오기</span>
          <span>열: 상품명 · 쿠폰명 · 옵션ID · 종(즉시할인/다운로드) · 할인률(% 또는 원) · 시작 · 종료. 같은 쿠폰명·종·시작이면 갱신됩니다.</span>
          <label className="flex items-center gap-1 ml-auto"><input type="checkbox" checked={replaceAll} onChange={e => setReplaceAll(e.target.checked)} /> 파일 기준 전체 교체<InfoTip text="켜면 이 채널의 기존 쿠폰 중 파일에 없는 것을 삭제합니다. 한 달 단위로 파일 전체를 갱신할 때 켜세요." /></label>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); }} />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>{importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {CHANNEL_LABEL[channel]} 파일 올리기</Button>
        </div>
        {needsMigration && <p className="text-[12px] text-warn">coupons 테이블이 없습니다. 마이그레이션 00075 를 적용해 주세요.</p>}
      </section>

      <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          <span className="font-bold text-fg">{showAll ? '전체 기간' : ymLabel(ym)} · {CHANNEL_LABEL[channel]}</span>
          <span className="text-fg-3">쿠폰 {shown.length}개 · 진행 중 {summary.active} · 옵션 {summary.options}개{summary.unmatched ? <span className="text-warn"> · 미연결 옵션 {summary.unmatched}</span> : null}</span>
        </div>
        {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div> : shown.length === 0 ? (
          <p className="text-[12px] text-fg-4 py-4">{coupons.length ? '이 달에 걸친 쿠폰이 없습니다. "전체 기간"을 켜면 모두 보입니다.' : '아직 쿠폰이 없습니다. 엑셀을 올리거나 "쿠폰 추가"로 넣어 주세요.'}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-[12px] border-collapse min-w-[900px]">
              <thead><tr className="h-9 border-b border-line">
                <th className={cn(th, 'w-6')} /><th className={th}>쿠폰명</th><th className={th}>종</th><th className={cn(th, 'text-right')}>할인</th><th className={th}>시작</th><th className={th}>종료</th><th className={cn(th, 'text-right')}>옵션</th><th className={th}>상태</th><th className={cn(th, 'text-right')}>동작</th>
              </tr></thead>
              <tbody>
                {shown.map(c => { const st = couponStatus(c); const isOpen = open.has(c.id); const unm = c.items.filter(i => !i.sku_id).length;
                  return [
                    <tr key={c.id} className="h-10 border-b border-line-2 hover:bg-app/60">
                      <td className="px-2"><button onClick={() => setOpen(s => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} className="p-0.5 rounded hover:bg-app text-fg-4">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button></td>
                      <td className="px-2 font-medium text-fg">{c.name}{c.note && c.note !== '엑셀 가져오기' ? <span className="block text-[10px] text-fg-5">{c.note}</span> : null}</td>
                      <td className={cn('px-2 whitespace-nowrap', c.kind === 'instant' ? 'text-brand' : 'text-info')}>{KIND_LABEL[c.kind]}</td>
                      <td className="px-2 text-right tabular-nums font-semibold">{discLabel(c)}</td>
                      <td className="px-2 whitespace-nowrap tabular-nums text-fg-3">{when(c.starts_at)}</td>
                      <td className="px-2 whitespace-nowrap tabular-nums text-fg-3">{when(c.ends_at)}</td>
                      <td className="px-2 text-right tabular-nums">{c.items.length}{unm ? <span className="text-[10px] text-warn ml-1" title="옵션ID 가 마스터에 없어 SKU 로 연결되지 않음">미연결 {unm}</span> : null}</td>
                      <td className="px-2"><span className={cn('px-1.5 py-0.5 rounded-md text-[10px] font-semibold', STATUS[st].cls)}>{STATUS[st].label}</span></td>
                      <td className="px-2 text-right whitespace-nowrap">
                        <button onClick={() => setForm({ id: c.id, channel: c.channel, name: c.name, kind: c.kind, discount_type: c.discount_type, value: String(c.value), starts_at: toLocal(c.starts_at), ends_at: toLocal(c.ends_at), note: c.note ?? '', itemsText: itemsToText(c.items) })} className="p-1 rounded-md hover:bg-app text-fg-3" title="수정"><Pencil className="h-3.5 w-3.5" /></button>
                        {st !== 'ended' && <button onClick={() => endNow(c)} className="p-1 rounded-md hover:bg-app text-fg-3" title="지금 종료"><Power className="h-3.5 w-3.5" /></button>}
                        <button onClick={() => copyNext(c)} className="p-1 rounded-md hover:bg-app text-fg-3" title="다음 달로 복사 (기간 +1개월)"><Copy className="h-3.5 w-3.5" /></button>
                        <button onClick={() => remove(c)} className="p-1 rounded-md hover:bg-app text-fg-4 hover:text-danger" title="삭제"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>,
                    isOpen ? <tr key={`${c.id}|items`} className="border-b border-line-2 bg-app/40"><td colSpan={9} className="px-4 py-2">
                      <div className="flex flex-wrap gap-1.5">{c.items.map(i => <span key={i.platform_sku_id} className={cn('inline-flex items-center gap-1 h-6 px-2 rounded-lg border text-[11px] bg-card', i.sku_id ? 'border-line text-fg-2' : 'border-warn/50 text-warn')} title={i.sku_id ? 'SKU 연결됨' : '마스터에 이 옵션ID 가 없습니다'}>{i.product_name ? <span className="truncate max-w-[220px]">{i.product_name}</span> : null}<span className="tabular-nums text-fg-5">{i.platform_sku_id}</span></span>)}{c.items.length === 0 && <span className="text-[11px] text-fg-5">옵션 없음</span>}</div>
                    </td></tr> : null,
                  ]; })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AppDialog open={!!form} onClose={() => setForm(null)} title={form?.id ? '쿠폰 수정' : '쿠폰 추가'} wide>
        {form && (
          <div className="space-y-3 text-[12px]">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1"><span className="text-[11px] text-fg-4">채널</span>
                <SegmentedControl items={[{ value: 'coupang', label: '쿠팡' }, { value: 'smartstore', label: '스스' }, { value: 'toss', label: '토스' }] as const} value={form.channel} onChange={v => setForm(f => f && { ...f, channel: v })} /></label>
              <label className="space-y-1"><span className="text-[11px] text-fg-4">종</span>
                <SegmentedControl items={[{ value: 'instant', label: '즉시할인' }, { value: 'download', label: '다운로드' }] as const} value={form.kind} onChange={v => setForm(f => f && { ...f, kind: v })} /></label>
            </div>
            <label className="block space-y-1"><span className="text-[11px] text-fg-4">쿠폰명</span><input value={form.name} onChange={e => setForm(f => f && { ...f, name: e.target.value })} className={inp} placeholder="마켓에 등록한 쿠폰 이름" /></label>
            <div className="grid grid-cols-3 gap-3">
              <label className="space-y-1"><span className="text-[11px] text-fg-4">할인 방식</span>
                <SegmentedControl items={[{ value: 'rate', label: '%' }, { value: 'amount', label: '원' }] as const} value={form.discount_type} onChange={v => setForm(f => f && { ...f, discount_type: v })} /></label>
              <label className="space-y-1 col-span-2"><span className="text-[11px] text-fg-4">{form.discount_type === 'rate' ? '할인률 (%)' : '할인금액 (원)'}</span><input inputMode="decimal" value={form.value} onChange={e => setForm(f => f && { ...f, value: e.target.value.replace(/[^0-9.]/g, '') })} className={cn(inp, 'text-right tabular-nums')} placeholder={form.discount_type === 'rate' ? '10' : '1000'} /></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1"><span className="text-[11px] text-fg-4">시작 일시</span><input type="datetime-local" value={form.starts_at} onChange={e => setForm(f => f && { ...f, starts_at: e.target.value })} className={inp} /></label>
              <label className="space-y-1"><span className="text-[11px] text-fg-4">종료 일시 <span className="text-fg-5">(비우면 종료일 없음)</span></span><input type="datetime-local" value={form.ends_at} onChange={e => setForm(f => f && { ...f, ends_at: e.target.value })} className={inp} /></label>
            </div>
            <label className="block space-y-1"><span className="text-[11px] text-fg-4">옵션 <span className="text-fg-5">한 줄에 하나 — 옵션ID 뒤에 상품명을 적어도 됩니다 (탭·쉼표·공백)</span></span>
              <textarea value={form.itemsText} onChange={e => setForm(f => f && { ...f, itemsText: e.target.value })} rows={6} className={cn(inp, 'h-auto py-1.5 font-mono text-[11px] resize-y')} placeholder={'93308638058\t그랑누보 데일리 초경량 여자 백팩\n95840829177'} /></label>
            <label className="block space-y-1"><span className="text-[11px] text-fg-4">메모</span><input value={form.note} onChange={e => setForm(f => f && { ...f, note: e.target.value })} className={inp} /></label>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setForm(null)}>취소</Button>
              <Button size="sm" onClick={save} disabled={saving || !form.name.trim() || !form.value || !form.starts_at}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} 저장</Button>
            </div>
          </div>
        )}
      </AppDialog>
    </div>
  );
}
