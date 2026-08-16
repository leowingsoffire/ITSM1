/**
 * Rendered-text contrast audit.
 *
 * Computed styles are not enough to catch unreadable text: this application
 * paints headline numbers with `background-clip: text`, so the *declared*
 * colour is `transparent` and the visible ink comes from a gradient. A
 * regression that pointed those gradients at the wrong palette made KPI values
 * and page titles invisible while every computed-style assertion still passed.
 *
 * So this measures what a reader actually sees. It screenshots the viewport,
 * feeds the bitmap back into the page as an image, and samples the pixels
 * inside each run of text (the client rects of the text nodes themselves, not
 * the element box, so the sample is mostly glyph). The most common colour is
 * the background; the ink is taken at a percentile of the contrast
 * distribution, which is robust to anti-aliasing without being fooled by a
 * couple of stray pixels.
 */

/** Sampling knobs, kept here so the in-page function stays serialisable. */
const INK_PERCENTILE = 0.02;
const MIN_INK_PIXELS = 3;

/**
 * Animations must be frozen in the page, not just in the screenshot: element
 * rectangles and pixels have to describe the same frame. A zero duration with
 * the declared fill mode snaps entrance animations to their final state rather
 * than removing them, so the layout is the one a reader ends up looking at.
 */
const FREEZE_MOTION = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
`;

/**
 * Waits until the page stops reflowing. Views here fetch and then grow (the
 * sample grid, tables, charts), and a screenshot taken mid-growth no longer
 * matches the rectangles measured a moment later.
 */
async function waitForStableLayout(page, { required = 3, interval = 150, attempts = 40 } = {}) {
  let previous = null;
  let stable = 0;
  for (let i = 0; i < attempts; i += 1) {
    const signature = await layoutSignature(page);
    if (signature === previous) {
      stable += 1;
      if (stable >= required) return signature;
    } else {
      stable = 0;
      previous = signature;
    }
    await page.waitForTimeout(interval);
  }
  return previous;
}

function layoutSignature(page) {
  return page.evaluate(() => {
    const view = document.querySelector('#view-root div.view');
    // Rect positions are part of the signature because the motion layer drives
    // inline transforms from requestAnimationFrame; those move painted glyphs
    // without changing the DOM, so a count-only signature would miss the drift.
    const probes = document.querySelectorAll('.card, .sample-card, .wave, tr, .kpi');
    let fingerprint = '';
    for (let i = 0; i < probes.length; i += 1) {
      const r = probes[i].getBoundingClientRect();
      fingerprint += `${Math.round(r.left)},${Math.round(r.top)};`;
    }
    return [
      document.documentElement.scrollHeight,
      Math.round(window.scrollY),
      view ? view.textContent.length : 0,
      document.querySelectorAll('body *').length,
      fingerprint
    ].join(':');
  });
}

export async function measureTextContrast(page, options = {}) {
  const { minFontSize = 10, attempts = 3 } = options;

  // The application ships a strict Content-Security-Policy, so `addStyleTag`
  // (an inline <style> element) is refused. Constructed stylesheets are a CSSOM
  // API and stay exempt, so motion can still be frozen before measuring.
  await page.evaluate((css) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    sheet.__contrastFreeze = true;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, FREEZE_MOTION);
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await waitForStableLayout(page);
      const before = await layoutSignature(page);
      const shot = await page.screenshot({ type: 'png' });
      const result = await sample(page, minFontSize, shot);
      const after = await layoutSignature(page);
      // A reflow between the capture and the measurement invalidates every
      // rectangle, so the run is discarded rather than reported as contrast.
      if (before === after) return result;
      if (attempt === attempts) {
        throw new Error(`measureTextContrast: layout kept moving (${before} -> ${after})`);
      }
    }
    return [];
  } finally {
    await page
      .evaluate(() => {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => !sheet.__contrastFreeze);
      })
      .catch(() => {});
  }
}

async function sample(page, minFontSize, shot) {
  const dataUrl = `data:image/png;base64,${shot.toString('base64')}`;

  return page.evaluate(
    async ({ dataUrl: url, minFontSize: minSize, inkPercentile, minInkPixels }) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const scale = image.naturalWidth / window.innerWidth;

      const channel = (value) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (r, g, b) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      const contrast = (la, lb) => {
        const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
        return (hi + 0.05) / (lo + 0.05);
      };

      /**
       * The visible window for an element: the viewport intersected with every
       * ancestor that clips. Text inside a scroll container is laid out at its
       * document position even when it sits past the container's edge, so a
       * rect taken from the range alone can point at pixels the browser never
       * painted — which samples as a uniform background and reads as
       * "invisible text" when the run is merely scrolled out of view.
       */
      const clipBounds = (el) => {
        let left = 0;
        let top = 0;
        let right = window.innerWidth;
        let bottom = window.innerHeight;
        for (let node = el.parentElement; node; node = node.parentElement) {
          const cs = getComputedStyle(node);
          if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
          const r = node.getBoundingClientRect();
          left = Math.max(left, r.left);
          top = Math.max(top, r.top);
          right = Math.min(right, r.right);
          bottom = Math.min(bottom, r.bottom);
        }
        return { left, top, right, bottom };
      };

      /** Client rects of an element's own text, clipped to the viewport. */
      const textRects = (el) => {
        const bounds = el.getBoundingClientRect();
        const clip = clipBounds(el);
        const rects = [];
        for (const node of el.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const raw of range.getClientRects()) {
            // Clip to the element: assistive-only text is often laid out at its
            // natural width inside a 1px clipping box.
            const left = Math.max(raw.left, bounds.left, clip.left);
            const top = Math.max(raw.top, bounds.top, clip.top);
            const right = Math.min(raw.right, bounds.right, clip.right);
            const bottom = Math.min(raw.bottom, bounds.bottom, clip.bottom);
            const rect = { left, top, width: right - left, height: bottom - top };
            if (rect.width < 4 || rect.height < 4) continue;
            // A run sliced by the edge of a scroll container is scrolled, not
            // illegible: the surviving strip is mostly padding, so sampling it
            // reports the badge or cell background as if it were the ink.
            if (rect.height < raw.height * 0.85 || rect.width < raw.width * 0.5) continue;
            if (rect.left < 0 || rect.top < 0) continue;
            if (left + rect.width > window.innerWidth || top + rect.height > window.innerHeight) continue;
            rects.push(rect);
          }
        }
        return rects;
      };

      /** Text that exists for assistive technology only is not "rendered". */
      const isAssistiveOnly = (el, style) => {
        if (el.closest('.visually-hidden, .sr-only')) return true;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 2 || rect.height <= 2) return true;
        return style.clipPath === 'inset(50%)' || style.clip === 'rect(0px, 0px, 0px, 0px)';
      };

      /**
       * Confirms the element really owns the pixels under its rectangle.
       * Without this, text that is overlapped by a panel — or displaced by a
       * transform between layout and paint — is measured against a background
       * it never touches, which reads as a false "invisible text" result.
       */
      const ownsRect = (el, rect) => {
        const probes = [
          [rect.left + rect.width * 0.5, rect.top + rect.height * 0.5],
          [rect.left + rect.width * 0.2, rect.top + rect.height * 0.5],
          [rect.left + rect.width * 0.8, rect.top + rect.height * 0.5]
        ];
        return probes.some(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return Boolean(hit) && (hit === el || el.contains(hit) || hit.contains(el));
        });
      };

      const results = [];
      for (const el of document.querySelectorAll('body *')) {
        const ownText = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent.trim())
          .join(' ')
          .trim();
        if (ownText.length < 2) continue;

        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        if (Number.parseFloat(style.opacity) < 0.5) continue;
        const fontSize = Number.parseFloat(style.fontSize);
        if (!Number.isFinite(fontSize) || fontSize < minSize) continue;
        if (isAssistiveOnly(el, style)) continue;

        const rects = textRects(el).filter((rect) => ownsRect(el, rect));
        if (rects.length === 0) continue;

        // Gather every pixel covered by the glyph runs.
        const pixels = [];
        const counts = new Map();
        for (const rect of rects) {
          const sx = Math.round(rect.left * scale);
          const sy = Math.round(rect.top * scale);
          const sw = Math.max(1, Math.round(rect.width * scale));
          const sh = Math.max(1, Math.round(rect.height * scale));
          const { data } = ctx.getImageData(sx, sy, sw, sh);
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            pixels.push(luminance(r, g, b));
            const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
            const bucket = counts.get(key);
            if (bucket) {
              bucket.n += 1;
              bucket.r += r;
              bucket.g += g;
              bucket.b += b;
            } else {
              counts.set(key, { n: 1, r, g, b });
            }
          }
        }
        if (pixels.length < 40) continue;

        let modal = null;
        for (const bucket of counts.values()) {
          if (!modal || bucket.n > modal.n) modal = bucket;
        }
        const background = [
          Math.round(modal.r / modal.n),
          Math.round(modal.g / modal.n),
          Math.round(modal.b / modal.n)
        ];
        const backgroundLuminance = luminance(background[0], background[1], background[2]);

        const ratios = pixels.map((l) => contrast(l, backgroundLuminance)).sort((a, b) => b - a);
        const rank = Math.min(
          ratios.length - 1,
          Math.max(minInkPixels, Math.floor(ratios.length * inkPercentile))
        );

        results.push({
          label: `${el.tagName.toLowerCase()}${
            typeof el.className === 'string' && el.className.trim()
              ? `.${el.className.trim().split(/\s+/).join('.')}`
              : ''
          }`,
          text: ownText.slice(0, 60),
          fontSize,
          bold: Number.parseInt(style.fontWeight, 10) >= 600,
          ratio: Math.round(ratios[rank] * 100) / 100,
          background,
          samples: pixels.length
        });
      }
      return results.sort((a, b) => a.ratio - b.ratio);
    },
    { dataUrl, minFontSize, inkPercentile: INK_PERCENTILE, minInkPixels: MIN_INK_PIXELS }
  );
}

/**
 * @returns entries below `threshold`.
 *
 * The default of 1.8:1 is deliberately conservative. Sampling rendered pixels
 * under-reports thin anti-aliased glyphs — no pixel of 10px text ever reaches
 * the declared colour — so this is not a WCAG grader. What it does catch, with
 * no false alarms, is text that has effectively vanished into its background:
 * the palette regressions this suite exists to prevent measure 1.0–1.3:1,
 * while legible small print measures 2:1 and up.
 */
export async function findLowContrastText(page, options = {}) {
  const { threshold = 1.8, ...rest } = options;
  const measured = await measureTextContrast(page, rest);
  return measured.filter((entry) => entry.ratio < threshold);
}
