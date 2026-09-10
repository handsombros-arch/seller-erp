'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { MARKETS, PL_ROWS, buildSeries, fmtNum, fmtPct, type Basis, type MCost, type Market, type PL, type PlLine, type Regime, type Snapshot } from '../_lib/settlement';
import { allocateSheetMarketing, buildPsMap, computeProductLines, type PlatformSkuLite, type ProductLine, type SalesRowLite } from '../_lib/productProfit';
import { AD_WINDOW, COST_KEYS, KEY_LINE, LINE_KEY, deltaOf, itemRows, lineRows, marketRows, optionRows, productRows, type AdProduct, type Delta, type SeriesPoint } from '../_lib/drill';

/**
 * "왜?" 드릴다운 — 월별 추이에서 라인을 클릭해 항목 → 마켓 → 상품 → 옵션으로 내려간다.
 * 통합 지표는 실매출 기준. 플랫폼 ROAS(룩백 윈도우)는 마켓 안에서만 참고 표시.
 */
interface Props {
  items: MCost[]; snapshots: Snapshot[]; months: string[]; vat: 'ex' | 'incl'; vatFor?: (ym: string) => 'ex' | 'incl'; regimeOf?: (ym: string) => Regime; basis?: Basis;
  currentYm: string; selectedYm: string; sheetMarketingByMonth?: (ym: string) => Partial<Record<Market, number>>;
}
type Path = { key?: keyof PL; itemId?: string; market?: Market | 'all'; productKey?: string };
const LINE_LABEL = Object.fromEntries(PL_ROWS.map(r => [r.key, r.label])) as Record<keyof PL, string>;
const marketLabel = (m: Market | 'all' | null | undefined) => m === 'all' ? '마켓 통합' : MARKETS.find(x => x.id === m)?.short ?? '';
const short = (ym: string) => ym.slice(2).replace('-', '.');

