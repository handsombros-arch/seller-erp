// 카테고리별 평가 차원 — analyze.py CATEGORY_DIMENSIONS 와 동기화 (소스 오브 트루스: 이 파일)
// 새 카테고리 추가 시 analyze.py CATEGORY_DIMENSIONS 도 함께 업데이트할 것.

export const CATEGORY_DIMENSIONS: Record<string, string[]> = {
  '백팩':          ['수납력', '무게', '내구성/마감품질', '디자인/스타일', '어깨끈/멜방감', '방수/방오', '내부구성', '가격대비가치'],
  '가방':          ['수납력', '무게', '내구성/마감품질', '디자인', '끈/손잡이', '방수성', '가격대비가치'],
  '지갑':          ['수납공간', '내구성', '디자인', '재질', '마감품질', '가격대비가치'],
  '신발':          ['착화감', '사이즈정확도', '내구성', '통기성', '디자인', '쿠셔닝', '가격대비가치'],
  '의류':          ['핏/사이즈', '소재/촉감', '신축성', '통기성/보온성', '디자인', '세탁/관리', '가격대비가치'],
  '화장품':        ['효과/효능', '자극성/안전성', '발림성/사용감', '향', '지속력', '용량/가성비', '패키지'],
  '스킨케어':      ['효과/효능', '피부적합성', '발림성', '흡수력', '지속력', '용량/가성비', '성분안전성'],
  '가전':          ['성능/효율', '소음', '전력소비', '사용편의성', '내구성', 'A/S', '디자인', '가격대비가치'],
  '주방용품':      ['내구성', '사용편의', '세척용이성', '재질안전성', '디자인', '수납성', '가격대비가치'],
  '가구':          ['조립난이도', '내구성', '사이즈정확도', '재료품질', '디자인', '마감', '가격대비가치'],
  '식품':          ['맛', '신선도', '양/중량', '포장상태', '보관편의', '원산지/안전', '가격대비가치'],
  '전자제품':      ['성능', '호환성', '배터리/지속시간', '발열', '디자인', '내구성', '사용편의', '가격대비가치'],
  '유아동':        ['안전성', '재질', '내구성', '기능성', '디자인', '사이즈', '가격대비가치'],
  '문구':          ['사용감', '내구성', '디자인', '기능성', '재질', '가격대비가치'],
  '스포츠/레저':   ['성능/기능성', '내구성', '착용감/사용감', '사이즈', '재질', '디자인', '가격대비가치'],
  '구강용품/샤워기': ['수압', '분사모드', '용량', '무게', '방수', '충전시간', '배터리'],
  'default':       ['품질/마감', '사용감/효과', '내구성', '디자인', '가성비', '차별화'],
};

export function getCategoryDimensions(category: string | undefined | null): string[] {
  if (!category) return CATEGORY_DIMENSIONS.default;
  const cat = category.trim();
  for (const key of Object.keys(CATEGORY_DIMENSIONS)) {
    if (key === 'default') continue;
    if (key.includes(cat) || cat.includes(key)) return CATEGORY_DIMENSIONS[key];
  }
  return CATEGORY_DIMENSIONS.default;
}

// 원본 차원명을 canonical 리스트에서 가장 잘 맞는 이름으로 매핑. 매칭 실패 시 null.
// - 공백/슬래시/괄호 무시하고 정확 일치 우선
// - 실패 시 canonical 이름 각 토큰이 rawDim 에 포함되면 점수화
export function matchDimension(rawDim: string, canonicalList: string[]): string | null {
  if (!rawDim) return null;
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_\-/·,()]/g, '');
  const lower = normalize(rawDim);

  // 1) 정확 일치
  for (const c of canonicalList) {
    if (normalize(c) === lower) return c;
  }

  // 2) 양방향 포함 체크
  for (const c of canonicalList) {
    const cl = normalize(c);
    if (lower.includes(cl) || cl.includes(lower)) return c;
  }

  // 3) 토큰 단위 매칭 (canonical 이름의 각 파트가 rawDim 에 포함되면 점수)
  let best: { c: string; score: number } | null = null;
  for (const c of canonicalList) {
    const tokens = c.split(/[/·\s,()]+/).map((t) => t.trim()).filter((t) => t.length >= 2);
    let score = 0;
    for (const t of tokens) {
      if (lower.includes(normalize(t))) score += t.length;
    }
    if (score > 0 && (best == null || score > best.score)) {
      best = { c, score };
    }
  }
  return best?.c || null;
}
