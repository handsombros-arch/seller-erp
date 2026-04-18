"""쿠팡/네이버 상품 + 전체 리뷰 크롤러 (로그인 세션 사용).

Usage:
  python sourcing/crawl.py "<url>" [<url2> ...]

Env:
  HEADLESS=0  비주얼 브라우저 (디버그)
  HEADLESS=1  헤드리스 (기본)
"""
import sys
import os
import re
import json
import time
import asyncio
from pathlib import Path
from urllib.parse import urlparse

if os.name == "nt":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

from scrapling.fetchers import StealthySession

ROOT = Path(__file__).resolve().parent
PROFILES = ROOT / ".profiles"
RESULTS = ROOT / "results"
RESULTS.mkdir(parents=True, exist_ok=True)

CHROME_PATH = os.environ.get("CHROME_PATH", "C:/Program Files/Google/Chrome/Application/chrome.exe")
HEADLESS = os.environ.get("HEADLESS", "1") != "0"


def detect_platform(url: str) -> str:
    host = urlparse(url).netloc
    if "coupang.com" in host: return "coupang"
    if "smartstore.naver.com" in host or "brand.naver.com" in host: return "naver"
    raise ValueError(f"Unsupported URL: {url}")


def extract_product_id(url: str, platform: str):
    if platform == "coupang":
        m = re.search(r"/vp/products/(\d+)", url)
        return m.group(1) if m else None
    if platform == "naver":
        m = re.search(r"/products?/(\d+)", url)
        return m.group(1) if m else None
    return None


def crawl(url: str):
    platform = detect_platform(url)
    pid = extract_product_id(url, platform)
    print(f"\n=== [{platform}] {pid} ===")
    # 통합 main 프로파일 (import_chrome.py로 복사됨) 우선, 없으면 platform별 프로파일
    main_profile = PROFILES / "main"
    if main_profile.exists():
        profile = main_profile
        profile_dir_name = os.environ.get("CHROME_PROFILE", "Default")
        extra_flags = [f"--profile-directory={profile_dir_name}"]
        print(f"  [profile] main ({profile_dir_name})")
    else:
        profile = PROFILES / platform
        extra_flags = []
        if not profile.exists():
            print(f"  [!] 프로파일 없음. 먼저 import_chrome.py 또는 login.py {platform} 실행.")
            return
        print(f"  [profile] {platform} (전용)")

    # OFFSCREEN=1 (기본값): Chrome 창을 화면 밖 좌표에 작게 띄움 → 사용자 작업 방해 X
    if os.environ.get("OFFSCREEN", "1") != "0" and not HEADLESS:
        extra_flags.extend([
            "--window-position=-3000,-3000",
            "--window-size=400,300",
        ])

    sess = StealthySession(
        headless=HEADLESS,
        real_chrome=True,
        executable_path=CHROME_PATH,
        user_data_dir=str(profile),
        humanize=True,
        network_idle=True,
        block_images=True,
        capture_xhr="review",
        timeout=90000,
        extra_flags=extra_flags,
    )

    try:
        sess.__enter__()
        print(f"  [1] 상품 페이지 로딩...")
        page = sess.fetch(url, wait=4000)
        print(f"  status: {page.status} | body: {len(page.body)} bytes")

        text_check = page.body[:1000].decode("utf-8", errors="ignore")
        is_blocked = ("Access Denied" in text_check) or ("captcha" in text_check.lower()) or ("일시적으로 제한" in text_check)
        if is_blocked or page.status >= 400 or len(page.body) < 5000:
            print(f"  [!] 차단/캡차/짧은응답 감지 (status={page.status}, body={len(page.body)})")
            (RESULTS / f"{platform}-{pid}-blocked.html").write_bytes(page.body)
            raise RuntimeError(f"BLOCKED: status={page.status}, body={len(page.body)} bytes — visible Chrome 필요 (HEADLESS=0)")

        # 상품 정보 추출
        info = extract_product_info(page, platform)
        print(f"  title: {info.get('title')}")
        print(f"  price: {info.get('price')}")
        print(f"  detailImages: {len(info.get('detailImages', []))} 개")

        # XHR로 발견된 리뷰 API 사용
        xhr = list(getattr(page, "captured_xhr", []) or [])
        review_xhr = [x for x in xhr if "review" in str(getattr(x, "url", x)).lower()]
        print(f"  [2] 리뷰 XHR {len(review_xhr)}건 발견")

        review_api = pick_review_api(review_xhr, platform)
        if not review_api:
            print(f"  [!] 리뷰 API 미발견 — XHR 더 트리거 필요")
            (RESULTS / f"{platform}-{pid}.html").write_bytes(page.body)
            return
        print(f"  [3] 리뷰 API: {review_api}")

        # 전체 리뷰 페이지네이션
        all_reviews, official_meta = paginate_reviews(sess, review_api, platform, pid)
        print(f"\n  [4] 총 수집: {len(all_reviews)} 리뷰 (공식: {official_meta.get('officialReviewCount')})")

        stats = compute_stats(all_reviews)
        # 공식(쿠팡 표시) 리뷰 수/평점 추가
        stats["officialReviewCount"] = official_meta.get("officialReviewCount")
        stats["officialAvgRating"] = official_meta.get("officialAvgRating")
        stats["officialRatingDist"] = official_meta.get("officialRatingDist")
        stats["crawledCount"] = len(all_reviews)
        print(f"  통계: {stats}")
        if all_reviews:
            print(f"  첫 리뷰: {json.dumps(all_reviews[0], ensure_ascii=False)[:200]}")

        # 상품문의 (Q&A) 페이지네이션
        all_inquiries = []
        if platform == "coupang":
            inquiry_api_seed = next((str(getattr(x, 'url', x)) for x in xhr if "inquiries" in str(getattr(x, 'url', x))), None)
            if not inquiry_api_seed:
                inquiry_api_seed = f"https://www.coupang.com/next-api/products/inquiries?productId={pid}&pageNo=1&isPreview=false"
            print(f"  [5] 상품문의 수집...")
            all_inquiries = paginate_inquiries(sess, inquiry_api_seed, pid)
            print(f"     총 {len(all_inquiries)} 문의")

        out = {
            "url": url, "platform": platform, "productId": pid,
            "info": info, "stats": stats, "reviewApi": review_api,
            "reviews": all_reviews,
            "inquiries": all_inquiries,
        }
        fname = f"{platform}-{pid}-{int(time.time())}-full.json"
        (RESULTS / fname).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        (RESULTS / f"{platform}-{pid}.html").write_bytes(page.body)
        print(f"  saved: {fname}")
    finally:
        try: sess.__exit__(None, None, None)
        except Exception: pass


