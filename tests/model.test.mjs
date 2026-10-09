import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, scenario, makeEvent, DEFAULT_RULES, PROFILES, clone, validateProject, validateRules } from '../web/model.js';

test('sampling units do not change state evolution, summary or diagnostics', () => {
  const events = scenario();
  const results = [1, 5, 30, 7.5].map(unit => analyze(events, DEFAULT_RULES, PROFILES.balanced, unit));
  for (const r of results) {
    assert.deepEqual(r.summary, results[0].summary);
    assert.deepEqual(r.diagnostics, results[0].diagnostics);
    assert.equal(r.samples.at(-1).time, r.duration);
  }
  assert.ok(results[0].samples.length > results[2].samples.length);
});
test('teaching order controls knowledge diagnostics; repeated input increases fatigue', () => {
  const normal = analyze(scenario()), repeated = analyze(scenario('repetition')), wrong = analyze(scenario('wrong-order'));
  assert.equal(normal.diagnostics.filter(d => d.rule === 'knowledge-gap').length, 0);
  assert.ok(wrong.diagnostics.some(d => d.rule === 'knowledge-gap' && d.time === 0));
  assert.ok(repeated.diagnostics.filter(d => d.rule === 'repetition').length > normal.diagnostics.filter(d => d.rule === 'repetition').length);
  assert.ok(repeated.summary.average < normal.summary.average);
  assert.ok(repeated.summary.final.fatigue > normal.summary.final.fatigue);
});
test('fractional instantaneous events fire once, including at final timestamp', () => {
  const rules = clone(DEFAULT_RULES); for (const k of Object.keys(rules.decay)) rules.decay[k] = 0;
  rules.dynamics.boredomRate = 0;
  const e = makeEvent({ type: 'reward', start: 0.5, duration: 0, value: 5 });
  const result = analyze([e], rules);
  assert.equal(result.duration, 0.5);
  assert.equal(result.summary.final.competence, 5.8);
  assert.equal(result.summary.final.anticipation, 5.8);
});
test('fractional intervals and overlapping events apply exact accumulation duration', () => {
  const rules = clone(DEFAULT_RULES); for (const k of Object.keys(rules.decay)) rules.decay[k] = 0;
  rules.mappings.explore = [{ state: 'fatigue', mode: 'accumulate', coefficient: 1 }];
  const events = [makeEvent({ id: 'a', type: 'explore', start: 0.2, duration: 0.7 }), makeEvent({ id: 'b', type: 'explore', start: 0.4, duration: 0.3 })];
  assert.ok(Math.abs(analyze(events, rules).summary.final.fatigue - 1) < 1e-10);
});
test('delayed effects extend simulation and trigger once at exact boundary', () => {
  const rules = clone(DEFAULT_RULES); rules.decay.competence = 0;
  rules.mappings.story = [{ state: 'competence', mode: 'delayed', coefficient: 2, delay: 2.5 }];
  const r = analyze([makeEvent({ type: 'story', start: 0.25, duration: 0 })], rules);
  assert.equal(r.duration, 2.75); assert.equal(r.summary.final.competence, 7);
});
test('terminal rewards do not hide the low point immediately before receipt', () => {
  const e = makeEvent({ id: 'rest', type: 'rest', duration: 600 });
  const reward = makeEvent({ id: 'reward', type: 'reward', start: 600, duration: 0, value: 10 });
  assert.equal(analyze([e, reward]).summary.minimum, analyze([e]).summary.minimum);
});
test('recovery lowers fatigue; excessively long rest adds boredom', () => {
  const challenge = makeEvent({ id: 'c', duration: 240, intensity: 8 });
  const rest = makeEvent({ id: 'r', type: 'rest', start: 240, duration: 120 });
  const before = analyze([challenge]), normal = analyze([challenge, rest]), long = analyze([challenge, { ...rest, duration: 600 }]);
  assert.ok(normal.summary.final.fatigue < before.summary.final.fatigue);
  assert.ok(long.summary.final.boredom > normal.summary.final.boredom);
  assert.ok(long.diagnostics.some(d => d.rule === 'boredom'));
  assert.ok(long.summary.final.engagement < normal.summary.final.engagement);
});
test('player profiles and imported rules affect output without mutating inputs', () => {
  const events = scenario(), original = clone(events), rules = clone(DEFAULT_RULES);
  const balanced = analyze(events), casual = analyze(events, rules, PROFILES.casual);
  assert.notEqual(balanced.summary.average, casual.summary.average);
  rules.weights.base += 1;
  assert.notEqual(analyze(events, rules).summary.average, balanced.summary.average);
  assert.deepEqual(events, original);
});
test('failure feedback moderates frustration and reward gap retains event evidence', () => {
  const failure = makeEvent({ type: 'failure', duration: 0, cost: 8, feedback: 0 });
  assert.ok(analyze([{ ...failure, feedback: 10 }]).summary.final.frustration < analyze([failure]).summary.final.frustration);
  const events = [makeEvent({ id: 'c', duration: 180 }), makeEvent({ id: 'r', name: '微弱奖励', type: 'reward', start: 180, duration: 0, value: 1 })];
  const r = analyze(events); const d = r.diagnostics.find(d => d.rule === 'reward-gap');
  assert.equal(d.eventId, 'r'); assert.equal(d.time, 180); assert.ok(d.evidence && d.suggestion);
});
test('invalid imports reject nonfinite values, unsupported formulas, and duplicates', () => {
  const p = { version: 1, events: scenario(), rules: clone(DEFAULT_RULES), profile: clone(PROFILES.balanced), unit: 5 };
  assert.throws(() => validateProject({ ...p, unit: 0 }));
  assert.throws(() => validateProject({ ...p, events: [p.events[0], p.events[0]] }));
  assert.throws(() => validateProject({ ...p, profile: { ...p.profile, skill: NaN } }));
  const rules = clone(DEFAULT_RULES); rules.mappings.rest[0].mode = 'eval'; assert.throws(() => validateRules(rules));
  rules.mappings.rest[0].mode = 'recover'; rules.mappings.rest[0].coefficient = -1; assert.throws(() => validateRules(rules));
  const delayed = clone(DEFAULT_RULES); delayed.mappings.story[1].delay = 7200;
  assert.throws(() => analyze([makeEvent({ type: 'story', start: 1 })], delayed));
});
test('empty projects and prototype-like mechanic names stay valid and finite', () => {
  const empty = analyze([]); assert.equal(empty.duration, 0); assert.equal(empty.samples.length, 1); assert.ok(Number.isFinite(empty.summary.average));
  const events = [makeEvent({ id: 'teach', type: 'tutorial', duration: 120, mechanic: '__proto__' }), makeEvent({ id: 'use', start: 120, requires: '__proto__' })];
  assert.equal(analyze(events).diagnostics.filter(d => d.rule === 'knowledge-gap').length, 0);
});
