; 言策 / Yance Windows Final Installer
; Public branding is Yance. Yance29 references below are migration-only compatibility identifiers.
Unicode true
RequestExecutionLevel user

!include "MUI2.nsh"

!ifndef STAGING_ROOT
  !error "STAGING_ROOT is required"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE is required"
!endif
!ifndef PRODUCT_VERSION
  !error "PRODUCT_VERSION is required"
!endif
!ifndef PUBLIC_VERSION
  !error "PUBLIC_VERSION is required"
!endif
!ifndef PUBLIC_PRODUCT_NAME
  !error "PUBLIC_PRODUCT_NAME is required"
!endif
!ifndef UPDATE_PRODUCT_NAME
  !error "UPDATE_PRODUCT_NAME is required"
!endif
!ifndef PRODUCT_EXECUTABLE_NAME
  !error "PRODUCT_EXECUTABLE_NAME is required"
!endif
!ifndef INSTALL_DIRECTORY_NAME
  !error "INSTALL_DIRECTORY_NAME is required"
!endif
!ifndef USER_DATA_DIRECTORY_NAME
  !error "USER_DATA_DIRECTORY_NAME is required"
!endif
!ifndef INTERNAL_PRODUCT_ID
  !error "INTERNAL_PRODUCT_ID is required"
!endif
!ifndef ESTIMATED_SIZE_KB
  !error "ESTIMATED_SIZE_KB is required"
!endif

; Migration-only legacy identifiers. Never display these values in new UI.
!define LEGACY_INTERNAL_PRODUCT_ID "Yance29"
!define LEGACY_EXECUTABLE_NAME "Yance29.exe"

; ---- Branding resources ----------------------------------------------------
!define MUI_ICON "${STAGING_ROOT}\application-payload\resources\app\frontend\assets\icon.ico"
!define MUI_UNICON "${STAGING_ROOT}\application-payload\resources\app\frontend\assets\icon.ico"

Name "${PUBLIC_PRODUCT_NAME}"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\${INSTALL_DIRECTORY_NAME}"
InstallDirRegKey HKCU "Software\${INTERNAL_PRODUCT_ID}" "InstallLocation"
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

; ---- Installer VERSIONINFO ------------------------------------------------
!define PRODUCT_VERSION_FILE "${PRODUCT_VERSION}.0"
VIProductVersion "${PRODUCT_VERSION_FILE}"
VIAddVersionKey /LANG=2052 "ProductName" "${UPDATE_PRODUCT_NAME}"
VIAddVersionKey /LANG=2052 "FileDescription" "${PUBLIC_PRODUCT_NAME} 安装程序"
VIAddVersionKey /LANG=2052 "InternalName" "Yance-Setup"
VIAddVersionKey /LANG=2052 "OriginalFilename" "Yance-Setup.exe"
VIAddVersionKey /LANG=2052 "CompanyName" "言策科技"
VIAddVersionKey /LANG=2052 "LegalCopyright" "© 2026 言策科技 保留所有权利"
VIAddVersionKey /LANG=2052 "FileVersion" "${PRODUCT_VERSION_FILE}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${PRODUCT_VERSION}"

; ---- Pages ----------------------------------------------------------------
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "运行${PUBLIC_PRODUCT_NAME}"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchYance"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "SimpChinese"

Function WaitForPostInstallLaunch
  StrCpy $R0 0
  post_install_wait_loop:
    IfFileExists "$APPDATA\${USER_DATA_DIRECTORY_NAME}\logs\post-install-launch.pass" post_install_wait_ok 0
    Sleep 500
    IntOp $R0 $R0 + 1
    IntCmp $R0 180 post_install_wait_timeout post_install_wait_loop post_install_wait_timeout
  post_install_wait_timeout:
    MessageBox MB_ICONSTOP|MB_OK "${PUBLIC_PRODUCT_NAME}启动超时，未收到主窗口可见且运行时就绪的 PASS 回执。请使用桌面快捷方式重试，并回传 post-install-launch.json 与日志目录。"
    Return
  post_install_wait_ok:
FunctionEnd

