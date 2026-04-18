"""Scrapling으로 쿠팡/네이버 페이지 + XHR 캡처 테스트"""
import sys
import json
from pathlib import Path

from scrapling.fetchers import StealthyFetcher, Fetcher

OUT_DIR = Path("test/data")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def safe_text(node, default=""):
    if node is None:
        return default
    try:
        return str(node).strip()
    except Exception:
        return default


def test_simple(url: str, label: str):
    print(f"\n=== [{label}] Fetcher ===")
    page = Fetcher.get(url, impersonate="chrome", timeout=30)
    print(f"  status: {page.status}")
    title_el = page.css("title")
    title = title_el[0].text if title_el else None
    print(f"  title: {safe_text(title)[:120]}")
    body_len = len(page.body or b"")
    print(f"  body bytes: {body_len}")
    blocked = ("Access Denied" in page.text) or ("일시적으로 제한" in page.text) or ("차단" in page.text)
    print(f"  blocked: {blocked}")
    if not blocked:
        (OUT_DIR / f"scrapling-{label}-fetcher.html").write_text(page.text[:300000], encoding="utf-8")
    return page, blocked


def test_stealth(url: str, label: str):
    print(f"\n=== [{label}] StealthyFetcher ===")
    page = StealthyFetcher.fetch(
        url,
        headless=True,
        network_idle=True,
        humanize=True,
        block_images=True,
        timeout=60000,
    )
    print(f"  status: {page.status}")
    title_el = page.css("title")
    title = title_el[0].text if title_el else None
    print(f"  title: {safe_text(title)[:120]}")
    blocked = ("Access Denied" in page.text) or ("일시적으로 제한" in page.text)
    print(f"  blocked: {blocked}")

    # captured XHR 분석
    xhr = getattr(page, "captured_xhr", None) or []
    print(f"  captured XHR: {len(xhr)} 건")
    review_xhr = [x for x in xhr if "review" in str(getattr(x, "url", x)).lower()]
    print(f"  review XHR: {len(review_xhr)} 건")
    for r in review_xhr[:5]:
        url_s = getattr(r, "url", str(r))
        method = getattr(r, "method", "?")
        print(f"    - {method} {str(url_s)[:140]}")

    (OUT_DIR / f"scrapling-{label}-stealth.html").write_text(page.text[:300000], encoding="utf-8")
    if review_xhr:
        try:
            (OUT_DIR / f"scrapling-{label}-xhr.json").write_text(
                json.dumps([{"url": str(getattr(x, "url", x)), "method": str(getattr(x, "method", ""))} for x in xhr], ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as e:
            print(f"  xhr 저장 실패: {e}")
    return page, blocked


if __name__ == "__main__":
    targets = [
        ("https://www.coupang.com/vp/products/8797348708?vendorItemId=93308638058", "coupang"),
        ("https://smartstore.naver.com/grannuvo/products/12755745371", "naver"),
    ]
    for url, label in targets:
        try:
            page, blocked = test_simple(url, label)
            if blocked:
                print(f"  → Fetcher 차단됨, StealthyFetcher 시도")
                test_stealth(url, label)
            else:
                # Stealth로도 한 번 — XHR 캡처용
                test_stealth(url, label)
        except Exception as e:
            print(f"[{label}] EXCEPTION: {e}")
