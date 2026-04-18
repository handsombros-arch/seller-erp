"""소싱 분석: 상세이미지 OCR + 리뷰 요약 (Gemini Flash).

Usage:
  python sourcing/analyze.py <crawl_result.json>
  python sourcing/analyze.py results/coupang-8797348708-*-full.json

출력: results/{base}-analysis.json
"""
import os
import re
import sys
import json
import time
import requests
from io import BytesIO
from pathlib import Path

_MEANINGFUL_CHAR_RE = re.compile(r"[가-힣a-zA-Z0-9]")


def count_meaningful_chars(text) -> int:
    """한글 음절 + 영문 + 숫자 개수. 이모지/이모티콘/자음만/반복기호/공백 제외."""
    if not text:
        return 0
    return len(_MEANINGFUL_CHAR_RE.findall(str(text)))

if os.name == "nt":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except: pass

import google.generativeai as genai
from PIL import Image

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"

# .env.local 로드
env_path = ROOT.parent / ".env.local"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

# 여러 키 지원: GEMINI_API_KEYS=key1,key2,key3 (콤마 구분) 또는 GEMINI_API_KEY (단일)
_keys_env = os.environ.get("GEMINI_API_KEYS") or os.environ.get("GEMINI_API_KEY") or ""
API_KEYS = [k.strip() for k in _keys_env.split(",") if k.strip()]
if not API_KEYS:
    print("[!] GEMINI_API_KEY(S) 없음. .env.local 확인.")
    sys.exit(1)

# 라운드 로빈 인덱스 (전역)
_key_idx = 0

def _next_key():
    global _key_idx
    k = API_KEYS[_key_idx % len(API_KEYS)]
    _key_idx += 1
    return k

# 초기 키 설정
genai.configure(api_key=API_KEYS[0])
print(f"[gemini] {len(API_KEYS)}개 키 로드됨")


# gemini-2.0-flash: 무료 1500/일. 소진 시 2.5 계열로 폴백.
MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
FALLBACK_MODELS = ["gemini-2.0-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"]


def _parse_retry_delay(err_str: str) -> int:
    import re
    m = re.search(r"retry_delay\s*\{[^}]*seconds:\s*(\d+)", err_str)
    return int(m.group(1)) if m else 0


def _is_per_day_exceeded(err_str: str) -> bool:
    return "PerDay" in err_str


def _gen_with_fallback(content, generation_config, max_retries: int = 2):
    """우선순위:
    1) PerDay 한도 → 다른 키로 즉시 전환 (모델 동일)
    2) PerMinute 한도 → retry_delay 만큼 sleep 후 재시도 (같은 키)
    3) 모든 키가 PerDay 한도 → 다음 모델로
    """
    import time as _time
    models_to_try = [MODEL] + FALLBACK_MODELS
    last_err = None

    for m_name in models_to_try:
        # 모든 키를 한 번씩 시도
        keys_per_day_exhausted = set()
        for key_attempt in range(len(API_KEYS) * 2):  # 각 키 최대 2회
            current_key = _next_key()
            if current_key in keys_per_day_exhausted:
                continue
            try:
                genai.configure(api_key=current_key)
                model = genai.GenerativeModel(m_name)
                resp = model.generate_content(content, generation_config=generation_config)
                return resp, m_name
            except Exception as e:
                err_str = str(e)
                last_err = e
                is_quota = "429" in err_str or "quota" in err_str.lower()
                if not is_quota:
                    raise
                if _is_per_day_exceeded(err_str):
                    keys_per_day_exhausted.add(current_key)
                    key_short = current_key[:12] + "..."
                    print(f"     [{m_name}/{key_short}] 일일 한도 — 다음 키 시도 (남은 키 {len(API_KEYS) - len(keys_per_day_exhausted)})")
                    if len(keys_per_day_exhausted) >= len(API_KEYS):
                        print(f"     [{m_name}] 모든 키 일일 한도 — 다음 모델")
                        break
                    continue
                # 분당 한도: 대기 + 재시도
                delay = _parse_retry_delay(err_str)
                if delay > 0:
                    delay = min(delay + 2, 90)
                    print(f"     [{m_name}] 분당 한도 — {delay}s 대기 후 재시도")
                    _time.sleep(delay)
                    continue
                # 알 수 없는 quota 에러 → 다음 키
                continue
    raise last_err if last_err else RuntimeError("all models/keys exhausted")
MAX_DETAIL_IMAGES = int(os.environ.get("MAX_DETAIL_IMAGES", "6"))
MAX_REVIEW_TEXT_CHARS = int(os.environ.get("MAX_REVIEW_TEXT_CHARS", "30000"))
MAX_REVIEW_SAMPLE = int(os.environ.get("MAX_REVIEW_SAMPLE", "100"))


