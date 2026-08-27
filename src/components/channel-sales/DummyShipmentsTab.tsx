'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatNumber, formatDate } from '@/lib/utils';
import {
  Loader2, Package, RotateCcw,
} from 'lucide-react';

interface DummyOrder {
  id: string;
  channel: string;
  order_date: string;
  order_time: string | null;
  product_name: string;
  option_name: string | null;
  order_number: string | null;
  recipient: string | null;
  tracking_number: string | null;
  quantity: number;
  shipping_cost: number;
  jeju_surcharge: boolean;
  order_status: string | null;
}

const CHANNEL_BADGE: Record<string, { label: string; cls: string }> = {
  smartstore:     { label: '스마트스토어', cls: 'bg-green-50 text-green-700' },
  toss:           { label: '토스',         cls: 'bg-brand-bg text-brand-hover' },
  coupang_direct: { label: '쿠팡 Wing',   cls: 'bg-yellow-50 text-yellow-700' },
  coupang_rg:     { label: '쿠팡 그로스', cls: 'bg-orange-50 text-orange-700' },
  other:          { label: '기타',         cls: 'bg-app text-fg-3' },
};

export default function DummyShipmentsTab() {
  const [orders, setOrders] = useState<DummyOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/channel-orders?is_dummy=true');
      if (res.ok) {
        const data = await res.json();
        setOrders(data);
      }
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRestore = async (id: string) => {
    if (!confirm('이 주문을 일반 주문으로 복원하시겠습니까?\n재고 차감 대상에 다시 포함됩니다.')) return;
    await fetch('/api/channel-orders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_dummy: false }),
    });
    setOrders((prev) => prev.filter((o) => o.id !== id));
  };

  const totalShipping = orders.reduce((s, o) => s + (o.shipping_cost ?? 0), 0);
  const totalQty = orders.reduce((s, o) => s + o.quantity, 0);

  return (
    <div className="space-y-4">
      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-card rounded-xl border border-line-2 px-4 py-3">
          <p className="text-[11px] text-fg-4">총 건수</p>
          <p className="text-[18px] font-bold text-fg mt-0.5">{orders.length}건 ({totalQty}개)</p>
        </div>
        <div className="bg-card rounded-xl border border-line-2 px-4 py-3">
          <p className="text-[11px] text-fg-4">총 배송비 (재고 차감 없음)</p>
          <p className="text-[18px] font-bold text-danger mt-0.5">{formatNumber(totalShipping)}원</p>
        </div>
        <div className="bg-card rounded-xl border border-line-2 px-4 py-3">
          <p className="text-[11px] text-fg-4">안내</p>
          <p className="text-[12px] text-fg-3 mt-0.5">주문 내역 탭에서 <span className="font-medium text-orange-500">빈박스 아이콘</span>을 클릭하면 여기로 이동합니다</p>
        </div>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-10 w-10 mx-auto text-fg-5 mb-2" />
          <p className="text-[13px] text-fg-4">가배송 처리된 주문이 없습니다</p>
          <p className="text-[12px] text-fg-5 mt-1">주문 내역 탭에서 빈박스/리뷰용 주문을 가배송으로 전환하세요</p>
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-line-2 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line-2 bg-card-2">
                <th className="text-left px-3 py-2.5 font-semibold text-fg-3">날짜</th>
                <th className="text-left px-3 py-2.5 font-semibold text-fg-3">채널</th>
                <th className="text-left px-3 py-2.5 font-semibold text-fg-3">상품</th>
                <th className="text-left px-3 py-2.5 font-semibold text-fg-3">옵션</th>
                <th className="text-left px-3 py-2.5 font-semibold text-fg-3">주문번호</th>
                <th className="text-left px-3 py-2.5 font-semibold text-fg-3">수령인</th>
                <th className="text-left px-3 py-2.5 font-semibold text-fg-3">운송장</th>
                <th className="text-right px-3 py-2.5 font-semibold text-fg-3">수량</th>
                <th className="text-right px-3 py-2.5 font-semibold text-fg-3">배송비</th>
                <th className="text-left px-3 py-2.5 font-semibold text-fg-3">상태</th>
                <th className="text-center px-3 py-2.5 font-semibold text-fg-3">복원</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const ch = CHANNEL_BADGE[o.channel] ?? CHANNEL_BADGE.other;
                return (
                  <tr key={o.id} className="border-b border-line-2 hover:bg-card-2">
                    <td className="px-3 py-2 text-fg whitespace-nowrap">{o.order_date}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-medium ${ch.cls}`}>{ch.label}</span>
                    </td>
                    <td className="px-3 py-2 text-fg max-w-[200px] truncate">{o.product_name}</td>
                    <td className="px-3 py-2 text-fg-3">{o.option_name ?? '-'}</td>
                    <td className="px-3 py-2 text-fg-3 font-mono text-[11px]">{o.order_number ?? '-'}</td>
                    <td className="px-3 py-2 text-fg-3">{o.recipient ?? '-'}</td>
                    <td className="px-3 py-2 text-fg-3 font-mono text-[11px]">{o.tracking_number ?? '-'}</td>
                    <td className="px-3 py-2 text-right text-fg font-medium">{o.quantity}</td>
                    <td className="px-3 py-2 text-right text-danger font-medium">
                      {formatNumber(o.shipping_cost ?? 0)}원
                      {o.jeju_surcharge && <span className="text-[10px] text-orange-500 ml-1">제주</span>}
                    </td>
                    <td className="px-3 py-2 text-fg-3">{o.order_status ?? '-'}</td>
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => handleRestore(o.id)} title="일반 주문으로 복원"
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-app text-fg-5 hover:text-brand transition-colors mx-auto">
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* 합계 */}
          <div className="sticky bottom-0 bg-card-2 border-t-2 border-line">
            <table className="w-full text-[12px]"><tbody>
              <tr className="font-bold">
                <td className="px-3 py-2.5 text-fg" colSpan={7}>합계</td>
                <td className="px-3 py-2.5 text-right text-fg">{totalQty}</td>
                <td className="px-3 py-2.5 text-right text-danger">{formatNumber(totalShipping)}원</td>
                <td colSpan={2}></td>
              </tr>
            </tbody></table>
          </div>
        </div>
      )}
    </div>
  );
}
