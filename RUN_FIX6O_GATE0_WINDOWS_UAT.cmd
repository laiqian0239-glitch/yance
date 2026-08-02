@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title Yance FIX6O Gate 0 Windows UAT
set "YANCE_EXIT=1"
set "YANCE_LAUNCHER=%~dp0RUN_FIX6O_GATE0_WINDOWS_UAT.ps1"

if not exist "%YANCE_LAUNCHER%" (
  echo [FAIL] Missing launcher: %YANCE_LAUNCHER%
  goto :finish
)

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Windows PowerShell was not found.
  goto :finish
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%YANCE_LAUNCHER%"
set "YANCE_EXIT=%ERRORLEVEL%"

:finish
echo.
if "%YANCE_EXIT%"=="0" (
  echo [YANCE] UAT process exited normally.
) else (
  echo [FAIL] Yance Windows UAT exited with code %YANCE_EXIT%.
)
echo [YANCE] Logs: %~dp0.tmp\gate0-windows-launcher
echo.
echo Press any key to close this window.
pause >nul
exit /b %YANCE_EXIT%
