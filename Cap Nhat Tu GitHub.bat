@echo off
chcp 65001 >nul 2>&1
title Cap Nhat GenCPU Seedance Studio Tu GitHub
cd /d "%~dp0"
echo ====================================================================
echo    CAP NHAT GENCPU SEEDANCE STUDIO TU GITHUB (AUTO-UPDATE)
echo    Website: https://gencpu.com  ^|  https://genpixo.com
echo ====================================================================
echo.
node server_ui.js --github-update
echo.
pause
