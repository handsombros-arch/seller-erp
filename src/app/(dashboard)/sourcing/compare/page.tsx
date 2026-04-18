'use client';

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ExternalLink, Trophy, Minus } from 'lucide-react';
import { getCategoryDimensions, matchDimension } from '@/lib/sourcing-dimensions';

type Item = any;

function Badge({ children, color = 'gray' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-700',
    green: 'bg-green-100 text-green-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    red: 'bg-red-100 text-red-700',
    blue: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
  };
  return <span className={`px-2 py-0.5 rounded text-xs ${colors[color]}`}>{children}</span>;
}

/* ─── 단위 정규화 ─── */
function parsePrice(v?: string | number | null): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[^\d.]/g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function parseWeight(v?: string | null): { value: number; unit: 'g' } | null {
  if (!v) return null;
  const s = String(v).toLowerCase().replace(/\s+/g, '');
  const m = s.match(/([\d.]+)\s*(kg|g|밀리그램|mg|킬로그램|킬로|키로|kilo)/);
  if (!m) {
    // 단위 없는 숫자 — 일단 g로 가정
    const num = parseFloat(s);
    return isFinite(num) && num > 0 ? { value: num, unit: 'g' } : null;
  }
  const num = parseFloat(m[1]);
  const unit = m[2];
  if (!isFinite(num)) return null;
  if (unit.startsWith('k') || unit.includes('킬') || unit.includes('키로') || unit === 'kilo') return { value: num * 1000, unit: 'g' };
  if (unit === 'mg' || unit.includes('밀리')) return { value: num / 1000, unit: 'g' };
  return { value: num, unit: 'g' };
}

function parseSize(v?: string | null): { w: number; h: number; d: number } | null {
  if (!v) return null;
  const s = String(v).toLowerCase().replace(/\s+/g, '');
  // 30x40x12 또는 30*40*12 또는 30x40x12cm
  const m = s.match(/([\d.]+)[x*×]([\d.]+)[x*×]([\d.]+)/);
  if (!m) return null;
  const [a, b, c] = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
  if (!isFinite(a) || !isFinite(b) || !isFinite(c)) return null;
  return { w: a, h: b, d: c };
}

function parseCapacity(v?: string | null): { value: number; unit: 'ml' } | null {
  if (!v) return null;
  const s = String(v).toLowerCase().replace(/\s+/g, '');
  const m = s.match(/([\d.]+)\s*(ml|l|리터|밀리)/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!isFinite(num)) return null;
  if (m[2] === 'l' || m[2].includes('리터')) return { value: num * 1000, unit: 'ml' };
  return { value: num, unit: 'ml' };
}

function parseRating(v?: number | string | null): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v));
  return isFinite(n) ? n : null;
}

/* ─── 비교 헬퍼 ─── */
type WinnerMode = 'higher' | 'lower';
function findWinner(values: (number | null)[], mode: WinnerMode): number | null {
  const valid = values.map((v, i) => ({ v, i })).filter((x) => x.v != null) as { v: number; i: number }[];
  if (valid.length < 2) return null;
  const sorted = mode === 'higher' ? [...valid].sort((a, b) => b.v - a.v) : [...valid].sort((a, b) => a.v - b.v);
  // 동점이면 winner 없음
  if (sorted[0].v === sorted[1].v) return null;
  return sorted[0].i;
}

function WinnerCell({ children, isWinner, isMissing }: { children: React.ReactNode; isWinner?: boolean; isMissing?: boolean }) {
  if (isMissing) {
    return <span className="inline-flex items-center gap-1 text-xs text-gray-400 italic"><Minus className="w-3 h-3" /> 미표기</span>;
  }
  return (
    <span className={isWinner ? 'inline-flex items-center gap-1 font-bold text-green-700' : ''}>
      {isWinner && <Trophy className="w-3.5 h-3.5 text-yellow-500" />}
      {children}
    </span>
  );
}

