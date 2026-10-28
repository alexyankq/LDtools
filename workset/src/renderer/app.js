const $ = selector => document.querySelector(selector);
const api = window.workset;
let state, dataPath, filter = 'all', query = '', editorMode, editorId, toastTimer, dragDepth = 0;
let saveQueue = Promise.resolve();
let saving = false;
let isCompact = false, groupPage = 0;
let sidePages = [[]], revealSelectedTab = false;
const tabMeasure = document.createElement('canvas').getContext('2d');
const icons = {
  pin: '<path d="m16 3 5 5-4 1-3 6-3-3-6 7 4-8-3-3 6-2z"/>',
  compact: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M3 9h11"/>',
  minus: '<path d="M5 12h14"/>', square: '<rect x="5" y="5" width="14" height="14" rx="1"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', chevron: '<path d="m7 10 5 5 5-5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v6h5M9 13h6M9 17h5"/>',
  sheet: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v6h5M8 12h8v6H8zM8 15h8M12 12v6"/>',
  script: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  link: '<path d="m10 13 4-4M8 15l-1 1a3.5 3.5 0 0 0 5 5l5-5a3.5 3.5 0 0 0 0-5M16 9l1-1a3.5 3.5 0 0 0-5-5l-5 5a3.5 3.5 0 0 0 0 5"/>',
  import: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>', export: '<path d="M12 15V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  open: '<path d="M14 3h7v7M21 3 11 13M10 5H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  play: '<path d="m8 4 13 8-13 8z"/>'
};
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const group = () => state.groups.find(g => g.id === state.selectedGroup);
function type(target) {
  if (/^https?:\/\//i.test(target)) return 'link';
  const ext = target.split(/[\\/]/).pop().split('.').pop().toLowerCase();
  if (['bat','cmd','ps1','py','js','cjs','mjs','exe'].includes(ext)) return 'script';
  if (['xlsx','xls','xlsm','csv','tsv'].includes(ext)) return 'sheet';
  if (['doc','docx','pdf','md','txt','ppt','pptx','xmind'].includes(ext)) return 'document';
  return 'file';
}
const typeNames = { sheet: '表格', document: '文档', script: '脚本', link: '链接', file: '文件 / 文件夹' };
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 6000 : 3200);
}
function message(title, text) {
  $('#message-title').textContent = title;
  $('#message-text').textContent = text;
  $('#message').showModal();
}
function confirmAction(title, text) {
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm').returnValue = 'cancel';
  $('#confirm').showModal();
  return new Promise(resolve => $('#confirm').addEventListener('close', () => resolve($('#confirm').returnValue === 'ok'), { once: true }));
}
async function safely(fn) {
  try { return await fn(); }
  catch (error) { toast(error.message || String(error), true); }
}
// Serialize writes so rapid edits cannot restore an older snapshot.
function persist(next) {
  const snapshot = structuredClone(next);
  const operation = saveQueue.then(async () => {
    const saved = await api.save(snapshot);
    state = saved;
    render();
    return saved;
  });
  saveQueue = operation.catch(() => {});
  return operation;
}
async function change(mutate) {
  if (saving) throw new Error('正在保存，请稍后重试');
  saving = true;
  try {
    await saveQueue;
    const next = structuredClone(state);
    mutate(next);
    return await persist(next);
  } finally { saving = false; }
}
function render() {
  const current = group();
  if (isCompact) {
    const availableHeight = Math.max(80, window.innerHeight - 36 - 24 - 33);
    tabMeasure.font = '12px "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
    const metrics = state.groups.map(g => {
      const textWidth = Math.ceil(tabMeasure.measureText(g.name).width);
      const height = Math.min(availableHeight, Math.max(62, textWidth + 24));
      const lines = Math.max(1, Math.ceil(textWidth / (height - 20)));
      return { group: g, id: g.id, height, width: Math.max(32, lines * 17 + 12) };
    });
    sidePages = window.SideTabs.packTabs(metrics, availableHeight);
    if (revealSelectedTab) {
      groupPage = Math.max(0, sidePages.findIndex(page => page.some(column => column.some(tab => tab.id === state.selectedGroup))));
      revealSelectedTab = false;
    }
  }
  const pages = isCompact ? sidePages.length : 1;
  groupPage = Math.max(0, Math.min(groupPage, pages - 1));
  const markup = g => `<div class="group-row"><button class="group-button ${g.id === current?.id ? 'active' : ''}" data-group="${esc(g.id)}" role="tab" aria-selected="${g.id === current?.id}" aria-controls="main" tabindex="${g.id === current?.id ? 0 : -1}" title="${esc(g.name)}">${svg('layers')}<span class="name">${esc(g.name)}</span><span class="number">${g.items.length}</span></button>${!isCompact ? `<button class="group-delete icon-button" data-delete-group="${esc(g.id)}" title="删除 ${esc(g.name)}" aria-label="删除 ${esc(g.name)}">${svg('trash')}</button>` : ''}</div>`;
  if (isCompact) {
    const columns = [...sidePages[groupPage]];
    // As in a traditional multi-row strip, the selected layer touches the panel.
    const activeColumn = columns.findIndex(column => column.some(tab => tab.id === state.selectedGroup));
    if (activeColumn >= 0) columns.push(columns.splice(activeColumn, 1)[0]);
    $('#groups').innerHTML = columns.map(column => `<div class="side-tab-column">${column.map(tab => markup(tab.group)).join('')}</div>`).join('');
    $('#groups').querySelectorAll('.side-tab-column').forEach((element, index) => {
      element.style.width = Math.max(...columns[index].map(tab => tab.width)) + 'px';
      element.querySelectorAll('.group-button').forEach((button, i) => {
        button.style.height = columns[index][i].height + 'px';
        button.style.setProperty('--side-tab-height', columns[index][i].height + 'px');
      });
    });
  } else $('#groups').innerHTML = state.groups.map(markup).join('');
  $('#groups').setAttribute('role', 'tablist');
  $('#groups').setAttribute('aria-orientation', 'vertical');
  $('#main').setAttribute('role', 'tabpanel');
  $('#main').setAttribute('aria-label', current?.name || '还没有工作集');
  $('#group-pagination').hidden = !isCompact || pages === 1;
  $('#groups-page').textContent = `${groupPage + 1} / ${pages}`;
  $('#groups-prev').disabled = groupPage === 0;
  $('#groups-next').disabled = groupPage === pages - 1;
  $('#group-name').textContent = current?.name || '还没有工作集';
  $('#group-name').title = current?.name || '';
  $('#breadcrumb-name').textContent = current?.name || '开始使用';
  $('#group-description').textContent = current?.description || '这项工作所需的文件，都在这里。';
  $('#group-count').textContent = current?.items.length || 0;
  for (const id of ['#edit-group', '#delete-group', '#add-toggle', '#search']) $(id).disabled = !current;
  const openable = (current?.items || []).filter(i => type(i.target) !== 'script').length;
  $('#open-count').textContent = openable;
  $('#open-all').disabled = openable === 0;
  $('#open-all').title = '打开此工作集内的全部文档、链接和文件夹；脚本需单独运行';
  $('#pin').setAttribute('aria-pressed', String(state.alwaysOnTop));
  $('#pin-label').textContent = state.alwaysOnTop ? '已置顶' : '窗口置顶';
  $('#total-count').textContent = `${state.groups.length} 个工作集 · ${state.groups.reduce((n,g) => n + g.items.length, 0)} 个快捷方式`;
  renderCards();
}
function renderCards() {
  const all = group()?.items || [];
  const items = isCompact ? all : all.filter(i => (filter === 'all' || type(i.target) === filter) && `${i.name} ${i.target} ${i.note}`.toLowerCase().includes(query));
  $('#result-count').textContent = `${items.length} 个快捷方式`;
  $('#filters').querySelectorAll('button').forEach(b => { b.classList.toggle('active', b.dataset.filter === filter); b.setAttribute('aria-pressed', String(b.dataset.filter === filter)); });
  $('#empty').hidden = isCompact || all.length > 0;
  $('#empty-title').textContent = group() ? '这项工作需要什么？' : '还没有工作集';
  $('#empty-description').textContent = group() ? '把常用的表格、文档和脚本收进来。需要的时候，随手就能打开。' : '新建一个工作集，把同一项工作需要的文件放在一起。';
  $('#empty-add').innerHTML = svg('plus') + (group() ? '添加第一批文件' : '新建工作集');
  $('#compact-empty').hidden = !isCompact || all.length > 0;
  $('#compact-empty').textContent = group() ? '暂无快捷方式，请在完整模式下添加。' : '暂无工作集，请在完整模式下新建。';
  $('#no-results').hidden = isCompact || !all.length || items.length > 0;
  $('#drop-hint').hidden = isCompact || !all.length;
  $('#cards').hidden = !items.length;
  $('#cards').innerHTML = items.map(item => {
    const kind = type(item.target), isScript = kind === 'script';
    const icon = kind === 'document' ? 'file' : kind === 'file' ? 'folder' : kind;
    if (isCompact) return `<article class="card compact-card type-${kind}" data-id="${esc(item.id)}"><button class="compact-open" data-action="open" title="${isScript ? '运行' : '打开'}：${esc(item.target)}"><span class="file-icon">${svg(icon)}</span><span class="compact-file-name">${esc(item.name)}</span><span class="compact-open-icon">${svg(isScript ? 'play' : 'open')}</span></button></article>`;
    const extension = item.target.split(/[\\/]/).pop().match(/\.([a-z0-9]{1,8})$/i)?.[1].toUpperCase();
    const label = kind === 'link' ? 'WEB' : extension || 'FILE';
    return `<article class="card type-${kind}" data-id="${esc(item.id)}">
      <button class="card-main" data-action="open" title="${isScript ? '运行' : '打开'}：${esc(item.target)}"><span class="file-icon">${svg(icon)}</span><span class="card-text"><h3>${esc(item.name)}</h3><span class="card-path" title="${esc(item.target)}">${esc(item.target)}</span></span></button>
      ${item.note ? `<p class="card-note">${esc(item.note)}</p>` : ''}
      <div class="card-bottom"><span class="file-badge">${esc(label)}</span><span class="card-actions">
      ${kind !== 'link' ? `<button class="icon-button" data-action="reveal" title="在资源管理器中显示" aria-label="显示 ${esc(item.name)} 的位置">${svg('folder')}</button>` : ''}
      <button class="icon-button" data-action="copy" title="复制路径" aria-label="复制 ${esc(item.name)} 的路径">${svg('copy')}</button>
      <button class="icon-button" data-action="edit" title="编辑快捷方式" aria-label="编辑 ${esc(item.name)}">${svg('edit')}</button>
      <button class="icon-button" data-action="remove" title="移除快捷方式" aria-label="移除 ${esc(item.name)}">${svg('trash')}</button></span>
      <button class="card-open" data-action="open">${isScript ? '运行' : '打开'}${svg(isScript ? 'play' : 'arrow')}</button></div></article>`;
  }).join('');
}
function field(name, label, value, { required = false, max = 100, placeholder = '', multiline = false, help = '' } = {}) {
  const attrs = `name="${name}" id="field-${name}" maxlength="${max}" ${required ? 'required' : ''} placeholder="${esc(placeholder)}"`;
  return `<label class="field">${label}${multiline ? `<textarea ${attrs}>${esc(value)}</textarea>` : `<input ${attrs} value="${esc(value)}">`}${help ? `<small>${help}</small>` : ''}</label>`;
}
function openEditor(mode, id) {
  if (isCompact) return;
  editorMode = mode; editorId = id;
  $('#dialog-error').textContent = '';
  $('#dialog-delete').hidden = mode !== 'group-edit';
  $('#dialog-save').textContent = mode.endsWith('new') ? '添加' : '保存';
  if (mode.startsWith('group')) {
    const current = mode === 'group-edit' ? group() : { name: '', description: '' };
    $('#dialog-title').textContent = mode === 'group-edit' ? '编辑工作集' : '新建工作集';
    $('#dialog-fields').innerHTML = field('name', '工作集名称', current.name, { required: true, max: 50, placeholder: '例如：装备配置、任务奖励、每周发布' }) + field('description', '说明（选填）', current.description, { multiline: true, max: 200, placeholder: '这项工作需要做什么？' });
  } else {
    const item = mode === 'item-edit' ? group().items.find(i => i.id === id) : { name: '', target: '', note: '' };
    $('#dialog-title').textContent = mode === 'item-edit' ? '编辑快捷方式' : '添加快捷方式';
    $('#dialog-fields').innerHTML = field('name', '显示名称', item.name, { required: true, max: 100, placeholder: '例如：装备基础属性' }) + field('target', '文件路径或网址', item.target, { required: true, max: 4096, placeholder: 'D:\\工作\\装备.xlsx 或 https://…', help: '填写完整路径；在线文档支持 HTTP / HTTPS 链接。' }) + '<div class="browse-buttons"><button type="button" id="browse-file" class="button button-light">选择文件</button><button type="button" id="browse-folder" class="button button-light">选择文件夹</button></div>' + field('note', '备注（选填）', item.note, { multiline: true, max: 500, placeholder: '例如：修改后记得执行导表' });
    $('#browse-file').onclick = () => safely(() => browse(false));
    $('#browse-folder').onclick = () => safely(() => browse(true));
  }
  $('#editor').showModal();
  setTimeout(() => $('#field-name').focus(), 30);
}
async function browse(folder) {
  const files = await api.chooseFiles(folder);
  if (!files.length) return;
  $('#field-target').value = files[0];
  if (!$('#field-name').value.trim()) $('#field-name').value = files[0].split(/[\\/]/).pop();
}
async function addPaths(paths) {
  if (isCompact || !group()) return;
  if (!paths.length) return;
  const items = await api.describeFiles(paths);
  let added = 0;
  await change(next => {
    const current = next.groups.find(g => g.id === next.selectedGroup);
    for (const item of items) {
      if (!current.items.some(i => i.target.toLowerCase() === item.target.toLowerCase())) { current.items.push(item); added++; }
    }
  });
  toast(added ? `已添加 ${added} 个快捷方式${added < items.length ? '，已跳过重复文件' : ''}` : '这些文件已在当前工作集中');
}
async function chooseAndAdd(folder = false) {
  $('#add-menu').hidden = true; $('#add-toggle').setAttribute('aria-expanded', 'false');
  await addPaths(await api.chooseFiles(folder));
}
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = svg(el.dataset.icon); });
$('#search').addEventListener('input', event => { query = event.target.value.trim().toLowerCase(); renderCards(); });
$('#filters').onclick = event => { const button = event.target.closest('[data-filter]'); if (button) { filter = button.dataset.filter; renderCards(); } };
$('#clear-search').onclick = () => { filter = 'all'; query = ''; $('#search').value = ''; renderCards(); };
async function selectGroup(id) {
  await change(next => { next.selectedGroup = id; });
  $('#search').value = ''; query = ''; filter = 'all';
  if (isCompact) { revealSelectedTab = true; render(); }
  else renderCards();
  [...$('#groups').querySelectorAll('[data-group]')].find(button => button.dataset.group === id)?.focus();
}
$('#groups').onclick = event => safely(async () => {
  const deleteButton = event.target.closest('[data-delete-group]');
  if (deleteButton && !isCompact) return deleteGroup(deleteButton.dataset.deleteGroup);
  const button = event.target.closest('[data-group]');
  if (button) {
    await selectGroup(button.dataset.group);
  }
});
$('#groups').addEventListener('keydown', event => {
  const tab = event.target.closest('[data-group]');
  if (!tab || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  if (saving || !state.groups.length) return;
  let index = state.groups.findIndex(g => g.id === tab.dataset.group);
  if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = state.groups.length - 1;
  else index = (index + (event.key === 'ArrowDown' ? 1 : -1) + state.groups.length) % state.groups.length;
  safely(() => selectGroup(state.groups[index].id));
});
$('#groups-prev').onclick = () => { groupPage--; render(); };
$('#groups-next').onclick = () => { groupPage++; render(); };
$('#new-group').onclick = $('#new-group-icon').onclick = () => openEditor('group-new');
$('#edit-group').onclick = () => openEditor('group-edit');
$('#pin').onclick = () => safely(async () => { await change(next => { next.alwaysOnTop = !next.alwaysOnTop; }); toast(state.alwaysOnTop ? '窗口已置顶' : '已取消窗口置顶'); });
function applyView(compact) {
  const entering = compact && !isCompact;
  isCompact = compact;
  document.body.classList.toggle('compact', compact);
  $('#compact').setAttribute('aria-pressed', String(compact));
  $('#compact-label').textContent = compact ? '完整模式' : '精简';
  $('#compact').title = compact ? '返回完整模式，管理工作集和快捷方式' : '切换精简窗口';
  $('#add-menu').hidden = true;
  $('#drop-overlay').hidden = true;
  dragDepth = 0;
  if (compact) document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  if (state) {
    if (entering) revealSelectedTab = true;
    render();
  }
}
$('#compact').onclick = () => safely(async () => applyView(await api.compact()));
for (const method of ['minimize', 'maximize', 'close']) $(`#${method}`).onclick = () => safely(() => api[method]());
$('#add-toggle').onclick = () => { $('#add-menu').hidden = !$('#add-menu').hidden; $('#add-toggle').setAttribute('aria-expanded', String(!$('#add-menu').hidden)); };
document.addEventListener('click', e => { if (!e.target.closest('.add-wrap')) { $('#add-menu').hidden = true; $('#add-toggle').setAttribute('aria-expanded', 'false'); } });
$('#add-files').onclick = () => safely(() => chooseAndAdd());
$('#empty-add').onclick = () => group() ? safely(() => chooseAndAdd()) : openEditor('group-new');
$('#add-folder').onclick = () => safely(() => chooseAndAdd(true));
$('#add-manual').onclick = () => { $('#add-menu').hidden = true; openEditor('item-new'); };
$('#dialog-close').onclick = $('#dialog-cancel').onclick = () => $('#editor').close();
$('#editor-form').onsubmit = async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  $('#dialog-save').disabled = true;
  try {
    await change(next => {
      if (editorMode === 'group-new') {
        const id = crypto.randomUUID();
        next.groups.push({ id, name: values.name, description: values.description, items: [] }); next.selectedGroup = id;
      } else if (editorMode === 'group-edit') {
        Object.assign(next.groups.find(g => g.id === next.selectedGroup), { name: values.name, description: values.description });
      } else {
        const current = next.groups.find(g => g.id === next.selectedGroup);
        const item = { id: editorId || crypto.randomUUID(), name: values.name, target: values.target, note: values.note };
        if (editorMode === 'item-edit') current.items[current.items.findIndex(i => i.id === editorId)] = item;
        else current.items.push(item);
      }
    });
    $('#editor').close(); toast('已保存');
  } catch (error) { $('#dialog-error').textContent = error.message; }
  finally { $('#dialog-save').disabled = false; }
};
async function deleteGroup(id) {
  if (isCompact) return;
  const current = state.groups.find(g => g.id === id);
  if (!current) return;
  if ($('#editor').open) $('#editor').close();
  if (await confirmAction(`删除「${current.name}」？`, `将移除此工作集和 ${current.items.length} 个快捷方式。原文件会保留。`)) {
    await change(next => {
      const index = next.groups.findIndex(g => g.id === current.id);
      next.groups = next.groups.filter(g => g.id !== current.id);
      if (next.selectedGroup === current.id) next.selectedGroup = next.groups[Math.min(index, next.groups.length - 1)]?.id || null;
    });
    toast('工作集已删除');
  }
}
$('#dialog-delete').onclick = $('#delete-group').onclick = () => safely(() => deleteGroup(state.selectedGroup));
$('#cards').onclick = event => safely(async () => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = button.closest('[data-id]').dataset.id;
  const item = group().items.find(i => i.id === id);
  switch (button.dataset.action) {
    case 'edit': openEditor('item-edit', id); break;
    case 'open': {
      button.disabled = true;
      try { const result = await api.open(id); if (!result.cancelled) toast(type(item.target) === 'script' ? '已启动，请在脚本窗口查看执行结果' : `已请求打开「${item.name}」`); }
      finally { button.disabled = false; }
      break;
    }
    case 'reveal': await api.reveal(id); break;
    case 'copy': await navigator.clipboard.writeText(item.target); toast('路径已复制'); break;
    case 'remove':
      if (await confirmAction(`移除「${item.name}」？`, '只移除这个快捷方式，原文件会保留。')) { await change(next => { const current = next.groups.find(g => g.id === next.selectedGroup); current.items = current.items.filter(i => i.id !== id); }); toast('快捷方式已移除'); }
      break;
  }
});
$('#open-all').onclick = () => safely(async () => {
  $('#open-all').disabled = true;
  try {
    const result = await api.openGroup(group().id);
    const text = `已请求打开 ${result.opened} 个文件${result.skipped ? `；${result.skipped} 个脚本需单独运行` : ''}`;
    if (result.errors.length) message('部分文件未能打开', text + '\n\n' + result.errors.join('\n'));
    else toast(text);
  } finally { render(); }
});
$('#export').onclick = () => safely(async () => { await saveQueue; if (await api.exportData()) toast('工作集备份已导出'); });
$('#import').onclick = () => safely(async () => { await saveQueue; const imported = await api.importData(); if (imported) { state = imported; query = ''; filter = 'all'; $('#search').value = ''; render(); toast('工作集已导入，原配置已自动备份'); } });
$('#data-info').onclick = () => message('数据保存在本机', `${dataPath}\n\n工作集仅保存文件路径和备注，不复制原文件。可用左下角的“导出”备份全部分组。`);
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { if (!isCompact && !$('dialog[open]')) { event.preventDefault(); $('#search').focus(); $('#search').select(); } }
  if (event.key === 'Escape') { $('#add-menu').hidden = true; dragDepth = 0; $('#drop-overlay').hidden = true; }
});
document.addEventListener('dragenter', event => { if (!isCompact && group() && event.dataTransfer.types.includes('Files') && !$('dialog[open]')) { event.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; } });
document.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = isCompact ? 'none' : 'copy'; });
document.addEventListener('dragleave', () => { dragDepth--; if (dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; } });
document.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; $('#drop-overlay').hidden = true;
  if (isCompact || !group() || $('dialog[open]')) return;
  const paths = [...event.dataTransfer.files].map(file => api.droppedPath(file)).filter(Boolean);
  safely(() => addPaths(paths));
});
api.onPinError(error => safely(async () => {
  const loaded = await api.load();
  state = loaded.state;
  render();
  toast(error.message, true);
}));
api.onViewChanged(view => applyView(view.compact));
window.addEventListener('resize', () => { if (isCompact && state) { revealSelectedTab = true; render(); } });
safely(async () => { const loaded = await api.load(); state = loaded.state; dataPath = loaded.dataPath; applyView(loaded.compact); });