def download_image(url: str, max_bytes: int = 5_000_000) -> bytes | None:
    if url.startswith("//"):
        url = "https:" + url
    elif url.startswith("/"):
        url = "https://www.coupang.com" + url
    try:
        r = requests.get(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://www.coupang.com/",
        })
        if r.status_code != 200:
            return None
        if len(r.content) > max_bytes:
            return None
        return r.content
    except Exception:
        return None


def to_pil(data: bytes) -> Image.Image | None:
    try:
        img = Image.open(BytesIO(data))
        # 너무 크면 축소 (Gemini 비용/시간 절약)
        if max(img.size) > 1500:
            img.thumbnail((1500, 1500))
        return img.convert("RGB")
    except Exception:
        return None


def analyze_detail_images(images: list[Image.Image], product_title: str | None) -> dict:
    """상세이미지 OCR + 카테고리 식별 + 스펙 추출 (Pass 1)"""
    if not images:
        return {"error": "no images"}

    prompt = f"""당신은 한국 이커머스 상품 분석 전문가입니다.
아래는 한 상품의 상세페이지 이미지들입니다 ({len(images)}장).
{f'상품명: {product_title}' if product_title else ''}

이미지의 모든 텍스트를 OCR로 읽고, 단순 나열이 아닌 **구조화된 JSON**으로 출력하세요. raw JSON만 (코드블록 X).

{{
  "category_path": "대분류 > 중분류 > 소분류 (예: 패션잡화 > 가방 > 백팩)",
  "category": "최종 카테고리 (예: 백팩)",
  "category_norm": "표준 카테고리 (coupang/네이버 분류 기준)",
  "specs": {{
    "_instruction": "**모든 카테고리 핵심 스펙을 1차로 모두 추출**. 8~20개. 각 항목 한 줄 (줄글 금지). **반드시 아래 표준 키 어휘 사전 사용**. 다른 상품과 비교 시 같은 키여야 묶이므로 **표준 키 외 임의 작명 금지**. 표준 키에 없는 카테고리 고유 스펙만 새 키 사용 (그것도 가급적 짧고 일관되게).",
    "_canonical_keys": {{
      "물리": ["무게", "크기", "부피", "색상", "재질"],
      "용량/성능": ["용량", "전력", "전압", "출력", "속도", "RPM", "PPM"],
      "전기/소음": ["소음", "에너지등급", "배터리", "충전시간"],
      "구조": ["수납포켓", "노트북칸", "끈길이", "내하중"],
      "기능": ["방수", "방오", "방진", "내열", "내충격"],
      "성분/품질": ["주성분", "원산지", "보증", "인증", "유통기한"],
      "스타일": ["디자인", "패턴", "스타일"]
    }},
    "_canonical_synonyms": {{
      "무게": ["중량", "weight"],
      "크기": ["사이즈", "치수", "dimensions"],
      "용량": ["capacity", "수용량", "내부용량"],
      "재질": ["소재", "material"],
      "색상": ["컬러", "color"],
      "소음": ["소음도", "dB", "데시벨"],
      "전력": ["소비전력", "전력소비"],
      "수압": ["맥동수", "분사횟수"]
    }},
    "_examples_by_category": {{
      "백팩": ["재질", "크기", "무게", "색상", "용량", "노트북칸", "끈길이", "수납포켓", "방수", "원산지"],
      "화장품": ["용량", "주성분", "피부타입", "사용시간", "향", "PH", "제형", "원산지", "유통기한", "유효성분"],
      "가전": ["전력", "크기", "무게", "전압", "소음", "에너지등급", "보증", "원산지"],
      "구강용품/샤워기": ["수압", "분사모드", "용량", "무게", "방수", "충전시간", "배터리"],
      "의류": ["재질", "사이즈", "색상", "신축성", "세탁법", "안감", "원산지", "촉감"],
      "가구": ["크기", "재질", "내하중", "조립", "마감", "보증", "원산지"]
    }},
    "재질": "예: 폴리에스터 100% (없으면 키 생략)",
    "크기": "예: 30 x 40 x 12 cm",
    "무게": "예: 400g"
  }},
  "claims": [
    {{"claim": "셀러가 페이지에서 주장하는 단일 명제 (예: 400g 초경량)", "evidence_in_page": "이미지에서 본 근거 텍스트", "verifiable": true/false}}
  ],
  "selling_points_ranked": ["페이지에서 강조 빈도 높은 순으로 셀링포인트 3~7개"],
  "target_demographics": {{
    "primary": {{"who": "주 타겟 (예: 20~30대 직장인 여성)", "evidence": "이 타겟이라 판단한 페이지 근거 (모델/문구/디자인/가격대 등)"}},
    "secondary": [{{"who": "추가 타겟", "evidence": "근거"}}],
    "use_cases_implied": ["페이지에서 암시되는 사용 시나리오 2~5개"]
  }},
  "competitor_positioning": "페이지에서 다른 상품과 구분 지으려는 차별 포인트",
  "warranty_returns": "AS/반품/교환 정책 언급 (없으면 null)",
  "package_includes": ["구성품 (없으면 빈 배열)"],
  "page_quality_signals": {{
    "has_real_photos": true/false,
    "has_size_chart": true/false,
    "has_material_certificate": true/false,
    "has_video": true/false,
    "professional_design": "high/medium/low"
  }},
  "image_summary": "상세페이지가 강조하는 핵심 메시지 한 문단"
}}
"""
    try:
        resp, _used_model = _gen_with_fallback([prompt, *images], {"temperature": 0.2, "response_mime_type": "application/json"})
        return json.loads(resp.text)
    except Exception as e:
        return {"error": str(e), "raw": getattr(resp, "text", None) if 'resp' in dir() else None}


