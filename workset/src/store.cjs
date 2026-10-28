const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const SCRIPT_EXTENSIONS = new Set(['.bat', '.cmd', '.ps1', '.py', '.js', '.cjs', '.mjs', '.exe']);
function classify(target) {
  if (/^https?:\/\//i.test(target)) return 'link';
  const ext = path.win32.extname(target).toLowerCase();
  if (SCRIPT_EXTENSIONS.has(ext)) return 'script';
  if (['.xlsx', '.xls', '.xlsm', '.csv', '.tsv'].includes(ext)) return 'sheet';
  if (['.doc', '.docx', '.pdf', '.md', '.txt', '.ppt', '.pptx', '.xmind'].includes(ext)) return 'document';
  return 'file';
}

function scriptCommand(target) {
  const ext = path.win32.extname(target).toLowerCase();
  if (ext === '.py') return { command: 'py.exe', args: ['-3', target] };
  if (ext === '.ps1') return { command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-File', target] };
  if (['.js', '.mjs', '.cjs'].includes(ext)) return { command: 'node.exe', args: [target] };
  return null;
}

function text(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`${label}不能为空，且不能超过 ${max} 个字符`);
  return value.trim();
}
function validTarget(value) {
  const target = text(value, '路径或网址', 4096);
  if (/^https?:\/\//i.test(target)) {
    const url = new URL(target);
    if (!url.hostname || url.username || url.password) throw new Error('请使用有效的 HTTP / HTTPS 网址');
  } else if (!path.win32.isAbsolute(target) && !path.isAbsolute(target)) {
    throw new Error('请选择文件，或填写完整的绝对路径 / HTTP(S) 网址');
  }
  return target;
}
function validateState(input) {
  if (!input || input.version !== 1 || typeof input.alwaysOnTop !== 'boolean' || !Array.isArray(input.groups) || input.groups.length > 100) throw new Error('配置格式无效：最多保存 100 个分组');
  const ids = new Set();
  function id(value) {
    const result = text(value, 'ID', 100);
    if (ids.has(result)) throw new Error('配置中包含重复 ID');
    ids.add(result);
    return result;
  }
  let total = 0;
  const groups = input.groups.map(group => {
    if (!group || !Array.isArray(group.items) || (total += group.items.length) > 5000) throw new Error('快捷方式格式无效，最多保存 5000 个');
    return {
      id: id(group.id), name: text(group.name, '分组名称', 50),
      description: typeof group.description === 'string' ? group.description.slice(0, 200) : '',
      items: group.items.map(item => ({
        id: id(item.id), name: text(item.name, '快捷方式名称', 100), target: validTarget(item.target),
        note: typeof item.note === 'string' ? item.note.slice(0, 500) : ''
      }))
    };
  });
  return { version: 1, alwaysOnTop: input.alwaysOnTop, selectedGroup: groups.some(g => g.id === input.selectedGroup) ? input.selectedGroup : groups[0]?.id || null, groups };
}

class Store {
  constructor(filename) { this.filename = filename; }
  load() {
    if (!fs.existsSync(this.filename)) {
      const id = randomUUID();
      return { version: 1, alwaysOnTop: false, selectedGroup: id, groups: [{ id, name: '我的工作集', description: '把同一项工作需要的文件，放在一起。', items: [] }] };
    }
    try { return validateState(JSON.parse(fs.readFileSync(this.filename, 'utf8'))); }
    catch (error) { throw new Error(`配置文件无法读取，请先备份再修复：${this.filename}\n${error.message}`); }
  }
  save(input) {
    const valid = validateState(input);
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    const temp = this.filename + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(valid, null, 2), 'utf8');
    fs.renameSync(temp, this.filename);
    return valid;
  }
}

module.exports = { Store, validateState, validTarget, classify, scriptCommand };
