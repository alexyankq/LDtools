import { TYPES, DEFAULT_RULES, PROFILES, clone, scenario, makeEvent, analyze, validateRules, validateProfile, validateProject } from './model.js';

const $ = id => document.getElementById(id);
const STORAGE = 'ldtools-shot-v1';
const SESSION_STORAGE = 'ldtools-shot-sessions-v1';
let project = { version: 1, events: scenario(), rules: clone(DEFAULT_RULES), profile: clone(PROFILES.balanced), unit: 5 };
let selected = project.events[0].id, baseline = null, scenarioName = 'standard', profileName = 'balanced', analysis;
let sessions = [], activeSessionId;
const sessionRuntime = new Map();
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
    localStorage.setItem(SESSION_STORAGE, JSON.stringify({ version: 1, activeSessionId, sessions }));
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
  sessionRuntime.set(activeSessionId, { selected, baseline, scenarioName, profileName });
  activeSessionId = id;
  project = clone(sessions.find(s => s.id === id).project);
  const runtime = sessionRuntime.get(id);
  selected = runtime?.selected ?? project.events[0]?.id;
  baseline = runtime?.baseline ?? null;
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
function render() {
  analysis = analyze(project.events, project.rules, project.profile, project.unit);
  $('average').textContent = analysis.summary.average.toFixed(2);
  $('minimum').textContent = analysis.summary.minimum.toFixed(2);
  $('duration').textContent = `${format(analysis.duration / 60)} 分`;
  $('event-count').textContent = `${project.events.length} 个事件 · ${analysis.samples.length} 个采样点`;
  $('diagnosis-count').textContent = analysis.diagnostics.length;
  $('delta').className = '';
  if (baseline) {
    const change = analysis.summary.average - baseline.result.summary.average;
    $('delta').textContent = `与基线相比 ${change >= 0 ? '+' : ''}${change.toFixed(2)} · 模型预测`;
    $('delta').className = change >= 0 ? 'positive' : 'negative';
  } else $('delta').textContent = '按时长加权 · 0–10';
  $('baseline-label').hidden = !baseline; $('clear-baseline').hidden = !baseline;
  $('scenario').value = scenarioName; $('profile').value = profileName; $('unit').value = project.unit;
  $('rule-name').textContent = project.rules.name;
  $('profile-info').textContent = JSON.stringify(project.profile, null, 2);
  renderChart(); renderEvents(); renderDiagnostics(); fillEditor(); save(); renderSessions();
}
function renderChart() {
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
  const duration = Math.max(1, analysis.duration);
  $('timeline').innerHTML = `<div class="timeline-scale"><span>0s</span><span>${format(duration / 2)}s</span><span>${format(duration)}s</span></div>` + ordered.map(e => `<div class="timeline-row"><span class="timeline-name" title="${esc(e.name)}">${esc(e.name)}</span><div class="timeline-track"><button class="timeline-bar ${selected === e.id ? 'selected' : ''}" data-edit="${esc(e.id)}" aria-label="编辑 ${esc(e.name)}" title="${esc(e.name)} · ${format(e.start)}s / ${format(e.duration)}s" style="left:${Math.min(99.2, e.start / duration * 100)}%;width:${Math.max(.8, e.duration / duration * 100)}%;background:${EVENT_COLORS[e.type]}"></button></div></div>`).join('');
  $('events').innerHTML = ordered.map(e => `<tr class="${e.id === selected ? 'selected-row' : ''}"><td><button class="event-name" data-edit="${esc(e.id)}">${esc(e.name)}</button></td><td>${TYPES[e.type]}</td><td>${format(e.start)}</td><td>${e.duration === 0 ? '瞬时' : format(e.duration)}</td><td><button data-edit="${esc(e.id)}">编辑</button><button data-copy="${esc(e.id)}">复制</button><button data-delete="${esc(e.id)}" aria-label="删除 ${esc(e.name)}">删除</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">还没有事件，点击「添加事件」开始。</td></tr>';
}
function renderDiagnostics() {
  $('diagnostics').innerHTML = analysis.diagnostics.map(d => `<article class="diagnostic"><h3>${DIAGNOSES[d.rule]} <span class="tag">${format(d.time)}s</span>${d.eventId ? `<button data-edit="${esc(d.eventId)}">定位事件</button>` : ''}</h3><p>事件：${esc(d.eventName)} · 规则：${esc(d.rule)}</p><p>证据：${esc(d.evidence)}</p><p>修改假设：${esc(d.suggestion)}</p></article>`).join('') || '<p class="empty">当前规则未触发诊断候选。仍需结合设计意图与试玩检查。</p>';
}
function fillEditor() {
  const e = project.events.find(e => e.id === selected);
  const form = $('event-form');
  for (const control of form.elements) control.disabled = !e;
  $('editor-title').textContent = e ? '编辑事件' : '选择或添加事件';
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
  const e = project.events.find(e => e.id === selected); if (!e) return;
  const candidate = clone(project), values = Object.fromEntries(new FormData(event.target));
  for (const k of ['start', 'duration', ...Object.keys(LABELS)]) values[k] = Number(values[k]);
  Object.assign(candidate.events.find(e => e.id === selected), values);
  try { apply(candidate, '事件已更新，分析结果已重新计算。'); } catch (e) { $('form-error').textContent = e.message; }
});
document.addEventListener('click', event => {
  const edit = event.target.closest('[data-edit]'), copy = event.target.closest('[data-copy]'), remove = event.target.closest('[data-delete]');
  if (edit) { selected = edit.dataset.edit; renderEvents(); fillEditor(); $('event-form').elements.namedItem('name').focus(); }
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
  selected = newId();
  const candidate = clone(project); candidate.events.push(makeEvent({ id: selected, start: Math.min(7140, analysis.duration) }));
  apply(candidate, '已添加事件，请在右侧填写内容。'); $('event-form').elements.namedItem('name').focus();
});
$('scenario').addEventListener('change', event => {
  // Preserve edits: downloading before replacing provides a portable recovery path.
  if (scenarioName === 'custom') download('shot-before-example.json', project);
  scenarioName = event.target.value;
  const candidate = clone(project); candidate.events = scenario(scenarioName); selected = candidate.events[0].id;
  apply(candidate, '已载入假想示例流程。自定义流程如被替换，已自动导出备份。', false);
});
$('profile').addEventListener('change', event => {
  profileName = event.target.value;
  const candidate = clone(project); candidate.profile = clone(PROFILES[profileName]); apply(candidate, '已切换玩家画像。事件数据保持不变。', false);
});
$('unit').addEventListener('change', event => {
  try { const candidate = clone(project); candidate.unit = Number(event.target.value); apply(candidate, '采样密度已更新，整体计算结果不变。', false); }
  catch (e) { event.target.value = project.unit; message(e.message, true); }
});
$('baseline').addEventListener('click', () => { baseline = { project: clone(project), result: clone(analysis) }; render(); message('已冻结当前结果作为基线。接下来编辑事件、画像或规则，查看预测差异。'); });
$('clear-baseline').addEventListener('click', () => { baseline = null; render(); message('对比基线已清除。'); });
$('legend').addEventListener('change', event => { const key = event.target.dataset.series; if (event.target.checked) visible.add(key); else visible.delete(key); renderChart(); });
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export-project').addEventListener('click', () => download('shot-project.json', project));
$('export-rules').addEventListener('click', () => download('shot-rules.json', project.rules));
$('export-profile').addEventListener('click', () => download('shot-profile.json', project.profile));
async function read(input, validate, consume) {
  const file = input.files[0]; if (!file) return;
  try { if (file.size > 2_000_000) throw Error('文件不得超过 2 MB'); const data = JSON.parse(await file.text()); validate(data); consume(data); }
  catch (e) { message(`导入失败：${e.message}`, true); }
  finally { input.value = ''; }
}
$('import-project').addEventListener('change', e => read(e.target, validateProject, data => {
  // Validate execution before changing selection/configuration.
  analyze(data.events, data.rules, data.profile, data.unit);
  selected = data.events[0]?.id; profileName = 'custom'; apply(data, '项目已导入，分析完成。');
}));
$('import-rules').addEventListener('change', e => read(e.target, validateRules, rules => { const candidate = clone(project); candidate.rules = rules; apply(candidate, '规则包已导入，分析结果已更新。', false); }));
$('import-profile').addEventListener('change', e => read(e.target, validateProfile, profile => { const candidate = clone(project); candidate.profile = profile; apply(candidate, '玩家画像已导入。', false); profileName = 'custom'; $('profile').value = profileName; }));
$('default-rules').addEventListener('click', () => { const candidate = clone(project); candidate.rules = clone(DEFAULT_RULES); apply(candidate, '已恢复默认实验规则。', false); });
render();
