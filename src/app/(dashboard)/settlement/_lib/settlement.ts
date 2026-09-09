/**
 * 정산 공용 모델 — 항목 태그(마켓·손익 라인·배분 규칙) 추론과 손익계산서(P&L) 집계.
 *
 * 설계 원칙
 * - 입력 트리(기입 편의 묶음)와 분류(손익 라인)는 별개. 각 말단 항목이 pl_line / market 태그를 가진다.
 * - 태그가 비어 있으면 라벨·부모로 추론(inferTags). 화면에는 "추론됨" 표시. 저장하면 명시값이 우선.
 * - 시트 실적은 모두 수기. 여기서는 계산만 한다.
 */

export type Market = 'coupang' | 'toss' | 'smartstore' | 'esm' | 'talkdeal' | 'b2b' | 'common';
export type PlLine = 'revenue' | 'coupon' | 'cogs' | 'market_fee' | 'logistics' | 'ad' | 'marketing' | 'fixed' | 'other' | 'info';
/** 과세 유형: simplified = 간이과세(부가세가 실비용, 공급대가 기준) · general = 일반과세(부가세 통과, 공급가액 기준) */
export type Regime = 'simplified' | 'general';
export const regimeFor = (ym: string, switchYm: string): Regime => (ym >= switchYm ? 'general' : 'simplified');
export const vatViewFor = (r: Regime): 'ex' | 'incl' => (r === 'general' ? 'ex' : 'incl');
export type AllocRule = 'direct' | 'by_orders' | 'by_revenue' | 'none';

export interface MCost {
  id: string;
  label: string;
  amount: number;
  vat_applicable: boolean;
  vat_none?: boolean | null;     // 부가세 없음(급여·개인거래·부가세 납부액) — 별도/포함 어느 보기에서도 금액 그대로
  vat_confirmed?: boolean | null; // VAT 구분을 사용자가 확인함
  parent_id: string | null;
  sort_order: number;
  note?: string;
  is_income?: boolean;
  is_locked?: boolean;
  category?: string;
  pl_line?: PlLine | null;
  market?: Market | null;
  alloc_rule?: AllocRule | null;
  carry_forward?: boolean | null;
  unit_price?: number | null;   // 건당 단가 — 있으면 수량 × 단가로 금액 계산
}

export interface Snapshot { year_month: string; cost_id: string; amount: number; note?: string | null; ref_amount?: number | null; ref_source?: string | null; ref_detail?: string | null; qty?: number | null; vat_applicable?: boolean | null; vat_none?: boolean | null }

/** VAT 구분: incl = 입력값이 VAT 포함, ex = VAT 별도(세전), none = 부가세 없음 */
export type VatMode = 'incl' | 'ex' | 'none';
export const VAT_MODE_LABEL: Record<VatMode, string> = { incl: 'VAT포함', ex: 'VAT별도', none: 'VAT없음' };
export const nextVatMode = (m: VatMode): VatMode => m === 'incl' ? 'ex' : m === 'ex' ? 'none' : 'incl';
export const itemVatMode = (item: MCost): VatMode => item.vat_none ? 'none' : item.vat_applicable ? 'ex' : 'incl';
/** 달별 오버라이드(스냅샷 vat_none/vat_applicable) 를 반영한 유효 VAT 구분 */
export function effectiveVatMode(item: MCost, snapVat?: boolean | null, snapNone?: boolean | null): VatMode {
  if (snapNone === true) return 'none';
  if (snapVat != null) return snapVat ? 'ex' : 'incl';
  if (snapNone === false && item.vat_none) return item.vat_applicable ? 'ex' : 'incl';
  return itemVatMode(item);
}
export function vatSplitMode(amount: number, mode: VatMode) {
  const a = Number(amount) || 0;
  if (mode === 'none') return { ex: a, incl: a };
  return mode === 'ex' ? { ex: a, incl: Math.round(a * 1.1) } : { ex: Math.round(a / 1.1), incl: a };
}

export const MARKETS: { id: Market; label: string; short: string }[] = [
  { id: 'coupang', label: '쿠팡 그로스', short: '쿠팡' },
  { id: 'toss', label: '토스', short: '토스' },
  { id: 'smartstore', label: '스마트스토어', short: '스스' },
  { id: 'esm', label: 'ESM', short: 'ESM' },
  { id: 'talkdeal', label: '톡딜', short: '톡딜' },
  { id: 'b2b', label: 'B2B 직거래', short: 'B2B' },
  { id: 'common', label: '공통', short: '공통' },
];
export const SALES_MARKETS: Market[] = ['coupang', 'toss', 'smartstore', 'esm', 'talkdeal', 'b2b'];

