'use strict';
// Windows 平台实现：通过 koffi (FFI) 调用 Win32 API
// 窗口级枚举（每个顶层窗口一条，支持同进程多窗口如资源管理器）
// 权限检测（elevated）+ 强前置序列

const koffi = require('koffi');
const path = require('path');
const { execFile } = require('child_process');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const dwmapi = koffi.load('dwmapi.dll');
const advapi32 = koffi.load('advapi32.dll');

// ---------- 类型与函数声明 ----------
const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');

const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *callback, intptr_t lParam)');
const IsWindow = user32.func('bool __stdcall IsWindow(intptr_t hwnd)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(intptr_t hwnd)');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32 *lpdwProcessId)');
const GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(intptr_t hWnd)');
const BringWindowToTop = user32.func('bool __stdcall BringWindowToTop(intptr_t hWnd)');
const SwitchToThisWindow = user32.func('void __stdcall SwitchToThisWindow(intptr_t hwnd, bool fAltTab)');
const AttachThreadInput = user32.func('bool __stdcall AttachThreadInput(uint32 idAttach, uint32 idAttachTo, bool fAttach)');
const ShowWindow = user32.func('bool __stdcall ShowWindow(intptr_t hWnd, int32 nCmdShow)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr_t hWnd, _Out_ RECT *rect)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(intptr_t hWnd, char16_t *lpClassName, int32 nMaxCount)');
const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int32 nIndex)');
const SendMessageTimeoutW = user32.func('intptr_t __stdcall SendMessageTimeoutW(intptr_t hWnd, uint32 Msg, intptr_t wParam, char16_t *lParam, uint32 fuFlags, uint32 uTimeout, _Out_ intptr_t *lpdwResult)');
const SetWindowPos = user32.func('bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int32 x, int32 y, int32 cx, int32 cy, uint32 uFlags)');
const keybd_event = user32.func('void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, intptr_t dwExtraInfo)');
const SystemParametersInfoW = user32.func('bool __stdcall SystemParametersInfoW(uint32 uiAction, uint32 uiParam, intptr_t pvParam, uint32 fWinIni)');
const OpenProcess = kernel32.func('intptr_t __stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr_t hObject)');
const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(intptr_t hProcess, uint32 dwFlags, char16_t *lpExeName, _Inout_ uint32 *lpdwSize)');
const DwmGetWindowAttribute = dwmapi.func('int32 __stdcall DwmGetWindowAttribute(intptr_t hwnd, int32 dwAttribute, _Out_ int32 *pvAttribute, int32 cbAttribute)');
const OpenProcessToken = advapi32.func('bool __stdcall OpenProcessToken(intptr_t hProcess, uint32 dwDesiredAccess, _Out_ intptr_t *phToken)');
const GetTokenInformation = advapi32.func('bool __stdcall GetTokenInformation(intptr_t hToken, int32 tokenInformationClass, _Out_ int32 *tokenInformation, uint32 tokenInformationLength, _Out_ uint32 *returnLength)');

// ---------- 常量 ----------
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const DWMWA_CLOAKED = 14;
const SW_RESTORE = 9;
const SW_SHOW = 5;
const SMTO_ABORTIFHUNG = 0x0002;
const WM_GETTEXTLENGTH = 0x000E;
const WM_GETTEXT = 0x000D;
const HWND_TOPMOST = -1n;
const HWND_NOTOPMOST = -2n;
const SWP_NOMOVE = 0x0001;
const SWP_NOSIZE = 0x0002;
const SWP_SHOWWINDOW = 0x0040;
const SPI_SETFOREGROUNDLOCKTIMEOUT = 0x2001;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TOKEN_QUERY = 0x0008;
const TokenElevation = 20;

const SKIP_CLASSES = new Set([
  'Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd',
  'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow',
]);

// ---------- 基础工具 ----------
function safeGetTitle(hwnd) {
  try {
    const r1 = [null];
    const ret1 = SendMessageTimeoutW(hwnd, WM_GETTEXTLENGTH, 0, null, SMTO_ABORTIFHUNG, 400, r1);
    if (!ret1) return '';
    const len = Number(r1[0]);
    if (len <= 0 || len > 4096) return '';
    const buf = Buffer.allocUnsafe((len + 1) * 2);
    const r2 = [null];
    const ret2 = SendMessageTimeoutW(hwnd, WM_GETTEXT, len + 1, buf, SMTO_ABORTIFHUNG, 400, r2);
    if (!ret2) return '';
    const n = Math.min(Number(r2[0]), len);
    if (n <= 0) return '';
    return koffi.decode(buf, 'char16_t', n);
  } catch (e) {
    return '';
  }
}

