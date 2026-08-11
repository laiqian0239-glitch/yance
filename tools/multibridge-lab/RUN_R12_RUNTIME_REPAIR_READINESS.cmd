@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "YANCE_PACKAGE_ROOT=%~dp0"

powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $root=$env:YANCE_PACKAGE_ROOT; $expected=[ordered]@{'r12-runtime-repair-readiness.ps1'='ce4f30ed0bd0b2d7ad3860ff29ff9cee0b5a90bee2dbc6e10154dad0915ee3fe';'r12-database-wiring.ps1'='47c9a239414ed7f11cdcaaad6c9f3efd47a9f41a1bd59a84824d948e6bbca7d3';'native-process.ps1'='fd715e68aae8a6efdd93ea64272208c38134d2cd67b9ac01275eda02c354599d';'runtime-login-flow-authorities.json'='29e1b882feadb8abe87ca89906a898601ee4e1c369532b0faf9f20999d238c6f'}; foreach($name in $expected.Keys){$path=Join-Path $root $name; if(-not (Test-Path -LiteralPath $path -PathType Leaf)){throw ('Missing sealed package file: '+$name)}; $sha=[Security.Cryptography.SHA256]::Create(); try{$stream=[IO.File]::OpenRead($path); try{$actual=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()} finally{$stream.Dispose()}} finally{$sha.Dispose()}; if($actual -ne $expected[$name]){throw ('Sealed package integrity mismatch: '+$name)}}; Write-Output 'PACKAGE_INTEGRITY_GREEN'"
if errorlevel 1 goto :bootstrap_red

powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $root=$env:YANCE_PACKAGE_ROOT; $files=@('r12-runtime-repair-readiness.ps1','r12-database-wiring.ps1','native-process.ps1'); foreach($name in $files){Unblock-File -LiteralPath (Join-Path $root $name) -ErrorAction Stop}; Write-Output 'PACKAGE_MOTW_RELEASE_GREEN'"
if errorlevel 1 goto :bootstrap_red

powershell.exe -NoLogo -NoProfile -File "%~dp0r12-runtime-repair-readiness.ps1" %*
set "RC=%ERRORLEVEL%"
goto :finished

:bootstrap_red
set "RC=%ERRORLEVEL%"
echo REAL_RED: sealed package bootstrap failed before runtime execution.
echo FINAL STATUS: REAL_RED

:finished
echo.
echo YANCE-MULTIBRIDGE-LAB finished with exit code %RC%.
echo The final status is shown above. This window will remain open.
pause
exit /b %RC%
