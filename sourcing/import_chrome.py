"""기존 Chrome 프로파일을 sourcing 전용 프로파일로 복사.

Usage:
  python sourcing/import_chrome.py              # Default 프로파일 복사
  python sourcing/import_chrome.py "Profile 1"  # 특정 프로파일 선택

Chrome 완전히 종료 후 실행하세요 (파일 락 회피).
복사된 프로파일은 Chrome의 모든 쿠키/로그인을 그대로 가짐 → 2FA 불필요.
"""
import os
import sys
import shutil
import time
from pathlib import Path

if os.name == "nt":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except: pass

LOCALAPPDATA = Path(os.environ.get("LOCALAPPDATA", "C:/Users/Grey KIM/AppData/Local"))
SOURCE_USER_DATA = LOCALAPPDATA / "Google" / "Chrome" / "User Data"

ROOT = Path(__file__).resolve().parent
DEST_USER_DATA = ROOT / ".profiles" / "main"

# Cache류는 제외 (큼 + 불필요)
IGNORE_PATTERNS = shutil.ignore_patterns(
    "Cache", "Code Cache", "GPUCache", "GraphiteDawnCache",
    "DawnGraphiteCache", "DawnWebGPUCache", "GrShaderCache",
    "ShaderCache", "IndexedDB", "Service Worker", "blob_storage",
    "Crashpad", "*.log", "*.tmp",
)


def is_chrome_running():
    if os.name != "nt":
        return False
    out = os.popen('tasklist /FI "IMAGENAME eq chrome.exe" 2>NUL').read()
    return "chrome.exe" in out


def safe_copytree(src: Path, dst: Path):
    """파일 락 만나면 skip"""
    dst.mkdir(parents=True, exist_ok=True)
    skipped = []
    for item in src.iterdir():
        rel = item.name
        if rel in {"Cache", "Code Cache", "GPUCache", "GraphiteDawnCache", "DawnGraphiteCache",
                   "DawnWebGPUCache", "GrShaderCache", "ShaderCache", "IndexedDB",
                   "Service Worker", "blob_storage", "Crashpad"}:
            continue
        target = dst / rel
        try:
            if item.is_dir():
                if target.exists():
                    shutil.rmtree(target, ignore_errors=True)
                shutil.copytree(item, target, ignore=IGNORE_PATTERNS)
            else:
                shutil.copy2(item, target)
        except (PermissionError, OSError) as e:
            skipped.append(f"{rel}: {e.__class__.__name__}")
    return skipped


def main():
    profile_name = sys.argv[1] if len(sys.argv) > 1 else "Default"

    if not SOURCE_USER_DATA.exists():
        print(f"[!] Chrome User Data 없음: {SOURCE_USER_DATA}")
        sys.exit(1)

    src_profile = SOURCE_USER_DATA / profile_name
    if not src_profile.exists():
        print(f"[!] 프로파일 없음: {src_profile}")
        print(f"   사용 가능: {sorted(p.name for p in SOURCE_USER_DATA.iterdir() if p.is_dir() and (p / 'Cookies' in p.iterdir() or (p / 'Network').exists()))[:10]}")
        sys.exit(1)

    if is_chrome_running():
        force = os.environ.get("FORCE", "0") == "1"
        if not force:
            print(f"[!] Chrome 실행 중. 모든 Chrome 창 닫고 재실행하세요.")
            print(f"   강제 진행: FORCE=1 python sourcing/import_chrome.py")
            print(f"   (단 락 파일 다수 skip → 쿠키 누락 가능)")
            sys.exit(1)
        print(f"[!] Chrome 실행 중인데 FORCE=1 — 일부 파일 skip 됨")

    print(f"[1] 소스: {src_profile}")
    print(f"[2] 대상: {DEST_USER_DATA}")

    # Local State 복사 (cookie 복호화 키 포함)
    DEST_USER_DATA.mkdir(parents=True, exist_ok=True)
    local_state = SOURCE_USER_DATA / "Local State"
    if local_state.exists():
        shutil.copy2(local_state, DEST_USER_DATA / "Local State")
        print(f"   Local State 복사됨")

    # First Run 표시 (재실행 방지)
    (DEST_USER_DATA / "First Run").touch()

    # 프로파일 폴더 복사
    dst_profile = DEST_USER_DATA / profile_name
    if dst_profile.exists():
        print(f"   기존 대상 삭제 중...")
        shutil.rmtree(dst_profile, ignore_errors=True)

    print(f"[3] 프로파일 복사 중 (Cache 제외)...")
    t0 = time.time()
    skipped = safe_copytree(src_profile, dst_profile)
    print(f"   완료 ({time.time()-t0:.1f}초)")
    if skipped:
        print(f"   skipped {len(skipped)} items (대부분 정상):")
        for s in skipped[:5]:
            print(f"     - {s}")

    # Profile 정보 표기
    info = {
        "profile_name": profile_name,
        "source": str(src_profile),
        "dest_user_data_dir": str(DEST_USER_DATA),
        "dest_profile_dir": str(dst_profile),
        "imported_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    import json
    (DEST_USER_DATA / "import_info.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n✓ 완료. crawl.py가 이 프로파일을 사용합니다.")
    print(f"   user_data_dir: {DEST_USER_DATA}")
    print(f"   profile-directory: {profile_name}")


if __name__ == "__main__":
    main()
