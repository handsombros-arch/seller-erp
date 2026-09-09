'use client';

import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { VAT_MODE_LABEL, effectiveTags, fmtNum, itemVatMode, vatSplitMode, type MCost, type Regime, type VatMode } from '../_lib/settlement';

interface Props {
  items: MCost[];
  amounts: Map<string, number>;
  vats: Map<string, VatMode>;
  ym: string;
  regime: Regime;
  switchYm: string;
  onSwitchYmChange: (ym: string) => void;
  onItemsChanged?: () => void;
}

/**
 * 세무 체크 — 이 달에 사람이 처리해야 하는 세무 일정과, 항목별 VAT 구분 확인.
 * 놓치기 쉬운 것(3.3% 원천세, 부가세 신고, 종소세)을 달마다 체크리스트로.
 */
export function TaxCheckCard({ items, amounts, vats, ym, regime, switchYm, onSwitchYmChange, onItemsChanged }: Props) {
  const toast = useToast();
  const DONE_KEY = `lv-erp-tax-done:${ym}`;
  const [done, setDone] = useState<Set<string>>(new Set());
  useEffect(() => { try { const j = localStorage.getItem(DONE_KEY); setDone(new Set(j ? JSON.parse(j) : [])); } catch { setDone(new Set()); } }, [DONE_KEY]);
  const toggleDone = (k: string) => setDone(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); try { localStorage.setItem(DONE_KEY, JSON.stringify([...n])); } catch {} return n; });

  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const hasChildren = useMemo(() => new Set(items.filter(i => i.parent_id).map(i => i.parent_id as string)), [items]);
  const leaves = useMemo(() => items.filter(i => !hasChildren.has(i.id)), [items, hasChildren]);
  const modeOf = (l: MCost): VatMode => vats.get(l.id) ?? itemVatMode(l);
  const amt = (l: MCost) => amounts.get(l.id) ?? 0;

  // 1) 원천세 3.3% — 인건비·알바비 성격 + 부가세 없음
  const payroll = leaves.filter(l => { const p = l.parent_id ? byId.get(l.parent_id) : null; return /인건비|알바|급여|프리랜서|용역/.test(`${p?.label ?? ''} ${l.label}`) && amt(l) > 0; });
  const payrollTotal = payroll.reduce((s, l) => s + amt(l), 0);
  const withholding = Math.round(payrollTotal * 0.033);
  const [y, m] = ym.split('-').map(Number);
  const next = new Date(y, m, 10);
  const nextDue = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-10`;

  // 2) 부가세 신고 일정
  const vatSchedule = regime === 'simplified'
    ? { title: '간이과세 부가세', desc: '1년치 확정신고 1월 25일 (7월 예정고지). 매출세액 = 공급대가 × 10% × 10%, 매입세액공제 = 세금계산서 매입 × 0.5%' }
    : { title: '일반과세 부가세', desc: '확정신고 1·7월 25일, 예정신고 4·10월 25일. 매출세액(공급가액 × 10%) − 매입세액(세금계산서·수입세금계산서)' };
  const isVatMonth = regime === 'simplified' ? (m === 12 || m === 6) : (m === 3 || m === 6 || m === 9 || m === 12);

  // 3) VAT 구분 미확인 항목
  const unconfirmed = leaves.filter(l => !l.vat_confirmed && amt(l) !== 0);
  async function confirmItem(l: MCost, ok: boolean) {
    const r = await fetch('/api/monthly-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: l.id, vat_confirmed: ok }) });
    if (!r.ok) { toast.error('저장 실패 (마이그레이션 00067 확인)'); return; }
    onItemsChanged?.();
  }

  const tasks: { key: string; title: string; desc: string; amount?: number; urgent?: boolean }[] = [];
  if (payroll.length) tasks.push({ key: 'withholding', title: `3.3% 원천세 신고·납부 (${nextDue}까지)`, desc: `${payroll.map(l => l.label).join(', ')} 합계 ${fmtNum(payrollTotal)}원 → 원천세 ${fmtNum(withholding)}원. 지급 시 3.3% 떼고, 다음 달 10일까지 홈택스 신고·납부. 반기납부 승인 사업자는 1·7월.`, amount: withholding, urgent: true });
  if (isVatMonth) tasks.push({ key: 'vat', title: `${vatSchedule.title} 신고 준비`, desc: vatSchedule.desc, urgent: true });
  if (m === 4) tasks.push({ key: 'income', title: '종합소득세 준비 (5월 신고)', desc: '연간 손익(월별 추이의 영업이익 합)과 경비 증빙 정리' });
  if (regime === 'simplified' && ym >= switchYm.slice(0, 5) + '01' && ym < switchYm) tasks.push({ key: 'switch', title: `일반과세 전환 준비 (${switchYm}부터)`, desc: '전환 시점 재고 금액 → 재고 매입세액 공제 신고. 세무사에게 재고 관리 화면의 그 시점 재고를 전달' });

  return (
    <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-4 md:px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-[15px] font-bold text-fg flex items-center gap-1.5 mr-auto"><ShieldCheck className="h-4 w-4 text-brand" /> 세무 체크 <span className="text-[11px] font-medium text-fg-4">{ym.replace('-', '.')}</span></h3>
        <label className="flex items-center gap-2 text-[12px] text-fg-3">
          이 달 기준 <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-bold', regime === 'simplified' ? 'bg-warn/15 text-warn' : 'bg-brand-bg text-brand')}>{regime === 'simplified' ? '간이과세' : '일반과세'}</span>
          <span className="text-fg-4">· 일반 전환월</span>
          <input type="month" value={switchYm} onChange={e => e.target.value && onSwitchYmChange(e.target.value)} className="h-7 rounded-lg border border-line bg-card px-2 text-[12px]" title="이 달부터 일반과세자 기준(VAT 별도)으로 계산합니다" />
        </label>
      </div>

      {tasks.length === 0 ? <p className="text-[12px] text-fg-4">이 달에 표시할 세무 일정이 없습니다.</p> : (
        <ul className="space-y-1.5">
          {tasks.map(t => (
            <li key={t.key} className={cn('flex items-start gap-2.5 rounded-xl px-3 py-2', done.has(t.key) ? 'bg-success/5' : t.urgent ? 'bg-warn/10' : 'bg-card-2')}>
              <input type="checkbox" className="accent-brand mt-0.5" checked={done.has(t.key)} onChange={() => toggleDone(t.key)} />
              <div className="min-w-0">
                <div className={cn('text-[13px] font-semibold', done.has(t.key) ? 'text-fg-4 line-through' : 'text-fg')}>{t.title}</div>
                <div className="text-[11px] text-fg-3">{t.desc}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div>
        <div className="text-[12px] font-semibold text-fg mb-1">VAT 구분 확인 <span className="text-fg-4 font-normal">— 아직 확인하지 않은 항목 {unconfirmed.length}개. 계산서·정산서와 맞는지 보고 확인을 누르세요.</span></div>
        {unconfirmed.length === 0 ? <p className="text-[11px] text-success">모든 항목의 VAT 구분이 확인됐습니다.</p> : (
          <div className="rounded-xl border border-line divide-y divide-line-2 max-h-72 overflow-y-auto">
            {unconfirmed.map(l => {
              const p = l.parent_id ? byId.get(l.parent_id) : null; const mode = modeOf(l); const sp = vatSplitMode(amt(l), mode); const tags = effectiveTags(l, p ?? null);
              return (
                <div key={l.id} className="flex items-center gap-3 px-3 py-1.5 text-[12px]">
                  <span className="w-56 truncate text-fg" title={`${p?.label ?? ''} · ${l.label}`}>{p && <span className="text-fg-4">{p.label} · </span>}{l.label}</span>
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', mode === 'none' ? 'bg-app text-fg-3' : mode === 'ex' ? 'bg-brand text-white' : 'bg-fg/10 text-fg')}>{VAT_MODE_LABEL[mode]}</span>
                  <span className="text-fg-4 tabular-nums">{fmtNum(amt(l))} → 별도 {fmtNum(sp.ex)} · 포함 {fmtNum(sp.incl)}</span>
                  <span className="text-[10px] text-fg-5">{tags.pl_line}</span>
                  <button onClick={() => confirmItem(l, true)} className="ml-auto text-brand hover:underline shrink-0">확인</button>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-1 text-[10px] text-fg-5">구분이 틀리면 입력 화면 칩(이 달만) 또는 구조 편집(기본값)에서 바꾼 뒤 확인하세요. 확인한 항목은 목록에서 사라집니다.</p>
      </div>
    </section>
  );
}