Function LaunchYance
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  Delete "$APPDATA\${USER_DATA_DIRECTORY_NAME}\logs\post-install-launch.json"
  Delete "$APPDATA\${USER_DATA_DIRECTORY_NAME}\logs\post-install-launch.pass"
  IfFileExists "$APPDATA\${USER_DATA_DIRECTORY_NAME}\logs\post-install-launch.json" post_install_stale_evidence 0
  IfFileExists "$APPDATA\${USER_DATA_DIRECTORY_NAME}\logs\post-install-launch.pass" post_install_stale_evidence 0
  ClearErrors
  Exec '"$INSTDIR\${PRODUCT_EXECUTABLE_NAME}" --post-install'
  IfErrors post_install_launch_failed post_install_launch_started
  post_install_launch_failed:
    MessageBox MB_ICONSTOP|MB_OK "安装已经完成，但${PUBLIC_PRODUCT_NAME}未能自动启动。请使用桌面快捷方式启动，并保留诊断日志以便排查。"
    Return
  post_install_launch_started:
    Call WaitForPostInstallLaunch
    Return
  post_install_stale_evidence:
    MessageBox MB_ICONSTOP|MB_OK "无法清理上一次启动回执，安装器拒绝使用可能过期的启动证据。请退出${PUBLIC_PRODUCT_NAME}后重试。"
FunctionEnd

!macro StopImageOrAbort IMAGE_NAME DISPLAY_LABEL
  nsExec::ExecToStack 'taskkill /IM ${IMAGE_NAME} /T /F'
  Pop $0
  Pop $1
  StrCmp $0 "0" ${DISPLAY_LABEL}_stop_wait
  StrCmp $0 "128" ${DISPLAY_LABEL}_not_running
    MessageBox MB_ICONSTOP|MB_OK "无法停止正在运行的${PUBLIC_PRODUCT_NAME}（taskkill 退出码：$0）。请先退出应用后再安装。"
    Abort
  ${DISPLAY_LABEL}_stop_wait:
    Sleep 1200
    nsExec::ExecToStack 'taskkill /IM ${IMAGE_NAME} /T /F'
    Pop $0
    Pop $1
    StrCmp $0 "128" ${DISPLAY_LABEL}_not_running
    StrCmp $0 "0" ${DISPLAY_LABEL}_stop_verify
      MessageBox MB_ICONSTOP|MB_OK "${PUBLIC_PRODUCT_NAME}进程未能完全停止（taskkill 退出码：$0）。安装已中止。"
      Abort
  ${DISPLAY_LABEL}_stop_verify:
    Sleep 500
    nsExec::ExecToStack 'taskkill /IM ${IMAGE_NAME} /T /F'
    Pop $0
    Pop $1
    StrCmp $0 "128" ${DISPLAY_LABEL}_not_running
      MessageBox MB_ICONSTOP|MB_OK "${PUBLIC_PRODUCT_NAME}仍在运行，安装已中止。请重启 Windows 后重试。"
      Abort
  ${DISPLAY_LABEL}_not_running:
!macroend

!macro StopYanceProcesses
  !insertmacro StopImageOrAbort "${PRODUCT_EXECUTABLE_NAME}" "yance_current"
  ; Legacy preview executable is migration-only and is never shown to users.
  !insertmacro StopImageOrAbort "${LEGACY_EXECUTABLE_NAME}" "yance_legacy"
!macroend

