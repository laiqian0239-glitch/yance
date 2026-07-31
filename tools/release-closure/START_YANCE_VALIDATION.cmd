@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Yance Windows Validation

if /I "%~1"=="--elevated" goto elevated

fltmc.exe >nul 2>&1
if not errorlevel 1 goto elevated

set "YANCE_LAUNCHER=%~f0"
echo Requesting Windows administrator approval...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:YANCE_LAUNCHER -ArgumentList '--elevated' -Verb RunAs"
if errorlevel 1 (
  echo ERROR: Administrator approval could not be requested.
  echo.
  pause
  exit /b 91
)
exit /b 0

:elevated
cd /d "%~dp0"
echo ============================================================
echo Yance Windows one-click validation
echo.
echo This window will stay open and show a heartbeat every 10 seconds.
echo Do not close it until FINAL STATUS and RESULT ZIP are displayed.
echo ============================================================
echo.

set "PIPELINE="
set /a PIPELINE_COUNT=0
for %%F in ("%~dp0RUN_WINDOWS_ASSISTED_PIPELINE_*.ps1") do (
  set /a PIPELINE_COUNT+=1
  set "PIPELINE=%%~fF"
)

if not "%PIPELINE_COUNT%"=="1" (
  echo ERROR: Expected exactly one RUN_WINDOWS_ASSISTED_PIPELINE_*.ps1 file.
  echo Found: %PIPELINE_COUNT%
  echo.
  pause
  exit /b 90
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PIPELINE%"
set "RC=%ERRORLEVEL%"

echo.
echo ============================================================
echo Yance validation process exit code: %RC%
echo The validation window above contains the exact FINAL STATUS.
echo The RESULT ZIP is written under D:\Yance-Assisted-*-RESULT.zip.
echo ============================================================
echo.
pause
exit /b %RC%
