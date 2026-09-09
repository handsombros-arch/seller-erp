'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppDialog } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { estimateIncomeTax, estimateVat, upcomingTaxDeadlines } from '@/app/(dashboard)/settlement/_lib/taxEstimate';
import { buildSeries } from '@/app/(dashboard)/settlement/_lib/settlement';
import { fmtNum } from '@/app/(dashboard)/settlement/_lib/settlement';

/**
 * 세금 마감 알림 — 부가세·종소세 마감이 이번 달/다음 달에 있으면 앱 어느 화면에서든 한 번 팝업.
 * "이번 달은 그만 보기"를 누르면 그 달에는 다시 뜨지 않는다 (브라우저별).
 */
export function TaxAlert() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<{ title: string; due: string; daysLeft: number; amount?: number; detail?: string }[]>([]);
  const [revenueAlert, setRevenueAlert] = useState<{ year: number; ytd: number } | null>(null);

  useEffect(() => {
    const today = new Date();
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    let dismissed = false, revDismissed = false;
    const year = today.getFullYear();
    try { dismissed = localStorage.getItem(`lv-erp-tax-alert-dismissed:${monthKey}`) === '1'; revDismissed = localStorage.getItem(`lv-erp-revenue-alert-never:${year}`) === '1'; } catch {}
    let cancelled = false;
    (async () => {
      try {
        const st = await fetch('/api/settlement/settings').then(r => r.json()).catch(() => ({}));
        const switchYm = st?.settings?.tax_switch_ym ?? '2027-01';
        const dl = dismissed ? [] : upcomingTaxDeadlines(today, switchYm);
        if (!dl.length && revDismissed) return;
        const boot = await fetch('/api/settlement/bootstrap').then(r => r.json()).catch(() => null);
        const items = boot?.items ?? []; const snaps = (boot?.snapshots ?? []).map((s: any) => ({ year_month: s.year_month, cost_id: s.cost_id, amount: Number(s.amount) || 0, vat_applicable: s.vat_applicable ?? null, vat_none: s.vat_none ?? null }));
        // 올해 누적 매출(공급가액) 3억 — 복식부기 의무 기준. '다시 보지 않기' 전까지 로그인마다
        if (!revDismissed) {
          const ms = [...new Set<string>(snaps.map((s: any) => s.year_month))].filter(m => m.startsWith(String(year)));
          const ytd = buildSeries(items, snaps, ms, { vat: 'ex' }).reduce((s, x) => s + x.total.revenue, 0);
          if (ytd >= 300_000_000 && !cancelled) setRevenueAlert({ year, ytd });
        }
        const out: typeof lines = [];
        for (const d of dl) {
          if (d.kind === 'vat') {
            const y = Number(d.due.slice(0, 4)); const isJan = d.due.slice(5, 7) === '01';
            const periods = estimateVat(items, snaps, isJan ? y - 1 : y, switchYm);
            const p = periods.find(x => x.due === d.due) ?? periods[periods.length - 1];
            out.push({ title: d.label, due: d.due, daysLeft: d.daysLeft, amount: p?.payable, detail: p ? `매출세액 ${fmtNum(p.salesTax)} − 매입 ${fmtNum(p.purchaseTax)} (${p.monthsWithData}/${p.months.length}개월 저장)` : undefined });
          } else {
            const inc = estimateIncomeTax(items, snaps, Number(d.due.slice(0, 4)) - 1, switchYm);
            out.push({ title: d.label, due: d.due, daysLeft: d.daysLeft, amount: inc.total, detail: `연간 영업이익 ${fmtNum(inc.profit)} · ${inc.bracket} 구간 · 지방소득세 포함 (공제 미반영)` });
          }
        }
        if (!cancelled && out.length) setLines(out);
        if (!cancelled) setOpen(out.length > 0 || false);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { if (revenueAlert) setOpen(true); }, [revenueAlert]);
  const neverRevenue = () => { try { if (revenueAlert) localStorage.setItem(`lv-erp-revenue-alert-never:${revenueAlert.year}`, '1'); } catch {} setRevenueAlert(null); if (!lines.length) setOpen(false); };
  const dismiss = (forMonth: boolean) => {
    if (forMonth) { try { const t = new Date(); localStorage.setItem(`lv-erp-tax-alert-dismissed:${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`, '1'); } catch {} }
    setOpen(false);
  };

  return (
    <AppDialog open={open} onClose={() => dismiss(false)} title={lines.length ? '세금 마감이 다가옵니다' : '연 매출 기준선 도달'} description="시트 저장값으로 계산한 예상 금액입니다. 정확한 금액은 세무사와 확인하세요.">
      <div className="space-y-2">
        {revenueAlert && (
          <div className="rounded-xl border border-danger/40 bg-danger/5 px-4 py-3">
            <div className="text-[13px] font-bold text-fg">{revenueAlert.year}년 누적 매출(공급가액) {fmtNum(revenueAlert.ytd)}원 — 3억 원 초과</div>
            <div className="mt-1 text-[11px] text-fg-3">도소매업은 연 매출 3억 이상이면 다음 해부터 복식부기 의무(간편장부 불가)이고, 무기장 가산세 대상이 됩니다. 세무사 기장 계약과 증빙 정리를 미리 준비하세요. 8천만 원 이상이라 전자세금계산서 의무도 이미 해당됩니다.</div>
            <div className="mt-2 text-right"><Button variant="ghost" size="sm" onClick={neverRevenue}>이 알림 다시 보지 않기</Button></div>
          </div>
        )}
        {lines.map(l => (
          <div key={l.title} className="rounded-xl border border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-fg">{l.title}</span>
              <span className={`ml-auto text-[11px] font-semibold ${l.daysLeft <= 7 ? 'text-danger' : 'text-warn'}`}>{l.due} · D-{l.daysLeft}</span>
            </div>
            {l.amount != null && <div className="mt-1 text-[18px] font-bold tabular-nums text-fg">{fmtNum(l.amount)}원 <span className="text-[11px] font-medium text-fg-4">예상</span></div>}
            {l.detail && <div className="text-[11px] text-fg-4">{l.detail}</div>}
          </div>
        ))}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={() => dismiss(true)}>이번 달은 그만 보기</Button>
          <Button variant="outline" size="sm" onClick={() => dismiss(false)}>닫기</Button>
          <Link href="/settlement?tab=analysis"><Button size="sm" onClick={() => dismiss(false)}>정산에서 자세히</Button></Link>
        </div>
      </div>
    </AppDialog>
  );
}
