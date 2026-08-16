/**
 * ambient.js — the Quantum Crystal atmosphere.
 *
 * Mounts the deep-space backdrop behind the application shell:
 *   • aurora curtain and moving light beams (CSS-driven DOM layers)
 *   • floating crystal polygons (CSS-driven DOM layers)
 *   • nebula particles, neural energy links and soft stars (canvas)
 *   • parallax depth coupled to workspace scrolling
 *
 * Also exports `neuralSphere()` — the rotating point-cloud sphere that sits
 * behind the login card.
 *
 * Everything is CSP-safe (no inline script, no external assets) and every
 * animation stops when the user asks for reduced motion.
 */

import { el } from './util.js';

const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Devices with little GPU headroom get a lighter particle field. */
function particleBudget(width, height) {
  const area = width * height;
  const base = Math.round(area / 14000);
  const cores = navigator.hardwareConcurrency || 4;
  const ceiling = cores <= 4 ? 90 : 170;
  return Math.max(36, Math.min(ceiling, base));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

/* ==========================================================================
   Nebula / neural / star field
   ========================================================================== */

const NEBULA_COLOURS = [
  [122, 176, 255],  // electric blue
  [34, 211, 238],   // neon cyan
  [167, 139, 250],  // royal purple
  [232, 199, 126]   // champagne gold
];

function createField(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  let particles = [];
  let stars = [];
  let width = 0;
  let height = 0;
  let dpr = 1;
  const pointer = { x: -9999, y: -9999 };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    const count = particleBudget(width, height);
    particles = Array.from({ length: count }, () => {
      const colour = NEBULA_COLOURS[Math.floor(Math.random() * NEBULA_COLOURS.length)];
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: rand(-0.16, 0.16),
        vy: rand(-0.16, 0.16),
        r: rand(0.7, 2.4),
        alpha: rand(0.2, 0.7),
        colour
      };
    });
    // Soft stars: a still, faint layer that only twinkles.
    stars = Array.from({ length: Math.round(count * 1.3) }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: rand(0.3, 1.1),
      base: rand(0.1, 0.45),
      phase: Math.random() * Math.PI * 2,
      speed: rand(0.4, 1.5)
    }));
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);

    // --- soft stars -------------------------------------------------------
    for (const star of stars) {
      const twinkle = star.base + Math.sin(time * 0.001 * star.speed + star.phase) * 0.18;
      ctx.globalAlpha = Math.max(0, twinkle);
      ctx.fillStyle = '#dbe7ff';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- neural energy: links between near neighbours ---------------------
    ctx.lineWidth = 0.6;
    for (let i = 0; i < particles.length; i += 1) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j += 1) {
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > 18000) continue;
        const strength = 1 - Math.sqrt(dist2) / 134;
        ctx.globalAlpha = strength * 0.18;
        ctx.strokeStyle = `rgb(${a.colour[0]}, ${a.colour[1]}, ${a.colour[2]})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // --- nebula particles -------------------------------------------------
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;

      // Gentle repulsion from the pointer — the field reacts to presence.
      const dx = p.x - pointer.x;
      const dy = p.y - pointer.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 20000 && d2 > 0.5) {
        const push = (1 - d2 / 20000) * 0.7;
        const d = Math.sqrt(d2);
        p.x += (dx / d) * push;
        p.y += (dy / d) * push;
      }

      if (p.x < -20) p.x = width + 20;
      if (p.x > width + 20) p.x = -20;
      if (p.y < -20) p.y = height + 20;
      if (p.y > height + 20) p.y = -20;

      const [r, g, b] = p.colour;
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
      glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${p.alpha})`);
      glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.globalAlpha = 1;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  function setPointer(x, y) {
    pointer.x = x;
    pointer.y = y;
  }

  return { resize, draw, setPointer };
}

/* ==========================================================================
   Public: mountAmbient()
   ========================================================================== */

/**
 * Mounts the ambient backdrop into `host` (defaults to document.body).
 * @returns {Function} destroy — removes every layer and stops all timers.
 */
export function mountAmbient(host = document.body) {
  const reduced = REDUCED();

  const aurora = el('div.q-aurora', { 'aria-hidden': 'true' });

  const beams = el('div.q-beams', { 'aria-hidden': 'true' }, [
    el('span.q-beam'), el('span.q-beam'), el('span.q-beam')
  ]);

  const shapes = ['tri', 'hex', 'dia', 'tri', 'hex', 'dia', 'tri'];
  const polygons = el('div.q-polygons', { 'aria-hidden': 'true' },
    shapes.map((shape, index) => el(`span.q-poly.q-poly--${shape}`, {
      style: {
        left: `${8 + index * 13}%`,
        bottom: `${-14 - (index % 3) * 8}%`,
        width: `${26 + (index % 4) * 16}px`,
        height: `${26 + (index % 4) * 16}px`,
        animationDelay: `${index * -4.4}s`,
        animationDuration: `${26 + index * 3.5}s`
      }
    }))
  );

  const canvas = el('canvas.q-particles', { 'aria-hidden': 'true' });

  const fog = el('div.q-fog', { 'aria-hidden': 'true' }, [
    el('span.q-fog__bank'), el('span.q-fog__bank'), el('span.q-fog__bank')
  ]);

  host.prepend(aurora, beams, fog, polygons, canvas);

  // Static backdrops only when motion is reduced.
  if (reduced) {
    canvas.remove();
    return () => {
      aurora.remove();
      beams.remove();
      fog.remove();
      polygons.remove();
    };
  }

  const field = createField(canvas);
  field.resize();

  let raf = 0;
  let running = true;

  function frame(time) {
    if (!running) return;
    field.draw(time);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const onResize = () => field.resize();
  const onPointer = (event) => field.setPointer(event.clientX, event.clientY);
  const onLeave = () => field.setPointer(-9999, -9999);

  // Pause when the tab is hidden — no point burning cycles in the background.
  const onVisibility = () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!running) {
      running = true;
      raf = requestAnimationFrame(frame);
    }
  };

  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerleave', onLeave, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);

  return function destroy() {
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('visibilitychange', onVisibility);
    aurora.remove();
    beams.remove();
    fog.remove();
    polygons.remove();
    canvas.remove();
  };
}

