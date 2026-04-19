"""쿠팡 키워드 순위 추적 워커 (시크릿/Incognito Chrome).

DB rank_keywords 를 폴링 → status='queued' 항목을 처리 → rank_history INSERT.
로그인 영향 없는 순위를 얻기 위해 매 실행마다 임시 user_data_dir + --incognito.

Usage:
  python sourcing/rank_worker.py --watch          # 폴링
  python sourcing/rank_worker.py --once           # 1회
  python sourcing/rank_worker.py --id <uuid>      # 특정 키워드만
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
    print("[!] SUPABASE_URL / SERVICE_ROLE_KEY 누락 (.env.local 확인)")
    sys.exit(1)

CHROME_PATH = os.environ.get("CHROME_PATH", "C:/Program Files/Google/Chrome/Application/chrome.exe")
HEADLESS = os.environ.get("HEADLESS", "0") != "0"  # 시크릿 순위는 visible 기본 (Akamai 회피)

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


def claim_queued(item_id: str | None = None) -> dict | None:
    params = {"select": "*", "limit": "1", "order": "updated_at.asc"}
    if item_id:
        params["id"] = f"eq.{item_id}"
    else:
        params["status"] = "eq.queued"
    rows = db_request("GET", "/rank_keywords", params=params)
    if not rows:
        return None
    item = rows[0]
    upd = db_request(
        "PATCH",
        "/rank_keywords",
        body={"status": "checking", "last_error": None},
        params={"id": f"eq.{item['id']}", "status": f"eq.{item['status']}"},
    )
    if not upd:
        return None
    return upd[0]


def update_keyword(item_id: str, **fields):
    db_request("PATCH", "/rank_keywords", body=fields, params={"id": f"eq.{item_id}"})


def insert_history(**fields):
    db_request("POST", "/rank_history", body=fields)


def make_incognito_session(temp_profile: Path):
    """시크릿 모드 세션 생성 — 매번 새 임시 프로파일 + --incognito."""
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


def scan_page(page_body: bytes, target_product_id: str):
    """검색 결과 HTML에서 li[data-product-id] 순회.
    반환: (position_in_page, is_ad, total_products_on_page)
    position_in_page는 1-based. 광고/자연 모두 포함하는 노출 순위.
    첫 일치 항목만 반환.
    """
    html = page_body.decode("utf-8", errors="ignore")
    # <li ... data-product-id="NNN" ...>  매칭 (오픈 태그 범위 내)
    li_pattern = re.compile(r'<li([^>]*?)data-product-id="(\d+)"([^>]*)>', re.IGNORECASE)
    matches = li_pattern.finditer(html)
    position = 0
    hit = None
    for m in matches:
        position += 1
        pid = m.group(2)
        attrs_before = m.group(1)
        attrs_after = m.group(3)
        attrs = attrs_before + attrs_after
        is_ad = 'data-is-ad="true"' in attrs.lower()
        if pid == target_product_id and hit is None:
            hit = (position, is_ad)
    return hit, position


def check_rank(sess, keyword: str, product_id: str, max_pages: int = 5, page_size: int = 72):
    """키워드 검색 → product_id 노출 위치 찾기.
    반환: {'rank': int|None, 'is_ad': bool|None, 'page': int|None, 'total_scanned': int}
    """
    total_scanned = 0
    for page_num in range(1, max_pages + 1):
        url = f"https://www.coupang.com/np/search?q={quote_plus(keyword)}&page={page_num}&listSize={page_size}"
        print(f"    page {page_num}: {url}")
        try:
            resp = sess.fetch(url, wait=2500)
        except Exception as e:
            raise RuntimeError(f"fetch 실패 p{page_num}: {e}")
        if resp.status != 200:
            snippet = resp.body[:200].decode("utf-8", errors="ignore")
            raise RuntimeError(f"status {resp.status} p{page_num}: {snippet}")
        text_check = resp.body[:2000].decode("utf-8", errors="ignore")
        if "Access Denied" in text_check or "captcha" in text_check.lower() or len(resp.body) < 5000:
            raise RuntimeError(f"차단/캡차 감지 p{page_num} (body={len(resp.body)})")

        hit, count = scan_page(resp.body, product_id)
        total_scanned += count
        if count == 0:
            print(f"      상품 0개 — 검색 결과 없음 또는 파싱 실패")
            break
        if hit:
            pos, is_ad = hit
            absolute_rank = (page_num - 1) * page_size + pos
            print(f"      FOUND rank={absolute_rank} (p{page_num} pos{pos}) ad={is_ad}")
            return {"rank": absolute_rank, "is_ad": is_ad, "page": page_num, "total_scanned": total_scanned}
        # 다음 페이지
        time.sleep(0.8)
    return {"rank": None, "is_ad": None, "page": None, "total_scanned": total_scanned}


def process_item(item: dict):
    item_id = item["id"]
    keyword = item["keyword"]
    product_id = item["product_id"]
    max_pages = item.get("max_pages") or 5
    print(f"\n--- [{item_id[:8]}] '{keyword}' → pid={product_id} (max {max_pages}p) ---")

    temp_profile = Path(tempfile.mkdtemp(prefix="rank-incognito-"))
    sess = None
    try:
        sess = make_incognito_session(temp_profile)
        sess.__enter__()
        result = check_rank(sess, keyword, product_id, max_pages=max_pages)

        insert_history(
            keyword_id=item_id,
            user_id=item.get("user_id"),
            rank=result["rank"],
            is_ad=result["is_ad"],
            page=result["page"],
            total_scanned=result["total_scanned"],
        )
        update_keyword(
            item_id,
            status="done",
            last_checked_at=time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
            last_rank=result["rank"],
            last_is_ad=result["is_ad"],
            last_page=result["page"],
            last_error=None,
        )
        if result["rank"]:
            print(f"  완료: rank={result['rank']} ad={result['is_ad']}")
        else:
            print(f"  완료: 미노출 (스캔 {result['total_scanned']}건)")
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
    parser.add_argument("--interval", type=int, default=10)
    args = parser.parse_args()
    if not (args.watch or args.once or args.id):
        args.once = True

    print(f"[rank-worker] supabase: {SUPABASE_URL}")
    print(f"[rank-worker] mode: {'watch' if args.watch else ('id=' + args.id if args.id else 'once')}")
    print(f"[rank-worker] incognito: ON (temp profile per run)")

    COOLDOWN = int(os.environ.get("PER_ITEM_COOLDOWN", "5"))

    while True:
        try:
            item = claim_queued(args.id)
            if not item:
                if args.once or args.id:
                    print("[rank-worker] 처리할 항목 없음. 종료.")
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
                insert_history(
                    keyword_id=item["id"],
                    user_id=item.get("user_id"),
                    rank=None,
                    note=f"error: {err[:300]}",
                )
            if args.once or args.id:
                break
            if COOLDOWN > 0:
                print(f"[rank-worker] 다음 항목 전 {COOLDOWN}s...")
                time.sleep(COOLDOWN)
        except KeyboardInterrupt:
            print("\n[rank-worker] 종료")
            break
        except Exception as e:
            print(f"[rank-worker] 폴링 에러: {e}")
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
