const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const run = path.join(root, 'artifacts', 'pin-regression-' + randomUUID());
fs.mkdirSync(run, { recursive: true });
process.env.TEMP = run;
process.env.TMP = run;
const { _electron } = require('playwright');
const user32 = require('koffi').load('user32.dll');
const style = user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)');
const getWindow = user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32_t command)');
const getTop = user32.func('intptr_t __stdcall GetTopWindow(intptr_t hwnd)');
const setPosition = user32.func('int __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int width, int height, uint32_t flags)');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let app, page, mainId, mainHandle, peerId, peerHandle;
const trace = [];

function pinned() { return (Number(style(mainHandle, -20)) & 8) !== 0; }
function stacking() {
  let hwnd = BigInt(getTop(0n));
  const order = [];
  for (let i = 0; hwnd !== 0n && i < 2000; i++) {
    if (hwnd === mainHandle) order.push('workset');
    if (hwnd === peerHandle) order.push('peer');
    hwnd = BigInt(getWindow(hwnd, 2));
  }
  return order;
}
async function mainCall(action) {
  await app.evaluate(({ BrowserWindow }, { id, action }) => {
    const win = BrowserWindow.fromId(id);
    if (action === 'resize') { const bounds = win.getBounds(); win.setBounds({ ...bounds, width: bounds.width - 20 }); }
    else win[action]();
  }, { id: mainId, action });
}
async function focusPeer() {
  await app.evaluate(({ BrowserWindow }, id) => { const win = BrowserWindow.fromId(id); win.show(); win.focus(); }, peerId);
  await pause(150); // Let the actual Win32 activation and stacking messages finish.
}
async function expectPinned(label) {
  await focusPeer();
  const order = stacking();
  trace.push({ label, pinned: pinned(), order });
  assert.equal(pinned(), true, `${label}：切换窗口后丢失 WS_EX_TOPMOST`);
  assert.deepEqual(order, ['workset', 'peer'], `${label}：工作集被普通窗口遮挡`);
}
async function until(fn, description) {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await pause(50); }
  throw new Error(description);
}
(async () => {
  try {
    const env = { ...process.env, WORKSET_TEST_DATA: path.join(run, 'data') };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: process.env.WORKSET_EXE || require('electron'), args: process.env.WORKSET_EXE ? [] : [root], env });
    page = await app.firstWindow();
    await page.locator('#group-name').filter({ hasText: /./ }).waitFor();
    const main = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return { id: win.id, handle: win.getNativeWindowHandle().readBigUInt64LE().toString() };
    });
    mainId = main.id; mainHandle = BigInt(main.handle);
    await page.locator('#pin').click();
    assert.equal(pinned(), true);
    const peer = await app.evaluate(({ BrowserWindow }, id) => {
      const bounds = BrowserWindow.fromId(id).getBounds();
      const peer = new BrowserWindow({ title: 'Workset pin regression helper', x: bounds.x + 80, y: bounds.y + 80, width: 450, height: 280, show: true, backgroundColor: '#e8efe8', webPreferences: { sandbox: true } });
      peer.loadURL('data:text/html,<h2>Window overlap regression test</h2>');
      return { id: peer.id, handle: peer.getNativeWindowHandle().readBigUInt64LE().toString() };
    }, mainId);
    peerId = peer.id; peerHandle = BigInt(peer.handle);
    for (let i = 0; i < 5; i++) {
      await mainCall('focus'); await pause(100);
      await expectPinned(`反复切换 ${i + 1}`);
    }
    await mainCall('resize'); await expectPinned('调整尺寸');
    await page.locator('#compact').click(); await expectPinned('精简模式');
    await page.locator('#compact').click(); await expectPinned('还原普通尺寸');
    await mainCall('maximize'); await expectPinned('最大化');
    await mainCall('unmaximize'); await expectPinned('取消最大化');
    await mainCall('minimize'); await pause(100);
    await mainCall('restore'); await expectPinned('最小化后恢复');
    if (await page.locator('body').evaluate(el => el.classList.contains('compact'))) await page.locator('#compact').click();
    await page.locator('#pin').click(); await focusPeer();
    assert.equal(pinned(), false, '取消后不应保留置顶标志');
    assert.deepEqual(stacking(), ['peer', 'workset'], '取消后普通窗口应能覆盖工作集');
    await mainCall('focus'); await focusPeer();
    assert.equal(pinned(), false, '取消后切换窗口不应重新置顶');
    await page.locator('#pin').click(); await expectPinned('重新启用置顶');

    // A lifecycle failure must become a UI error, never an uncaught main-process exception.
    setPosition(mainHandle, -2n, 0, 0, 0, 0, 0x0013);
    await app.evaluate(({ BrowserWindow }, id) => {
      const win = BrowserWindow.fromId(id);
      global.originalPinSetter = win.setAlwaysOnTop;
      win.setAlwaysOnTop = () => { throw new Error('置顶回归测试：模拟系统拒绝'); };
      win.emit('restore');
    }, mainId);
    await until(async () => (await page.locator('#toast').textContent()).includes('模拟系统拒绝'), '恢复失败应在界面提示，不能弹出主进程异常');
    assert.equal(await page.locator('#pin').getAttribute('aria-pressed'), 'false');
    assert.equal(JSON.parse(fs.readFileSync(path.join(run, 'data/settings.json'), 'utf8')).alwaysOnTop, false);
    await app.evaluate(({ BrowserWindow }, id) => { BrowserWindow.fromId(id).setAlwaysOnTop = global.originalPinSetter; }, mainId);
    await page.locator('#pin').click(); await expectPinned('异常后可重新启用');
    console.log('PASS: 反复切换窗口、实际叠放顺序、尺寸调整、精简、最大化、最小化恢复、取消置顶及恢复失败处理。');
  } finally {
    fs.writeFileSync(path.join(run, 'trace.json'), JSON.stringify(trace, null, 2));
    if (app) await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