/* ==========================================================================
   Public: parallax()
   ========================================================================== */

/**
 * Couples the ambient layers to workspace scrolling so the backdrop drifts at
 * a slower rate than the content — classic depth parallax.
 * @param {Element} scroller the scrolling container (the workspace)
 * @returns {Function} destroy
 */
export function mountParallax(scroller) {
  if (!scroller || REDUCED()) return () => {};

  let ticking = false;

  function apply() {
    ticking = false;
    const offset = scroller.scrollTop;
    document.documentElement.style.setProperty('--parallax', String(-offset * 0.06));
    const aurora = document.querySelector('.q-aurora');
    const polygons = document.querySelector('.q-polygons');
    if (aurora) aurora.style.transform = `translate3d(0, ${offset * -0.05}px, 0)`;
    if (polygons) polygons.style.transform = `translate3d(0, ${offset * -0.11}px, 0)`;
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(apply);
  }

  scroller.addEventListener('scroll', onScroll, { passive: true });
  return () => scroller.removeEventListener('scroll', onScroll);
}

/* ==========================================================================
   Public: neuralSphere() — the login backdrop
   ========================================================================== */

/**
 * Renders a rotating wireframe point-cloud sphere: nodes distributed with a
 * Fibonacci lattice, projected orthographically, with links drawn between
 * neighbours to read as a neural network.
 * @param {HTMLCanvasElement} canvas
 * @returns {Function} destroy
 */
export function neuralSphere(canvas) {
  const ctx = canvas.getContext('2d');
  const reduced = REDUCED();
  const NODE_COUNT = reduced ? 90 : 200;

  // Fibonacci sphere — evenly spaced points with no polar clustering.
  const golden = Math.PI * (3 - Math.sqrt(5));
  const nodes = Array.from({ length: NODE_COUNT }, (_, i) => {
    const y = 1 - (i / (NODE_COUNT - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    return {
      x: Math.cos(theta) * radius,
      y,
      z: Math.sin(theta) * radius,
      pulse: Math.random() * Math.PI * 2
    };
  });

  let width = 0;
  let height = 0;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(time) {
    const t = time * 0.00016;
    const cx = width / 2;
    const cy = height / 2;
    const scale = Math.min(width, height) * 0.36;

    ctx.clearRect(0, 0, width, height);

    const cosY = Math.cos(t);
    const sinY = Math.sin(t);
    const cosX = Math.cos(t * 0.42);
    const sinX = Math.sin(t * 0.42);

    const projected = nodes.map((node) => {
      // Rotate around Y, then X.
      const x1 = node.x * cosY - node.z * sinY;
      const z1 = node.x * sinY + node.z * cosY;
      const y2 = node.y * cosX - z1 * sinX;
      const z2 = node.y * sinX + z1 * cosX;
      const depth = (z2 + 1) / 2;                 // 0 = far, 1 = near
      return {
        sx: cx + x1 * scale,
        sy: cy + y2 * scale,
        depth,
        pulse: node.pulse
      };
    });

    // Halo behind the lattice.
    const halo = ctx.createRadialGradient(cx, cy, scale * 0.15, cx, cy, scale * 1.5);
    halo.addColorStop(0, 'rgba(77, 141, 255, 0.24)');
    halo.addColorStop(0.55, 'rgba(167, 139, 250, 0.1)');
    halo.addColorStop(1, 'rgba(5, 7, 12, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, scale * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Neural links.
    ctx.lineWidth = 0.7;
    for (let i = 0; i < projected.length; i += 1) {
      const a = projected[i];
      for (let j = i + 1; j < projected.length; j += 1) {
        const b = projected[j];
        const dx = a.sx - b.sx;
        const dy = a.sy - b.sy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > scale * 0.34) continue;
        const near = (a.depth + b.depth) / 2;
        ctx.strokeStyle = `rgba(122, 176, 255, ${(1 - dist / (scale * 0.34)) * near * 0.34})`;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
    }

    // Nodes — nearer points are larger, brighter, and occasionally gold.
    projected.forEach((p, index) => {
      const flicker = 0.6 + Math.sin(time * 0.002 + p.pulse) * 0.4;
      const r = 0.7 + p.depth * 2.1;
      const gold = index % 11 === 0;
      ctx.fillStyle = gold
        ? `rgba(232, 199, 126, ${p.depth * flicker})`
        : `rgba(190, 220, 255, ${p.depth * flicker * 0.9})`;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  resize();

  if (reduced) {
    draw(0);
    const onResizeStatic = () => { resize(); draw(0); };
    window.addEventListener('resize', onResizeStatic, { passive: true });
    return () => window.removeEventListener('resize', onResizeStatic);
  }

  let raf = 0;
  function frame(time) {
    draw(time);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const onResize = () => resize();
  window.addEventListener('resize', onResize, { passive: true });

  return function destroy() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
  };
}
