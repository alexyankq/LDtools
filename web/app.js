import { TYPES, DEFAULT_RULES, PROFILES, clone, scenario, makeEvent, analyze, validateEvents, validateRules, validateProfile, validateProject } from './model.js';
import { CELL_WIDTH, ROW_HEIGHT, RULER_HEIGHT, gridGeometry, positionAt } from './timeline.js';

const $ = id => document.getElementById(id);
const STORAGE = 'ldtools-shot-v1';
const SESSION_STORAGE = 'ldtools-shot-sessions-v1';
let project = { version: 1, events: scenario(), rules: clone(DEFAULT_RULES), profile: clone(PROFILES.balanced), unit: 5 };
let selected = project.events[0].id, baseline = null, scenarioName = 'standard', profileName = 'balanced', analysis = null, analyzedProject = null;
let sessions = [], activeSessionId;
const sessionRuntime = new Map();
let ruleLibrary = [{ id: 'default', data: clone(DEFAULT_RULES) }];
let profileLibrary = Object.entries(PROFILES).map(([id, data]) => ({ id, data: clone(data) }));
let editorKind = 'rules';
let eventDraft = null, editingPreset = null, contextEventId = null, suppressedClickUntil = 0;
let presets = Object.entries(TYPES).map(([type, name]) => ({ id: `preset-${type}`, data: makeEvent({ name, type, start: 0, duration: ['reward', 'goal', 'failure'].includes(type) ? 0 : 30 }) }));
const COLORS = { engagement: '#99dfbd', arousal: '#d4a071', valence: '#97aef4', fatigue: '#d28fa7' };
const SERIES = { engagement: '参与意愿', arousal: '情绪唤醒', valence: '情绪效价', fatigue: '疲劳' };
const EVENT_COLORS = { tutorial: '#7cb2cb', challenge: '#cb9d71', explore: '#82b7a6', story: '#b499d3', goal: '#c7bc78', reward: '#9bdfbc', failure: '#d38991', rest: '#7aa8bc' };
const LABELS = { intensity: '强度', difficulty: '难度', novelty: '新颖度', feedback: '反馈清晰度', value: '奖励 / 目标价值', cost: '失败成本' };
const DIAGNOSES = { 'knowledge-gap': '机制知识不足', repetition: '重复体验候选', 'challenge-mismatch': '挑战与能力失配', fatigue: '疲劳积累', boredom: '长时间低活动', 'reward-gap': '奖励与投入脱节' };
const visible = new Set(Object.keys(SERIES));
const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const format = x => Number(x.toFixed(2)).toString();
const message = (text, error = false) => { $('status').textContent = text; $('status').className = error ? 'error' : ''; };
try {
  const workspace = localStorage.getItem(SESSION_STORAGE);
  const saved = localStorage.getItem(STORAGE);
  if (workspace) {
    const restored = JSON.parse(workspace);
    if (restored.version !== 1 || !Array.isArray(restored.sessions) || !restored.sessions.length) throw Error('无效会话数据');
    const ids = new Set();
    for (const session of restored.sessions) {
      if (typeof session.id !== 'string' || ids.has(session.id) || typeof session.title !== 'string' || session.title.length > 80) throw Error('无效会话信息');
      ids.add(session.id); validateProject(session.project);
      analyze(session.project.events, session.project.rules, session.project.profile, session.project.unit);
    }
    for (const [key, validate] of [['ruleLibrary', validateRules], ['profileLibrary', validateProfile]]) {
      if (restored[key] !== undefined) {
        if (!Array.isArray(restored[key]) || !restored[key].length) throw Error('无效配置库');
        const libraryIds = new Set();
        for (const entry of restored[key]) { if (typeof entry.id !== 'string' || libraryIds.has(entry.id)) throw Error('无效配置条目'); libraryIds.add(entry.id); validate(entry.data); }
      }
    }
    ruleLibrary = restored.ruleLibrary || ruleLibrary; profileLibrary = restored.profileLibrary || profileLibrary;
    if (restored.presets !== undefined) {
      if (!Array.isArray(restored.presets) || restored.presets.length > 300) throw Error('无效预设库');
      const presetIds = new Set();
      for (const preset of restored.presets) { if (typeof preset.id !== 'string' || presetIds.has(preset.id)) throw Error('无效预设'); presetIds.add(preset.id); validateEvents([preset.data]); }
      presets = restored.presets;
    }
    sessions = restored.sessions;
    activeSessionId = ids.has(restored.activeSessionId) ? restored.activeSessionId : sessions[0].id;
    project = clone(sessions.find(s => s.id === activeSessionId).project);
    selected = project.events[0]?.id; scenarioName = 'custom'; profileName = 'custom';
  } else if (saved) {
    const restored = clone(validateProject(JSON.parse(saved)));
    analyze(restored.events, restored.rules, restored.profile, restored.unit);
    project = restored; selected = project.events[0]?.id; scenarioName = 'custom'; profileName = 'custom';
  }
} catch { message('本地保存的数据无法读取，已使用示例。你可以导入项目 JSON 恢复。', true); }
if (!sessions.length) {
  activeSessionId = crypto.randomUUID();
  sessions = [{ id: activeSessionId, title: '我的第一次分析', project: clone(project) }];
}

