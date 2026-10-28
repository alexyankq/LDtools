const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts');
const run = path.join(artifacts, 'desktop-' + randomUUID());
fs.mkdirSync(run, { recursive: true });
process.env.TEMP = run;
process.env.TMP = run;
const { _electron: electron } = require('playwright');
const data = path.join(run, 'data');
const env = { ...process.env, WORKSET_TEST_DATA: data, TEMP: run, TMP: run };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.WORKSET_EXE || require('electron');
let app, page;
const errors = [];
const nativeUser32 = require('koffi').load('user32.dll');
const getWindowStyle = nativeUser32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)');
async function nativePinned() {
  const hwnd = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
  return (Number(getWindowStyle(BigInt(hwnd), -20)) & 8) !== 0;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function launch() {
  app = await electron.launch({ executablePath, args: process.env.WORKSET_EXE ? [] : [root], env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#group-name').filter({ hasText: /./ }).waitFor();
}
async function eventually(fn, text) {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await wait(50); }
  throw new Error(text);
}
async function count(expected) {
  await eventually(async () => await page.locator('.card').count() === expected, `应有 ${expected} 个卡片`);
}
async function addManual(name, target, note = '') {
  await page.locator('#add-toggle').click();
  await page.locator('#add-manual').click();
  await page.locator('#field-name').fill(name);
  await page.locator('#field-target').fill(target);
  await page.locator('#field-note').fill(note);
  await page.locator('#dialog-save').click();
  await page.locator('#editor').waitFor({ state: 'hidden' });
}
async function setDialogPaths(paths) {
  await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, paths);
}

(async () => {
  try {
    await launch();
    assert.equal(await page.locator('#empty').isVisible(), true);
    await page.screenshot({ path: path.join(artifacts, 'workset-empty.png') });
    await page.locator('#new-group').click();
    await page.locator('#field-name').fill('装备配置');
    await page.locator('#field-description').fill('配置、检查、导表，把每一步需要的文件放在一起。');
    await page.locator('#dialog-save').click();
    await page.locator('#editor').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#group-name').textContent(), '装备配置');

    const files = ['装备基础属性.csv', '装备强化消耗.csv', '词条与品质.csv', '装备产出配置.csv'].map(name => path.join(run, name));
    files.forEach(file => fs.writeFileSync(file, 'id,name\n1,test\n'));
    await setDialogPaths(files);
    await page.locator('#empty-add').click();
    await count(4);
    await page.locator('#add-toggle').click();
    await page.locator('#add-files').click();
    await count(4); // Adding the same files twice does not duplicate them.

    await addManual('装备系统设计文档', 'https://example.com/equipment', '规则和验收口径');
    await addManual('导表前检查清单', path.join(run, '导表检查.md'), '检查引用、预览与客户端产物');
    fs.writeFileSync(path.join(run, '导表检查.md'), '# Checklist');
    const script = path.join(run, 'test script.cjs');
    const marker = path.join(run, 'script-ran.txt');
    fs.writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, process.cwd())`);
    await addManual('执行装备导表', script, '修改表格后手动运行');
    await count(7);

    // Search/filter behavior and escaped user content.
    await page.locator('#search').fill('强化'); await count(1);
    await page.locator('#search').fill(''); await count(7);
    await page.locator('[data-filter="script"]').click(); await count(1);
    await page.locator('[data-filter="all"]').click(); await count(7);
    await page.keyboard.press('Control+k');
    assert.equal(await page.locator('#search').evaluate(el => el === document.activeElement), true);

    await page.locator('#pin').click();
    await eventually(nativePinned, '原生窗口置顶应生效');
    await page.locator('#pin').click();
    await eventually(async () => !(await nativePinned()), '原生窗口应取消置顶');
    await page.locator('#pin').click();
    await eventually(nativePinned, '原生窗口应重新置顶');
    await page.screenshot({ path: path.join(artifacts, 'workset-main.png') });
    await page.locator('#compact').click();
    await eventually(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()[0] === 560), '精简窗口宽度应为 560');
    await page.screenshot({ path: path.join(artifacts, 'workset-compact.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(await nativePinned(), true);
    await page.locator('#compact').click();
    await page.locator('#maximize').click();
    await eventually(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), '窗口应可最大化');
    assert.equal(await nativePinned(), true);
    await page.locator('#maximize').click();

    // Real script process, with the native confirmation answered by the harness.
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await page.locator('.type-script .card-open').click();
    await eventually(() => fs.existsSync(marker), '脚本应实际运行并生成标记文件');
    assert.equal(fs.readFileSync(marker, 'utf8').toLowerCase(), run.toLowerCase());

    // Desktop association is replaced by a recorder to avoid launching work apps during tests.
    await app.evaluate(({ shell }) => {
      global.worksetOpened = [];
      shell.openPath = async target => { global.worksetOpened.push(target); return ''; };
      shell.openExternal = async target => { global.worksetOpened.push(target); };
    });
    await page.locator('#open-all').click();
    await eventually(async () => (await app.evaluate(() => global.worksetOpened.length)) === 6, '整组应打开 6 个文档 / 链接');

    // Edit and remove only affect the shortcut, never its file.
    const first = page.locator('.card').first();
    await first.locator('[data-action="edit"]').click();
    await page.locator('#field-name').fill('装备基础属性 <主表>');
    await page.locator('#dialog-save').click();
    await page.locator('#editor').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.card h3').first().textContent(), '装备基础属性 <主表>');
    assert.equal(await page.locator('.card h3').first().locator('*').count(), 0);
    await first.locator('[data-action="remove"]').click();
    await page.locator('#confirm button[value="ok"]').click();
    await count(6);
    assert.equal(fs.existsSync(files[0]), true);

    await page.locator('#new-group').click();
    await page.locator('#field-name').fill('临时工作集');
    await page.locator('#dialog-save').click();
    await page.locator('#editor').waitFor({ state: 'hidden' });
    await page.locator('#edit-group').click();
    await page.locator('#field-name').fill('重命名工作集');
    await page.locator('#dialog-save').click();
    await page.locator('#editor').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#group-name').textContent(), '重命名工作集');
    await page.locator('#edit-group').click();
    await page.locator('#dialog-delete').click();
    await page.locator('#confirm button[value="ok"]').click();
    await eventually(async () => (await page.locator('.group-button').count()) === 2, '临时分组应删除');
    await page.locator('.group-button').filter({ hasText: '装备配置' }).click();
    await count(6);

    const exported = path.join(run, 'backup.json');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, exported);
    await page.locator('#export').click();
    await eventually(() => fs.existsSync(exported), '导出文件应存在');
    const backup = JSON.parse(fs.readFileSync(exported, 'utf8'));
    assert.equal(backup.groups.length, 2);

    const bad = path.join(run, 'bad.json');
    fs.writeFileSync(bad, '{}');
    await setDialogPaths([bad]);
    await page.locator('#import').click();
    await eventually(async () => (await page.locator('#toast').textContent()).includes('配置格式无效'), '无效导入应提示');
    await count(6);
    await setDialogPaths([exported]);
    await page.locator('#import').click();
    await eventually(() => fs.readdirSync(data).some(f => f.includes('.backup-')), '导入前应备份原配置');
    await count(6);

    await app.close();
    await launch();
    await count(6);
    assert.equal(await page.locator('#group-name').textContent(), '装备配置');
    assert.equal(await nativePinned(), true);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: 桌面增删改、批量添加与去重、搜索筛选、置顶、精简、真实脚本启动、整组打开、导入导出及重启持久化。');
    console.log(`截图：${path.join(artifacts, 'workset-main.png')}`);
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'desktop-failure.png') }).catch(() => {});
    throw error;
  } finally { if (app) await app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
