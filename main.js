'use strict';
// AltSwitch 主进程：窗口 / 全局快捷键 / 循环切换 / 托盘 / 配置 / IPC

const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const platform = require('./platform');

// ---------- 全局状态 ----------
let win = null;
let tray = null;
let quitting = false;

let cfg = loadConfig();                 // { mods, key, selected: [key...] }
let apps = [];                          // 最近一次扫描结果
let mru = [];                           // 最近使用顺序：索引 0 = 最久未用（下一个被切换）
let hotkey = { mods: cfg.mods || 1, key: cfg.key || '`' };                       // 切换快捷键
let winHotkey = { mods: cfg.winMods === undefined ? 13 : cfg.winMods, key: cfg.winKey || 'A' }; // 打开主窗口快捷键（默认 Cmd+Shift+Alt+A）
let hotkeyOk = false;
let hotkeyErr = '';
let winHotkeyOk = false;
let winHotkeyErr = '';
let lastFgKey = null;
let lastSwitchError = '';
let selfElevated = false;
const iconCache = new Map();            // exe -> dataURL

// ---------- 修饰键定义 ----------
const IS_MAC = process.platform === 'darwin';
const MODS = [
  { bit: 2, label: 'Ctrl', accel: 'Control' },
  { bit: 1, label: 'Alt', accel: 'Alt' },
  { bit: 4, label: 'Shift', accel: 'Shift' },
  { bit: 8, label: IS_MAC ? 'Cmd' : 'Win', accel: IS_MAC ? 'Command' : 'Super' },
];

function modsLabel(mods) {
  const parts = [];
  for (const m of MODS) if (mods & m.bit) parts.push(m.label);
  return parts.join(' + ');
}
function modsAccel(mods) {
  const parts = [];
  for (const m of MODS) if (mods & m.bit) parts.push(m.accel);
  return parts.join('+');
}
function hotkeyDisplay() {
  const m = modsLabel(hotkey.mods);
  return m ? `${m} + ${hotkey.key}` : hotkey.key;
}
function winHotkeyDisplay() {
  const m = modsLabel(winHotkey.mods);
  return m ? `${m} + ${winHotkey.key}` : winHotkey.key;
}
function accelString() {
  const m = modsAccel(hotkey.mods);
  return m ? `${m}+${hotkey.key}` : hotkey.key;
}
function winAccelString() {
  const m = modsAccel(winHotkey.mods);
  return m ? `${m}+${winHotkey.key}` : winHotkey.key;
}

// ---------- 配置 ----------
function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}
function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return {
      mods: typeof c.mods === 'number' ? c.mods : 1,
      key: typeof c.key === 'string' && c.key ? c.key : '`',
      // 打开主窗口快捷键：默认 Cmd+Shift+Alt+A（bit: Alt1|Shift4|Cmd8=13）
      winMods: c.winMods === undefined ? 13 : c.winMods,
      winKey: typeof c.winKey === 'string' && c.winKey ? c.winKey : 'A',
      selected: Array.isArray(c.selected) ? c.selected : [],
      // 专注模式默认开启：旧配置无此字段时也按开启处理，用户显式关闭过则保持关闭
      focusMode: c.focusMode === undefined ? true : !!c.focusMode,
    };
  } catch (e) {
    return { mods: 1, key: '`', winMods: 13, winKey: 'A', selected: [], focusMode: true };
  }
}
function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
  } catch (e) { }
}

// ---------- 快捷键 ----------
function applyHotkey() {
  globalShortcut.unregisterAll();
  hotkeyOk = false;
  hotkeyErr = '';
  winHotkeyOk = false;
  winHotkeyErr = '';
  // 切换快捷键
  const accel = accelString();
  try {
    hotkeyOk = globalShortcut.register(accel, () => switchNext());
  } catch (e) {
    hotkeyErr = String((e && e.message) || e);
  }
  if (!hotkeyOk) hotkeyErr = `注册失败：${accel} 已被占用或系统不允许`;
  // 打开主窗口快捷键
  const wAccel = winAccelString();
  try {
    winHotkeyOk = globalShortcut.register(wAccel, () => showWindow());
  } catch (e) {
    winHotkeyErr = String((e && e.message) || e);
  }
  if (!winHotkeyOk) winHotkeyErr = `注册失败：${wAccel} 已被占用或系统不允许`;
  pushState();
}