def extract_product_info(page, platform):
    info = {"title": None, "price": None, "originalPrice": None, "salesPrice": None, "finalPrice": None, "rating": None, "reviewCount": None, "thumbnailUrl": None, "detailImages": []}
    # 공통: og:image 썸네일
    try:
        og = page.css('meta[property="og:image"]')
        if og:
            t = og[0].attrib.get("content")
            if t:
                if t.startswith("//"): t = "https:" + t
                info["thumbnailUrl"] = t
    except Exception: pass
    if platform == "coupang":
        # 제목: <title> 또는 첫 JSON "name"
        try:
            t = page.css("title")
            if t:
                txt = t[0].text or ""
                # "상품명 - 카테고리 | 쿠팡" → "상품명"
                txt = re.sub(r"\s*-\s*[^-|]+\s*\|\s*쿠팡\s*$", "", txt).strip()
                info["title"] = txt or None
            if not info["title"]:
                # script에서 첫 product name
                m = re.search(r'"name"\s*:\s*"([^"]{5,200})"', page.body.decode("utf-8", errors="ignore")[:200000])
                if m: info["title"] = m.group(1)
        except Exception: pass
        # 가격 (할인 전/할인가/최종가 모두 추출)
        try:
            for cls, key in [(".original-price-amount", "originalPrice"),
                             (".sales-price-amount", "salesPrice"),
                             (".final-price-amount", "finalPrice")]:
                el = page.css(cls)
                if el:
                    info[key] = el[0].text.strip()
            # 대표 가격 = 최종가 우선
            info["price"] = info["finalPrice"] or info["salesPrice"] or info["originalPrice"]
        except Exception: pass
        # 상세이미지
        try:
            imgs = page.css(".product-detail-image img, .prod-image__detail img, img.prod-image__item, .subType-IMAGE img")
            info["detailImages"] = list({i.attrib.get("src") for i in imgs if i.attrib.get("src")})
        except Exception: pass
    else:  # naver
        try:
            t = page.css("h3._copyTitle, ._headerTitle, h3._22kNQuEXmb, h3[class*='Title']")
            info["title"] = t[0].text.strip() if t else None
        except Exception: pass
        try:
            p = page.css("strong[class*='price'], ._3gjXetwRWp, .price_num__S2p_v")
            info["price"] = p[0].text.strip() if p else None
        except Exception: pass
        try:
            imgs = page.css(".se-image-resource, .detail_section img")
            info["detailImages"] = list({i.attrib.get("src") for i in imgs if i.attrib.get("src")})
        except Exception: pass
    return info


