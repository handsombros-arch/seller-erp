"""키워드별 Top-N 순위 스냅샷 워커 (시크릿 Chrome).

DB snapshot_keywords 폴링 → status='queued' 항목을 처리 →
keyword_snapshots INSERT + keyword_snapshot_items INSERT.

Usage:
  python sourcing/keyword_snapshot_worker.py --watch
  python sourcing/keyword_snapshot_worker.py --once
  python sourcing/keyword_snapshot_worker.py --id <uuid>
  python sourcing/keyword_snapshot_worker.py --interval 300    # 폴링 간격 5분

자동 스케줄:
  snapshot_keywords.auto_interval_minutes가 설정된 키워드는,
  폴링 시 last_snapshot_at이 N분 이상 지났으면 자동으로 status='queued'로 전환.
"""
import os
import sys
import re
import time
import json
import shutil
import tempfile
import argparse
import traceback
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus

if os.name == "nt":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

import urllib.request
import urllib.parse

ROOT = Path(__file__).resolve().parent

env_path = ROOT.parent / ".env.local"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not SUPABASE_URL or not SERVICE_KEY:
    print("[!] SUPABASE_URL / SERVICE_ROLE_KEY 누락")
    sys.exit(1)

CHROME_PATH = os.environ.get("CHROME_PATH", "C:/Program Files/Google/Chrome/Application/chrome.exe")
HEADLESS = os.environ.get("HEADLESS", "0") != "0"

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
        body_t = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {e.code} {url}: {body_t}")


def auto_enqueue_due():
    """auto_interval_minutes 설정된 키워드 중 last_snapshot_at이 N분 이상 지난 것 queue로."""
    rows = db_request("GET", "/snapshot_keywords", params={
        "select": "id,keyword,last_snapshot_at,auto_interval_minutes,status,is_active",
        "is_active": "eq.true",
        "auto_interval_minutes": "not.is.null",
        "status": "in.(idle,done,failed)",
    }) or []
    now = datetime.now(timezone.utc)
    queued = 0
    for r in rows:
        mins = r.get("auto_interval_minutes")
        if not mins: continue
        last = r.get("last_snapshot_at")
        due = True
        if last:
            try:
                dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
                if (now - dt).total_seconds() < int(mins) * 60:
                    due = False
            except Exception:
                pass
        if due:
            try:
                db_request("PATCH", "/snapshot_keywords",
                           body={"status": "queued"},
                           params={"id": f"eq.{r['id']}", "status": f"eq.{r['status']}"})
                queued += 1
                print(f"  [auto] queued '{r['keyword']}' (interval {mins}m)")
            except Exception as e:
                print(f"  [auto] enqueue 실패 {r['keyword']}: {e}")
    return queued


def claim_queued(item_id: str | None = None):
    params = {"select": "*", "limit": "1", "order": "updated_at.asc"}
    if item_id:
        params["id"] = f"eq.{item_id}"
    else:
        params["status"] = "eq.queued"
    rows = db_request("GET", "/snapshot_keywords", params=params)
    if not rows: return None
    item = rows[0]
    upd = db_request("PATCH", "/snapshot_keywords",
                     body={"status": "running", "last_error": None},
                     params={"id": f"eq.{item['id']}", "status": f"eq.{item['status']}"})
    if not upd: return None
    return upd[0]


def update_keyword(item_id: str, **fields):
    db_request("PATCH", "/snapshot_keywords", body=fields, params={"id": f"eq.{item_id}"})


def make_incognito_session(temp_profile: Path):
    from scrapling.fetchers import StealthySession
    extra_flags = [
        "--incognito",
        "--no-first-run",
        "--disable-blink-features=AutomationControlled",
    ]
    if os.environ.get("OFFSCREEN", "1") != "0" and not HEADLESS:
        extra_flags.extend([
            "--window-position=-3000,-3000",
            "--window-size=600,400",
        ])
    return StealthySession(
        headless=HEADLESS,
        real_chrome=True,
        executable_path=CHROME_PATH,
        user_data_dir=str(temp_profile),
        humanize=True,
        network_idle=True,
        block_images=True,
        timeout=60000,
        extra_flags=extra_flags,
    )


