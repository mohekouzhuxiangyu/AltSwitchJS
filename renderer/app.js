'use strict';
// 渲染进程逻辑：列表渲染 / 勾选 / 快捷键捕获对话框

const api = window.altSwitch;
let state = null;
let platformName = 'win32';

// ---------- 工具 ----------
function el(id) { return document.getElementById(id); }

const MOD_LABELS = [
  { bit: 2, label: 'Ctrl' },
  { bit: 1, label: 'Alt' },
  { bit: 4, label: 'Shift' },
  { bit: 8, label: 'Meta' },
];
function modsLabel(mods, isMac) {
  const parts = [];
  for (const m of MOD_LABELS) {
    if (mods & m.bit) parts.push(m.bit === 8 ? (isMac ? 'Cmd' : 'Win') : m.label);
  }
  return parts.join(' + ');
}

// e.code -> Electron 加速键 token（基础键，与 Shift 无关）
const CODE_TO_KEY = {
  Space: 'Space', Tab: 'Tab', Enter: 'Return', Escape: 'Escape',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  IntlBackslash: '\\',
};
function codeToKey(code) {
  if (CODE_TO_KEY[code]) return CODE_TO_KEY[code];
  const m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  const d = /^Digit([0-9])$/.exec(code);
  if (d) return d[1];
  const f = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  if (f) return 'F' + f[1];
  const n = /^Numpad([0-9])$/.exec(code);
  if (n) return 'num' + n[1];
  return null;
}