function safeGetClassName(hwnd) {
  try {
    const buf = Buffer.allocUnsafe(256 * 2);
    const n = GetClassNameW(hwnd, buf, 256);
    if (n <= 0) return '';
    return koffi.decode(buf, 'char16_t', Math.min(n, 255));
  } catch (e) {
    return '';
  }
}

function getExePath(pid) {
  try {
    const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!h) return '';
    try {
      const size = [1024];
      const buf = Buffer.allocUnsafe(1024 * 2);
      const ok = QueryFullProcessImageNameW(h, 0, buf, size);
      if (!ok) return '';
      return koffi.decode(buf, 'char16_t', Math.min(Number(size[0]), 1023));
    } finally {
      CloseHandle(h);
    }
  } catch (e) {
    return '';
  }
}

function processKeyFromExe(exe) {
  if (!exe) return '';
  const base = path.basename(exe).replace(/\.exe$/i, '');
  return base.toLowerCase();
}

function processDisplayName(exe) {
  if (!exe) return '';
  return path.basename(exe).replace(/\.exe$/i, '');
}

// ---------- 权限检测 ----------
const elevCache = new Map();
let selfElevated = null;

function isElevated(pid) {
  if (elevCache.has(pid)) return elevCache.get(pid);
  let result = false;
  try {
    const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (h) {
      try {
        const tok = [null];
        if (OpenProcessToken(h, TOKEN_QUERY, tok) && tok[0]) {
          try {
            const elev = [0];
            const retLen = [0];
            if (GetTokenInformation(tok[0], TokenElevation, elev, 4, retLen)) result = elev[0] !== 0;
          } finally {
            CloseHandle(tok[0]);
          }
        }
      } finally {
        CloseHandle(h);
      }
    }
  } catch (e) { }
  elevCache.set(pid, result);
  return result;
}

function isSelfElevated() {
  if (selfElevated === null) selfElevated = isElevated(process.pid);
  return selfElevated;
}

// ---------- 扫描（窗口级） ----------
function scan() {
  const list = [];
  const selfPid = process.pid;
  const seenKeys = new Map(); // 基础 key -> 计数（同 pid 同标题多窗口加序号）
  try {
    EnumWindows((hwnd) => {
      try {
        if (!IsWindowVisible(hwnd)) return true;
        const pid = [null];
        const tid = GetWindowThreadProcessId(hwnd, pid);
        const pidv = Number(pid[0]);
        if (!pidv || pidv === selfPid) return true;
        const exStyle = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
        if (exStyle & WS_EX_TOOLWINDOW) return true;
        const cloaked = [0];
        const hr = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4);
        if (hr === 0 && cloaked[0] !== 0) return true;
        const cls = safeGetClassName(hwnd);
        if (SKIP_CLASSES.has(cls)) return true;
        const title = safeGetTitle(hwnd);
        if (!title) return true;
        const rect = [null];
        if (GetWindowRect(hwnd, rect) && (rect[0].right - rect[0].left <= 0 || rect[0].bottom - rect[0].top <= 0)) return true;
        const exe = getExePath(pidv);
        const procLower = processKeyFromExe(exe);
        if (!procLower) return true;

        // 唯一 key：pid|proc|title，同 pid 同标题的窗口追加序号
        let base = pidv + '|' + procLower + '|' + title;
        let n = seenKeys.get(base) || 0;
        n += 1;
        seenKeys.set(base, n);
        const key = n > 1 ? base + '~' + n : base;

        list.push({
          key,
          name: processDisplayName(exe),
          title,
          pid: pidv,
          exe,
          hwnd,
          hwnds: [hwnd],
          primaryHwnd: hwnd,
          winCount: 1,
          elevated: isElevated(pidv),
        });
      } catch (e) { /* 忽略单个窗口错误 */ }
      return true;
    }, 0);
  } catch (e) { /* EnumWindows 出错 */ }

  list.sort((a, b) => a.name.localeCompare(b.name) || a.title.localeCompare(b.title));
  return list;
}

