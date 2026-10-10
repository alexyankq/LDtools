import test from 'node:test';
import assert from 'node:assert/strict';
import { gridGeometry, positionAt, CELL_WIDTH, ROW_HEIGHT } from '../web/timeline.js';
import { makeEvent, validateProject, DEFAULT_RULES, PROFILES } from '../web/model.js';
const project = events => ({ version: 1, events, unit: 5, rules: DEFAULT_RULES, profile: PROFILES.balanced });
test('overlapping events are layered and retain exact time and duration', () => {
  const events = [makeEvent({ id: 'a', start: 0, duration: 20 }), makeEvent({ id: 'b', start: 5.5, duration: 10 }), makeEvent({ id: 'c', start: 20, duration: 5 })];
  const geometry = gridGeometry(project(events));
  assert.equal(geometry.events[0].lane, 0); assert.equal(geometry.events[1].lane, 1); assert.equal(geometry.events[2].lane, 0);
  assert.equal(geometry.events[1].start, 5.5); assert.equal(geometry.events[1].duration, 10);
});
test('grid coordinates snap to time units and preserve row selection', () => {
  const geometry = gridGeometry(project([]));
  assert.deepEqual(positionAt(3 * CELL_WIDTH + 12, 2 * ROW_HEIGHT + 10, 5, geometry), { start: 15, lane: 2 });
  assert.equal(positionAt(3 * CELL_WIDTH + 12, 0, 30, geometry).start, 90);
});
test('range expands for events and drops beyond the model limit are rejected', () => {
  const p = project([makeEvent({ start: 7190, duration: 10 })]), geometry = gridGeometry(p);
  assert.equal(geometry.span, 7200);
  assert.equal(positionAt(1439 * CELL_WIDTH, 0, 5, geometry, 30), null);
  assert.throws(() => validateProject({ ...p, timelineLength: 7201 }));
  assert.throws(() => validateProject(project([makeEvent({ lane: -1 })])));
});