# 카테고리별 평가 차원 (한국 이커머스 기준)
CATEGORY_DIMENSIONS = {
    "백팩": ["수납력", "무게", "내구성/마감품질", "디자인/스타일", "어깨끈/멜방감", "방수/방오", "내부구성", "가격대비가치"],
    "가방": ["수납력", "무게", "내구성/마감품질", "디자인", "끈/손잡이", "방수성", "가격대비가치"],
    "지갑": ["수납공간", "내구성", "디자인", "재질", "마감품질", "가격대비가치"],
    "신발": ["착화감", "사이즈정확도", "내구성", "통기성", "디자인", "쿠셔닝", "가격대비가치"],
    "의류": ["핏/사이즈", "소재/촉감", "신축성", "통기성/보온성", "디자인", "세탁/관리", "가격대비가치"],
    "화장품": ["효과/효능", "자극성/안전성", "발림성/사용감", "향", "지속력", "용량/가성비", "패키지"],
    "스킨케어": ["효과/효능", "피부적합성", "발림성", "흡수력", "지속력", "용량/가성비", "성분안전성"],
    "가전": ["성능/효율", "소음", "전력소비", "사용편의성", "내구성", "A/S", "디자인", "가격대비가치"],
    "주방용품": ["내구성", "사용편의", "세척용이성", "재질안전성", "디자인", "수납성", "가격대비가치"],
    "가구": ["조립난이도", "내구성", "사이즈정확도", "재료품질", "디자인", "마감", "가격대비가치"],
    "식품": ["맛", "신선도", "양/중량", "포장상태", "보관편의", "원산지/안전", "가격대비가치"],
    "전자제품": ["성능", "호환성", "배터리/지속시간", "발열", "디자인", "내구성", "사용편의", "가격대비가치"],
    "유아동": ["안전성", "재질", "내구성", "기능성", "디자인", "사이즈", "가격대비가치"],
    "문구": ["사용감", "내구성", "디자인", "기능성", "재질", "가격대비가치"],
    "스포츠/레저": ["성능/기능성", "내구성", "착용감/사용감", "사이즈", "재질", "디자인", "가격대비가치"],
    "default": ["품질/마감", "사용감/효과", "내구성", "디자인", "가성비", "차별화"]
}


def get_category_dimensions(category: str | None) -> list[str]:
    if not category: return CATEGORY_DIMENSIONS["default"]
    cat = category.strip()
    for key in CATEGORY_DIMENSIONS:
        if key in cat or cat in key:
            return CATEGORY_DIMENSIONS[key]
    return CATEGORY_DIMENSIONS["default"]


def analyze_inquiries(inquiries: list[dict], product_title: str | None) -> dict:
    """상품문의 분석 — 진짜 불편/소싱포인트 추출"""
    if not inquiries:
        return {"error": "no inquiries"}

    chunks = []
    for q in inquiries[:200]:
        if not q.get("question"): continue
        cat = q.get("category", "")
        cat_str = f"[{cat}] " if cat else ""
        question = (q.get("question") or "")[:300]
        detail = (q.get("questionDetail") or "")[:300]
        answer = (q.get("answer") or "")[:300]
        chunks.append(f"{cat_str}Q: {question}\n   상세: {detail}\n   A: {answer if answer else '미답변'}")
    text = "\n\n".join(chunks)
    if len(text) > MAX_REVIEW_TEXT_CHARS:
        text = text[:MAX_REVIEW_TEXT_CHARS] + "\n...(생략)"

    answered = sum(1 for q in inquiries if q.get("isAnswered"))
    answer_rate = round(answered / len(inquiries) * 100, 1) if inquiries else 0

    prompt = f"""당신은 한국 이커머스 소싱 전문가입니다.
상품: {product_title or '(제목없음)'}
총 {len(inquiries)} 상품문의 / 답변률 {answer_rate}%

상품문의는 리뷰와 달리:
- 가구매/조작이 거의 불가능 (구매 전 질문 가능)
- 진짜 구매 검토자/구매자의 실제 궁금증, 불편, 우려 노출
- 셀러 응답 품질도 중요 신호

raw JSON만 출력 (코드블록 X):

{{
  "summary": "상품문의 종합 요약 2~3문장",
  "answer_rate_pct": {answer_rate},
  "answer_quality": "셀러 답변 품질 평가 (성실/보통/불성실 + 근거)",
  "top_concerns": [
    {{"concern": "고객이 자주 묻는 우려사항/불편", "frequency": "many/some/few", "category": "사이즈/재질/배송/품질/사용법/AS/등", "implies_unclear_in_page": true/false}}
  ],
  "page_information_gaps": [
    "상품문의로 드러난 페이지에서 빠진 정보 (셀러가 추가해야 할 것)"
  ],
  "hidden_issues_revealed": [
    "리뷰에선 안 보이지만 문의에서 드러난 잠재 문제"
  ],
  "sourcing_insights": [
    {{"insight": "소싱 시 활용 가능한 인사이트", "category": "차별화/리스크/페이지보강/AS강화/기타", "actionable": "구체 행동"}}
  ],
  "category_distribution": [
    {{"category": "문의 카테고리 (예: 사이즈, 색상, 배송)", "count_estimate": "건수 추정", "examples": ["대표 질문 1~2개"]}}
  ],
  "unanswered_topics": ["답변 안 된 미답변 문의 주제 (있으면)"]
}}

[상품문의 데이터]
{text}
"""
    try:
        resp, _used_model = _gen_with_fallback(prompt, {"temperature": 0.25, "response_mime_type": "application/json"})
        return json.loads(resp.text)
    except Exception as e:
        return {"error": str(e), "raw": getattr(resp, "text", None) if 'resp' in dir() else None}


