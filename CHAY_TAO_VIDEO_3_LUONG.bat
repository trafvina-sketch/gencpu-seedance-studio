@echo off
chcp 65001 >nul
title SEEDANCE COOKIE STUDIO - QUAN LY MULTI-COOKIE VA TAO VIDEO 3 LUONG + XOA LOGO GPU
cd /d "%~dp0"
echo ============================================================================
echo   SEEDANCE COOKIE STUDIO (WEB UI: http://localhost:3456)
echo   - Dan / Them nhieu Cookie truc tiep tren giao dien (Netscape / JSON / Raw)
echo   - Kiem tra so du Token (2,000,000 Free Tokens) tung tai khoan
echo   - Tu dong xoay vong sang Cookie khac khi het Token
echo   - Chay 3 luong song song (Max 12s, 720p) + Tu dong xoa logo GPU NVENC
echo ============================================================================
echo.
node "%~dp0server_ui.js"
echo.
pause
