'use client';

import { useState, useRef, useCallback } from 'react';
import { formatNumber } from '@/lib/utils';
import {
  Upload, Download, Loader2, Tag, ExternalLink, Percent, BadgePercent,
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface ProductRow {
  index: number;
  rank: number;
  category: string;
  brand: string;
  manufacturer: string;
  name: string;
  price: number;
  purchases: number;
  reviews: number;
  clicks: number;
  link: string;
  couponAmount: number;
  couponPercent: number;
  actualPrice: number;
}

type CouponMode = 'amount' | 'percent';

export default function PriceToolPage() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [couponMode, setCouponMode] = useState<CouponMode>('amount');
  const [bulkValue, setBulkValue] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Upload & parse
  const handleUpload = useCallback(async (file: File) => {
    setLoading(true);
    setFileName(file.name);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/price-tool', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.rows) setRows(data.rows);
    } finally {
      setLoading(false);
    }
  }, []);

  // Update coupon for a single row
  const updateCoupon = useCallback((index: number, value: number) => {
    setRows(prev => prev.map(r => {
      if (r.index !== index) return r;
      if (couponMode === 'amount') {
        const couponAmount = value;
        return { ...r, couponAmount, actualPrice: Math.max(0, r.price - couponAmount) };
      } else {
        const couponPercent = value;
        const discount = Math.round(r.price * couponPercent / 100);
        return { ...r, couponPercent, couponAmount: discount, actualPrice: Math.max(0, r.price - discount) };
      }
    }));
  }, [couponMode]);

  // Apply bulk coupon to all
  const applyBulk = useCallback(() => {
    const val = Number(bulkValue);
    if (!val) return;
    setRows(prev => prev.map(r => {
      if (couponMode === 'amount') {
        return { ...r, couponAmount: val, actualPrice: Math.max(0, r.price - val) };
      } else {
        const discount = Math.round(r.price * val / 100);
        return { ...r, couponPercent: val, couponAmount: discount, actualPrice: Math.max(0, r.price - discount) };
      }
    }));
  }, [bulkValue, couponMode]);

  // Download modified xlsx
  const handleDownload = useCallback(() => {
    const data = rows.map(r => ({
      '순위': r.rank,
      '카테고리': r.category,
      '브랜드': r.brand,
      '상품명': r.name,
      '원본가격': r.price,
      '쿠폰할인': r.couponAmount,
      '실제가격': r.actualPrice,
      '할인율(%)': r.price > 0 ? Math.round(r.couponAmount / r.price * 100) : 0,
      '구매건수(1개월)': r.purchases,
      '리뷰수': r.reviews,
      '클릭수': r.clicks,
      '링크': r.link,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    // Column widths
    ws['!cols'] = [
      { wch: 5 }, { wch: 30 }, { wch: 12 }, { wch: 35 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
      { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 50 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '가격분석');
    const baseName = fileName.replace(/\.[^.]+$/, '');
    XLSX.writeFile(wb, `${baseName}_쿠폰반영.xlsx`);
  }, [rows, fileName]);

  // Stats
  const totalProducts = rows.length;
  const withCoupon = rows.filter(r => r.couponAmount > 0).length;
  const avgDiscount = totalProducts > 0
    ? Math.round(rows.reduce((s, r) => s + (r.price > 0 ? r.couponAmount / r.price * 100 : 0), 0) / totalProducts)
    : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold flex items-center gap-2">
            <Tag className="h-5 w-5" />
            가격 분석 도구
            <span className="text-[11px] font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">BETA</span>
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            상위상품 엑셀 업로드 → 다운로드 쿠폰 반영 → 실제 가격 비교
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="h-9 px-4 rounded-lg bg-primary text-white text-[13px] font-medium flex items-center gap-2 hover:bg-primary/90"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            엑셀 업로드
          </button>
          {rows.length > 0 && (
            <button
              onClick={handleDownload}
              className="h-9 px-4 rounded-lg border text-[13px] font-medium flex items-center gap-2 hover:bg-gray-50"
            >
              <Download className="h-4 w-4" />
              다운로드
            </button>
          )}
        </div>
      </div>

      {fileName && (
        <p className="text-[12px] text-muted-foreground">파일: {fileName}</p>
      )}

      {/* Stats */}
      {rows.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border rounded-xl p-3">
              <p className="text-[11px] text-muted-foreground">전체 상품</p>
              <p className="text-[20px] font-bold">{totalProducts}개</p>
            </div>
            <div className="bg-white border rounded-xl p-3">
              <p className="text-[11px] text-muted-foreground">쿠폰 적용</p>
              <p className="text-[20px] font-bold text-blue-600">{withCoupon}개</p>
            </div>
            <div className="bg-white border rounded-xl p-3">
              <p className="text-[11px] text-muted-foreground">평균 할인율</p>
              <p className="text-[20px] font-bold text-red-500">{avgDiscount}%</p>
            </div>
          </div>

          {/* Bulk apply */}
          <div className="bg-white border rounded-xl p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[13px] font-medium">일괄 적용:</span>
              <div className="flex items-center border rounded-lg overflow-hidden">
                <button
                  onClick={() => setCouponMode('amount')}
                  className={`px-3 py-1.5 text-[12px] font-medium ${couponMode === 'amount' ? 'bg-primary text-white' : 'bg-gray-50 text-gray-600'}`}
                >
                  <BadgePercent className="h-3.5 w-3.5 inline mr-1" />
                  금액(원)
                </button>
                <button
                  onClick={() => setCouponMode('percent')}
                  className={`px-3 py-1.5 text-[12px] font-medium ${couponMode === 'percent' ? 'bg-primary text-white' : 'bg-gray-50 text-gray-600'}`}
                >
                  <Percent className="h-3.5 w-3.5 inline mr-1" />
                  비율(%)
                </button>
              </div>
              <input
                type="number"
                value={bulkValue}
                onChange={e => setBulkValue(e.target.value)}
                placeholder={couponMode === 'amount' ? '예: 3000' : '예: 10'}
                className="h-8 w-[120px] border rounded-lg px-3 text-[13px]"
              />
              <button
                onClick={applyBulk}
                className="h-8 px-4 rounded-lg bg-blue-500 text-white text-[12px] font-medium hover:bg-blue-600"
              >
                전체 적용
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="px-3 py-2 text-left font-medium w-[40px]">#</th>
                    <th className="px-3 py-2 text-left font-medium min-w-[200px]">상품명</th>
                    <th className="px-3 py-2 text-left font-medium w-[80px]">브랜드</th>
                    <th className="px-3 py-2 text-right font-medium w-[90px]">원본가격</th>
                    <th className="px-3 py-2 text-center font-medium w-[120px]">
                      쿠폰할인
                    </th>
                    <th className="px-3 py-2 text-right font-medium w-[90px]">실제가격</th>
                    <th className="px-3 py-2 text-right font-medium w-[60px]">할인율</th>
                    <th className="px-3 py-2 text-right font-medium w-[70px]">구매수</th>
                    <th className="px-3 py-2 text-right font-medium w-[60px]">리뷰</th>
                    <th className="px-3 py-2 text-right font-medium w-[70px]">클릭수</th>
                    <th className="px-3 py-2 text-center font-medium w-[40px]">링크</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const discountPct = r.price > 0 ? Math.round(r.couponAmount / r.price * 100) : 0;
                    return (
                      <tr key={r.index} className="border-b hover:bg-gray-50/50">
                        <td className="px-3 py-2 text-muted-foreground">{r.rank}</td>
                        <td className="px-3 py-2 font-medium">
                          <span className="line-clamp-1">{r.name}</span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{r.brand}</td>
                        <td className="px-3 py-2 text-right">{formatNumber(r.price)}원</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={couponMode === 'amount' ? (r.couponAmount || '') : (r.couponPercent || '')}
                            onChange={e => updateCoupon(r.index, Number(e.target.value) || 0)}
                            placeholder={couponMode === 'amount' ? '원' : '%'}
                            className="h-7 w-full border rounded px-2 text-[12px] text-center"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-blue-600">
                          {formatNumber(r.actualPrice)}원
                        </td>
                        <td className="px-3 py-2 text-right">
                          {discountPct > 0 && (
                            <span className="text-red-500 font-medium">-{discountPct}%</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{formatNumber(r.purchases)}</td>
                        <td className="px-3 py-2 text-right">{formatNumber(r.reviews)}</td>
                        <td className="px-3 py-2 text-right">{formatNumber(r.clicks)}</td>
                        <td className="px-3 py-2 text-center">
                          {r.link && (
                            <a href={r.link} target="_blank" rel="noopener noreferrer"
                              className="text-blue-500 hover:text-blue-700">
                              <ExternalLink className="h-3.5 w-3.5 inline" />
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && rows.length === 0 && (
        <div
          className="border-2 border-dashed rounded-xl p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-[14px] font-medium">상위상품 엑셀 파일을 업로드하세요</p>
          <p className="text-[12px] text-muted-foreground mt-1">
            쿠팡 상위상품 엑셀 (.xlsx) 파일을 드래그하거나 클릭하세요
          </p>
        </div>
      )}
    </div>
  );
}