MIN_MEANINGFUL_CHARS = int(os.environ.get("MIN_MEANINGFUL_CHARS", "20"))


def select_representative_reviews(reviews: list[dict], target_count: int = 200) -> tuple[list[dict], dict]:
    """객관성 있는 리뷰 샘플링.
    - 의미있는 문자(한글/영문/숫자) 20자 미만 제외 — 이모지/이모티콘/반복기호 등 가구매 신호 필터
    - 별점별 비례 샘플링 (부정 가중)
    - 각 별점 내 도움됨 순
    Returns: (selected_reviews, sampling_info)
    """
    # 1) 필터: 의미있는 문자가 MIN_MEANINGFUL_CHARS 이상
    filtered = [r for r in reviews if count_meaningful_chars(r.get("text")) >= MIN_MEANINGFUL_CHARS]

    # 2) 별점별 분류
    by_rating: dict[int, list[dict]] = {1: [], 2: [], 3: [], 4: [], 5: []}
    for r in filtered:
        try:
            rating = int(round(float(r.get("rating") or 0)))
            if rating in by_rating: by_rating[rating].append(r)
        except (ValueError, TypeError):
            pass

    # 3) 각 별점 내에서 도움됨 순 정렬
    for k in by_rating:
        by_rating[k].sort(key=lambda r: int(r.get("helpful") or 0), reverse=True)

    # 4) 부정 가중 비례 샘플링 (가구매는 5★ 비중 낮춤)
    quotas = {5: 0.30, 4: 0.15, 3: 0.15, 2: 0.15, 1: 0.25}
    selected: list[dict] = []
    actual_dist: dict[int, int] = {}
    for rating, ratio in quotas.items():
        n = max(1, int(target_count * ratio))
        picked = by_rating[rating][:n]
        selected.extend(picked)
        actual_dist[rating] = len(picked)

    # 5) 부족분: 전체에서 도움됨 순으로 보충
    if len(selected) < target_count:
        seen_ids = {id(r) for r in selected}
        rest = [r for r in filtered if id(r) not in seen_ids]
        rest.sort(key=lambda r: int(r.get("helpful") or 0), reverse=True)
        for r in rest[: target_count - len(selected)]:
            selected.append(r)
            try:
                rating = int(round(float(r.get("rating") or 0)))
                actual_dist[rating] = actual_dist.get(rating, 0) + 1
            except (ValueError, TypeError):
                pass

    sampling_info = {
        "total_reviews": len(reviews),
        "filtered_by_meaningful_chars": len(reviews) - len(filtered),
        "min_meaningful_chars": MIN_MEANINGFUL_CHARS,
        "selected_count": len(selected),
        "selection_strategy": "의미있는 문자 필터 + 별점별 비례 (부정 가중) + 각 별점 내 도움됨순",
        "negative_weight": "1~3★ 비중 55% (가구매 보정)",
        "rating_distribution_in_sample": actual_dist,
    }
    return selected, sampling_info


