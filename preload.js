'use strict';
// 预加载脚本：安全暴露 IPC 桥接到渲染进程
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('altSwitch', {
  getState: () => ipcRenderer.invoke('get-state'),
  setSelected: (keys) => ipcRenderer.invoke('set-selected', keys),
  setHotkey: (h) => ipcRenderer.invoke('set-hotkey', h),
  refresh: () => ipcRenderer.invoke('refresh'),
  showWindow: () => ipcRenderer.invoke('show-window'),
  quit: () => ipcRenderer.invoke('quit'),
  relaunchAdmin: () => ipcRenderer.invoke('relaunch-admin'),
  setFocusMode: (v) => ipcRenderer.invoke('set-focus-mode', v),
  killApp: (key) => ipcRenderer.invoke('kill-app', key),
  onState: (cb) => {
    ipcRenderer.on('state', (_e, s) => cb(s));
  },
});