// e.code 缺失（如合成按键）时用 e.key 兜底
function keyFromEvent(e) {
  const k = codeToKey(e.code);
  if (k) return k;
  if (/^[a-zA-Z]$/.test(e.key)) return e.key.toUpperCase();
  if (/^[0-9]$/.test(e.key)) return e.key;
  const special = { ' ': 'Space', Tab: 'Tab', Enter: 'Return', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  if (special[e.key]) return special[e.key];
  const shifted = { '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/' };
  if (shifted[e.key]) return shifted[e.key];
  if (e.key && e.key.length === 1) return e.key;
  return null;
}

// ---------- 头像颜色 ----------
function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 50%)`;
}

// ---------- 渲染 ----------
function checkSvg() {
  return '<svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 6.5 L4.8 9.2 L10 3.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function render() {
  if (!state) return;
  platformName = state.platform || platformName;
  const isMac = platformName === 'darwin';
  el('hotkey').textContent = state.hotkey;
  const st = el('hotkey-status');
  if (state.lastSwitchError) {
    st.textContent = state.lastSwitchError;
    st.className = 'status err';
    st.title = state.lastSwitchError;
  } else if (state.hotkeyOk) {
    st.textContent = '✓ 已启用';
    st.className = 'status ok';
  } else {
    st.textContent = state.hotkeyErr || '未注册';
    st.className = 'status err';
  }
  el('count').textContent = `已选 ${state.selectedCount} / ${state.totalCount}`;

  // 专注模式开关状态
  const sw = el('switch-focus');
  if (state.focusMode) sw.classList.add('on'); else sw.classList.remove('on');

  // 管理员权限提示
  const adminBar = el('admin-bar');
  const hasElevatedTarget = state.apps.some(a => a.selected && a.elevated);
  if (!isMac && hasElevatedTarget && !state.selfElevated) {
    adminBar.classList.remove('hidden');
    el('admin-msg').textContent = '勾选了以管理员权限运行的程序（如游戏客户端），需要管理员身份才能切换到它们';
  } else if (!isMac && !state.selfElevated && state.selectedCount > 0) {
    adminBar.classList.remove('hidden');
    el('admin-msg').textContent = '当前为普通权限；如发现某些程序无法切换，请以管理员身份重启';
  } else {
    adminBar.classList.add('hidden');
  }

  const list = el('list');
  list.innerHTML = '';
  if (!state.apps.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = '没有检测到可切换的窗口';
    list.appendChild(d);
    return;
  }
  for (const a of state.apps) {
    const card = document.createElement('div');
    card.className = 'card' + (a.selected ? ' on' : '');
    card.dataset.key = a.key;

    const chk = document.createElement('div');
    chk.className = 'checkbox';
    chk.innerHTML = checkSvg();

    const av = document.createElement('div');
    av.className = 'avatar';
    if (a.icon) {
      av.innerHTML = `<img src="${a.icon}" alt="">`;
    } else {
      av.style.background = colorFor(a.key);
      av.textContent = (a.name || '?').charAt(0).toUpperCase();
    }

    const body = document.createElement('div');
    body.className = 'card-body';
    const titleRow = document.createElement('div');
    titleRow.className = 'card-title';
    titleRow.textContent = a.title;
    if (a.elevated) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '管理员';
      titleRow.appendChild(badge);
    }
    const sub = document.createElement('div');
    sub.className = 'card-sub';
    sub.textContent = a.name + (a.winCount > 1 ? ` · ${a.winCount} 个窗口` : '');

    body.appendChild(titleRow);
    body.appendChild(sub);
    card.appendChild(chk);
    card.appendChild(av);
    card.appendChild(body);
    card.addEventListener('click', () => toggle(a.key));
    list.appendChild(card);
  }
}

async function toggle(key) {
  const sel = new Set(state.apps.filter(x => x.selected).map(x => x.key));
  if (sel.has(key)) sel.delete(key); else sel.add(key);
  state.apps.forEach(a => a.selected = sel.has(a.key));
  render();
  await api.setSelected([...sel]);
}

// ---------- 快捷键对话框 ----------
let dlgMods = 0;
let dlgKey = null;
let dlgOpen = false;

function comboText() {
  const isMac = platformName === 'darwin';
  const m = modsLabel(dlgMods, isMac);
  const k = dlgKey || '…';
  return m ? `${m} + ${k}` : k;
}

function openDlg() {
  dlgOpen = true;
  dlgMods = 0;
  dlgKey = null;
  el('dlg-msg').textContent = '';
  el('combo').textContent = '—';
  el('dlg-mask').classList.remove('hidden');
}

function closeDlg() {
  dlgOpen = false;
  el('dlg-mask').classList.add('hidden');
}

document.addEventListener('keydown', async (e) => {
  if (!dlgOpen) return;
  e.preventDefault();
  e.stopPropagation();

  const isMac = platformName === 'darwin';
  if (e.key === 'Escape') { closeDlg(); return; }

  const mods = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.shiftKey ? 4 : 0) | (e.metaKey ? 8 : 0);
  const isModifier = ['Control', 'Alt', 'Shift', 'Meta', 'Win', 'Cmd', 'AltGraph'].includes(e.key);

  if (isModifier) {
    dlgMods = mods;
    dlgKey = null;
    el('combo').textContent = comboText();
    return;
  }

  const key = keyFromEvent(e);
  if (!key) {
    el('dlg-msg').textContent = '不支持的按键';
    return;
  }
  if (!mods) {
    el('dlg-msg').textContent = '需要至少一个修饰键（Ctrl / Alt / Shift / Win）';
    return;
  }

  const res = await api.setHotkey({ mods, key });
  if (res.ok) {
    closeDlg();
  } else {
    el('dlg-msg').textContent = res.err || '注册失败';
  }
});

// ---------- 按钮 ----------
el('btn-all').addEventListener('click', async () => {
  const keys = state.apps.map(a => a.key);
  state.apps.forEach(a => a.selected = true);
  render();
  await api.setSelected(keys);
});
el('btn-clear').addEventListener('click', async () => {
  state.apps.forEach(a => a.selected = false);
  render();
  await api.setSelected([]);
});
el('btn-refresh').addEventListener('click', () => api.refresh());
el('btn-hotkey').addEventListener('click', openDlg);
el('btn-admin').addEventListener('click', () => api.relaunchAdmin());
el('switch-focus').addEventListener('click', async () => {
  state.focusMode = !state.focusMode;
  const sw = el('switch-focus');
  if (state.focusMode) sw.classList.add('on'); else sw.classList.remove('on');
  await api.setFocusMode(state.focusMode);
});

// ---------- 初始化 ----------
api.onState((s) => { state = s; render(); });
api.getState().then((s) => { state = s; render(); });
