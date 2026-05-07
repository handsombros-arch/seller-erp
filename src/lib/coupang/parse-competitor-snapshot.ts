// 쿠팡 셀러 광고진단 페이지의 "TOP 20 경쟁상품 + 검색어 기여도" 텍스트를 파싱한다.
// 사용자가 페이지에서 텍스트를 통째로 복사해 붙여넣은 입력을 그대로 받는다.

export type ParsedKeyword = {
  rank: number;
  keyword: string;
  contributing_count: number | null;
  search_volume: number | null;
  search_volume_change_pct: number | null;
  exposure: number | null;
  exposure_change_pct: number | null;
  clicks: number | null;
  clicks_change_pct: number | null;
  avg_price: number | null;
  price_min: number | null;
  price_max: number | null;
};

export type ParsedProduct = {
  rank: number;
  name: string;
  released_at: string | null;       // YYYY-MM-DD
  review_score: number | null;
  review_count: number | null;
  exposure: number | null;
  exposure_change_pct: number | null;
  clicks: number | null;
  clicks_change_pct: number | null;
  ctr: number | null;
  ctr_change_pct: number | null;
  winner_price: number | null;
  price_min: number | null;
  price_max: number | null;
  is_my_product: boolean;
  keywords: ParsedKeyword[];
};

export type ParsedCategoryHeader = {
  category_name: string;          // "여성백팩"
  category_path: string[];        // ["패션의류잡화","여성패션","여성잡화","가방","여성백팩"]
  total_impression: number | null;
  top100_impression: number | null;
  top100_search_pct: number | null;
  top100_ad_pct: number | null;
  total_click: number | null;
};

// 카테고리 단위 TOP 20 검색어 (per-product 인 ParsedKeyword 와 다름).
// 쿠팡 광고진단의 "Top 20 검색어" 페이지에서 한 행씩 나오는 데이터.
export type ParsedTopKeyword = {
  rank: number;
  keyword: string;
  contributing_count: number | null; // 내 상품 노출에 기여한 키워드 (N) 의 N
  search_volume: number | null;
  search_volume_change_pct: number | null;
  exposure: number | null;
  exposure_change_pct: number | null;
  clicks: number | null;
  clicks_change_pct: number | null;
  avg_price: number | null;
  price_min: number | null;
  price_max: number | null;
};

export type ParsedTopBrand = {
  rank: number;
  brand_name: string;
  exposure: number | null;
  exposure_change_pct: number | null;
  clicks: number | null;
  clicks_change_pct: number | null;
  ctr: number | null;
  ctr_change_pct: number | null;
};

// 어떤 페이지가 페이스트되었는지
export type SnapshotType = 'products' | 'keywords' | 'brands';

export type ParseResult = {
  category: ParsedCategoryHeader | null;
  type: SnapshotType;
  products: ParsedProduct[];
  topKeywords: ParsedTopKeyword[];
  topBrands: ParsedTopBrand[];
  warnings: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Field-level helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseKoreanNumber(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[,\s]/g, '');
  const manMatch = cleaned.match(/^(\d+(?:\.\d+)?)만$/);
  if (manMatch) return Math.round(parseFloat(manMatch[1]) * 10000);
  const eokMatch = cleaned.match(/^(\d+(?:\.\d+)?)억$/);
  if (eokMatch) return Math.round(parseFloat(eokMatch[1]) * 100_000_000);
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parsePercent(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(-?[\d.]+)%$/);
  return m ? parseFloat(m[1]) : null;
}

