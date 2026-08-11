@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "YANCE_PACKAGE_ROOT=%~dp0"

powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $root=$env:YANCE_PACKAGE_ROOT; $expected=[ordered]@{'facebook-personal-matrix-acceptance.ps1'='1493301c97caee3f082100a6a1af77d26842f55d6bb1b7a60b7c66485a9aee49';'FACEBOOK_PERSONAL_MATRIX_ACCEPTANCE_README.txt'='38c80faf20951f7ffb2148f1e7b6633fd8cccd2218863c2c0d70528f4b245b9c'}; foreach($name in $expected.Keys){$path=Join-Path $root $name; if(-not (Test-Path -LiteralPath $path -PathType Leaf)){throw ('Missing sealed package file: '+$name)}; $sha=[Security.Cryptography.SHA256]::Create(); try{$stream=[IO.File]::OpenRead($path); try{$actual=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()} finally{$stream.Dispose()}} finally{$sha.Dispose()}; if($actual -ne $expected[$name]){Write-Output ('ACTUAL_SHA256 '+$name+' '+$actual); throw ('Sealed package integrity mismatch: '+$name)}}; Write-Output 'PACKAGE_INTEGRITY_GREEN'"
if errorlevel 1 goto :bootstrap_red

powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $path=Join-Path $env:YANCE_PACKAGE_ROOT 'facebook-personal-matrix-acceptance.ps1'; Unblock-File -LiteralPath $path -ErrorAction Stop; Write-Output 'PACKAGE_MOTW_RELEASE_GREEN'"
if errorlevel 1 goto :bootstrap_red

powershell.exe -NoLogo -NoProfile -NonInteractive -File "%~dp0facebook-personal-matrix-acceptance.ps1" %*
set "RC=%ERRORLEVEL%"
goto :finished

:bootstrap_red
set "RC=%ERRORLEVEL%"
echo REAL_RED: sealed package bootstrap failed before Matrix acceptance execution.
echo FINAL STATUS: REAL_RED

:finished
echo.
echo YANCE Facebook Personal Matrix acceptance finished with exit code %RC%.
echo The final status is shown above. This window will remain open.
pause
exit /b %RC%