def pick_review_api(review_xhr, platform):
    """리뷰 본문 API URL 패턴 선택 (batch/inquiry 제외)"""
    for x in review_xhr:
        url = str(getattr(x, "url", x))
        if platform == "coupang" and "/next-api/review?" in url:
            return url
        if platform == "naver" and ("paged-reviews" in url or "/reviews" in url):
            return url
    return None


def paginate_reviews(sess, api_url, platform, pid):
    all_reviews = []
    page_num = 1
    max_pages = 500
    total_pages = None
    official_meta = {"officialReviewCount": None, "officialAvgRating": None, "officialRatingDist": None}
    while page_num <= max_pages:
        next_url = re.sub(r"([?&]page=)\d+", lambda m: m.group(1) + str(page_num), api_url)
        if "page=" not in next_url:
            sep = "&" if "?" in next_url else "?"
            next_url = f"{next_url}{sep}page={page_num}"

        try:
            resp = sess.fetch(next_url, wait=400)
            if resp.status != 200:
                print(f"    page {page_num}: status {resp.status} 중단")
                break
            try:
                data = json.loads(resp.body.decode("utf-8", errors="ignore"))
            except Exception as je:
                print(f"    page {page_num} JSON 파싱 실패: {je}")
                break
            items, paging = extract_review_items_with_paging(data, platform)
            if page_num == 1:
                total_pages = paging.get("totalPage") or paging.get("totalPages")
                total_count = paging.get("totalCount") or paging.get("totalElements")
                # 쿠팡 ratingSummaryTotal 파싱
                rdata = data.get("rData") if isinstance(data, dict) else None
                rsum = (rdata or {}).get("ratingSummaryTotal") if isinstance(rdata, dict) else None
                if rsum:
                    official_meta["officialReviewCount"] = rsum.get("ratingCount") or total_count
                    official_meta["officialAvgRating"] = rsum.get("ratingAverage")
                    summaries = rsum.get("ratingSummaries") or []
                    if summaries:
                        official_meta["officialRatingDist"] = {s.get("rating"): {"count": s.get("count"), "pct": s.get("percentage")} for s in summaries if isinstance(s, dict)}
                else:
                    official_meta["officialReviewCount"] = total_count
                print(f"    page 1: {len(items)}개 / 총 {total_count} / {total_pages}p")
            if not items:
                print(f"    page {page_num}: 빈 페이지 — 종료 (총 {len(all_reviews)})")
                break
            all_reviews.extend([normalize_review(r, platform) for r in items])
            if page_num % 5 == 0:
                print(f"    page {page_num}: 누적 {len(all_reviews)}")
            if total_pages and page_num >= total_pages:
                print(f"    마지막 페이지 도달 ({page_num}/{total_pages})")
                break
            page_num += 1
            time.sleep(0.3)
        except Exception as e:
            print(f"    page {page_num} ERROR: {e}")
            break
    return all_reviews, official_meta


