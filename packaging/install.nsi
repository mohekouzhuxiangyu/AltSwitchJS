; AltSwitch 安装脚本 (NSIS)
; 安装到 %LOCALAPPDATA%\Programs\AltSwitch，创建桌面/开始菜单快捷方式与卸载器
Unicode true

!define APP_NAME "AltSwitch"
!define APP_VERSION "1.0.0"
!define APP_EXE "AltSwitch.exe"
!define APP_DIR "$LOCALAPPDATA\Programs\AltSwitch"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltSwitch"

Name "${APP_NAME}"
OutFile "AltSwitch-Setup-${APP_VERSION}.exe"
InstallDir "${APP_DIR}"
RequestExecutionLevel user
SetCompressor /SOLID lzma

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "安装"
  SetOutPath "${APP_DIR}"
  File /r "app\*.*"

  ; 开始菜单快捷方式
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "${APP_DIR}\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk" "${APP_DIR}\uninstall.exe"

  ; 桌面快捷方式
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "${APP_DIR}\${APP_EXE}"

  ; 卸载信息
  WriteUninstaller "${APP_DIR}\uninstall.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "AltSwitch"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" "${APP_DIR}\uninstall.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "${APP_DIR}\${APP_EXE}"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"
  RMDir /r "${APP_DIR}"
  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd
