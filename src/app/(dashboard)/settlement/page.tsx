'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Circle, HelpCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, useTabParam } from '@/components/ui/tabs';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { inputClassName } from '@/components/ui/input';
import { useVat } from '@/components/layout/vat-provider';
import { cn } from '@/lib/utils';
import { MARKETS, SALES_MARKETS, buildPL, currentYm, lastMonths, ymLabel, type Market } from './_lib/settlement';
import { useOrderCounts, useSettlementData } from './_lib/useSettlementData';
import { CostEditor } from './_components/CostEditor';
import { CostUpload } from './_components/CostUpload';
import { AdCoverageCard } from './_components/AdCoverageCard';
import { TrendPL } from './_components/TrendPL';
import { AnalysisView } from './_components/AnalysisView';
import { ProductProfit } from './_components/ProductProfit';

const TABS = ['input', 'trend', 'analysis', 'products'] as const;
type Tab = typeof TABS[number];

export default function SettlementPage() {
  return (
    <Suspense fallback={null}>
      <SettlementInner />
    </Suspense>
  );
}

function SettlementInner() {
  const [tab, setTabRaw] = useTabParam<Tab>('tab', TABS, 'input');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ymParam = searchParams.get('ym');
  const [selectedYm, setSelectedYmState] = useState(() => (ymParam && /^\d{4}-\d{2}$/.test(ymParam) ? ymParam : currentYm()));
  // 월을 URL(?ym=)에도 기록 — 새로고침·링크 공유 시 유지
  const setSelectedYmRaw = useCallback((ym: string) => {
    setSelectedYmState(ym);
    const params = new URLSearchParams(searchParams.toString());
    if (ym === currentYm()) params.delete('ym'); else params.set('ym', ym);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);
  const [dirty, setDirty] = useState(false);
  const [dataKey, setDataKey] = useState(0);
  const [costReloadKey, setCostReloadKey] = useState(0);
  const confirmDialog = useConfirm();
  const { vatOn } = useVat();
  const vat = vatOn ? 'incl' : 'ex';

  const data = useSettlementData(dataKey);
  const orderCounts = useOrderCounts(tab === 'analysis' ? selectedYm : null);

  const guard = useCallback(async (next: () => void) => {
    if (dirty && !(await confirmDialog('저장하지 않은 변경사항이 있습니다\n무시하고 이동할까요? 입력한 금액이 사라집니다.'))) return;
    next();
  }, [dirty, confirmDialog]);
  const setTab = (t: Tab) => guard(() => setTabRaw(t));
  const setSelectedYm = (ym: string) => guard(() => setSelectedYmRaw(ym));

  const monthOptions = useMemo(() => {
    const set = new Set([...lastMonths(18), ...data.months, selectedYm]);
    return [...set].sort().reverse();
  }, [data.months, selectedYm]);

  const amounts = useMemo(() => data.amountsFor(selectedYm), [data, selectedYm]);
  const prevYm = useMemo(() => { const [y, m] = selectedYm.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }, [selectedYm]);
  const prevAmounts = useMemo(() => { const m = data.amountsFor(prevYm); return m.size ? m : null; }, [data, prevYm]);
  const sheetMarkets = useMemo(() => amounts.size ? buildPL(data.items, (it) => amounts.get(it.id) ?? 0, { vat: 'incl' }).markets : [], [data.items, amounts]);

  const tabItems = [
    { value: 'input' as Tab, label: '입력' },
    { value: 'trend' as Tab, label: '월별 추이', count: data.months.length || undefined },
    { value: 'analysis' as Tab, label: '분석' },
    { value: 'products' as Tab, label: '상품별 순이익' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="정산" description="월 단위로 마켓 실적을 모아 손익을 확인합니다. 월을 먼저 고르고 아래 순서대로 진행하세요.">
        <label className="flex items-center gap-2 text-[12px] text-fg-3">
          <span className="hidden sm:inline">정산 월</span>
          <select value={selectedYm} onChange={(e) => setSelectedYm(e.target.value)} className={cn(inputClassName, 'w-auto font-semibold text-brand cursor-pointer')}>
            {monthOptions.map(ym => <option key={ym} value={ym}>{ymLabel(ym)}{data.months.includes(ym) ? ' · 저장됨' : ''}</option>)}
          </select>
        </label>
      </PageHeader>

      <Tabs items={tabItems} value={tab} onChange={setTab} className="overflow-y-hidden" />

      {tab === 'input' && (
        <div className="space-y-4">
          <StepGuide selectedYm={selectedYm} saved={data.months.includes(selectedYm)} reloadKey={costReloadKey} />
          <CostUpload selectedYm={selectedYm} onApply={() => setCostReloadKey(k => k + 1)} />
          <AdCoverageCard selectedYm={selectedYm} onSaved={() => setCostReloadKey(k => k + 1)} />
          <CostEditor reloadKey={costReloadKey} selectedYm={selectedYm} onDirtyChange={setDirty} onSaved={() => setDataKey(k => k + 1)} />
        </div>
      )}
      {tab === 'trend' && <TrendPL items={data.items} snapshots={data.snapshots} months={data.months} vat={vat} currentYm={currentYm()} loading={data.loading} />}
      {tab === 'analysis' && (
        data.loading ? <div className="bg-card rounded-2xl p-8 text-center text-[13px] text-fg-4">불러오는 중…</div>
          : <AnalysisView items={data.items} amounts={amounts} ym={selectedYm} vat={vat} orderCounts={orderCounts} prevAmounts={prevAmounts} />
      )}
      {tab === 'products' && <ProductProfit ym={selectedYm} sheetMarkets={sheetMarkets} />}
    </div>
  );
}

/** 월 마감 순서 안내 + 진행 상태. 누가 해도 같은 순서로 가도록. */
function StepGuide({ selectedYm, saved, reloadKey }: { selectedYm: string; saved: boolean; reloadKey: number }) {
  const [salesMarkets, setSalesMarkets] = useState<Market[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/monthly-product-sales?year_month=${selectedYm}`).then(r => r.ok ? r.json() : []).then((rows: any[]) => {
      if (cancelled) return;
      setSalesMarkets([...new Set(rows.map(r => r.platform as Market))].filter(m => SALES_MARKETS.includes(m)));
    }).catch(() => { if (!cancelled) setSalesMarkets([]); });
    return () => { cancelled = true; };
  }, [selectedYm, reloadKey]);

  const steps: { title: string; done: boolean; desc: string; help: string }[] = [
    {
      title: '마켓 매출 파일 올리기',
      done: (salesMarkets?.length ?? 0) > 0,
      desc: salesMarkets?.length ? `올린 마켓: ${salesMarkets.map(m => MARKETS.find(x => x.id === m)?.short).join(' · ')}` : '쿠팡 · 토스 · 스스 · ESM 순서로 하나씩',
      help: '쿠팡: 셀러 인사이트 > 상품별 판매 > 월 선택 > 엑셀 다운로드\n토스: 판매자센터 > 주문 > 전체주문조회 > 기간 선택 > 엑셀 (구매확정만 집계)\n스스: 스마트스토어센터 > 판매관리 > 주문조회 > 엑셀 다운로드 (양식은 금액 컬럼 포함으로, 비밀번호 123123)\nESM: ESM PLUS > 주문통합검색 > 결제일 기간 > 엑셀 (구매결정완료만 집계)',
    },
    {
      title: '광고 raw 확인',
      done: false,
      desc: '광고 분석에 올린 PA 보고서를 그대로 사용',
      help: '쿠팡 광고센터 > 보고서 > 상품광고 일별 키워드 보고서 (해당 월 전체) 다운로드 → 광고 분석 페이지 "데이터 추가" → 배너가 뜨면 "지금 DB 로 동기화". 아래 광고비 raw 카드에 ✓ 가 보이면 완료.',
    },
    {
      title: '시트 입력 후 저장',
      done: saved,
      desc: saved ? '이 달 시트가 저장돼 있습니다' : '계산서·마켓 정산 화면을 보고 빈칸을 채운 뒤 저장',
      help: '택배비 계산서(대형=쿠팡 입고, 소형=토스·스스·ESM), 로켓그로스 월 정산서, 마켓별 수수료 정산서, 광고 플랫폼 월 청구액을 각 칸에 그대로 적습니다. 전월과 같은 항목은 "이전 월 붙여넣기" 후 바뀐 것만 고칩니다.',
    },
  ];

  return (
    <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-4 md:px-5 py-4">
      <div className="grid md:grid-cols-3 gap-3">
        {steps.map((s, i) => (
          <div key={s.title} className={cn('flex items-start gap-3 rounded-xl px-3 py-2.5', s.done ? 'bg-success/5' : 'bg-card-2')}>
            {s.done ? <CheckCircle2 className="h-5 w-5 text-success shrink-0" /> : <Circle className="h-5 w-5 text-fg-5 shrink-0" />}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                <span className="text-fg-4 tabular-nums">{i + 1}.</span> {s.title}
                <span title={s.help} className="cursor-help text-fg-4 hover:text-brand"><HelpCircle className="h-3.5 w-3.5" /></span>
              </div>
              <p className="text-[11px] text-fg-3 mt-0.5 truncate" title={s.desc}>{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
