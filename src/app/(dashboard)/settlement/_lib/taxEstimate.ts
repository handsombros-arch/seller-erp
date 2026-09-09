/**
 * 예상 세금 — 부가가치세(간이/일반)와 종합소득세.
 * 시트 스냅샷(월별 손익)을 과세 유형에 맞춰 집계한 추정치. 세무사 확인용 참고값이며 공제·기장 방식에 따라 달라진다.
 */
import { buildPL, effectiveVatMode, isDeductible, itemVatMode, regimeFor, vatSplitMode, type MCost, type Regime, type Snapshot } from './settlement';

export interface VatPeriod {
  key: string;
  label: string;           // 예: '2026년 1기 확정 (1~6월)'
  months: string[];
  due: string;             // 'YYYY-MM-DD'
  regime: Regime;
  salesBase: number;       // 매출 과세표준 (간이: 공급대가, 일반: 공급가액)
  salesTax: number;        // 매출세액
  purchaseBase: number;    // 세금계산서 매입 (간이: 공급대가, 일반: 공급가액)
  purchaseTax: number;     // 매입세액(일반) / 매입세액공제(간이 0.5%)
  b2bBase: number;         // B2B 세금계산서 발행 공급가액
  b2bVat: number;          // B2B 발행 부가세 (공급가액 × 10%)
  payable: number;         // 납부 예상
  note: string;
  monthsWithData: number;
}

export interface IncomeTaxEstimate {
  year: number;
  profit: number;          // 연간 영업이익 합 (과세 유형 반영)
  monthsWithData: number;
  taxable: number;         // 과세표준(공제 미반영)
  incomeTax: number;       // 산출세액
  localTax: number;        // 지방소득세 10%
  total: number;
  bracket: string;
  due: string;             // 'YYYY-05-31'
}

const ymOf = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

/** 월별 손익에서 부가세 계산에 필요한 값만 뽑는다 */
function monthFigures(items: MCost[], snapshots: Snapshot[], ym: string, regime: Regime) {
  const amounts = new Map<string, number>(); const vats = new Map<string, { vat: boolean | null; none: boolean | null }>();
  for (const s of snapshots) if (s.year_month === ym) { amounts.set(s.cost_id, s.amount); if (s.vat_applicable != null || s.vat_none != null) vats.set(s.cost_id, { vat: s.vat_applicable ?? null, none: s.vat_none ?? null }); }
  if (amounts.size === 0) return null;
  const modeOf = (it: MCost) => { const o = vats.get(it.id); return o ? effectiveVatMode(it, o.vat, o.none) : itemVatMode(it); };
  const view = regime === 'general' ? 'ex' : 'incl';
  // 세금 계산은 회계 기준(경비 인정 항목만)
  const res = buildPL(items, (it) => amounts.get(it.id) ?? 0, { vat: view, regime, vatOf: modeOf, basis: 'accounting' });
  // 부가세 계산용: 매출(공급대가/공급가액), 세금계산서 매입(부가세 없는 항목 제외)
  let salesIncl = 0, salesEx = 0, buyIncl = 0, buyEx = 0, b2bEx = 0;
  for (const l of res.leaves) {
    const mode = modeOf(l.item); const a = amounts.get(l.item.id) ?? 0; const sp = vatSplitMode(a, mode); const sign = l.item.is_income ? -1 : 1;
    if (l.tags.pl_line === 'revenue') { salesIncl += sp.incl * (l.item.is_income ? 1 : -1); salesEx += sp.ex * (l.item.is_income ? 1 : -1); if (l.tags.market === 'b2b') b2bEx += sp.ex * (l.item.is_income ? 1 : -1); }
    else if (l.tags.pl_line === 'coupon') { salesIncl -= sp.incl * sign; salesEx -= sp.ex * sign; }
    else if (['cogs', 'market_fee', 'logistics', 'ad', 'marketing', 'fixed', 'other'].includes(l.tags.pl_line) && mode !== 'none' && isDeductible(l.item)) { buyIncl += sp.incl * sign; buyEx += sp.ex * sign; }
  }
  return { operatingProfit: res.total.operatingProfit, salesIncl, salesEx, buyIncl, buyEx, b2bEx };
}

