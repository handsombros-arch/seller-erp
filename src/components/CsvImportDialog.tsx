'use client';

import { useState } from 'react';
import { Upload, X, Download, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  title: string;
  templateType: string;          // csv-template?type= 값
  templateUrl?: string;          // 동적 양식 다운로드 URL (지정 시 templateType 대신 사용)
  importUrl: string;             // POST 엔드포인트
  columns: string[];             // 표시할 컬럼 목록 (미리보기용)
  description?: string;
}

const inputCls = 'w-full h-11 px-3.5 rounded-xl border border-[#E5E8EB] text-[14px] text-[#191F28] placeholder:text-[#B0B8C1] focus:outline-none focus:border-[#3182F6] focus:ring-2 focus:ring-[#3182F6]/10 transition-colors';

export default function CsvImportDialog({ open, onClose, onImported, title, templateType, templateUrl, importUrl, columns, description }: Props) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  function reset() { setRows([]); setError(''); setResult(null); }

  function handleClose() { reset(); onClose(); }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(''); setResult(null);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      let wb;

      if (file.name.toLowerCase().endsWith('.csv')) {
        // CSV: try UTF-8 first, fall back to EUC-KR (ANSI Korean)
        const bytes = new Uint8Array(buffer);
        const hasUtf8Bom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
        let text: string;
        if (hasUtf8Bom) {
          text = new TextDecoder('utf-8').decode(bytes);
        } else {
          const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
          if (!utf8.includes('\uFFFD')) {
            text = utf8;
          } else {
            try {
              text = new TextDecoder('euc-kr', { fatal: true }).decode(bytes);
            } catch {
              text = utf8;
            }
          }
        }
        wb = XLSX.read(text, { type: 'string' });
      } else {
        wb = XLSX.read(buffer, { type: 'array' });
      }

      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, string>[];
      if (!json.length) { setError('파일에 데이터가 없습니다.'); return; }
      setRows(json);
    } catch {
      setError('파일을 읽을 수 없습니다. xlsx, xls, csv 파일을 선택하세요.');
    }
    e.target.value = '';
  }

  async function handleImport() {
    if (!rows.length) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(importUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? '오류');

      // Build result message
      const parts: string[] = [];
      if (d.productsCreated !== undefined) parts.push(`상품 ${d.productsCreated}개 생성`);
      if (d.skusCreated !== undefined) parts.push(`SKU ${d.skusCreated}개 생성`);
      if (d.created !== undefined) parts.push(`${d.created}개 등록`);
      if (d.upserted !== undefined) parts.push(`${d.upserted}개 등록/업데이트`);
      const errCount = (d.errors ?? []).length;
      if (errCount) parts.push(`${errCount}건 오류`);

      setResult({ success: true, message: parts.join(' · ') || '완료' });
      if (!errCount) {
        setTimeout(() => { onImported(); handleClose(); }, 1200);
      } else {
        // Show errors
        setError((d.errors as string[]).slice(0, 5).join('\n') + (errCount > 5 ? `\n...외 ${errCount - 5}건` : ''));
      }
      onImported();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const previewCols = rows.length ? Object.keys(rows[0]) : columns;
  const previewRows = rows.slice(0, 5);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={handleClose} />
      <div className="relative bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
          <h2 className="text-[16px] font-bold text-[#191F28]">{title}</h2>
          <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F2F4F6]">
            <X className="h-4 w-4 text-[#6B7684]" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">

          {/* 안내 + 양식 다운로드 */}
          <div className="bg-[#F8F9FB] rounded-xl px-4 py-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-[#191F28]">CSV / Excel 파일로 일괄 등록</p>
              {description && <p className="text-[12px] text-[#6B7684] mt-0.5">{description}</p>}
              <p className="text-[12px] text-[#B0B8C1] mt-1">필수 컬럼: {columns.slice(0, 4).join(', ')} 등</p>
            </div>
            <a href={templateUrl ?? `/api/csv-template?type=${templateType}`} download
              className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-[#3182F6] text-[12.5px] font-semibold text-[#3182F6] hover:bg-[#EBF1FE] transition-colors shrink-0 whitespace-nowrap">
              <Download className="h-3.5 w-3.5" /> 양식 다운로드
            </a>
          </div>

          {/* 파일 선택 */}
          {!rows.length && (
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-[#E5E8EB] rounded-xl cursor-pointer hover:border-[#3182F6] hover:bg-[#EBF1FE]/30 transition-colors">
              <Upload className="h-6 w-6 text-[#B0B8C1] mb-2" />
              <span className="text-[13px] text-[#6B7684]">xlsx / xls / csv 파일을 선택하세요</span>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
            </label>
          )}

          {/* 미리보기 */}
          {rows.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[13px] font-semibold text-[#191F28]">미리보기 <span className="text-[#B0B8C1] font-normal">({rows.length}행)</span></p>
                <button onClick={reset} className="text-[12px] text-[#6B7684] hover:text-red-500 transition-colors flex items-center gap-1">
                  <X className="h-3.5 w-3.5" /> 파일 변경
                </button>
              </div>
              <div className="border border-[#F2F4F6] rounded-xl overflow-hidden overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#F8F9FB] border-b border-[#F2F4F6]">
                    <tr>
                      {previewCols.map((c) => (
                        <th key={c} className="text-left px-3 py-2 text-[11.5px] font-semibold text-[#6B7684] whitespace-nowrap">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F4F6]">
                    {previewRows.map((row, i) => (
                      <tr key={i}>
                        {previewCols.map((c) => (
                          <td key={c} className="px-3 py-2 text-[12.5px] text-[#191F28] whitespace-nowrap max-w-[160px] truncate">{String(row[c] ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 5 && (
                  <p className="text-center text-[11.5px] text-[#B0B8C1] py-2 border-t border-[#F2F4F6]">+ {rows.length - 5}행 더</p>
                )}
              </div>
            </div>
          )}

          {result?.success && (
            <div className="flex items-center gap-2 bg-green-50 rounded-xl px-4 py-3">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              <p className="text-[13px] font-medium text-green-800">{result.message}</p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-red-50 rounded-xl px-4 py-3">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-red-700 whitespace-pre-line">{error}</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={handleClose} className="flex-1 h-11 rounded-xl border border-[#E5E8EB] text-[14px] font-medium text-[#6B7684] hover:bg-[#F2F4F6] transition-colors">
              닫기
            </button>
            <button onClick={handleImport} disabled={!rows.length || loading}
              className="flex-1 h-11 rounded-xl bg-[#3182F6] text-white text-[14px] font-semibold hover:bg-[#1B64DA] disabled:opacity-60 flex items-center justify-center gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              업로드 ({rows.length}행)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
