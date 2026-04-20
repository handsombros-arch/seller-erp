"""쿠팡 카테고리/베스트100 페이지 확장 워커.

sourcing_batches 폴링 → 카테고리 URL 로딩 (시크릿 Chrome) → 상위 N개 상품 URL 추출
→ sourcing_analyses 에 pending 으로 삽입 (batch_id, batch_rank 부여).
이후 기존 sourcing/worker.py 가 각 상품을 순차 처리 (기존 Gemini RPM 쿨다운 그대로).

Usage:
  python sourcing/expand_category.py --watch
  python sourcing/expand_category.py --once
  python sourcing/expand_category.py --id <batch_uuid>
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
from urllib.parse import quote_plus, urlparse

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


def claim_pending(item_id: str | None = None):
    params = {"select": "*", "limit": "1", "order": "created_at.asc"}
    if item_id:
        params["id"] = f"eq.{item_id}"
    else:
        params["status"] = "eq.pending"
    rows = db_request("GET", "/sourcing_batches", params=params)
    if not rows: return None
    item = rows[0]
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
    upd = db_request("PATCH", "/sourcing_batches",
                     body={
                         "status": "expanding",
                         "error": None,
                         "started_at": now_iso,
                         "progress": {"phase": "starting"},
                     },
                     params={"id": f"eq.{item['id']}", "status": f"eq.{item['status']}"})
    if not upd: return None
    return upd[0]


def update_batch(batch_id: str, **fields):
    db_request("PATCH", "/sourcing_batches", body=fields, params={"id": f"eq.{batch_id}"})


def make_incognito_session():
    from scrapling.fetchers import StealthySession
    temp_profile = Path(tempfile.mkdtemp(prefix="expand-incognito-"))
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
    sess = StealthySession(
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
    return sess, temp_profile


def _attr(el, name):
    try: return el.attrib.get(name) or None
    except Exception: return None


def _first(el, selector):
    try:
        res = el.css(selector)
        return res[0] if res else None
    except Exception: return None


def _text(el):
    try: return (el.text or "").strip() if el else ""
    except Exception: return ""


def extract_product_rows(page, limit: int):
    """카테고리 페이지에서 상품 리스트 추출.
    반환: [{product_id, url, title, price, rank, thumbnail}]
    """
    rows = []
    seen = set()
    try:
        elements = page.css("[data-product-id]")
    except Exception:
        elements = []
    for el in elements:
        if len(rows) >= limit: break
        pid = _attr(el, "data-product-id")
        if not pid or not pid.isdigit(): continue
        if pid in seen: continue
        seen.add(pid)

        # URL
        url = None
        href = _attr(el, "href")
        if not href:
            a = _first(el, "a")
            href = _attr(a, "href")
        if href:
            if href.startswith("/"): url = "https://www.coupang.com" + href
            elif href.startswith("http"): url = href
        if not url:
            # 최후의 수단: 표준 vp URL 조합 (itemId 없이 productId 만으로도 동작)
            url = f"https://www.coupang.com/vp/products/{pid}"

        title = None
        for sel in [".name", "[class*='name']", "[class*='Name']", "[class*='title']", "[class*='Title']"]:
            sub = _first(el, sel)
            t = _text(sub)
            if t and len(t) > 3:
                title = t; break
        if not title:
            img = _first(el, "img")
            alt = _attr(img, "alt")
            if alt: title = alt.strip()

        price = None
        try: all_text = el.text or ""
        except Exception: all_text = ""
        for sel in ["[class*='priceValue']", "[class*='PriceValue']",
                    ".price-value", "strong.price-value", ".price strong", "strong"]:
            sub = _first(el, sel)
            t = _text(sub)
            if t:
                m = re.search(r"(\d{1,3}(?:,\d{3})+|\d{4,})", t)
                if m:
                    n = int(m.group(1).replace(",", ""))
                    if 100 <= n <= 100_000_000:
                        price = m.group(1); break
        if not price and all_text:
            m = re.search(r"(\d{1,3}(?:,\d{3})+)\s*원", all_text)
            if m:
                price = m.group(1)

        thumb = None
        img = _first(el, "img")
        if img:
            for k in ("src", "data-img-src", "data-src"):
                v = _attr(img, k)
                if v and v.startswith(("http", "//")):
                    if v.startswith("//"): v = "https:" + v
                    thumb = v; break

        rows.append({
            "product_id": pid,
            "url": url,
            "title": title,
            "price": price,
            "rank": len(rows) + 1,
            "thumbnail": thumb,
        })
    return rows


def detect_source_type(url: str) -> str:
    if "/np/best100" in url: return "best100"
    if "/np/categories" in url: return "category"
    if "/np/campaigns" in url: return "campaign"
    return "custom"


def process_batch(batch: dict):
    batch_id = batch["id"]
    url = batch["source_url"]
    limit = int(batch.get("expand_limit") or 40)
    user_id = batch.get("user_id")
    print(f"\n--- [{batch_id[:8]}] expand {url[:80]} (limit {limit}) ---")

    def emit(phase: str, **extra):
        try: update_batch(batch_id, progress={"phase": phase, **extra})
        except Exception as e: print(f"    [progress] {e}")

    emit("launching_chrome")
    sess, temp_profile = make_incognito_session()
    try:
        sess.__enter__()
        emit("loading")
        resp = sess.fetch(url, wait=5000)
        print(f"    status={resp.status} body={len(resp.body)} bytes")
        if resp.status != 200 or len(resp.body) < 5000:
            raise RuntimeError(f"페이지 로드 실패 (status={resp.status}, body={len(resp.body)})")

        emit("parsing")
        rows = extract_product_rows(resp, limit)
        print(f"    추출: {len(rows)}개 상품")
        if not rows:
            raise RuntimeError("상품 0개 — 카테고리 URL이 맞는지 확인")

        # 카테고리 제목 추출 시도
        title = None
        try:
            for sel in ["h1", "[class*='title']", "[class*='Title']"]:
                sub = _first(resp, sel)
                t = _text(sub)
                if t and len(t) > 2:
                    title = t[:100]; break
        except Exception: pass

        # 중복 재사용: 동일 user + coupang + product_id 이미 분석된 것은 sourcing_analyses 새 insert 없이 배치 링크만
        emit("checking_duplicates", count=len(rows))
        pids = [r["product_id"] for r in rows]
        existing_rows = db_request("GET", "/sourcing_analyses", params={
            "select": "id,product_id,status",
            "user_id": f"eq.{user_id}",
            "platform": "eq.coupang",
            "product_id": f"in.({','.join(pids)})",
        }) or []
        existing_map = {x["product_id"]: x for x in existing_rows}
        print(f"    중복(재사용): {len(existing_map)}개 / 신규 insert: {len(rows) - len(existing_map)}개")

        emit("inserting", count=len(rows))
        new_rows = [{
            "user_id": user_id,
            "url": r["url"],
            "platform": "coupang",
            "product_id": r["product_id"],
            "status": "pending",
            "batch_id": batch_id,
            "batch_rank": r["rank"],
        } for r in rows if r["product_id"] not in existing_map]

        new_inserted = []
        if new_rows:
            res = db_request("POST", "/sourcing_analyses", body=new_rows)
            new_inserted = res or []

        # pid → analysis_id 매핑 (기존 + 신규)
        pid_to_analysis_id: dict[str, str] = {pid: ex["id"] for pid, ex in existing_map.items()}
        for row in new_inserted:
            pid_to_analysis_id[row["product_id"]] = row["id"]

        # sourcing_batch_items 에 일괄 링크 (rank 보존)
        links = []
        for r in rows:
            aid = pid_to_analysis_id.get(r["product_id"])
            if not aid: continue
            links.append({"batch_id": batch_id, "analysis_id": aid, "batch_rank": r["rank"]})
        if links:
            # upsert — 이미 링크된 경우 ignoreDuplicates
            try:
                db_request("POST", "/sourcing_batch_items?on_conflict=batch_id,analysis_id",
                           body=links)
            except Exception as e:
                # 일부 중복 시 하나씩 fallback
                print(f"    [link] batch 일괄 실패 → 개별 시도: {e}")
                for link in links:
                    try: db_request("POST", "/sourcing_batch_items", body=link)
                    except Exception: pass

        update_batch(
            batch_id,
            status="expanded",
            total_items=len(rows),
            title=title,
            expanded_at=time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
            progress=None,
        )
        print(f"  완료: 신규 {len(new_rows)} + 재사용 {len(existing_map)} = 총 {len(rows)}개 배치에 연결됨.")
    finally:
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

    print(f"[expand] supabase: {SUPABASE_URL}")
    print(f"[expand] mode: {'watch' if args.watch else ('id=' + args.id if args.id else 'once')}")

    while True:
        try:
            batch = claim_pending(args.id)
            if not batch:
                if args.once or args.id:
                    print("[expand] 처리할 배치 없음. 종료.")
                    break
                time.sleep(args.interval)
                continue
            try:
                process_batch(batch)
            except Exception as e:
                err = f"{type(e).__name__}: {e}"
                print(f"  실패: {err}")
                traceback.print_exc()
                update_batch(batch["id"], status="failed", error=err[:500], progress=None)
            if args.once or args.id:
                break
            time.sleep(3)
        except KeyboardInterrupt:
            print("\n[expand] 종료")
            break
        except Exception as e:
            print(f"[expand] 에러: {e}")
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
