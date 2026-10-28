const { test } = require('node:test');
const assert = require('node:assert/strict');
const { packTabs } = require('../src/renderer/side-tabs.js');

test('旋转后的页签按可用高度排入侧边列，每页最多三列', () => {
  const items = [160, 100, 90, 160, 100, 90, 160].map((height, i) => ({ id: String(i), height }));
  const pages = packTabs(items, 280);
  assert.deepEqual(pages.map(page => page.map(column => column.map(item => item.id))), [[['0', '1'], ['2', '3'], ['4', '5']], [['6']]]);
});
test('名称较长或窗口较小时仍保留每个页签，空列表不创建虚假页签', () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ id: i, height: 400 }));
  const pages = packTabs(items, 200);
  assert.deepEqual(pages.flat(2).map(i => i.id), items.map(i => i.id));
  assert.ok(pages.every(page => page.length <= 3));
  assert.deepEqual(packTabs([], 200), [[]]);
});
