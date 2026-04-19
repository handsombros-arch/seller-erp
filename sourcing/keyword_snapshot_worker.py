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
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
    upd = db_request("PATCH", "/snapshot_keywords",
                     body={
                         "status": "running",
                         "last_error": None,
                         "started_at": now_iso,
                         "progress": {"phase": "starting", "page": 0, "collected": 0, "target": item.get("top_n")},
                     },
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
    쿠팡이 li → div/a 등으로 태그를 바꿔도 동작하도록 [data-product-id] 전체 대상.
    동일 pid는 최초 출현만 기록 (중복 요소 무시).
    """
    items = []
    seen_pids = set()
    try:
        elements = page.css("[data-product-id]")
    except Exception:
        elements = []
    count = 0
    for el in elements:
        if len(items) >= limit: break
        pid = _attr(el, "data-product-id")
        if not pid or not pid.isdigit(): continue
        if pid in seen_pids: continue
        seen_pids.add(pid)
        is_ad = (_attr(el, "data-is-ad") or "").lower() == "true"

        title = None
        for sel in [".name", ".search-product-name", "div[class*='productName']",
                    "div[class*='ProductName']", "div[class*='title']", "[class*='name']"]:
            sub = _first(el, sel)
            t = _text(sub)
            if t and len(t) > 3:
                title = t
                break
        if not title:
            img = _first(el, "img")
            alt = _attr(img, "alt")
            if alt: title = alt.strip()

        # 전체 텍스트 (fallback용)
        try:
            all_text = el.text or ""
        except Exception:
            try: all_text = el.get_all_text() or ""
            except Exception: all_text = ""

        # 가격 — 최종 표시가. CSS → 텍스트 regex fallback
        price = None
        for sel in [
            "[class*='finalPrice'] strong", "[class*='FinalPrice'] strong",
            ".price-value", "strong.price-value",
            "[class*='priceValue']", "[class*='PriceValue']",
            ".price em strong", ".price strong",
            "[class*='salePrice'] strong", "[class*='price'] strong",
            "strong", "em",
        ]:
            sub = _first(el, sel)
            t = _text(sub)
            if t:
                m = re.search(r"(\d{1,3}(?:,\d{3})+|\d{4,})", t)
                if m:
                    n = int(m.group(1).replace(",", ""))
                    if 100 <= n <= 100_000_000:
                        price = m.group(1)
                        break
        if not price and all_text:
            # 상품 카드 전체 텍스트에서 "...원" 또는 천단위 콤마 숫자 최초
            m = re.search(r"(\d{1,3}(?:,\d{3})+)\s*원", all_text)
            if not m:
                m = re.search(r"(\d{1,3}(?:,\d{3})+)", all_text)
            if m:
                n = int(m.group(1).replace(",", ""))
                if 100 <= n <= 100_000_000:
                    price = m.group(1)

        # 평점/리뷰수 — CSS → regex fallback
        rating = None
        review_count = None
        for sel in [".rating", "[class*='rating']", "em[class*='rating']"]:
            sub = _first(el, sel)
            t = _text(sub)
            if t:
                m = re.search(r"([\d.]+)", t)
                if m:
                    try:
                        v = float(m.group(1))
                        if 0 < v <= 5: rating = v; break
                    except: pass
        for sel in [".rating-total-count", ".rating-count", "[class*='ratingCount']",
                    "[class*='RatingCount']", "[class*='reviewCount']"]:
            sub = _first(el, sel)
            t = _text(sub)
            if t:
                m = re.search(r"\(?(\d[\d,]*)\)?", t)
                if m:
                    try: review_count = int(m.group(1).replace(",", "")); break
                    except: pass
        # 텍스트 fallback: "(1,234)" 패턴
        if review_count is None and all_text:
            m = re.search(r"\((\d{1,3}(?:,\d{3})*|\d+)\)", all_text)
            if m:
                try: review_count = int(m.group(1).replace(",", ""))
                except: pass
        # rating fallback: "4.5" 같은 소수점 별점 단독 숫자
        if rating is None and all_text:
            for m in re.finditer(r"(\d\.\d)", all_text):
                try:
                    v = float(m.group(1))
                    if 0 < v <= 5: rating = v; break
                except: pass

        # 썸네일
        thumb = None
        img = _first(el, "img")
        if img:
            for k in ("src", "data-img-src", "data-src", "data-original"):
                v = _attr(img, k)
                if v and v.startswith(("http", "//")):
                    if v.startswith("//"): v = "https:" + v
                    thumb = v
                    break

        # URL — el 자신이 <a>일 수도, 내부에 a 있을 수도
        url = None
        href = _attr(el, "href")
        if not href:
            a = _first(el, "a")
            href = _attr(a, "href")
        if href:
            if href.startswith("/"): url = "https://www.coupang.com" + href
            elif href.startswith("http"): url = href

        # 로켓배송
        is_rocket = False
        try:
            rocket = el.css("[class*='rocket'], [class*='Rocket'], img[alt*='로켓'], img[src*='rocket']")
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
    return items, len(seen_pids)


def collect_top_n(sess, keyword: str, top_n: int, page_size: int = 72, progress_cb=None):
    all_items = []
    max_pages = max(1, (top_n + page_size - 1) // page_size + 1)
    debug_dir = ROOT / "results"
    debug_dir.mkdir(parents=True, exist_ok=True)
    for page_num in range(1, max_pages + 1):
        if progress_cb:
            progress_cb({"phase": "loading", "page": page_num, "collected": len(all_items), "target": top_n})
        url = f"https://www.coupang.com/np/search?q={quote_plus(keyword)}&page={page_num}&listSize={page_size}"
        print(f"    page {page_num}: {url}")
        resp = sess.fetch(url, wait=5000)
        print(f"      status={resp.status} body={len(resp.body)} bytes")
        if resp.status != 200:
            snippet = resp.body[:300].decode("utf-8", errors="ignore")
            raise RuntimeError(f"status {resp.status} p{page_num}: {snippet}")
        text_check = resp.body[:2000].decode("utf-8", errors="ignore")
        if "Access Denied" in text_check or "captcha" in text_check.lower() or len(resp.body) < 5000:
            dump = debug_dir / f"blocked-{keyword}-p{page_num}-{int(time.time())}.html"
            dump.write_bytes(resp.body)
            raise RuntimeError(f"차단/캡차 감지 p{page_num} (body={len(resp.body)}) → {dump.name}")

        if progress_cb:
            progress_cb({"phase": "parsing", "page": page_num, "collected": len(all_items), "target": top_n})
        start_rank = len(all_items) + 1
        remaining = top_n - len(all_items)
        items, li_count = parse_items_from_page(resp, start_rank, remaining)
        all_items.extend(items)
        print(f"      수집 {len(items)}개 (li {li_count}), 누적 {len(all_items)}/{top_n}")
        if li_count == 0:
            dump = debug_dir / f"empty-{keyword}-p{page_num}-{int(time.time())}.html"
            dump.write_bytes(resp.body)
            print(f"      상품 0 — HTML 덤프: {dump.name}")
            # 대체 selector 시도: ul#productList, .search-product 등 전역 grep
            html = resp.body.decode("utf-8", errors="ignore")
            count_alt1 = html.count('data-product-id=')
            count_alt2 = html.count('class="search-product')
            count_alt3 = html.count('id="productList"')
            print(f"      HTML 힌트: data-product-id={count_alt1}, search-product class={count_alt2}, productList id={count_alt3}")
            break
        if progress_cb:
            progress_cb({"phase": "scanning", "page": page_num, "collected": len(all_items), "target": top_n})
        if len(all_items) >= top_n:
            break
        time.sleep(1.0)
    return all_items[:top_n]


class SessionHolder:
    """Chrome 세션을 워커 수명 동안 재사용. 시크릿은 '로그인/히스토리 없음' 기준이며,
    세션 쿠키가 누적되더라도 쿠팡 개인화에는 영향 없음.
    --fresh-session 플래그나 쌓인 쿠키 문제 의심 시 recreate() 호출.
    """
    def __init__(self, fresh_each_item: bool = False):
        self.fresh_each_item = fresh_each_item
        self.sess = None
        self.temp_profile: Path | None = None

    def ensure(self):
        if self.sess is not None: return self.sess
        self.temp_profile = Path(tempfile.mkdtemp(prefix="kwsnap-incognito-"))
        self.sess = make_incognito_session(self.temp_profile)
        self.sess.__enter__()
        print(f"  [session] Chrome 기동 완료 ({self.temp_profile.name})")
        return self.sess

    def recreate(self):
        self.close()
        return self.ensure()

    def close(self):
        if self.sess is not None:
            try: self.sess.__exit__(None, None, None)
            except Exception: pass
            self.sess = None
        if self.temp_profile is not None:
            shutil.rmtree(self.temp_profile, ignore_errors=True)
            self.temp_profile = None


def process_item(item: dict, holder: SessionHolder):
    item_id = item["id"]
    keyword = item["keyword"]
    top_n = int(item.get("top_n") or 40)
    user_id = item.get("user_id")
    print(f"\n--- [{item_id[:8]}] '{keyword}' Top-{top_n} ---")

    snapshot_id = None

    def emit_progress(p: dict):
        try: update_keyword(item_id, progress=p)
        except Exception as e: print(f"    [progress] 업데이트 실패: {e}")

    try:
        if holder.sess is None:
            emit_progress({"phase": "launching_chrome", "page": 0, "collected": 0, "target": top_n})
        sess = holder.ensure()
        if holder.fresh_each_item:
            sess = holder.recreate()

        items = collect_top_n(sess, keyword, top_n, progress_cb=emit_progress)

        emit_progress({"phase": "saving", "page": 0, "collected": len(items), "target": top_n})
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

        if items:
            rows = [{**r, "snapshot_id": snapshot_id} for r in items]
            db_request("POST", "/keyword_snapshot_items", body=rows)

        update_keyword(
            item_id,
            status="done",
            last_snapshot_at=time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
            last_error=None,
            progress=None,
        )
        print(f"  완료: {len(items)}개 저장 (snapshot {snapshot_id[:8]})")
    except Exception as e:
        # Chrome 크래시/연결 끊김 의심 시 세션 재생성
        msg = str(e).lower()
        if any(x in msg for x in ["connection", "disconnect", "crashed", "closed", "timeout"]):
            print(f"  [session] 세션 이상 감지 → 재생성")
            holder.close()
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--id", type=str)
    parser.add_argument("--interval", type=int, default=10, help="폴링 간격(초)")
    parser.add_argument("--fresh-session", action="store_true", help="매 키워드마다 Chrome 재기동 (느리지만 쿠키 완전 초기화)")
    args = parser.parse_args()
    if not (args.watch or args.once or args.id):
        args.once = True

    print(f"[kw-snapshot] supabase: {SUPABASE_URL}")
    print(f"[kw-snapshot] mode: {'watch' if args.watch else ('id=' + args.id if args.id else 'once')}")
    print(f"[kw-snapshot] session: {'fresh per item (slow)' if args.fresh_session else 'reuse (fast)'}")

    COOLDOWN = int(os.environ.get("PER_ITEM_COOLDOWN", "3"))
    holder = SessionHolder(fresh_each_item=args.fresh_session)

    try:
        while True:
            try:
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
                    process_item(item, holder)
                except Exception as e:
                    err = f"{type(e).__name__}: {e}"
                    print(f"  실패: {err}")
                    traceback.print_exc()
                    update_keyword(item["id"], status="failed", last_error=err[:500], progress=None)
                if args.once or args.id:
                    break
                if COOLDOWN > 0:
                    time.sleep(COOLDOWN)
            except KeyboardInterrupt:
                print("\n[kw-snapshot] 종료")
                break
            except Exception as e:
                print(f"[kw-snapshot] 폴링 에러: {e}")
                time.sleep(args.interval)
    finally:
        holder.close()


if __name__ == "__main__":
    main()