$('event-type').innerHTML = Object.entries(TYPES).map(([key, name]) => `<option value="${key}">${name}</option>`).join('');
$('attributes').innerHTML = Object.entries(LABELS).map(([key, label]) => `<label>${label}<input name="${key}" type="number" min="0" max="10" step="any" required></label>`).join('');
$('legend').innerHTML = Object.entries(SERIES).map(([key, label]) => `<label><input type="checkbox" data-series="${key}" checked><i style="background:${COLORS[key]}"></i>${label}</label>`).join('');

function save() {
  sessions.find(s => s.id === activeSessionId).project = clone(project);
  try {
    localStorage.setItem(SESSION_STORAGE, JSON.stringify({ version: 1, activeSessionId, sessions, ruleLibrary, profileLibrary, presets }));
    $('storage-status').textContent = '分析会话自动保存在此浏览器';
  } catch { $('storage-status').textContent = '浏览器保存不可用，请分别导出分析保留修改'; }
}
function renderSessions() {
  $('session-title').value = sessions.find(s => s.id === activeSessionId).title;
  document.title = `${$('session-title').value} · shot`;
  const list = $('session-list'), signature = JSON.stringify(sessions.map(s => s.id));
  // Input changes can fire between pointerdown and click. Update existing buttons
  // rather than replacing their DOM nodes during analysis/settings updates.
  if (list.dataset.signature !== signature) {
    list.innerHTML = sessions.map(s => `<button class="session-item" data-session="${esc(s.id)}"><span class="session-icon" aria-hidden="true">◷</span><span class="session-name"></span><span class="session-count"></span></button>`).join('');
    list.dataset.signature = signature;
  }
  [...list.children].forEach((button, index) => {
    const session = sessions[index], active = session.id === activeSessionId;
    button.classList.toggle('active', active); button.title = session.title;
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    button.querySelector('.session-name').textContent = session.title;
    button.querySelector('.session-count').textContent = session.project.events.length;
  });
}
function activateSession(id) {
  if (id === activeSessionId) return;
  save();
  sessionRuntime.set(activeSessionId, { selected, baseline, scenarioName, profileName, analysis, analyzedProject });
  activeSessionId = id;
  project = clone(sessions.find(s => s.id === id).project);
  eventDraft = null; editingPreset = null; hideContextMenu();
  const runtime = sessionRuntime.get(id);
  selected = runtime?.selected ?? project.events[0]?.id;
  baseline = runtime?.baseline ?? null;
  analysis = runtime?.analysis ?? null; analyzedProject = runtime?.analyzedProject ?? null;
  scenarioName = runtime?.scenarioName ?? 'custom'; profileName = runtime?.profileName ?? 'custom';
  render(); message('已切换分析会话。');
}
function setSidebar(open) {
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  document.body.classList.toggle('sidebar-open', mobile && open);
  document.body.classList.toggle('sidebar-collapsed', !mobile && !open);
  $('sidebar-backdrop').hidden = !mobile || !open;
  $('sidebar-toggle').setAttribute('aria-expanded', String(open));
  $('session-sidebar').inert = !open;
}
$('new-session').addEventListener('click', () => {
  const session = { id: crypto.randomUUID(), title: `新分析 ${sessions.length + 1}`, project: { version: 1, events: [], rules: clone(DEFAULT_RULES), profile: clone(PROFILES.balanced), unit: 5 } };
  sessions.unshift(session); activateSession(session.id);
  if (window.matchMedia('(max-width: 760px)').matches) setSidebar(false);
  $('session-title').focus(); $('session-title').select();
  message('已新建独立分析。可以先命名，再添加事件或载入示例。');
});
$('session-list').addEventListener('click', event => {
  const button = event.target.closest('[data-session]'); if (!button) return;
  activateSession(button.dataset.session);
  if (window.matchMedia('(max-width: 760px)').matches) { setSidebar(false); $('sidebar-toggle').focus(); }
});
$('session-title').addEventListener('change', event => {
  const title = event.target.value.trim() || '未命名分析';
  sessions.find(s => s.id === activeSessionId).title = title;
  // Keep sidebar buttons in place while a title blur precedes a session click.
  const button = $('session-list').querySelector('.session-item.active');
  button.querySelector('.session-name').textContent = title; button.title = title;
  event.target.value = title; document.title = `${title} · shot`;
  save(); message('分析名称已保存。');
});
$('session-title').addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
$('sidebar-toggle').addEventListener('click', () => setSidebar($('sidebar-toggle').getAttribute('aria-expanded') !== 'true'));
$('sidebar-backdrop').addEventListener('click', () => { setSidebar(false); $('sidebar-toggle').focus(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) { setSidebar(false); $('sidebar-toggle').focus(); } });
window.matchMedia('(max-width: 760px)').addEventListener('change', event => setSidebar(!event.matches));
setSidebar(!window.matchMedia('(max-width: 760px)').matches);
function projectDuration() { return Math.max(0, ...project.events.map(e => e.start + e.duration)); }
function dirty() { return JSON.stringify(project) !== analyzedProject; }
function register(library, data) {
  let entry = library.find(e => JSON.stringify(e.data) === JSON.stringify(data));
  if (!entry) { entry = { id: crypto.randomUUID(), data: clone(data) }; library.push(entry); }
  return entry.id;
}
function render() {
  $('average').textContent = analysis ? analysis.summary.average.toFixed(2) : '—';
  $('minimum').textContent = analysis ? analysis.summary.minimum.toFixed(2) : '—';
  $('duration').textContent = `${format(projectDuration() / 60)} 分`;
  $('event-count').textContent = `${project.events.length} 个事件${analysis ? ` · 上次分析 ${analysis.samples.length} 个采样点` : ''}`;
  $('diagnosis-count').textContent = analysis ? analysis.diagnostics.length : '—';
  $('analysis-state').textContent = !analysis ? '配置会话并准备事件后，点击「开始分析」。' : dirty() ? '会话内容已变更；下方仍是上次结果，点击「开始分析」更新。' : '分析已完成，结果对应当前会话配置。';
  $('baseline').disabled = !analysis || dirty();
  $('delta').className = '';
  if (baseline && analysis) {
    const change = analysis.summary.average - baseline.result.summary.average;
    $('delta').textContent = `与基线相比 ${change >= 0 ? '+' : ''}${change.toFixed(2)} · 模型预测`;
    $('delta').className = change >= 0 ? 'positive' : 'negative';
  } else $('delta').textContent = '按时长加权 · 0–10';
  $('baseline-label').hidden = !baseline; $('clear-baseline').hidden = !baseline;
  const ruleId = register(ruleLibrary, project.rules), profileId = register(profileLibrary, project.profile);
  for (const [id, library, value] of [['rules', ruleLibrary, ruleId], ['profile', profileLibrary, profileId]]) {
    $(id).innerHTML = library.map(e => `<option value="${esc(e.id)}">${esc(e.data.name)}</option>`).join(''); $(id).value = value;
  }
  $('scenario').value = scenarioName; $('unit').value = project.unit;
  $('timeline-span').value = gridGeometry(project).span;
  renderChart(); renderEvents(); renderDiagnostics(); fillEditor(); renderPresets(); save(); renderSessions();
}
function renderChart() {
  if (!analysis) { $('chart').innerHTML = '<p class="empty">点击「开始分析」生成体验曲线。</p>'; return; }
  const width = 880, height = 285, left = 40, top = 15, bottom = 245, right = 860;
  const duration = Math.max(1, analysis.duration, baseline?.result.duration || 0);
  const x = t => left + t / duration * (right - left), y = v => bottom - v / 10 * (bottom - top);
  let svg = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="体验曲线。详细数值见上方摘要，诊断见下方列表。">`;
  for (let v = 0; v <= 10; v += 2) svg += `<line class="grid" x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}"/><text x="25" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  for (let i = 0; i <= 6; i++) svg += `<text x="${x(i * duration / 6)}" y="270" text-anchor="middle">${format(i * duration / 6)}s</text>`;
  for (const key of visible) {
    if (baseline) svg += line(baseline.result.samples, key, true);
    svg += line(analysis.samples, key, false);
  }
  function line(samples, key, dashed) {
    const points = samples.map(s => `${x(s.time).toFixed(2)},${y(s[key]).toFixed(2)}`).join(' ');
    return `<polyline points="${points}" fill="none" stroke="${COLORS[key]}" stroke-width="${dashed ? 1.5 : 2.5}" ${dashed ? 'stroke-dasharray="6 5" opacity=".5"' : ''} stroke-linejoin="round"/>`;
  }
  $('chart').innerHTML = svg + '</svg>';
}
function renderEvents() {
  const ordered = [...project.events].sort((a, b) => a.start - b.start);
  const geometry = gridGeometry(project), scrollLeft = $('timeline').scrollLeft, scrollTop = $('timeline').scrollTop;
  const labelStep = Math.max(1, Math.ceil(geometry.columns / 1000));
  let ticks = '';
  for (let i = 0; i < geometry.columns; i += labelStep) ticks += `<span style="left:${i * CELL_WIDTH}px">${format(i * project.unit)}s</span>`;
  const blocks = geometry.events.map(e => `<button class="grid-event ${e.duration / project.unit * CELL_WIDTH < 100 ? 'compact' : ''} ${selected === e.id && !editingPreset ? 'selected' : ''}" data-edit="${esc(e.id)}" data-move="${esc(e.id)}" title="${esc(e.name)} · ${format(e.start)}s / ${format(e.duration)}s" style="left:${e.start / project.unit * CELL_WIDTH + 5}px;top:${e.lane * ROW_HEIGHT + 6}px;width:${Math.max(36, e.duration / project.unit * CELL_WIDTH - 10)}px;background:${EVENT_COLORS[e.type]}"><span>${esc(e.name)}</span><small>${format(e.start)}s</small></button>`).join('');
  const marker = eventDraft && !editingPreset ? `<span class="draft-cell" style="left:${eventDraft.start / project.unit * CELL_WIDTH}px;top:${(eventDraft.lane || 0) * ROW_HEIGHT}px"></span>` : '';
  $('timeline').innerHTML = `<div class="timeline-canvas" style="width:${geometry.width}px"><div class="time-ruler" style="height:${RULER_HEIGHT}px">${ticks}</div><div id="time-grid" class="time-grid" role="grid" aria-label="时元点阵，点击位置新增事件" style="height:${geometry.rows * ROW_HEIGHT}px" tabindex="0">${blocks}${marker}<span id="drop-cell" class="drop-cell" hidden></span></div></div>`;
  $('timeline').scrollLeft = scrollLeft; $('timeline').scrollTop = scrollTop;
  $('events').innerHTML = ordered.map(e => `<tr class="${e.id === selected ? 'selected-row' : ''}"><td><button class="event-name" data-edit="${esc(e.id)}">${esc(e.name)}</button></td><td>${TYPES[e.type]}</td><td>${format(e.start)}</td><td>${e.duration === 0 ? '瞬时' : format(e.duration)}</td><td><button data-edit="${esc(e.id)}">编辑</button><button data-copy="${esc(e.id)}">复制</button><button data-delete="${esc(e.id)}" aria-label="删除 ${esc(e.name)}">删除</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">还没有事件，点击「添加事件」开始。</td></tr>';
}
function renderDiagnostics() {
  if (!analysis) { $('diagnostics').innerHTML = '<p class="empty">开始分析后显示诊断结果。</p>'; return; }
  $('diagnostics').innerHTML = analysis.diagnostics.map(d => `<article class="diagnostic"><h3>${DIAGNOSES[d.rule]} <span class="tag">${format(d.time)}s</span>${d.eventId ? `<button data-edit="${esc(d.eventId)}">定位事件</button>` : ''}</h3><p>事件：${esc(d.eventName)} · 规则：${esc(d.rule)}</p><p>证据：${esc(d.evidence)}</p><p>修改假设：${esc(d.suggestion)}</p></article>`).join('') || '<p class="empty">当前规则未触发诊断候选。仍需结合设计意图与试玩检查。</p>';
}
function fillEditor() {
  const e = editingPreset ? presets.find(p => p.id === editingPreset)?.data || eventDraft : eventDraft || project.events.find(e => e.id === selected);
  const form = $('event-form');
  for (const control of form.elements) control.disabled = !e;
  $('editor-title').textContent = editingPreset ? '管理预设事件' : eventDraft ? `新增事件 · ${format(eventDraft.start)} 秒` : e ? '编辑时间轴事件' : '点击格子或选择预设';
  $('save-event').textContent = editingPreset ? '保存预设修改' : eventDraft ? '保存新增事件' : '保存事件修改';
  $('save-preset').textContent = editingPreset ? '另存为新预设' : '保存为预设';
  $('delete-preset').hidden = !editingPreset || !presets.some(p => p.id === editingPreset);
  for (const name of ['start']) form.elements.namedItem(name).disabled = !e || !!editingPreset;
  if (e) {
    for (const [k, v] of Object.entries(e)) if (form.elements.namedItem(k)) form.elements.namedItem(k).value = v;
  } else form.reset();
  $('form-error').textContent = '';
}
const newId = () => crypto.randomUUID();
function apply(candidate, notice, custom = true) {
  validateProject(candidate);
  // Compute first: a rejected import/edit cannot corrupt the current project.
  analyze(candidate.events, candidate.rules, candidate.profile, candidate.unit);
  project = clone(candidate);
  if (custom) scenarioName = 'custom';
  render(); message(notice);
}
$('event-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const data = readEventForm();
    if (editingPreset) {
      validateEvents([data]);
      const entry = presets.find(p => p.id === editingPreset);
      if (entry) entry.data = toTemplate(data); else { presets.push({ id: editingPreset, data: toTemplate(data) }); }
      eventDraft = null; render(); message('预设已保存。已放入时间轴的事件保持独立。'); return;
    }
    const candidate = clone(project);
    if (eventDraft) candidate.events.push(data); else Object.assign(candidate.events.find(e => e.id === selected), data);
    validateProject(candidate); analyze(candidate.events, candidate.rules, candidate.profile, candidate.unit);
    selected = data.id; eventDraft = null;
    apply(candidate, '事件已保存，点击「开始分析」更新结果。');
  } catch (error) { $('form-error').textContent = error.message; }
});
document.addEventListener('click', event => {
  if (Date.now() < suppressedClickUntil) return;
  const edit = event.target.closest('[data-edit]'), copy = event.target.closest('[data-copy]'), remove = event.target.closest('[data-delete]');
  if (edit) { selected = edit.dataset.edit; eventDraft = null; editingPreset = null; renderEvents(); fillEditor(); $('event-form').elements.namedItem('name').focus(); }
  if (copy) {
    const e = project.events.find(e => e.id === copy.dataset.copy), candidate = clone(project);
    selected = newId(); candidate.events.push({ ...e, id: selected, name: e.name.slice(0, 195) + ' 副本', start: Math.min(7200 - e.duration, e.start + e.duration) });
    try { apply(candidate, '事件已复制，可调整时间和属性。'); } catch (e) { selected = project.events[0]?.id; message(e.message, true); }
  }
  if (remove) {
    const candidate = clone(project); candidate.events = candidate.events.filter(e => e.id !== remove.dataset.delete);
    if (selected === remove.dataset.delete) selected = candidate.events[0]?.id;
    apply(candidate, '事件已删除。若要恢复，可导入之前导出的项目。');
  }
});
$('add-event').addEventListener('click', () => {
  if (project.events.length >= 300) { message('最多支持 300 个事件。', true); return; }
  beginDraft({ start: Math.min(7200 - project.unit, Math.ceil(projectDuration() / project.unit) * project.unit), lane: 0 });
});
$('scenario').addEventListener('change', event => {
  // Preserve edits: downloading before replacing provides a portable recovery path.
  if (scenarioName === 'custom') download('shot-before-example.json', project);
  scenarioName = event.target.value;
  const candidate = clone(project); candidate.events = scenario(scenarioName); selected = candidate.events[0].id;
  eventDraft = null; editingPreset = null;
  apply(candidate, '已载入假想示例流程。自定义流程如被替换，已自动导出备份。', false);
});
$('profile').addEventListener('change', event => {
  profileName = event.target.value;
  const candidate = clone(project); candidate.profile = clone(profileLibrary.find(e => e.id === profileName).data); apply(candidate, '当前用户类型已设置，点击「开始分析」运行。', false);
});
$('rules').addEventListener('change', event => {
  const candidate = clone(project); candidate.rules = clone(ruleLibrary.find(e => e.id === event.target.value).data); apply(candidate, '当前规则已设置，点击「开始分析」运行。', false);
});
$('unit').addEventListener('change', event => {
  try { const candidate = clone(project); candidate.unit = Number(event.target.value); apply(candidate, '分析精度已设置，点击「开始分析」更新采样。', false); }
  catch (e) { event.target.value = project.unit; message(e.message, true); }
});
$('baseline').addEventListener('click', () => { baseline = { project: clone(project), result: clone(analysis) }; render(); message('已冻结当前结果作为基线。接下来编辑事件、画像或规则，查看预测差异。'); });
$('clear-baseline').addEventListener('click', () => { baseline = null; render(); message('对比基线已清除。'); });
$('legend').addEventListener('change', event => { const key = event.target.dataset.series; if (event.target.checked) visible.add(key); else visible.delete(key); renderChart(); });
$('run-analysis').addEventListener('click', () => {
  try { analysis = analyze(project.events, project.rules, project.profile, project.unit); analyzedProject = JSON.stringify(project); render(); message('当前会话分析完成。'); }
  catch (error) { message(error.message, true); }
});
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export-project').addEventListener('click', () => download('shot-project.json', project));
async function read(input, validate, consume) {
  const file = input.files[0]; if (!file) return;
  try { if (file.size > 2_000_000) throw Error('文件不得超过 2 MB'); const data = JSON.parse(await file.text()); validate(data); consume(data); }
  catch (e) { message(`导入失败：${e.message}`, true); }
  finally { input.value = ''; }
}
$('import-project').addEventListener('change', e => read(e.target, validateProject, data => {
  // Validate execution before changing selection/configuration.
  analyze(data.events, data.rules, data.profile, data.unit);
  selected = data.events[0]?.id; eventDraft = null; editingPreset = null; profileName = 'custom'; apply(data, '项目已导入，点击「开始分析」运行。');
}));
$('import-rules').addEventListener('change', e => read(e.target, validateRules, rules => { const candidate = clone(project); candidate.rules = rules; apply(candidate, '规则已导入并选中，点击「开始分析」运行。', false); }));
$('import-profile').addEventListener('change', e => read(e.target, validateProfile, profile => { const candidate = clone(project); candidate.profile = profile; apply(candidate, '玩家类型已导入并选中，点击「开始分析」运行。', false); }));
function editorLibrary() { return editorKind === 'rules' ? ruleLibrary : profileLibrary; }
function openEditor(kind) {
  editorKind = kind; $('library-editor-title').textContent = kind === 'rules' ? '规则编辑器' : '玩家类型编辑器';
  $('library-entry').innerHTML = editorLibrary().map(e => `<option value="${esc(e.id)}">${esc(e.data.name)}</option>`).join('');
  $('library-json').value = JSON.stringify(editorLibrary()[0].data, null, 2); $('library-error').textContent = '';
  $('library-editor').showModal();
}
function editorData() {
  const data = JSON.parse($('library-json').value);
  (editorKind === 'rules' ? validateRules : validateProfile)(data); return data;
}
$('open-rule-editor').addEventListener('click', () => openEditor('rules'));
$('open-profile-editor').addEventListener('click', () => openEditor('profiles'));
$('close-library-editor').addEventListener('click', () => $('library-editor').close());
$('library-entry').addEventListener('change', event => { $('library-json').value = JSON.stringify(editorLibrary().find(e => e.id === event.target.value).data, null, 2); $('library-error').textContent = ''; });
$('library-save').addEventListener('click', () => {
  try {
    const data = editorData();
    const id = register(editorLibrary(), data); save(); render();
    $('library-entry').innerHTML = editorLibrary().map(e => `<option value="${esc(e.id)}">${esc(e.data.name)}</option>`).join(''); $('library-entry').value = id;
    $('library-error').textContent = ''; message('已保存到配置库，可在会话中选择。');
  } catch (error) { $('library-error').textContent = `保存失败：${error.message}`; }
});
$('library-export').addEventListener('click', () => { try { download(editorKind === 'rules' ? 'shot-rules.json' : 'shot-profile.json', editorData()); $('library-error').textContent = ''; } catch (error) { $('library-error').textContent = `导出失败：${error.message}`; } });

function renderPresets() {
  $('preset-list').innerHTML = presets.map(p => `<button class="preset-card ${editingPreset === p.id ? 'selected' : ''}" data-preset="${esc(p.id)}" title="点击编辑，长按拖入时间轴"><strong>${esc(p.data.name)}</strong><span>${TYPES[p.data.type]} · ${format(p.data.duration)}s</span><small>⠿ 长按拖入</small></button>`).join('') || '<p class="empty">暂无预设，点击新建或将事件保存为预设。</p>';
}
function beginDraft(position) {
  if (project.events.length >= 300) { message('最多支持 300 个事件。', true); return; }
  selected = null; editingPreset = null;
  eventDraft = makeEvent({ id: newId(), ...position, duration: Math.min(project.unit, 7200 - position.start) });
  renderEvents(); fillEditor(); renderPresets();
  message(`已选中 ${format(position.start)} 秒的格子，在下方填写后保存新增。`);
}
function readEventForm() {
  const base = editingPreset ? presets.find(p => p.id === editingPreset)?.data || eventDraft : eventDraft || project.events.find(e => e.id === selected);
  if (!base) throw Error('请先选择事件、格子或预设');
  const values = Object.fromEntries(new FormData($('event-form')));
  for (const key of ['duration', ...Object.keys(LABELS)]) values[key] = Number(values[key]);
  const data = { ...base, ...values, start: editingPreset ? 0 : Number(values.start) };
  validateEvents([data]); return data;
}
function toTemplate(data) {
  const template = clone(data); template.id = 'template'; template.start = 0; delete template.lane;
  return template;
}
function saveAsPreset(data) {
  if (presets.length >= 300) throw Error('预设库最多支持 300 个预设');
  const entry = { id: newId(), data: toTemplate(data) }; presets.push(entry); save(); renderPresets();
  message(`「${data.name}」已保存为预设，可在其他会话复用。`);
}
$('save-preset').addEventListener('click', () => { try { saveAsPreset(readEventForm()); } catch (error) { $('form-error').textContent = error.message; } });
$('delete-preset').addEventListener('click', () => {
  presets = presets.filter(p => p.id !== editingPreset); editingPreset = null; eventDraft = null; selected = null;
  render(); message('预设已删除，时间轴中的事件未改变。');
});
$('new-preset').addEventListener('click', () => {
  if (presets.length >= 300) { message('预设库最多支持 300 个预设', true); return; }
  editingPreset = newId(); eventDraft = makeEvent({ id: 'template', name: '新预设', duration: project.unit }); selected = null;
  fillEditor(); renderEvents(); renderPresets(); message('在下方事件编辑器填写内容并保存预设。');
});
$('preset-list').addEventListener('click', event => {
  if (Date.now() < suppressedClickUntil) return;
  const card = event.target.closest('[data-preset]'); if (!card) return;
  editingPreset = card.dataset.preset; eventDraft = null; selected = null;
  fillEditor(); renderPresets(); renderEvents(); message('正在编辑预设。修改不会同步到已经添加的事件。');
});
$('timeline-span').addEventListener('change', event => {
  try { const candidate = clone(project); candidate.timelineLength = Number(event.target.value); apply(candidate, '时间轴范围已调整。'); }
  catch (error) { event.target.value = project.timelineLength || 300; message(error.message, true); }
});
function pointOnGrid(clientX, clientY, duration = 0, offsetX = 0) {
  const grid = $('time-grid'), viewport = $('timeline').getBoundingClientRect(), rect = grid.getBoundingClientRect();
  if (clientX < viewport.left || clientX > viewport.right || clientY < Math.max(rect.top, viewport.top + RULER_HEIGHT) || clientY > Math.min(rect.bottom, viewport.bottom)) return null;
  return positionAt(clientX - rect.left - offsetX, clientY - rect.top, project.unit, gridGeometry(project), duration);
}
$('timeline').addEventListener('click', event => {
  if (Date.now() < suppressedClickUntil || event.target.closest('[data-edit]') || !event.target.closest('#time-grid')) return;
  const position = pointOnGrid(event.clientX, event.clientY);
  if (position) beginDraft(position);
});
$('timeline').addEventListener('keydown', event => {
  if (event.target.id === 'time-grid' && ['Enter', ' '].includes(event.key)) { event.preventDefault(); beginDraft({ start: 0, lane: 0 }); }
});
function hideContextMenu() { $('event-context-menu').hidden = true; contextEventId = null; }
$('timeline').addEventListener('contextmenu', event => {
  const target = event.target.closest('[data-edit]'); if (!target) return;
  event.preventDefault(); contextEventId = target.dataset.edit; selected = contextEventId; eventDraft = null; editingPreset = null;
  fillEditor(); const menu = $('event-context-menu'); menu.hidden = false;
  menu.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - 180))}px`;
  menu.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - menu.offsetHeight))}px`;
  menu.querySelector('button').focus();
});
document.addEventListener('pointerdown', event => { if (!event.target.closest('#event-context-menu')) hideContextMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { hideContextMenu(); cancelDrag(); } });
window.addEventListener('blur', () => { hideContextMenu(); cancelDrag(); });
$('event-context-menu').addEventListener('click', event => {
  const action = event.target.closest('[data-context]')?.dataset.context;
  const data = project.events.find(e => e.id === contextEventId); if (!data || !action) return;
  try {
    if (action === 'preset') saveAsPreset(data);
    else {
      const candidate = clone(project); eventDraft = null; editingPreset = null;
      if (action === 'delete') { candidate.events = candidate.events.filter(e => e.id !== data.id); selected = null; }
      else { selected = newId(); candidate.events.push({ ...data, id: selected, name: data.name.slice(0, 195) + ' 副本', lane: (gridGeometry(project).events.find(e => e.id === data.id)?.lane || 0) + 1 }); }
      apply(candidate, action === 'delete' ? '事件已删除。' : '事件已复制到下一层，开始时间与属性保持一致。');
    }
  } catch (error) { message(error.message, true); }
  hideContextMenu();
});

let drag = null;
function startDragPreview() {
  if (!drag || drag.active) return;
  drag.active = true; document.body.classList.add('timeline-dragging');
  const ghost = document.createElement('div'); ghost.className = 'drag-ghost'; ghost.textContent = drag.data.name; document.body.append(ghost); drag.ghost = ghost;
  updateDrag(drag.x, drag.y);
}
function updateDrag(x, y) {
  if (!drag?.active) return;
  drag.x = x; drag.y = y; drag.ghost.style.left = `${x + 12}px`; drag.ghost.style.top = `${y + 12}px`;
  const viewport = $('timeline').getBoundingClientRect();
  if (y >= viewport.top && y <= viewport.bottom) {
    if (x < viewport.left + 25 && x >= viewport.left) $('timeline').scrollLeft -= CELL_WIDTH;
    if (x > viewport.right - 25 && x <= viewport.right) $('timeline').scrollLeft += CELL_WIDTH;
  }
  drag.position = pointOnGrid(x, y, drag.data.duration, drag.offsetX);
  const marker = $('drop-cell'); marker.hidden = !drag.position;
  if (drag.position) { marker.style.left = `${drag.position.start / project.unit * CELL_WIDTH}px`; marker.style.top = `${drag.position.lane * ROW_HEIGHT}px`; }
}
function cancelDrag() {
  if (!drag) return;
  clearTimeout(drag.timer); drag.ghost?.remove(); document.body.classList.remove('timeline-dragging');
  if ($('drop-cell')) $('drop-cell').hidden = true;
  drag = null;
}
document.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const preset = event.target.closest('[data-preset]'), block = event.target.closest('[data-move]');
  if (!preset && !block) return;
  cancelDrag();
  const data = preset ? presets.find(p => p.id === preset.dataset.preset).data : project.events.find(e => e.id === block.dataset.move);
  drag = { pointerId: event.pointerId, preset: !!preset, data: clone(data), session: activeSessionId, offsetX: block ? event.clientX - block.getBoundingClientRect().left + 5 : 0, x: event.clientX, y: event.clientY, originX: event.clientX, originY: event.clientY, active: false };
  if (preset) drag.timer = setTimeout(startDragPreview, 350);
});
document.addEventListener('pointermove', event => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const moved = Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY);
  if (!drag.active && moved > 7) {
    if (drag.preset) { cancelDrag(); return; }
    startDragPreview();
  }
  if (drag?.active) { event.preventDefault(); updateDrag(event.clientX, event.clientY); }
}, { passive: false });
document.addEventListener('pointerup', event => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const finished = drag; const wasActive = drag.active;
  if (wasActive) updateDrag(event.clientX, event.clientY);
  cancelDrag();
  if (!wasActive) return;
  suppressedClickUntil = Date.now() + 300;
  if (!finished.position || finished.session !== activeSessionId) { message('未放到有效格子，事件未改变。'); return; }
  try {
    const candidate = clone(project);
    const data = { ...finished.data, ...finished.position, id: finished.preset ? newId() : finished.data.id };
    if (finished.preset) candidate.events.push(data); else Object.assign(candidate.events.find(e => e.id === data.id), data);
    validateProject(candidate); analyze(candidate.events, candidate.rules, candidate.profile, candidate.unit);
    selected = data.id; eventDraft = null; editingPreset = null;
    apply(candidate, finished.preset ? '预设已添加到格子，可在下方继续编辑。' : `事件已移动到 ${format(data.start)} 秒，持续时间不变。`);
  } catch (error) { message(error.message, true); }
});
document.addEventListener('pointercancel', cancelDrag);
render();
