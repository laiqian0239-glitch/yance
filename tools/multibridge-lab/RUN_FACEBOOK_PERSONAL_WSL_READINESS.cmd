@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "YANCE_PACKAGE_ROOT=%~dp0"

powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $root=$env:YANCE_PACKAGE_ROOT; $manifest=Join-Path $root 'SHA256SUMS.txt'; if(-not (Test-Path -LiteralPath $manifest -PathType Leaf)){throw 'Missing sealed package manifest'}; $required=@('FACEBOOK_PERSONAL_WSL_READINESS_README.txt','facebook-personal-wsl-readiness.ps1','native-process.ps1')|Sort-Object; $seen=@(); foreach($line in [IO.File]::ReadAllLines($manifest)){if($line -notmatch '^([0-9a-f]{64})  (.+)$'){throw 'Invalid sealed manifest line'}; $expected=$matches[1]; $name=$matches[2]; if($required -notcontains $name){throw ('Unexpected sealed manifest file: '+$name)}; $path=Join-Path $root $name; if(-not (Test-Path -LiteralPath $path -PathType Leaf)){throw ('Missing sealed package file: '+$name)}; $sha=[Security.Cryptography.SHA256]::Create(); try{$stream=[IO.File]::OpenRead($path); try{$actual=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()} finally{$stream.Dispose()}} finally{$sha.Dispose()}; if($actual -ne $expected){throw ('Sealed package integrity mismatch: '+$name)}; $seen += $name}; if((@($seen|Sort-Object)-join '|') -ne ($required-join '|')){throw 'Sealed package file set mismatch'}; Write-Output 'PACKAGE_INTEGRITY_GREEN'"
if errorlevel 1 goto :bootstrap_red

powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $root=$env:YANCE_PACKAGE_ROOT; foreach($name in @('facebook-personal-wsl-readiness.ps1','native-process.ps1')){Unblock-File -LiteralPath (Join-Path $root $name) -ErrorAction Stop}; Write-Output 'PACKAGE_MOTW_RELEASE_GREEN'"
if errorlevel 1 goto :bootstrap_red

powershell.exe -NoLogo -NoProfile -File "%~dp0facebook-personal-wsl-readiness.ps1"
set "RC=%ERRORLEVEL%"
goto :finished

:bootstrap_red
set "RC=%ERRORLEVEL%"
echo REAL_RED: sealed WSL readiness package bootstrap failed.
echo FINAL STATUS: REAL_RED

:finished
echo.
echo YANCE Facebook Personal WSL readiness finished with exit code %RC%.
echo This checker is read-only. The final status is shown above.
pause
exit /b %RC%
