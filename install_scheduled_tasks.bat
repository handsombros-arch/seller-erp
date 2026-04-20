@echo off
setlocal enabledelayedexpansion

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Administrator privileges required.
    echo Right-click this file and select "Run as administrator".
    pause
    exit /b 1
)

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] python not found in PATH. Install Python first.
    pause
    exit /b 1
)

if not exist "%SCRIPT_DIR%\logs" mkdir "%SCRIPT_DIR%\logs"

echo ======================================
echo   Install seller-erp workers (onlogon)
echo   Path: %SCRIPT_DIR%
echo ======================================
echo.

for %%T in (
    "SellerERP-ExpandCategory"
    "SellerERP-Worker"
    "SellerERP-KeywordSnapshot"
    "SellerERP-RankWorker"
) do (
    schtasks /delete /tn %%T /f >nul 2>&1
)

call :REGISTER "SellerERP-ExpandCategory"  "sourcing\expand_category.py"         "expand_category.log"
call :REGISTER "SellerERP-Worker"          "sourcing\worker.py"                  "worker.log"
call :REGISTER "SellerERP-KeywordSnapshot" "sourcing\keyword_snapshot_worker.py" "keyword_snapshot.log"
call :REGISTER "SellerERP-RankWorker"      "sourcing\rank_worker.py"             "rank_worker.log"

echo.
echo ======================================
echo  Done. Workers will auto-start next login.
echo.
echo  Start now (without logout):
echo    schtasks /run /tn SellerERP-ExpandCategory
echo    schtasks /run /tn SellerERP-Worker
echo    schtasks /run /tn SellerERP-KeywordSnapshot
echo    schtasks /run /tn SellerERP-RankWorker
echo.
echo  Logs:    %SCRIPT_DIR%\logs\
echo  GUI:     taskschd.msc
echo  Remove:  uninstall_scheduled_tasks.bat (as admin)
echo ======================================
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
    echo   [FAIL] %TASK%
)
exit /b 0