/* ─── 스펙 그룹 정규화 (확장) ─── */
const SPEC_ALIASES: Record<string, string[]> = {
  '무게': ['무게', 'weight', '중량', '본체무게'],
  '크기': ['크기', 'size', '사이즈', '치수', 'dimensions', '제품크기'],
  '재질': ['재질', 'material', '소재', '본체소재'],
  '색상': ['색상', 'color', '컬러'],
  '용량': ['용량', 'capacity', '수용량', '내부용량', '저장용량', '물통', '수통', '물탱크', '탱크용량'],
  '원산지': ['원산지', '제조국', 'origin', '생산지'],
  '방수': ['방수', '방수성', 'waterproof', '방수등급', '방진'],
  '소음': ['소음', '소음도', 'db', '데시벨', '소음수준'],
  '전력': ['전력', '소비전력', '전력소비', '소모전력', 'wattage'],
  '전압': ['전압', 'voltage', 'v', '입력전압'],
  '배터리': ['배터리', 'battery', '배터리용량', 'mah'],
  '충전시간': ['충전시간', 'charging', '완충시간'],
  '충전방식': ['충전방식', '충전타입', '충전포트', '충전단자'],
  '사용시간': ['사용시간', '연속사용', '작동시간', '사용가능'],
  '수압': ['수압', '맥동수', '분사횟수', '분사강도', '수류세기', '수압강도'],
  '분사모드': ['분사모드', '분사', '모드', '워터모드', '세정모드', '사용모드'],
  '노즐': ['노즐', '노즐개수', '노즐기능', '노즐타입', '노즐종류', '팁'],
  '인증': ['인증', '전기안전', '전자파'],
  '내하중': ['내하중', '하중', '최대하중', 'load'],
  '보증': ['보증', '보증기간', '워런티', 'warranty', 'as', 'a/s', 'A/S'],
  '에너지등급': ['에너지등급', '에너지효율'],
  '주성분': ['주성분', '성분', '유효성분', 'ingredient'],
  '제형': ['제형', '타입', 'texture'],
  '향': ['향', '향료', 'fragrance', 'scent'],
  '피부타입': ['피부타입', '피부', 'skin'],
  '유통기한': ['유통기한', '사용기한', '소비기한'],
  'PH': ['ph', '산도'],
  '신축성': ['신축성', '탄력', 'stretch'],
  '안감': ['안감', '내피', '내장재'],
  '세탁법': ['세탁법', '세탁', '관리법', 'wash'],
  '노트북칸': ['노트북칸', '노트북', '랩탑', 'laptop'],
  '수납포켓': ['수납포켓', '포켓', '주머니', '내부수납'],
  '끈길이': ['끈길이', '스트랩', 'strap', '어깨끈'],
  '모델명': ['모델명', '모델번호', 'model'],
};

// 차원 정규화는 @/lib/sourcing-dimensions 의 CATEGORY_DIMENSIONS 를 소스 오브 트루스로 사용.
// 카테고리별 표준 차원 리스트에 매칭 시도 → 실패 시 원본 그대로 (기타 섹션).

// 키를 표준 키로 정규화. 매칭 안 되면 원본 키.
function normalizeKey(rawKey: string): string {
  if (!rawKey || rawKey.startsWith('_')) return rawKey;
  const lower = rawKey.toLowerCase().replace(/[\s_\-/·,·]/g, '');
  for (const [canonical, aliases] of Object.entries(SPEC_ALIASES)) {
    for (const a of aliases) {
      const al = a.toLowerCase().replace(/[\s_\-/·,·]/g, '');
      if (lower === al || lower.includes(al) || al.includes(lower)) return canonical;
    }
  }
  return rawKey;
}


function findSpec(specs: any, aliases: string[]): any {
  if (!specs) return null;
  for (const a of aliases) {
    for (const k of Object.keys(specs)) {
      if (k.startsWith('_')) continue;
      if (k.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(k.toLowerCase())) {
        return specs[k];
      }
    }
  }
  return null;
}

