import { TYPES, DEFAULT_RULES, PROFILES, clone, scenario, makeEvent, analyze, validateEvents, validateRules, validateProfile, validateProject } from './model.js';
import { CELL_WIDTH, ROW_HEIGHT, RULER_HEIGHT, gridGeometry, positionAt } from './timeline.js';

const $ = id => document.getElementById(id);
const STORAGE = 'ldtools-shot-v1';
const SESSION_STORAGE = 'ldtools-shot-sessions-v1';
let project = { version: 1, events: scenario(), rules: clone(DEFAULT_RULES), profile: clone(PROFILES.balanced), unit: 5 };
let selected = project.events[0].id, profileName = 'balanced', analysis = null, analyzedProject = null;
let sessions = [], activeSessionId;
let groups = [], showArchived = false, managementTarget = null;
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
    if (![1, 2].includes(restored.version) || !Array.isArray(restored.sessions) || !restored.sessions.length) throw Error('无效会话数据');
    const ids = new Set();
    for (const session of restored.sessions) {
      if (typeof session.id !== 'string' || ids.has(session.id) || typeof session.title !== 'string' || session.title.length > 80) throw Error('无效会话信息');
      ids.add(session.id);
      if (!session.plans) {
        validateProject(session.project);
        session.plans = [{ id: crypto.randomUUID(), name: '方案 1', project: session.project }];
        session.activePlanId = session.plans[0].id;
        session.comparisonIds = [session.activePlanId];
      }
      if (!Array.isArray(session.plans) || !session.plans.length || session.plans.length > 30) throw Error('无效方案列表');
      const planIds = new Set();
      for (const plan of session.plans) {
        if (typeof plan.id !== 'string' || planIds.has(plan.id) || typeof plan.name !== 'string' || plan.name.length > 80) throw Error('无效方案');
        planIds.add(plan.id); validateProject(plan.project);
        analyze(plan.project.events, plan.project.rules, plan.project.profile, plan.project.unit);
        if (plan.analyzedProject) {
          const snapshot = validateProject(JSON.parse(plan.analyzedProject));
          sessionRuntime.set(plan.id, { analysis: analyze(snapshot.events, snapshot.rules, snapshot.profile, snapshot.unit), analyzedProject: plan.analyzedProject });
        }
      }
      if (!planIds.has(session.activePlanId)) session.activePlanId = session.plans[0].id;
      session.comparisonIds = (session.comparisonIds || [session.activePlanId]).filter(id => planIds.has(id));
      session.project = session.plans.find(p => p.id === session.activePlanId).project;
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
    if (restored.groups !== undefined) {
      if (!Array.isArray(restored.groups) || restored.groups.length > 100) throw Error('无效项目列表');
      const groupIds = new Set();
      for (const group of restored.groups) {
        if (typeof group.id !== 'string' || groupIds.has(group.id) || typeof group.name !== 'string' || group.name.length > 80) throw Error('无效项目');
        groupIds.add(group.id);
      }
      groups = restored.groups;
    }
    sessions = restored.sessions;
    for (const session of sessions) {
      session.pinned = session.pinned === true; session.archived = session.archived === true;
      if (!groups.some(g => g.id === session.groupId)) session.groupId = null;
    }
    activeSessionId = ids.has(restored.activeSessionId) ? restored.activeSessionId : sessions[0].id;
    project = clone(sessions.find(s => s.id === activeSessionId).project);
    selected = project.events[0]?.id; profileName = 'custom';
  } else if (saved) {
    const restored = clone(validateProject(JSON.parse(saved)));
    analyze(restored.events, restored.rules, restored.profile, restored.unit);
    project = restored; selected = project.events[0]?.id; profileName = 'custom';
  }
} catch { message('本地保存的数据无法读取，已使用示例。你可以导入项目 JSON 恢复。', true); }
if (!sessions.length) {
  activeSessionId = crypto.randomUUID();
  sessions = [{ id: activeSessionId, title: '我的第一次分析', project: clone(project) }];
}