// 兼容旧配置：既支持窗口级 key（pid|proc|title），也支持旧进程级 key（proc）
function isSelected(app) {
  return cfg.selected.includes(app.key) || cfg.selected.includes(app.name.toLowerCase());
}

// ---------- 切换（窗口级循环：最近使用优先） ----------
async function switchNext() {
  const cands = apps.filter(a => isSelected(a) && platform.isActivatable(a));
  if (!cands.length) return;
  const cur = await platform.getForegroundInfo();
  let target = null;
  if (cands.length === 1) {
    target = cands[0];
  } else {
    // 从最久未用开始，跳过当前前台窗口
    for (const key of mru) {
      const a = cands.find(x => x.key === key);
      if (a && !platform.isCurrent(a, cur)) { target = a; break; }
    }
    if (!target) target = cands[0];
  }
  const ok = await platform.activate(target);
  if (ok) {
    // 专注模式：最小化其他已选窗口，只保留当前切换到的窗口（并行隐藏，避免逐个等待）
    if (cfg.focusMode) {
      await Promise.all(cands.filter(a => a.key !== target.key).map(a => platform.minimize(a)));
    }
    // 激活后把目标移到"最近使用"端
    mru = mru.filter(k => k !== target.key);
    mru.push(target.key);
    // 补充：保证所有已选 key 都在 mru 中（新勾选的排在最久端）
    for (const a of cands) if (!mru.includes(a.key)) mru.unshift(a.key);
  } else if (target.elevated && !platform.isSelfElevated()) {
    // 目标以管理员运行而自身不是：激活必然失败，提示用户提权
    lastSwitchError = '无法切换到「' + target.name + '」：它以管理员权限运行，请点击上方按钮以管理员身份重启';
    pushState();
  }
}

// 前台轮询：用户手动切到已选窗口时更新 MRU（窗口级匹配）
setInterval(async () => {
  const info = await platform.getForegroundInfo();
  if (!info) return;
  const app = apps.find(a => platform.isCurrent(a, info) && isSelected(a));
  if (app && app.key !== lastFgKey) {
    mru = mru.filter(k => k !== app.key);
    mru.push(app.key);
    lastFgKey = app.key;
  }
}, 500);

// ---------- 扫描 ----------
async function scanLoop() {
  try {
    const fresh = await platform.scan();
    apps = fresh;
    for (const a of apps) if (isSelected(a) && !mru.includes(a.key)) mru.unshift(a.key);
    pushState();
    loadIcons();
  } catch (e) {
    console.error('scan error:', e);
  }
}

async function loadIcons() {
  for (const a of apps) {
    if (!a.exe || iconCache.has(a.exe)) continue;
    try {
      const dataUrl = await platform.getIcon(a);
      iconCache.set(a.exe, dataUrl || null);
    } catch (e) {
      iconCache.set(a.exe, null);
    }
  }
  pushState();
}

// ---------- 状态推送 ----------
function buildState() {
  const selectedSet = new Set(cfg.selected);
  selfElevated = platform.isSelfElevated();
  return {
    apps: apps.map(a => ({
      key: a.key,
      name: a.name,
      title: a.title || a.name,
      icon: iconCache.get(a.exe) || null,
      winCount: a.winCount || 1,
      elevated: !!a.elevated,
      selected: isSelected(a),
    })),
    selectedCount: apps.filter(a => isSelected(a)).length,
    totalCount: apps.length,
    hotkey: hotkeyDisplay(),
    hotkeyOk,
    hotkeyErr,
    winHotkey: winHotkeyDisplay(),
    winHotkeyOk,
    winHotkeyErr,
    platform: process.platform,
    selfElevated,
    lastSwitchError,
    focusMode: cfg.focusMode,
  };
}
function pushState() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('state', buildState());
  }
}

// ---------- 窗口 / 托盘 ----------
function createWindow() {
  win = new BrowserWindow({
    width: 580,
    height: 680,
    minWidth: 460,
    minHeight: 540,
    title: 'AltSwitch 窗口切换器',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // 调试：--capture <path> 截取页面内容后退出
  const capIdx = process.argv.indexOf('--capture');
  if (capIdx !== -1 && process.argv[capIdx + 1]) {
    const out = process.argv[capIdx + 1];
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(out, img.toPNG());
          console.log('captured to', out);
        } catch (e) {
          console.error('capture failed', e);
        }
        quit();
      }, 1500);
    });
  }
  // 关闭 = 隐藏到托盘/程序坞（快捷键继续生效）
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