export default function ComparePage() {
  const params = useSearchParams();
  const ids = (params?.get('ids') || '').split(',').filter(Boolean);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (ids.length === 0) { setLoading(false); return; }
    Promise.all(ids.map((id) => fetch('/api/sourcing/' + id).then((r) => r.ok ? r.json() : null)))
      .then((arr) => setItems(arr.filter(Boolean)))
      .finally(() => setLoading(false));
  }, [ids.join(',')]);

  /* 비교 데이터 사전 계산 */
  const comparisons = useMemo(() => {
    if (items.length === 0) return null;

    // 가격 (낮을수록 승)
    const prices = items.map((it) => parsePrice(it.product_info?.finalPrice || it.product_info?.price));
    const priceWinner = findWinner(prices, 'lower');

    // 평점 (높을수록 승)
    const ratings = items.map((it) => parseRating(it.review_stats?.avgRating));
    const ratingWinner = findWinner(ratings, 'higher');

    // 리뷰 수 (높을수록 승 — 신뢰도)
    const reviewCounts = items.map((it) => parseRating(it.review_stats?.total));
    const reviewCountWinner = findWinner(reviewCounts, 'higher');

    // 중립 점수 (높을수록 승)
    const neutralScores = items.map((it) => parseRating(it.review_analysis?.neutral_score));
    const neutralWinner = findWinner(neutralScores, 'higher');

    // 무게 (낮을수록 승)
    const weights = items.map((it) => parseWeight(findSpec(it.detail_analysis?.specs, SPEC_ALIASES['무게'])));
    const weightValues = weights.map((w) => w?.value ?? null);
    const weightWinner = findWinner(weightValues, 'lower');

    // 용량 (높을수록 승) — 카테고리 따라 다르지만 일반적으로
    const capacities = items.map((it) => parseCapacity(findSpec(it.detail_analysis?.specs, SPEC_ALIASES['용량'])));
    const capacityValues = capacities.map((c) => c?.value ?? null);
    const capacityWinner = findWinner(capacityValues, 'higher');

    // 차원별 점수 비교 — 카테고리 표준 차원 리스트 기준 매칭
    // 1) 첫 상품 카테고리(혹은 다수결)로 canonical 리스트 결정
    const categories = items.map((it) => it.detail_analysis?.category).filter(Boolean) as string[];
    const primaryCategory = categories[0] || '';
    const canonicalDims = getCategoryDimensions(primaryCategory);

    // 2) 각 상품 차원을 canonical 에 매핑. 매칭 실패 시 'extra' 로 보관
    type DimEntry = { score: number | null; verdict?: string; spec_evidence?: string; originals: string[] };
    const itemDimMap: Record<string, DimEntry>[] = items.map((it) => {
      const byKey: Record<string, DimEntry> = {};
      for (const d of (it.review_analysis?.category_dimensions_scored || []) as any[]) {
        const key = matchDimension(d.dimension || '', canonicalDims) || (d.dimension || '(unnamed)');
        const score = d.score != null ? Number(d.score) : null;
        if (!byKey[key]) {
          byKey[key] = { score, verdict: d.verdict, spec_evidence: d.spec_evidence, originals: [d.dimension].filter(Boolean) };
        } else {
          if (score != null && (byKey[key].score == null || score > (byKey[key].score as number))) {
            byKey[key].score = score;
            byKey[key].verdict = d.verdict;
          }
          if (d.spec_evidence && !byKey[key].spec_evidence) byKey[key].spec_evidence = d.spec_evidence;
          if (d.dimension) byKey[key].originals.push(d.dimension);
        }
      }
      return byKey;
    });

    // canonical 차원은 리스트 순서로, 기타는 뒤에 (canonical 외 key)
    const canonicalSet = new Set(canonicalDims);
    const extraDims = Array.from(new Set(itemDimMap.flatMap((m) => Object.keys(m)))).filter((k) => !canonicalSet.has(k));
    const allDimensions = [...canonicalDims, ...extraDims];
    const dimensionWinners: Record<string, number | null> = {};
    allDimensions.forEach((dim) => {
      const scores = itemDimMap.map((m) => (m[dim]?.score ?? null));
      dimensionWinners[dim] = findWinner(scores, 'higher');
    });

    // 모든 스펙 키 정규화 후 합집합 (의미 같은 키는 하나로 묶임)
    const normalizedKeySet = new Set<string>();
    const keyOriginalsMap = new Map<string, Set<string>>();  // canonical → 원본 키들
    items.forEach((it) => {
      Object.keys(it.detail_analysis?.specs || {}).filter((k) => !k.startsWith('_')).forEach((k) => {
        const canonical = normalizeKey(k);
        normalizedKeySet.add(canonical);
        if (!keyOriginalsMap.has(canonical)) keyOriginalsMap.set(canonical, new Set());
        keyOriginalsMap.get(canonical)!.add(k);
      });
    });
    const allSpecKeys = Array.from(normalizedKeySet);

    return {
      prices, priceWinner,
      ratings, ratingWinner,
      reviewCounts, reviewCountWinner,
      neutralScores, neutralWinner,
      weights, weightWinner,
      capacities, capacityWinner,
      allDimensions, dimensionWinners, itemDimMap,
      canonicalDims, extraDims, primaryCategory,
      allSpecKeys,
      keyOriginalsMap,
    };
  }, [items]);

  // 정규화된 키로 모든 상품에서 값 조회 (원본 키 변형 모두 매칭)
  const getSpecValue = (it: any, canonicalKey: string) => {
    const originals = comparisons?.keyOriginalsMap.get(canonicalKey);
    const specs = it.detail_analysis?.specs || {};
    // 1) 정확히 일치하는 원본 키
    if (originals) {
      for (const orig of originals) {
        const v = specs[orig];
        if (v != null && v !== '' && v !== '미표기') return v;
      }
    }
    // 2) alias 매칭 fallback
    const aliases = SPEC_ALIASES[canonicalKey];
    if (aliases) {
      const v = findSpec(specs, aliases);
      if (v != null && v !== '' && v !== '미표기') return v;
    }
    return null;
  };

  if (loading) return <div className="text-gray-500">로딩...</div>;
  if (items.length === 0) return <div className="text-gray-500">선택된 상품이 없습니다.</div>;
  if (!comparisons) return null;

  const c = comparisons;

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex items-center justify-between">
        <Link href="/sourcing" className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> 목록으로
        </Link>
        <div className="text-sm text-gray-500">{items.length}개 상품 비교 · 🏆 = 카테고리 1위</div>
      </div>

      <h1 className="text-xl font-bold">상품 비교</h1>

      {/* 종합 우승 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {c.priceWinner !== null && (
          <SummaryCard label="최저가" winner={items[c.priceWinner]} value={items[c.priceWinner].product_info?.finalPrice || items[c.priceWinner].product_info?.price} />
        )}
        {c.ratingWinner !== null && (
          <SummaryCard label="최고 평점" winner={items[c.ratingWinner]} value={`${items[c.ratingWinner].review_stats?.avgRating}★`} />
        )}
        {c.neutralWinner !== null && (
          <SummaryCard label="최고 중립점수" winner={items[c.neutralWinner]} value={`${items[c.neutralWinner].review_analysis?.neutral_score}/10`} />
        )}
        {c.reviewCountWinner !== null && (
          <SummaryCard label="최다 리뷰" winner={items[c.reviewCountWinner]} value={`${items[c.reviewCountWinner].review_stats?.total}개`} />
        )}
      </div>

      <div className="overflow-x-auto border rounded-lg bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b sticky top-0 z-10">
            <tr>
              <th className="text-left px-3 py-2 font-medium w-32 sticky left-0 bg-gray-50 z-20"></th>
              {items.map((it) => (
                <th key={it.id} className="text-left px-3 py-3 font-normal min-w-[260px]" style={{verticalAlign: 'top'}}>
                  <div className="space-y-2">
                    {it.product_info?.thumbnailUrl && (
                      <img src={it.product_info.thumbnailUrl} alt="" className="w-20 h-20 object-cover rounded border" />
                    )}
                    <Link href={`/sourcing/${it.id}`} className="text-blue-600 hover:underline font-medium block leading-tight">
                      {it.product_info?.title || '(제목 없음)'}
                    </Link>
                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:underline flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> 원본
                    </a>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            <SectionHead label="기본 정보" cols={items.length + 1} />
            <Row label="플랫폼" items={items} render={(it) => <Badge>{it.platform}</Badge>} />
            <Row label="카테고리" items={items} render={(it) => it.detail_analysis?.category || <Missing />} />

            <SectionHead label="가격 (정규화 비교)" cols={items.length + 1} />
            <Row label="최종가" items={items} render={(it, i) => (
              <div>
                <WinnerCell isWinner={i === c.priceWinner} isMissing={c.prices[i] == null}>
                  <span className="text-base font-bold">{it.product_info?.finalPrice || it.product_info?.price}</span>
                </WinnerCell>
                {c.prices[i] != null && c.prices[c.priceWinner!] != null && i !== c.priceWinner && c.priceWinner !== null && (
                  <div className="text-xs text-red-500 mt-0.5">+{((c.prices[i]! - c.prices[c.priceWinner]!)/c.prices[c.priceWinner]!*100).toFixed(0)}% 비쌈</div>
                )}
                {it.product_info?.originalPrice && it.product_info.originalPrice !== it.product_info.finalPrice && (
                  <div className="text-xs text-gray-400 line-through">{it.product_info.originalPrice}</div>
                )}
              </div>
            )} />

            <SectionHead label="리뷰 신뢰도" cols={items.length + 1} />
            <Row label="총 리뷰 수" items={items} render={(it, i) => (
              <WinnerCell isWinner={i === c.reviewCountWinner} isMissing={c.reviewCounts[i] == null}>
                {it.review_stats?.total ?? '-'}개
              </WinnerCell>
            )} />
            <Row label="평균 별점" items={items} render={(it, i) => (
              <WinnerCell isWinner={i === c.ratingWinner} isMissing={c.ratings[i] == null}>
                {it.review_stats?.avgRating != null ? `${it.review_stats.avgRating}★` : '-'}
              </WinnerCell>
            )} />
            <Row label="중립 종합점수" items={items} render={(it, i) => (
              <WinnerCell isWinner={i === c.neutralWinner} isMissing={c.neutralScores[i] == null}>
                <ScoreCell score={it.review_analysis?.neutral_score} />
              </WinnerCell>
            )} />
            <Row label="문의 수" items={items} render={(it) => it.inquiries_count != null ? `${it.inquiries_count}건` : <Missing />} />
            <Row label="감성 분포" items={items} render={(it) => {
              const sb = it.review_analysis?.sentiment_breakdown;
              if (!sb) return <Missing />;
              return (
                <div>
                  <div className="flex h-5 rounded overflow-hidden text-[10px]">
                    {sb.positive_pct > 0 && <div className="bg-green-500 text-white text-center" style={{width: `${sb.positive_pct}%`}}>{sb.positive_pct}</div>}
                    {sb.neutral_pct > 0 && <div className="bg-gray-400 text-white text-center" style={{width: `${sb.neutral_pct}%`}}>{sb.neutral_pct}</div>}
                    {sb.negative_pct > 0 && <div className="bg-red-500 text-white text-center" style={{width: `${sb.negative_pct}%`}}>{sb.negative_pct}</div>}
                  </div>
                </div>
              );
            }} />

            <SectionHead label="소싱 판단" cols={items.length + 1} />
            <Row label="판단" items={items} render={(it) => <VerdictTag v={it.review_analysis?.sourcing_decision?.verdict} />} />
            <Row label="신뢰도" items={items} render={(it) => {
              const v = it.review_analysis?.sourcing_decision?.confidence;
              return v ? <Badge color={v === 'high' ? 'green' : v === 'medium' ? 'yellow' : 'gray'}>{v}</Badge> : <Missing />;
            }} />
            <Row label="핵심 근거" items={items} render={(it) => (
              <div className="text-xs">{it.review_analysis?.sourcing_decision?.primary_reasoning || <Missing />}</div>
            )} />
            <Row label="차별화 전략" items={items} render={(it) => (
              <div className="text-xs">{it.review_analysis?.sourcing_decision?.differentiation_strategy || <Missing />}</div>
            )} />

            <SectionHead label="시장 신호" cols={items.length + 1} />
            {(['demand_strength', 'saturation_risk', 'price_position', 'trend_durability'] as const).map((key) => {
              const labels: Record<string, string> = {
                demand_strength: '수요 강도',
                saturation_risk: '시장 포화',
                price_position: '가격 포지션',
                trend_durability: '트렌드 지속',
              };
              return (
                <Row key={key} label={labels[key]} items={items} render={(it) => {
                  const v = it.review_analysis?.market_signals?.[key];
                  return v ? <Badge color="purple">{v}</Badge> : <Missing />;
                }} />
              );
            })}

            {c.canonicalDims.length > 0 && (
              <>
                <SectionHead label={`차원별 평가 (${c.primaryCategory || '카테고리'} 표준)`} cols={items.length + 1} />
                {c.canonicalDims.map((dim: string) => (
                  <Row key={dim} label={dim} items={items} render={(_it, i) => {
                    const d = c.itemDimMap[i][dim];
                    if (!d) return <Missing />;
                    const renamedFromOriginal = d.originals.find((o) => o && o !== dim);
                    return <DimensionCell d={d} isWinner={i === c.dimensionWinners[dim]} renamedFromOriginal={!!renamedFromOriginal} originals={d.originals} />;
                  }} />
                ))}
              </>
            )}

            {c.extraDims.length > 0 && (
              <>
                <SectionHead label="기타 차원 (표준 리스트 외)" cols={items.length + 1} />
                {c.extraDims.map((dim: string) => (
                  <Row key={dim} label={dim} items={items} render={(_it, i) => {
                    const d = c.itemDimMap[i][dim];
                    if (!d) return <Missing />;
                    return <DimensionCell d={d} isWinner={i === c.dimensionWinners[dim]} />;
                  }} />
                ))}
              </>
            )}

            <SectionHead label="장단점 (Top 3)" cols={items.length + 1} />
            <Row label="장점" items={items} render={(it) => {
              const p = it.review_analysis?.pros_ranked || [];
              if (p.length === 0) return <Missing />;
              return (
                <ul className="text-xs space-y-1 list-disc pl-4">
                  {p.slice(0, 3).map((x: any, i: number) => <li key={i}>{x.point}</li>)}
                </ul>
              );
            }} />
            <Row label="단점" items={items} render={(it) => {
              const p = it.review_analysis?.cons_ranked || [];
              if (p.length === 0) return <Missing />;
              return (
                <ul className="text-xs space-y-1 list-disc pl-4">
                  {p.slice(0, 3).map((x: any, i: number) => (
                    <li key={i}>
                      {x.point}
                      {x.severity && <span className="ml-1 text-gray-400">[{x.severity}]</span>}
                    </li>
                  ))}
                </ul>
              );
            }} />
            <Row label="해결 가능 포인트" items={items} render={(it) => {
              const p = it.review_analysis?.solvable_pain_points || [];
              if (p.length === 0) return <Missing />;
              return (
                <ul className="text-xs space-y-1 list-disc pl-4">
                  {p.slice(0, 3).map((x: any, i: number) => <li key={i}>{x.issue}</li>)}
                </ul>
              );
            }} />

            <SectionHead label="물리 스펙 (정규화 비교)" cols={items.length + 1} />
            <Row label="무게" items={items} render={(it, i) => {
              const w = c.weights[i];
              const raw = findSpec(it.detail_analysis?.specs, SPEC_ALIASES['무게']);
              if (!w) return <Missing />;
              return (
                <WinnerCell isWinner={i === c.weightWinner}>
                  {raw}
                  {w.value !== parseFloat(String(raw).replace(/[^\d.]/g, '')) && <span className="ml-1 text-xs text-gray-400">({w.value}g)</span>}
                </WinnerCell>
              );
            }} />
            <Row label="용량" items={items} render={(it, i) => {
              const cap = c.capacities[i];
              const raw = findSpec(it.detail_analysis?.specs, SPEC_ALIASES['용량']);
              if (!cap) return <Missing />;
              return (
                <WinnerCell isWinner={i === c.capacityWinner}>
                  {raw}
                  {cap.value >= 1000 && <span className="ml-1 text-xs text-gray-400">({cap.value/1000}L)</span>}
                </WinnerCell>
              );
            }} />
            <Row label="크기" items={items} render={(it) => {
              const raw = findSpec(it.detail_analysis?.specs, SPEC_ALIASES['크기']);
              const parsed = parseSize(raw);
              if (!raw) return <Missing />;
              return (
                <div>
                  {raw}
                  {parsed && <div className="text-xs text-gray-400 mt-0.5">부피: {(parsed.w * parsed.h * parsed.d / 1000).toFixed(1)}L</div>}
                </div>
              );
            }} />
            <Row label="재질" items={items} render={(it) => {
              const v = findSpec(it.detail_analysis?.specs, SPEC_ALIASES['재질']);
              return v || <Missing />;
            }} />
            <Row label="색상" items={items} render={(it) => {
              const v = findSpec(it.detail_analysis?.specs, SPEC_ALIASES['색상']);
              if (!v) return <Missing />;
              return Array.isArray(v) ? (
                <div className="flex flex-wrap gap-1">{v.map((c: string, i: number) => <Badge key={i}>{c}</Badge>)}</div>
              ) : v;
            }} />
            <Row label="원산지" items={items} render={(it) => {
              const v = findSpec(it.detail_analysis?.specs, SPEC_ALIASES['원산지']);
              return v || <Missing />;
            }} />
            <Row label="방수" items={items} render={(it) => {
              const v = findSpec(it.detail_analysis?.specs, SPEC_ALIASES['방수']);
              return v || <Missing />;
            }} />

            {/* 카테고리별 핵심 스펙 (모든 키 동등 + 정규화로 묶임) */}
            {(() => {
              // 물리 스펙 섹션에서 이미 표시한 표준 키 제외
              const shownInPhysical = new Set(['무게', '용량', '크기', '재질', '색상', '원산지', '방수']);
              const remainingKeys = c.allSpecKeys.filter((k: string) => !shownInPhysical.has(k));
              if (remainingKeys.length === 0) return null;
              return (
                <>
                  <SectionHead label="카테고리별 핵심 스펙 (셀러별 우열 비교)" cols={items.length + 1} />
                  {remainingKeys.map((key: string) => {
                    const originals = c.keyOriginalsMap.get(key);
                    const showAlt = originals && originals.size > 1;
                    return (
                      <Row key={key} label={key} items={items} render={(it) => {
                        const v = getSpecValue(it, key);
                        if (v == null || v === '') return <Missing />;
                        return Array.isArray(v) ? v.join(', ') : String(v);
                      }} />
                    );
                  })}
                </>
              );
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ label, items, render }: { label: string; items: Item[]; render: (it: Item, i: number) => React.ReactNode }) {
  return (
    <tr className="hover:bg-gray-50">
      <th className="text-left px-3 py-2 font-medium text-gray-600 bg-gray-50/50 sticky left-0 align-top whitespace-nowrap">{label}</th>
      {items.map((it, i) => <td key={it.id} className="px-3 py-2 align-top">{render(it, i)}</td>)}
    </tr>
  );
}

function SectionHead({ label, cols }: { label: string; cols: number }) {
  return (
    <tr>
      <th colSpan={cols} className="text-left px-3 py-2 bg-gray-200 text-gray-700 font-bold text-xs uppercase tracking-wider sticky left-0">{label}</th>
    </tr>
  );
}

function Missing() {
  return <span className="inline-flex items-center gap-1 text-xs text-gray-400 italic"><Minus className="w-3 h-3" /> 미표기</span>;
}

function ScoreCell({ score }: { score?: number | null }) {
  if (score == null) return <Missing />;
  const color = score >= 8 ? 'text-green-600' : score >= 6 ? 'text-blue-600' : score >= 4 ? 'text-yellow-600' : 'text-red-600';
  return <span className={`font-bold ${color}`}>{score}/10</span>;
}

function DimensionCell({ d, isWinner, renamedFromOriginal, originals }: {
  d: { score: number | null; verdict?: string; spec_evidence?: string; originals: string[] };
  isWinner?: boolean;
  renamedFromOriginal?: boolean;
  originals?: string[];
}) {
  const spec = (d.spec_evidence || '').trim();
  const hasSpec = spec && spec !== '없음' && spec !== 'null' && spec !== 'N/A';
  const verdictColor = d.verdict?.includes('약점') || d.verdict?.includes('치명')
    ? 'bg-red-50 text-red-700'
    : d.verdict?.includes('강점')
      ? 'bg-green-50 text-green-700'
      : 'bg-gray-100 text-gray-600';
  return (
    <div>
      {/* 1순위: 스펙 (있으면 크게) */}
      {hasSpec ? (
        <div className={`text-sm leading-snug ${isWinner ? 'font-bold text-green-700' : 'text-gray-800'}`}>
          {isWinner && <Trophy className="inline w-3.5 h-3.5 text-yellow-500 mr-1" />}
          📐 {spec}
        </div>
      ) : (
        <div className="text-xs text-gray-400 italic">스펙 미표기</div>
      )}
      {/* 2순위: 점수 + 판정 */}
      <div className="flex items-center gap-2 mt-1">
        <ScoreCell score={d.score} />
        {d.verdict && <span className={`text-[10px] px-1.5 py-0.5 rounded ${verdictColor}`}>{d.verdict}</span>}
      </div>
      {renamedFromOriginal && originals && (
        <div className="text-[9px] text-gray-400 mt-0.5 italic">원본: {originals.join(' / ')}</div>
      )}
    </div>
  );
}

function VerdictTag({ v }: { v?: string }) {
  if (!v) return <Missing />;
  const map: Record<string, { label: string; color: string }> = {
    good_to_source: { label: '✅ 추천', color: 'bg-green-100 text-green-800' },
    risky: { label: '⚠️ 주의', color: 'bg-yellow-100 text-yellow-800' },
    avoid: { label: '❌ 비추천', color: 'bg-red-100 text-red-800' },
  };
  const m = map[v] || { label: v, color: 'bg-gray-100 text-gray-700' };
  return <span className={`px-2 py-1 rounded font-bold text-xs ${m.color}`}>{m.label}</span>;
}

function SummaryCard({ label, winner, value }: { label: string; winner: any; value: React.ReactNode }) {
  return (
    <div className="bg-gradient-to-br from-yellow-50 to-orange-50 border border-yellow-200 rounded-lg p-3">
      <div className="flex items-center gap-1 text-xs text-yellow-700 font-semibold mb-1">
        <Trophy className="w-3 h-3" /> {label}
      </div>
      <div className="text-base font-bold text-gray-900 mb-1">{value}</div>
      <Link href={`/sourcing/${winner.id}`} className="text-xs text-blue-600 hover:underline truncate block">
        {winner.product_info?.title || '(제목 없음)'}
      </Link>
    </div>
  );
}