for (const session of sessions) {
  if (!session.plans) {
    session.plans = [{ id: crypto.randomUUID(), name: '方案 1', project: clone(session.project) }];
    session.activePlanId = session.plans[0].id; session.comparisonIds = [session.activePlanId];
  }
}
function currentSession() { return sessions.find(s => s.id === activeSessionId); }
function currentPlan() { return currentSession().plans.find(p => p.id === currentSession().activePlanId); }
function storeRuntime() {
  currentPlan().project = clone(project);
  currentPlan().analyzedProject = analyzedProject;
  sessionRuntime.set(currentPlan().id, { selected, profileName, analysis, analyzedProject });
}
function loadPlan() {
  project = clone(currentPlan().project);
  const runtime = sessionRuntime.get(currentPlan().id);
  selected = runtime?.selected ?? project.events[0]?.id;
  analysis = runtime?.analysis ?? null; analyzedProject = runtime?.analyzedProject ?? null;
  profileName = runtime?.profileName ?? 'custom';
  eventDraft = null; editingPreset = null; hideContextMenu();
}
loadPlan();

$('event-type').innerHTML = Object.entries(TYPES).map(([key, name]) => `<option value="${key}">${name}</option>`).join('');
$('attributes').innerHTML = Object.entries(LABELS).map(([key, label]) => `<label>${label}<input name="${key}" type="number" min="0" max="10" step="any" required></label>`).join('');
$('legend').innerHTML = Object.entries(SERIES).map(([key, label]) => `<label><input type="checkbox" data-series="${key}" checked><i style="background:${COLORS[key]}"></i>${label}</label>`).join('');

