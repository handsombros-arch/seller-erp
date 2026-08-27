'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Loader2, PackageCheck, PackageMinus, Bell, X, ShoppingCart } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import type { CalendarEvent } from '@/app/api/calendar-events/route';

import { Button } from '@/components/ui/button';

// ─── Constants ───────────────────────────────────────────────────────────────

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const INBOUND_SUBTYPES: Record<string, string> = {
  import: '수입입고',
  local:  '국내입고',
  export: '반출',
};

const OUTBOUND_SUBTYPES: Record<string, string> = {
  coupang_growth: '쿠팡그로스',
  other:          '기타출고',
};

type FilterType = 'all' | 'inbound_import' | 'inbound_local' | 'inbound_export' | 'outbound_coupang_growth' | 'outbound_other' | 'reorder_reorder' | 'order_order';

// ─── Event Pill Style ────────────────────────────────────────────────────────

function eventStyle(event: CalendarEvent): { pill: string; dot: string; badge: string } {
  if (event.type === 'order') {
    return {
      pill: 'bg-violet-50 text-violet-700 border border-violet-200',
      dot: 'bg-violet-500',
      badge: 'bg-violet-100 text-violet-700',
    };
  }
  if (event.type === 'reorder') {
    return {
      pill: 'bg-orange-50 text-orange-700 border border-orange-200',
      dot: 'bg-orange-500',
      badge: 'bg-orange-100 text-orange-700',
    };
  }
  if (event.type === 'inbound') {
    if (event.subtype === 'import') {
      return {
        pill: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        dot: 'bg-emerald-500',
        badge: 'bg-emerald-100 text-emerald-700',
      };
    }
    return {
      pill: 'bg-teal-50 text-teal-700 border border-teal-200',
      dot: 'bg-teal-500',
      badge: 'bg-teal-100 text-teal-700',
    };
  }
  if (event.subtype === 'coupang_growth') {
    return {
      pill: 'bg-brand-bg text-brand-hover border border-blue-200',
      dot: 'bg-brand',
      badge: 'bg-brand-bg text-brand-hover',
    };
  }
  return {
    pill: 'bg-card-2 text-fg-3 border border-line',
    dot: 'bg-fg-5',
    badge: 'bg-card-2 text-fg-3',
  };
}

// ─── Detail Popup ─────────────────────────────────────────────────────────────

