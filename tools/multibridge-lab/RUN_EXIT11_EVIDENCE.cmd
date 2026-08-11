@echo off
setlocal
set "YANCE_EXIT11_COLLECTOR=%~dp0collect-exit11-evidence.ps1"
set "YANCE_EXIT11_OUTPUT=%~dp0exit11-evidence.txt"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -NoExit -Command "& { try { . $env:YANCE_EXIT11_COLLECTOR; $null = Invoke-LabExit11Collector -OutputPath $env:YANCE_EXIT11_OUTPUT } catch { $safe = '[REDACTED_PACKAGE_ERROR]'; if (Get-Command Protect-LabEvidenceLine -ErrorAction SilentlyContinue) { $safe = Protect-LabEvidenceLine ([string]$_.Exception) }; [IO.File]::WriteAllLines($env:YANCE_EXIT11_OUTPUT, @('YANCE-MULTIBRIDGE-LAB EXIT-11 SANITIZED EVIDENCE', ('PACKAGE_ERROR=' + $safe)), [Text.UTF8Encoding]::new($false)) } finally { Write-Host ''; Write-Host 'FINAL_STATE=REAL_RED'; Write-Host ('OUTPUT_PATH=' + $env:YANCE_EXIT11_OUTPUT) } }"
endlocal
