'use strict';
// AltSwitch 一键发布脚本
// 用法:  npm run release [新版本号] [--skip-build] [--skip-github] [--skip-npm] [--draft] [--upload-only] [--dry-run]
//
// 流程: 升版本号(npm version, 自动打 tag vX.Y.Z 并提交) → push master+tag
//       → 构建安装包 → 创建/更新 GitHub Release 并上传资产 → 发布 npm
//       --upload-only: 只把 release/ 下当前版本产物补传到已有 Release（不升版本/不构建/不发 npm）
//
// 认证:
//   GitHub: 环境变量 GITHUB_TOKEN / GH_TOKEN；macOS 上自动回退读取钥匙串凭据
//   npm:    环境变量 NPM_TOKEN（带 "Enable bypass 2FA" 的 granular token）
//
// 注意: macOS 构建只能在 macOS 上执行；Windows 构建在 Windows 上执行（自动切换）。

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = 'mohekouzhuxiangyu/AltSwitchJS';
const API = `https://api.github.com/repos/${REPO}`;
const UPLOADS = `https://uploads.github.com/repos/${REPO}`;
const NPM_REGISTRY = 'https://registry.npmjs.org/';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const newVersion = args.find(a => !a.startsWith('--'));
const skip = f => flags.has(f);
const dryRun = flags.has('--dry-run');

function sh(cmd) { console.log(`[release] $ ${cmd}`); return execSync(cmd, { stdio: 'inherit' }); }
function shOut(cmd) { return execSync(cmd, { encoding: 'utf8' }).trim(); }
// 网络抖动时重试（git push / 上传等）
function shRetry(cmd, tries = 5) {
  for (let i = 1; i <= tries; i++) {
    try { sh(cmd); return; } catch (e) {
      if (i === tries) throw e;
      log(`命令失败，${i * 6}s 后重试: ${cmd}`);
      execSync(`sleep ${i * 6}`);
    }
  }
}
function log(s) { console.log(`[release] ${s}`); }
function fail(msg) { console.error(`[release] ✗ ${msg}`); process.exit(1); }
function step(s) { console.log(`\n[release] === ${s} ===`); }

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.platform === 'darwin') {
    try {
      const out = execSync('printf "protocol=https\\nhost=github.com\\n\\n" | git credential-osxkeychain get', { encoding: 'utf8' });
      const line = out.split('\n').find(l => l.startsWith('password='));
      if (line && line.length > 9) return line.slice(9);
    } catch (e) { /* 忽略，走环境变量报错 */ }
  }
  return '';
}

