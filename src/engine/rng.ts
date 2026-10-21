/**
 * sfc32, seeded. The generator's state lives in the game state, never in a module
 * global: a replay must be reproducible from (seed, orders) alone, and a module-level
 * PRNG would couple two games running in the same process.
 */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

export function seedRng(seed: string): RngState {
  // FNV-1a over the seed string, then four decorrelated starting words.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const next = () => {
    h ^= h << 13;
    h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h;
  };
  return { a: next(), b: next(), c: next(), d: next() };
}

/** Advances `s` in place and returns a float in [0, 1). */
export function rand(s: RngState): number {
  const t = (s.a + s.b) >>> 0;
  s.a = (s.b ^ (s.b >>> 9)) >>> 0;
  s.b = (s.c + (s.c << 3)) >>> 0;
  s.c = ((s.c << 21) | (s.c >>> 11)) >>> 0;
  s.d = (s.d + 1) >>> 0;
  const u = (t + s.d) >>> 0;
  s.c = (s.c + u) >>> 0;
  return u / 4294967296;
}

export function randInt(s: RngState, maxExclusive: number): number {
  return Math.floor(rand(s) * maxExclusive);
}

export function pick<T>(s: RngState, xs: readonly T[]): T {
  if (xs.length === 0) throw new Error('pick() on empty array');
  return xs[randInt(s, xs.length)]!;
}

export function chance(s: RngState, p: number): boolean {
  return rand(s) < p;
}

export function cloneRng(s: RngState): RngState {
  return { a: s.a, b: s.b, c: s.c, d: s.d };
}