export const PL_LINES: { id: PlLine; label: string; group: 'revenue' | 'variable' | 'fixed'; hint: string }[] = [
  { id: 'revenue', label: '매출', group: 'revenue', hint: '마켓이 정산해 준 판매 금액' },
  { id: 'coupon', label: '매출 차감', group: 'revenue', hint: '판매자 부담 쿠폰 등 — 실매출 = 매출 − 차감' },
  { id: 'cogs', label: '매입원가', group: 'variable', hint: '판매된 수량의 원가' },
  { id: 'market_fee', label: '마켓 수수료', group: 'variable', hint: '판매수수료·세이버·부가서비스·부가세 등 마켓 청구' },
  { id: 'logistics', label: '물류·배송', group: 'variable', hint: '입출고·보관·택배·반출·풀필먼트' },
  { id: 'ad', label: '광고비', group: 'variable', hint: '마켓 광고 플랫폼 집행비' },
  { id: 'marketing', label: '마케팅', group: 'variable', hint: '가구매·트래픽·리뷰·사은품 등' },
  { id: 'fixed', label: '고정비', group: 'fixed', hint: '인건비·창고·SW 등 판매량과 무관' },
  { id: 'other', label: '기타', group: 'fixed', hint: '부자재·샘플 등' },
  { id: 'info', label: '정보용 (손익 제외)', group: 'fixed', hint: '정산서의 부가세 표시줄처럼 참고만 하고 손익에는 넣지 않는 항목' },
];

export const ALLOC_RULES: { id: AllocRule; label: string; hint: string }[] = [
  { id: 'direct', label: '마켓 귀속', hint: '지정 마켓에 전액' },
  { id: 'by_orders', label: '건수 비례', hint: '쿠팡 제외 자사출고 마켓에 출고 건수 비례로 배분' },
  { id: 'by_revenue', label: '매출 비례', hint: '전 마켓에 매출 비중으로 배분' },
  { id: 'none', label: '배분 안 함', hint: '마켓 마진에 넣지 않고 영업이익에서만 차감' },
];

export const marketLabel = (m: Market | null | undefined) => MARKETS.find(x => x.id === m)?.short ?? '공통';
export const plLineLabel = (l: PlLine) => PL_LINES.find(x => x.id === l)?.label ?? l;

// ───────────────────────── 태그 추론 ─────────────────────────

export function inferMarket(label: string, parentLabel?: string): Market {
  const test = (s: string): Market | null => {
    if (/쿠팡|로켓|세이버|그로스/i.test(s)) return 'coupang';
    if (/토스/.test(s)) return 'toss';
    if (/스스|스마트|네이버/.test(s)) return 'smartstore';
    if (/esm|지마켓|옥션|g마켓/i.test(s)) return 'esm';
    if (/톡딜/.test(s)) return 'talkdeal';
    if (/b2b|도매|직거래|기업/i.test(s)) return 'b2b';
    if (/파스토/.test(s)) return 'toss'; // 파스토 풀필먼트는 토스 전용
    if (/반출비/.test(s)) return 'coupang'; // 반출은 쿠팡 전용
    return null;
  };
  return test(label) ?? (parentLabel ? test(parentLabel) : null) ?? 'common';
}

