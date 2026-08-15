'use strict';
// koffi FFI 层独立验证脚本：node test-ffi.js
// 只读测试：窗口级枚举、标题、权限检测、前台窗口；可选激活测试

const win = require('./platform/win.js');

async function main() {
  console.log('=== 窗口级扫描测试 ===');
  const apps = win.scan();
  console.log('窗口数:', apps.length);
  for (const a of apps.slice(0, 25)) {
    console.log(`  ${a.key.padEnd(30)} | ${a.name.padEnd(14)} | ${a.elevated ? 'ELEVATED' : 'normal '} | ${a.title}`);
  }

  console.log('\n=== 前台窗口测试 ===');
  const fg = win.getForegroundInfo();
  console.log('前台:', fg ? `hwnd=${fg.hwnd} pid=${fg.pid}` : 'null');
  const cur = apps.find(a => win.isCurrent(a, fg));
  console.log('匹配条目:', cur ? cur.title : '无（可能不在列表）');

  console.log('\n=== 自身权限 ===');
  console.log('selfElevated:', win.isSelfElevated());

  console.log('\n=== 激活测试（选第一个普通权限窗口，1 秒后恢复）===');
  const target = apps.find(a => !a.elevated);
  if (target) {
    console.log('目标:', target.key, target.title);
    const ok = win.activate(target);
    console.log('激活结果:', ok);
    await new Promise(r => setTimeout(r, 1200));
    const fg2 = win.getForegroundInfo();
    console.log('激活后前台 hwnd:', fg2 ? fg2.hwnd : 'null', '匹配:', fg2 && win.isCurrent(target, fg2));
  } else {
    console.log('没有普通权限窗口');
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