/** 해당 연도의 부가세 신고 기간별 예상 */
export function estimateVat(items: MCost[], snapshots: Snapshot[], year: number, switchYm: string): VatPeriod[] {
  const periods: VatPeriod[] = [];
  const build = (key: string, label: string, months: string[], due: string, regime: Regime, note: string) => {
    let salesBase = 0, purchaseBase = 0, n = 0, b2bBase = 0;
    for (const ym of months) { const f = monthFigures(items, snapshots, ym, regime); if (!f) continue; n++; b2bBase += f.b2bEx; if (regime === 'simplified') { salesBase += f.salesIncl; purchaseBase += f.buyIncl; } else { salesBase += f.salesEx; purchaseBase += f.buyEx; } }
    const salesTax = regime === 'simplified' ? Math.round(salesBase * 0.10 * 0.10) : Math.round(salesBase * 0.10);
    const purchaseTax = regime === 'simplified' ? Math.round(purchaseBase * 0.005) : Math.round(purchaseBase * 0.10);
    periods.push({ key, label, months, due, regime, salesBase: Math.round(salesBase), salesTax, purchaseBase: Math.round(purchaseBase), purchaseTax, b2bBase: Math.round(b2bBase), b2bVat: Math.round(b2bBase * 0.1), payable: Math.max(0, salesTax - purchaseTax), note, monthsWithData: n });
  };
  const jan = ymOf(year, 1), jul = ymOf(year, 7);
  const firstHalf = Array.from({ length: 6 }, (_, i) => ymOf(year, i + 1));
  const secondHalf = Array.from({ length: 6 }, (_, i) => ymOf(year, i + 7));
  const r1 = regimeFor(jan, switchYm), r2 = regimeFor(jul, switchYm);
  if (r1 === 'simplified' && r2 === 'simplified') {
    build(`${year}-simplified`, `${year}년 간이과세 확정 (1~12월)`, [...firstHalf, ...secondHalf], `${year + 1}-01-25`, 'simplified', '소매(통신판매) 부가가치율 10% 적용. 7월 예정고지는 전년 납부세액의 절반. 연매출 4,800만 원 미만이면 납부 면제.');
  } else {
    if (r1 === 'simplified') build(`${year}-1-simplified`, `${year}년 상반기 간이 (1~6월)`, firstHalf, `${year + 1}-01-25`, 'simplified', '전환 전 기간은 간이 기준으로 함께 신고');
    else build(`${year}-1`, `${year}년 1기 확정 (1~6월)`, firstHalf, `${year}-07-25`, 'general', '4월 25일 예정고지는 직전 반기 납부세액의 절반');
    if (r2 === 'simplified') build(`${year}-2-simplified`, `${year}년 하반기 간이 (7~12월)`, secondHalf, `${year + 1}-01-25`, 'simplified', '');
    else build(`${year}-2`, `${year}년 2기 확정 (7~12월)`, secondHalf, `${year + 1}-01-25`, 'general', '10월 25일 예정고지는 직전 반기 납부세액의 절반');
  }
  return periods;
}

/** 종합소득세 (사업소득만, 소득공제·세액공제·기장 방식 미반영) */
export function estimateIncomeTax(items: MCost[], snapshots: Snapshot[], year: number, switchYm: string): IncomeTaxEstimate {
  let profit = 0, n = 0;
  for (let m = 1; m <= 12; m++) { const ym = ymOf(year, m); const f = monthFigures(items, snapshots, ym, regimeFor(ym, switchYm)); if (!f) continue; n++; profit += f.operatingProfit; }
  const taxable = Math.max(0, Math.round(profit));
  const brackets: [number, number, number, string][] = [
    [14_000_000, 0.06, 0, '6%'], [50_000_000, 0.15, 1_260_000, '15%'], [88_000_000, 0.24, 5_760_000, '24%'], [150_000_000, 0.35, 15_440_000, '35%'],
    [300_000_000, 0.38, 19_940_000, '38%'], [500_000_000, 0.40, 25_940_000, '40%'], [1_000_000_000, 0.42, 35_940_000, '42%'], [Infinity, 0.45, 65_940_000, '45%'],
  ];
  const b = brackets.find(x => taxable <= x[0])!;
  const incomeTax = Math.max(0, Math.round(taxable * b[1] - b[2]));
  const localTax = Math.round(incomeTax * 0.1);
  return { year, profit: Math.round(profit), monthsWithData: n, taxable, incomeTax, localTax, total: incomeTax + localTax, bracket: b[3], due: `${year + 1}-05-31` };
}

/** 오늘 기준으로 '직전 달 또는 당월'에 마감이 있는 세금 일정 */
export function upcomingTaxDeadlines(today: Date, switchYm: string): { kind: 'vat' | 'income'; label: string; due: string; daysLeft: number; regime?: Regime }[] {
  const y = today.getFullYear(), m = today.getMonth() + 1;
  const out: { kind: 'vat' | 'income'; label: string; due: string; daysLeft: number; regime?: Regime }[] = [];
  const push = (kind: 'vat' | 'income', label: string, due: string, regime?: Regime) => {
    const d = new Date(due + 'T23:59:59'); const daysLeft = Math.ceil((d.getTime() - today.getTime()) / 86400000);
    if (daysLeft >= 0 && daysLeft <= 62) out.push({ kind, label, due, daysLeft, regime });
  };
  // 부가세: 이번 달·다음 달 안의 마감
  for (const [yy, mm] of [[y, m], [y, m + 1]].map(([a, b]) => b > 12 ? [a + 1, b - 12] : [a, b])) {
    const ymKey = ymOf(yy, mm); const regime = regimeFor(ymKey, switchYm);
    if (mm === 1) push('vat', regime === 'simplified' ? `${yy - 1}년 간이과세 부가세 확정신고` : `${yy - 1}년 2기 부가세 확정신고`, `${yy}-01-25`, regime);
    if (mm === 7) push('vat', regime === 'simplified' ? '간이과세 부가세 예정고지 납부' : `${yy}년 1기 부가세 확정신고`, `${yy}-07-25`, regime);
    if ((mm === 4 || mm === 10) && regime === 'general') push('vat', `부가세 예정고지 납부 (${mm}월)`, `${yy}-${String(mm).padStart(2, '0')}-25`, regime);
    if (mm === 5) push('income', `${yy - 1}년 귀속 종합소득세 신고`, `${yy}-05-31`);
  }
  return out;
}