export function inferPlLine(item: MCost, parent: MCost | null): PlLine {
  const label = item.label;
  const pLabel = parent?.label ?? '';
  const pCat = parent?.category ?? item.category ?? '';

  // 로켓 그로스 묶음: 입력은 한 덩어리, 분류는 항목별
  if (/로켓 그로스|로켓그로스/.test(pLabel)) {
    if (/할인쿠폰|쿠폰/.test(label)) return 'coupon';
    if (/배송비|입출고|보관|반출|바코드|물류/.test(label)) return 'logistics';
    return 'market_fee';
  }
  if (/할인쿠폰/.test(label)) return 'coupon';
  if (/매출/.test(label) || pCat === 'revenue' || (/매출/.test(pLabel) && item.is_income)) return item.is_income ? 'revenue' : 'coupon';
  if (/매입원가|원가/.test(label) || pCat === 'cogs' || /매입원가/.test(pLabel)) return 'cogs';
  if (/트래픽|가구매|사은품|리뷰|체험단/.test(label) || /마케팅/.test(pLabel)) return 'marketing';
  if (/광고/.test(label) || /광고/.test(pLabel) || pCat === 'ad') return 'ad';
  if (/수수료|차액|환급|정산/.test(label)) return 'market_fee';
  if (/택배|반출|파스토|배송|물류|풀필먼트/.test(label) || /택배|물류/.test(pLabel)) return 'logistics';
  if (/인건비|창고|전기|임대|SW|소프트|구독|알바/.test(label) || /인건비|창고|SW/.test(pLabel) || pCat === 'fixed') return 'fixed';
  if (/기타|부자재|샘플/.test(label) || /기타/.test(pLabel)) return 'other';
  return 'other';
}

export interface Tags { pl_line: PlLine; market: Market; alloc_rule: AllocRule; inferred: boolean }

export function effectiveTags(item: MCost, parent: MCost | null): Tags {
  const pl = item.pl_line ?? inferPlLine(item, parent);
  const marketRaw = item.market ?? (parent?.market ?? null) ?? inferMarket(item.label, parent?.label);
  // 고정비·기타는 마켓 의미 없음 → 공통
  const market: Market = pl === 'fixed' || pl === 'other' ? 'common' : marketRaw;
  const defaultAlloc: AllocRule = market !== 'common' ? 'direct' : pl === 'logistics' ? 'by_orders' : 'none';
  const alloc = item.alloc_rule ?? defaultAlloc;
  return { pl_line: pl, market, alloc_rule: market !== 'common' ? 'direct' : alloc, inferred: item.pl_line == null || (item.market == null && parent?.market == null) };
}

// ───────────────────────── 금액 ─────────────────────────

/** vat_applicable=true 는 "입력값이 VAT 별도" → 포함가 = ×1.1. false 는 입력값이 VAT 포함 → 별도가 = ÷1.1 */
export function vatSplit(amount: number, vatApplicable: boolean) {
  const a = Number(amount) || 0;
  return vatApplicable
    ? { ex: a, incl: Math.round(a * 1.1) }
    : { ex: Math.round(a / 1.1), incl: a };
}

export const fmtWon = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
export const fmtNum = (n: number) => Math.round(n).toLocaleString('ko-KR');
export const fmtPct = (n: number | null, digits = 1) => n == null || !isFinite(n) ? '-' : `${n.toFixed(digits)}%`;

// ───────────────────────── 손익 집계 ─────────────────────────

export interface PL {
  revenue: number; coupon: number; netRevenue: number;
  cogs: number; grossProfit: number;
  marketFee: number; logistics: number; ad: number; marketing: number;
  contribution: number;          // 공헌이익 = 매출총이익 − 마켓비용 − 광고 − 마케팅
  fixed: number; other: number;
  taxEstimate: number;           // 간이과세 부가세 추정 (일반과세는 0)
  operatingProfit: number;       // 영업이익 = 공헌이익 − 고정비 − 기타 − 부가세(간이)
}

export interface MarketPL extends PL {
  market: Market;
  logisticsAlloc: number;        // 공통에서 배분받은 물류비 (logistics 에 포함됨)
  share: number | null;          // 매출 비중 %
  margin: number | null;         // 공헌이익률 %
  adRate: number | null;         // 광고비/실매출 %
  roas: number | null;           // 실매출/광고비 %
  beRoas: number | null;         // 손익분기 ROAS % = 1 / (광고 전 공헌이익률)
  preAdMarginRate: number | null; // 광고 전 공헌이익률 %
}

export interface LeafRow {
  item: MCost; parent: MCost | null; tags: Tags;
  /** 부호 적용된 값 (비용은 +, 수입/환급은 −; 매출은 +, 매출차감은 +) */
  value: number;
}

const emptyPL = (): PL => ({ revenue: 0, coupon: 0, netRevenue: 0, cogs: 0, grossProfit: 0, marketFee: 0, logistics: 0, ad: 0, marketing: 0, contribution: 0, fixed: 0, other: 0, taxEstimate: 0, operatingProfit: 0 });

function finalize(p: PL): PL {
  p.netRevenue = p.revenue - p.coupon;
  p.grossProfit = p.netRevenue - p.cogs;
  p.contribution = p.grossProfit - p.marketFee - p.logistics - p.ad - p.marketing;
  p.operatingProfit = p.contribution - p.fixed - p.other - p.taxEstimate;
  return p;
}

function addLine(p: PL, line: PlLine, v: number) {
  switch (line) {
    case 'revenue': p.revenue += v; break;
    case 'coupon': p.coupon += v; break;
    case 'cogs': p.cogs += v; break;
    case 'market_fee': p.marketFee += v; break;
    case 'logistics': p.logistics += v; break;
    case 'ad': p.ad += v; break;
    case 'marketing': p.marketing += v; break;
    case 'fixed': p.fixed += v; break;
    case 'other': p.other += v; break;
    case 'info': break;   // 손익 제외
  }
}

export interface BuildOptions {
  vat: 'ex' | 'incl';
  /** 달별 VAT 구분 (유효 VatMode). 없으면 항목 기본값 */
  vatOf?: (item: MCost) => VatMode | null | undefined;
  /** 간이과세면 부가세 추정을 영업이익에 반영 (시트에 '부가세 납부' 실적이 있으면 추정 생략) */
  regime?: Regime;
  /** 마켓별 출고 건수 (건수 비례 배분용). 없으면 by_orders 는 매출 비례로 대체 */
  orderCounts?: Partial<Record<Market, number>>;
}

export interface PLResult {
  total: PL;
  markets: MarketPL[];
  /** 마켓에 배분되지 않은 공통 비용 */
  common: PL;
  leaves: LeafRow[];
  /** 배분 대상이 없어 공통에 남은 배분 규칙 항목 값 */
  unallocated: number;
}

/** 말단 항목 목록 (자식 있는 부모는 제외) + 태그 + 부호 적용 값 */
export function collectLeaves(items: MCost[], amountOf: (item: MCost) => number, vat: 'ex' | 'incl', vatOf?: (item: MCost) => VatMode | null | undefined): LeafRow[] {
  const byId = new Map(items.map(i => [i.id, i]));
  const hasChildren = new Set(items.filter(i => i.parent_id).map(i => i.parent_id as string));
  const rows: LeafRow[] = [];
  for (const item of items) {
    if (hasChildren.has(item.id)) continue;
    const parent = item.parent_id ? byId.get(item.parent_id) ?? null : null;
    const tags = effectiveTags(item, parent);
    const split = vatSplitMode(amountOf(item), vatOf?.(item) ?? itemVatMode(item));   // 달별 VAT 구분이 있으면 그 값
    const amt = vat === 'ex' ? split.ex : split.incl;
    let value: number;
    if (tags.pl_line === 'revenue') value = item.is_income ? amt : -amt;
    else if (tags.pl_line === 'coupon') value = item.is_income ? -amt : amt;
    else value = item.is_income ? -amt : amt;
    rows.push({ item, parent, tags, value });
  }
  return rows;
}

