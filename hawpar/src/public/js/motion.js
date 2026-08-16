/**
 * motion.js — the premium interaction engine.
 *
 * Gives every interactive surface real physics: magnetic attraction, hover
 * tilt toward the cursor, a cursor-tracking sheen, liquid press compression
 * and a crystal water ripple from the exact point of contact.
 *
 * ── Design constraints ──────────────────────────────────────────────────────
 * • ONE transform per element. Every channel is a custom property composed by
 *   the `.q-phys` rule in motion.css, so nothing ever fights over `transform`.
 * • ONE rAF loop for the whole page, running only while something is in
 *   motion. Idle elements are released and fall back to their CSS float.
 * • Delegated listeners on `document` — no per-element bookkeeping, so views
 *   can re-render freely without leaking handlers.
 * • Only `transform` and `opacity` are animated. No frame causes layout.
 * • Everything is inert under `prefers-reduced-motion`.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { el } from './util.js';

const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Surfaces the engine takes physical control of. */
const PHYS_SELECTOR = [
  '.btn',
  '.card',
  '.nav-item',
  '.sample-card',
  '.arch__node',
  '.field-row',
  '.tab',
  '.copilot__tab',
  '.copilot__task',
  '.copilot__send',
  '.copilot__mic',
  '.copilot__close',
  '.copilot-fab',
  '.avatar'
].join(',');

/** Compact controls are magnetic; large panels only tilt and lift. */
const SMALL_SELECTOR = [
  '.btn',
  '.nav-item',
  '.tab',
  '.copilot__tab',
  '.copilot__send',
  '.copilot__mic',
  '.copilot__close',
  '.copilot-fab',
  '.avatar'
].join(',');

/*
 * Spring constants, tuned by simulation rather than by eye:
 * a 6px hover lift settles in ~433ms with 5.5% overshoot. Enough to feel
 * physical and never snap, far too little to read as bouncy.
 */
const STIFFNESS = 0.26;
const DAMPING = 0.55;
const SETTLED = 0.0015;

const MAX_PULL = 5;        // px a magnetic control drifts toward the cursor
const PROBE_RADIUS = 26;   // px — how far ahead of the cursor we look

/** Per-channel spring value. */
function channel(value = 0) {
  return { v: value, target: value, vel: 0 };
}

function step(ch) {
  ch.vel += (ch.target - ch.v) * STIFFNESS;
  ch.vel *= DAMPING;
  ch.v += ch.vel;
  return Math.abs(ch.vel) > SETTLED || Math.abs(ch.target - ch.v) > SETTLED;
}

/**
 * Reads the live translateY a card has reached through its CSS float
 * animation, so the handover to spring physics is seamless.
 */
function currentFloatY(node) {
  const { transform } = getComputedStyle(node);
  if (!transform || transform === 'none') return 0;
  const match = transform.match(/matrix(3d)?\(([^)]+)\)/);
  if (!match) return 0;
  const parts = match[2].split(',').map(Number);
  return match[1] ? parts[13] : parts[5];
}

