@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "YANCE_PACKAGE_ROOT=%~dp0"

powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $root=$env:YANCE_PACKAGE_ROOT; $expected=[ordered]@{'facebook-personal-manager-wsl.ps1'='c56f49b79eb9f5be712864273fb62bc50f5287fe2301f6f5e4c8f9684d71de65';'facebook-personal-provisioning-authority.ps1'='a2409598dac8fdb5f02250823fe0c5d5ee2c4f31824e0783b759d1ee37d50465';'facebook-personal-manager-install.sh'='daafc822ad30ac9fc75a0b01b1bf5d08c187e9c771e85b4ec454e1fbc760e2d1';'FACEBOOK_PERSONAL_MANAGER_WSL_README.txt'='5a313c78362c625b1440e02dcdf2731d409b86462296dd8b3941f0753e3d9dbd';'facebook-personal-wsl-readiness.ps1'='ee0d43fe3e6490434423764c053cdab7781ed10be5429fbf3993f3186cbf4505';'native-process.ps1'='fd715e68aae8a6efdd93ea64272208c38134d2cd67b9ac01275eda02c354599d'}; foreach($name in $expected.Keys){$path=Join-Path $root $name; if(-not (Test-Path -LiteralPath $path -PathType Leaf)){throw ('Missing sealed package file: '+$name)}; $sha=[Security.Cryptography.SHA256]::Create(); try{$stream=[IO.File]::OpenRead($path); try{$actual=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()} finally{$stream.Dispose()}} finally{$sha.Dispose()}; if($actual -ne $expected[$name]){Write-Output ('ACTUAL_SHA256 '+$name+' '+$actual); throw ('Sealed package integrity mismatch: '+$name)}}; Write-Output 'PACKAGE_INTEGRITY_GREEN'"
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