"""쿠팡 리뷰 API 응답 구조 확인"""
import os, sys, json
from pathlib import Path

if os.name == "nt":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except: pass

from scrapling.fetchers import StealthySession

ROOT = Path(__file__).resolve().parent
profile = ROOT / ".profiles" / "coupang"

with StealthySession(
    headless=False, real_chrome=True,
    executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe",
    user_data_dir=str(profile),
    network_idle=True, block_images=True, timeout=60000,
) as sess:
    print("[1] 상품 페이지 (쿠키 워밍)...")
    sess.fetch("https://www.coupang.com/vp/products/8797348708?vendorItemId=93308638058", wait=2000)

    print("[2] 리뷰 API 직접 호출...")
    api = "https://www.coupang.com/next-api/review?productId=8797348708&page=1&size=10&sortBy=ORDER_SCORE_ASC&ratingSummary=true&ratings=&market="
    r = sess.fetch(api, wait=500)
    print(f"   status: {r.status}")
    print(f"   body: {len(r.body)} bytes")
    print(f"   content-type: {r.headers.get('content-type')}")
    print(f"\n[3] 응답 (3000자):")
    print(r.body[:3000].decode("utf-8", errors="ignore"))

    # JSON 파싱 시도
    try:
        data = r.json
        print(f"\n[4] JSON 키: {list(data.keys()) if isinstance(data, dict) else type(data)}")
        if isinstance(data, dict):
            for k, v in data.items():
                print(f"   {k}: {type(v).__name__}", end="")
                if isinstance(v, list): print(f" (len={len(v)})")
                elif isinstance(v, dict): print(f" keys={list(v.keys())[:5]}")
                else: print(f" = {str(v)[:80]}")
    except Exception as e:
        print(f"\nJSON 파싱 실패: {e}")
