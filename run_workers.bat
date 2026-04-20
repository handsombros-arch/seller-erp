@echo off
cd /d "%~dp0"

echo ======================================
echo   seller-erp local workers (4)
echo ======================================
echo.

start "[1] expand_category"        cmd /k python sourcing\expand_category.py --watch
start "[2] sourcing worker"        cmd /k python sourcing\worker.py --watch
start "[3] keyword snapshot"       cmd /k python sourcing\keyword_snapshot_worker.py --watch
start "[4] rank worker"            cmd /k python sourcing\rank_worker.py --watch

echo.
echo 4 workers started. Close each window to stop that worker.
echo.
echo To auto-start on login:
echo   1. Win+R -^> shell:startup
echo   2. Copy shortcut of run_workers.bat to that folder
echo.
timeout /t 5 > nul
