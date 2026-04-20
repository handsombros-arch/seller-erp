'use client';

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ExternalLink, Trophy, Minus, Plus, Save, FolderOpen, Trash2, X, Download } from 'lucide-react';
import { getCategoryDimensions, matchDimension } from '@/lib/sourcing-dimensions';

interface CustomRow {
  id: string;
  label: string;
  values: Record<string, string>; // itemId → value
}

interface Snapshot {
  id: string;
  name: string;
  item_ids: string[];
  note?: string | null;
  created_at: string;
  updated_at?: string;
}

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

  // 커스텀 행 + 스냅샷
  const [customRows, setCustomRows] = useState<CustomRow[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [currentSnapshotId, setCurrentSnapshotId] = useState<string | null>(null);
  const [currentSnapshotDate, setCurrentSnapshotDate] = useState<string | null>(null);
  const [savingSnapshot, setSavingSnapshot] = useState(false);

  useEffect(() => {
    if (ids.length === 0) { setLoading(false); return; }
    Promise.all(ids.map((id) => fetch('/api/sourcing/' + id).then((r) => r.ok ? r.json() : null)))
      .then((arr) => setItems(arr.filter(Boolean)))
      .finally(() => setLoading(false));
  }, [ids.join(',')]);

  // 스냅샷 목록 로드
  useEffect(() => {
    fetch('/api/sourcing/comparisons').then((r) => r.ok ? r.json() : []).then(setSnapshots).catch(() => {});
  }, []);

  const addCustomRow = () => {
    setCustomRows((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label: '', values: {} },
    ]);
  };

  const updateCustomRow = (rowId: string, patch: Partial<CustomRow>) => {
    setCustomRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  };

  const updateCustomCell = (rowId: string, itemId: string, value: string) => {
    setCustomRows((prev) => prev.map((r) =>
      r.id === rowId ? { ...r, values: { ...r.values, [itemId]: value } } : r
    ));
  };

  const removeCustomRow = (rowId: string) => {
    setCustomRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  const saveSnapshot = async () => {
    const defaultName = `비교 ${new Date().toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}`;
    const name = prompt('스냅샷 이름', currentSnapshotId ? snapshots.find((s) => s.id === currentSnapshotId)?.name || defaultName : defaultName);
    if (!name) return;
    setSavingSnapshot(true);
    try {
      const body = { name, item_ids: ids, custom_rows: customRows };
      let res;
      if (currentSnapshotId) {
        res = await fetch(`/api/sourcing/comparisons/${currentSnapshotId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
      } else {
        res = await fetch('/api/sourcing/comparisons', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
      }
      if (!res.ok) { alert('저장 실패: ' + (await res.text()).slice(0, 200)); return; }
      const saved = await res.json();
      setCurrentSnapshotId(saved.id);
      setCurrentSnapshotDate(saved.created_at);
      // 목록 갱신
      const list = await fetch('/api/sourcing/comparisons').then((r) => r.json());
      setSnapshots(list);
    } finally { setSavingSnapshot(false); }
  };

  const loadSnapshot = async (snapshotId: string) => {
    const res = await fetch(`/api/sourcing/comparisons/${snapshotId}`);
    if (!res.ok) { alert('로드 실패'); return; }
    const snap = await res.json();
    setCurrentSnapshotId(snap.id);
    setCurrentSnapshotDate(snap.created_at);
    setCustomRows(snap.custom_rows || []);
    // 항목이 다르면 URL 갱신 안내
    if (JSON.stringify(snap.item_ids.sort()) !== JSON.stringify([...ids].sort())) {
      const go = confirm(`이 스냅샷은 ${snap.item_ids.length}개 상품 조합입니다. 해당 조합으로 이동할까요?`);
      if (go) window.location.href = `/sourcing/compare?ids=${snap.item_ids.join(',')}`;
    }
  };

  const deleteSnapshot = async (snapshotId: string) => {
    if (!confirm('이 스냅샷을 삭제하시겠습니까?')) return;
    await fetch(`/api/sourcing/comparisons/${snapshotId}`, { method: 'DELETE' });
    setSnapshots((prev) => prev.filter((s) => s.id !== snapshotId));
    if (currentSnapshotId === snapshotId) {
      setCurrentSnapshotId(null);
      setCurrentSnapshotDate(null);
    }
  };

  const newSnapshot = () => {
    setCurrentSnapshotId(null);
    setCurrentSnapshotDate(null);
    setCustomRows([]);
  };

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

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">상품 비교</h1>
          {currentSnapshotId && currentSnapshotDate && (
            <div className="text-xs text-gray-500 mt-1">
              스냅샷: <strong>{snapshots.find((s) => s.id === currentSnapshotId)?.name || '(이름 없음)'}</strong>
              <span className="ml-2 text-gray-400">저장일 {new Date(currentSnapshotDate).toLocaleString('ko-KR')}</span>
            </div>
          )}
        </div>

        {/* 스냅샷 툴바 */}
        <div className="flex items-center gap-2 flex-wrap">
          {snapshots.length > 0 && (
            <div className="relative">
              <details className="group">
                <summary className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 cursor-pointer list-none">
                  <FolderOpen className="w-3.5 h-3.5" /> 불러오기 ({snapshots.length})
                </summary>
                <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg w-80 max-h-96 overflow-y-auto z-20">
                  {snapshots.map((s) => (
                    <div key={s.id} className={`flex items-center justify-between px-3 py-2 text-xs border-b hover:bg-blue-50 ${currentSnapshotId === s.id ? 'bg-blue-50' : ''}`}>
                      <button onClick={() => loadSnapshot(s.id)} className="flex-1 text-left">
                        <div className="font-medium text-gray-900">{s.name}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {new Date(s.created_at).toLocaleString('ko-KR')} · {s.item_ids.length}개 상품
                        </div>
                      </button>
                      <button onClick={() => deleteSnapshot(s.id)} className="ml-2 p-1 text-gray-400 hover:text-red-600">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
          {currentSnapshotId && (
            <button onClick={newSnapshot} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50">
              <X className="w-3.5 h-3.5" /> 새로 시작
            </button>
          )}
          <button
            onClick={saveSnapshot}
            disabled={savingSnapshot}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" /> {currentSnapshotId ? '업데이트 저장' : '스냅샷 저장'}
          </button>
          <button
            onClick={async () => {
              const ExcelJS = (await import('exceljs')).default;
              const toText = (v: unknown): string => {
                if (v == null) return '';
                if (Array.isArray(v)) return v.map((x) => toText(x)).filter(Boolean).join('\n· ');
                if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return ''; } }
                return String(v);
              };
              const wb = new ExcelJS.Workbook();
              const ws = wb.addWorksheet('상품 비교', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
              const nCols = items.length + 1;
              ws.columns = [{ width: 22 }, ...items.map(() => ({ width: 42 }))];

              const thinBorder = { style: 'thin' as const, color: { argb: 'FFE5E7EB' } };
              const cellBorder = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

              // ── 헤더 행 (상품 제목) ──
              const headerValues = ['항목', ...items.map((it: any) => it.product_info?.title || '(제목 없음)')];
              const headerRow = ws.addRow(headerValues);
              headerRow.height = 48;
              headerRow.eachCell((cell) => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
                cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                cell.border = cellBorder;
              });

              // ── 섹션 헤더 (배경 회색 + 병합) ──
              const addSection = (name: string) => {
                const r = ws.addRow([name]);
                r.height = 22;
                ws.mergeCells(r.number, 1, r.number, nCols);
                const cell = r.getCell(1);
                cell.value = name;
                cell.font = { bold: true, color: { argb: 'FF111827' }, size: 11 };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1D5DB' } };
                cell.alignment = { vertical: 'middle', horizontal: 'left' };
                cell.border = cellBorder;
                // 병합된 나머지 셀에도 border
                for (let i = 2; i <= nCols; i++) r.getCell(i).border = cellBorder;
              };

              // ── 데이터 행 ──
              const addDataRow = (label: string, getter: (it: any, idx: number) => unknown, winnerIdx?: (idx: number) => boolean) => {
                const vals = items.map((it: any, idx: number) => toText(getter(it, idx)));
                const r = ws.addRow([label, ...vals]);
                r.alignment = { vertical: 'top', wrapText: true };
                // 라벨 셀
                const first = r.getCell(1);
                first.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
                first.font = { bold: true, color: { argb: 'FF4B5563' }, size: 10 };
                first.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
                first.border = cellBorder;
                // 값 셀
                for (let i = 0; i < items.length; i++) {
                  const cell = r.getCell(i + 2);
                  cell.font = { size: 10, color: { argb: 'FF111827' } };
                  cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
                  cell.border = cellBorder;
                  if (winnerIdx && winnerIdx(i)) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
                    cell.font = { size: 10, bold: true, color: { argb: 'FF166534' } };
                  }
                }
                // 높이 자동 (긴 텍스트면 increase)
                const maxLen = Math.max(...vals.map((v) => v.length));
                if (maxLen > 60) r.height = Math.min(120, Math.ceil(maxLen / 40) * 16);
              };

              // ── 섹션들 ──
              addSection('기본 정보');
              addDataRow('플랫폼', (it) => it.platform);
              addDataRow('상품ID', (it) => it.product_id);
              addDataRow('URL', (it) => it.url);
              addDataRow('카테고리', (it) => it.detail_analysis?.category);

              addSection('가격');
              addDataRow('최종가', (it) => it.product_info?.finalPrice || it.product_info?.price, (i) => i === c.priceWinner);
              addDataRow('정가', (it) => it.product_info?.originalPrice);
              addDataRow('최저가 대비 +%', (_it, i) => {
                if (c.prices[i] == null || c.priceWinner === null || c.prices[c.priceWinner!] == null) return '';
                if (i === c.priceWinner) return '(최저가)';
                const base = c.prices[c.priceWinner!]!;
                return `+${(((c.prices[i]! - base) / base) * 100).toFixed(0)}%`;
              });

              addSection('리뷰 신뢰도');
              addDataRow('총 리뷰 수', (it) => it.review_stats?.total, (i) => i === c.reviewCountWinner);
              addDataRow('공식 리뷰 수', (it) => it.review_stats?.officialReviewCount);
              addDataRow('평균 별점', (it) => it.review_stats?.avgRating, (i) => i === c.ratingWinner);
              addDataRow('공식 평점', (it) => it.review_stats?.officialAvgRating);
              addDataRow('중립 종합점수', (it) => it.review_analysis?.neutral_score, (i) => i === c.neutralWinner);
              addDataRow('문의 수', (it) => it.inquiries_count);
              addDataRow('긍정 %', (it) => it.review_analysis?.sentiment_breakdown?.positive_pct);
              addDataRow('중립 %', (it) => it.review_analysis?.sentiment_breakdown?.neutral_pct);
              addDataRow('부정 %', (it) => it.review_analysis?.sentiment_breakdown?.negative_pct);

              addSection('소싱 판단');
              addDataRow('판단', (it) => it.review_analysis?.sourcing_decision?.verdict);
              addDataRow('신뢰도', (it) => it.review_analysis?.sourcing_decision?.confidence);
              addDataRow('핵심 근거', (it) => it.review_analysis?.sourcing_decision?.primary_reasoning);
              addDataRow('차별화 전략', (it) => it.review_analysis?.sourcing_decision?.differentiation_strategy);

              addSection('시장 신호');
              addDataRow('수요 강도', (it) => it.review_analysis?.market_signals?.demand_strength);
              addDataRow('시장 포화', (it) => it.review_analysis?.market_signals?.saturation_risk);
              addDataRow('가격 포지션', (it) => it.review_analysis?.market_signals?.price_position);
              addDataRow('트렌드 지속', (it) => it.review_analysis?.market_signals?.trend_durability);

              if (c.canonicalDims?.length) {
                addSection(`차원별 평가 (${c.primaryCategory || '카테고리'} 표준)`);
                for (const dim of c.canonicalDims) {
                  addDataRow(dim, (_it, i) => {
                    const d = c.itemDimMap[i]?.[dim];
                    if (!d) return '';
                    const score = d.score ?? '-';
                    const note = (d.note || '').toString().replace(/\n/g, ' ').slice(0, 300);
                    return `${score}/10${note ? ` · ${note}` : ''}`;
                  }, (i) => c.dimensionWinners?.[dim] === i);
                }
              }
              if (c.extraDims?.length) {
                addSection('기타 차원');
                for (const dim of c.extraDims) {
                  addDataRow(dim, (_it, i) => {
                    const d = c.itemDimMap[i]?.[dim];
                    if (!d) return '';
                    const score = d.score ?? '-';
                    const note = (d.note || '').toString().replace(/\n/g, ' ').slice(0, 300);
                    return `${score}/10${note ? ` · ${note}` : ''}`;
                  }, (i) => c.dimensionWinners?.[dim] === i);
                }
              }

              addSection('장단점 (Top 3)');
              addDataRow('장점', (it) => (it.review_analysis?.pros_ranked || []).slice(0, 3).map((x: any) => x.point).filter(Boolean));
              addDataRow('단점', (it) => (it.review_analysis?.cons_ranked || []).slice(0, 3).map((x: any) => `${x.point}${x.severity ? ` [${x.severity}]` : ''}`).filter(Boolean));
              addDataRow('해결 가능 포인트', (it) => (it.review_analysis?.solvable_pain_points || []).slice(0, 3).map((x: any) => x.issue).filter(Boolean));

              addSection('물리 스펙');
              addDataRow('무게', (it) => findSpec(it.detail_analysis?.specs, SPEC_ALIASES['무게']), (i) => i === c.weightWinner);
              addDataRow('용량', (it) => findSpec(it.detail_analysis?.specs, SPEC_ALIASES['용량']), (i) => i === c.capacityWinner);
              addDataRow('크기', (it) => findSpec(it.detail_analysis?.specs, SPEC_ALIASES['크기']));
              addDataRow('재질', (it) => findSpec(it.detail_analysis?.specs, SPEC_ALIASES['재질']));
              addDataRow('색상', (it) => findSpec(it.detail_analysis?.specs, SPEC_ALIASES['색상']));
              addDataRow('원산지', (it) => findSpec(it.detail_analysis?.specs, SPEC_ALIASES['원산지']));
              addDataRow('방수', (it) => findSpec(it.detail_analysis?.specs, SPEC_ALIASES['방수']));

              const shownInPhysical = new Set(['무게', '용량', '크기', '재질', '색상', '원산지', '방수']);
              const remainingKeys = (c.allSpecKeys || []).filter((k: string) => !shownInPhysical.has(k));
              if (remainingKeys.length > 0) {
                addSection('카테고리별 핵심 스펙');
                for (const key of remainingKeys) addDataRow(key, (it) => getSpecValue(it, key));
              }

              if (customRows.length > 0) {
                addSection('수기 비교 항목');
                for (const cr of customRows) addDataRow(cr.label || '(제목 없음)', (it) => cr.values[it.id] || '');
              }

              const buffer = await wb.xlsx.writeBuffer();
              const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `상품비교_${new Date().toISOString().slice(0, 10)}.xlsx`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
            }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-green-600 bg-white text-green-700 hover:bg-green-50"
            title="비교 표 모든 섹션을 xlsx 로 다운로드"
          >
            <Download className="w-3.5 h-3.5" /> xlsx 다운로드
          </button>
        </div>
      </div>

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

            {/* 수기 비교 항목 */}
            <SectionHead label={`수기 비교 항목${customRows.length > 0 ? ` (${customRows.length})` : ''}`} cols={items.length + 1} />
            {customRows.map((row) => (
              <tr key={row.id} className="hover:bg-yellow-50">
                <th className="text-left px-3 py-2 bg-yellow-50/30 sticky left-0 align-top">
                  <div className="flex items-start gap-1">
                    <input
                      type="text"
                      value={row.label}
                      onChange={(e) => updateCustomRow(row.id, { label: e.target.value })}
                      placeholder="항목명"
                      className="flex-1 text-xs font-medium px-1.5 py-1 border border-gray-200 rounded bg-white min-w-0"
                    />
                    <button
                      onClick={() => removeCustomRow(row.id)}
                      className="p-1 text-gray-400 hover:text-red-600 shrink-0"
                      title="행 삭제"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </th>
                {items.map((it) => (
                  <td key={it.id} className="px-3 py-2 align-top">
                    <textarea
                      value={row.values[it.id] || ''}
                      onChange={(e) => updateCustomCell(row.id, it.id, e.target.value)}
                      placeholder="값 입력..."
                      rows={1}
                      className="w-full text-xs px-2 py-1 border border-gray-200 rounded bg-white resize-y min-h-[28px]"
                    />
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td colSpan={items.length + 1} className="px-3 py-2 bg-gray-50">
                <button
                  onClick={addCustomRow}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" /> 수기 항목 추가
                </button>
              </td>
            </tr>
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
