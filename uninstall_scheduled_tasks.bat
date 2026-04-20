@echo off

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Administrator privileges required.
    pause
    exit /b 1
)

echo ======================================
echo   Uninstall seller-erp scheduled tasks
echo ======================================

for %%T in (
    "SellerERP-ExpandCategory"
    "SellerERP-Worker"
    "SellerERP-KeywordSnapshot"
    "SellerERP-RankWorker"
) do (
    schtasks /delete /tn %%T /f 2>nul && echo   [REMOVED] %%T
)

echo.
echo Done. Workers will not auto-start next login.
pause
