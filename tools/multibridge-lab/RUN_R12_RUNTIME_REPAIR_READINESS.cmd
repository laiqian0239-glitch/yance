@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -File "%~dp0r12-runtime-repair-readiness.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
echo YANCE-MULTIBRIDGE-LAB finished with exit code %RC%.
echo The final status is shown above. This window will remain open.
pause
exit /b %RC%
