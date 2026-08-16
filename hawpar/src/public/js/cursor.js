/**
 * cursor.js — magnetic cursor.
 *
 * Replaces the pointer with a gold core and a crystal ring. The ring trails the
 * core with easing, and snaps ("magnetises") onto interactive targets so the
 * whole interface feels physically responsive.
 *
 * Disabled entirely for coarse pointers and reduced-motion users.
 */

import { el } from './util.js';

const MAGNETIC_SELECTOR = [
  'button',
  'a[href]',
  '.btn',
  '.nav-item',
  '.card--interactive',
  '.sample-card',
  '.kpi',
  '.tab',
  '.copilot__tab',
  '.avatar',
  '.copilot-fab',
  '[role="button"]',
  'input',
  'select',
  'textarea'
].join(',');

/**
 * @returns {Function} destroy
 */
export function mountCursor() {
  const fine = window.matchMedia('(pointer: fine)').matches;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduced) return () => {};

  const core = el('div.q-cursor', { 'aria-hidden': 'true' });
  const ring = el('div.q-cursor-ring', { 'aria-hidden': 'true' });
  document.body.append(core, ring);

  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight / 2;
  let ringX = targetX;
  let ringY = targetY;
  let magnet = null;
  let raf = 0;

  function onMove(event) {
    targetX = event.clientX;
    targetY = event.clientY;
    document.body.classList.add('q-cursor-active');

    const hit = event.target instanceof Element ? event.target.closest(MAGNETIC_SELECTOR) : null;
    if (hit !== magnet) {
      magnet = hit;
      ring.classList.toggle('is-magnetic', Boolean(hit));
    }
  }

  function frame() {
    // The core tracks the pointer exactly; the ring eases toward it, and when a
    // magnetic target is under the pointer the ring is pulled to its centre.
    let anchorX = targetX;
    let anchorY = targetY;

    if (magnet && magnet.isConnected) {
      const box = magnet.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      // Only snap for compact controls — large cards would feel unresponsive.
      const pull = box.width < 260 && box.height < 160 ? 0.45 : 0.16;
      anchorX = targetX + (cx - targetX) * pull;
      anchorY = targetY + (cy - targetY) * pull;
    } else if (magnet && !magnet.isConnected) {
      magnet = null;
      ring.classList.remove('is-magnetic');
    }

    ringX += (anchorX - ringX) * 0.18;
    ringY += (anchorY - ringY) * 0.18;

    core.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
    ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;

    raf = requestAnimationFrame(frame);
  }

  const onDown = () => ring.classList.add('is-down');
  const onUp = () => ring.classList.remove('is-down');
  const onLeave = () => document.body.classList.remove('q-cursor-active');
  const onEnter = () => document.body.classList.add('q-cursor-active');

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  document.addEventListener('pointerenter', onEnter);

  raf = requestAnimationFrame(frame);

  return function destroy() {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('pointerenter', onEnter);
    document.body.classList.remove('q-cursor-active');
    core.remove();
    ring.remove();
  };
}
