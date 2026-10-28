@echo off
chcp 65001 >nul 2>&1
title Day Ban Cap Nhat GenCPU Seedance Studio Len GitHub (Admin)
cd /d "%~dp0"
echo ====================================================================
echo    DAY BAN CAP NHAT GENCPU SEEDANCE STUDIO LEN GITHUB (ADMIN)
echo    Website: https://gencpu.com  ^|  https://genpixo.com
echo ====================================================================
echo.
set /p REPO_URL="Nhap link GitHub Repo (Enter = giu nguyen mac dinh): "
set /p COMMIT_MSG="Nhap ghi chu ban cap nhat (Enter = Update GenCPU Seedance Studio): "
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=Update GenCPU Seedance Studio"

if "%REPO_URL%"=="" (
  node server_ui.js --github-push --msg "%COMMIT_MSG%"
) else (
  node server_ui.js --github-push --repo "%REPO_URL%" --msg "%COMMIT_MSG%"
)
echo.
pause
