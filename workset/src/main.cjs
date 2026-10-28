const { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { Store, validateState } = require('./store.cjs');
const { createActions } = require('./actions.cjs');
const { setPinned, isPinned } = require('./window-pin.cjs');

app.setName('ldtools-workset');
// Isolated data directory for automated desktop acceptance tests.
if (process.env.WORKSET_TEST_DATA) app.setPath('userData', process.env.WORKSET_TEST_DATA);
let win, store, state, compact = false, expandedBounds, expandedMaximized = false;
let bubbleWin, collapsed = false, quitting = false;
const entry = path.join(__dirname, 'renderer/index.html');
const entryURL = pathToFileURL(entry).href;
const bubbleEntry = path.join(__dirname, 'renderer/bubble.html');
const bubbleURL = pathToFileURL(bubbleEntry).href;

function launch(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: true, shell: false, windowsHide: false, stdio: 'ignore' });
    child.once('error', error => reject(new Error(`无法启动 ${command}：${error.message}`)));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function handle(channel, fn, source = 'main') {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const owner = source === 'bubble' ? bubbleWin : win;
      const expectedURL = source === 'bubble' ? bubbleURL : entryURL;
      if (!owner || owner.isDestroyed() || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame || event.senderFrame.url !== expectedURL) throw new Error('请求来源无效');
      return { ok: true, value: await fn(...args) };
    } catch (error) { return { ok: false, error: error.message }; }
  });
}

function applySavedPin() {
  if (!win || win.isDestroyed()) return;
  try { setPinned(win, state.alwaysOnTop); }
  catch (error) {
    // Native lifecycle events run outside the IPC error boundary. Report failures
    // in the app and reconcile the saved preference with Windows' actual state.
    console.error('恢复置顶失败：', error.message);
    try {
      const actual = isPinned(win);
      if (actual !== state.alwaysOnTop) state = store.save({ ...state, alwaysOnTop: actual });
    } catch (syncError) { console.error('同步置顶状态失败：', syncError.message); }
    if (!win.webContents.isDestroyed()) win.webContents.send('window:pin-error', { message: `无法恢复窗口置顶：${error.message}` });
  }
}

function setCompact(enabled) {
  if (compact !== enabled) {
    if (enabled) {
      expandedBounds = win.getNormalBounds();
      expandedMaximized = win.isMaximized();
      if (expandedMaximized) win.unmaximize();
      win.setMinimumSize(460, 420);
      win.setSize(560, Math.min(430, screen.getDisplayMatching(win.getBounds()).workArea.height));
    } else {
      win.setMinimumSize(720, 500);
      win.setBounds(expandedBounds);
      if (expandedMaximized) win.maximize();
    }
    compact = enabled;
  }
  applySavedPin();
  win.webContents.send('window:view', { compact });
  return compact;
}

function clampBounds(bounds) {
  const area = screen.getDisplayMatching(bounds).workArea;
  return { ...bounds, x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width))), y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height))) };
}

