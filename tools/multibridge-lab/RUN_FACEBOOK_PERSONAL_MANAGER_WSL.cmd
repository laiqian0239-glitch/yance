@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "YANCE_PACKAGE_ROOT=%~dp0"

powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $root=$env:YANCE_PACKAGE_ROOT; $expected=[ordered]@{'facebook-personal-manager-wsl.ps1'='1f55be52009f71ab70a276186f6b2d2bd5d6d7469788313156392c9b6899e6d2';'facebook-personal-provisioning-authority.ps1'='a2409598dac8fdb5f02250823fe0c5d5ee2c4f31824e0783b759d1ee37d50465';'facebook-personal-manager-install.sh'='db9f4c40ad2f9091d0bbdb3ece2b4cc90f447f61342a53fdaca12b3c4f2b3772';'FACEBOOK_PERSONAL_MANAGER_WSL_README.txt'='4605c627fde72898420c253863da940a1fee4a845dbea3cb5ede1dc54c739824';'facebook-personal-wsl-readiness.ps1'='ee0d43fe3e6490434423764c053cdab7781ed10be5429fbf3993f3186cbf4505';'native-process.ps1'='fd715e68aae8a6efdd93ea64272208c38134d2cd67b9ac01275eda02c354599d'}; foreach($name in $expected.Keys){$path=Join-Path $root $name; if(-not (Test-Path -LiteralPath $path -PathType Leaf)){throw ('Missing sealed package file: '+$name)}; $sha=[Security.Cryptography.SHA256]::Create(); try{$stream=[IO.File]::OpenRead($path); try{$actual=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()} finally{$stream.Dispose()}} finally{$sha.Dispose()}; if($actual -ne $expected[$name]){Write-Output ('ACTUAL_SHA256 '+$name+' '+$actual); throw ('Sealed package integrity mismatch: '+$name)}}; Write-Output 'PACKAGE_INTEGRITY_GREEN'"
if errorlevel 1 goto :bootstrap_red

powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $root=$env:YANCE_PACKAGE_ROOT; $files=@('facebook-personal-manager-wsl.ps1','facebook-personal-provisioning-authority.ps1','facebook-personal-wsl-readiness.ps1','native-process.ps1'); foreach($name in $files){Unblock-File -LiteralPath (Join-Path $root $name) -ErrorAction Stop}; Write-Output 'PACKAGE_MOTW_RELEASE_GREEN'"
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