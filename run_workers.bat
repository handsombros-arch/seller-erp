@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ─────────────────────────────────────
echo   seller-erp 로컬 워커 4개 기동
echo ─────────────────────────────────────
echo.

start "[1] 카테고리 확장 (expand_category)"    cmd /k python sourcing\expand_category.py --watch
start "[2] 상품 소싱 분석 (worker)"             cmd /k python sourcing\worker.py --watch
start "[3] 키워드 Top N 스냅샷"                  cmd /k python sourcing\keyword_snapshot_worker.py --watch
start "[4] 키워드 순위 추적 (rank_worker)"      cmd /k python sourcing\rank_worker.py --watch

echo.
echo 4개 워커가 각 창에서 실행 중입니다.
echo 창을 닫으면 해당 워커가 중지됩니다.
echo.
echo 자동 시작 설정:
echo   1. Win+R → shell:startup 입력 → 폴더 열림
echo   2. 이 파일(run_workers.bat) 의 바로가기를 해당 폴더에 복사
echo   3. 다음 로그인부터 자동 기동
echo.
timeout /t 5 > nul
