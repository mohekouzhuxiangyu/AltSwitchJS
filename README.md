# AltSwitch 窗口切换器

macOS 风格的应用切换器，**Windows / macOS 通用**。JS 技术栈（Electron），界面中间为 macOS 风格卡片列表，工具条/状态栏为简洁普通样式，卡通风格的"窗口小精灵"图标。

把当前运行的应用列出来，**勾选常用的几个**，之后按一个快捷键（默认 `` Alt + ` ``）即可在它们之间**循环切换**（按"最近使用"顺序，类似 Alt+Tab）。

## 功能

- **窗口列表（按窗口）**：每个顶层窗口一行（Windows），同进程多窗口（如多个资源管理器窗口）**每个都能独立勾选和切换**；自动带图标、标题与管理员权限标记
- **勾选切换**：点击卡片勾选/取消，支持「全选 / 清空」；勾选状态自动保存
- **循环切换**：快捷键在勾选的窗口间按"最近使用优先"循环（跳过当前前台窗口）
- **专注模式（默认开启）**：切换时**只保留当前窗口，其他勾选窗口自动最小化**，可在界面随时关闭
- **快捷键可配置**：点「修改…」，直接按下新组合即可；支持 Ctrl / Alt / Shift / Win(Cmd) 任意组合、任意按键（`` ` ``、F1–F24、方向键、Space 等）
- **打开主窗口快捷键（可自定义）**：默认 `Cmd + Shift + Alt + A`，任意时刻一键唤出 AltSwitch 主窗口（隐藏/最小化时也可），支持像切换快捷键一样修改
- **管理员权限处理**：自动检测以管理员权限运行的程序（如腾讯系游戏客户端），卡片上标"管理员"徽标并提示；点「以管理员身份重启」经 UAC 确认后自动提权重启，即可正常切换它们
- **强前置**：多层置前方案（AttachThreadInput + 置顶弹跳 + 前台锁定超时重置 + SwitchToThisWindow）
- **结束进程**：鼠标悬停卡片出现 ✕ 按钮，点击确认后结束该应用（macOS 优雅退出 / Windows taskkill）
- **最小化**：关闭窗口即最小化到托盘（Windows 右下角托盘 / macOS 右上角菜单栏图标）并驻留后台，快捷键继续生效；点击托盘/菜单栏图标（macOS 右键可退出）或程序坞图标恢复
- **深色模式**：跟随系统亮/暗主题

## 安装方式（Windows / macOS 各四种）

### Windows

| 方式 | 文件 | 说明 |
|------|------|------|
| **① 安装器（推荐）** | `release\AltSwitch-Setup-1.0.0.exe` | 图形安装向导，**自动创建桌面快捷方式**和开始菜单项，可卸载 |
| **② 绿色版 zip** | `release\AltSwitch-win64.zip` | 解压即用，双击 `AltSwitch.exe`；也可用 `dist\AltSwitch-win32-x64.zip` |
| **③ 源码编译** | 本仓库 | 见下方「源码编译」 |
| **④ npm 安装** | `npm install alt-switch` | 从 npm 获取最新源码包（含完整 Electron 应用源码），再按下方「源码编译」安装依赖并运行 |

> 另提供 `release\AltSwitch-portable-1.0.0.exe` 单文件便携版（运行时不需安装）。

### macOS

| 方式 | 文件 | 说明 |
|------|------|------|
| **① dmg 镜像** | 在 Mac 上执行 `npm run dist:mac` 生成 `release\AltSwitch-1.0.0.dmg` | 打开后把 `.app` 拖入「应用程序」，再从「应用程序」拖到程序坞/桌面建快捷方式 |
| **② zip** | 同上生成 `release\AltSwitch-1.0.0-mac.zip` | 解压出 `.app`（可执行程序），拖入「应用程序」 |
| **③ 源码编译** | 本仓库 | 见下方「源码编译」 |
| **④ npm 安装** | `npm install alt-switch` | 从 npm 获取最新源码包（含完整 Electron 应用源码），再按下方「源码编译」安装依赖并运行 |

### 源码编译（跨平台）

需要 Node.js 18+ 与 git：

```bash
git clone <仓库地址> && cd AltSwitchJS
npm install
npm start                # 开发模式运行
npm run dist:all         # ★ 一条命令同时构建 macOS + Windows（推荐）
npm run dist:win         # 仅 Windows（安装器 + portable）
npm run dist:mac         # 仅 macOS（dmg + zip）
npm run release          # 一键发布（构建双平台 → GitHub Release → npm）
```

> **双平台构建说明**：`dist:all` 在 **macOS 上即可同时构建 macOS 与 Windows 两个平台**（electron-builder 交叉构建 Windows，无需 wine）。Windows 机器上只能构建 Windows 产物（macOS 应用必须在 macOS 上构建），发布请使用 macOS 机器。

> 国内网络：安装依赖/打包时若二进制下载失败，先设置镜像：
> `$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"` 与
> `$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"`（Windows PowerShell）
> （macOS/Linux 用 `export` 替代 `$env:...=`）

## 使用说明

