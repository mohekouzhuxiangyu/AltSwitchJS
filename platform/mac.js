'use strict';
// macOS 平台实现：使用系统自带工具（lsappinfo / open / osascript），无需额外依赖
//
// 注意：lsappinfo 的输出格式在不同 macOS 版本上差异很大。
// 早期版本为单行（pid=123, pname=..., bundleid=...），新版 macOS（如 Sequoia/Tahoe）
// 为「每条应用一个多行块」：
//   43) "Google Chrome" ASN:0x0-0x792792: (in front)
//       bundleID="com.google.Chrome"
//       bundle path="/Applications/Google Chrome.app"
//       executable path="..."
//       pid = 9731 type="Foreground" flavor=3 ... fileType="APPL" ...
// 本实现按块解析，兼容 list 与 info 两种输出。

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_NAME = 'AltSwitch';

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => {
      if (err) resolve('');
      else resolve(String(stdout || ''));
    });
  });
}

// 只关心命令是否成功（open / osascript 成功时 stdout 为空，不能按输出判断）
function runOk(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (err) => resolve(!err));
  });
}

// 取块内形如 `key="value"` 的字段值；值为 [ NULL ] 或缺失时返回 ''
function fieldValue(text, key) {
  const m = new RegExp(key + '\\s*=\\s*"([^"]*)"').exec(text);
  return m ? m[1] : '';
}

// ---------- 解析 lsappinfo 输出（list / info 通用） ----------
// 块首行：`N) "名称" ASN:0x0-0xXXXX: (in front)`（list）
//      或 `"名称" ASN:0x0-0xXXXX: (in front)`（info 单条）
function parseLsappinfo(text) {
  const apps = [];
  let block = null; // { header: [..], lines: [..] }
  const headerRe = /^\s*(?:\d+\)\s*)?"([^"]+)"\s+ASN:([0-9a-fxX-]+)/;
  const finish = () => {
    if (block) {
      const a = parseBlock(block);
      if (a) apps.push(a);
      block = null;
    }
  };
  for (const line of String(text || '').split('\n')) {
    const h = headerRe.exec(line);
    if (h) {
      finish();
      block = { header: h, lines: [line] };
    } else if (block) {
      block.lines.push(line);
    }
  }
  finish();
  return apps;
}

function parseBlock(block) {
  const name = (block.header[1] || '').trim();
  const asn = block.header[2] || '';
  const text = block.lines.join('\n');
  const pidM = /pid\s*=\s*(\d+)/.exec(text);
  if (!pidM || !name) return null;
  const typeM = /type="([^"]*)"/.exec(text);
  const fileTypeM = /fileType="([^"]*)"/.exec(text);
  const bundleid = fieldValue(text, 'bundleID');
  const bundlePath = fieldValue(text, 'bundle path');
  const exePath = fieldValue(text, 'executable path');
  const pid = parseInt(pidM[1], 10);
  return {
    key: name.toLowerCase(),
    name,
    pid,
    asn,
    type: typeM ? typeM[1] : '',
    fileType: fileTypeM ? fileTypeM[1] : '',
    bundleid,
    bundlePath,
    exePath,
    // exe 优先用 bundle 路径：getFileIcon / open 都按 .app 处理最可靠
    exe: bundlePath || exePath,
    hwnds: [pid],
    primaryHwnd: pid,
    hwnd: pid,
    winCount: 1,
    title: name,
    elevated: false, // macOS 无此概念
  };
}

// 过滤：只保留 Cmd+Tab（程序切换器）会显示的应用
// lsappinfo 的 type 对应 NSApplicationActivationPolicy：
//   Foreground   = 常规应用（有 Dock 图标）→ 出现在 Cmd+Tab
//   UIElement    = 菜单栏应用（聚焦/通知中心/Wi-Fi 等）→ 不出现
//   BackgroundOnly = 后台守护 / XPC 服务 → 不出现
function isListable(a) {
  if (!a || !a.pid) return false;
  if (a.name === APP_NAME) return false;
  if (a.type !== 'Foreground') return false;
  if (!a.bundleid && !a.bundlePath && !a.exePath) return false; // 无 Bundle 信息
  return true;
}

async function scan() {
  try {
    const out = await run('/usr/bin/lsappinfo', ['list']);
    const apps = parseLsappinfo(out).filter(isListable);
    apps.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN') || a.pid - b.pid);
    return apps;
  } catch (e) {
    return [];
  }
}

// 前台应用信息（lsappinfo front 只给 ASN，再用 info 查详情）
async function getForegroundInfo() {
  try {
    const front = String(await run('/usr/bin/lsappinfo', ['front'])).trim();
    const m = /ASN:([0-9a-fxX-]+)/.exec(front);
    if (!m) return null;
    const info = await run('/usr/bin/lsappinfo', ['info', 'ASN:' + m[1]]);
    const app = parseLsappinfo(info)[0];
    if (!app) return null;
    return { key: app.name.toLowerCase(), pid: app.pid, hwnd: app.pid };
  } catch (e) {
    return null;
  }
}