// 前台窗口信息（用于匹配"当前是否某个条目"）
function getForegroundInfo() {
  try {
    const hwnd = GetForegroundWindow();
    if (!hwnd) return null;
    const pid = [null];
    GetWindowThreadProcessId(hwnd, pid);
    return { hwnd, pid: Number(pid[0]) || 0 };
  } catch (e) {
    return null;
  }
}

// 判断前台是否就是该窗口条目
function isCurrent(app, fgInfo) {
  if (!app || !fgInfo) return false;
  return !!fgInfo.hwnd && app.hwnds.includes(fgInfo.hwnd);
}

function isActivatable(app) {
  try {
    return !!(app && app.hwnd && IsWindow(app.hwnd));
  } catch (e) {
    return false;
  }
}

// ---------- 激活（强前置序列） ----------
function activate(app) {
  try {
    const hwnd = app.hwnd || (app.primaryHwnd || (app.hwnds && app.hwnds[0]));
    if (!hwnd || !IsWindow(hwnd)) return false;
    // 若最小化先还原
    if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
    ShowWindow(hwnd, SW_SHOW);

    const fg = GetForegroundWindow();
    const fgT = [null];
    const tgtT = [null];
    GetWindowThreadProcessId(fg, fgT);
    GetWindowThreadProcessId(hwnd, tgtT);
    let attached = false;
    if (fgT[0] && tgtT[0] && fgT[0] !== tgtT[0]) attached = AttachThreadInput(fgT[0], tgtT[0], true);

    // 置顶弹跳 + 前台
    SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
    SetForegroundWindow(hwnd);
    BringWindowToTop(hwnd);
    SwitchToThisWindow(hwnd, true);

    if (attached) AttachThreadInput(fgT[0], tgtT[0], false);

    // 兜底 1：模拟 Alt 键
    if (GetForegroundWindow() !== hwnd) {
      keybd_event(0x12, 0, 0, 0);
      SetForegroundWindow(hwnd);
      keybd_event(0x12, 0, 2, 0);
    }
    // 兜底 2：临时禁用前台锁定超时（对顽固窗口有效）
    if (GetForegroundWindow() !== hwnd) {
      SystemParametersInfoW(SPI_SETFOREGROUNDLOCKTIMEOUT, 0, 0, 0);
      SetForegroundWindow(hwnd);
      SystemParametersInfoW(SPI_SETFOREGROUNDLOCKTIMEOUT, 0, 200000, 0);
    }
    // 兜底 3：再试一次 SwitchToThisWindow
    if (GetForegroundWindow() !== hwnd) {
      SwitchToThisWindow(hwnd, true);
    }
    return GetForegroundWindow() === hwnd;
  } catch (e) {
    return false;
  }
}

// ---------- 最小化（专注模式用） ----------
function minimize(app) {
  try {
    const hwnd = app.hwnd || (app.primaryHwnd || (app.hwnds && app.hwnds[0]));
    if (hwnd && IsWindow(hwnd) && !IsIconic(hwnd)) {
      // SW_SHOWMINNOACTIVE(7)：最小化但不改变当前激活窗口（避免抢焦点）
      ShowWindow(hwnd, 7);
    }
  } catch (e) { }
}

// 结束进程：taskkill 先优雅关闭（WM_CLOSE），失败则 /f 强制结束（含子进程）
function runCmd(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000 }, (err) => resolve(!err));
  });
}
async function terminate(app) {
  try {
    if (app && app.pid) {
      let ok = await runCmd('taskkill', ['/pid', String(app.pid), '/t']);
      if (!ok) ok = await runCmd('taskkill', ['/pid', String(app.pid), '/f', '/t']);
      return ok;
    }
  } catch (e) { }
  return false;
}

// 应用图标（Windows：取 exe 关联的图标）
async function getIcon(app) {
  try {
    const electron = require('electron');
    const img = await electron.app.getFileIcon(app && app.exe ? app.exe : '', { size: 'normal' });
    return img && !img.isEmpty() ? img.toDataURL() : null;
  } catch (e) {
    return null;
  }
}

module.exports = { scan, getForegroundInfo, isCurrent, isActivatable, activate, minimize, terminate, isSelfElevated, getIcon };