export function buildPL(items: MCost[], amountOf: (item: MCost) => number, opts: BuildOptions): PLResult {
  const leaves = collectLeaves(items, amountOf, opts.vat, opts.vatOf);
  const total = emptyPL();
  const common = emptyPL();
  const byMarket = new Map<Market, PL>();
  const ensure = (m: Market) => { let p = byMarket.get(m); if (!p) { p = emptyPL(); byMarket.set(m, p); } return p; };
  const pending: { line: PlLine; value: number; rule: AllocRule }[] = [];

  for (const row of leaves) {
    addLine(total, row.tags.pl_line, row.value);
    if (row.tags.market !== 'common') { addLine(ensure(row.tags.market), row.tags.pl_line, row.value); continue; }
    if (row.tags.alloc_rule === 'by_orders' || row.tags.alloc_rule === 'by_revenue') pending.push({ line: row.tags.pl_line, value: row.value, rule: row.tags.alloc_rule });
    else addLine(common, row.tags.pl_line, row.value);
  }

  // 1차 마감 (배분 전 매출 확정)
  for (const p of byMarket.values()) finalize(p);

  // 배분
  const allocLog = new Map<Market, number>();
  let unallocated = 0;
  for (const pend of pending) {
    let weights: [Market, number][] = [];
    if (pend.rule === 'by_orders' && opts.orderCounts) {
      weights = SALES_MARKETS.filter(m => m !== 'coupang').map(m => [m, Number(opts.orderCounts?.[m] ?? 0)] as [Market, number]).filter(([, w]) => w > 0);
    }
    if (weights.length === 0) {
      const targets = pend.rule === 'by_orders' ? SALES_MARKETS.filter(m => m !== 'coupang') : SALES_MARKETS;
      weights = targets.map(m => [m, Math.max(0, byMarket.get(m)?.netRevenue ?? 0)] as [Market, number]).filter(([, w]) => w > 0);
    }
    const sum = weights.reduce((s, [, w]) => s + w, 0);
    if (sum <= 0) { addLine(common, pend.line, pend.value); unallocated += pend.value; continue; }
    for (const [m, w] of weights) {
      const v = pend.value * (w / sum);
      addLine(ensure(m), pend.line, v);
      if (pend.line === 'logistics') allocLog.set(m, (allocLog.get(m) ?? 0) + v);
    }
  }

  // 간이과세 부가세 추정: 매출세액 = 공급대가 × 10%(소매 부가가치율) × 10%, 매입세액공제 = 세금계산서 매입(원가·수수료·물류·광고) 공급대가 × 0.5%
  if (opts.regime === 'simplified') {
    const manualVat = leaves.some(l => /부가세 납부|부가가치세 납부/.test(l.item.label) && l.value !== 0);
    if (!manualVat) {
      const incl = (l: LeafRow) => vatSplitMode(amountOf(l.item), (opts.vatOf?.(l.item) ?? itemVatMode(l.item))).incl * (l.item.is_income ? -1 : 1);
      let rev = 0, buy = 0;
      for (const l of leaves) {
        if (l.tags.pl_line === 'revenue') rev += incl(l);
        else if (l.tags.pl_line === 'coupon') rev -= incl(l);
        else if (['cogs', 'market_fee', 'logistics', 'ad', 'marketing'].includes(l.tags.pl_line) && (opts.vatOf?.(l.item) ?? itemVatMode(l.item)) !== 'none') buy += incl(l);
      }
      total.taxEstimate = Math.max(0, Math.round(rev * 0.01 - buy * 0.005));
    }
  }
  finalize(total);
  finalize(common);

  const markets: MarketPL[] = SALES_MARKETS.filter(m => byMarket.has(m)).map(m => {
    const p = finalize(byMarket.get(m)!);
    const preAd = p.grossProfit - p.marketFee - p.logistics; // 광고 전 공헌이익
    const preAdRate = p.netRevenue > 0 ? preAd / p.netRevenue : null;
    return {
      ...p, market: m,
      logisticsAlloc: allocLog.get(m) ?? 0,
      share: total.netRevenue > 0 ? (p.netRevenue / total.netRevenue) * 100 : null,
      margin: p.netRevenue > 0 ? (p.contribution / p.netRevenue) * 100 : null,
      adRate: p.netRevenue > 0 ? ((p.ad + p.marketing) / p.netRevenue) * 100 : null,
      roas: p.ad + p.marketing > 0 ? (p.netRevenue / (p.ad + p.marketing)) * 100 : null,
      beRoas: preAdRate != null && preAdRate > 0 ? (1 / preAdRate) * 100 : null,
      preAdMarginRate: preAdRate != null ? preAdRate * 100 : null,
    };
  }).filter(m => m.netRevenue !== 0 || m.ad !== 0 || m.cogs !== 0);

  return { total, markets, common, leaves, unallocated };
}

/** 월 목록의 스냅샷으로 월별 손익 시계열 생성 */
export function buildSeries(items: MCost[], snapshots: Snapshot[], months: string[], opts: BuildOptions & { orderCountsByMonth?: Record<string, Partial<Record<Market, number>>>; vatFor?: (ym: string) => 'ex' | 'incl'; regimeOf?: (ym: string) => Regime }) {
  const byMonth = new Map<string, Map<string, number>>();
  const vatByMonth = new Map<string, Map<string, { vat: boolean | null; none: boolean | null }>>();
  for (const s of snapshots) {
    let m = byMonth.get(s.year_month); if (!m) { m = new Map(); byMonth.set(s.year_month, m); }
    m.set(s.cost_id, Number(s.amount) || 0);
    if (s.vat_applicable != null || s.vat_none != null) { let v = vatByMonth.get(s.year_month); if (!v) { v = new Map(); vatByMonth.set(s.year_month, v); } v.set(s.cost_id, { vat: s.vat_applicable ?? null, none: s.vat_none ?? null }); }
  }
  return months.map(ym => {
    const amounts = byMonth.get(ym);
    const vats = vatByMonth.get(ym);
    const res = buildPL(items, (it) => amounts?.get(it.id) ?? 0, { vat: opts.vatFor?.(ym) ?? opts.vat, regime: opts.regimeOf?.(ym), orderCounts: opts.orderCountsByMonth?.[ym], vatOf: (it) => { const o = vats?.get(it.id); return o ? effectiveVatMode(it, o.vat, o.none) : null; } });
    return { ym, ...res };
  });
}

