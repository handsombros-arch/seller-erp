"""소싱 분석 백그라운드 워커.

DB의 sourcing_analyses 테이블을 폴링해 status='pending' 항목을 처리.

Usage:
  python sourcing/worker.py --watch          # 무한 폴링 (10초 간격)
  python sourcing/worker.py --once           # 1회만 처리하고 종료
  python sourcing/worker.py --id <uuid>      # 특정 항목만 처리
"""
import os
import sys
import time
import json
import argparse
import traceback
from pathlib import Path

if os.name == "nt":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except: pass

import urllib.request
import urllib.parse

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
RESULTS.mkdir(parents=True, exist_ok=True)

# .env.local 로드
env_path = ROOT.parent / ".env.local"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not SUPABASE_URL or not SERVICE_KEY:
    print("[!] SUPABASE_URL / SERVICE_ROLE_KEY 누락 (.env.local 확인)")
    sys.exit(1)

# 쿠팡/네이버 봇 차단 우회를 위해 visible Chrome 강제 (headless=0)
os.environ["HEADLESS"] = "0"

REST = SUPABASE_URL + "/rest/v1"
HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


def db_request(method: str, path: str, body=None, params: dict | None = None):
    url = REST + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode("utf-8", errors="ignore")
            return json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {e.code} {url}: {body}")


def claim_pending(item_id: str | None = None) -> dict | None:
    """pending 항목 1개 가져와서 status='crawling'으로 업데이트.
    optimistic lock: 같은 status를 다시 확인 후 update."""
    params = {"select": "*", "limit": "1", "order": "created_at.asc"}
    if item_id:
        params["id"] = f"eq.{item_id}"
    else:
        params["status"] = "eq.pending"
    rows = db_request("GET", "/sourcing_analyses", params=params)
    if not rows:
        return None
    item = rows[0]
    # claim
    upd = db_request(
        "PATCH",
        "/sourcing_analyses",
        body={"status": "crawling", "error": None},
        params={"id": f"eq.{item['id']}", "status": f"eq.{item['status']}"},
    )
    if not upd:
        return None  # 이미 다른 워커가 잡음
    return upd[0]


def update_status(item_id: str, **fields):
    db_request("PATCH", "/sourcing_analyses", body=fields, params={"id": f"eq.{item_id}"})


