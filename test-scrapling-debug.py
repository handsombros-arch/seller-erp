from scrapling.fetchers import Fetcher
from pathlib import Path

OUT = Path("test/data")
OUT.mkdir(parents=True, exist_ok=True)

for url, label in [
    ("https://www.coupang.com/vp/products/8797348708?vendorItemId=93308638058", "coupang"),
    ("https://smartstore.naver.com/grannuvo/products/12755745371", "naver"),
]:
    p = Fetcher.get(url, impersonate="chrome", timeout=30)
    print(f"\n=== {label} ===")
    print(f"  status: {p.status}")
    print(f"  body bytes: {len(p.body)}")
    print(f"  text len: {len(p.text)}")
    print(f"  html_content len: {len(p.html_content) if hasattr(p, 'html_content') else 'N/A'}")
    print(f"  encoding: {p.encoding}")
    print(f"  headers: {dict(list(p.headers.items())[:5])}")
    # Save raw bytes
    (OUT / f"raw-{label}.html").write_bytes(p.body)
    print(f"  saved {len(p.body)} bytes to raw-{label}.html")
    print(f"  body preview: {p.body[:300]}")