def analyze_combined(detail_analysis: dict, reviews: list[dict], product_title: str | None, stats: dict) -> dict:
    """카테고리별 차원으로 페이지+리뷰 교차 분석 (Pass 3)"""
    category = detail_analysis.get("category") or "기타"
    dimensions = get_category_dimensions(category)

    # 객관성 있는 샘플링 (토큰 절약 위해 기본 100개)
    selected_reviews, sampling_info = select_representative_reviews(reviews, target_count=MAX_REVIEW_SAMPLE)

    chunks = []
    for r in selected_reviews:
        rating = r.get("rating", "?")
        helpful = r.get("helpful") or 0
        helpful_str = f" 👍{helpful}" if helpful > 0 else ""
        chunks.append(f"[{rating}★{helpful_str}] {r['text'][:400]}")
    review_text = "\n".join(chunks)
    if len(review_text) > MAX_REVIEW_TEXT_CHARS:
        review_text = review_text[:MAX_REVIEW_TEXT_CHARS] + "\n...(생략)"

    claims_str = json.dumps(detail_analysis.get("claims", []), ensure_ascii=False)[:3000]
    selling_points_str = json.dumps(detail_analysis.get("selling_points_ranked", []), ensure_ascii=False)[:1500]
    # 스펙 (차원 평가의 객관적 근거)
    specs_clean = {k: v for k, v in (detail_analysis.get("specs") or {}).items() if not k.startswith("_") and v}
    specs_str = json.dumps(specs_clean, ensure_ascii=False)[:2000]

    prompt = f"""당신은 한국 이커머스 소싱 전문 분석가입니다. 단순 나열이 아닌 **카테고리 표준 대비 평가**를 수행합니다.

[등급 기준 - 일관된 적용]

⚠️ 한국 이커머스 (특히 쿠팡) 리뷰 편향 보정:
- **가구매/체험단/쿠팡캐시 보상 리뷰가 30~50%로 추정** → 5★ 단순 칭찬은 비중 줄여서 평가
- **부정 리뷰는 진짜 구매자일 가능성이 압도적으로 높음** → 1~3★ 리뷰는 가중치 높여 평가
- "잘 받았어요", "빠른 배송", "선물용" 같은 무내용 5★는 신뢰도 낮음
- 단점은 **실제보다 더 중대하게** 보일 수 있다고 가정 (보수적으로 평가)

frequency (언급 빈도):
- 많음: 전체 리뷰 중 25% 이상에서 언급 (단점은 15%만 되어도 많음으로 처리)
- 보통: 10~25%
- 적음: 10% 미만

severity (단점 심각도) — **단점은 한 단계 더 엄격하게**:
- 치명적: 환불/반품/교환 사유, 기본 기능 실패, 안전/위생 문제, 사이즈 큰 차이, 부풀려 광고
- 심각: 만족도 크게 깎음, 재구매 막을 수준, 마감 불량 / 색상 차이 / 내구성 문제
- 경미: 사용엔 지장 없는 호불호 (예: 향이 강함, 색이 약간 다름) — **단순 호불호만 경미**

fixable: 셀러가 검수/QC/소재 변경 등으로 개선 가능하면 true, 제품 본질 문제면 false

[시장 신호 등급 기준]
demand_strength (수요 강도):
- high: 리뷰 500+, 평점 4.3+, 최근 리뷰 활발, "재구매" 언급 다수
- medium: 리뷰 100~500, 평점 4.0~4.3
- low: 리뷰 100 미만 또는 평점 4.0 미만

saturation_risk (시장 포화도 — 경쟁 위험):
- high: 리뷰에 "다른 ○○도 써봤는데" 비교 언급 30%+, 동일 카테고리 대안 많이 언급
- medium: 비교 언급 10~30%
- low: 비교 거의 없음, 독자적 포지션

price_position (가격대):
- premium: 카테고리 평균보다 +30%↑, 프리미엄 소재/브랜드 강조
- mid: 카테고리 평균 ±30% 내, 가성비 + 적당한 품질
- budget: 카테고리 평균보다 -30%↓, 가성비 위주, 저가 소재

trend_durability (트렌드 지속성):
- trending: 최근 3개월 리뷰 급증, 시즌 영향 X, 신규 검색량 증가 예상
- stable: 일정 페이스로 리뷰 들어옴, 기본 수요 유지
- declining: 리뷰 감소, 시즌 끝남, 트렌드 노후

[입력 데이터]
상품: {product_title or '(제목없음)'}
카테고리: {category}
리뷰 통계: 총 {stats.get('total', len(reviews))}개 / 평균 {stats.get('avgRating')}★ / 분포 {stats.get('ratingDist')}

⚠️ 샘플링 정보 (객관성 보정):
- 전체 {sampling_info['total_reviews']}개 리뷰 중 {sampling_info['selected_count']}개를 분석에 사용
- 무의미 리뷰 ({sampling_info['filtered_by_meaningful_chars']}개 < {sampling_info['min_meaningful_chars']}자 유의미 문자) 제외 (이모지/이모티콘/반복기호 필터)
- 별점별 비례 + 부정 가중 (1~3★ 55% 비중) — 가구매 보정
- 샘플 분포: {sampling_info['rating_distribution_in_sample']}
- 각 리뷰 옆 👍N = 도움됨 수 (높을수록 진짜 구매자 공감)
- 분석 시 이 샘플링 가중치를 반영해 결론 도출

[페이지 추출 스펙 (차원 평가 객관 근거)]
{specs_str}
→ 이 스펙들을 **각 차원 점수의 1차 근거로 우선 사용**.
   예: "무게=400g" → "무게" 차원에 직접 반영
       "용량=12L" → "수납력" 차원에 직접 반영
       "재질=풀그레인 가죽" → "내구성/마감품질" 차원에 직접 반영
       "방수=IPX7" → "방수/방오" 차원에 직접 반영

[셀러가 페이지에서 주장한 내용]
{claims_str}

[페이지 셀링포인트 순위]
{selling_points_str}

[고객 리뷰 (전체)]
{review_text}

위 정보를 바탕으로 **{category}** 카테고리의 표준 평가 차원으로 점수화하세요.

⚠️ **차원명 엄격 규칙 (매우 중요 — 상품 간 비교를 위해)**:
- `dimension` 필드는 반드시 아래 표준 리스트에서 **한 글자도 변경 없이 그대로** 사용.
- 표준 리스트: {dimensions}
- "수압" → "수압 강도 및 조절" (X). "수압" (O).
- "디자인" → "디자인/그립감" (X). "디자인" (O).
- 위 리스트에 없는 차원을 추가로 평가하고 싶으면 맨 끝에만 추가. 기존 표준명 변형은 절대 금지.
- 동일 카테고리 모든 상품이 동일 `dimension` 문자열을 공유해야 비교 가능함.

**원칙: 1) 페이지 스펙(객관 사양) 2) 셀러 주장 3) 리뷰 검증**의 3중 교차로 평가.
스펙에 명시된 값은 차원의 직접 증거로 사용하고, 리뷰가 그 스펙을 검증/반박하는지 함께 평가.
각 차원: 0~10점 + 근거.

raw JSON만 출력 (코드블록 X):
{{
  "summary_one_line": "이 상품 한 문장 평가",
  "summary_paragraph": "3~5문장 종합 평가",
  "neutral_score": 7.2,
  "neutral_score_reasoning": "왜 이 점수인지 (별점에 휘둘리지 않은 종합 0~10점)",
  "sentiment_breakdown": {{
    "positive_pct": 75,
    "neutral_pct": 18,
    "negative_pct": 7,
    "notes": "감성 분포 한 줄 설명"
  }},
  "review_topic_frequency": [
    {{"topic": "디자인", "mention_count": 45, "mention_pct": 35, "sentiment": "positive/mixed/negative", "key_quotes": ["1~2개 인용"]}}
  ],
  "meaningful_keywords": [
    {{
      "keyword": "리뷰 본문에 자주 등장한 **구체 단어/구**. '좋아요' 같은 범용 형용사 금지. 소싱 시 시그널 되는 단어만 (예: 초경량, A4수납, 어깨편함, 냄새없음, 박음질불량, 지퍼뻑뻑, 색상다름, 배송빠름, 재구매의사)",
      "mention_count": "추정 언급 횟수 (정수)",
      "category": "품질/디자인/사용감/배송/가격/소재/사이즈/AS/비교/기타 중 택1",
      "sentiment": "positive/negative/neutral",
      "key_quotes": ["대표 인용 1~2개 (원문 그대로 짧게)"]
    }}
  ],
  "_keywords_instruction": "15~30개, mention_count 내림차순 정렬, 중복 의미 금지. 각 키워드는 category와 sentiment가 일관되게 매칭되도록.",
  "category_dimensions_scored": [
    {{
      "dimension": "차원명 (예: 수납력)",
      "score": 8,
      "spec_evidence": "이 차원에 해당하는 페이지 스펙 값 (예: 무게=400g, 용량=12L). 스펙에 없으면 null",
      "page_claim": "페이지가 주장한 내용 (없으면 null)",
      "review_consensus": "리뷰 다수 의견 (예: many/some/few/none + 핵심 인용)",
      "verdict": "강점/보통/약점/숨겨진단점/과대광고",
      "evidence": "구체 근거 1~2문장 (스펙 + 리뷰 종합)"
    }}
  ],
  "pros_ranked": [
    {{"point": "장점", "frequency": "많음/보통/적음", "frequency_pct": "전체 리뷰 중 언급 비율 추정 (예: 45%)", "category_significance": "이 카테고리에서 얼마나 중요한지"}}
  ],
  "cons_ranked": [
    {{"point": "단점", "frequency": "많음/보통/적음", "frequency_pct": "전체 리뷰 중 언급 비율 추정 (예: 25%)", "severity": "치명적/심각/경미", "severity_reason": "이 등급 부여 이유", "fixable": true/false}}
  ],
  "neutral_observations": [
    "긍정도 부정도 아닌 중립적 관찰 (예: 사이즈가 작아서 사람마다 호불호 갈림)"
  ],
  "improvements_needed": [
    {{"area": "보완 영역", "current_state": "현재 상황", "suggested_change": "구체 개선안", "priority": "high/medium/low", "impact_estimate": "개선 시 예상 효과"}}
  ],
  "hidden_weaknesses": [
    {{"issue": "페이지엔 안 나오지만 리뷰에서 자주 언급되는 단점", "review_count_estimate": "리뷰 중 언급 비율"}}
  ],
  "overpromised_claims": [
    {{"claim": "페이지가 주장하지만 리뷰에서 부정/실망 다수", "review_evidence": "..."}}
  ],
  "differentiation_points": [
    {{"point": "동일 카테고리 다른 상품 대비 차별점", "from_page": true/false, "from_reviews": true/false}}
  ],
  "solvable_pain_points": [
    {{
      "issue": "고객 불만 (해결 가능한)",
      "frequency": "many/some/few",
      "root_cause": "원인 추정",
      "improvement_idea": "셀러 입장에서 차별화/개선 아이디어",
      "differentiation_score": "0~10 (시장에서 차별화 효과)"
    }}
  ],
  "page_intended_targets": [
    {{"who": "페이지가 의도한 타겟", "evidence": "페이지 근거 (모델/문구/디자인)"}}
  ],
  "actual_buyer_targets": [
    {{"who": "실제 리뷰에 나타난 구매자 그룹", "evidence": "리뷰 근거 (자칭/사용맥락/언급)", "review_count_estimate": "전체 리뷰 중 비율 추정"}}
  ],
  "target_match_analysis": "페이지 의도 타겟과 실제 구매자가 얼마나 일치하는지 1~2문장",
  "buyer_personas": [
    {{"persona": "구매자 페르소나 (구체적)", "buying_motivation": "주 구매 동기", "satisfaction_expected": "예상 만족도", "source": "페이지/리뷰/둘다"}}
  ],
  "use_case_distribution": [
    {{"use_case": "용도", "percentage_estimate": "리뷰 기반 추정 비율"}}
  ],
  "options_feedback": [
    {{"option_type": "색상/사이즈/디자인 등", "feedback": "리뷰 종합", "issues": "있으면 명시"}}
  ],
  "competitor_mentions": ["다른 브랜드/제품 비교 언급 (없으면 빈 배열)"],
  "market_signals": {{
    "demand_strength": "high/medium/low",
    "demand_strength_reason": "예: 리뷰 1500개+, 평점 4.5★+, 재구매 언급 다수",
    "saturation_risk": "high/medium/low",
    "saturation_risk_reason": "예: 동일 카테고리 비교 언급 많음 → 경쟁 치열",
    "price_position": "premium/mid/budget",
    "price_position_reason": "예: 카테고리 평균 대비 +30%, 프리미엄 소재 강조",
    "trend_durability": "trending/stable/declining",
    "trend_durability_reason": "예: 최근 리뷰 증가/일정/감소, 시즌성"
  }},
  "sourcing_decision": {{
    "verdict": "good_to_source / risky / avoid",
    "confidence": "high/medium/low",
    "primary_reasoning": "핵심 근거",
    "key_risks": ["리스크 1~3개"],
    "recommended_actions": ["소싱 시 권장 조치 1~3개 (예: 색상별 검수, 자재 변경 등)"],
    "differentiation_strategy": "이 상품을 소싱하면서 어떻게 차별화할지 1문장"
  }}
}}
"""
    try:
        resp, _used_model = _gen_with_fallback(prompt, {"temperature": 0.25, "response_mime_type": "application/json"})
        result = json.loads(resp.text)
        result["_category_dimensions_used"] = dimensions
        result["_sampling_info"] = sampling_info
        return result
    except Exception as e:
        return {"error": str(e), "raw": getattr(resp, "text", None) if 'resp' in dir() else None, "_sampling_info": sampling_info}