export function DrillDown({ items, snapshots, months, vat, vatFor, regimeOf, basis, currentYm, selectedYm, sheetMarketingByMonth }: Props) {
  const [range, setRange] = useState<'6' | '12'>('12');
  const [includeCurrent, setIncludeCurrent] = useState(false);
  const [path, setPath] = useState<Path>({});
  const [baseYm, setBaseYm] = useState<string | null>(null);

  const cols = useMemo(() => { const asc = [...months].sort(); const f = includeCurrent ? asc : asc.filter(m => m !== currentYm); return f.slice(-Number(range)); }, [months, includeCurrent, currentYm, range]);
  const base = baseYm && cols.includes(baseYm) ? baseYm : (cols.includes(selectedYm) ? selectedYm : cols[cols.length - 1]);
  const baseIdx = Math.max(0, cols.indexOf(base));
  const series = useMemo<SeriesPoint[]>(() => buildSeries(items, snapshots, cols, { vat, vatFor, regimeOf, basis }) as SeriesPoint[], [items, snapshots, cols, vat, vatFor, regimeOf, basis]);

  // ── 상품 데이터 (상품 단계에서 처음 열 때 한 번) ──
  const [prod, setProd] = useState<{ lines: Map<string, ProductLine[]>; sales: Map<string, SalesRowLite[]>; ads: Map<string, { coupang: AdProduct[]; toss: AdProduct[] }> } | null>(null);
  const [prodLoading, setProdLoading] = useState(false);
  const needProd = !!path.market;
  useEffect(() => {
    if (!needProd || prod || prodLoading) return;
    let cancelled = false;
    (async () => {
      setProdLoading(true);
      const [salesAll, pskus] = await Promise.all([
        fetch('/api/monthly-product-sales').then(r => r.ok ? r.json() : []) as Promise<(SalesRowLite & { year_month: string })[]>,
        fetch('/api/platform-skus').then(r => r.ok ? r.json() : []) as Promise<PlatformSkuLite[]>,
      ]);
      const psMap = buildPsMap(Array.isArray(pskus) ? pskus : []);
      const sales = new Map<string, SalesRowLite[]>();
      for (const s of Array.isArray(salesAll) ? salesAll : []) { const a = sales.get(s.year_month) ?? []; a.push(s); sales.set(s.year_month, a); }
      const adsArr = await Promise.all(cols.map(async m => {
        const [c, t] = await Promise.all([
          fetch(`/api/settlement/product-ads?year_month=${m}`).then(r => r.json()).catch(() => null),
          fetch(`/api/settlement/product-ads?year_month=${m}&platform=toss`).then(r => r.json()).catch(() => null),
        ]);
        return [m, { coupang: (c?.products ?? []) as AdProduct[], toss: (t?.products ?? []) as AdProduct[] }] as const;
      }));
      if (cancelled) return;
      const ads = new Map(adsArr);
      const lines = new Map<string, ProductLine[]>();
      for (const m of cols) { const s = sales.get(m) ?? []; const a = ads.get(m)!; if (!s.length && !a.coupang.length && !a.toss.length) continue; const l = computeProductLines(s, a.coupang, a.toss, psMap); allocateSheetMarketing(l, sheetMarketingByMonth?.(m)); lines.set(m, l); }
      setProd({ lines, sales, ads }); setProdLoading(false);
    })();
    return () => { cancelled = true; };
  }, [needProd, prod, prodLoading, cols, sheetMarketingByMonth]);

  if (cols.length === 0) return <div className="bg-card rounded-2xl p-8 text-center text-[13px] text-fg-4">저장된 월이 없습니다. 입력 탭에서 월을 저장하면 여기서 내려가며 볼 수 있습니다.</div>;

  const line: PlLine | undefined = path.key ? KEY_LINE[path.key] : undefined;
  const isCost = path.key ? COST_KEYS.includes(path.key) : false;
  const itemsOfLine = line ? itemRows(series, baseIdx, line) : [];
  const item = path.itemId ? itemsOfLine.find(r => r.id === path.itemId) : undefined;

  // ── 요약 문장 ──
  const summary = (() => {
    if (!path.key) return `${short(base)} 기준, 전월(${baseIdx > 0 ? short(cols[baseIdx - 1]) : '없음'})과 최근 3개월 평균 대비 변화를 봅니다. 라인을 누르면 어떤 항목이 움직였는지 내려갑니다.`;
    const lr = lineRows(series, baseIdx, [path.key])[0];
    const top = itemsOfLine.filter(r => r.delta.dPrev).slice(0, 3).map(r => `${r.parentLabel && r.parentLabel !== r.label ? r.parentLabel + ' > ' : ''}${r.label}${r.market && r.market !== 'common' ? `(${marketLabel(r.market)})` : ''} ${sign(r.delta.dPrev!)}${r.isNew ? ' 신규' : r.isGone ? ' 사라짐' : ''}`);
    return `${LINE_LABEL[path.key]} ${short(base)} ${fmtNum(lr.delta.cur)}원, 전월 대비 ${lr.delta.dPrev == null ? '-' : sign(lr.delta.dPrev)}${lr.delta.pctPrev != null ? ` (${lr.delta.pctPrev > 0 ? '+' : ''}${lr.delta.pctPrev.toFixed(1)}%)` : ''}, 3개월 평균 대비 ${lr.delta.dAvg == null ? '-' : sign(lr.delta.dAvg)}.${top.length ? ' 기여: ' + top.join(' · ') : ''}`;
  })();

  const crumbs: { label: string; onClick?: () => void }[] = [{ label: '손익 라인', onClick: () => setPath({}) }];
  if (path.key) crumbs.push({ label: LINE_LABEL[path.key], onClick: () => setPath({ key: path.key }) });
  if (item) crumbs.push({ label: `${item.parentLabel && item.parentLabel !== item.label ? item.parentLabel + ' > ' : ''}${item.label}`, onClick: () => setPath({ key: path.key, itemId: path.itemId }) });
  if (path.market) crumbs.push({ label: marketLabel(path.market) + ' 상품', onClick: () => setPath({ ...path, productKey: undefined }) });
  if (path.productKey) crumbs.push({ label: '옵션' });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex items-center gap-1 text-[13px] mr-auto min-w-0 flex-wrap">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-fg-5" />}
              {c.onClick && i < crumbs.length - 1 ? <button onClick={c.onClick} className="text-brand hover:underline">{c.label}</button> : <span className="font-semibold text-fg">{c.label}</span>}
            </span>
          ))}
        </nav>
        <label className="text-[12px] text-fg-3 flex items-center gap-1">기준 월
          <select value={base} onChange={e => setBaseYm(e.target.value)} className="h-8 rounded-lg border border-line bg-card px-2 text-[12px]">{cols.map(m => <option key={m} value={m}>{m}</option>)}</select>
        </label>
        <SegmentedControl items={[{ value: '6', label: '6개월' }, { value: '12', label: '12개월' }] as const} value={range} onChange={setRange} />
        <label className="text-[12px] text-fg-3 flex items-center gap-1"><input type="checkbox" checked={includeCurrent} onChange={e => setIncludeCurrent(e.target.checked)} />이번 달 포함</label>
      </div>
      <p className="text-[12px] text-fg-2 bg-brand-bg rounded-xl px-3 py-2">{summary}</p>

      {!path.key && <LineTable series={series} cols={cols} baseIdx={baseIdx} onPick={k => setPath({ key: k })} />}
      {path.key && !item && !path.market && (
        <ItemTable rows={itemsOfLine} cols={cols} baseIdx={baseIdx} isCost={isCost} onPick={r => setPath({ key: path.key, itemId: r.id, market: r.market && r.market !== 'common' ? r.market : undefined })} onProducts={m => setPath({ key: path.key, market: m })} line={line!} />
      )}
      {path.key && item && !path.market && (
        <div className="space-y-3">
          <ItemTable rows={[item]} cols={cols} baseIdx={baseIdx} isCost={isCost} line={line!} onProducts={m => setPath({ ...path, market: m })} />
          <p className="text-[12px] text-fg-4">이 항목은 마켓 태그가 없어(공통) 상품으로 내려갈 때 마켓 통합으로 봅니다.</p>
          <button onClick={() => setPath({ ...path, market: 'all' })} className="text-[12px] text-brand hover:underline">마켓 통합 상품별 보기 →</button>
        </div>
      )}
      {path.market && (
        <div className="space-y-4">
          {path.market !== 'all' && <MarketPanel series={series} cols={cols} baseIdx={baseIdx} market={path.market} />}
          {prodLoading || !prod ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>
            : !path.productKey ? (
              <ProductTable prod={prod} cols={cols} baseIdx={baseIdx} market={path.market} line={line} onMarket={m => setPath({ ...path, market: m })} onPick={k => setPath({ ...path, productKey: k })} />
            ) : (
              <OptionTable prod={prod} cols={cols} baseIdx={baseIdx} market={path.market} productKey={path.productKey} />
            )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── helpers ─────────────────────────
const sign = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v))}`;
function DeltaCell({ d, isCost, pct }: { d: Delta; isCost: boolean; pct?: boolean }) {
  const v = d.dPrev;
  if (v == null || (!pct && Math.abs(v) < 1)) return <td className="px-2 text-right text-fg-5">-</td>;
  const bad = isCost ? v > 0 : v < 0;
  return <td className={cn('px-2 text-right tabular-nums whitespace-nowrap', bad ? 'text-danger' : 'text-success')} title={d.pctPrev != null ? `${d.pctPrev > 0 ? '+' : ''}${d.pctPrev.toFixed(1)}%` : ''}>{pct ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%p` : sign(v)}</td>;
}
function AvgCell({ d, isCost, pct }: { d: Delta; isCost: boolean; pct?: boolean }) {
  const v = d.dAvg;
  if (v == null || (!pct && Math.abs(v) < 1)) return <td className="px-2 text-right text-fg-5">-</td>;
  const bad = isCost ? v > 0 : v < 0;
  return <td className={cn('px-2 text-right tabular-nums whitespace-nowrap', bad ? 'text-danger/80' : 'text-success/80')}>{pct ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%p` : sign(v)}</td>;
}
const Th = ({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) => <th title={title} className={cn('px-2 py-2 text-[11px] font-semibold text-fg-4 whitespace-nowrap text-right', className)}>{children}</th>;
const MonthCells = ({ values, baseIdx, pct }: { values: (number | null)[]; baseIdx: number; pct?: boolean }) => <>{values.map((v, i) => <td key={i} className={cn('px-2 text-right tabular-nums whitespace-nowrap', i === baseIdx ? 'bg-brand-bg/60 font-semibold text-fg' : 'text-fg-3')}>{v == null ? <span className="text-fg-5">·</span> : pct ? fmtPct(v, 1) : v === 0 ? <span className="text-fg-5">-</span> : fmtNum(v)}</td>)}</>;
const Flag = ({ f }: { f: string }) => <span className={cn('rounded px-1 py-0.5 text-[10px] font-semibold mr-1', f === '역마진' ? 'bg-danger/10 text-danger' : f === '광고과다' ? 'bg-warn/15 text-warn' : f === '신규' ? 'bg-brand-bg text-brand' : 'bg-app text-fg-4')}>{f}</span>;
const wrap = 'overflow-x-auto rounded-xl border border-line bg-card';
const tbl = 'w-full text-[12px] border-collapse';
const head = 'h-9 border-b border-line bg-card-2';
const rowCls = 'h-9 border-b border-line-2 hover:bg-app/60';

// ───────────────────────── L0 라인 ─────────────────────────
function LineTable({ series, cols, baseIdx, onPick }: { series: SeriesPoint[]; cols: string[]; baseIdx: number; onPick: (k: keyof PL) => void }) {
  const rows = lineRows(series, baseIdx, PL_ROWS.map(r => r.key));
  return (
    <div className={wrap}><table className={tbl}>
      <thead><tr className={head}><Th className="text-left sticky left-0 bg-card-2">라인</Th>{cols.map((m, i) => <Th key={m} className={i === baseIdx ? 'text-fg' : ''}>{short(m)}</Th>)}<Th title="기준 월 − 전월">Δ 전월</Th><Th title="기준 월 − 그 전 3개월 평균">Δ 3개월 평균</Th></tr></thead>
      <tbody>{rows.map(r => { const meta = PL_ROWS.find(x => x.key === r.key)!; const clickable = !!LINE_KEY[KEY_LINE[r.key]!]; const isCost = COST_KEYS.includes(r.key);
        return <tr key={r.key} className={cn(rowCls, meta.kind === 'subtotal' || meta.kind === 'result' ? 'bg-card-2/60 font-semibold' : '', clickable && 'cursor-pointer')} onClick={() => clickable && onPick(r.key)}>
          <td className={cn('px-2 sticky left-0 bg-card whitespace-nowrap', meta.indent && 'pl-5', clickable ? 'text-brand' : 'text-fg')}>{meta.label}{clickable && <ChevronRight className="inline h-3 w-3 ml-0.5 text-fg-5" />}</td>
          <MonthCells values={r.values} baseIdx={baseIdx} /><DeltaCell d={r.delta} isCost={isCost} /><AvgCell d={r.delta} isCost={isCost} /></tr>; })}</tbody>
    </table></div>
  );
}

// ───────────────────────── L1 항목 ─────────────────────────
function ItemTable({ rows, cols, baseIdx, isCost, line, onPick, onProducts }: { rows: ReturnType<typeof itemRows>; cols: string[]; baseIdx: number; isCost: boolean; line: PlLine; onPick?: (r: ReturnType<typeof itemRows>[number]) => void; onProducts?: (m: Market | 'all') => void }) {
  const productable = ['revenue', 'cogs', 'logistics', 'ad', 'marketing', 'market_fee'].includes(line);
  const markets = [...new Set(rows.map(r => r.market).filter((m): m is Market => !!m && m !== 'common'))];
  return (
    <div className="space-y-2">
      <div className={wrap}><table className={tbl}>
        <thead><tr className={head}><Th className="text-left sticky left-0 bg-card-2">항목</Th><Th className="text-left">마켓</Th>{cols.map((m, i) => <Th key={m} className={i === baseIdx ? 'text-fg' : ''}>{short(m)}</Th>)}<Th>Δ 전월</Th><Th title="이 라인 전월 대비 변화 중 이 항목 몫">기여</Th><Th>Δ 3개월 평균</Th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className={cn(rowCls, onPick && 'cursor-pointer')} onClick={() => onPick?.(r)}>
          <td className="px-2 sticky left-0 bg-card whitespace-nowrap text-fg">{r.parentLabel && r.parentLabel !== r.label && <span className="text-fg-4">{r.parentLabel} › </span>}{r.label}{r.isNew && <Flag f="신규" />}{r.isGone && <Flag f="사라짐" />}</td>
          <td className="px-2 text-fg-3 whitespace-nowrap">{r.market && r.market !== 'common' ? marketLabel(r.market) : <span className="text-fg-5">공통</span>}</td>
          <MonthCells values={r.values} baseIdx={baseIdx} /><DeltaCell d={r.delta} isCost={isCost} />
          <td className="px-2 text-right tabular-nums text-fg-4">{r.share == null || !r.delta.dPrev ? '-' : `${r.share.toFixed(0)}%`}</td>
          <AvgCell d={r.delta} isCost={isCost} /></tr>)}</tbody>
      </table></div>
      {productable && onProducts && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-fg-4">상품으로 내려가기:</span>
          {markets.map(m => <button key={m} onClick={() => onProducts(m)} className="rounded-lg border border-line px-2 h-7 text-brand hover:bg-brand-bg">{marketLabel(m)} 상품별</button>)}
          <button onClick={() => onProducts('all')} className="rounded-lg border border-line px-2 h-7 text-brand hover:bg-brand-bg">마켓 통합 상품별</button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── L2 마켓 ─────────────────────────
function MarketPanel({ series, cols, baseIdx, market }: { series: SeriesPoint[]; cols: string[]; baseIdx: number; market: Market }) {
  const rows = marketRows(series, baseIdx, market);
  return (
    <div className="space-y-1">
      <div className="text-[12px] text-fg-3">{marketLabel(market)} 건강도 — 시트 기준. 비율은 실매출 대비. 광고비율이 공헌이익률보다 빨리 오르면 광고를 더 써서 매출을 산 것입니다.</div>
      <div className={wrap}><table className={tbl}>
        <thead><tr className={head}><Th className="text-left sticky left-0 bg-card-2">지표</Th>{cols.map((m, i) => <Th key={m} className={i === baseIdx ? 'text-fg' : ''}>{short(m)}</Th>)}<Th>Δ 전월</Th><Th>Δ 3개월 평균</Th></tr></thead>
        <tbody>{rows.map(r => { const isCost = ['cogs', 'marketFee', 'logistics', 'ad', 'marketing', 'cogsRate', 'logisticsRate', 'adRate'].includes(r.key);
          return <tr key={r.key} className={cn(rowCls, (r.key === 'netRevenue' || r.key === 'contribution') && 'font-semibold bg-card-2/60')}><td className="px-2 sticky left-0 bg-card whitespace-nowrap text-fg">{r.label}</td><MonthCells values={r.values} baseIdx={baseIdx} pct={r.pct} /><DeltaCell d={r.delta} isCost={isCost} pct={r.pct} /><AvgCell d={r.delta} isCost={isCost} pct={r.pct} /></tr>; })}</tbody>
      </table></div>
    </div>
  );
}

// ───────────────────────── L3 상품 ─────────────────────────
type ProdData = { lines: Map<string, ProductLine[]>; sales: Map<string, SalesRowLite[]>; ads: Map<string, { coupang: AdProduct[]; toss: AdProduct[] }> };
type Focus = 'contribution' | 'revenue' | 'ad' | 'qty' | 'logistics' | 'cogs';
const FOCUS_OF: Partial<Record<PlLine, Focus>> = { ad: 'ad', marketing: 'ad', revenue: 'revenue', cogs: 'cogs', logistics: 'qty', market_fee: 'revenue' };
const FOCUS_ITEMS = [{ value: 'contribution', label: '공헌이익' }, { value: 'revenue', label: '매출' }, { value: 'ad', label: '광고·마케팅' }, { value: 'qty', label: '수량' }, { value: 'logistics', label: '물류(추정)' }, { value: 'cogs', label: '원가' }] as const;

function ProductTable({ prod, cols, baseIdx, market, line, onMarket, onPick }: { prod: ProdData; cols: string[]; baseIdx: number; market: Market | 'all'; line?: PlLine; onMarket: (m: Market | 'all') => void; onPick: (key: string) => void }) {
  const [focus, setFocus] = useState<Focus>((line && FOCUS_OF[line]) ?? 'contribution');
  const [onlyFlag, setOnlyFlag] = useState(false);
  const rows = useMemo(() => {
    const list = productRows(prod.lines, prod.ads, cols, baseIdx, market);
    const f = onlyFlag ? list.filter(r => r.flags.some(x => x === '역마진' || x === '광고과다')) : list;
    return f.sort((a, b) => Math.abs(b.d[focus].dPrev ?? 0) - Math.abs(a.d[focus].dPrev ?? 0) || b.revenue[baseIdx] - a.revenue[baseIdx]);
  }, [prod, cols, baseIdx, market, focus, onlyFlag]);
  const avail = [...new Set([...prod.lines.values()].flat().map(l => l.market))];
  const isCostFocus = focus !== 'revenue' && focus !== 'contribution' && focus !== 'qty';
  const tot = (f: (r: typeof rows[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-fg-4">마켓</span>
        <SegmentedControl items={[{ value: 'all', label: '통합' }, ...MARKETS.filter(m => avail.includes(m.id)).map(m => ({ value: m.id, label: m.short }))] as { value: Market | 'all'; label: string }[]} value={market} onChange={onMarket} />
        <span className="text-fg-4 ml-2">정렬 기준(Δ 전월)</span>
        <SegmentedControl items={FOCUS_ITEMS} value={focus} onChange={setFocus} />
        <label className="flex items-center gap-1 text-fg-3"><input type="checkbox" checked={onlyFlag} onChange={e => setOnlyFlag(e.target.checked)} />역마진·광고과다만</label>
      </div>
      <p className="text-[11px] text-fg-4">실매출·원가는 매출 파일, 광고는 raw 집계(쿠팡 ×1.1), 수수료·물류는 마켓 정책 추정, 마케팅은 시트 마켓별 매출 비례 배분. 공헌이익 = 실매출 − 원가 − 수수료 − 물류 − 광고 − 마케팅. 광고비율이 손익분기(광고 전 공헌이익률)를 넘으면 광고과다.{market !== 'all' && (market === 'coupang' || market === 'toss') ? ` 플랫폼 ROAS(${AD_WINDOW[market]})는 마켓 안 비교용 참고값이며 다른 마켓과 비교하지 마세요.` : ''}</p>
      <div className={wrap}><table className={cn(tbl, 'min-w-[1100px]')}>
        <thead><tr className={head}>
          <Th className="text-left sticky left-0 bg-card-2">상품</Th><Th className="text-left">표시</Th>
          <Th>실매출</Th><Th>Δ 매출</Th><Th>수량</Th><Th>Δ 수량</Th><Th>원가</Th><Th>물류(추정)</Th><Th>Δ 물류</Th><Th>광고+마케팅</Th><Th>Δ 광고</Th>
          <Th title="(광고+마케팅) ÷ 실매출">광고비율</Th><Th title="광고 전 공헌이익률 — 이보다 광고비율이 크면 적자">손익분기</Th><Th>공헌이익</Th><Th>Δ 공헌</Th><Th>마진율</Th>
          {(market === 'coupang' || market === 'toss') && <Th title="플랫폼 보고서 기여 매출 ÷ 광고비 — 마켓 안 비교용">ROAS({AD_WINDOW[market]})</Th>}
        </tr></thead>
        <tbody>
          {rows.map(r => <tr key={r.key} className={cn(rowCls, 'cursor-pointer')} onClick={() => onPick(r.key)}>
            <td className="px-2 sticky left-0 bg-card whitespace-nowrap text-brand max-w-[220px] truncate" title={r.name}>{r.name}<ChevronRight className="inline h-3 w-3 ml-0.5 text-fg-5" /></td>
            <td className="px-2 whitespace-nowrap">{r.flags.map(f => <Flag key={f} f={f} />)}</td>
            <td className="px-2 text-right tabular-nums">{fmtNum(r.revenue[baseIdx])}</td><DeltaCell d={r.d.revenue} isCost={false} />
            <td className="px-2 text-right tabular-nums">{fmtNum(r.qty[baseIdx])}</td><DeltaCell d={r.d.qty} isCost={false} />
            <td className="px-2 text-right tabular-nums text-fg-3">{fmtNum(r.cogs[baseIdx])}</td>
            <td className="px-2 text-right tabular-nums text-fg-3">{fmtNum(r.logistics[baseIdx])}</td><DeltaCell d={r.d.logistics} isCost />
            <td className="px-2 text-right tabular-nums">{fmtNum(r.ad[baseIdx] + r.marketing[baseIdx])}</td><DeltaCell d={r.d.ad} isCost />
            <td className={cn('px-2 text-right tabular-nums', r.adRate != null && r.beAdRate != null && r.adRate > r.beAdRate ? 'text-danger font-semibold' : '')}>{fmtPct(r.adRate, 0)}</td>
            <td className="px-2 text-right tabular-nums text-fg-4">{fmtPct(r.beAdRate, 0)}</td>
            <td className={cn('px-2 text-right tabular-nums font-semibold', r.contribution[baseIdx] < 0 ? 'text-danger' : 'text-fg')}>{fmtNum(r.contribution[baseIdx])}</td><DeltaCell d={r.d.contribution} isCost={false} />
            <td className={cn('px-2 text-right tabular-nums', r.margin != null && r.margin < 0 ? 'text-danger' : r.margin != null && r.margin < 10 ? 'text-warn' : '')}>{fmtPct(r.margin, 0)}</td>
            {(market === 'coupang' || market === 'toss') && <td className="px-2 text-right tabular-nums text-fg-4">{fmtPct(r.platformRoas, 0)}</td>}
          </tr>)}
          <tr className="h-9 font-semibold bg-card-2/60"><td className="px-2 sticky left-0 bg-card-2">합계 {rows.length}개</td><td />
            <td className="px-2 text-right tabular-nums">{fmtNum(tot(r => r.revenue[baseIdx]))}</td><DeltaCell d={deltaOf(cols.map((_, i) => tot(r => r.revenue[i])), baseIdx)} isCost={false} />
            <td className="px-2 text-right tabular-nums">{fmtNum(tot(r => r.qty[baseIdx]))}</td><DeltaCell d={deltaOf(cols.map((_, i) => tot(r => r.qty[i])), baseIdx)} isCost={false} />
            <td className="px-2 text-right tabular-nums">{fmtNum(tot(r => r.cogs[baseIdx]))}</td>
            <td className="px-2 text-right tabular-nums">{fmtNum(tot(r => r.logistics[baseIdx]))}</td><DeltaCell d={deltaOf(cols.map((_, i) => tot(r => r.logistics[i])), baseIdx)} isCost />
            <td className="px-2 text-right tabular-nums">{fmtNum(tot(r => r.ad[baseIdx] + r.marketing[baseIdx]))}</td><DeltaCell d={deltaOf(cols.map((_, i) => tot(r => r.ad[i] + r.marketing[i])), baseIdx)} isCost />
            <td colSpan={2} />
            <td className="px-2 text-right tabular-nums">{fmtNum(tot(r => r.contribution[baseIdx]))}</td><DeltaCell d={deltaOf(cols.map((_, i) => tot(r => r.contribution[i])), baseIdx)} isCost={false} />
            <td colSpan={(market === 'coupang' || market === 'toss') ? 2 : 1} /></tr>
        </tbody>
      </table></div>
      {isCostFocus && <p className="text-[11px] text-fg-5">비용 기준 정렬: 늘어난 순. 항목 합계와 시트 확정값은 기준(파일 vs 정산서)이 달라 몇 % 차이가 날 수 있습니다.</p>}
    </div>
  );
}

// ───────────────────────── L4 옵션 ─────────────────────────
function OptionTable({ prod, cols, baseIdx, market, productKey }: { prod: ProdData; cols: string[]; baseIdx: number; market: Market | 'all'; productKey: string }) {
  const prow = useMemo(() => productRows(prod.lines, prod.ads, cols, baseIdx, market).find(r => r.key === productKey), [prod, cols, baseIdx, market, productKey]);
  const rows = useMemo(() => prow ? optionRows(prod.sales, prod.ads, cols, baseIdx, market, prow.productId, prow.name) : [], [prod, cols, baseIdx, market, prow]);
  if (!prow) return null;
  return (
    <div className="space-y-2">
      <div className="text-[13px] font-semibold text-fg">{prow.name} · {marketLabel(market)} · 옵션별</div>
      <p className="text-[11px] text-fg-4">옵션 단위 공헌이익 = 실매출 − 원가 − 수수료(정책) − 물류(정책) − 광고. 시트 마케팅 배분은 상품 단계까지만 반영됩니다. 광고가 옵션ID 로 매칭되지 않은 몫은 (옵션 미매칭) 줄에 모입니다.</p>
      <div className={wrap}><table className={cn(tbl, 'min-w-[900px]')}>
        <thead><tr className={head}><Th className="text-left sticky left-0 bg-card-2">옵션</Th><Th className="text-left">SKU</Th><Th className="text-left">표시</Th>
          {cols.map((m, i) => <Th key={m} className={i === baseIdx ? 'text-fg' : ''}>{short(m)} 공헌</Th>)}
          <Th>실매출</Th><Th>Δ 매출</Th><Th>수량</Th><Th>Δ 수량</Th><Th>광고</Th><Th>Δ 광고</Th><Th>공헌이익</Th><Th>Δ 공헌</Th>
          {(market === 'coupang' || market === 'toss') && <Th>ROAS({AD_WINDOW[market]})</Th>}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className={rowCls}>
          <td className="px-2 sticky left-0 bg-card whitespace-nowrap text-fg">{r.label || '(이름 없음)'}</td>
          <td className="px-2 text-fg-4 font-mono text-[11px] whitespace-nowrap">{r.skuCode ?? ''}</td>
          <td className="px-2 whitespace-nowrap">{r.flags.map(f => <Flag key={f} f={f} />)}</td>
          <MonthCells values={r.contribution} baseIdx={baseIdx} />
          <td className="px-2 text-right tabular-nums">{fmtNum(r.revenue[baseIdx])}</td><DeltaCell d={r.d.revenue} isCost={false} />
          <td className="px-2 text-right tabular-nums">{fmtNum(r.qty[baseIdx])}</td><DeltaCell d={r.d.qty} isCost={false} />
          <td className="px-2 text-right tabular-nums">{fmtNum(r.ad[baseIdx])}</td><DeltaCell d={r.d.ad} isCost />
          <td className={cn('px-2 text-right tabular-nums font-semibold', r.contribution[baseIdx] < 0 ? 'text-danger' : '')}>{fmtNum(r.contribution[baseIdx])}</td><DeltaCell d={r.d.contribution} isCost={false} />
          {(market === 'coupang' || market === 'toss') && <td className="px-2 text-right tabular-nums text-fg-4">{fmtPct(r.platformRoas, 0)}</td>}
        </tr>)}</tbody>
      </table></div>
    </div>
  );
}
