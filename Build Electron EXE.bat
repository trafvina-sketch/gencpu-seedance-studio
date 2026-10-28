@echo off
chcp 65001 >nul 2>&1
title Dong Goi GenCPU Seedance Studio Electron EXE
cd /d "%~dp0electron"
echo ====================================================================
echo    DONG GOI GENCPU SEEDANCE STUDIO THANH FILE ELECTRON EXE
echo    Website: https://gencpu.com  ^|  https://genpixo.com
echo ====================================================================
echo.
echo [*] Dang tien hanh dong goi Setup.exe va Portable.exe...
call npm run dist
if %ERRORLEVEL% EQU 0 (
  echo.
  echo [OK] Build thanh cong file Electron EXE!
  echo      Thu muc chua file: %~dp0electron\dist\
  copy /Y "%~dp0electron\dist\GenCPU_Seedance_Studio_Setup.exe" "%~dp0GenCPU_Seedance_Studio_Setup.exe" >nul 2>&1
  copy /Y "%~dp0electron\dist\GenCPU_Seedance_Studio_Portable.exe" "%~dp0GenCPU_Seedance_Studio_Portable.exe" >nul 2>&1
  explorer "%~dp0electron\dist"
) else (
  echo.
  echo [!] Co loi trong qua trinh dong goi EXE.
)
echo.
pause