def analyze_reviews(reviews: list[dict], product_title: str | None, stats: dict) -> dict:
    """리뷰에서 장점/단점/해결포인트 추출"""
    if not reviews:
        return {"error": "no reviews"}

    # 리뷰 텍스트 단순화 (rating + text + survey)
    chunks = []
    for r in reviews:
        if not r.get("text"): continue
        rating = r.get("rating", "?")
        survey = r.get("survey") or []
        survey_str = " | ".join(f"{s.get('q')}={s.get('a')}" for s in survey if isinstance(s, dict))
        chunk = f"[{rating}★] {r['text'][:600]}"
        if survey_str:
            chunk += f"\n  설문: {survey_str}"
        chunks.append(chunk)
    full_text = "\n\n".join(chunks)
    if len(full_text) > MAX_REVIEW_TEXT_CHARS:
        full_text = full_text[:MAX_REVIEW_TEXT_CHARS] + "\n...(이하 생략)"

    prompt = f"""당신은 이커머스 상품 리뷰 분석가입니다.
{f'상품: {product_title}' if product_title else ''}
총 {stats.get('total', len(reviews))}개 리뷰 / 평균 {stats.get('avgRating')}★ / 별점분포 {stats.get('ratingDist')}

아래 리뷰들을 분석해서 **JSON만** 출력하세요 (raw JSON, 코드블록 없이).

{{
  "summary": "전체 리뷰의 핵심을 3~5문장으로 요약",
  "pros": ["고객이 자주 언급한 장점 5~10개 (구체적으로)"],
  "cons": ["고객이 자주 언급한 단점 3~10개 (구체적으로)"],
  "solvable_pain_points": [
    {{"issue": "해결 가능한 불만/문제점", "frequency": "many/some/few", "suggestion": "개선 또는 차별화 방안"}}
  ],
  "common_use_cases": ["고객이 사용하는 주요 용도 3~5개"],
  "buyer_personas": ["주요 구매 고객 페르소나 2~4개"],
  "competitor_comparison_mentions": ["다른 제품과 비교하며 언급된 내용 0~5개"],
  "options_quality_feedback": {{"색상": "...", "사이즈": "...", "디자인": "..."}},
  "sourcing_decision": {{
    "verdict": "good_to_source / risky / avoid 중 하나",
    "reasoning": "근거 설명"
  }}
}}

리뷰 데이터:
{full_text}
"""
    try:
        resp, _used_model = _gen_with_fallback(prompt, {"temperature": 0.3, "response_mime_type": "application/json"})
        return json.loads(resp.text)
    except Exception as e:
        return {"error": str(e), "raw": getattr(resp, "text", None) if 'resp' in dir() else None}