def _text(el):
    try:
        return (el.text or "").strip() if el else ""
    except Exception:
        return ""


def _first(page_or_el, selector):
    try:
        res = page_or_el.css(selector)
        return res[0] if res else None
    except Exception:
        return None


def _attr(el, name):
    if el is None: return None
    try:
        v = el.attrib.get(name)
        return v if v else None
    except Exception:
        return None


def parse_items_from_page(page, start_rank: int, limit: int):
    """검색 결과 페이지에서 상품 리스트 추출.
    start_rank: 이 페이지 첫 항목의 절대 순위
    limit: 더 수집할 최대 개수
    반환: items (dict list), consumed_count
    """
    items = []
    try:
        lis = page.css("li[data-product-id]")
    except Exception:
        lis = []
    count = 0
    for idx, li in enumerate(lis):
        if len(items) >= limit: break
        pid = _attr(li, "data-product-id")
        if not pid: continue
        is_ad = (_attr(li, "data-is-ad") or "").lower() == "true"

        title = None
        for sel in [".name", ".search-product-name", "div[class*='productName']"]:
            el = _first(li, sel)
            t = _text(el)
            if t:
                title = t
                break
        if not title:
            # 대체: img alt
            img = _first(li, "img")
            alt = _attr(img, "alt")
            if alt: title = alt.strip()

        # 가격
        price = None
        for sel in [".price-value", "strong.price-value", ".price em strong", ".price strong"]:
            el = _first(li, sel)
            t = _text(el)
            if t:
                price = t
                break

        # 평점/리뷰수
        rating = None
        review_count = None
        el_rating = _first(li, ".rating")
        if el_rating:
            t = _text(el_rating)
            if t:
                m = re.search(r"([\d.]+)", t)
                if m:
                    try: rating = float(m.group(1))
                    except: pass
        el_rcount = _first(li, ".rating-total-count, .rating-count")
        if el_rcount:
            t = _text(el_rcount)
            m = re.search(r"(\d[\d,]*)", t)
            if m:
                try: review_count = int(m.group(1).replace(",", ""))
                except: pass

        # 썸네일
        thumb = None
        img = _first(li, "img.search-product-wrap-img, dt img, img")
        if img:
            for k in ("src", "data-img-src", "data-src"):
                v = _attr(img, k)
                if v:
                    if v.startswith("//"): v = "https:" + v
                    thumb = v
                    break

        # URL
        url = None
        a = _first(li, "a")
        href = _attr(a, "href")
        if href:
            if href.startswith("/"): url = "https://www.coupang.com" + href
            elif href.startswith("http"): url = href

        # 로켓배송 뱃지
        is_rocket = False
        try:
            rocket = li.css("span[class*='rocket'], img[alt*='로켓'], img[src*='rocket']")
            is_rocket = bool(rocket)
        except Exception:
            pass

        items.append({
            "rank": start_rank + count,
            "product_id": pid,
            "title": title,
            "price": price,
            "is_ad": is_ad,
            "is_rocket": is_rocket,
            "thumbnail_url": thumb,
            "product_url": url,
            "rating": rating,
            "review_count": review_count,
        })
        count += 1
    return items, len(lis)


