@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

REM ─────────────────────────────────────────────────────
REM   seller-erp 워커 4개를 Windows 작업 스케줄러에 등록
REM   트리거: 사용자 로그인 시 자동 기동 (최대 권한)
REM ─────────────────────────────────────────────────────

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] 관리자 권한 필요
    echo.
    echo 이 파일을 마우스 오른쪽 클릭 → "관리자 권한으로 실행" 하세요.
    echo.
    pause
    exit /b 1
)

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

REM python 경로 자동 탐지
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] python 이 PATH 에 없습니다. python 설치 후 다시 실행하세요.
    pause
    exit /b 1
)

if not exist "%SCRIPT_DIR%\logs" mkdir "%SCRIPT_DIR%\logs"

echo ═══════════════════════════════════════
echo   seller-erp 워커 자동 기동 설정
echo   경로: %SCRIPT_DIR%
echo ═══════════════════════════════════════
echo.

REM 기존 작업 제거 (재설치 대응)
for %%T in (
    "SellerERP-ExpandCategory"
    "SellerERP-Worker"
    "SellerERP-KeywordSnapshot"
    "SellerERP-RankWorker"
) do (
    schtasks /delete /tn %%T /f >nul 2>&1
)

REM 각 워커를 작업 스케줄러에 등록
REM 트리거: /sc onlogon  → 로그인 시 실행
REM /rl HIGHEST          → 최고 권한
REM /ru "%USERNAME%"     → 현재 사용자로 실행 (Chrome GUI 접근 가능)
REM /it                  → interactive (사용자 세션에서)

call :REGISTER "SellerERP-ExpandCategory" "sourcing\expand_category.py" "expand_category.log"
call :REGISTER "SellerERP-Worker"         "sourcing\worker.py"          "worker.log"
call :REGISTER "SellerERP-KeywordSnapshot" "sourcing\keyword_snapshot_worker.py" "keyword_snapshot.log"
call :REGISTER "SellerERP-RankWorker"     "sourcing\rank_worker.py"     "rank_worker.log"

echo.
echo ═══════════════════════════════════════
echo  완료. 다음 로그인부터 4개 워커 자동 기동.
echo.
echo  지금 바로 실행 (로그아웃 없이):
echo    schtasks /run /tn SellerERP-ExpandCategory
echo    schtasks /run /tn SellerERP-Worker
echo    schtasks /run /tn SellerERP-KeywordSnapshot
echo    schtasks /run /tn SellerERP-RankWorker
echo.
echo  로그 확인:           %SCRIPT_DIR%\logs\
echo  작업 스케줄러 열기:  taskschd.msc
echo  해제:                uninstall_scheduled_tasks.bat (관리자)
echo ═══════════════════════════════════════
pause
exit /b 0

:REGISTER
set "TASK=%~1"
set "SCRIPT=%~2"
set "LOG=%~3"
set "CMD=cmd /c cd /d \"%SCRIPT_DIR%\" ^&^& python \"%SCRIPT%\" --watch ^>^> \"logs\%LOG%\" 2^>^&1"

schtasks /create /tn "%TASK%" /sc onlogon /rl HIGHEST /ru "%USERNAME%" /it /f ^
    /tr "%CMD%" >nul

if %errorlevel% equ 0 (
    echo   [OK] %TASK%
) else (
    echo   [실패] %TASK%
)
exit /b 0