function createTray() {
  const isMac = process.platform === 'darwin';
  // macOS 用专用模板图标（黑+透明，自动适配深浅色菜单栏）；Windows 用彩色托盘图
  let iconPath = path.join(__dirname, 'assets', isMac ? 'tray-mac.png' : 'tray16.png');
  let icon = null;
  try { icon = nativeImage.createFromPath(iconPath); } catch (e) { }
  if (isMac && icon && !icon.isEmpty()) {
    // macOS 菜单栏图标用模板图：自动适配浅色/深色菜单栏
    icon.setTemplateImage(true);
  }
  tray = new Tray(icon && !icon.isEmpty() ? icon : nativeImage.createEmpty());
  tray.setToolTip('AltSwitch 窗口切换器');
  const menu = Menu.buildFromTemplate([
    { label: '显示窗口', click: showWindow },
    { type: 'separator' },
    { label: '退出', click: () => quit() },
  ]);
  if (isMac) {
    // macOS：右上角菜单栏图标，左键点击恢复窗口，右键弹出菜单
    tray.on('click', showWindow);
    tray.on('right-click', () => tray.popUpContextMenu(menu));
  } else {
    tray.setContextMenu(menu);
    tray.on('double-click', showWindow);
  }
}

function quit() {
  quitting = true;
  globalShortcut.unregisterAll();
  app.quit();
  // 兜底：个别环境下 app.quit 可能不终止进程，2 秒后强制退出
  setTimeout(() => { try { process.exit(0); } catch (e) { } }, 2000);
}

// ---------- 结束进程 ----------
async function killAppByKey(key, confirm) {
  const appObj = apps.find(a => a.key === key);
  if (!appObj) return { ok: false, err: '未找到该应用' };
  if (confirm && win && !win.isDestroyed()) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['结束进程', '取消'],
      defaultId: 1,
      cancelId: 1,
      title: '结束进程',
      message: `确定要结束「${appObj.name}」吗？`,
      detail: '该应用的未保存内容可能会丢失。',
    });
    if (response !== 0) return { ok: false, canceled: true };
  }
  const ok = await platform.terminate(appObj);
  scanLoop(); // 结束后立即刷新列表
  pushState();
  return { ok, name: appObj.name };
}

// ---------- IPC ----------
ipcMain.handle('get-state', () => buildState());
ipcMain.handle('set-selected', (e, keys) => {
  cfg.selected = Array.isArray(keys) ? keys : [];
  saveConfig();
  pushState();
});
ipcMain.handle('set-hotkey', (e, { which, mods, key }) => {
  const isWin = which === 'window';
  const old = isWin ? { ...winHotkey } : { ...hotkey };
  if (isWin) winHotkey = { mods: Number(mods) || 0, key: String(key || '') };
  else hotkey = { mods: Number(mods) || 0, key: String(key || '') };
  applyHotkey();
  if (isWin ? winHotkeyOk : hotkeyOk) {
    if (isWin) {
      cfg.winMods = winHotkey.mods;
      cfg.winKey = winHotkey.key;
    } else {
      cfg.mods = hotkey.mods;
      cfg.key = hotkey.key;
    }
    saveConfig();
  } else {
    if (isWin) winHotkey = old; else hotkey = old; // 还原
    applyHotkey();
  }
  return { ok: isWin ? winHotkeyOk : hotkeyOk, err: isWin ? winHotkeyErr : hotkeyErr, hotkey: isWin ? winHotkeyDisplay() : hotkeyDisplay() };
});
ipcMain.handle('refresh', () => scanLoop());
ipcMain.handle('kill-app', (e, key) => killAppByKey(key, true));
ipcMain.handle('show-window', () => showWindow());
ipcMain.handle('quit', () => quit());
ipcMain.handle('set-focus-mode', (e, v) => {
  cfg.focusMode = !!v;
  saveConfig();
  pushState();
});