export function mountMotion() {
  if (REDUCED()) return mountReducedMotion();

  /** @type {Map<Element, object>} elements currently being animated */
  const active = new Map();
  let raf = 0;

  const pointer = { x: -9999, y: -9999, seen: false };
  let magnets = new Set();

  /* ---- state ------------------------------------------------------------ */

  function profileFor(node) {
    const small = node.matches(SMALL_SELECTOR);
    return {
      small,
      lift: small ? -3 : -6,
      tilt: small ? 4 : 2.2,
      hoverScale: small ? 1.03 : 1.012,
      press: small ? 0.97 : 0.985
    };
  }

  function acquire(node) {
    let state = active.get(node);
    if (state) return state;

    const profile = profileFor(node);
    const seedY = node.classList.contains('card') ? currentFloatY(node) : 0;

    state = {
      node,
      profile,
      qx: channel(0),
      qy: channel(seedY),
      qrx: channel(0),
      qry: channel(0),
      qs: channel(1),
      hovered: false,
      pressed: false,
      pullX: 0,
      pullY: 0,
      written: {}
    };

    node.classList.add('q-phys');
    active.set(node, state);
    ensureLoop();
    return state;
  }

  function release(node) {
    node.classList.remove('q-phys');
    for (const name of ['--qx', '--qy', '--qrx', '--qry', '--qs']) node.style.removeProperty(name);
    active.delete(node);
  }

  /* ---- effects layer ---------------------------------------------------- */

  function effectsLayer(node) {
    let layer = node.querySelector(':scope > .q-fx');
    if (layer) return layer;
    // Spans, not divs: several hosts are <button>, which may only contain
    // phrasing content. Absolute positioning makes them block boxes anyway.
    layer = el('span.q-fx', { 'aria-hidden': 'true' }, [el('span.q-sheen')]);
    // Appended last so no `:first-child` rule on the host's children shifts.
    node.append(layer);
    return layer;
  }

  function spawnRipple(node, clientX, clientY) {
    const layer = effectsLayer(node);
    const rect = node.getBoundingClientRect();
    // Reach for the furthest corner, but cap the diameter: `.q-ripple` carries
    // a backdrop-filter, and an unbounded one on a full-width panel is the one
    // thing here that could genuinely cost frames.
    const dx = Math.max(clientX - rect.left, rect.right - clientX);
    const dy = Math.max(clientY - rect.top, rect.bottom - clientY);
    const size = Math.min(Math.hypot(dx, dy) * 2, 560);

    const ripple = el('span.q-ripple', {
      style: {
        width: `${size}px`,
        height: `${size}px`,
        left: `${clientX - rect.left - size / 2}px`,
        top: `${clientY - rect.top - size / 2}px`
      }
    });
    layer.append(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  }

  function flashRow(row) {
    row.classList.remove('q-row-flash');
    void row.offsetWidth;               // restart the animation
    row.classList.add('q-row-flash');
    row.addEventListener('animationend', () => row.classList.remove('q-row-flash'), { once: true });
  }

  /* ---- pointer ---------------------------------------------------------- */

  function onOver(event) {
    const node = event.target instanceof Element ? event.target.closest(PHYS_SELECTOR) : null;
    if (!node) return;
    const state = acquire(node);
    state.hovered = true;
    node.classList.add('is-hovered');
    effectsLayer(node);
  }

  function onOut(event) {
    const node = event.target instanceof Element ? event.target.closest(PHYS_SELECTOR) : null;
    if (!node) return;
    // Ignore moves between descendants of the same host.
    if (node.contains(event.relatedTarget)) return;
    const state = active.get(node);
    if (!state) return;
    state.hovered = false;
    state.pressed = false;
    node.classList.remove('is-hovered', 'is-pressed');
    ensureLoop();
  }

  function onMove(event) {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.seen = true;

    // Must run even when the cursor is over empty space, otherwise a control
    // the cursor has just left would keep its magnetic offset forever.
    if (magnets.size > 0 || active.size > 0) ensureLoop();

    const node = event.target instanceof Element ? event.target.closest(PHYS_SELECTOR) : null;
    if (!node) return;
    const state = active.get(node) ?? acquire(node);
    const rect = node.getBoundingClientRect();

    // Sheen tracks the cursor across the surface.
    node.style.setProperty('--gx', `${event.clientX - rect.left}px`);
    node.style.setProperty('--gy', `${event.clientY - rect.top}px`);

    // Tilt toward the cursor: -1..1 across each axis.
    const nx = (event.clientX - rect.left) / rect.width - 0.5;
    const ny = (event.clientY - rect.top) / rect.height - 0.5;
    state.qry.target = nx * 2 * state.profile.tilt;
    state.qrx.target = -ny * 2 * state.profile.tilt;
    ensureLoop();
  }

  function onDown(event) {
    if (event.button !== 0) return;
    const node = event.target instanceof Element ? event.target.closest(PHYS_SELECTOR) : null;
    if (node) {
      const state = acquire(node);
      state.pressed = true;
      node.classList.add('is-pressed');
      spawnRipple(node, event.clientX, event.clientY);
      ensureLoop();
      return;
    }
    const row = event.target instanceof Element ? event.target.closest('table.data tbody tr') : null;
    if (row) flashRow(row);
  }

  function onUp() {
    for (const state of active.values()) {
      if (!state.pressed) continue;
      state.pressed = false;
      state.node.classList.remove('is-pressed');
    }
    ensureLoop();
  }

  /* ---- magnetism -------------------------------------------------------- */

  /*
   * Rather than measuring every button on the page each frame, we hit-test a
   * small cross around the cursor. That finds controls the cursor is merely
   * *approaching* at a fixed cost of five hit tests, independent of how many
   * controls the view contains.
   */
  function probeMagnets() {
    const found = new Set();
    if (!pointer.seen) return found;

    const points = [
      [pointer.x, pointer.y],
      [pointer.x + PROBE_RADIUS, pointer.y],
      [pointer.x - PROBE_RADIUS, pointer.y],
      [pointer.x, pointer.y + PROBE_RADIUS],
      [pointer.x, pointer.y - PROBE_RADIUS]
    ];

    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      const node = hit ? hit.closest(SMALL_SELECTOR) : null;
      if (node) found.add(node);
    }
    return found;
  }

  /** Is the cursor inside the control's box expanded by the probe radius? */
  function nearPointer(node) {
    const rect = node.getBoundingClientRect();
    return Math.abs(pointer.x - (rect.left + rect.width / 2)) < rect.width / 2 + PROBE_RADIUS
      && Math.abs(pointer.y - (rect.top + rect.height / 2)) < rect.height / 2 + PROBE_RADIUS;
  }

  function applyMagnetism() {
    const found = probeMagnets();

    /*
     * Hysteresis. A magnetised control physically moves toward the cursor,
     * which changes what the hit test finds — without a separate release
     * condition the two feed back into each other and the control judders.
     * Hit testing therefore only *discovers* magnets; a proximity field
     * decides when to let one go.
     */
    for (const node of magnets) {
      if (found.has(node) || !node.isConnected) continue;
      if (nearPointer(node)) found.add(node);
    }

    for (const node of magnets) {
      if (found.has(node)) continue;
      const state = active.get(node);
      if (state) { state.pullX = 0; state.pullY = 0; }
    }

    for (const node of found) {
      const state = active.get(node) ?? acquire(node);
      const rect = node.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = pointer.x - cx;
      const dy = pointer.y - cy;
      const distance = Math.hypot(dx, dy) || 1;
      const pull = Math.min(distance * 0.2, MAX_PULL);
      state.pullX = (dx / distance) * pull;
      state.pullY = (dy / distance) * pull;
    }

    magnets = found;
  }

  /* ---- loop ------------------------------------------------------------- */

  function ensureLoop() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function frame() {
    raf = 0;
    applyMagnetism();

    let busy = false;

    for (const [node, state] of active) {
      if (!node.isConnected) { active.delete(node); continue; }

      const { profile } = state;
      const engaged = state.hovered || state.pressed;

      state.qx.target = state.pullX;
      state.qy.target = state.pullY + (state.hovered ? profile.lift : 0);
      state.qs.target = state.pressed ? profile.press : (state.hovered ? profile.hoverScale : 1);
      if (!state.hovered) { state.qrx.target = 0; state.qry.target = 0; }

      // `step` is called for every channel before the results are combined —
      // short-circuiting would leave channels frozen mid-flight.
      let moving = step(state.qx);
      moving = step(state.qy) || moving;
      moving = step(state.qrx) || moving;
      moving = step(state.qry) || moving;
      moving = step(state.qs) || moving;

      write(node, state);

      if (moving || engaged) busy = true;
      // A magnetically held control keeps its offset until the cursor leaves,
      // so it must not be released even once its springs have settled.
      else if (!magnets.has(node)) release(node);
    }

    // Idle out completely. The next pointer event restarts the loop.
    if (busy) ensureLoop();
  }

  /** Writes a channel only when it has visibly changed. */
  function write(node, state) {
    const { written } = state;
    set(node, written, '--qx', `${state.qx.v.toFixed(2)}px`);
    set(node, written, '--qy', `${state.qy.v.toFixed(2)}px`);
    set(node, written, '--qrx', `${state.qrx.v.toFixed(2)}deg`);
    set(node, written, '--qry', `${state.qry.v.toFixed(2)}deg`);
    set(node, written, '--qs', state.qs.v.toFixed(4));
  }

  function set(node, written, name, value) {
    if (written[name] === value) return;
    written[name] = value;
    node.style.setProperty(name, value);
  }

  /* ---- wiring ----------------------------------------------------------- */

  document.addEventListener('pointerover', onOver);
  document.addEventListener('pointerout', onOut);
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('pointerup', onUp, { passive: true });
  document.addEventListener('pointercancel', onUp, { passive: true });

  const teardown = [
    () => document.removeEventListener('pointerover', onOver),
    () => document.removeEventListener('pointerout', onOut),
    () => document.removeEventListener('pointermove', onMove),
    () => document.removeEventListener('pointerdown', onDown),
    () => document.removeEventListener('pointerup', onUp),
    () => document.removeEventListener('pointercancel', onUp),
    mountNavMorph(),
    mountFeedback(),
    mountScrollState()
  ];

  return function destroy() {
    cancelAnimationFrame(raf);
    raf = 0;
    for (const node of [...active.keys()]) release(node);
    active.clear();
    for (const off of teardown) off();
  };
}

