'use client';

import { Megaphone } from 'lucide-react';

export default function SmartStoreAdAnalysisPage() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-app flex items-center justify-center mb-4">
        <Megaphone className="w-7 h-7 text-fg-5" />
      </div>
      <h2 className="text-[18px] font-bold text-fg mb-1">스마트스토어 광고 분석</h2>
      <p className="text-[13px] text-fg-3 mb-6">샘플 CSV 업로드 후 파서 작성 예정</p>
      <p className="text-[11px] text-fg-5">네이버 스마트스토어 광고 보고서 xlsx/csv를 알려주시면 동일한 분석 기능을 제공합니다</p>
    </div>
  );
}
