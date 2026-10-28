const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createActions } = require('../src/actions.cjs');

function fixture() {
  const opened = [], launched = [];
  const state = { groups: [{ id: 'g', items: [
    { id: 'a', name: '表格', target: 'D:\\表格.xlsx' },
    { id: 'b', name: '脚本', target: 'D:\\tools\\导表.py' },
    { id: 'c', name: '缺失', target: 'D:\\missing.xlsx' }
  ] }] };
  const actions = createActions({
    getState: () => state,
    exists: p => !p.includes('missing'),
    shell: { openPath: async p => { opened.push(p); return ''; }, openExternal: async p => opened.push(p), showItemInFolder: p => opened.push(p) },
    confirm: async () => false,
    launch: async (...args) => launched.push(args)
  });
  return { actions, opened, launched };
}
test('整组打开仅打开文档，脚本不自动执行；缺失文件单独报告', async () => {
  const { actions, opened, launched } = fixture();
  const result = await actions.openGroup('g');
  assert.equal(result.opened, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors.length, 1);
  assert.deepEqual(opened, ['D:\\表格.xlsx']);
  assert.deepEqual(launched, []);
});
test('取消脚本运行确认后不会启动进程', async () => {
  const { actions, launched } = fixture();
  assert.deepEqual(await actions.openItem('b'), { cancelled: true });
  assert.equal(launched.length, 0);
});
test('必须使用已保存的快捷方式 ID，无法通过任意字符串启动命令', async () => {
  const { actions } = fixture();
  await assert.rejects(actions.openItem('powershell.exe'), /不存在/);
  await assert.rejects(actions.openGroup('missing'), /不存在/);
});
test('解释器启动错误和默认应用错误返回给调用方', async () => {
  const items = [{ id: 's', name: '脚本', target: 'D:\\with spaces\\run.py' }, { id: 'd', name: '文档', target: 'D:\\doc.pdf' }];
  const actions = createActions({ getState: () => ({ groups: [{ id: 'g', items }] }), exists: () => true, confirm: async () => true,
    launch: async () => { throw new Error('找不到 Python'); }, shell: { openPath: async () => '没有关联应用' } });
  await assert.rejects(actions.openItem('s'), /Python/);
  await assert.rejects(actions.openItem('d'), /没有关联应用/);
});