def collect_top_n(sess, keyword: str, top_n: int, page_size: int = 72):
    all_items = []
    max_pages = max(1, (top_n + page_size - 1) // page_size + 1)
    for page_num in range(1, max_pages + 1):
        url = f"https://www.coupang.com/np/search?q={quote_plus(keyword)}&page={page_num}&listSize={page_size}"
        print(f"    page {page_num}: {url}")
        resp = sess.fetch(url, wait=2500)
        if resp.status != 200:
            snippet = resp.body[:200].decode("utf-8", errors="ignore")
            raise RuntimeError(f"status {resp.status} p{page_num}: {snippet}")
        text_check = resp.body[:2000].decode("utf-8", errors="ignore")
        if "Access Denied" in text_check or "captcha" in text_check.lower() or len(resp.body) < 5000:
            raise RuntimeError(f"차단/캡차 감지 p{page_num} (body={len(resp.body)})")

        start_rank = len(all_items) + 1
        remaining = top_n - len(all_items)
        items, li_count = parse_items_from_page(resp, start_rank, remaining)
        all_items.extend(items)
        print(f"      수집 {len(items)}개 (li {li_count}), 누적 {len(all_items)}/{top_n}")
        if li_count == 0:
            print("      상품 0 — 중단")
            break
        if len(all_items) >= top_n:
            break
        time.sleep(1.0)
    return all_items[:top_n]


def process_item(item: dict):
    item_id = item["id"]
    keyword = item["keyword"]
    top_n = int(item.get("top_n") or 40)
    user_id = item.get("user_id")
    print(f"\n--- [{item_id[:8]}] '{keyword}' Top-{top_n} ---")

    temp_profile = Path(tempfile.mkdtemp(prefix="kwsnap-incognito-"))
    sess = None
    snapshot_id = None
    try:
        sess = make_incognito_session(temp_profile)
        sess.__enter__()
        items = collect_top_n(sess, keyword, top_n)

        # snapshot 행 생성
        snap = db_request("POST", "/keyword_snapshots", body={
            "keyword_id": item_id,
            "user_id": user_id,
            "keyword": keyword,
            "top_n": top_n,
            "items_count": len(items),
        })
        if not snap:
            raise RuntimeError("keyword_snapshots insert returned empty")
        snapshot_id = snap[0]["id"]

        # items 배치 삽입
        if items:
            rows = [{**r, "snapshot_id": snapshot_id} for r in items]
            db_request("POST", "/keyword_snapshot_items", body=rows)

        update_keyword(
            item_id,
            status="done",
            last_snapshot_at=time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
            last_error=None,
        )
        print(f"  완료: {len(items)}개 저장 (snapshot {snapshot_id[:8]})")
    finally:
        if sess is not None:
            try: sess.__exit__(None, None, None)
            except Exception: pass
        shutil.rmtree(temp_profile, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--id", type=str)
    parser.add_argument("--interval", type=int, default=30, help="폴링 간격(초)")
    args = parser.parse_args()
    if not (args.watch or args.once or args.id):
        args.once = True

    print(f"[kw-snapshot] supabase: {SUPABASE_URL}")
    print(f"[kw-snapshot] mode: {'watch' if args.watch else ('id=' + args.id if args.id else 'once')}")
    print(f"[kw-snapshot] incognito: ON (temp profile per run)")

    COOLDOWN = int(os.environ.get("PER_ITEM_COOLDOWN", "5"))

    while True:
        try:
            # 자동 스케줄 (auto_interval_minutes) 체크 → queue 전환
            if args.watch:
                try: auto_enqueue_due()
                except Exception as e: print(f"  [auto] 체크 실패: {e}")

            item = claim_queued(args.id)
            if not item:
                if args.once or args.id:
                    print("[kw-snapshot] 처리할 항목 없음. 종료.")
                    break
                time.sleep(args.interval)
                continue
            try:
                process_item(item)
            except Exception as e:
                err = f"{type(e).__name__}: {e}"
                print(f"  실패: {err}")
                traceback.print_exc()
                update_keyword(item["id"], status="failed", last_error=err[:500])
            if args.once or args.id:
                break
            if COOLDOWN > 0:
                print(f"[kw-snapshot] 다음 항목 전 {COOLDOWN}s...")
                time.sleep(COOLDOWN)
        except KeyboardInterrupt:
            print("\n[kw-snapshot] 종료")
            break
        except Exception as e:
            print(f"[kw-snapshot] 폴링 에러: {e}")
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
