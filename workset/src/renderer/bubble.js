const button = document.querySelector('#open-bubble');
let drag, moving = Promise.resolve();
const safe = promise => promise.catch(error => { console.error(error); button.title = error.message; });
button.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const current = { x: event.screenX, y: event.screenY, moved: false, bounds: window.bubble.bounds() };
  drag = current;
  button.setPointerCapture(event.pointerId);
});
button.addEventListener('pointermove', event => {
  if (!drag) return;
  const dx = event.screenX - drag.x, dy = event.screenY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 5) return;
  const current = drag;
  current.moved = true;
  button.classList.add('dragging');
  moving = moving.then(async () => {
    const bounds = await current.bounds;
    await window.bubble.move({ x: Math.round(bounds.x + dx), y: Math.round(bounds.y + dy) });
  }).catch(error => { console.error(error); });
});
button.addEventListener('pointerup', event => {
  if (!drag) return;
  const current = drag;
  drag = null;
  button.classList.remove('dragging');
  if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
  if (!current.moved) safe(window.bubble.expand());
});
button.addEventListener('pointercancel', () => { drag = null; button.classList.remove('dragging'); });
button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); safe(window.bubble.expand()); } });
button.addEventListener('contextmenu', event => { event.preventDefault(); safe(window.bubble.menu()); });
