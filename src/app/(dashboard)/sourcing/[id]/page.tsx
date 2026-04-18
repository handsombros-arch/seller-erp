'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';

type Detail = {
  id: string;
  url: string;
  platform: string;
  status: string;
  error: string | null;
  product_info: { title?: string; price?: string; originalPrice?: string; salesPrice?: string; finalPrice?: string; thumbnailUrl?: string; detailImages?: string[] } | null;
  review_stats: { total?: number; avgRating?: number; ratingDist?: Record<string, number>; withImages?: number; officialReviewCount?: number; officialAvgRating?: number; crawledCount?: number; officialRatingDist?: Record<string, {count: number; pct: number}> } | null;
  detail_analysis: any;
  review_analysis: any;
  inquiry_analysis: any;
  inquiries_count: number | null;
  created_at: string;
  analyzed_at: string | null;
};

function ScoreBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = (score / max) * 100;
  const color = score >= 8 ? 'bg-green-500' : score >= 6 ? 'bg-blue-500' : score >= 4 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className={`${color} h-full transition-all duration-500`} style={{width: `${pct}%`}} />
      </div>
      <span className="text-xs font-bold w-10 text-right">{score}/{max}</span>
    </div>
  );
}

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

function Section({ id, title, icon, children }: { id: string; title: string; icon: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b-2 border-gray-300">
        <span className="text-xl">{icon}</span>
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

const VERDICT_COLOR: Record<string, string> = {
  '강점': 'green', 'pros': 'green', '보통': 'gray', 'fair': 'gray',
  '약점': 'yellow', '숨겨진단점': 'red', '과대광고': 'red',
};

const FREQ_COLOR: Record<string, string> = {
  '많음': 'red', 'many': 'red', '보통': 'yellow', 'some': 'yellow', '적음': 'gray', 'few': 'gray',
};

const SEVERITY_COLOR: Record<string, string> = { '치명적': 'red', '심각': 'red', '경미': 'yellow' };

export default function SourcingDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const r = await fetch('/api/sourcing/' + id);
      if (r.ok) setData(await r.json());
      setLoading(false);
    };
    load();
    const t = setInterval(() => {
      setData((cur) => {
        if (cur && (cur.status === 'pending' || cur.status === 'crawling' || cur.status === 'analyzing')) {
          load();
        }
        return cur;
      });
    }, 5000);
    return () => clearInterval(t);
  }, [id]);

  async function retry() {
    await fetch('/api/sourcing/' + id, { method: 'PATCH', body: JSON.stringify({ action: 'retry' }), headers: { 'Content-Type': 'application/json' } });
    location.reload();
  }

  if (loading) return <div className="text-gray-500">로딩...</div>;
  if (!data) return <div className="text-red-600">없음</div>;

  const da = data.detail_analysis || {};
  const ra = data.review_analysis || {};
  const ia = data.inquiry_analysis || {};
  const sd = ra.sourcing_decision || {};
  const dims = ra.category_dimensions_scored || [];
  const pct = data.status === 'pending' ? 5 : data.status === 'crawling' ? 35 : data.status === 'analyzing' ? 75 : 100;

  const hasAnalysis = data.status === 'done' && (sd.verdict || dims.length > 0);

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* 상단 액션 바 */}
      <div className="flex items-center justify-between">
        <Link href="/sourcing" className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> 목록
        </Link>
        <div className="flex gap-2">
          <a href={data.url} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm"><ExternalLink className="w-4 h-4 mr-1" />원본 페이지</Button>
          </a>
          {(data.status === 'done' || data.status === 'failed') && (
            <Button onClick={retry} variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-1" />재분석</Button>
          )}
        </div>
      </div>

      {/* ════ 1. 상품 개요 ════ */}
      <Section id="overview" title="상품 개요" icon="🏷️">
        <div className="bg-white border rounded-lg p-5">
          <div className="flex gap-4">
            {data.product_info?.thumbnailUrl && (
              <div className="flex-shrink-0">
                <img src={data.product_info.thumbnailUrl} alt={data.product_info.title || ''} className="w-32 h-32 object-cover rounded-lg border" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                <span className="font-semibold">{data.platform.toUpperCase()}</span>
                {da.category_path && <><span>·</span><span>{da.category_path}</span></>}
              </div>
              <h1 className="text-xl font-bold text-gray-900 mb-1">{data.product_info?.title || '(분석 중...)'}</h1>
              <a href={data.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline break-all" title={data.url}>{data.url}</a>
            </div>
          </div>

          {data.status !== 'done' && data.status !== 'failed' && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-blue-700">
                  {data.status === 'pending' && '⏳ 대기 중'}
                  {data.status === 'crawling' && '🌐 크롤링 중 (상품 + 리뷰 수집)'}
                  {data.status === 'analyzing' && '🤖 AI 분석 중 (Gemini 2.5 Flash, 2-pass)'}
                </span>
                <span className="text-blue-700 font-bold">{pct}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div className="bg-blue-500 h-full transition-all duration-500" style={{width: `${pct}%`}} />
              </div>
            </div>
          )}
          {data.product_info && (
            <div className="flex items-end gap-4 mt-4 flex-wrap">
              {data.product_info.finalPrice && (
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">최종가 (실 결제)</div>
                  <div className="text-3xl font-bold text-blue-600">{data.product_info.finalPrice}</div>
                </div>
              )}
              {data.product_info.salesPrice && data.product_info.salesPrice !== data.product_info.finalPrice && (
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">판매가</div>
                  <div className="text-lg font-semibold text-gray-700">{data.product_info.salesPrice}</div>
                </div>
              )}
              {data.product_info.originalPrice && data.product_info.originalPrice !== data.product_info.finalPrice && (
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">정가</div>
                  <div className="text-base text-gray-400 line-through">{data.product_info.originalPrice}</div>
                </div>
              )}
              {!data.product_info.finalPrice && data.product_info.price && (
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">가격</div>
                  <div className="text-2xl font-bold text-blue-600">{data.product_info.price}</div>
                </div>
              )}
            </div>
          )}
          {data.review_stats && (
            <div className="flex gap-6 text-sm mt-4 pt-4 border-t flex-wrap items-center">
              <div>
                <span className="text-gray-500">리뷰:</span>{' '}
                <strong>{data.review_stats.officialReviewCount ?? data.review_stats.total}</strong>개
                {data.review_stats.officialReviewCount && data.review_stats.crawledCount &&
                  data.review_stats.officialReviewCount !== data.review_stats.crawledCount && (
                  <span className="ml-1 text-xs text-gray-400">(수집 {data.review_stats.crawledCount}개)</span>
                )}
              </div>
              <div>
                <span className="text-gray-500">평균:</span>{' '}
                <strong>{data.review_stats.officialAvgRating ?? data.review_stats.avgRating}★</strong>
              </div>
              <div><span className="text-gray-500">사진리뷰:</span> <strong>{data.review_stats.withImages || 0}</strong>개</div>
              {data.inquiries_count !== null && (
                <div><span className="text-gray-500">상품문의:</span> <strong>{data.inquiries_count}</strong>건</div>
              )}
            </div>
          )}
          {data.status === 'failed' && data.error && (
            <div className="mt-3 px-3 py-2 bg-red-50 text-red-800 rounded text-sm">❌ 실패: {data.error}</div>
          )}
        </div>
      </Section>

      {!hasAnalysis ? (
        <div className="text-center py-12 text-gray-500">분석 결과가 없습니다. 처리 완료 후 다시 확인하세요.</div>
      ) : (
        <>
          {/* ════ 2. 소싱 판단 ════ */}
          <Section id="verdict" title="소싱 판단" icon="🎯">
            {ra.summary_one_line && (
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 border rounded-lg p-4">
                <div className="text-xs uppercase font-semibold text-gray-500 mb-1">한 줄 평</div>
                <p className="text-base font-semibold text-gray-900">{ra.summary_one_line}</p>
              </div>
            )}
            {sd.verdict && (
              <div className={`border-2 rounded-lg p-5 ${
                sd.verdict === 'good_to_source' ? 'bg-green-50 border-green-300' :
                sd.verdict === 'risky' ? 'bg-yellow-50 border-yellow-300' :
                'bg-red-50 border-red-300'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-3xl font-bold">
                    {sd.verdict === 'good_to_source' && '✅ 소싱 추천'}
                    {sd.verdict === 'risky' && '⚠️ 주의 필요'}
                    {sd.verdict === 'avoid' && '❌ 비추천'}
                  </div>
                  {sd.confidence && (
                    <Badge color={sd.confidence === 'high' ? 'green' : sd.confidence === 'medium' ? 'yellow' : 'gray'}>
                      신뢰도: {sd.confidence}
                    </Badge>
                  )}
                </div>
                <div className="text-sm mb-4">{sd.primary_reasoning}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {sd.differentiation_strategy && (
                    <div className="bg-white/70 rounded p-3">
                      <div className="text-xs uppercase font-semibold text-gray-500 mb-1">차별화 전략</div>
                      <div className="text-sm">{sd.differentiation_strategy}</div>
                    </div>
                  )}
                  {sd.key_risks?.length > 0 && (
                    <div className="bg-white/70 rounded p-3">
                      <div className="text-xs uppercase font-semibold text-gray-500 mb-1">핵심 리스크</div>
                      <ul className="text-sm space-y-0.5">{sd.key_risks.map((r: string, i: number) => <li key={i}>• {r}</li>)}</ul>
                    </div>
                  )}
                  {sd.recommended_actions?.length > 0 && (
                    <div className="bg-white/70 rounded p-3 md:col-span-2">
                      <div className="text-xs uppercase font-semibold text-gray-500 mb-1">권장 조치</div>
                      <ul className="text-sm space-y-0.5">{sd.recommended_actions.map((a: string, i: number) => <li key={i}>→ {a}</li>)}</ul>
                    </div>
                  )}
                </div>
              </div>
            )}
            {ra.summary_paragraph && (
              <div className="bg-white border rounded-lg p-4">
                <div className="text-xs uppercase font-semibold text-gray-500 mb-2">종합 평가</div>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{ra.summary_paragraph}</p>
              </div>
            )}
            {ra._sampling_info && (
              <details className="bg-gray-50 border rounded-lg p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-gray-600">📐 분석 객관성 정보 (샘플링 방식)</summary>
                <div className="mt-2 space-y-1 text-gray-600">
                  <div>전체 리뷰: <strong>{ra._sampling_info.total_reviews}</strong>개 → 분석 대상: <strong>{ra._sampling_info.selected_count}</strong>개</div>
                  <div>짧은 리뷰 제외 (30자 미만): {ra._sampling_info.filtered_short_below_30chars}개</div>
                  <div>샘플링 전략: {ra._sampling_info.selection_strategy}</div>
                  <div>가중치: {ra._sampling_info.negative_weight}</div>
                  <div className="flex gap-2 mt-1">
                    {[5,4,3,2,1].map((s) => (
                      <Badge key={s} color={s >= 4 ? 'green' : s >= 3 ? 'yellow' : 'red'}>
                        {s}★ {ra._sampling_info.rating_distribution_in_sample?.[s] || 0}개
                      </Badge>
                    ))}
                  </div>
                </div>
              </details>
            )}
          </Section>

          {/* ════ 3. 카테고리 차원 평가 ════ */}
          {dims.length > 0 && (
            <Section id="dimensions" title={`${da.category} 차원 평가`} icon="📊">
              <div className="bg-white border rounded-lg p-4 space-y-4">
                {dims.map((d: any, i: number) => (
                  <div key={i} className="pb-3 border-b last:border-0 last:pb-0">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <strong className="text-sm">{d.dimension}</strong>
                        {d.verdict && <Badge color={VERDICT_COLOR[d.verdict] || 'gray'}>{d.verdict}</Badge>}
                      </div>
                    </div>
                    <ScoreBar score={Number(d.score) || 0} />
                    {d.spec_evidence && (
                      <div className="text-xs mt-2 bg-blue-50 rounded px-2 py-1 inline-block">
                        <strong className="text-blue-700">📐 스펙:</strong> <span className="text-blue-900">{d.spec_evidence}</span>
                      </div>
                    )}
                    <div className="text-xs text-gray-600 mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                      {d.page_claim && <div><strong className="text-gray-500">페이지 주장:</strong> {d.page_claim}</div>}
                      {d.review_consensus && <div><strong className="text-gray-500">리뷰 합의:</strong> {d.review_consensus}</div>}
                    </div>
                    {d.evidence && <div className="text-xs text-gray-700 mt-1 italic">{d.evidence}</div>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ════ 4. 장단점 분석 ════ */}
          <Section id="pros-cons" title="장단점 분석" icon="⚖️">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ra.pros_ranked?.length > 0 && (
                <div className="bg-white border rounded-lg p-4">
                  <h3 className="font-semibold mb-3 text-green-700">👍 장점</h3>
                  <ul className="space-y-3 text-sm">
                    {ra.pros_ranked.map((p: any, i: number) => (
                      <li key={i} className="border-l-2 border-green-200 pl-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Badge color={FREQ_COLOR[p.frequency] || 'gray'}>
                            {p.frequency}
                            {p.frequency_pct && <span className="ml-1 opacity-75">({p.frequency_pct})</span>}
                          </Badge>
                        </div>
                        <div className="font-medium">{p.point}</div>
                        {p.category_significance && <div className="text-xs text-gray-500 mt-1 italic">{p.category_significance}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {ra.cons_ranked?.length > 0 && (
                <div className="bg-white border rounded-lg p-4">
                  <h3 className="font-semibold mb-3 text-red-700">👎 단점</h3>
                  <ul className="space-y-3 text-sm">
                    {ra.cons_ranked.map((p: any, i: number) => (
                      <li key={i} className="border-l-2 border-red-200 pl-2">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <Badge color={FREQ_COLOR[p.frequency] || 'gray'}>
                            {p.frequency}
                            {p.frequency_pct && <span className="ml-1 opacity-75">({p.frequency_pct})</span>}
                          </Badge>
                          {p.severity && <Badge color={SEVERITY_COLOR[p.severity] || 'gray'}>{p.severity}</Badge>}
                          {p.fixable !== undefined && <Badge color={p.fixable ? 'green' : 'gray'}>{p.fixable ? '개선 가능' : '본질 문제'}</Badge>}
                        </div>
                        <div className="font-medium">{p.point}</div>
                        {p.severity_reason && <div className="text-xs text-gray-500 mt-1 italic">왜 {p.severity}: {p.severity_reason}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ra.hidden_weaknesses?.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <h3 className="font-semibold mb-2 text-orange-700">🔍 숨겨진 단점</h3>
                  <p className="text-xs text-orange-600 mb-2">페이지엔 안 나오지만 리뷰에서 자주 언급</p>
                  <ul className="space-y-2 text-sm">
                    {ra.hidden_weaknesses.map((h: any, i: number) => (
                      <li key={i}>
                        <strong>• {h.issue}</strong>
                        {h.review_count_estimate && <div className="text-xs text-gray-600 ml-3">{h.review_count_estimate}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {ra.overpromised_claims?.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h3 className="font-semibold mb-2 text-red-700">⚠️ 과대광고</h3>
                  <p className="text-xs text-red-600 mb-2">페이지가 강조하지만 리뷰에서 부정/실망</p>
                  <ul className="space-y-2 text-sm">
                    {ra.overpromised_claims.map((o: any, i: number) => (
                      <li key={i}>
                        <strong>• {o.claim}</strong>
                        {o.review_evidence && <div className="text-xs text-gray-600 ml-3">{o.review_evidence}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {ra.neutral_observations?.length > 0 && (
              <div className="bg-gray-50 border rounded-lg p-4">
                <h3 className="font-semibold mb-2">⚪ 중립적 관찰</h3>
                <p className="text-xs text-gray-500 mb-2">긍정/부정으로 단정 어려운 호불호 포인트</p>
                <ul className="space-y-1 text-sm">
                  {ra.neutral_observations.map((n: string, i: number) => <li key={i}>• {n}</li>)}
                </ul>
              </div>
            )}
            {ra.improvements_needed?.length > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h3 className="font-semibold mb-3 text-purple-800">🔧 보완해야 할 점</h3>
                <div className="space-y-3">
                  {ra.improvements_needed.map((imp: any, i: number) => (
                    <div key={i} className="bg-white rounded p-3 border-l-4 border-purple-400">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge color={imp.priority === 'high' ? 'red' : imp.priority === 'medium' ? 'yellow' : 'gray'}>
                          {imp.priority}
                        </Badge>
                        <strong className="text-sm">{imp.area}</strong>
                      </div>
                      {imp.current_state && <div className="text-xs text-gray-600 mt-1"><strong>현재:</strong> {imp.current_state}</div>}
                      {imp.suggested_change && <div className="text-sm text-purple-700 mt-1"><strong>🔧 개선:</strong> {imp.suggested_change}</div>}
                      {imp.impact_estimate && <div className="text-xs text-gray-500 mt-1"><strong>예상 효과:</strong> {imp.impact_estimate}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* ════ 5. 차별화 인사이트 ════ */}
          {(ra.solvable_pain_points?.length > 0 || ra.differentiation_points?.length > 0 || ra.market_signals) && (
            <Section id="insights" title="차별화 인사이트" icon="💡">
              {ra.solvable_pain_points?.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-semibold mb-3 text-blue-800">해결 가능 포인트 (소싱 시 차별화 기회)</h3>
                  <div className="space-y-3">
                    {ra.solvable_pain_points.map((p: any, i: number) => (
                      <div key={i} className="bg-white rounded p-3 border-l-4 border-blue-400">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge color={FREQ_COLOR[p.frequency] || 'gray'}>{p.frequency}</Badge>
                          {p.differentiation_score !== undefined && <Badge color="purple">차별화 {p.differentiation_score}/10</Badge>}
                          <strong className="text-sm">{p.issue}</strong>
                        </div>
                        {p.root_cause && <div className="text-xs text-gray-600 mt-1"><strong>원인:</strong> {p.root_cause}</div>}
                        {p.improvement_idea && <div className="text-sm text-blue-700 mt-1"><strong>💡 개선:</strong> {p.improvement_idea}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {ra.differentiation_points?.length > 0 && (
                <div className="bg-white border rounded-lg p-4">
                  <h3 className="font-semibold mb-2">⭐ 차별화 포인트</h3>
                  <ul className="space-y-1 text-sm">
                    {ra.differentiation_points.map((d: any, i: number) => (
                      <li key={i} className="flex items-center gap-2 flex-wrap">
                        <span>•</span>
                        <span className="flex-1 min-w-[200px]">{d.point}</span>
                        {d.from_page && <Badge color="blue">페이지</Badge>}
                        {d.from_reviews && <Badge color="green">리뷰</Badge>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {ra.market_signals && (
                <div className="bg-white border rounded-lg p-4">
                  <h3 className="font-semibold mb-3">📈 시장 신호</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="border rounded p-2">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-xs text-gray-500">수요 강도</div>
                        <Badge color={ra.market_signals.demand_strength === 'high' ? 'green' : ra.market_signals.demand_strength === 'medium' ? 'yellow' : 'gray'}>
                          {ra.market_signals.demand_strength}
                        </Badge>
                      </div>
                      {ra.market_signals.demand_strength_reason && (
                        <div className="text-xs text-gray-600 italic">{ra.market_signals.demand_strength_reason}</div>
                      )}
                    </div>
                    <div className="border rounded p-2">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-xs text-gray-500">시장 포화</div>
                        <Badge color={ra.market_signals.saturation_risk === 'high' ? 'red' : ra.market_signals.saturation_risk === 'medium' ? 'yellow' : 'green'}>
                          {ra.market_signals.saturation_risk}
                        </Badge>
                      </div>
                      {ra.market_signals.saturation_risk_reason && (
                        <div className="text-xs text-gray-600 italic">{ra.market_signals.saturation_risk_reason}</div>
                      )}
                    </div>
                    <div className="border rounded p-2">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-xs text-gray-500">가격 포지션</div>
                        <Badge color="purple">{ra.market_signals.price_position}</Badge>
                      </div>
                      {ra.market_signals.price_position_reason && (
                        <div className="text-xs text-gray-600 italic">{ra.market_signals.price_position_reason}</div>
                      )}
                    </div>
                    <div className="border rounded p-2">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-xs text-gray-500">트렌드 지속</div>
                        <Badge color={ra.market_signals.trend_durability === 'trending' ? 'green' : ra.market_signals.trend_durability === 'stable' ? 'blue' : 'red'}>
                          {ra.market_signals.trend_durability}
                        </Badge>
                      </div>
                      {ra.market_signals.trend_durability_reason && (
                        <div className="text-xs text-gray-600 italic">{ra.market_signals.trend_durability_reason}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* ════ 6. 고객 분석 + 통계 ════ */}
          {(ra.buyer_personas?.length > 0 || ra.use_case_distribution?.length > 0 || ra.options_feedback?.length > 0 || data.review_stats?.ratingDist || ra.sentiment_breakdown || ra.review_topic_frequency?.length > 0) && (
            <Section id="customers" title="고객 분석 · 통계" icon="👥">
              {/* 중립 점수 + 감성 분포 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {ra.neutral_score !== undefined && (
                  <div className="bg-white border rounded-lg p-4 text-center">
                    <div className="text-xs text-gray-500 mb-1">중립 종합 점수</div>
                    <div className={`text-4xl font-bold ${
                      ra.neutral_score >= 8 ? 'text-green-600' : ra.neutral_score >= 6 ? 'text-blue-600' : ra.neutral_score >= 4 ? 'text-yellow-600' : 'text-red-600'
                    }`}>{ra.neutral_score}</div>
                    <div className="text-xs text-gray-400">/ 10</div>
                    {ra.neutral_score_reasoning && <div className="text-xs text-gray-600 mt-2">{ra.neutral_score_reasoning}</div>}
                  </div>
                )}
                {ra.sentiment_breakdown && (
                  <div className="bg-white border rounded-lg p-4 md:col-span-2">
                    <h3 className="font-semibold mb-2">감성 분포</h3>
                    <div className="flex h-8 rounded-lg overflow-hidden">
                      {ra.sentiment_breakdown.positive_pct > 0 && (
                        <div className="bg-green-500 flex items-center justify-center text-white text-xs font-bold" style={{width: `${ra.sentiment_breakdown.positive_pct}%`}}>
                          긍정 {ra.sentiment_breakdown.positive_pct}%
                        </div>
                      )}
                      {ra.sentiment_breakdown.neutral_pct > 0 && (
                        <div className="bg-gray-400 flex items-center justify-center text-white text-xs font-bold" style={{width: `${ra.sentiment_breakdown.neutral_pct}%`}}>
                          중립 {ra.sentiment_breakdown.neutral_pct}%
                        </div>
                      )}
                      {ra.sentiment_breakdown.negative_pct > 0 && (
                        <div className="bg-red-500 flex items-center justify-center text-white text-xs font-bold" style={{width: `${ra.sentiment_breakdown.negative_pct}%`}}>
                          부정 {ra.sentiment_breakdown.negative_pct}%
                        </div>
                      )}
                    </div>
                    {ra.sentiment_breakdown.notes && <div className="text-xs text-gray-600 mt-2">{ra.sentiment_breakdown.notes}</div>}
                  </div>
                )}
              </div>

              {/* 토픽 빈도 */}
              {ra.review_topic_frequency?.length > 0 && (
                <div className="bg-white border rounded-lg p-4">
                  <h3 className="font-semibold mb-3">📊 리뷰 토픽 빈도</h3>
                  <div className="space-y-2">
                    {ra.review_topic_frequency.map((t: any, i: number) => {
                      const sentColor = t.sentiment === 'positive' ? 'bg-green-500' : t.sentiment === 'negative' ? 'bg-red-500' : 'bg-yellow-500';
                      const sentBadge = t.sentiment === 'positive' ? 'green' : t.sentiment === 'negative' ? 'red' : 'yellow';
                      const pct2 = t.mention_pct || 0;
                      return (
                        <div key={i}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <strong className="text-sm">{t.topic}</strong>
                              <Badge color={sentBadge}>{t.sentiment}</Badge>
                              <span className="text-xs text-gray-500">{t.mention_count}건</span>
                            </div>
                            <span className="text-xs text-gray-500">{pct2}%</span>
                          </div>
                          <div className="bg-gray-100 rounded h-2 overflow-hidden">
                            <div className={`${sentColor} h-full`} style={{width: `${pct2}%`}} />
                          </div>
                          {t.key_quotes?.length > 0 && (
                            <div className="text-xs text-gray-500 mt-1 italic ml-1">
                              {t.key_quotes.slice(0, 2).map((q: string, j: number) => <div key={j}>"{q}"</div>)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 타겟 비교 (페이지 의도 vs 실제 구매자) */}
              {(ra.page_intended_targets?.length > 0 || ra.actual_buyer_targets?.length > 0) && (
                <div className="bg-white border rounded-lg p-4">
                  <h3 className="font-semibold mb-3">🎯 타겟 비교 (페이지 의도 vs 실제 구매자)</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs font-semibold text-blue-700 mb-2">📋 페이지 의도 타겟</div>
                      <ul className="space-y-2 text-sm">
                        {(ra.page_intended_targets || []).map((t: any, i: number) => (
                          <li key={i} className="bg-blue-50 rounded p-2">
                            <div><strong>{t.who}</strong></div>
                            {t.evidence && <div className="text-xs text-gray-600 mt-1 italic">근거: {t.evidence}</div>}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-green-700 mb-2">⭐ 실제 구매자 (리뷰 기반)</div>
                      <ul className="space-y-2 text-sm">
                        {(ra.actual_buyer_targets || []).map((t: any, i: number) => (
                          <li key={i} className="bg-green-50 rounded p-2">
                            <div className="flex items-center gap-2">
                              <strong>{t.who}</strong>
                              {t.review_count_estimate && <Badge color="green">{t.review_count_estimate}</Badge>}
                            </div>
                            {t.evidence && <div className="text-xs text-gray-600 mt-1 italic">근거: {t.evidence}</div>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {ra.target_match_analysis && (
                    <div className="mt-3 bg-gray-50 rounded p-3 text-sm">
                      <strong className="text-xs text-gray-500">매칭 분석:</strong> {ra.target_match_analysis}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ra.buyer_personas?.length > 0 && (
                  <div className="bg-white border rounded-lg p-4">
                    <h3 className="font-semibold mb-2">구매자 페르소나</h3>
                    <ul className="space-y-2 text-sm">
                      {ra.buyer_personas.map((b: any, i: number) => (
                        <li key={i} className="border-l-2 border-gray-200 pl-2">
                          <div className="flex items-center gap-2">
                            <strong>{b.persona}</strong>
                            {b.source && <Badge color={b.source === '리뷰' ? 'green' : b.source === '페이지' ? 'blue' : 'purple'}>{b.source}</Badge>}
                          </div>
                          {b.buying_motivation && <div className="text-xs text-gray-600">동기: {b.buying_motivation}</div>}
                          {b.satisfaction_expected && <div className="text-xs text-gray-600">만족도: {b.satisfaction_expected}</div>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {ra.use_case_distribution?.length > 0 && (
                  <div className="bg-white border rounded-lg p-4">
                    <h3 className="font-semibold mb-2">주요 용도 분포</h3>
                    <ul className="space-y-2 text-sm">
                      {ra.use_case_distribution.map((u: any, i: number) => (
                        <li key={i} className="flex items-center gap-2">
                          <span className="flex-1">{u.use_case}</span>
                          <Badge color="blue">{u.percentage_estimate}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {ra.options_feedback?.length > 0 && (
                <div className="bg-white border rounded-lg p-4">
                  <h3 className="font-semibold mb-2">옵션별 피드백</h3>
                  <div className="space-y-2 text-sm">
                    {ra.options_feedback.map((o: any, i: number) => (
                      <div key={i} className="border-l-2 border-gray-200 pl-2">
                        <strong>{o.option_type}:</strong> {o.feedback}
                        {o.issues && <div className="text-xs text-red-600 mt-0.5">⚠️ {o.issues}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {data.review_stats?.ratingDist && (
                <div className="bg-white border rounded-lg p-4">
                  <h3 className="font-semibold mb-3">별점 분포</h3>
                  <div className="space-y-1.5">
                    {[5,4,3,2,1].map((s) => {
                      const cnt = (data.review_stats!.ratingDist as any)[s] || 0;
                      const total = data.review_stats!.total || 1;
                      const pct2 = (cnt / total * 100).toFixed(0);
                      return (
                        <div key={s} className="flex items-center gap-2 text-xs">
                          <div className="w-6 font-medium">{s}★</div>
                          <div className="flex-1 bg-gray-100 rounded h-2 overflow-hidden">
                            <div className="bg-yellow-400 h-full" style={{width: `${pct2}%`}} />
                          </div>
                          <div className="w-20 text-right text-gray-600">{cnt}개 ({pct2}%)</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* ════ 7. 상세페이지 분석 ════ */}
          {(da.specs || da.claims?.length > 0 || da.selling_points_ranked?.length > 0) && (
            <Section id="detail-page" title="상세페이지 분석" icon="📋">
              <div className="bg-white border rounded-lg p-4 space-y-4 text-sm">
                {da.specs && Object.keys(da.specs).length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-2">스펙</h3>
                    <div className="overflow-x-auto border rounded-md">
                      <table className="w-full text-sm">
                        <tbody>
                          {Object.entries(da.specs).filter(([k, v]) => v != null && v !== '' && !k.startsWith('_')).map(([k, v], i) => (
                            <tr key={k} className={i % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                              <th className="text-left px-3 py-2 font-medium text-gray-600 w-32 align-top whitespace-nowrap">{k}</th>
                              <td className="px-3 py-2 text-gray-900">
                                {Array.isArray(v) ? v.join(', ') : String(v)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {da.claims?.length > 0 && (
                  <div className="pt-3 border-t">
                    <h3 className="font-semibold mb-2">셀러 주장</h3>
                    <ul className="space-y-1">
                      {da.claims.map((c: any, i: number) => (
                        <li key={i}>
                          • {c.claim}
                          {c.verifiable === false && <span className="ml-1 text-xs text-orange-600">[검증불가]</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {da.selling_points_ranked?.length > 0 && (
                  <div className="pt-3 border-t">
                    <h3 className="font-semibold mb-2">셀링포인트 (강조 순)</h3>
                    <ol className="ml-4 list-decimal space-y-0.5">
                      {da.selling_points_ranked.map((s: string, i: number) => <li key={i}>{s}</li>)}
                    </ol>
                  </div>
                )}
                {da.target_demographics && (
                  <div className="pt-3 border-t">
                    <h3 className="font-semibold mb-2">🎯 타겟 고객</h3>
                    {da.target_demographics.primary && (
                      <div className="bg-blue-50 rounded p-2 mb-2">
                        <div><Badge color="blue">주 타겟</Badge> <strong>{typeof da.target_demographics.primary === 'string' ? da.target_demographics.primary : da.target_demographics.primary.who}</strong></div>
                        {typeof da.target_demographics.primary === 'object' && da.target_demographics.primary.evidence && (
                          <div className="text-xs text-gray-600 mt-1 italic">근거: {da.target_demographics.primary.evidence}</div>
                        )}
                      </div>
                    )}
                    {da.target_demographics.secondary?.length > 0 && (
                      <div className="space-y-1">
                        {da.target_demographics.secondary.map((s: any, i: number) => (
                          <div key={i} className="bg-gray-50 rounded p-2">
                            <div><Badge color="gray">보조</Badge> {typeof s === 'string' ? s : s.who}</div>
                            {typeof s === 'object' && s.evidence && (
                              <div className="text-xs text-gray-500 mt-1 italic">근거: {s.evidence}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {da.target_demographics.use_cases_implied?.length > 0 && (
                      <div className="text-xs text-gray-600 mt-2">
                        <strong>예상 사용 시나리오:</strong> {da.target_demographics.use_cases_implied.join(' / ')}
                      </div>
                    )}
                  </div>
                )}
                {da.page_quality_signals && (
                  <div className="pt-3 border-t">
                    <h3 className="font-semibold mb-2">페이지 품질</h3>
                    <div className="flex flex-wrap gap-1">
                      {da.page_quality_signals.has_real_photos && <Badge color="green">실사진</Badge>}
                      {da.page_quality_signals.has_size_chart && <Badge color="green">사이즈표</Badge>}
                      {da.page_quality_signals.has_material_certificate && <Badge color="green">재질인증</Badge>}
                      {da.page_quality_signals.has_video && <Badge color="green">영상</Badge>}
                      {da.page_quality_signals.professional_design && <Badge color="blue">디자인 {da.page_quality_signals.professional_design}</Badge>}
                    </div>
                  </div>
                )}
                {da.image_summary && (
                  <div className="pt-3 border-t">
                    <h3 className="font-semibold mb-2">전체 메시지</h3>
                    <p className="text-gray-700">{da.image_summary}</p>
                  </div>
                )}
                {ra.competitor_mentions?.length > 0 && (
                  <div className="pt-3 border-t">
                    <h3 className="font-semibold mb-2">⚔️ 경쟁 상품 언급</h3>
                    <ul className="space-y-1">
                      {ra.competitor_mentions.map((c: string, i: number) => <li key={i}>• {c}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* ════ 8. 상품문의 분석 (가구매 영향 X 진짜 인사이트) ════ */}
          {(ia.summary || ia.top_concerns?.length > 0 || ia.page_information_gaps?.length > 0 || ia.sourcing_insights?.length > 0) && (
            <Section id="inquiries" title={`상품문의 분석 (${data.inquiries_count || 0}건 · 가구매 영향 X)`} icon="❓">
              {ia.summary && (
                <div className="bg-white border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold">요약</h3>
                    {ia.answer_rate_pct !== undefined && (
                      <Badge color={ia.answer_rate_pct >= 80 ? 'green' : ia.answer_rate_pct >= 50 ? 'yellow' : 'red'}>
                        답변률 {ia.answer_rate_pct}%
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed">{ia.summary}</p>
                  {ia.answer_quality && <div className="text-xs text-gray-600 mt-2 italic">셀러 답변 품질: {ia.answer_quality}</div>}
                </div>
              )}

              {ia.top_concerns?.length > 0 && (
                <div className="bg-white border rounded-lg p-4">
                  <h3 className="font-semibold mb-3">📌 주요 우려사항</h3>
                  <ul className="space-y-2 text-sm">
                    {ia.top_concerns.map((c: any, i: number) => (
                      <li key={i} className="border-l-2 border-orange-300 pl-2">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge color={FREQ_COLOR[c.frequency] || 'gray'}>{c.frequency}</Badge>
                          {c.category && <Badge color="blue">{c.category}</Badge>}
                          {c.implies_unclear_in_page && <Badge color="red">페이지 불명확</Badge>}
                        </div>
                        <div>{c.concern}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {ia.page_information_gaps?.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h3 className="font-semibold mb-2 text-yellow-800">📝 페이지 정보 부족 (셀러 보강 필요)</h3>
                  <ul className="space-y-1 text-sm">
                    {ia.page_information_gaps.map((g: string, i: number) => <li key={i}>• {g}</li>)}
                  </ul>
                </div>
              )}

              {ia.hidden_issues_revealed?.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <h3 className="font-semibold mb-2 text-orange-800">🔍 문의에서 드러난 잠재 문제</h3>
                  <p className="text-xs text-orange-600 mb-2">리뷰엔 안 나오지만 문의에서 표면화</p>
                  <ul className="space-y-1 text-sm">
                    {ia.hidden_issues_revealed.map((h: string, i: number) => <li key={i}>• {h}</li>)}
                  </ul>
                </div>
              )}

              {ia.sourcing_insights?.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-semibold mb-3 text-blue-800">💡 소싱 인사이트 (문의 기반)</h3>
                  <div className="space-y-2">
                    {ia.sourcing_insights.map((s: any, i: number) => (
                      <div key={i} className="bg-white rounded p-3 border-l-4 border-blue-400">
                        <div className="flex items-center gap-2 mb-1">
                          {s.category && <Badge color="purple">{s.category}</Badge>}
                          <strong className="text-sm">{s.insight}</strong>
                        </div>
                        {s.actionable && <div className="text-sm text-blue-700 mt-1">→ {s.actionable}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {ia.category_distribution?.length > 0 && (
                <div className="bg-white border rounded-lg p-4">
                  <h3 className="font-semibold mb-2">문의 카테고리 분포</h3>
                  <ul className="space-y-2 text-sm">
                    {ia.category_distribution.map((c: any, i: number) => (
                      <li key={i}>
                        <div className="flex items-center justify-between">
                          <strong>{c.category}</strong>
                          <Badge color="gray">{c.count_estimate}</Badge>
                        </div>
                        {c.examples?.length > 0 && (
                          <div className="text-xs text-gray-500 italic ml-2 mt-0.5">{c.examples.join(' / ')}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {ia.unanswered_topics?.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h3 className="font-semibold mb-2 text-red-800">🚨 미답변 문의 주제</h3>
                  <ul className="space-y-1 text-sm">
                    {ia.unanswered_topics.map((u: string, i: number) => <li key={i}>• {u}</li>)}
                  </ul>
                </div>
              )}
            </Section>
          )}
        </>
      )}
    </div>
  );
}