async function api(pathname, opts = {}) {
  const token = githubToken();
  if (!token) fail('未找到 GitHub 令牌：请设置 GITHUB_TOKEN 环境变量（macOS 上会自动读取钥匙串）');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
  try {
    const res = await fetch(API + pathname, {
      method: opts.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    if (res.status === 404 && opts.allow404) return null;
    if (!res.ok) {
      const text = await res.text();
      fail(`GitHub API ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function uploadAsset(releaseId, name, filePath) {
  const token = githubToken();
  const sizeMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
  log(`上传 ${name} (${sizeMb} MB，curl 自动重试)…`);
  // 用临时 netrc 传令牌，避免令牌出现在命令行/进程列表
  const netrc = path.join(os.tmpdir(), `netrc-${Date.now()}`);
  fs.writeFileSync(netrc, `machine uploads.github.com login x-oauth-basic password ${token}\n`, { mode: 0o600 });
  const url = `${UPLOADS}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`;
  const cmd = [
    'curl -s -m 580 --retry 5 --retry-all-errors --retry-delay 15 --http2',
    `--netrc-file ${JSON.stringify(netrc)}`,
    '-X POST -H "Content-Type: application/octet-stream"',
    `--data-binary @${JSON.stringify(filePath)}`,
    JSON.stringify(url),
  ].join(' ');
  try {
    const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60 * 1000 });
    const j = JSON.parse(out);
    if (j && j.id) { log(`  ✓ ${name} 已上传`); return; }
    fail(`资产上传失败 ${name}: ${(j && j.message) || '未知错误'}`);
  } catch (e) {
    fail(`资产上传失败 ${name}: ${e.message}`);
  } finally {
    try { fs.unlinkSync(netrc); } catch (e) { }
  }
}

function releaseBody(version) {
  return [
    `# AltSwitch ${version}`,
    '',
    'macOS 风格的应用切换器（Windows / macOS），JS 技术栈（Electron）。',
    '',
    '## 功能',
    '- **Cmd+Tab 式列表**：仅列出系统切换器会显示的程序',
    '- **循环切换**：快捷键在勾选的程序间按"最近使用优先"循环',
    '- **专注模式（默认开启）**：切换时自动隐藏其他勾选窗口',
    '- **真实应用图标**：macOS 从 .icns 提取 / Windows 取 exe 图标',
    '- **macOS 菜单栏图标**：右上角模板图标，左键恢复、右键退出',
    '',
    '## 安装',
    '- `AltSwitch-${version}.dmg` / `AltSwitch-${version}-mac.zip`：Intel / 通用版',
    '- `AltSwitch-${version}-arm64.dmg` / `AltSwitch-${version}-arm64-mac.zip`：Apple Silicon',
    '',
    '> 应用未做 Apple 公证，首次打开请在「系统设置 → 隐私与安全性」选择"仍要打开"，或右键 → 打开。',
  ].join('\n');
}

async function publishGithub(version) {
  step('GitHub Release');
  const tag = `v${version}`;
  const release = await api(`/releases/tags/${tag}`, { allow404: true });
  let id, url;
  if (release) {
    id = release.id;
    url = release.html_url;
    log(`Release 已存在: ${url}`);
  } else {
    const created = await api('/releases', {
      method: 'POST',
      body: { tag_name: tag, name: `AltSwitch ${version}`, body: releaseBody(version), draft: flags.has('--draft'), prerelease: false },
      timeout: 60000,
    });
    id = created.id;
    url = created.html_url;
    log(`已创建 Release: ${url}`);
  }

  const existing = new Set((release ? release.assets : []).map(a => a.name));
  const dir = path.join(process.cwd(), 'release');
  if (!fs.existsSync(dir)) { log('无 release/ 目录，跳过资产上传'); return url; }
  // 只上传当前版本的产物（避免把旧版本的安装包传进新 Release）
  const assets = fs.readdirSync(dir)
    .filter(f => f.includes(`AltSwitch-${version}`) && /\.(dmg|zip|exe)$/.test(f) && !f.endsWith('.blockmap'))
    .sort();
  for (const name of assets) {
    if (existing.has(name)) { log(`跳过已上传: ${name}`); continue; }
    await uploadAsset(id, name, path.join(dir, name));
  }
  return url;
}

async function publishNpm() {
  step('npm 发布');
  const token = process.env.NPM_TOKEN;
  if (!token) fail('未找到 npm 令牌：请设置 NPM_TOKEN 环境变量（带 "Enable bypass 2FA" 的 granular token）');
  const tmp = path.join(os.tmpdir(), `npmrc-publish-${Date.now()}`);
  fs.writeFileSync(tmp, `//registry.npmjs.org/:_authToken=${token}\n`);
  try {
    sh(`npm publish --registry=${NPM_REGISTRY} --userconfig=${JSON.stringify(tmp)}`);
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { }
  }
}

(async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  let version = pkg.version;

  // 仅补传资产模式：不升版本/不推送/不构建/不发 npm，只把 release/ 下当前版本产物传到已有 Release
  if (flags.has('--upload-only')) {
    step(`仅上传资产（v${version}）`);
    if (dryRun) log('(dry-run) 将只上传 release/ 下当前版本资产');
    else {
      const url = await publishGithub(version);
      console.log(`[release] GitHub: ${url}`);
    }
    return;
  }

  if (newVersion) {
    step(`版本升级 ${version} → ${newVersion}`);
    const dirty = shOut('git status --porcelain').split('\n').filter(Boolean);
    if (dirty.length) fail(`工作区有未提交改动，请先提交或 stash：\n${dirty.join('\n')}`);
    if (dryRun) log(`(dry-run) 将执行: npm version ${newVersion}`);
    else sh(`npm version ${newVersion}`);
    version = newVersion;
  } else {
    let tagExists = false;
    try { shOut(`git rev-parse -q --verify refs/tags/v${version}`); tagExists = true; } catch (e) { }
    if (!tagExists) {
      log(`当前版本 v${version} 的 tag 不存在，自动创建…`);
      if (dryRun) log('(dry-run) 将执行: git tag -a v' + version);
      else sh(`git tag -a v${version} -m "AltSwitch v${version}"`);
    }
    log(`使用当前版本 v${version}`);
  }

  step('推送 git');
  if (dryRun) log('(dry-run) 将执行: git push origin master + v' + version);
  else {
    shRetry('git push origin master');
    shRetry(`git push origin v${version}`);
  }

  let releaseUrl = '';
  if (!skip('--skip-build')) {
    step('构建安装包');
    if (dryRun) log('(dry-run) 将执行构建');
    else if (process.platform === 'darwin') sh('npm run dist:mac');
    else if (process.platform === 'win32') sh('npm run dist:win');
    else log('⚠ 非 macOS/Windows，跳过构建（可加 --skip-build 显式跳过）');
  } else log('已跳过构建（--skip-build）');

  if (!skip('--skip-github')) {
    if (dryRun) log('(dry-run) 将创建/更新 GitHub Release 并上传 release/ 下的安装包');
    else releaseUrl = await publishGithub(version);
  } else log('已跳过 GitHub Release（--skip-github）');

  if (!skip('--skip-npm')) {
    if (dryRun) log('(dry-run) 将发布 npm: ' + pkg.name + '@' + version);
    else { await publishNpm(); log(`npm: https://www.npmjs.com/package/${pkg.name}`); }
  } else log('已跳过 npm 发布（--skip-npm）');

  console.log('\n[release] === 发布完成 ===');
  console.log(`[release] 版本:   v${version}`);
  console.log(`[release] GitHub: ${releaseUrl || `https://github.com/${REPO}/releases/tag/v${version}`}`);
  console.log(`[release] npm:    https://www.npmjs.com/package/${pkg.name}`);
})().catch(e => fail(e && e.message ? e.message : String(e)));
