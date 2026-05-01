// 쿠팡 셀러 광고진단 페이지의 "TOP 20 경쟁상품 + 검색어 기여도" 텍스트를 파싱한다.
// 사용자가 페이지에서 텍스트를 통째로 복사해 붙여넣은 입력을 그대로 받는다.

export type ParsedKeyword = {
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

export type ParseResult = {
  products: ParsedProduct[];
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
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function parseCompetitorSnapshot(rawText: string): ParseResult {
  const warnings: string[] = [];
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const anchors = findAnchors(lines);
  if (anchors.length === 0) {
    return { products: [], warnings: ['텍스트에서 상품/키워드 마커를 찾지 못했습니다.'] };
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

  return { products, warnings };
}
