@echo off
chcp 65001 > nul

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] 관리자 권한 필요. 우클릭 → 관리자 권한으로 실행.
    pause
    exit /b 1
)

echo ═══════════════════════════════════════
echo   seller-erp 워커 자동 기동 해제
echo ═══════════════════════════════════════

for %%T in (
    "SellerERP-ExpandCategory"
    "SellerERP-Worker"
    "SellerERP-KeywordSnapshot"
    "SellerERP-RankWorker"
) do (
    schtasks /delete /tn %%T /f 2>nul && echo   [제거] %%T
)

echo.
echo 완료. 다음 로그인부터 자동 기동하지 않습니다.
echo 현재 실행 중인 워커는 각 cmd 창을 직접 닫거나 작업 관리자에서 종료하세요.
pause