// 判断前台是否就是该应用
function isCurrent(app, fgInfo) {
  return !!(app && fgInfo && app.key === fgInfo.key);
}

function isActivatable(app) {
  return !!(app && (app.bundleid || app.exe));
}

function isSelfElevated() {
  return false; // macOS 无管理员/普通权限切换限制
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

// 结束进程：优先 AppleScript quit（优雅退出，等价 Cmd+Q），失败则 SIGTERM 兜底
async function terminate(app) {
  try {
    if (app && app.pid && app.bundleid) {
      const ok = await runOk('/usr/bin/osascript', ['-e', `tell application id "${app.bundleid}" to quit`]);
      if (ok) {
        for (let i = 0; i < 6; i++) {
          if (!isAlive(app.pid)) return true;
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
    // 兜底：SIGTERM（多数应用会优雅退出）
    if (app && app.pid) {
      try { process.kill(app.pid, 'SIGTERM'); } catch (e) { }
      for (let i = 0; i < 4; i++) {
        if (!isAlive(app.pid)) return true;
        await new Promise(r => setTimeout(r, 500));
      }
    }
    return !!(app && app.pid && !isAlive(app.pid));
  } catch (e) {
    return false;
  }
}

// 激活：优先用 bundle 路径 open（最可靠，能前置），再按名称，最后 AppleScript
async function activate(app) {
  try {
    if (app.exe) {
      const ok = await runOk('/usr/bin/open', [app.exe]);
      if (ok) return true;
    }
    const ok2 = await runOk('/usr/bin/open', ['-a', app.name]);
    if (ok2) return true;
    if (app.bundleid) {
      const ok3 = await runOk('/usr/bin/osascript', ['-e', `tell application id "${app.bundleid}" to activate`]);
      if (ok3) return true;
    }
  } catch (e) { }
  return false;
}

// 最小化（专注模式用）：隐藏应用窗口
// 注意：AppleScript 的 `tell application ... to hide` 在新版 macOS 上解析报错
// （变量 "hide" 未定义，-2753），专注模式因此从未生效。改用 System Events 的
// visible 属性（实测无需辅助功能权限），并按 bundle id 匹配进程，避免本地化
// 名称问题（如「访达」的进程名是 Finder）。
async function minimize(app) {
  try {
    let procQuery = '';
    if (app.bundleid) procQuery = `first process whose bundle identifier is "${app.bundleid}"`;
    else if (app.exePath) procQuery = `process "${path.basename(app.exePath)}"`;
    else procQuery = `process "${app.name}"`;
    await runOk('/usr/bin/osascript', ['-e',
      `tell application "System Events" to set visible of ${procQuery} to false`]);
  } catch (e) { }
}

// 应用图标：从 app bundle 的 .icns 提取真实图标
// （Electron 的 app.getFileIcon 在 macOS 上只返回通用占位图标，不能用于列表）
async function getIcon(app) {
  try {
    const bundlePath = app && app.bundlePath;
    if (!bundlePath || !fs.existsSync(bundlePath)) return null;
    const resources = path.join(bundlePath, 'Contents', 'Resources');
    if (!fs.existsSync(resources)) return null;

    // 优先按 Info.plist 的 CFBundleIconFile 找图标文件（不同应用文件名不一：app.icns / AppIcon.icns / icon.icns ...）
    let icns = '';
    const plist = path.join(bundlePath, 'Contents', 'Info.plist');
    if (fs.existsSync(plist)) {
      const iconFile = String(await run('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', plist])).trim().replace(/\.icns$/i, '');
      if (iconFile) {
        for (const cand of [iconFile + '.icns', iconFile]) {
          const p = path.join(resources, cand);
          if (fs.existsSync(p)) { icns = p; break; }
        }
      }
    }
    if (!icns) {
      const files = fs.readdirSync(resources).filter(f => /\.icns$/i.test(f)).sort();
      if (files.length) icns = path.join(resources, files[0]);
    }
    if (!icns) return null;

    const out = path.join(os.tmpdir(), 'altswitch-icon-' + app.pid + '.png');
    const ok = await runOk('/usr/bin/sips', ['-s', 'format', 'png', '-z', '64', '64', icns, '--out', out]);
    if (!ok || !fs.existsSync(out)) return null;
    const buf = fs.readFileSync(out);
    try { fs.unlinkSync(out); } catch (e) { }
    return 'data:image/png;base64,' + buf.toString('base64');
  } catch (e) {
    return null;
  }
}

module.exports = { scan, getForegroundInfo, isCurrent, isActivatable, activate, minimize, terminate, isSelfElevated, parseLsappinfo, getIcon };