Section "Install"
  SetShellVarContext current
  !insertmacro StopYanceProcesses

  ; InstallDirRegKey above restores an existing Yance location. Legacy installs
  ; are never reused as the new physical install root: the new identity installs
  ; under Yance while the old location is retained only for bounded cleanup.
  ReadRegStr $2 HKCU "Software\${LEGACY_INTERNAL_PRODUCT_ID}" "InstallLocation"

  ; Stage the complete new application next to the final install directory. The
  ; existing Yance install is not touched until the staged executable, backend,
  ; runtime, release manifest and uninstaller have all been verified.
  StrCpy $3 "$INSTDIR.__yance_installing"
  StrCpy $4 "$INSTDIR.__yance_previous"
  StrCpy $5 "0"
  RMDir /r "$3"
  RMDir /r "$4"
  CreateDirectory "$3"
  SetOutPath "$3"
  File /r "${STAGING_ROOT}\application-payload\*.*"
  WriteUninstaller "$3\Uninstall.exe"

  IfFileExists "$3\${PRODUCT_EXECUTABLE_NAME}" +2 0
    Goto transactional_install_validation_failed
  IfFileExists "$3\resources\app\backend\desktopHostedEntry.js" +2 0
    Goto transactional_install_validation_failed
  IfFileExists "$3\resources\runtime\node22\node.exe" +2 0
    Goto transactional_install_validation_failed
  IfFileExists "$3\resources\release-manifest.json" +2 0
    Goto transactional_install_validation_failed
  IfFileExists "$3\Uninstall.exe" +2 0
    Goto transactional_install_validation_failed

  ; Leave the staging directory before renaming it. Windows refuses to rename
  ; a directory that is the installer's current working directory.
  SetOutPath "$TEMP"

  ; Promote only after complete staging validation. Keep the previous Yance
  ; install as a sibling rollback directory until all HKCU metadata and
  ; shortcuts for the new identity have been written successfully.
  IfFileExists "$INSTDIR\*.*" 0 transactional_install_promote_new
    ClearErrors
    Rename "$INSTDIR" "$4"
    IfErrors transactional_install_existing_move_failed
    StrCpy $5 "1"
  transactional_install_promote_new:
    ClearErrors
    Rename "$3" "$INSTDIR"
    IfErrors transactional_install_promote_failed

  ClearErrors
  WriteRegStr HKCU "Software\${INTERNAL_PRODUCT_ID}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INTERNAL_PRODUCT_ID}" "DisplayName" "${PUBLIC_PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INTERNAL_PRODUCT_ID}" "DisplayVersion" "${PUBLIC_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INTERNAL_PRODUCT_ID}" "TechnicalVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INTERNAL_PRODUCT_ID}" "Publisher" "言策科技"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INTERNAL_PRODUCT_ID}" "DisplayIcon" "$INSTDIR\${PRODUCT_EXECUTABLE_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INTERNAL_PRODUCT_ID}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INTERNAL_PRODUCT_ID}" "EstimatedSize" ${ESTIMATED_SIZE_KB}
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INTERNAL_PRODUCT_ID}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INTERNAL_PRODUCT_ID}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  IfErrors transactional_install_metadata_failed

  Delete "$DESKTOP\${PUBLIC_PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PUBLIC_PRODUCT_NAME}\${PUBLIC_PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PUBLIC_PRODUCT_NAME}\卸载.lnk"
  RMDir "$SMPROGRAMS\${PUBLIC_PRODUCT_NAME}"
  CreateDirectory "$SMPROGRAMS\${PUBLIC_PRODUCT_NAME}"
  ; Shortcut working directories inherit the current NSIS output path. After
  ; transactional promotion, bind them to the installed application directory.
  SetOutPath "$INSTDIR"
  ClearErrors
  CreateShortcut "$SMPROGRAMS\${PUBLIC_PRODUCT_NAME}\${PUBLIC_PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE_NAME}"
  CreateShortcut "$SMPROGRAMS\${PUBLIC_PRODUCT_NAME}\卸载.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\${PUBLIC_PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE_NAME}"
  IfErrors transactional_install_metadata_failed

  ; The new install is complete and launchable. Only now retire the rollback
  ; directory and migration-only legacy system entries/install files.
  RMDir /r "$4"
  Delete "$DESKTOP\言策29.lnk"
  Delete "$SMPROGRAMS\言策29\言策29.lnk"
  Delete "$SMPROGRAMS\言策29\卸载.lnk"
  RMDir "$SMPROGRAMS\言策29"
  StrCmp $2 "" legacy_install_cleanup_done
  StrCmp $2 $INSTDIR legacy_install_cleanup_done
    ; Only the exact legacy default application directory may be removed. A
    ; registry-provided custom path is untrusted input and is retained rather
    ; than recursively deleting an arbitrary user-selected location.
    StrCmp $2 "$LOCALAPPDATA\${LEGACY_INTERNAL_PRODUCT_ID}" legacy_default_install_cleanup legacy_custom_install_retained
  legacy_default_install_cleanup:
    RMDir /r "$2"
    Goto legacy_install_cleanup_done
  legacy_custom_install_retained:
    Goto legacy_install_cleanup_done
  legacy_install_cleanup_done:
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_INTERNAL_PRODUCT_ID}"
  DeleteRegKey HKCU "Software\${LEGACY_INTERNAL_PRODUCT_ID}"
  Goto transactional_install_done

  transactional_install_validation_failed:
    RMDir /r "$3"
    MessageBox MB_ICONSTOP|MB_OK "安装校验失败：暂存的${PUBLIC_PRODUCT_NAME}文件不完整。现有版本未被修改。"
    Abort

  transactional_install_existing_move_failed:
    RMDir /r "$3"
    MessageBox MB_ICONSTOP|MB_OK "无法安全备份现有${PUBLIC_PRODUCT_NAME}安装。现有版本未被修改，安装已中止。"
    Abort

  transactional_install_promote_failed:
    RMDir /r "$3"
    StrCmp $5 "1" transactional_install_promote_restore transactional_install_promote_report
  transactional_install_promote_restore:
    ClearErrors
    Rename "$4" "$INSTDIR"
    IfErrors transactional_install_rollback_failed
  transactional_install_promote_report:
    MessageBox MB_ICONSTOP|MB_OK "无法启用新版${PUBLIC_PRODUCT_NAME}。安装器已恢复现有版本，安装已中止。"
    Abort

  transactional_install_metadata_failed:
    Delete "$DESKTOP\${PUBLIC_PRODUCT_NAME}.lnk"
    Delete "$SMPROGRAMS\${PUBLIC_PRODUCT_NAME}\${PUBLIC_PRODUCT_NAME}.lnk"
    Delete "$SMPROGRAMS\${PUBLIC_PRODUCT_NAME}\卸载.lnk"
    RMDir "$SMPROGRAMS\${PUBLIC_PRODUCT_NAME}"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INTERNAL_PRODUCT_ID}"
    DeleteRegKey HKCU "Software\${INTERNAL_PRODUCT_ID}"
    ClearErrors
    Rename "$INSTDIR" "$3"
    IfErrors transactional_install_rollback_failed
    StrCmp $5 "1" transactional_install_metadata_restore transactional_install_metadata_remove_new
  transactional_install_metadata_restore:
    ClearErrors
    Rename "$4" "$INSTDIR"
    IfErrors transactional_install_rollback_failed
  transactional_install_metadata_remove_new:
    RMDir /r "$3"
    RMDir /r "$4"
    MessageBox MB_ICONSTOP|MB_OK "无法写入${PUBLIC_PRODUCT_NAME}的系统入口。安装器已恢复现有版本，安装已中止。"
    Abort

  transactional_install_rollback_failed:
    MessageBox MB_ICONSTOP|MB_OK "${PUBLIC_PRODUCT_NAME}安装回滚未能自动完成。安装器已保留新旧目录，不会删除用户账号数据。请保留安装日志并进行人工恢复。"
    Abort

  transactional_install_done:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  !insertmacro StopYanceProcesses
  Delete "$DESKTOP\${PUBLIC_PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PUBLIC_PRODUCT_NAME}\${PUBLIC_PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PUBLIC_PRODUCT_NAME}\卸载.lnk"
  RMDir "$SMPROGRAMS\${PUBLIC_PRODUCT_NAME}"
  Delete "$DESKTOP\言策29.lnk"
  Delete "$SMPROGRAMS\言策29\言策29.lnk"
  Delete "$SMPROGRAMS\言策29\卸载.lnk"
  RMDir "$SMPROGRAMS\言策29"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INTERNAL_PRODUCT_ID}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_INTERNAL_PRODUCT_ID}"
  DeleteRegKey HKCU "Software\${INTERNAL_PRODUCT_ID}"
  ; User/account data under $APPDATA\Yance and migration source $APPDATA\Yance29
  ; are deliberately retained for repair, upgrade and rollback safety.
  RMDir /r "$INSTDIR"
SectionEnd
