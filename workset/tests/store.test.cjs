const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Store, validateState, classify, scriptCommand } = require('../src/store.cjs');

function fixture(t) {
  const temp = path.join(__dirname, '../artifacts/tmp');
  fs.mkdirSync(temp, { recursive: true });
  const root = fs.mkdtempSync(path.join(temp, 'workset-'));
  assert.equal(path.dirname(root), temp);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, store: new Store(path.join(root, 'settings.json')) };
}

test('分组、文档、置顶和选择在重新打开后保留', t => {
  const { store, root } = fixture(t);
  const state = store.load();
  state.groups[0].name = '装备配置';
  state.groups[0].items.push({ id: 'one', name: '装备基础表', target: 'D:\\配置\\装备.xlsx', note: '每次导表前检查' });
  state.alwaysOnTop = true;
  store.save(state);
  assert.deepEqual(new Store(path.join(root, 'settings.json')).load(), state);
});

test('无效导入不能覆盖现有配置，重复 ID 和不支持的 URL 被拒绝', t => {
  const { store } = fixture(t);
  const state = store.load();
  store.save(state);
  assert.throws(() => store.save({ groups: [] }));
  const bad = structuredClone(state);
  bad.groups.push(structuredClone(bad.groups[0]));
  assert.throws(() => validateState(bad));
  bad.groups.pop();
  bad.groups[0].items.push({ id: 'x', name: 'bad', target: 'javascript:alert(1)', note: '' });
  assert.throws(() => validateState(bad));
  assert.deepEqual(store.load(), state);
});

test('损坏配置不会被默默重置或覆盖', t => {
  const { root, store } = fixture(t);
  fs.writeFileSync(path.join(root, 'settings.json'), '{broken');
  assert.throws(() => store.load(), /配置文件/);
  assert.equal(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'), '{broken');
});

test('识别表格、脚本、网址；带空格路径作为独立参数传给解释器', () => {
  assert.equal(classify('D:\\配置\\装备.xlsx'), 'sheet');
  assert.equal(classify('D:\\tools\\导表.PS1'), 'script');
  assert.equal(classify('https://example.com/doc'), 'link');
  assert.deepEqual(scriptCommand('D:\\my tools\\test.py'), { command: 'py.exe', args: ['-3', 'D:\\my tools\\test.py'] });
  assert.deepEqual(scriptCommand('D:\\my tools\\test.ps1'), { command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-File', 'D:\\my tools\\test.ps1'] });
  assert.equal(scriptCommand('D:\\docs\\readme.md'), null);
});

test('导出数据重新校验仍保留内容，非法选择被修正为已有分组', t => {
  const { store } = fixture(t);
  const state = store.load();
  state.selectedGroup = 'missing';
  const valid = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(valid.selectedGroup, valid.groups[0].id);
  assert.throws(() => validateState({ ...state, alwaysOnTop: 'yes' }));
});

test('删除最后一个工作集后允许保存空列表，重启后不重新生成工作集', t => {
  const { store } = fixture(t);
  const state = store.load();
  state.groups = [];
  state.selectedGroup = null;
  store.save(state);
  assert.deepEqual(store.load(), state);
});