// 변화율: 화살표(↗↘↑↓▲▼) 또는 부호로 방향 감지. 없으면 양수.
function parseChangePercent(s: string | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  const isDown = /[↘↓▼▽]/.test(t) || /^-/.test(t);
  const cleaned = t.replace(/[↗↘↑↓▲▼△▽\s+\-]/g, '');
  const m = cleaned.match(/^([\d.]+)%$/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  return isDown ? -num : num;
}

function parseWon(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.trim().replace(/[₩,\s]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parsePriceRange(s: string | undefined): { min: number | null; max: number | null } {
  if (!s) return { min: null, max: null };
  const m = s.match(/₩\s*([\d,]+)\s*~\s*₩\s*([\d,]+)/);
  if (!m) return { min: null, max: null };
  return { min: parseWon('₩' + m[1]), max: parseWon('₩' + m[2]) };
}

function parseReleaseDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return null;
  const mm = m[2].padStart(2, '0');
  const dd = m[3].padStart(2, '0');
  return `${m[1]}-${mm}-${dd}`;
}

function parseReview(s: string | undefined): { score: number | null; count: number | null } {
  if (!s) return { score: null, count: null };
  const m = s.match(/([\d.]+)\s*\(([\d,]+)\)/);
  if (!m) return { score: null, count: null };
  return { score: parseFloat(m[1]), count: parseInt(m[2].replace(/,/g, ''), 10) };
}

function parseContributingCount(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/\((\d+)\)/);
  return m ? parseInt(m[1], 10) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anchor-based segmentation
// ─────────────────────────────────────────────────────────────────────────────

type Anchor =
  | { kind: 'product'; titleIdx: number; releasedIdx: number }
  | { kind: 'keyword'; nameIdx: number; markerIdx: number };

function findAnchors(lines: string[]): Anchor[] {
  const anchors: Anchor[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^출시일\s*:/.test(line) && i > 0) {
      anchors.push({ kind: 'product', titleIdx: i - 1, releasedIdx: i });
      continue;
    }
    if (/^내 상품 노출에 기여한 키워드\s*\(\d+\)/.test(line) && i > 0) {
      anchors.push({ kind: 'keyword', nameIdx: i - 1, markerIdx: i });
    }
  }
  // sort by start line
  anchors.sort((a, b) => {
    const sa = a.kind === 'product' ? a.titleIdx : a.nameIdx;
    const sb = b.kind === 'product' ? b.titleIdx : b.nameIdx;
    return sa - sb;
  });
  return anchors;
}

function startOf(a: Anchor): number {
  return a.kind === 'product' ? a.titleIdx : a.nameIdx;
}

// 라인 범위 안에서 정확히 매칭되는 라인 인덱스를 찾는다 (없으면 -1).
function findInRange(
  lines: string[],
  from: number,
  to: number,
  predicate: (line: string) => boolean,
): number {
  for (let i = from; i <= to; i++) {
    if (predicate(lines[i])) return i;
  }
  return -1;
}

function exact(label: string) {
  return (line: string) => line.trim() === label;
}

// ─────────────────────────────────────────────────────────────────────────────
// Category header parsing
// ─────────────────────────────────────────────────────────────────────────────

// 카테고리 헤더 라인 패턴:
//   "여성백팩" 카테고리 결과
//   패션의류잡화
//   여성패션
//   ...
//   여성백팩
//   impression
//   1733.99만
//   검색어 노출
//   6.11%             ← 변화율(부호 없음, 무시)
//   415.26만          ← top100_impression
//   Top 100에 대한
//   검색어 노출
//   Search
//   63.07%
//   Ad
//   36.92%
//   click
//   118.42만
//   클릭
//   10.18%            ← 변화율(부호 없음, 무시)
function parseCategoryHeaderFromLines(lines: string[]): ParsedCategoryHeader | null {
  // 쿠팡이 페이지/시점에 따라 '카테고리 결과' 또는 '검색 결과' 두 종류 라벨 사용. 둘 다 인식.
  const titleIdx = lines.findIndex((l) => /^["“'].+["”']\s*(?:카테고리|검색)\s*결과/.test(l));
  if (titleIdx < 0) return null;
  const titleMatch = lines[titleIdx].match(/^["“'](.+?)["”']\s*(?:카테고리|검색)\s*결과/);
  if (!titleMatch) return null;
  const categoryName = titleMatch[1];

  // 'impression' 마커 (없으면 헤더 미완)
  const impressionIdx = lines.findIndex((l, i) => i > titleIdx && l === 'impression');
  if (impressionIdx < 0) return null;

  // 브레드크럼: titleIdx+1 ~ impressionIdx-1
  const path = lines.slice(titleIdx + 1, impressionIdx).filter((l) => l.length > 0);

  // 총 검색어 노출: impression 라벨 다음 줄
  const totalImpression = parseKoreanNumber(lines[impressionIdx + 1]);

  // top100 노출: 'Top 100에 대한' 마커의 직전 라인
  const top100MarkerIdx = lines.findIndex(
    (l, i) => i > impressionIdx && /^Top\s*100에\s*대한/.test(l),
  );
  const top100Impression =
    top100MarkerIdx > 0 ? parseKoreanNumber(lines[top100MarkerIdx - 1]) : null;

  // Search / Ad 비율
  const searchIdx = lines.findIndex((l, i) => i > impressionIdx && l === 'Search');
  const adIdx = lines.findIndex((l, i) => i > impressionIdx && l === 'Ad');
  const top100SearchPct =
    searchIdx >= 0 && searchIdx + 1 < lines.length ? parsePercent(lines[searchIdx + 1]) : null;
  const top100AdPct =
    adIdx >= 0 && adIdx + 1 < lines.length ? parsePercent(lines[adIdx + 1]) : null;

  // 클릭: 'click' 라벨 다음 줄
  const clickIdx = lines.findIndex((l, i) => i > impressionIdx && l === 'click');
  const totalClick =
    clickIdx >= 0 && clickIdx + 1 < lines.length ? parseKoreanNumber(lines[clickIdx + 1]) : null;

  return {
    category_name: categoryName,
    category_path: path,
    total_impression: totalImpression,
    top100_impression: top100Impression,
    top100_search_pct: top100SearchPct,
    top100_ad_pct: top100AdPct,
    total_click: totalClick,
  };
}

export function parseCategoryHeader(rawText: string): ParsedCategoryHeader | null {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return parseCategoryHeaderFromLines(lines);
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot type 감지 — 페이스트가 어느 페이지인지 결정
// ─────────────────────────────────────────────────────────────────────────────
// products: '출시일 :' 마커 (각 상품 행)
// keywords: '검색량' 단독 라벨 라인 (각 키워드 행)
// brands: 둘 다 없고 '클릭율' 라벨 + '검색어 노출' 라벨 (각 브랜드 행)
export function detectSnapshotType(rawText: string): SnapshotType {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.some((l) => /^출시일\s*:/.test(l))) return 'products';
  if (lines.some((l) => l === '검색량')) return 'keywords';
  return 'brands';
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP 20 검색어 파서
// ─────────────────────────────────────────────────────────────────────────────
function parseTopKeywordsFromLines(lines: string[]): ParsedTopKeyword[] {
  // anchor: '검색량' 라인. 각 키워드 entry 마다 1번씩 등장.
  const anchors: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '검색량') anchors.push(i);
  }
  const out: ParsedTopKeyword[] = [];
  for (let ai = 0; ai < anchors.length; ai++) {
    const a = anchors[ai];
    const searchVolume = parseKoreanNumber(lines[a - 1]);
    // back: a-1=search_volume_value, a-2=(contributing line | name), a-3 or a-2=name, a-N=rank
    let cursor = a - 2;
    let contributingCount: number | null = null;
    if (cursor > 0 && /^내 상품 노출에 기여한 키워드\s*\(\d+\)/.test(lines[cursor])) {
      const m = lines[cursor].match(/\((\d+)\)/);
      if (m) contributingCount = parseInt(m[1]);
      cursor--;
    }
    const keyword = (lines[cursor] ?? '').trim();
    cursor--;
    const rankLine = (lines[cursor] ?? '').trim();
    const rank = /^\d+$/.test(rankLine) ? parseInt(rankLine) : ai + 1;
    if (!keyword) continue;

    const sChange = parseChangePercent(lines[a + 1]);
    const exposure = parseKoreanNumber(lines[a + 2]);
    // a+3='검색어 노출'
    const expChange = parseChangePercent(lines[a + 4]);
    const clicks = parseKoreanNumber(lines[a + 5]);
    // a+6='클릭'
    const clicksChange = parseChangePercent(lines[a + 7]);
    const avgPrice = parseWon(lines[a + 8]);
    // a+9='평균가격'
    const priceRangeLine = lines[a + 10] ?? '';
    const { min, max } = parsePriceRange(priceRangeLine);

    out.push({
      rank,
      keyword,
      contributing_count: contributingCount,
      search_volume: searchVolume,
      search_volume_change_pct: sChange,
      exposure,
      exposure_change_pct: expChange,
      clicks,
      clicks_change_pct: clicksChange,
      avg_price: avgPrice,
      price_min: min,
      price_max: max,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP 브랜드 파서
// ─────────────────────────────────────────────────────────────────────────────
function parseTopBrandsFromLines(lines: string[]): ParsedTopBrand[] {
  // anchor: '클릭율' 라벨. brand entry 1개당 1번씩 (products 페이지가 아님 가정 — detectType 후 호출).
  // 일부 entry 에 'double-hyphen' 같은 노이즈 라인 있을 수 있어 anchor 주변 결정적 offset 보다 라벨 기반 forward 탐색.
  const klickyulIdxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^클릭율\s*$/.test(lines[i])) klickyulIdxs.push(i);
  }
  const out: ParsedTopBrand[] = [];
  for (let ai = 0; ai < klickyulIdxs.length; ai++) {
    const a = klickyulIdxs[ai];
    // back: a-1=ctr value, a-2=clicks_change, a-3='클릭', a-4=clicks, a-5=exposure_change, a-6='검색어 노출',
    //       a-7=exposure, a-8=name, a-9=rank
    const ctr = parsePercent(lines[a - 1]);
    const clicksChange = parseChangePercent(lines[a - 2]);
    const clicks = parseKoreanNumber(lines[a - 4]);
    const exposureChange = parseChangePercent(lines[a - 5]);
    const exposure = parseKoreanNumber(lines[a - 7]);
    const brandName = (lines[a - 8] ?? '').trim();
    const rankLine = (lines[a - 9] ?? '').trim();
    const rank = /^\d+$/.test(rankLine) ? parseInt(rankLine) : ai + 1;
    // ctr_change: 다음 라인 (a+1) 이 일반적이지만 'double-hyphen' 같은 노이즈가 끼면 a+2 일 수 있음.
    let ctrChange = parseChangePercent(lines[a + 1]);
    if (ctrChange == null) ctrChange = parseChangePercent(lines[a + 2]);
    if (!brandName) continue;
    out.push({
      rank,
      brand_name: brandName,
      exposure,
      exposure_change_pct: exposureChange,
      clicks,
      clicks_change_pct: clicksChange,
      ctr,
      ctr_change_pct: ctrChange,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function parseCompetitorSnapshot(rawText: string): ParseResult {
  const warnings: string[] = [];
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const category = parseCategoryHeaderFromLines(lines);
  const type = detectSnapshotType(rawText);

  // keywords / brands 페이지면 해당 파서 호출하고 반환
  if (type === 'keywords') {
    const topKeywords = parseTopKeywordsFromLines(lines);
    return {
      category,
      type,
      products: [],
      topKeywords,
      topBrands: [],
      warnings: topKeywords.length === 0 ? ['검색어 항목을 찾지 못했습니다.'] : [],
    };
  }
  if (type === 'brands') {
    const topBrands = parseTopBrandsFromLines(lines);
    return {
      category,
      type,
      products: [],
      topKeywords: [],
      topBrands,
      warnings: topBrands.length === 0 ? ['브랜드 항목을 찾지 못했습니다.'] : [],
    };
  }

  // 기본 (products) 흐름
  const anchors = findAnchors(lines);
  if (anchors.length === 0) {
    return {
      category,
      type,
      products: [],
      topKeywords: [],
      topBrands: [],
      warnings: ['텍스트에서 상품/키워드 마커를 찾지 못했습니다.'],
    };
  }

  const products: ParsedProduct[] = [];
  let currentProduct: ParsedProduct | null = null;
  let rankCounter = 0;

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const next = anchors[i + 1];
    const rangeEnd = next ? startOf(next) - 1 : lines.length - 1;
    const rangeStart = startOf(a);

    if (a.kind === 'product') {
      rankCounter += 1;
      const title = lines[a.titleIdx];

      const reviewIdx = findInRange(lines, rangeStart, rangeEnd, exact('상품평:'));
      const review = reviewIdx >= 0 ? parseReview(lines[reviewIdx + 1]) : { score: null, count: null };

      const isMyProduct =
        findInRange(lines, rangeStart, rangeEnd, exact('내 상품이 여기 속함')) >= 0;

      const exposureLabelIdx = findInRange(lines, rangeStart, rangeEnd, (l) => l === '검색어 노출');
      const clicksLabelIdx = findInRange(lines, rangeStart, rangeEnd, (l) => l === '클릭');
      const ctrLabelIdx = findInRange(lines, rangeStart, rangeEnd, (l) => /^클릭율\s*$/.test(l));
      const winnerLabelIdx = findInRange(lines, rangeStart, rangeEnd, (l) => /^아이템위너\s*$/.test(l));
      const priceRangeIdx = findInRange(lines, rangeStart, rangeEnd, (l) => /^가격범위\s*:/.test(l));

      const exposure = exposureLabelIdx > 0 ? parseKoreanNumber(lines[exposureLabelIdx - 1]) : null;
      const exposureChange =
        exposureLabelIdx >= 0 && exposureLabelIdx < rangeEnd
          ? parseChangePercent(lines[exposureLabelIdx + 1])
          : null;

      const clicks = clicksLabelIdx > 0 ? parseKoreanNumber(lines[clicksLabelIdx - 1]) : null;
      const clicksChange =
        clicksLabelIdx >= 0 && clicksLabelIdx < rangeEnd
          ? parseChangePercent(lines[clicksLabelIdx + 1])
          : null;

      const ctr = ctrLabelIdx > 0 ? parsePercent(lines[ctrLabelIdx - 1]) : null;
      const ctrChange =
        ctrLabelIdx >= 0 && ctrLabelIdx < rangeEnd ? parseChangePercent(lines[ctrLabelIdx + 1]) : null;

      const winnerPrice = winnerLabelIdx > 0 ? parseWon(lines[winnerLabelIdx - 1]) : null;
      const { min: priceMin, max: priceMax } = priceRangeIdx >= 0
        ? parsePriceRange(lines[priceRangeIdx])
        : { min: null, max: null };

      currentProduct = {
        rank: rankCounter,
        name: title,
        released_at: parseReleaseDate(lines[a.releasedIdx]),
        review_score: review.score,
        review_count: review.count,
        exposure,
        exposure_change_pct: exposureChange,
        clicks,
        clicks_change_pct: clicksChange,
        ctr,
        ctr_change_pct: ctrChange,
        winner_price: winnerPrice,
        price_min: priceMin,
        price_max: priceMax,
        is_my_product: isMyProduct,
        keywords: [],
      };
      products.push(currentProduct);
    } else {
      // keyword
      if (!currentProduct) {
        warnings.push(`상품 컨텍스트 없이 키워드 발견: ${lines[a.nameIdx]}`);
        continue;
      }
      const keywordName = lines[a.nameIdx];
      const contributingCount = parseContributingCount(lines[a.markerIdx]);

      const searchVolLabelIdx = findInRange(lines, rangeStart, rangeEnd, exact('검색량'));
      const exposureLabelIdx = findInRange(lines, rangeStart, rangeEnd, exact('검색어 노출'));
      const clicksLabelIdx = findInRange(lines, rangeStart, rangeEnd, exact('클릭'));
      const avgPriceLabelIdx = findInRange(lines, rangeStart, rangeEnd, exact('평균가격'));
      const priceRangeIdx = findInRange(lines, rangeStart, rangeEnd, (l) => /^가격범위\s*:/.test(l));

      const searchVolume = searchVolLabelIdx > 0 ? parseKoreanNumber(lines[searchVolLabelIdx - 1]) : null;
      const searchVolumeChange =
        searchVolLabelIdx >= 0 && searchVolLabelIdx < rangeEnd
          ? parseChangePercent(lines[searchVolLabelIdx + 1])
          : null;

      const exposure = exposureLabelIdx > 0 ? parseKoreanNumber(lines[exposureLabelIdx - 1]) : null;
      const exposureChange =
        exposureLabelIdx >= 0 && exposureLabelIdx < rangeEnd
          ? parseChangePercent(lines[exposureLabelIdx + 1])
          : null;

      const clicks = clicksLabelIdx > 0 ? parseKoreanNumber(lines[clicksLabelIdx - 1]) : null;
      const clicksChange =
        clicksLabelIdx >= 0 && clicksLabelIdx < rangeEnd
          ? parseChangePercent(lines[clicksLabelIdx + 1])
          : null;

      const avgPrice = avgPriceLabelIdx > 0 ? parseWon(lines[avgPriceLabelIdx - 1]) : null;
      const { min: priceMin, max: priceMax } = priceRangeIdx >= 0
        ? parsePriceRange(lines[priceRangeIdx])
        : { min: null, max: null };

      currentProduct.keywords.push({
        rank: currentProduct.keywords.length + 1,
        keyword: keywordName,
        contributing_count: contributingCount,
        search_volume: searchVolume,
        search_volume_change_pct: searchVolumeChange,
        exposure,
        exposure_change_pct: exposureChange,
        clicks,
        clicks_change_pct: clicksChange,
        avg_price: avgPrice,
        price_min: priceMin,
        price_max: priceMax,
      });
    }
  }

  return { category, type, products, topKeywords: [], topBrands: [], warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-paste: 한 입력에 여러 카테고리 결과가 이어붙어 있을 때 분리
// ─────────────────────────────────────────────────────────────────────────────

// trim 된 라인 단위에서 카테고리 헤더 패턴을 anchored 로 매치 (상품명에 "결과" 포함된 케이스 방어).
// '카테고리 결과' / '검색 결과' 두 가지 모두 인식 (쿠팡이 페이지에 따라 다른 라벨 사용).
const CATEGORY_HEADER_RE = /^["“'].+?["”']\s*(?:카테고리|검색)\s*결과\s*$/;

export type MultiParseResult = {
  results: ParseResult[];
  splitWarnings: string[]; // 잘못 헤더처럼 보이지만 실제는 아닌 chunk 등
};

// rawText 를 카테고리 헤더 라인 기준으로 분리. 헤더 다음 40줄 안에 'impression' 라벨이
// 있어야 valid 한 헤더로 인정 (false-positive 방지).
export function splitMultipleSnapshots(rawText: string): string[] {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const trimmed = lines.map((l) => l.trim());

  // 1) 후보 헤더 인덱스 수집
  const candidates: number[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (CATEGORY_HEADER_RE.test(trimmed[i])) candidates.push(i);
  }
  if (candidates.length === 0) return rawText.trim() ? [rawText] : [];

  // 2) 각 후보가 진짜 헤더인지 — 이후 40줄 내 'impression' 단독 라벨 라인 존재
  const valid: number[] = [];
  for (const ci of candidates) {
    const end = Math.min(ci + 40, trimmed.length);
    let found = false;
    for (let j = ci + 1; j < end; j++) {
      if (trimmed[j] === 'impression') { found = true; break; }
      // 다른 후보 헤더가 먼저 나오면 false (인접한 두 헤더 사이에 impression 없음)
      if (CATEGORY_HEADER_RE.test(trimmed[j])) break;
    }
    if (found) valid.push(ci);
  }

  if (valid.length === 0) return rawText.trim() ? [rawText] : [];
  if (valid.length === 1) return [rawText];

  // 3) valid 인덱스 사이를 잘라서 chunk 생성. 첫 chunk 의 시작은 첫 헤더부터 (헤더 앞의 잡 텍스트 무시).
  const chunks: string[] = [];
  for (let i = 0; i < valid.length; i++) {
    const start = valid[i];
    const end = i + 1 < valid.length ? valid[i + 1] : lines.length;
    chunks.push(lines.slice(start, end).join('\n'));
  }
  return chunks;
}

export function parseMultipleSnapshots(rawText: string): MultiParseResult {
  const splitWarnings: string[] = [];
  const chunks = splitMultipleSnapshots(rawText);
  if (chunks.length === 0) {
    return { results: [], splitWarnings: ['카테고리 헤더를 찾지 못했습니다.'] };
  }
  const results: ParseResult[] = [];
  for (let idx = 0; idx < chunks.length; idx++) {
    const r = parseCompetitorSnapshot(chunks[idx]);
    if (!r.category) {
      splitWarnings.push(`청크 ${idx + 1}: 카테고리 헤더 파싱 실패 — 건너뜀`);
      continue;
    }
    if (r.products.length === 0) {
      splitWarnings.push(`청크 ${idx + 1} (${r.category.category_name}): 상품 0건 — 건너뜀`);
      continue;
    }
    results.push(r);
  }
  return { results, splitWarnings };
}
