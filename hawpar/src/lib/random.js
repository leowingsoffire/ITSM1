/**
 * Deterministic pseudo-random helpers.
 *
 * The demo engine must produce identical output for identical input so that
 * screenshots, tests and customer walkthroughs are perfectly reproducible.
 */

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

/** 32-bit FNV-1a hash. @param {string} value @returns {number} */
export function hashString(value) {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Mulberry32 PRNG — small, fast and deterministic.
 * @param {string|number} seed
 */
export function createRandom(seed) {
  let state = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** Inclusive integer between min and max. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max, decimals = 2) => Number((min + next() * (max - min)).toFixed(decimals)),
    pick: (items) => items[Math.floor(next() * items.length) % items.length],
    bool: (probabilityTrue = 0.5) => next() < probabilityTrue
  };
}