1. **启动**：双击桌面图标（安装器）/ `AltSwitch.exe`（绿色版）/ `npm start`（源码）
2. **勾选**：点击列表中的卡片勾选要参与切换的窗口；「全选 / 清空」一键操作
3. **切换**：按默认快捷键 `` Alt + ` `` 在勾选的窗口间循环切换
4. **改快捷键**：点「修改…」，直接按下新组合（例如 `Ctrl + Alt + F9`）；「切换快捷键」与「打开窗口」两个快捷键各自独立修改
5. **唤出主窗口**：任意时刻按 `Cmd + Shift + Alt + A`（默认，可自定义）打开 AltSwitch 主窗口，即使窗口已隐藏/最小化
6. **专注模式**：右上角开关，开启后切换时只保留当前窗口
7. **隐藏**：关闭窗口 = 最小化（快捷键仍生效）；Windows 托盘 / macOS 程序坞点击恢复

### 管理员权限程序（如英雄联盟客户端）

腾讯系游戏客户端（如 LeagueClientUx）通常以管理员权限运行，普通权限的切换器无法抢焦点。此时：

1. 列表中该程序卡片带红色「管理员」徽标，顶部出现橙色提示条
2. 点「以管理员身份重启」→ 系统弹出 UAC 确认 → 确认后自动以管理员身份重启
3. 重启后即可正常切换到这些程序（管理员版界面不再显示提权提示）

> 若 UAC 被取消或提权失败，界面会提示手动操作：右键 `AltSwitch.exe` →「以管理员身份运行」。

### 配置文件

`%APPDATA%\AltSwitch\config.json`（Windows）/ `~/Library/Application Support/AltSwitch/config.json`（macOS）：

```json
{
  "mods": 1,                    // 切换快捷键：1=Alt 2=Ctrl 4=Shift 8=Win/Cmd
  "key": "`",                   // 切换快捷键主键
  "winMods": 13,                // 打开主窗口快捷键修饰键（13 = Alt+Shift+Cmd）
  "winKey": "A",                // 打开主窗口快捷键主键
  "selected": ["pid|进程|标题"], // 勾选的窗口
  "focusMode": true             // 专注模式开关（默认开启）
}
```

勾选记录为窗口键（`进程PID|进程名|窗口标题`），窗口关闭后需重新勾选；也兼容旧的进程级键（如 `chrome`）。

## 常见问题

- **快捷键冲突**：默认 `` Alt + ` `` 被其它程序占用时，界面显示红色提示，点「修改…」换一个即可
- **切换不了某些程序**：多为管理员权限目标（见上）或全屏游戏独占键盘
- **macOS 权限**：基于系统自带 `lsappinfo` / `open`，一般无需额外权限；个别应用拒绝被激活时，在「系统设置 → 隐私与安全性 → 辅助功能」中允许本程序
- **桌面图标没更新**：换图标后若快捷方式仍显示旧图标，重启资源管理器（任务管理器 → Windows 资源管理器 → 重新启动）即可

## 已交付的 Windows 产物（release/）

- `AltSwitch-Setup-1.0.0.exe` — **安装器**（安装、桌面快捷方式、卸载均正常）
- `AltSwitch-win64.zip` — 绿色版（解压即用，含最新代码）
- `AltSwitch-portable-1.0.0.exe` — 单文件便携版
- `win-unpacked/` — 免安装目录版

## 技术栈与结构

- **Electron**：跨平台桌面外壳
- **koffi**（Windows）：FFI 调用 Win32 API（EnumWindows / SendMessageTimeout / SetForegroundWindow 等）
- **macOS**：系统自带 `lsappinfo` / `open` / `osascript`，无额外依赖
- 无任何原生模块编译，纯 JS

```
AltSwitchJS/
├── main.js            # 主进程：快捷键/切换逻辑/提权重启/托盘/配置/IPC
├── preload.js         # 安全桥
├── platform/
│   ├── win.js         # Windows 实现（koffi FFI：枚举/激活/权限检测）
│   ├── mac.js         # macOS 实现（系统工具）
│   └── index.js       # 平台选择
├── renderer/          # UI（HTML/CSS/JS）
├── assets/            # 图标（icon.png / icon.ico / tray16.png）
├── packaging/
│   ├── install.nsi    # NSIS 备用安装脚本
│   └── icogen.cs      # 图标生成工具（多尺寸 ico）
├── release/           # 构建产物（安装器/zip/portable）
└── test-ffi.js        # FFI 层自测（node test-ffi.js）
```

## 更新日志

- **图标**：卡通风格"窗口小精灵"（微笑窗口 + 红绿灯 + 星星），多尺寸 ico/托盘图标
- **管理员提权重启**：改用 ShellExecuteW(runas) 触发 UAC（不再依赖 PowerShell），并解决旧实例退出与新实例单实例锁的时序冲突
- **专注模式**：切换时最小化其他勾选窗口，只保留当前窗口
- **窗口级切换**：每个顶层窗口独立勾选/切换（多个资源管理器窗口不再合并）
- **权限检测**：管理员权限程序自动标注并提示提权
