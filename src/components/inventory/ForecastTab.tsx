'use client';

import { useEffect, useState, useMemo } from 'react';
import { Loader2, TrendingDown, AlertTriangle, CheckCircle2, EyeOff, Eye } from 'lucide-react';
import { formatNumber, formatDate, skuOptionLabel } from '@/lib/utils';
import type { ForecastData } from '@/types';

type ForecastFilter = 'all' | 'reorder' | 'normal';

type ForecastItem = ForecastData & {
  cost_price: number; stock_value: number;
  daily_avg_7d: number | null; daily_avg_30d: number | null;
  sales_7d: number; sales_30d: number;
  sales_source: 'coupang_7d' | 'coupang_30d' | 'outbound' | 'manual' | 'none';
};

const SOURCE_LABEL: Record<string, { text: string; cls: string }> = {
  coupang_7d:  { text: '쿠팡 7일',  cls: 'text-[#3182F6]' },
  coupang_30d: { text: '쿠팡 30일', cls: 'text-[#3182F6]' },
  outbound:    { text: '출고 기록', cls: 'text-[#6B7684]' },
  manual:      { text: '수동 입력', cls: 'text-[#B0B8C1]' },
  none:        { text: '데이터 없음', cls: 'text-[#D0D5DD]' },
};

export default function ForecastTab() {
  const [forecast, setForecast] = useState<ForecastItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ForecastFilter>('all');
  const [stockSort, setStockSort] = useState<'none' | 'asc' | 'desc'>('desc');
  const [showFaded, setShowFaded] = useState(false);
  const [fadedSkus, setFadedSkus] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { const saved = localStorage.getItem('forecast_faded'); return new Set(JSON.parse(saved ?? '[]')); } catch { return new Set(); }
  });

  function toggleFade(skuId: string) {
    setFadedSkus((prev) => {
      const next = new Set(prev);
      next.has(skuId) ? next.delete(skuId) : next.add(skuId);
      try { localStorage.setItem('forecast_faded', JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  useEffect(() => {
    fetch('/api/forecast').then((r) => r.json()).then((d) => { setForecast(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  const reorderCount = useMemo(() => forecast.filter((f) => f.needs_reorder).length, [forecast]);

  const filtered = useMemo(() => {
    let result = forecast;
    if (filter === 'reorder') result = result.filter((f) => f.needs_reorder);
    else if (filter === 'normal') result = result.filter((f) => !f.needs_reorder);
    if (!showFaded) result = result.filter((f) => !fadedSkus.has(f.sku_id));
    if (stockSort !== 'none') {
      result = [...result].sort((a, b) => stockSort === 'asc' ? a.current_stock - b.current_stock : b.current_stock - a.current_stock);
    }
    return result;
  }, [forecast, filter, fadedSkus, showFaded, stockSort]);

  function stockColor(item: ForecastData) {
    if (item.needs_reorder) return 'text-red-600';
    if (item.days_remaining !== null && item.days_remaining < item.lead_time_days * 2) return 'text-amber-600';
    return 'text-green-600';
  }
  function progressPercent(item: ForecastData) { if (item.reorder_point === 0) return 100; const max = Math.max(item.current_stock, item.reorder_point * 3); return Math.min(100, Math.round((item.current_stock / max) * 100)); }
  function progressColor(item: ForecastData) { if (item.needs_reorder) return 'bg-red-500'; if (item.days_remaining !== null && item.days_remaining < item.lead_time_days * 2) return 'bg-amber-400'; return 'bg-[#3182F6]'; }

  const fadedCount = useMemo(() => forecast.filter((f) => fadedSkus.has(f.sku_id)).length, [forecast, fadedSkus]);

  const filterTabs: Array<{ value: ForecastFilter; label: string; count?: number }> = [
    { value: 'all', label: '전체', count: forecast.length },
    { value: 'reorder', label: '발주 필요', count: reorderCount },
    { value: 'normal', label: '정상', count: forecast.length - reorderCount },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <div className="flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4 text-red-500" /><p className="text-[13.5px] text-[#6B7684]">발주 필요</p></div>
          <p className="text-[26px] font-bold text-red-600">{reorderCount}</p><p className="text-[12px] text-[#B0B8C1] mt-0.5">개 SKU</p>
        </div>
        <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <div className="flex items-center gap-2 mb-1"><CheckCircle2 className="w-4 h-4 text-green-500" /><p className="text-[13.5px] text-[#6B7684]">정상 재고</p></div>
          <p className="text-[26px] font-bold text-green-600">{forecast.length - reorderCount}</p><p className="text-[12px] text-[#B0B8C1] mt-0.5">개 SKU</p>
        </div>
        <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <div className="flex items-center gap-2 mb-1"><TrendingDown className="w-4 h-4 text-[#3182F6]" /><p className="text-[13.5px] text-[#6B7684]">전체 SKU</p></div>
          <p className="text-[26px] font-bold text-[#191F28]">{forecast.length}</p><p className="text-[12px] text-[#B0B8C1] mt-0.5">활성 SKU 수</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {filterTabs.map((tab) => (
          <button key={tab.value} onClick={() => setFilter(tab.value)}
            className={`px-3.5 py-1.5 text-[13.5px] font-medium rounded-xl transition-colors ${filter === tab.value ? 'bg-[#3182F6] text-white' : 'bg-white text-[#6B7684] hover:bg-[#F2F4F6] shadow-[0_1px_4px_rgba(0,0,0,0.06)]'}`}>
            {tab.label}{tab.count !== undefined && <span className={`ml-1.5 text-[12px] ${filter === tab.value ? 'text-blue-200' : 'text-[#B0B8C1]'}`}>{tab.count}</span>}
          </button>
        ))}
        {fadedCount > 0 && (
          <button onClick={() => setShowFaded((v) => !v)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-[13.5px] font-medium rounded-xl transition-colors ${showFaded ? 'bg-[#6B7684] text-white' : 'bg-white text-[#B0B8C1] hover:bg-[#F2F4F6] shadow-[0_1px_4px_rgba(0,0,0,0.06)]'}`}>
            {showFaded ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} 숨김 {fadedCount}개
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#3182F6]" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#B0B8C1]"><TrendingDown className="w-10 h-10 mb-3" /><p className="text-[13.5px]">데이터가 없습니다</p></div>
        ) : (
          <div className="overflow-x-auto">
          <div className="divide-y divide-[#F2F4F6] min-w-[700px]">
            <div className="grid grid-cols-[1fr_100px_180px_140px_100px_100px_36px] gap-4 px-5 py-3 bg-[#F9FAFB]">
              <span className="text-[12px] font-medium text-[#6B7684]">상품 / SKU</span>
              <button onClick={() => setStockSort((s) => s === 'none' ? 'desc' : s === 'desc' ? 'asc' : 'none')} className="text-[12px] font-medium text-[#6B7684] flex items-center gap-1 hover:text-[#3182F6] transition-colors text-left">현재 재고<span className="text-[10px]">{stockSort === 'none' ? '↕' : stockSort === 'desc' ? '↓' : '↑'}</span></button>
              <span className="text-[12px] font-medium text-[#6B7684]">판매 평균</span>
              <span className="text-[12px] font-medium text-[#6B7684]">소진까지</span>
              <span className="text-[12px] font-medium text-[#6B7684]">발주 권장일</span>
              <span className="text-[12px] font-medium text-[#6B7684]">리드타임</span>
              <span />
            </div>
            {filtered.map((item) => {
              const pct = progressPercent(item);
              const reorderPct = Math.min(100, Math.round((item.reorder_point / Math.max(item.current_stock, item.reorder_point * 3)) * 100));
              return (
                <div key={item.sku_id} className={`grid grid-cols-[1fr_100px_180px_140px_100px_100px_36px] gap-4 px-5 py-4 transition-colors items-start ${fadedSkus.has(item.sku_id) ? 'opacity-40' : 'hover:bg-[#F9FAFB]'}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13.5px] font-medium text-[#191F28]">{item.product_name}{Object.keys(item.option_values ?? {}).length > 0 && <span className="ml-1.5 text-[13px] font-normal text-[#6B7684]">· {skuOptionLabel(item.option_values)}</span>}</p>
                      {item.needs_reorder && <span className="shrink-0 inline-block px-1.5 py-0.5 bg-red-100 text-red-700 text-[11px] font-medium rounded-lg">발주 필요</span>}
                    </div>
                    <p className="text-[12px] text-[#B0B8C1] mt-0.5">{item.sku_code}{Object.keys(item.option_values ?? {}).length > 0 && ` · ${skuOptionLabel(item.option_values)}`}</p>
                    <p className="text-[11.5px] text-[#B0B8C1] mt-0.5">{item.days_remaining !== null ? (() => { const d = item.days_remaining - item.lead_time_days; return d <= 0 ? <span className="text-red-500 font-semibold">지금 발주 필요</span> : <span>D-{d}일 후 발주 · 안전재고 {formatNumber(item.safety_stock)}</span>; })() : <span>발주점: {formatNumber(item.reorder_point)} · 안전재고: {formatNumber(item.safety_stock)}</span>}</p>
                  </div>
                  <div>
                    <p className={`text-[14px] font-bold ${stockColor(item)}`}>{formatNumber(item.current_stock)}<span className="text-[12px] font-normal ml-0.5">개</span></p>
                    <div className="relative mt-1.5 h-2 rounded-full bg-[#F2F4F6] overflow-hidden">
                      <div className={`absolute left-0 top-0 h-full rounded-full transition-all ${progressColor(item)}`} style={{ width: `${pct}%` }} />
                      <div className="absolute top-0 h-full w-0.5 bg-[#B0B8C1]" style={{ left: `${reorderPct}%` }} title={`발주점: ${item.reorder_point}`} />
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-baseline gap-1.5"><span className="text-[11px] text-[#B0B8C1] w-[28px]">7일</span><span className="text-[13px] font-medium text-[#191F28] tabular-nums">{(item as ForecastItem).daily_avg_7d != null ? `${(item as ForecastItem).daily_avg_7d}개/일` : <span className="text-[#D0D5DD]">-</span>}</span>{(item as ForecastItem).sales_7d > 0 && <span className="text-[11px] text-[#B0B8C1]">({(item as ForecastItem).sales_7d}개)</span>}</div>
                    <div className="flex items-baseline gap-1.5"><span className="text-[11px] text-[#B0B8C1] w-[28px]">30일</span><span className="text-[13px] text-[#6B7684] tabular-nums">{(item as ForecastItem).daily_avg_30d != null ? `${(item as ForecastItem).daily_avg_30d}개/일` : <span className="text-[#D0D5DD]">-</span>}</span>{(item as ForecastItem).sales_30d > 0 && <span className="text-[11px] text-[#B0B8C1]">({(item as ForecastItem).sales_30d}개)</span>}</div>
                    <p className={`text-[11px] ${SOURCE_LABEL[(item as ForecastItem).sales_source]?.cls}`}>{SOURCE_LABEL[(item as ForecastItem).sales_source]?.text}</p>
                  </div>
                  <div>{item.days_remaining !== null ? (<><p className={`text-[13.5px] font-medium ${item.days_remaining <= item.lead_time_days ? 'text-red-600' : item.days_remaining < item.lead_time_days * 2 ? 'text-amber-600' : 'text-[#191F28]'}`}>소진까지 {formatNumber(item.days_remaining)}일</p>{item.days_remaining <= item.lead_time_days && <p className="text-[11.5px] text-red-500 mt-0.5">리드타임 이내!</p>}</>) : <p className="text-[13.5px] text-[#B0B8C1]">판매 없음</p>}</div>
                  <div>{item.reorder_date ? <p className={`text-[13.5px] ${new Date(item.reorder_date) <= new Date() ? 'text-red-600 font-medium' : 'text-[#191F28]'}`}>{formatDate(item.reorder_date)}</p> : <p className="text-[13.5px] text-[#B0B8C1]">-</p>}</div>
                  <div><p className="text-[13.5px] text-[#6B7684]">{item.lead_time_days}일</p></div>
                  <div className="flex items-start justify-center pt-1"><button onClick={() => toggleFade(item.sku_id)} title={fadedSkus.has(item.sku_id) ? '숨김 해제' : '목록에서 숨기기'} className="w-7 h-7 flex items-center justify-center rounded-lg text-[#D0D5DD] hover:text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">{fadedSkus.has(item.sku_id) ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button></div>
                </div>
              );
            })}
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