function showBubble() {
  if (!collapsed || quitting) return;
  if (!bubbleWin || bubbleWin.isDestroyed()) {
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const bounds = clampBounds({ x: area.x + area.width - 76, y: win.getBounds().y + 80, width: 64, height: 64 });
    bubbleWin = new BrowserWindow({ ...bounds, title: '工作集悬浮气泡', frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: false, show: false, focusable: false,
      webPreferences: { preload: path.join(__dirname, 'bubble-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    bubbleWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    bubbleWin.webContents.on('will-navigate', event => event.preventDefault());
    bubbleWin.once('ready-to-show', showBubble);
    bubbleWin.on('closed', () => { bubbleWin = null; });
    bubbleWin.loadFile(bubbleEntry);
    return;
  }
  bubbleWin.setBounds(clampBounds(bubbleWin.getBounds()));
  bubbleWin.showInactive();
  try { setPinned(bubbleWin, true); }
  catch (error) { console.error('悬浮气泡置顶失败：', error.message); }
}

function collapseToBubble() {
  if (!win || win.isDestroyed() || quitting) return;
  collapsed = true;
  win.hide();
  showBubble();
}

function expandBubble(full = false) {
  if (!win || win.isDestroyed() || quitting) return;
  const anchor = bubbleWin && !bubbleWin.isDestroyed() ? bubbleWin.getBounds() : null;
  collapsed = false;
  if (bubbleWin) bubbleWin.hide();
  if (win.isMinimized()) win.restore();
  setCompact(!full);
  if (!full && anchor) {
    const bounds = win.getBounds();
    win.setBounds(clampBounds({ ...bounds, x: anchor.x + anchor.width - bounds.width, y: anchor.y }));
  }
  win.show();
  win.focus();
  applySavedPin();
}

function setupIPC() {
  const actions = createActions({ getState: () => state, exists: fs.existsSync, shell, launch,
    confirm: async item => {
      const answer = await dialog.showMessageBox(win, { type: 'question', title: '运行脚本', message: `运行「${item.name}」？`, detail: `${item.target}\n\nPython / PowerShell / Node 脚本在所在目录启动，其余由 Windows 默认方式打开。`, buttons: ['取消', '运行'], defaultId: 0, cancelId: 0, noLink: true });
      return answer.response === 1;
    }
  });
  handle('state:load', () => ({ state, dataPath: store.filename, compact }));
  handle('state:save', input => {
    const next = validateState(input);
    try { setPinned(win, next.alwaysOnTop); state = store.save(next); }
    catch (error) { setPinned(win, state.alwaysOnTop); throw error; }
    return state;
  });
  handle('item:open', id => actions.openItem(id));
  handle('group:open', id => actions.openGroup(id));
  handle('item:reveal', id => actions.reveal(id));
  handle('files:choose', async folder => {
    const answer = await dialog.showOpenDialog(win, { title: folder ? '选择文件夹' : '添加文档或脚本', properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'] });
    return answer.canceled ? [] : answer.filePaths;
  });
  handle('files:describe', targets => {
    if (!Array.isArray(targets) || targets.length > 500) throw new Error('一次最多添加 500 个文件');
    return targets.map(target => {
      if (typeof target !== 'string' || !path.isAbsolute(target) || !fs.existsSync(target)) throw new Error('文件路径无效或不存在');
      return { id: randomUUID(), name: path.basename(target), target, note: '' };
    });
  });
  handle('state:export', async () => {
    const answer = await dialog.showSaveDialog(win, { title: '导出工作集', defaultPath: '工作集备份.json', filters: [{ name: '工作集配置', extensions: ['json'] }] });
    if (!answer.canceled) fs.writeFileSync(answer.filePath, JSON.stringify(state, null, 2), 'utf8');
    return !answer.canceled;
  });
  handle('state:import', async () => {
    const answer = await dialog.showOpenDialog(win, { title: '导入工作集', properties: ['openFile'], filters: [{ name: '工作集配置', extensions: ['json'] }] });
    if (answer.canceled) return null;
    const filename = answer.filePaths[0];
    if (fs.statSync(filename).size > 10 * 1024 * 1024) throw new Error('配置文件不能超过 10 MB');
    const imported = validateState(JSON.parse(fs.readFileSync(filename, 'utf8')));
    const confirm = await dialog.showMessageBox(win, { type: 'question', message: `导入 ${imported.groups.length} 个分组？`, detail: '将替换当前分组和快捷方式。当前配置会自动备份到同一数据目录。', buttons: ['取消', '导入'], defaultId: 0, cancelId: 0, noLink: true });
    if (confirm.response !== 1) return null;
    const backup = store.filename + `.backup-${Date.now()}.json`;
    fs.writeFileSync(backup, JSON.stringify(state, null, 2), 'utf8');
    try { setPinned(win, imported.alwaysOnTop); state = store.save(imported); }
    catch (error) { setPinned(win, state.alwaysOnTop); throw error; }
    return state;
  });
  handle('window:compact', () => setCompact(!compact));
  handle('window:minimize', collapseToBubble);
  handle('window:maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
  handle('window:close', () => app.quit());
  handle('bubble:expand', () => expandBubble(), 'bubble');
  handle('bubble:bounds', () => bubbleWin.getBounds(), 'bubble');
  handle('bubble:move', position => {
    if (!position || !Number.isSafeInteger(position.x) || !Number.isSafeInteger(position.y) || Math.abs(position.x) > 100000 || Math.abs(position.y) > 100000) throw new Error('气泡位置无效');
    bubbleWin.setBounds(clampBounds({ ...bubbleWin.getBounds(), x: position.x, y: position.y }));
    return bubbleWin.getBounds();
  }, 'bubble');
  handle('bubble:menu', () => {
    Menu.buildFromTemplate([
      { label: '展开精简模式', click: () => expandBubble() },
      { label: '打开完整模式', click: () => expandBubble(true) },
      { type: 'separator' },
      { label: '退出工作集', click: () => app.quit() }
    ]).popup({ window: bubbleWin });
  }, 'bubble');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (collapsed) expandBubble(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } } });
  app.whenReady().then(() => {
    app.setAppUserModelId('LDTools.Workset');
    store = new Store(path.join(app.getPath('userData'), 'settings.json'));
    try { state = store.load(); }
    catch (error) { dialog.showErrorBox('工作集配置读取失败', error.message); app.quit(); return; }
    const area = screen.getPrimaryDisplay().workAreaSize;
    win = new BrowserWindow({ title: '工作集 Workset', width: Math.min(1080, area.width), height: Math.min(760, area.height), minWidth: 720, minHeight: 500,
      frame: false, show: false, backgroundColor: '#f7f8fa', alwaysOnTop: state.alwaysOnTop,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    Menu.setApplicationMenu(null);
    setupIPC();
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    win.once('ready-to-show', () => { win.show(); applySavedPin(); });
    // Finish the native restore message before applying z-order changes.
    win.on('restore', () => setImmediate(() => { if (collapsed) expandBubble(); else applySavedPin(); }));
    win.on('minimize', () => setImmediate(() => { if (win && !win.isDestroyed() && win.isMinimized()) collapseToBubble(); }));
    win.on('closed', () => { win = null; if (!quitting) app.quit(); });
    win.loadFile(entry);
  }).catch(error => { dialog.showErrorBox('工作集启动失败', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { quitting = true; });
}
