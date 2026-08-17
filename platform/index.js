'use strict';
// 平台层选择器：Windows 用 koffi FFI，macOS 用系统工具
// 统一异步契约：scan/getForegroundInfo/activate 返回 Promise；isCurrent/isActivatable/isSelfElevated 同步

let impl;
if (process.platform === 'win32') {
  impl = require('./win.js');
} else if (process.platform === 'darwin') {
  impl = require('./mac.js');
} else {
  impl = null;
}

const wrap = (fn) => (...args) => Promise.resolve(fn ? fn.apply(impl, args) : null);

module.exports = impl ? {
  scan: wrap(impl.scan),
  getForegroundInfo: wrap(impl.getForegroundInfo),
  isCurrent: impl.isCurrent || (() => false),
  isActivatable: impl.isActivatable || (() => false),
  isSelfElevated: impl.isSelfElevated || (() => false),
  activate: wrap(impl.activate),
  minimize: wrap(impl.minimize),
  terminate: wrap(impl.terminate),
  isModifierKeyDown: wrap(impl.isModifierKeyDown),
  getIcon: wrap(impl.getIcon),
} : {
  scan: () => Promise.resolve([]),
  getForegroundInfo: () => Promise.resolve(null),
  isCurrent: () => false,
  isActivatable: () => false,
  isSelfElevated: () => false,
  activate: () => Promise.resolve(false),
  minimize: () => Promise.resolve(null),
  terminate: () => Promise.resolve(false),
  isModifierKeyDown: () => Promise.resolve(false),
  getIcon: () => Promise.resolve(null),
};