/** Reduced motion still gets the structural indicator, just without physics. */
function mountReducedMotion() {
  const teardown = [mountNavMorph(), mountScrollState()];
  return () => { for (const off of teardown) off(); };
}

/* ==========================================================================
   Sidebar liquid morph
   ========================================================================== */

/**
 * A single capsule glides between menu items instead of each item painting its
 * own selected state — the selection reads as one continuous liquid form.
 */
function mountNavMorph() {
  const list = document.getElementById('nav-list');
  if (!list) return () => {};

  // An <li> rather than a <div>: `#nav-list` is a <ul>, which may only take
  // list items as children.
  const morph = el('li.nav-morph', { 'aria-hidden': 'true' });
  list.prepend(morph);

  const reduced = REDUCED();
  let raf = 0;
  let current = null;
  let velocity = 0;
  let renderedHeight = 0;

  function measure() {
    const activeItem = list.querySelector('.nav-item.is-active');
    if (!activeItem) {
      morph.classList.remove('is-ready');
      return null;
    }
    const listBox = list.getBoundingClientRect();
    const itemBox = activeItem.getBoundingClientRect();
    return { top: itemBox.top - listBox.top, height: itemBox.height };
  }

  function settle() {
    raf = 0;
    const target = measure();
    if (!target) return;

    // Height is a layout property — only touch it when it actually changes.
    if (target.height !== renderedHeight) {
      renderedHeight = target.height;
      morph.style.height = `${target.height}px`;
    }
    morph.classList.add('is-ready');

    if (current === null || reduced) {
      current = target.top;
      morph.style.transform = `translate3d(0, ${current}px, 0)`;
      return;
    }

    velocity += (target.top - current) * 0.26;
    velocity *= 0.55;
    current += velocity;
    morph.style.transform = `translate3d(0, ${current}px, 0)`;

    if (Math.abs(velocity) > 0.05 || Math.abs(target.top - current) > 0.05) {
      raf = requestAnimationFrame(settle);
    }
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(settle);
  }

  const observer = new MutationObserver(schedule);
  for (const item of list.querySelectorAll('.nav-item')) {
    observer.observe(item, { attributes: true, attributeFilter: ['class'] });
  }

  window.addEventListener('resize', schedule, { passive: true });
  schedule();

  return function destroy() {
    cancelAnimationFrame(raf);
    observer.disconnect();
    window.removeEventListener('resize', schedule);
    morph.remove();
  };
}