// 以管理员身份重启（UAC 提权，用于切换管理员权限运行的程序）
ipcMain.handle('relaunch-admin', () => {
  try {
    // 直接用 ShellExecuteW(runas) 触发 UAC，不依赖 PowerShell（更可靠）
    const koffi = require('koffi');
    const shell32 = koffi.load('shell32.dll');
    const ShellExecuteW = shell32.func('intptr_t __stdcall ShellExecuteW(intptr_t hwnd, const char16_t *lpVerb, const char16_t *lpFile, const char16_t *lpParameters, const char16_t *lpDirectory, int32 nShowCmd)');

    const exe = process.execPath;
    // 普通参数（相对路径转绝对，避免提权后工作目录变化），并追加 --wait-for-exit <当前pid>
    // 提权后的新实例会等待旧实例完全退出再初始化，避免单实例锁冲突
    const argParts = process.argv.slice(1).map(a => {
      const isRel = a === '.' || a === '..' || (a.startsWith('.') && !/^[A-Za-z]:[\\/]/.test(a));
      const full = isRel ? path.resolve(a) : a;
      return '"' + full.replace(/"/g, '\\"') + '"';
    });
    argParts.push('"--wait-for-exit"', String(process.pid));
    const params = argParts.join(' ');

    const result = Number(ShellExecuteW(0, 'runas', exe, params, process.cwd(), 1));
    if (result > 32) {
      // 提权启动请求已被接受（UAC 弹窗或已启动），稍后退出当前实例
      lastSwitchError = '正在以管理员身份重启…';
      pushState();
      setTimeout(() => quit(), 300);
      return { ok: true };
    }
    lastSwitchError = '提权重启未完成（错误码 ' + result + '）：请手动右键 AltSwitch.exe 选择「以管理员身份运行」';
    pushState();
    return { ok: false, err: lastSwitchError };
  } catch (e) {
    lastSwitchError = '提权重启失败：' + (e && e.message ? e.message : String(e));
    pushState();
    return { ok: false, err: lastSwitchError };
  }
});

// ---------- 生命周期 ----------
// 提权重启场景：新实例带 --wait-for-exit <旧pid>，等待旧实例完全退出后再初始化（避免单实例锁冲突）
const waitPidArg = process.argv.indexOf('--wait-for-exit');
const waitForPid = waitPidArg !== -1 ? parseInt(process.argv[waitPidArg + 1], 10) : 0;

async function waitForOldExit(pid) {
  for (let i = 0; i < 80; i++) {
    let alive = true;
    try { process.kill(pid, 0); } catch (e) { alive = false; }
    if (!alive) return;
    await new Promise(r => setTimeout(r, 300));
  }
}

app.whenReady().then(async () => {
  if (waitForPid) {
    await waitForOldExit(waitForPid);
  }
  if (!app.requestSingleInstanceLock()) {
    console.error('single-instance lock not acquired, quitting');
    app.quit();
    return;
  }
  app.on('second-instance', () => showWindow());

  createWindow();
  createTray();
  applyHotkey();
  scanLoop();
  if (!process.env.ALTSWITCH_NO_SCAN) setInterval(scanLoop, 2000);

  // 测试辅助：--test-quit <ms> 指定时间后退出（quit 自带 process.exit 兜底）
  const tqIdx = process.argv.indexOf('--test-quit');
  if (tqIdx !== -1) {
    const ms = parseInt(process.argv[tqIdx + 1], 10) || 5000;
    setTimeout(() => { quit(); }, ms);
  }

  // 测试辅助：--test-switch <ms> 指定时间后触发一次切换（用于端到端验证切换/专注模式）
  const tsIdx = process.argv.indexOf('--test-switch');
  if (tsIdx !== -1) {
    const ms = parseInt(process.argv[tsIdx + 1], 10) || 3000;
    setTimeout(() => { switchNext(); }, ms);
  }

  // 测试辅助：--test-kill <key> <ms> 指定时间后结束某应用（跳过确认框，端到端测试用）
  const tkIdx = process.argv.indexOf('--test-kill');
  if (tkIdx !== -1) {
    const key = process.argv[tkIdx + 1];
    const ms = parseInt(process.argv[tkIdx + 2], 10) || 5000;
    setTimeout(() => { killAppByKey(key, false); }, ms);
  }

  app.on('activate', () => showWindow()); // macOS 点击 Dock 图标
});

  // macOS：关闭窗口后应用常驻（点击 Dock 恢复）
  app.on('window-all-closed', () => {
    if (process.platform === 'darwin' && !quitting) return;
    if (quitting) app.quit();
  });

  app.on('before-quit', () => { quitting = true; });

