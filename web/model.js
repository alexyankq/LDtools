// Experimental model: declarative rules, fixed one-second integration.
export const TYPES = { tutorial: '机制教学', challenge: '挑战 / 解谜', explore: '探索', story: '剧情', goal: '目标更新', reward: '奖励', failure: '失败', rest: '休整' };
export const STATES = ['anticipation', 'stress', 'fatigue', 'competence', 'frustration', 'boredom'];
export const clone = x => JSON.parse(JSON.stringify(x));
const clip = (x, max = 10) => Math.max(0, Math.min(max, x));
const effect = (state, mode, coefficient, attribute, extra = {}) => ({ state, mode, coefficient, ...(attribute ? { attribute } : {}), ...extra });
export const DEFAULT_RULES = {
  version: 1, name: '综合体验 · 实验规则 v1',
  decay: { anticipation: 0.001, stress: 0.025, fatigue: 0.0004, competence: 0, frustration: 0.003, boredom: 0.003 },
  weights: { base: 4, anticipation: 0.28, competence: 0.22, stress: 0.08, fatigue: -0.28, frustration: -0.32, boredom: -0.4 },
  thresholds: { knowledge: 0.5, repetition: 3, fatigue: 6, mismatch: 3, boredom: 4, rewardGap: 120 },
  mappings: {
    tutorial: [effect('anticipation', 'instant', 0.22, 'novelty'), effect('competence', 'accumulate', 0.003, 'feedback')],
    challenge: [effect('stress', 'sustain', 1, 'intensity'), effect('fatigue', 'accumulate', 0.003, 'intensity'), effect('competence', 'accumulate', 0.002, 'feedback')],
    explore: [effect('anticipation', 'instant', 0.25, 'novelty'), effect('fatigue', 'accumulate', 0.001, 'intensity')],
    story: [effect('anticipation', 'sustain', 0.7, 'novelty'), effect('competence', 'delayed', 0.08, 'feedback', { delay: 10 })],
    goal: [effect('anticipation', 'instant', 0.4, 'value')],
    reward: [effect('competence', 'instant', 0.16, 'value'), effect('anticipation', 'instant', 0.16, 'value'), effect('frustration', 'instant', -0.2, 'value')],
    failure: [effect('frustration', 'instant', 0.45, 'cost'), effect('competence', 'instant', 0.12, 'feedback')],
    rest: [effect('fatigue', 'recover', 0.008), effect('stress', 'recover', 0.05), effect('frustration', 'recover', 0.01)]
  },
  dynamics: { knowledgeRate: 0.008, knowledgePenalty: 0.01, mismatchPenalty: 0.005, repetitionFatigue: 0.003, idleGrace: 45, boredomRate: 0.018, activeBoredomRecovery: 0.025 }
};
export const PROFILES = {
  balanced: { name: '综合型玩家', skill: 5, fatigueSensitivity: 1, frustrationSensitivity: 1, noveltyPreference: 1, learningRate: 1 },
  casual: { name: '休闲型玩家', skill: 3, fatigueSensitivity: 1.3, frustrationSensitivity: 1.4, noveltyPreference: 1, learningRate: 0.8 },
  expert: { name: '挑战型玩家', skill: 8, fatigueSensitivity: 0.8, frustrationSensitivity: 0.7, noveltyPreference: 0.8, learningRate: 1.2 }
};
export function makeEvent(extra = {}) {
  return { id: 'event', name: '新事件', type: 'challenge', start: 0, duration: 60, intensity: 5, difficulty: 5, novelty: 5, feedback: 7, value: 5, cost: 3, mechanic: '', requires: '', ...extra };
}
export function scenario(kind = 'standard') {
  const definitions = [
    { name: '传送门机制引入', type: 'tutorial', duration: 120, intensity: 2, novelty: 9, mechanic: 'portal' },
    { name: '首次应用', duration: 180, intensity: 4, difficulty: 4, novelty: 7, requires: 'portal' },
    { name: '组合解谜', duration: 240, intensity: 6, difficulty: 6, novelty: 5, requires: 'portal' },
    { name: '复杂解谜', duration: 240, intensity: 8, difficulty: 7, novelty: 3, requires: 'portal' },
    { name: '场景过渡与休整', type: 'rest', duration: 120, intensity: 1, novelty: 4 },
    { name: '新一轮挑战', duration: 180, intensity: 6, difficulty: 6, novelty: 8, requires: 'portal' },
    { name: '完成实验奖励', type: 'reward', duration: 0, value: 8 }
  ];
  if (kind === 'repetition') definitions[4] = { name: '重复组合解谜', duration: 120, intensity: 8, difficulty: 7, novelty: 1, requires: 'portal' };
  if (kind === 'wrong-order') [definitions[0], definitions[3]] = [definitions[3], definitions[0]];
  let start = 0;
  return definitions.map((e, i) => { const result = makeEvent({ id: `event-${i + 1}`, start, ...e }); start += e.duration; return result; });
}
const object = (x, label) => { if (!x || typeof x !== 'object' || Array.isArray(x)) throw Error(`${label}必须是对象`); };
const number = (x, min, max, label) => { if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) throw Error(`${label}必须是 ${min}–${max} 的数字`); };
const text = (x, label, required = false) => { if (typeof x !== 'string' || x.length > 200 || (required && !x.trim())) throw Error(`${label}必须是${required ? '非空' : ''}字符串（最多 200 字）`); };
export function validateProfile(profile) {
  object(profile, '玩家画像'); text(profile.name, '画像名称', true); number(profile.skill, 0, 10, '玩家能力');
  for (const key of ['fatigueSensitivity', 'frustrationSensitivity', 'noveltyPreference', 'learningRate']) number(profile[key], 0.1, 3, key);
  return profile;
}
export function validateEvents(events) {
  if (!Array.isArray(events) || events.length > 300) throw Error('事件必须是数组，最多 300 个');
  const ids = new Set();
  for (const e of events) {
    object(e, '事件'); text(e.id, '事件 ID', true); text(e.name, '事件名称', true);
    if (ids.has(e.id)) throw Error('事件 ID 不能重复'); ids.add(e.id);
    if (!Object.hasOwn(TYPES, e.type)) throw Error('未知事件类型');
    number(e.start, 0, 7200, '开始时间'); number(e.duration, 0, 7200, '持续时间');
    if (e.start + e.duration > 7200) throw Error('原型支持最长 7200 秒的时间轴');
    for (const k of ['intensity', 'difficulty', 'novelty', 'feedback', 'value', 'cost']) number(e[k], 0, 10, k);
    text(e.mechanic, '教学机制'); text(e.requires, '前置机制');
  }
  return events;
}
export function validateRules(rules) {
  object(rules, '规则'); if (rules.version !== 1) throw Error('只支持 version: 1 的规则包'); text(rules.name, '规则名称', true);
  for (const k of ['decay', 'weights', 'thresholds', 'mappings', 'dynamics']) object(rules[k], k);
  for (const key of STATES) number(rules.decay[key], 0, 1, `decay.${key}`);
  for (const key of ['base', ...STATES]) number(rules.weights[key], -10, 10, `weights.${key}`);
  for (const [k, min, max] of [['knowledge', 0, 1], ['repetition', 1, 300], ['fatigue', 0, 10], ['mismatch', 0, 10], ['boredom', 0, 10], ['rewardGap', 0, 7200]]) number(rules.thresholds[k], min, max, k);
  for (const key of Object.keys(DEFAULT_RULES.dynamics)) number(rules.dynamics[key], 0, key === 'idleGrace' ? 7200 : 1, `dynamics.${key}`);
  for (const type of Object.keys(TYPES)) {
    const effects = rules.mappings[type];
    if (!Array.isArray(effects) || effects.length > 30) throw Error(`${type} 的映射必须是数组，最多 30 项`);
    for (const fx of effects) {
      object(fx, '影响函数');
      if (!STATES.includes(fx.state)) throw Error('未知状态');
      if (!['instant', 'sustain', 'accumulate', 'delayed', 'recover'].includes(fx.mode)) throw Error('未知时间影响函数');
      number(fx.coefficient, -10, 10, '影响系数');
      if (fx.mode === 'recover' && fx.coefficient < 0) throw Error('恢复系数不能为负');
      if (fx.attribute !== undefined && !['intensity', 'difficulty', 'novelty', 'feedback', 'value', 'cost'].includes(fx.attribute)) throw Error('未知事件属性');
      if (fx.mode === 'delayed') number(fx.delay, 0, 7200, '延迟秒数');
    }
  }
  return rules;
}
export function validateProject(p) {
  object(p, '项目'); if (p.version !== 1) throw Error('只支持 version: 1 的项目');
  validateEvents(p.events); validateRules(p.rules); validateProfile(p.profile); number(p.unit, 1, 300, '分析时元');
  return p;
}
export function analyze(events, rules = DEFAULT_RULES, profile = PROFILES.balanced, unit = 5) {
  validateProject({ version: 1, events, rules, profile, unit });
  const ordered = events.map((e, i) => ({ ...e, order: i })).sort((a, b) => a.start - b.start || a.order - b.order);
  const delayedEnd = Math.max(0, ...ordered.flatMap(e => rules.mappings[e.type].filter(f => f.mode === 'delayed').map(f => e.start + f.delay)));
  const duration = Math.max(0, delayedEnd, ...ordered.map(e => e.start + e.duration));
  if (duration > 7200) throw Error('含延迟影响的时间轴不能超过 7200 秒');
  const state = { anticipation: 5, stress: 0, fatigue: 0, competence: profile.skill, frustration: 0, boredom: 0 };
  const knowledge = Object.create(null), diagnostics = [], fired = new Set(), counts = new Map(), samples = [], all = [];
  let idle = 0, sinceReward = 0, investment = 0;
  const report = (rule, event, t, evidence, suggestion) => {
    const key = `${rule}/${event?.id || ''}`;
    if (fired.has(key)) return; fired.add(key);
    diagnostics.push({ rule, eventId: event?.id || null, eventName: event?.name || '空窗期', time: t, evidence, suggestion });
  };
  const result = t => {
    const engagement = clip(rules.weights.base + STATES.reduce((sum, k) => sum + state[k] * rules.weights[k] * (k === 'fatigue' ? profile.fatigueSensitivity : k === 'frustration' ? profile.frustrationSensitivity : k === 'anticipation' ? profile.noveltyPreference : 1), 0));
    return { time: t, ...state, knowledge: { ...knowledge }, engagement, arousal: clip(state.stress * 0.75 + state.anticipation * 0.25), valence: clip(5 + state.competence * 0.25 + state.anticipation * 0.2 - state.frustration * 0.5 - state.boredom * 0.3) };
  };
  // Split at event/delay boundaries to preserve fractional timestamps. Output sampling
  // never controls state evolution; partial final intervals are weighted exactly.
  const boundaries = new Set([0, duration]);
  for (let t = 1; t < duration; t++) boundaries.add(t);
  for (const e of ordered) {
    boundaries.add(e.start); boundaries.add(e.start + e.duration);
    for (const fx of rules.mappings[e.type]) if (fx.mode === 'delayed') boundaries.add(e.start + fx.delay);
  }
  const times = [...boundaries].sort((a, b) => a - b);
  let area = 0, minimum = Infinity;
  for (let index = 0; index < times.length; index++) {
    const t = times[index], dt = (times[index + 1] ?? t) - t;
    for (const e of ordered.filter(e => e.start === t)) {
      if (e.requires && (knowledge[e.requires] || 0) < rules.thresholds.knowledge) report('knowledge-gap', e, t, `机制 ${e.requires} 知识 ${(knowledge[e.requires] || 0).toFixed(2)} < ${rules.thresholds.knowledge}`, '提前安排机制教学或无压力练习，再通过试玩验证。');
      if (e.type === 'challenge') {
        const key = e.requires || 'general'; counts.set(key, (counts.get(key) || 0) + 1);
        if (counts.get(key) >= rules.thresholds.repetition && e.novelty <= 3) report('repetition', e, t, `同机制挑战累计 ${counts.get(key)} 次，新颖度 ${e.novelty} ≤ 3`, '替换重复机制、增加目标变化，或插入休整进行对比。');
        const gap = e.difficulty - state.competence;
        if (gap > rules.thresholds.mismatch) report('challenge-mismatch', e, t, `难度 ${e.difficulty} 与能力感 ${state.competence.toFixed(1)} 相差 ${gap.toFixed(1)}`, '调整挑战或加强教学；结合目标玩家和设计意图检查。');
      }
      if (e.type === 'reward') {
        if (investment > 0 && sinceReward > rules.thresholds.rewardGap && e.value < 4) report('reward-gap', e, t, `连续投入 ${sinceReward.toFixed(0)} 秒后奖励价值 ${e.value} < 4`, '检查奖励价值、反馈与发放时机，比较调整后的流程。');
        investment = 0; sinceReward = 0;
      }
    }
    for (const e of ordered) for (const fx of rules.mappings[e.type]) {
      const at = e.start + (fx.mode === 'delayed' ? fx.delay : 0);
      if (['instant', 'delayed'].includes(fx.mode) && t === at) {
        let amount = fx.coefficient * (fx.attribute ? e[fx.attribute] : 1);
        if (e.type === 'failure' && fx.state === 'frustration') amount *= 1 - e.feedback / 15;
        state[fx.state] = clip(state[fx.state] + amount);
      }
    }
    const active = ordered.filter(e => e.start <= t && t < e.start + e.duration);
    all.push(result(t)); minimum = Math.min(minimum, all.at(-1).engagement);
    if (!dt) break;
    for (const key of STATES) state[key] *= Math.exp(-rules.decay[key] * dt);
    const sustained = Object.create(null);
    for (const e of active) {
      for (const fx of rules.mappings[e.type]) {
        const amount = fx.coefficient * (fx.attribute ? e[fx.attribute] : 1);
        if (fx.mode === 'sustain') sustained[fx.state] = (sustained[fx.state] || 0) + amount;
        if (fx.mode === 'accumulate') state[fx.state] += amount * dt;
        if (fx.mode === 'recover') state[fx.state] *= Math.exp(-amount * dt);
      }
      if (e.mechanic) knowledge[e.mechanic] = clip((knowledge[e.mechanic] || 0) + rules.dynamics.knowledgeRate * e.feedback / 10 * profile.learningRate * dt, 1);
      if (e.type === 'challenge') {
        investment += e.intensity * dt;
        if (e.requires && (knowledge[e.requires] || 0) < rules.thresholds.knowledge) state.frustration += rules.dynamics.knowledgePenalty * e.difficulty * dt;
        state.frustration += Math.max(0, e.difficulty - state.competence - 1) * rules.dynamics.mismatchPenalty * dt;
        state.fatigue += Math.max(0, (counts.get(e.requires || 'general') || 0) - 1) * (1 - e.novelty / 10) * rules.dynamics.repetitionFatigue * dt;
      }
    }
    for (const [key, target] of Object.entries(sustained)) state[key] += (clip(target) - state[key]) * (1 - Math.exp(-0.08 * dt));
    sinceReward += dt;
    if (!active.length || active.every(e => e.type === 'rest')) {
      const previous = idle; idle += dt;
      state.boredom += Math.max(0, idle - Math.max(previous, rules.dynamics.idleGrace)) * rules.dynamics.boredomRate;
    } else { idle = 0; state.boredom -= rules.dynamics.activeBoredomRecovery * dt; }
    for (const key of STATES) state[key] = clip(state[key]);
    const related = active.find(e => e.type === 'challenge') || active[0];
    if (state.fatigue >= rules.thresholds.fatigue) report('fatigue', related, t + dt, `疲劳 ${state.fatigue.toFixed(1)} ≥ ${rules.thresholds.fatigue}`, '缩短持续高负荷段落，测试休整或内容变化的作用。');
    if (state.boredom >= rules.thresholds.boredom) report('boredom', related, t + dt, `无聊 ${state.boredom.toFixed(1)} ≥ ${rules.thresholds.boredom}；低活动持续 ${idle.toFixed(0)} 秒`, '缩短空窗或休整，增加线索、叙事或目标进展。');
    const endpoint = result(t + dt);
    area += endpoint.engagement * dt;
    minimum = Math.min(minimum, endpoint.engagement);
  }
  // Interpolate only display samples. All calculations and diagnoses precede sampling.
  const sampleAt = time => {
    let low = 0, high = all.length - 1;
    while (low < high) { const mid = Math.ceil((low + high) / 2); if (all[mid].time <= time) low = mid; else high = mid - 1; }
    const a = all[low], b = all[low + 1] || a, fraction = b.time === a.time ? 0 : (time - a.time) / (b.time - a.time);
    return { ...a, time, ...Object.fromEntries([...STATES, 'engagement', 'arousal', 'valence'].map(k => [k, a[k] + (b[k] - a[k]) * fraction])) };
  };
  for (let t = 0; t < duration; t += unit) samples.push(sampleAt(t));
  samples.push(sampleAt(duration));
  return { duration, samples, diagnostics, summary: { average: duration ? area / duration : all[0].engagement, minimum, final: all.at(-1) } };
}
