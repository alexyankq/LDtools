export const CELL_WIDTH = 52, ROW_HEIGHT = 44, RULER_HEIGHT = 36;
export function gridGeometry(project) {
  const end = Math.max(0, ...project.events.map(e => e.start + e.duration));
  const span = Math.min(7200, Math.max(project.timelineLength || 300, end + project.unit * 3));
  const columns = Math.ceil(span / project.unit);
  const occupied = [];
  const events = [...project.events].sort((a, b) => a.start - b.start).map(event => {
    let lane = event.lane;
    if (lane === undefined) {
      lane = 0;
      while (occupied[lane]?.some(e => event.start < Math.max(e.start + e.duration, e.start + project.unit) && e.start < Math.max(event.start + event.duration, event.start + project.unit))) lane++;
    }
    (occupied[lane] ||= []).push(event);
    return { ...event, lane };
  });
  const rows = Math.max(4, ...events.map(e => e.lane + 2));
  return { span, columns, rows, width: columns * CELL_WIDTH, events };
}
export function positionAt(x, y, unit, geometry, duration = 0) {
  const column = Math.max(0, Math.min(geometry.columns - 1, Math.floor(x / CELL_WIDTH)));
  const start = column * unit;
  // Reject drops that would truncate an event or exceed the model's time range.
  if (start + duration > 7200) return null;
  return { start, lane: Math.max(0, Math.min(geometry.rows - 1, Math.floor(y / ROW_HEIGHT))) };
}
