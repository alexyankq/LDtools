const path = require('node:path');
const { classify, scriptCommand } = require('./store.cjs');

function createActions({ getState, exists, shell, confirm, launch }) {
  function find(id) {
    const item = getState().groups.flatMap(g => g.items).find(i => i.id === id);
    if (!item) throw new Error('快捷方式不存在，请刷新后重试');
    return item;
  }
  function check(item) {
    if (classify(item.target) !== 'link' && !exists(item.target)) throw new Error(`文件已移动或不存在：${item.target}`);
  }
  async function openItem(id) {
    const item = find(id);
    check(item);
    const type = classify(item.target);
    if (type === 'script') {
      if (!await confirm(item)) return { cancelled: true };
      const cmd = scriptCommand(item.target);
      if (cmd) {
        await launch(cmd.command, cmd.args, path.win32.dirname(item.target));
        return { opened: true };
      }
    }
    if (type === 'link') await shell.openExternal(item.target);
    else {
      const error = await shell.openPath(item.target);
      if (error) throw new Error(error);
    }
    return { opened: true };
  }
  async function openGroup(id) {
    const group = getState().groups.find(g => g.id === id);
    if (!group) throw new Error('分组不存在');
    const result = { opened: 0, skipped: 0, errors: [] };
    for (const item of group.items) {
      if (classify(item.target) === 'script') { result.skipped++; continue; }
      try { await openItem(item.id); result.opened++; }
      catch (error) { result.errors.push(`${item.name}：${error.message}`); }
    }
    return result;
  }
  function reveal(id) {
    const item = find(id);
    if (classify(item.target) === 'link') throw new Error('网址没有本地文件位置');
    check(item);
    shell.showItemInFolder(item.target);
  }
  return { openItem, openGroup, reveal };
}
module.exports = { createActions };