export const PL_ROWS: { key: keyof PL; label: string; kind: 'plus' | 'minus' | 'subtotal' | 'result'; indent?: boolean }[] = [
  { key: 'revenue', label: '매출', kind: 'plus' },
  { key: 'coupon', label: '매출 차감 (쿠폰)', kind: 'minus', indent: true },
  { key: 'netRevenue', label: '실매출', kind: 'subtotal' },
  { key: 'cogs', label: '매입원가', kind: 'minus', indent: true },
  { key: 'grossProfit', label: '매출총이익', kind: 'subtotal' },
  { key: 'marketFee', label: '마켓 수수료', kind: 'minus', indent: true },
  { key: 'logistics', label: '물류·배송', kind: 'minus', indent: true },
  { key: 'ad', label: '광고비', kind: 'minus', indent: true },
  { key: 'marketing', label: '마케팅', kind: 'minus', indent: true },
  { key: 'contribution', label: '공헌이익', kind: 'subtotal' },
  { key: 'fixed', label: '고정비', kind: 'minus', indent: true },
  { key: 'other', label: '기타', kind: 'minus', indent: true },
  { key: 'taxEstimate', label: '부가세 (간이 추정)', kind: 'minus', indent: true },
  { key: 'operatingProfit', label: '영업이익', kind: 'result' },
];

// ───────────────────────── 마켓 정책 (상품별 순이익 추정용) ─────────────────────────

/**
 * 상품별 순이익에서 쓰는 정책값. 시트 실적은 수기이고, 이 값은 상품 단위 추정에만 쓴다.
 * 수수료율은 platform_skus.commission_rate(상품별) 우선, 없으면 여기 기본값(2026-07 시트 실적 기준) + "기본값" 표시.
 */
export const MARKET_POLICY: Record<Market, { feeRate: number; feeSource: string; shipPerUnit: number; shipNote: string; oversizePerUnit?: number }> = {
  coupang: { feeRate: 0.12, feeSource: '기본 12% (VAT 포함)', shipPerUnit: 4100, oversizePerUnit: 4850, shipNote: '그로스 물류비 일반 4,100 · 대형 4,850 /건' },
  toss: { feeRate: 0.035, feeSource: '기본 3.5% (7월 시트 실적)', shipPerUnit: 2650, shipNote: '택배 2,650 /건' },
  smartstore: { feeRate: 0.045, feeSource: '기본 4.5% (7월 시트 실적)', shipPerUnit: 2650, shipNote: '택배 2,650 /건' },
  esm: { feeRate: 0.045, feeSource: '기본 4.5% (7월 시트 실적)', shipPerUnit: 2650, shipNote: '택배 2,650 /건' },
  talkdeal: { feeRate: 0.1, feeSource: '기본 10%', shipPerUnit: 2650, shipNote: '택배 2,650 /건' },
  b2b: { feeRate: 0, feeSource: '수수료 없음 (세금계산서 직거래)', shipPerUnit: 0, shipNote: '운임은 시트 택배비에' },
  common: { feeRate: 0, feeSource: '-', shipPerUnit: 0, shipNote: '-' },
};

export function isOversize(productName: string, tier: string | null | undefined): boolean {
  if (tier === 'oversize') return true;
  if (tier === 'standard') return false;
  return /하드|여행/.test(productName);
}

export const ymLabel = (ym: string) => ym.replace('-', '년 ') + '월';
export const currentYm = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export function lastMonths(n: number, from = new Date()) {
  const out: string[] = [];
  for (let i = 0; i < n; i++) { const d = new Date(from.getFullYear(), from.getMonth() - i, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  return out;
}