def main():
    if len(sys.argv) < 2:
        print("Usage: python sourcing/analyze.py <crawl_result.json>")
        sys.exit(1)

    src = Path(sys.argv[1])
    if not src.exists():
        # 부분 매칭 (glob)
        matches = list(RESULTS.glob(sys.argv[1]))
        if matches:
            src = matches[0]
        else:
            print(f"[!] 파일 없음: {src}")
            sys.exit(1)

    print(f"[1] 로드: {src}")
    data = json.loads(src.read_text(encoding="utf-8"))
    title = data.get("info", {}).get("title")
    price = data.get("info", {}).get("price")
    detail_urls = data.get("info", {}).get("detailImages") or []
    reviews = data.get("reviews") or []
    stats = data.get("stats") or {}
    print(f"   상품: {title} / 가격: {price}")
    print(f"   상세이미지 {len(detail_urls)}장 / 리뷰 {len(reviews)}개")

    # 상세이미지 다운로드
    print(f"[2] 상세이미지 다운로드 (최대 {MAX_DETAIL_IMAGES}장)...")
    pil_images = []
    for i, url in enumerate(detail_urls[:MAX_DETAIL_IMAGES]):
        bytes_data = download_image(url)
        if not bytes_data:
            print(f"   {i+1}: 다운로드 실패 — {url[:80]}")
            continue
        img = to_pil(bytes_data)
        if img:
            pil_images.append(img)
            print(f"   {i+1}: {img.size} ({len(bytes_data)//1024}KB)")
    print(f"   → {len(pil_images)}장 준비됨")

    # 분석 실행
    print(f"[3] Pass 1: 상세페이지 OCR + 카테고리 식별 (Gemini Vision)...")
    t0 = time.time()
    detail_analysis = analyze_detail_images(pil_images, title)
    print(f"   완료 ({time.time()-t0:.1f}s) | 카테고리: {detail_analysis.get('category', '?')}")
    if "error" in detail_analysis:
        print(f"   ERROR: {detail_analysis['error']}")

    print(f"[4] Pass 2: 카테고리별 차원 평가 + 페이지↔리뷰 교차 분석 (Gemini)...")
    t0 = time.time()
    review_analysis = analyze_combined(detail_analysis, reviews, title, stats)
    print(f"   완료 ({time.time()-t0:.1f}s)")
    if "error" in review_analysis:
        print(f"   ERROR: {review_analysis['error']}")

    # 종합 결과
    out = {
        "source_file": str(src),
        "url": data.get("url"),
        "platform": data.get("platform"),
        "product": {"title": title, "price": price, "stats": stats},
        "detail_analysis": detail_analysis,
        "review_analysis": review_analysis,
        "analyzed_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "model": MODEL,
    }

    out_file = src.parent / (src.stem.replace("-full", "") + "-analysis.json")
    out_file.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[5] 저장: {out_file}")

    # 요약 출력
    print("\n=== 카테고리 ===")
    print(f"  {detail_analysis.get('category_path', '?')} → {detail_analysis.get('category', '?')}")
    print("\n=== 차원별 평가 ===")
    for d in (review_analysis.get("category_dimensions_scored") or [])[:5]:
        print(f"  {d.get('dimension')}: {d.get('score')}/10 ({d.get('verdict')})")
    print("\n=== 한 줄 평 ===")
    print(f"  {review_analysis.get('summary_one_line', '?')}")
    print("\n=== 소싱 판단 ===")
    sd = review_analysis.get("sourcing_decision", {})
    print(f"  {sd.get('verdict')} (confidence: {sd.get('confidence')})")
    print(f"  근거: {sd.get('primary_reasoning', '?')}")
    print(f"  차별화: {sd.get('differentiation_strategy', '?')}")


if __name__ == "__main__":
    main()