def process_item(item: dict):
    item_id = item["id"]
    url = item["url"]
    print(f"\n--- [{item_id[:8]}] {item['platform']} {url[:80]} ---")

    sys.path.insert(0, str(ROOT.parent))
    from importlib import reload
    import sourcing.crawl as crawl_mod
    reload(crawl_mod)
    from sourcing.crawl import extract_product_id, crawl as crawl_func
    pid = extract_product_id(url, item["platform"]) or item.get("product_id")

    # 캐시 스킵: 24시간 내 결과 파일 + reviews 있으면 크롤 안 함 (분석만 재실행)
    SKIP_CRAWL = os.environ.get("SKIP_CRAWL_IF_RECENT", "1") != "0"
    pattern = f"{item['platform']}-{pid}-*-full.json"
    files = sorted(RESULTS.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)

    skip_crawl = False
    if SKIP_CRAWL and files:
        age_hours = (time.time() - files[0].stat().st_mtime) / 3600
        if age_hours < 24:
            try:
                test_data = json.loads(files[0].read_text(encoding="utf-8"))
                if test_data.get("reviews") and len(test_data["reviews"]) > 0:
                    skip_crawl = True
                    print(f"  [crawl] SKIP — {age_hours:.1f}h 전 캐시 사용 ({len(test_data['reviews'])} 리뷰)")
            except Exception:
                pass

    if not skip_crawl:
        print("  [crawl] 시작...")
        crawl_func(url)
        # 새 파일 다시 검색
        files = sorted(RESULTS.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)

    if not files:
        raise RuntimeError(f"크롤 결과 파일 없음: {pattern}")
    result_file = files[0]
    crawl_data = json.loads(result_file.read_text(encoding="utf-8"))

    inquiries = crawl_data.get("inquiries") or []
    update_status(item_id,
        status="analyzing",
        product_info=crawl_data.get("info"),
        review_stats=crawl_data.get("stats"),
        reviews_count=len(crawl_data.get("reviews") or []),
        inquiries=inquiries,
        inquiries_count=len(inquiries),
        raw_path=str(result_file),
    )

    print("  [analyze] Pass 1 (상세이미지 OCR)...")
    import importlib, sourcing.analyze as analyze_mod
    importlib.reload(analyze_mod)
    from sourcing.analyze import analyze_detail_images, analyze_combined, analyze_inquiries, download_image, to_pil
    title = crawl_data.get("info", {}).get("title")
    detail_urls = crawl_data.get("info", {}).get("detailImages") or []
    reviews = crawl_data.get("reviews") or []
    stats = crawl_data.get("stats") or {}

    pil_images = []
    for u in detail_urls[:8]:
        b = download_image(u)
        if b:
            img = to_pil(b)
            if img: pil_images.append(img)
    detail_analysis = analyze_detail_images(pil_images, title) if pil_images else {"error": "no images"}
    print("  [analyze] Pass 2 (카테고리 평가 + 교차분석)...")
    review_analysis = analyze_combined(detail_analysis, reviews, title, stats) if reviews else {"error": "no reviews"}
    inquiry_analysis = None
    if inquiries:
        print(f"  [analyze] Pass 3 (상품문의 {len(inquiries)}건 분석)...")
        inquiry_analysis = analyze_inquiries(inquiries, title)

    # 분석 실패 감지 (둘 다 error면 failed로)
    da_err = detail_analysis.get("error") if isinstance(detail_analysis, dict) else None
    ra_err = review_analysis.get("error") if isinstance(review_analysis, dict) else None
    has_critical_err = da_err and ra_err  # 둘 다 실패하면 의미 X
    final_status = "failed" if has_critical_err else "done"
    final_err = (da_err or ra_err) if has_critical_err else None
    if final_err and "429" in str(final_err):
        final_err = "Gemini API 한도 초과 — 내일 자정 이후 재시도 또는 새 키"

    update_status(item_id,
        status=final_status,
        error=final_err,
        detail_analysis=detail_analysis,
        review_analysis=review_analysis,
        inquiry_analysis=inquiry_analysis,
        analyzed_at=time.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
    )
    print(f"  {'✗ 실패' if final_status == 'failed' else '완료'} ({len(reviews)} 리뷰, {len(inquiries)} 문의)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch", action="store_true", help="무한 폴링 모드")
    parser.add_argument("--once", action="store_true", help="1회 실행")
    parser.add_argument("--id", type=str, help="특정 항목 ID 처리")
    parser.add_argument("--interval", type=int, default=10, help="폴링 간격(초)")
    args = parser.parse_args()

    if not (args.watch or args.once or args.id):
        args.once = True

    print(f"[worker] supabase: {SUPABASE_URL}")
    print(f"[worker] mode: {'watch' if args.watch else ('id=' + args.id if args.id else 'once')}")

    # 분당 한도 (15 RPM) 회피용 상품 간 간격
    PER_ITEM_COOLDOWN = int(os.environ.get("PER_ITEM_COOLDOWN", "8"))

    while True:
        try:
            item = claim_pending(args.id)
            if not item:
                if args.once or args.id:
                    print("[worker] 처리할 항목 없음. 종료.")
                    break
                # watch 모드: 대기
                time.sleep(args.interval)
                continue
            try:
                process_item(item)
            except Exception as e:
                err = f"{type(e).__name__}: {e}"
                print(f"  실패: {err}")
                traceback.print_exc()
                update_status(item["id"], status="failed", error=err[:1000])
            if args.once or args.id:
                break
            # 다음 항목 전 쿨다운 (Gemini RPM 한도 회피)
            if PER_ITEM_COOLDOWN > 0:
                print(f"[worker] 다음 항목 전 {PER_ITEM_COOLDOWN}s 대기...")
                time.sleep(PER_ITEM_COOLDOWN)
        except KeyboardInterrupt:
            print("\n[worker] 종료")
            break
        except Exception as e:
            print(f"[worker] 폴링 에러: {e}")
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