/* ==========================================================================
   Feedback choreography
   ========================================================================== */

/**
 * Watches the toast stack and decorates a success with champagne particles.
 * Colour, glow, shake and wave are handled declaratively in motion.css; only
 * the particle burst needs real nodes.
 */
function mountFeedback() {
  const stack = document.getElementById('toast-stack');
  if (!stack || REDUCED()) return () => {};

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element) || !node.classList.contains('toast--success')) continue;
        burst(node);
      }
    }
  });
  observer.observe(stack, { childList: true });

  function burst(toastNode) {
    for (let index = 0; index < 12; index += 1) {
      const angle = (Math.PI * 2 * index) / 12 + Math.random() * 0.4;
      const distance = 26 + Math.random() * 34;
      const spark = el('span.q-spark', { style: { animationDelay: `${index * 14}ms` } });
      // Custom properties must go through setProperty — assigning them onto
      // the style object (as `el` does for standard properties) is a no-op.
      spark.style.setProperty('--sx', `${Math.cos(angle) * distance}px`);
      spark.style.setProperty('--sy', `${Math.sin(angle) * distance}px`);
      toastNode.append(spark);
      spark.addEventListener('animationend', () => spark.remove(), { once: true });
    }
  }

  return () => observer.disconnect();
}

/* ==========================================================================
   Scroll state
   ========================================================================== */

/** Gives the top chrome presence once the workspace has left the top. */
function mountScrollState() {
  const scroller = document.getElementById('view-root');
  const topbar = document.querySelector('.topbar');
  if (!scroller || !topbar) return () => {};

  let ticking = false;
  function apply() {
    ticking = false;
    topbar.classList.toggle('is-scrolled', scroller.scrollTop > 8);
  }
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(apply);
  }

  scroller.addEventListener('scroll', onScroll, { passive: true });
  return () => scroller.removeEventListener('scroll', onScroll);
}
