// 카테고리별 평가 차원 — analyze.py CATEGORY_DIMENSIONS 와 동기화.

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
  '구강세정기':    ['수압', '분사모드', '물통용량', '무게/휴대성', '방수/내구성', '충전/배터리', '노즐', '소음', 'A/S'],
  'default':       ['품질/마감', '사용감/효과', '내구성', '디자인', '가성비', '차별화'],
};

// Gemini 가 내는 category 문자열을 표준 키로 매핑. 키-in-cat / cat-in-키 만으로는 부족한 경우 대비.
const CATEGORY_KEY_ALIASES: Record<string, string[]> = {
  '구강세정기':    ['구강세정기', '구강용품', '샤워기', '워터픽', '치아'],
  '백팩':          ['백팩', '배낭'],
  '가방':          ['가방', '핸드백', '토트백', '숄더백', '크로스백'],
  '신발':          ['신발', '스니커즈', '운동화', '구두', '슬리퍼'],
  '의류':          ['의류', '티셔츠', '셔츠', '바지', '원피스', '자켓', '점퍼', '코트'],
  '화장품':        ['화장품', '메이크업', '립스틱', '파운데이션'],
  '스킨케어':      ['스킨케어', '토너', '에센스', '세럼', '크림', '로션', '클렌저'],
  '가전':          ['가전', '청소기', '공기청정기', '에어컨', '세탁기', '냉장고'],
  '주방용품':      ['주방', '냄비', '프라이팬', '도마', '조리도구'],
  '가구':          ['가구', '책상', '의자', '소파', '침대', '수납장'],
  '식품':          ['식품', '간식', '과자', '음료', '차', '커피'],
  '전자제품':      ['전자제품', '이어폰', '헤드폰', '키보드', '마우스', '충전기', '케이블'],
  '유아동':        ['유아', '아동', '아기', '유아동', '베이비'],
  '문구':          ['문구', '노트', '펜', '필기구', '다이어리'],
  '스포츠/레저':   ['스포츠', '레저', '운동', '헬스', '요가', '자전거'],
};

// 차원별 synonym — matchDimension 에서 canonical 당 키워드 목록으로 재활용
const DIMENSION_SYNONYMS: Record<string, string[]> = {
  // 구강세정기
  '수압': ['수압', '세정력', '세정', '맥동', '수류', '물살'],
  '분사모드': ['분사', '모드', '워터모드', '세정모드', '사용모드'],
  '물통용량': ['물통', '수통', '탱크', '용량', '저수통'],
  '무게/휴대성': ['무게', '중량', '휴대', '그립', '크기'],
  '방수/내구성': ['방수', '방진', '내구', '품질', '마감'],
  '충전/배터리': ['충전', '배터리', '사용시간', '지속시간', '완충'],
  '노즐': ['노즐', '팁'],
  '소음': ['소음', '데시벨', 'db'],
  'A/S': ['a/s', 'as', '보증', '애프터', '서비스', '워런티'],
  // 백팩
  '수납력': ['수납', '공간', '포켓'],
  '어깨끈/멜방감': ['어깨끈', '멜방', '스트랩', '끈길이'],
  '방수/방오': ['방수', '방오', '발수'],
  '내부구성': ['내부', '구성', '내장', '파티션'],
  '내구성/마감품질': ['내구', '마감', '품질', '튼튼', '견고'],
  '디자인/스타일': ['디자인', '스타일', '외관'],
  // 공통
  '가격대비가치': ['가성비', '가격대비', '가치', '비용효율'],
  '사용편의성': ['사용편의', '편의', '조작', '사용감'],
  '성능/효율': ['성능', '효율', '기능'],
  '착용감': ['착용', '착화', '핏'],
};

export function getCategoryDimensions(category: string | undefined | null): string[] {
  if (!category) return CATEGORY_DIMENSIONS.default;
  const cat = category.trim();

  // 1) 직접 매칭 (키-in-cat / cat-in-키)
  for (const key of Object.keys(CATEGORY_DIMENSIONS)) {
    if (key === 'default') continue;
    if (key === cat || key.includes(cat) || cat.includes(key)) return CATEGORY_DIMENSIONS[key];
  }

  // 2) alias 키워드 매칭 — 점수화 (긴 키워드 우선)
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_\-/·,()]/g, '');
  const catN = normalize(cat);
  let best: { key: string; score: number } | null = null;
  for (const [key, aliases] of Object.entries(CATEGORY_KEY_ALIASES)) {
    let score = 0;
    for (const a of aliases) {
      const aN = normalize(a);
      if (catN.includes(aN)) score += aN.length;
    }
    if (score > 0 && (best == null || score > best.score)) {
      best = { key, score };
    }
  }
  if (best) return CATEGORY_DIMENSIONS[best.key] || CATEGORY_DIMENSIONS.default;

  return CATEGORY_DIMENSIONS.default;
}

// 원본 차원명을 canonical 리스트에서 가장 잘 맞는 이름으로 매핑. 매칭 실패 시 null.
export function matchDimension(rawDim: string, canonicalList: string[]): string | null {
  if (!rawDim) return null;
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_\-/·,()]/g, '');
  const lower = normalize(rawDim);

  // 1) 정확 일치
  for (const c of canonicalList) {
    if (normalize(c) === lower) return c;
  }

  // 2) 양방향 포함 체크 (canonical 이 rawDim 에 포함 또는 그 반대)
  for (const c of canonicalList) {
    const cl = normalize(c);
    if (lower.includes(cl) || cl.includes(lower)) return c;
  }

  // 3) Synonym 매칭 — canonical 각각의 동의어 키워드가 rawDim 에 포함되면 점수
  let best: { c: string; score: number } | null = null;
  for (const c of canonicalList) {
    const synonyms = DIMENSION_SYNONYMS[c] || [];
    // canonical 자체의 토큰도 동의어에 추가 (공백/슬래시 분리)
    const canonicalTokens = c.split(/[/·\s,()]+/).map((t) => t.trim()).filter((t) => t.length >= 2);
    const pool = new Set<string>([...synonyms, ...canonicalTokens].map(normalize).filter((s) => s.length >= 2));

    let score = 0;
    for (const tk of pool) {
      if (lower.includes(tk)) score += tk.length;
    }
    if (score > 0 && (best == null || score > best.score)) {
      best = { c, score };
    }
  }
  return best?.c || null;
}
