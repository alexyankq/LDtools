const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts');
const run = path.join(artifacts, 'compact-' + randomUUID());
const data = path.join(run, 'data');
fs.mkdirSync(data, { recursive: true });
process.env.TEMP = run; process.env.TMP = run;
const { _electron } = require('playwright');
const getStyle = require('koffi').load('user32.dll').func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)');
const names = ['装备基础属性、强化消耗与词条品质配置（当前版本）', '任务奖励与委托配置', '每周发布检查', '活动商店与兑换配置', '副本与首领产出配置', '角色成长与战力验收', '战斗公式及怪物难度配置'];
const files = ['装备基础属性.csv', '强化消耗.csv', '词条品质.csv', '装备产出.csv'].map(name => path.join(run, name));
files.forEach(file => fs.writeFileSync(file, 'id,name\n1,test'));
const initial = { version: 1, alwaysOnTop: true, selectedGroup: 'g0', groups: names.map((name, n) => ({ id: 'g' + n, name, description: '管理信息只在完整模式显示', items: (n === 0 ? files : [`https://example.com/${n}/a`, `https://example.com/${n}/b`]).map((target, i) => ({ id: `item-${n}-${i}`, name: n === 0 ? path.basename(target) : `文档 ${i + 1}`, target, note: '只在完整模式显示的备注' })) })) };
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify(initial));
const read = () => JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'));
let app, page, mainId, bubblePage;
const errors = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message) { for (let i = 0; i < 120; i++) { if (await fn()) return; await pause(50); } throw new Error(message); }
async function launch() {
  const env = { ...process.env, WORKSET_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: process.env.WORKSET_EXE || require('electron'), args: process.env.WORKSET_EXE ? [] : [root], env });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.locator('#group-name').filter({ hasText: /./ }).waitFor();
  mainId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
}
async function compact(expected) { await until(() => page.locator('body').evaluate((body, expected) => body.classList.contains('compact') === expected, expected), '模式切换未完成'); }
async function mainVisible() { return app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(), mainId); }
async function findBubble() {
  await until(() => app.windows().some(p => p.url().endsWith('/bubble.html')), '未创建悬浮气泡');
  bubblePage = app.windows().find(p => p.url().endsWith('/bubble.html'));
  await until(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.getTitle() === '工作集悬浮气泡' && w.isVisible())), '悬浮气泡未显示');
  await bubblePage.locator('#open-bubble').waitFor();
}
async function bubbleBounds() { return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '工作集悬浮气泡').getBounds()); }
async function confirmDelete() { await page.locator('#confirm button[value="ok"]').click(); await page.locator('#confirm').waitFor({ state: 'hidden' }); }
(async () => {
  try {
    await launch();
    assert.equal(await page.locator('#delete-group').isVisible(), true);
    assert.equal(await page.locator('[data-delete-group]').count(), 7);
    await page.locator('#search').fill('nothing matches');
    await page.locator('#compact').click(); await compact(true);
    assert.ok(await page.locator('.side-tab-column').count() <= 3, '侧边最多叠放三列页签');
    assert.equal(await page.locator('.card').count(), 4, '精简模式不继承完整模式的搜索筛选');
    for (const selector of ['#new-group','#new-group-icon','#delete-group','#edit-group','#add-toggle','#search','#filters','#export','#import','#pin','#maximize','#empty-add']) assert.equal(await page.locator(selector).isVisible(), false, selector + ' 不应在精简模式显示');
    assert.equal(await page.locator('[data-action="edit"], [data-action="remove"], .card-path, .card-note').count(), 0);
    const label = page.locator('[data-group="g0"] .name');
    assert.equal(await label.textContent(), names[0]);
    assert.equal(await label.evaluate(el => getComputedStyle(el).whiteSpace), 'normal');
    assert.equal(await label.evaluate(el => el.scrollHeight <= el.clientHeight + 1), true, '名称不应被截断');
    assert.equal(await label.evaluate(el => getComputedStyle(el).transform.startsWith('matrix(0, -1, 1, 0,')), true, '页签文字应整体旋转 90 度');
    const nav = await page.locator('.sidebar').boundingBox(), main = await page.locator('#main').boundingBox();
    assert.ok(nav.x + nav.width <= main.x + 1, '页签栏应位于左侧');
    const activeTab = await page.locator('.group-button.active').boundingBox();
    assert.ok(Math.abs(activeTab.x + activeTab.width - main.x) <= 1, '选中页签应与内容区连成一体');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(artifacts, 'workset-compact-v2.png') });
    await page.evaluate(() => { const transfer = new DataTransfer(); transfer.items.add(new File(['id,name'], 'should-not-add.csv')); document.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer })); });
    assert.equal(read().groups[0].items.length, 4, '精简模式不可拖入新增');
    await page.keyboard.press('Control+k');
    assert.equal(await page.locator('#search').evaluate(el => el === document.activeElement), false);
    const visited = new Set(await page.locator('.group-button .name').allTextContents());
    while (!await page.locator('#groups-next').isDisabled()) {
      await page.locator('#groups-next').click();
      assert.ok(await page.locator('.side-tab-column').count() <= 3);
      (await page.locator('.group-button .name').allTextContents()).forEach(name => visited.add(name));
    }
    assert.equal(visited.size, names.length, '翻页后应能访问全部页签');
    while (!await page.locator('[data-group="g4"]').count()) await page.locator('#groups-prev').click();
    await page.locator('[data-group="g4"]').click();
    await until(() => read().selectedGroup === 'g4', '页签切换未保存');
    await page.locator('[data-group="g4"]').focus();
    await page.keyboard.press('ArrowDown');
    await until(() => read().selectedGroup === 'g5', '侧边页签应支持键盘切换');
    await page.keyboard.press('ArrowUp');
    await until(() => read().selectedGroup === 'g4', '键盘切换后应定位当前页签');
    await app.evaluate(({ shell }) => { global.opened = []; shell.openExternal = async target => { global.opened.push(target); }; });
    await page.locator('.compact-open').first().click();
    await until(async () => (await app.evaluate(() => global.opened.length)) === 1, '精简模式应能打开单个文档');
    await page.locator('#open-all').click();
    await until(async () => (await app.evaluate(() => global.opened.length)) === 3, '精简模式应能整组打开');
    await page.locator('#minimize').click(); await until(async () => !await mainVisible(), '收起后应隐藏主窗口'); await findBubble();
    bubblePage.on('pageerror', error => errors.push(error.message));
    const handle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '工作集悬浮气泡').getNativeWindowHandle().readBigUInt64LE().toString());
    assert.ok(Number(getStyle(BigInt(handle), -20)) & 8, '气泡应置顶');
    assert.equal(await bubblePage.evaluate(() => typeof window.workset), 'undefined', '气泡不能访问文档管理接口');
    await bubblePage.screenshot({ path: path.join(artifacts, 'workset-bubble.png'), omitBackground: true });
    const before = await bubbleBounds();
    await bubblePage.mouse.move(32, 32); await bubblePage.mouse.down(); await bubblePage.mouse.move(12, 12, { steps: 2 }); await bubblePage.mouse.up();
    await until(async () => (await bubbleBounds()).x !== before.x, '气泡应支持拖动');
    assert.equal(await mainVisible(), false, '拖动不应意外展开');
    await bubblePage.locator('#open-bubble').click(); await until(mainVisible, '点击气泡应展开主窗口'); await compact(true);
    assert.equal(read().selectedGroup, 'g4');
    assert.equal(await page.locator('[data-group="g4"]').isVisible(), true, '展开时页码应定位到当前页签');
    await page.locator('#compact').click(); await compact(false);
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).minimize(), mainId);
    await until(async () => !await mainVisible(), '系统最小化应隐藏主窗口'); await findBubble();
    // Invoke native menu actions while replacing presentation to keep the test deterministic.
    await app.evaluate(({ Menu }) => { global.originalMenu = Menu.buildFromTemplate; Menu.buildFromTemplate = template => { global.bubbleMenu = template; return { popup() {} }; }; });
    await bubblePage.locator('#open-bubble').click({ button: 'right' });
    await until(async () => app.evaluate(() => !!global.bubbleMenu), '气泡应提供右键菜单');
    await app.evaluate(() => global.bubbleMenu.find(item => item.label === '打开完整模式').click());
    await until(mainVisible, '气泡菜单应能回到完整模式'); await compact(false);
    await app.evaluate(({ Menu }) => { Menu.buildFromTemplate = global.originalMenu; });
    await page.locator('#search').fill('');
    await page.locator('#delete-group').click(); await page.locator('#confirm button[value="cancel"]').click();
    assert.equal(read().groups.length, 7, '取消删除必须保留工作集');
    await page.locator('#delete-group').click(); await confirmDelete(); await until(() => read().groups.length === 6, '标题删除入口应生效');
    await page.locator('[data-delete-group="g0"]').click(); await confirmDelete(); await until(() => read().groups.length === 5, '侧栏删除入口应生效');
    files.forEach(file => assert.ok(fs.existsSync(file), '删除工作集不能删除原文件'));
    while (read().groups.length) {
      const previous = read().groups.length;
      await page.locator('#delete-group').click(); await confirmDelete();
      await until(() => read().groups.length === previous - 1, '应允许删除最后一个工作集');
    }
    assert.equal(read().selectedGroup, null);
    assert.equal(await page.locator('#open-all').isDisabled(), true);
    await app.close(); await launch();
    assert.equal(await page.locator('.group-button').count(), 0, '重启后不应复活已删除的工作集');
    await page.locator('#empty-add').click(); await page.locator('#field-name').fill('重新开始'); await page.locator('#dialog-save').click();
    await until(() => read().groups.length === 1, '空列表中仍可新建工作集');
    assert.deepEqual(errors, []);
    console.log('PASS: 删除工作集、旋转 90 度的传统侧边页签、最多三列与分页、完整名称、选中页签连接内容区、键盘切换、精简打开及悬浮气泡。');
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'compact-failure.png') }).catch(() => {});
    throw error;
  } finally { if (app) await app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