def paginate_inquiries(sess, api_url, pid):
    """쿠팡 상품문의 전체 페이지 순회"""
    all_q = []
    page_num = 1
    max_pages = 200
    # isPreview를 false로 강제 (전체 데이터)
    api_url = re.sub(r"isPreview=true", "isPreview=false", api_url)
    if "isPreview" not in api_url:
        sep = "&" if "?" in api_url else "?"
        api_url = f"{api_url}{sep}isPreview=false"

    while page_num <= max_pages:
        next_url = re.sub(r"([?&]pageNo=)\d+", lambda m: m.group(1) + str(page_num), api_url)
        if "pageNo=" not in next_url:
            sep = "&" if "?" in next_url else "?"
            next_url = f"{next_url}{sep}pageNo={page_num}"
        try:
            resp = sess.fetch(next_url, wait=300)
            if resp.status != 200:
                print(f"     문의 page {page_num}: status {resp.status} 중단")
                break
            try:
                data = json.loads(resp.body.decode("utf-8", errors="ignore"))
            except Exception:
                break
            rdata = data.get("rData") or data.get("data") or {}
            paging = rdata.get("paging") or {}
            items = paging.get("contents") or rdata.get("contents") or rdata.get("inquiries") or []
            if not items:
                break
            for q in items:
                if not isinstance(q, dict): continue
                all_q.append({
                    "id": q.get("inquiryId") or q.get("id"),
                    "question": q.get("title") or q.get("question") or q.get("content"),
                    "questionDetail": q.get("inquiryContent") or q.get("contents"),
                    "answer": q.get("answerContent") or q.get("answer") or q.get("reply"),
                    "asker": q.get("askerName") or q.get("displayName"),
                    "createdAt": q.get("inquiryCreatedAt") or q.get("createdAt"),
                    "answeredAt": q.get("answeredAt") or q.get("answerAt"),
                    "category": q.get("inquiryCategory") or q.get("category"),
                    "isAnswered": bool(q.get("answerContent") or q.get("answer")),
                })
            total_pages = paging.get("totalPage") or paging.get("totalPages")
            if page_num == 1:
                total_count = paging.get("totalCount") or paging.get("totalElements")
                print(f"     문의 page 1: {len(items)}개 / 총 {total_count} / {total_pages}p")
            if total_pages and page_num >= total_pages:
                break
            page_num += 1
            time.sleep(0.3)
        except Exception as e:
            print(f"     문의 page {page_num} ERROR: {e}")
            break
    return all_q


def extract_review_items_with_paging(data, platform):
    """플랫폼별 응답 구조에서 리뷰 리스트 + paging 정보 추출"""
    if not isinstance(data, dict):
        return [], {}
    # 쿠팡: rData.paging.contents
    if platform == "coupang":
        rdata = data.get("rData") or {}
        paging = rdata.get("paging") or {}
        items = paging.get("contents") or []
        return items, paging
    # 네이버: contents 직접 또는 data.contents
    for path in [("contents",), ("data", "contents"), ("reviews",), ("data", "reviews")]:
        cur = data
        ok = True
        for k in path:
            if isinstance(cur, dict) and k in cur:
                cur = cur[k]
            else:
                ok = False; break
        if ok and isinstance(cur, list):
            return cur, data
    return [], {}


def normalize_review(r, platform):
    if not isinstance(r, dict): return {}
    if platform == "coupang":
        member = r.get("member") or {}
        survey = r.get("reviewSurveyAnswers") or []
        return {
            "id": r.get("reviewId"),
            "rating": r.get("rating"),
            "title": r.get("title") or "",
            "text": r.get("content") or "",
            "writer": r.get("displayName") or member.get("name"),
            "createdAt": r.get("reviewAt"),  # epoch ms
            "helpful": r.get("helpfulCount") or 0,
            "optionContent": r.get("itemName"),
            "survey": [{"q": s.get("question"), "a": s.get("answer")} for s in survey if isinstance(s, dict)],
            "images": [i.get("originalUrl") or i.get("url") for i in (r.get("reviewImages") or r.get("attachments") or []) if isinstance(i, dict)],
        }
    return {
        "id": r.get("reviewId") or r.get("id"),
        "rating": r.get("reviewScore") or r.get("rating"),
        "text": r.get("reviewContent") or r.get("content"),
        "writer": r.get("writerMemberMaskedId") or r.get("writer"),
        "createdAt": r.get("createDate") or r.get("createdAt"),
        "helpful": r.get("helpCount") or 0,
        "optionContent": r.get("productOptionContent"),
        "images": [i.get("url") or i.get("imageUrl") for i in (r.get("reviewImages") or []) if isinstance(i, dict)],
    }


def compute_stats(reviews):
    if not reviews: return {"total": 0}
    ratings = [float(r["rating"]) for r in reviews if r.get("rating") is not None]
    avg = round(sum(ratings) / len(ratings), 2) if ratings else None
    dist = {}
    for r in ratings: dist[int(round(r))] = dist.get(int(round(r)), 0) + 1
    return {"total": len(reviews), "avgRating": avg, "ratingDist": dist, "withImages": sum(1 for r in reviews if r.get("images"))}


def main():
    urls = sys.argv[1:]
    if not urls:
        print('Usage: python sourcing/crawl.py "<url>" [<url2> ...]')
        sys.exit(1)
    for u in urls:
        try: crawl(u)
        except Exception as e: print(f"  ERROR: {e}")


if __name__ == "__main__":
    main()
