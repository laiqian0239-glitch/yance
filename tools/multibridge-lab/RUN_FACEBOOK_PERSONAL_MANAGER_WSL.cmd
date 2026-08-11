@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "YANCE_PACKAGE_ROOT=%~dp0"

powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $root=$env:YANCE_PACKAGE_ROOT; $expected=[ordered]@{'facebook-personal-manager-wsl.ps1'='3331f52b112c0087e31440b32035e5cefc7211608e98c26446da02fabacf909b';'facebook-personal-manager-install.sh'='0186f9b711a5d95673c92bc25a9929b7c470e52476ca873ce40770db35cfcb09';'FACEBOOK_PERSONAL_MANAGER_WSL_README.txt'='b5a77669345ecfd7513061339089e6dc78faf975240d17ba234cdd5fb6c769ea';'facebook-personal-wsl-readiness.ps1'='ee0d43fe3e6490434423764c053cdab7781ed10be5429fbf3993f3186cbf4505';'native-process.ps1'='fd715e68aae8a6efdd93ea64272208c38134d2cd67b9ac01275eda02c354599d'}; foreach($name in $expected.Keys){$path=Join-Path $root $name; if(-not (Test-Path -LiteralPath $path -PathType Leaf)){throw ('Missing sealed package file: '+$name)}; $sha=[Security.Cryptography.SHA256]::Create(); try{$stream=[IO.File]::OpenRead($path); try{$actual=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()} finally{$stream.Dispose()}} finally{$sha.Dispose()}; if($actual -ne $expected[$name]){Write-Output ('ACTUAL_SHA256 '+$name+' '+$actual); throw ('Sealed package integrity mismatch: '+$name)}}; Write-Output 'PACKAGE_INTEGRITY_GREEN'"
if errorlevel 1 goto :bootstrap_red

powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $root=$env:YANCE_PACKAGE_ROOT; $files=@('facebook-personal-manager-wsl.ps1','facebook-personal-wsl-readiness.ps1','native-process.ps1'); foreach($name in $files){Unblock-File -LiteralPath (Join-Path $root $name) -ErrorAction Stop}; Write-Output 'PACKAGE_MOTW_RELEASE_GREEN'"
if errorlevel 1 goto :bootstrap_red

powershell.exe -NoLogo -NoProfile -File "%~dp0facebook-personal-manager-wsl.ps1" %*
set "RC=%ERRORLEVEL%"
goto :finished

:bootstrap_red
set "RC=%ERRORLEVEL%"
echo REAL_RED: sealed package bootstrap failed before manager execution.
echo FINAL STATUS: REAL_RED

:finished
echo.
echo YANCE Facebook Personal WSL manager finished with exit code %RC%.
echo The final status is shown above. This window will remain open.
pause
exit /b %RC%
