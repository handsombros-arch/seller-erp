"""Coupang/Naver login session saver.

Usage:
  python sourcing/login.py coupang
  python sourcing/login.py naver
"""
import sys
import os
import subprocess
import time
from pathlib import Path

# Force UTF-8 stdout on Windows cp949 console
if os.name == "nt":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent
PROFILES = ROOT / ".profiles"
PROFILES.mkdir(parents=True, exist_ok=True)

CHROME_PATH = os.environ.get("CHROME_PATH", "C:/Program Files/Google/Chrome/Application/chrome.exe")

TARGETS = {
    "coupang": "https://login.coupang.com/login/login.pang",
    "naver":   "https://nid.naver.com/nidlogin.login",
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in TARGETS:
        print("Usage: python sourcing/login.py [coupang|naver]")
        sys.exit(1)

    name = sys.argv[1]
    url = TARGETS[name]
    profile = PROFILES / name
    profile.mkdir(parents=True, exist_ok=True)

    print(f"\n[{name}] Opening Chrome. Please login.")
    print(f"  profile: {profile}")
    print(f"  url: {url}\n")

    # Chrome을 detached로 띄우고 즉시 종료. 사용자가 Chrome 닫으면 세션 저장됨.
    if os.name == "nt":
        DETACHED = 0x00000008  # DETACHED_PROCESS
        subprocess.Popen([
            CHROME_PATH,
            f"--user-data-dir={profile}",
            "--lang=ko-KR",
            "--no-first-run",
            "--no-default-browser-check",
            url,
        ], creationflags=DETACHED, close_fds=True)
    else:
        subprocess.Popen([
            CHROME_PATH, f"--user-data-dir={profile}", url,
        ], start_new_session=True, close_fds=True)

    print("[OK] Chrome opened.")
    print("   1) Login")
    print("   2) Confirm main page")
    print("   3) Close Chrome window (X button)")
    print(f"\nThen tell me '{name} login done' in chat.")
    print(f"Session saved at: {profile}")


if __name__ == "__main__":
    main()