function EventPopup({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const style = eventStyle(event);
  const subtypeLabel = event.type === 'order'
    ? '발주일'
    : event.type === 'reorder'
    ? '발주 권장'
    : event.type === 'inbound'
    ? INBOUND_SUBTYPES[event.subtype] ?? event.subtype
    : OUTBOUND_SUBTYPES[event.subtype] ?? event.subtype;
  const Icon = event.type === 'order' ? ShoppingCart : event.type === 'reorder' ? Bell : event.type === 'inbound' ? PackageCheck : PackageMinus;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="relative bg-card rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.15)] w-full max-w-sm mx-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${event.type === 'order' ? 'bg-violet-50' : event.type === 'reorder' ? 'bg-orange-50' : event.type === 'inbound' ? 'bg-emerald-50' : 'bg-brand-bg'}`}>
              <Icon className={`h-5 w-5 ${event.type === 'order' ? 'text-violet-600' : event.type === 'reorder' ? 'text-orange-600' : event.type === 'inbound' ? 'text-emerald-600' : 'text-brand'}`} />
            </div>
            <div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${style.badge}`}>{subtypeLabel}</span>
              <p className="text-[13px] font-bold text-fg mt-1">{event.label}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="w-7" onClick={onClose}>
            <X className="h-4 w-4 text-fg-3" />
          </Button>
        </div>

        <div className="space-y-2 text-[13px]">
          <div className="flex items-center justify-between py-2 border-b border-line-2">
            <span className="text-fg-3">{event.type === 'order' ? '발주일' : event.type === 'reorder' ? '발주 권장일' : event.type === 'inbound' ? '입고 예정일' : '쿠팡 도착 예정일'}</span>
            <span className="font-semibold text-fg">{event.date}</span>
          </div>
          {event.type !== 'reorder' && event.type !== 'order' && (
            <div className="flex items-center justify-between py-2 border-b border-line-2">
              <span className="text-fg-3">수량</span>
              <span className="font-semibold text-fg">{formatNumber(event.quantity)}개</span>
            </div>
          )}
          {event.type === 'reorder' && event.days_until_stockout != null && (
            <div className="flex items-center justify-between py-2 border-b border-line-2">
              <span className="text-fg-3">예상 소진일</span>
              <span className="font-semibold text-orange-600">{event.days_until_stockout}일 후</span>
            </div>
          )}
          {event.type === 'reorder' && event.sku_code && (
            <div className="flex items-center justify-between py-2 border-b border-line-2">
              <span className="text-fg-3">SKU 코드</span>
              <span className="font-mono text-[12px] text-fg">{event.sku_code}</span>
            </div>
          )}
          {event.box_count != null && (
            <div className="flex items-center justify-between py-2 border-b border-line-2">
              <span className="text-fg-3">박스 수</span>
              <span className="font-semibold text-fg">{event.box_count}박스</span>
            </div>
          )}
          {event.coupang_center && (
            <div className="flex items-center justify-between py-2 border-b border-line-2">
              <span className="text-fg-3">쿠팡 센터</span>
              <span className="font-semibold text-fg">{event.coupang_center}</span>
            </div>
          )}
          {event.supplier && (
            <div className="flex items-center justify-between py-2 border-b border-line-2">
              <span className="text-fg-3">공급사</span>
              <span className="font-semibold text-fg">{event.supplier}</span>
            </div>
          )}
          {event.po_number && (
            <div className="flex items-center justify-between py-2">
              <span className="text-fg-3">발주번호</span>
              <span className="font-mono text-[12px] text-fg">{event.po_number}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Calendar Page ──────────────────────────────────────────────────────

export default function CalendarTab() {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12
  const [events, setEvents]     = useState<CalendarEvent[]>([]);
  const [loading, setLoading]   = useState(false);
  const [filter, setFilter]     = useState<FilterType>('all');
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [dayPopup, setDayPopup] = useState<{ date: string; events: CalendarEvent[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/calendar-events?year=${year}&month=${month}`);
      const data = await res.json();
      setEvents(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  }
  function goToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1);
  }

  // Filter events
  const filteredEvents = events.filter((e) => {
    if (filter === 'all') return true;
    return filter === `${e.type}_${e.subtype}`;
  });

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = today.toISOString().slice(0, 10);

  // Group events by date
  const eventsByDate: Record<string, CalendarEvent[]> = {};
  for (const e of filteredEvents) {
    if (!eventsByDate[e.date]) eventsByDate[e.date] = [];
    eventsByDate[e.date].push(e);
  }

  // Summary counts
  const inboundCount   = events.filter((e) => e.type === 'inbound').length;
  const outboundCount  = events.filter((e) => e.type === 'outbound').length;
  const reorderCount   = events.filter((e) => e.type === 'reorder').length;
  const orderCount     = events.filter((e) => e.type === 'order').length;

  const FILTERS: Array<{ value: FilterType; label: string; color: string }> = [
    { value: 'all',                     label: '전체',      color: 'bg-brand text-white' },
    { value: 'order_order',             label: '발주일',    color: 'bg-violet-600 text-white' },
    { value: 'inbound_import',          label: '수입입고',  color: 'bg-emerald-600 text-white' },
    { value: 'inbound_local',           label: '국내입고',  color: 'bg-teal-600 text-white' },
    { value: 'inbound_export',          label: '반출',      color: 'bg-purple-600 text-white' },
    { value: 'outbound_coupang_growth', label: '쿠팡그로스', color: 'bg-brand text-white' },
    { value: 'outbound_other',          label: '기타출고',  color: 'bg-fg-3 text-white' },
    { value: 'reorder_reorder',         label: '발주권장',  color: 'bg-orange-500 text-white' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold tracking-[-0.03em] text-fg">입출고 캘린더</h2>
          <p className="mt-1 text-[13px] text-fg-3">입고 예정과 쿠팡 출고 일정을 한눈에 확인하세요</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Summary badges */}
          <div className="flex items-center gap-2 text-[12px] flex-wrap">
            {orderCount > 0 && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-50 text-violet-700 rounded-xl font-medium">
                <div className="w-2 h-2 rounded-full bg-violet-500" />
                발주 {orderCount}건
              </span>
            )}
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl font-medium">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              입고 {inboundCount}건
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-bg text-brand-hover rounded-xl font-medium">
              <div className="w-2 h-2 rounded-full bg-brand" />
              출고 {outboundCount}건
            </span>
            {reorderCount > 0 && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 text-orange-700 rounded-xl font-medium">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
                발주권장 {reorderCount}건
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Month nav + filter */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Month navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="w-9 h-10 flex items-center justify-center rounded-xl border border-line hover:bg-app transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-fg-3" />
          </button>
          <button
            onClick={goToday}
            className="h-10 px-4 rounded-xl border border-line text-[13px] font-bold text-fg hover:bg-app transition-colors min-w-[120px] text-center"
          >
            {year}년 {month}월
          </button>
          <button
            onClick={nextMonth}
            className="w-9 h-10 flex items-center justify-center rounded-xl border border-line hover:bg-app transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-fg-3" />
          </button>
          <button
            onClick={goToday}
            className="h-10 px-3 rounded-xl border border-line text-[12px] text-fg-3 hover:bg-app transition-colors"
          >
            오늘
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`h-8 px-3 rounded-xl text-[12px] font-medium transition-colors ${
                filter === f.value ? f.color : 'bg-card text-fg-3 border border-line hover:bg-app'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Calendar grid */}
      <div className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-line-2">
          {WEEKDAYS.map((day, i) => (
            <div
              key={day}
              className={`py-3 text-center text-[12px] font-semibold ${
                i === 0 ? 'text-red-500' : i === 6 ? 'text-brand' : 'text-fg-3'
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Loading overlay */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
          </div>
        )}

        {/* Day cells */}
        {!loading && (
          <div className="grid grid-cols-7">
            {/* Empty cells before month start */}
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[110px] p-2 border-b border-r border-line-2 bg-card-2" />
            ))}

            {/* Day cells */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayEvents = eventsByDate[dateStr] ?? [];
              const isToday = dateStr === todayStr;
              const isPast = dateStr < todayStr;
              const col = (firstDay + i) % 7;
              const isSun = col === 0;
              const isSat = col === 6;

              return (
                <div
                  key={day}
                  className={`min-h-[110px] p-2 border-b border-r border-line-2 transition-colors ${
                    isPast ? 'bg-card-2' : 'bg-card hover:bg-brand-soft'
                  }`}
                >
                  {/* Day number */}
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-[13px] font-semibold w-7 h-8 flex items-center justify-center rounded-full ${
                        isToday
                          ? 'bg-brand text-white'
                          : isSun
                          ? 'text-red-500'
                          : isSat
                          ? 'text-brand'
                          : isPast
                          ? 'text-[#C4C9D1]'
                          : 'text-fg'
                      }`}
                    >
                      {day}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="text-[11px] text-fg-5">{dayEvents.length}건</span>
                    )}
                  </div>

                  {/* Events */}
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((event) => {
                      const style = eventStyle(event);
                      return (
                        <button
                          key={event.id}
                          onClick={() => setSelected(event)}
                          className={`w-full text-left px-1.5 py-0.5 rounded-md text-[11px] font-medium flex items-center gap-1 truncate ${style.pill} hover:opacity-80 transition-opacity`}
                        >
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                          <span className="truncate">
                            {event.coupang_center
                              ? `${event.coupang_center} · ${event.label}`
                              : event.label}
                          </span>
                          {event.box_count != null && (
                            <span className="shrink-0 text-[9px] opacity-70">{event.box_count}박스</span>
                          )}
                        </button>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <button
                        onClick={() => setDayPopup({ date: dateStr, events: dayEvents })}
                        className="text-[11px] text-brand font-medium pl-1 hover:underline"
                      >
                        +{dayEvents.length - 3}개 더
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Trailing empty cells to complete last row */}
            {Array.from({ length: (7 - ((firstDay + daysInMonth) % 7)) % 7 }).map((_, i) => (
              <div key={`trail-${i}`} className="min-h-[110px] p-2 border-b border-r border-line-2 bg-card-2" />
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap text-[12px] text-fg-3">
        <span className="font-medium">범례:</span>
        {[
          { color: 'bg-violet-500',  label: '발주일' },
          { color: 'bg-emerald-500', label: '수입입고 예정' },
          { color: 'bg-teal-500',    label: '국내입고 예정' },
          { color: 'bg-brand',    label: '쿠팡그로스 도착 예정' },
          { color: 'bg-fg-5',    label: '기타 출고' },
          { color: 'bg-orange-500',  label: '발주 권장일' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
            {label}
          </span>
        ))}
      </div>

      {/* Day events popup */}
      {dayPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setDayPopup(null)}>
          <div className="absolute inset-0 bg-black/20" />
          <div
            className="relative bg-card rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.15)] w-full max-w-sm mx-4 p-5 max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-bold text-fg">
                {dayPopup.date.replace(/(\d{4})-(\d{2})-(\d{2})/, '$1년 $2월 $3일')}
                <span className="ml-2 text-[12px] font-medium text-fg-4">{dayPopup.events.length}건</span>
              </h3>
              <button onClick={() => setDayPopup(null)} className="w-7 h-8 flex items-center justify-center rounded-lg hover:bg-app">
                <X className="h-4 w-4 text-fg-3" />
              </button>
            </div>
            <div className="overflow-y-auto space-y-1.5">
              {dayPopup.events.map((event) => {
                const style = eventStyle(event);
                const subtypeLabel = event.type === 'order' ? '발주'
                  : event.type === 'reorder' ? '발주권장'
                  : event.type === 'inbound' ? (INBOUND_SUBTYPES[event.subtype] ?? '입고')
                  : (OUTBOUND_SUBTYPES[event.subtype] ?? '출고');
                return (
                  <button
                    key={event.id}
                    onClick={() => { setDayPopup(null); setSelected(event); }}
                    className={`w-full text-left px-3 py-2 rounded-xl text-[12px] flex items-center gap-2 ${style.pill} hover:opacity-80 transition-opacity`}
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                    <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${style.badge}`}>{subtypeLabel}</span>
                    <span className="truncate font-medium">{event.label}</span>
                    {event.quantity > 0 && event.type !== 'reorder' && event.type !== 'order' && (
                      <span className="shrink-0 text-[11px] opacity-70">{formatNumber(event.quantity)}개</span>
                    )}
                    {event.box_count != null && (
                      <span className="shrink-0 text-[11px] opacity-70">{event.box_count}박스</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Event detail popup */}
      {selected && <EventPopup event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