function save() {
  storeRuntime();
  currentSession().project = clone(project);
  try {
    localStorage.setItem(SESSION_STORAGE, JSON.stringify({ version: 2, activeSessionId, sessions, groups, ruleLibrary, profileLibrary, presets }));
    $('storage-status').textContent = '分析会话自动保存在此浏览器';
  } catch { $('storage-status').textContent = '浏览器保存不可用，请分别导出分析保留修改'; }
}
function renderSessions() {
  $('session-title').value = sessions.find(s => s.id === activeSessionId).title;
  document.title = `${$('session-title').value} · shot`;
  $('archive-toggle').textContent = showArchived ? '返回会话列表' : `归档会话（${sessions.filter(s => s.archived).length}）`;
  $('archive-toggle').setAttribute('aria-pressed', String(showArchived));
  const list = $('session-list');
  const shown = sessions.filter(s => !!s.archived === showArchived);
  const pinned = shown.filter(s => s.pinned), normal = shown.filter(s => !s.pinned);
  const signature = JSON.stringify({ showArchived, groups, rows: shown.map(s => [s.id, s.pinned, s.groupId]) });
  // Preserve buttons during configuration edits and title blur before a click.
  if (list.dataset.signature !== signature) {
    const rows = entries => entries.map(s => `<div class="session-row"><button class="session-item" data-session="${esc(s.id)}"><span class="session-icon" aria-hidden="true">${s.pinned ? '⌖' : '◷'}</span><span class="session-name"></span><span class="session-count"></span></button><button class="session-more" data-session-menu="${esc(s.id)}" aria-label="会话菜单">⋯</button></div>`).join('');
    let content = pinned.length ? `<p class="sidebar-section-title">置顶</p>${rows(pinned)}` : '';
    if (!showArchived) for (const group of groups) {
      const entries = normal.filter(s => s.groupId === group.id);
      content += `<section class="sidebar-project"><div class="project-heading"><button data-group-toggle="${esc(group.id)}" aria-expanded="${!group.collapsed}">${group.collapsed ? '▸' : '▾'} ▣ ${esc(group.name)}</button><button data-new-in-project="${esc(group.id)}" aria-label="在 ${esc(group.name)} 中新建会话">＋</button><button data-group-menu="${esc(group.id)}" aria-label="项目菜单">⋯</button></div>${group.collapsed ? '' : rows(entries) || '<p class="sidebar-empty">暂无会话</p>'}</section>`;
    }
    const ungrouped = showArchived ? normal : normal.filter(s => !s.groupId);
    content += `<p class="sidebar-section-title">${showArchived ? '归档会话' : '会话'}</p>${rows(ungrouped) || '<p class="sidebar-empty">暂无会话</p>'}`;
    list.innerHTML = content; list.dataset.signature = signature;
  }
  for (const button of list.querySelectorAll('[data-session]')) {
    const session = sessions.find(s => s.id === button.dataset.session), active = session.id === activeSessionId;
    button.classList.toggle('active', active); button.title = session.title;
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    button.querySelector('.session-name').textContent = session.title;
    button.querySelector('.session-count').textContent = session.plans.length + '方案';
    button.nextElementSibling.setAttribute('aria-label', `${session.title} 的菜单`);
  }
}
function activateSession(id) {
  if (id === activeSessionId) return;
  save();
  activeSessionId = id;
  loadPlan();
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
function createSession(groupId = null, focus = true) {
  const session = { id: crypto.randomUUID(), title: `新分析 ${sessions.length + 1}`, groupId, project: { version: 1, events: [], rules: clone(DEFAULT_RULES), profile: clone(PROFILES.balanced), unit: 5 } };
  session.plans = [{ id: crypto.randomUUID(), name: '方案 1', project: clone(session.project) }];
  session.activePlanId = session.plans[0].id; session.comparisonIds = [session.activePlanId];
  showArchived = false;
  const group = groups.find(g => g.id === groupId); if (group) group.collapsed = false;
  sessions.unshift(session); activateSession(session.id);
  if (focus) {
    if (window.matchMedia('(max-width: 760px)').matches) setSidebar(false);
    $('session-title').focus(); $('session-title').select();
  }
  message('已新建独立分析。可以先命名，再添加事件。');
}
$('new-session').addEventListener('click', () => createSession());
$('archive-toggle').addEventListener('click', () => { showArchived = !showArchived; renderSessions(); });
function openManager(kind, id = null) {
  managementTarget = { kind, id };
  const item = kind === 'session' ? sessions.find(s => s.id === id) : groups.find(g => g.id === id);
  $('manager-title').textContent = item ? (kind === 'session' ? item.title : item.name) : '新建项目';
  $('manager-actions').hidden = !item;
  $('manager-fields').hidden = !!item;
  $('manager-name').value = item ? (kind === 'session' ? item.title : item.name) : '';
  $('manager-name-label').hidden = false; $('manager-group-label').hidden = true;
  $('manager-save').dataset.mode = item ? 'rename' : 'create';
  $('manager-pin').hidden = kind !== 'session'; $('manager-archive').hidden = kind !== 'session'; $('manager-move').hidden = kind !== 'session';
  if (kind === 'session') { $('manager-pin').textContent = item.pinned ? '取消置顶' : '置顶'; $('manager-archive').textContent = item.archived ? '取消归档' : '归档'; }
  $('manager-delete').textContent = kind === 'session' ? '删除会话' : '删除项目分组';
  $('session-manager').showModal();
  if (!item) $('manager-name').focus();
}
$('new-group').addEventListener('click', () => openManager('group'));
$('close-session-manager').addEventListener('click', () => $('session-manager').close());
$('session-list').addEventListener('click', event => {
  const sessionMenu = event.target.closest('[data-session-menu]'), groupMenu = event.target.closest('[data-group-menu]');
  const toggle = event.target.closest('[data-group-toggle]'), create = event.target.closest('[data-new-in-project]');
  if (sessionMenu) openManager('session', sessionMenu.dataset.sessionMenu);
  if (groupMenu) openManager('group', groupMenu.dataset.groupMenu);
  if (toggle) { const group = groups.find(g => g.id === toggle.dataset.groupToggle); group.collapsed = !group.collapsed; save(); renderSessions(); }
  if (create) createSession(create.dataset.newInProject);
});
$('manager-rename').addEventListener('click', () => {
  $('manager-fields').hidden = false; $('manager-actions').hidden = true; $('manager-save').dataset.mode = 'rename';
  $('manager-name').focus(); $('manager-name').select();
});
$('manager-move').addEventListener('click', () => {
  $('manager-fields').hidden = false; $('manager-actions').hidden = true; $('manager-name-label').hidden = true; $('manager-group-label').hidden = false;
  $('manager-group').innerHTML = '<option value="">不属于项目</option>' + groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
  $('manager-group').value = sessions.find(s => s.id === managementTarget.id).groupId || '';
  $('manager-save').dataset.mode = 'move'; $('manager-group').focus();
});
$('manager-fields').addEventListener('submit', event => {
  event.preventDefault();
  const { kind, id } = managementTarget, mode = $('manager-save').dataset.mode;
  const name = $('manager-name').value.trim();
  if (mode !== 'move' && !name) { $('manager-name').focus(); return; }
  if (mode === 'create') {
    if (groups.length >= 100) { message('最多支持 100 个项目。', true); return; }
    groups.push({ id: crypto.randomUUID(), name });
  } else {
    const item = kind === 'session' ? sessions.find(s => s.id === id) : groups.find(g => g.id === id);
    if (mode === 'move') { item.groupId = $('manager-group').value || null; const group = groups.find(g => g.id === item.groupId); if (group) group.collapsed = false; }
    else item[kind === 'session' ? 'title' : 'name'] = name;
  }
  $('session-manager').close(); save(); renderSessions(); message('已保存。');
});
function chooseAvailableSession() {
  const next = sessions.find(s => !s.archived);
  if (next) { activeSessionId = next.id; loadPlan(); render(); }
  else {
    // Avoid saving a deleted active session; create a blank replacement first.
    const data = { version: 1, events: [], rules: clone(DEFAULT_RULES), profile: clone(PROFILES.balanced), unit: 5 };
    const plan = { id: crypto.randomUUID(), name: '方案 1', project: data };
    const session = { id: crypto.randomUUID(), title: '新分析', project: data, plans: [plan], activePlanId: plan.id, comparisonIds: [plan.id] };
    sessions.unshift(session); activeSessionId = session.id; loadPlan(); render();
  }
}
$('manager-pin').addEventListener('click', () => {
  const item = sessions.find(s => s.id === managementTarget.id); item.pinned = !item.pinned;
  $('session-manager').close(); save(); renderSessions();
});
$('manager-archive').addEventListener('click', () => {
  save(); const item = sessions.find(s => s.id === managementTarget.id); item.archived = !item.archived;
  $('session-manager').close(); cancelDrag();
  if (item.archived && item.id === activeSessionId) chooseAvailableSession();
  else { save(); renderSessions(); }
  message(item.archived ? '会话已归档，可在归档列表恢复。' : '会话已取消归档。');
});
$('manager-delete').addEventListener('click', () => {
  const { kind, id } = managementTarget;
  if (!window.confirm(kind === 'session' ? '删除此会话及其中全部方案？此操作无法撤销。' : '删除此项目分组？其中的会话会保留并移出项目。')) return;
  save(); $('session-manager').close(); cancelDrag();
  if (kind === 'group') { groups = groups.filter(g => g.id !== id); for (const session of sessions) if (session.groupId === id) session.groupId = null; save(); renderSessions(); }
  else {
    const removed = sessions.find(s => s.id === id); for (const plan of removed.plans) sessionRuntime.delete(plan.id);
    sessions = sessions.filter(s => s.id !== id);
    if (id === activeSessionId) chooseAvailableSession(); else { save(); renderSessions(); }
  }
  message(kind === 'session' ? '会话已删除。' : '项目分组已删除，会话已保留。');
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
  if (button) { button.querySelector('.session-name').textContent = title; button.title = title; }
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
  const scroll = { x: window.scrollX, y: window.scrollY, config: $('floating-config').scrollTop };
  $('average').textContent = analysis ? analysis.summary.average.toFixed(2) : '—';
  $('minimum').textContent = analysis ? analysis.summary.minimum.toFixed(2) : '—';
  $('duration').textContent = `${format(projectDuration() / 60)} 分`;
  $('event-count').textContent = `${project.events.length} 个事件${analysis ? ` · 上次分析 ${analysis.samples.length} 个采样点` : ''}`;
  $('diagnosis-count').textContent = analysis ? analysis.diagnostics.length : '—';
  $('analysis-state').textContent = !analysis ? '配置会话并准备事件后，点击「开始分析」。' : dirty() ? '会话内容已变更；下方仍是上次结果，点击「开始分析」更新。' : '分析已完成，结果对应当前会话配置。';
  $('delta').textContent = '按时长加权 · 0–10';
  $('delta').className = '';
  storeRuntime(); renderPlans();
  const ruleId = register(ruleLibrary, project.rules), profileId = register(profileLibrary, project.profile);
  for (const [id, library, value] of [['rules', ruleLibrary, ruleId], ['profile', profileLibrary, profileId]]) {
    $(id).innerHTML = library.map(e => `<option value="${esc(e.id)}">${esc(e.data.name)}</option>`).join(''); $(id).value = value;
  }
  $('unit').value = project.unit;
  $('timeline-span').value = gridGeometry(project).span;
  renderChart(); renderEvents(); renderDiagnostics(); fillEditor(); renderPresets(); save(); renderSessions();
  // Replacing result sections can trigger browser scroll anchoring. Preserve the
  // current viewport both synchronously and after the next layout pass.
  window.scrollTo(scroll.x, scroll.y); $('floating-config').scrollTop = scroll.config;
  requestAnimationFrame(() => { window.scrollTo(scroll.x, scroll.y); });
}
const PLAN_DASHES = ['', '8 5', '2 4', '12 4 2 4', '4 3'];
function renderPlans() {
  const session = currentSession();
  $('plan-select').innerHTML = session.plans.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  $('plan-select').value = session.activePlanId; $('plan-name').value = currentPlan().name;
  $('plan-comparison').innerHTML = session.plans.map((p, index) => {
    const runtime = sessionRuntime.get(p.id), result = runtime?.analysis;
    const stale = result && JSON.stringify(p.project) !== runtime.analyzedProject;
    return `<label class="plan-choice"><input type="checkbox" data-compare-plan="${esc(p.id)}" ${session.comparisonIds.includes(p.id) ? 'checked' : ''}><svg width="32" height="12" aria-hidden="true"><line x1="0" x2="32" y1="6" y2="6" stroke="currentColor" stroke-width="2" stroke-dasharray="${PLAN_DASHES[index % PLAN_DASHES.length]}"/></svg><span>${esc(p.name)}${p.id === session.activePlanId ? '（当前）' : ''} · ${result ? `平均 ${result.summary.average.toFixed(2)}${stale ? ' · 待重新分析' : ''}` : '未分析'}</span></label>`;
  }).join('');
}
function activatePlan(id) {
  if (id === currentSession().activePlanId) return;
  save(); cancelDrag(); currentSession().activePlanId = id; loadPlan(); render(); message('已切换方案。');
}
function createPlan(copy) {
  if (currentSession().plans.length >= 30) { message('每个会话最多支持 30 个方案。', true); return; }
  save();
  const data = clone(project);
  if (!copy) { data.events = []; delete data.timelineLength; }
  const plan = { id: crypto.randomUUID(), name: copy ? currentPlan().name.slice(0, 70) + ' 副本' : `方案 ${currentSession().plans.length + 1}`, project: data };
  currentSession().plans.push(plan); currentSession().comparisonIds.push(plan.id); activatePlan(plan.id);
  message(copy ? '已复制当前方案，修改与分析结果相互独立。' : '已新建空白方案，沿用当前规则、用户类型和精度。');
}
$('plan-select').addEventListener('change', event => activatePlan(event.target.value));
$('new-plan').addEventListener('click', () => createPlan(false));
$('copy-plan').addEventListener('click', () => createPlan(true));
$('plan-name').addEventListener('change', event => { currentPlan().name = event.target.value.trim() || '未命名方案'; save(); renderPlans(); renderChart(); });
$('plan-comparison').addEventListener('change', event => {
  const id = event.target.dataset.comparePlan; if (!id) return;
  const session = currentSession();
  session.comparisonIds = event.target.checked ? [...new Set([...session.comparisonIds, id])] : session.comparisonIds.filter(value => value !== id);
  save(); renderChart();
});
function renderChart() {
  const compared = currentSession().plans.filter(p => currentSession().comparisonIds.includes(p.id)).map(p => ({ plan: p, runtime: sessionRuntime.get(p.id) })).filter(p => p.runtime?.analysis);
  if (!compared.length) { $('chart').innerHTML = '<p class="empty">勾选已分析的方案显示曲线；点击「开始分析」更新所有方案，或勾选「仅分析当前方案」后单独分析。</p>'; return; }
  const width = 880, height = 285, left = 40, top = 15, bottom = 245, right = 860;
  const duration = Math.max(1, ...compared.map(p => p.runtime.analysis.duration));
  const x = t => left + t / duration * (right - left), y = v => bottom - v / 10 * (bottom - top);
  let svg = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="体验曲线。详细数值见上方摘要，诊断见下方列表。">`;
  for (let v = 0; v <= 10; v += 2) svg += `<line class="grid" x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}"/><text x="25" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  for (let i = 0; i <= 6; i++) svg += `<text x="${x(i * duration / 6)}" y="270" text-anchor="middle">${format(i * duration / 6)}s</text>`;
  for (const { plan, runtime } of compared) for (const key of visible) {
    const index = currentSession().plans.indexOf(plan);
    const points = runtime.analysis.samples.map(s => `${x(s.time).toFixed(2)},${y(s[key]).toFixed(2)}`).join(' ');
    svg += `<polyline data-plan="${esc(plan.id)}" points="${points}" fill="none" stroke="${COLORS[key]}" stroke-width="2.5" stroke-dasharray="${PLAN_DASHES[index % PLAN_DASHES.length]}" stroke-linejoin="round"><title>${esc(plan.name)} · ${SERIES[key]}</title></polyline>`;
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
$('legend').addEventListener('change', event => { const key = event.target.dataset.series; if (event.target.checked) visible.add(key); else visible.delete(key); renderChart(); });
$('run-analysis').addEventListener('click', () => {
  try {
    storeRuntime();
    const onlyCurrent = $('analyze-current-only').checked;
    const targets = onlyCurrent ? [currentPlan()] : currentSession().plans;
    // Compute every requested result before publishing any, so a failure cannot
    // leave a comparison partially updated. Reuse unchanged snapshots.
    const results = targets.map(plan => {
      const snapshot = JSON.stringify(plan.project), runtime = sessionRuntime.get(plan.id);
      return { plan, snapshot, result: runtime?.analysis && runtime.analyzedProject === snapshot ? runtime.analysis : analyze(plan.project.events, plan.project.rules, plan.project.profile, plan.project.unit) };
    });
    for (const { plan, snapshot, result } of results) {
      sessionRuntime.set(plan.id, { ...sessionRuntime.get(plan.id), analysis: result, analyzedProject: snapshot });
      plan.analyzedProject = snapshot;
    }
    analysis = sessionRuntime.get(currentPlan().id).analysis;
    analyzedProject = sessionRuntime.get(currentPlan().id).analyzedProject;
    render(); message(onlyCurrent ? '当前方案分析完成。' : `当前会话全部 ${targets.length} 个方案分析完成。`);
  }
  catch (error) { message(error.message, true); }
});
function setConfigOpen(open) {
  document.body.classList.toggle('config-collapsed', !open);
  $('floating-config').inert = !open;
  $('config-toggle').setAttribute('aria-expanded', String(open));
  $('config-toggle').textContent = open ? '隐藏配置' : '会话配置';
}
$('config-toggle').addEventListener('click', () => setConfigOpen($('config-toggle').getAttribute('aria-expanded') !== 'true'));
const narrowConfig = window.matchMedia('(max-width: 760px)');
narrowConfig.addEventListener('change', event => setConfigOpen(!event.matches));
setConfigOpen(!narrowConfig.matches);
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
document.addEventListener('keydown', event => { if (event.key === 'Escape') { hideContextMenu(); } });
window.addEventListener('blur', () => { hideContextMenu(); });
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
