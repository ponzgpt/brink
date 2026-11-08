import { describe, expect, it } from 'vitest';
import {
  BOLT,
  advance,
  assess,
  distanceKm,
  flightTicks,
  globalPop,
  legalOrders,
  outcomeOf,
  parseOrder,
  renderBrief,
  startMatch,
  type Match,
  type Order,
} from '../src/engine/index.js';

const run = (orders: Order[], seed = 'test'): Match => {
  let m = startMatch(BOLT, 'USA', seed);
  for (const o of orders) {
    if (m.state.over) break;
    m = advance(m, o);
  }
  while (!m.state.over) m = advance(m, { kind: 'HOLD' });
  return m;
};

const CHAIN: Order[] = [
  { kind: 'OPEN_FOOTBALL' },
  { kind: 'AUTHENTICATE' },
  { kind: 'SELECT_OPTION', option: 'MAJOR', target: 'PRK' },
  { kind: 'TURN_KEYS' },
];

describe('geometry', () => {
  it('puts Moscow to Washington near the figure the literature cites', () => {
    const km = distanceKm({ lat: 55.76, lon: 37.62 }, { lat: 38.91, lon: -77.04 });
    expect(km).toBeGreaterThan(7000);
    expect(km).toBeLessThan(8200);
    expect(
      flightTicks({ lat: 55.76, lon: 37.62 }, { lat: 38.91, lon: -77.04 }, 'ICBM'),
    ).toBeLessThanOrEqual(26);
  });
});

describe('determinism', () => {
  it('is bit-identical across 200 runs of the same seed and orders', () => {
    const first = JSON.stringify(outcomeOf(run(CHAIN).state, run(CHAIN).events));
    for (let i = 0; i < 200; i++) {
      const m = run(CHAIN);
      expect(JSON.stringify(outcomeOf(m.state, m.events))).toBe(first);
    }
  });

  it('diverges on a different seed', () => {
    // The summary can match across seeds when both runs end in holding; the event
    // stream is where the warning picture actually differs.
    const a = JSON.stringify(run([], 's1').events);
    const b = JSON.stringify(run([], 's2').events);
    expect(a).not.toBe(b);
  });

  it('does not mutate the state it was given', () => {
    const m = startMatch(BOLT, 'USA', 'immutable');
    const before = JSON.stringify(m.state);
    advance(m, { kind: 'OPEN_FOOTBALL' });
    expect(JSON.stringify(m.state)).toBe(before);
  });
});

describe('authorisation chain', () => {
  it('cannot be skipped', () => {
    let m = startMatch(BOLT, 'USA', 'skip');
    m = advance(m, { kind: 'TURN_KEYS' });
    expect(m.events.some((e) => e.type === 'invalid_order' && e.payload.power === 'USA')).toBe(
      true,
    );
    expect(m.state.powers['USA']!.release.stage).toBe('STOWED');
  });

  it('costs four minutes from stowed to weapons away', () => {
    let m = startMatch(BOLT, 'USA', 'cost');
    const t0 = m.state.tick;
    for (const o of CHAIN) m = advance(m, o);
    expect(m.state.powers['USA']!.release.stage).toBe('RELEASED');
    expect(m.state.tick - t0).toBe(4);
  });

  it('only offers the next legal step', () => {
    let m = startMatch(BOLT, 'USA', 'legal');
    expect(legalOrders(m.state, 'USA')).toEqual(['HOLD', 'OPEN_FOOTBALL']);
    m = advance(m, { kind: 'OPEN_FOOTBALL' });
    expect(legalOrders(m.state, 'USA')).toContain('AUTHENTICATE');
    expect(legalOrders(m.state, 'USA')).not.toContain('TURN_KEYS');
  });

  it('can be stood down before the keys, and not after', () => {
    let m = startMatch(BOLT, 'USA', 'standdown');
    m = advance(m, { kind: 'OPEN_FOOTBALL' });
    m = advance(m, { kind: 'STAND_DOWN' });
    expect(m.state.powers['USA']!.release.stage).toBe('STOWED');

    let n = startMatch(BOLT, 'USA', 'standdown2');
    for (const o of CHAIN) n = advance(n, o);
    n = advance(n, { kind: 'STAND_DOWN' });
    expect(n.state.powers['USA']!.release.stage).toBe('RELEASED');
    expect(
      n.events.some((e) => e.type === 'invalid_order' && e.payload.reason.includes('away')),
    ).toBe(true);
  });

  it('puts weapons in the air when the keys turn, and they cannot be recalled', () => {
    let m = startMatch(BOLT, 'USA', 'away');
    for (const o of CHAIN) m = advance(m, o);
    const away = m.events.filter((e) => e.type === 'launch' && e.payload.from === 'USA');
    expect(away.length).toBeGreaterThan(0);
    m = advance(m, { kind: 'STAND_DOWN' });
    expect(m.state.traces.filter((t) => t.from === 'USA').length).toBeGreaterThan(0);
  });
});

describe('early warning', () => {
  it('never discloses whether a report was real', () => {
    const m = run([]);
    const brief = renderBrief(m.state, 'USA');
    expect(brief).not.toMatch(/\breal\b/i);
    expect(brief).not.toMatch(/\bfalse\b/i);
    expect(brief).not.toMatch(/\btrue\b/i);
  });

  it('gets attribution wrong often enough to matter and right often enough to use', () => {
    let total = 0;
    let wrong = 0;
    for (let i = 0; i < 40; i++) {
      const m = run([], `attr-${i}`);
      for (const e of m.events) {
        if (e.type !== 'warning' || e.payload.seenBy !== 'USA') continue;
        total++;
        if (!e.payload.real || e.payload.originGuess === null) wrong++;
      }
    }
    expect(total).toBeGreaterThan(40);
    const rate = wrong / total;
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.8);
  });

  it('recommends release once impact is close, whatever the truth of it', () => {
    let m = startMatch(BOLT, 'USA', 'urge');
    let urged = false;
    while (!m.state.over) {
      if (assess(m.state, 'USA').urgesRelease) urged = true;
      m = advance(m, { kind: 'HOLD' });
    }
    expect(urged).toBe(true);
  });
});

describe('the window always closes', () => {
  it('stops accepting orders at the declared minute and always terminates', () => {
    for (const orders of [[], CHAIN, [{ kind: 'OPEN_FOOTBALL' } as Order]]) {
      for (const seed of ['a', 'b', 'c']) {
        const m = run(orders, seed);
        expect(m.state.over).toBe(true);
        expect(m.state.traces.length).toBe(0);
        // Resolution may run past the window, but never unboundedly: the longest
        // flight on this board is well under the window again.
        expect(m.state.tick).toBeLessThanOrEqual((BOLT.config.maxTicks ?? 26) * 2 + 4);
      }
    }
  });

  it('issues no orders once the window has closed', () => {
    const m = run([]);
    const late = m.events.filter(
      (e) => e.t > (BOLT.config.maxTicks ?? 26) && e.type === 'release_stage',
    );
    expect(late).toEqual([]);
  });
});

describe('the record', () => {
  it('reports holding as holding, and never names a winner', () => {
    const m = run([]);
    const o = outcomeOf(m.state, m.events);
    expect(['HELD', 'STRUCK_AND_HELD']).toContain(o.verdict);
    expect(o.youReleased).toBe(false);
    expect(JSON.stringify(o)).not.toMatch(/winner|victor|score/i);
  });

  it('counts the dead and notes when a release followed a warning of nothing', () => {
    const m = run(CHAIN);
    const o = outcomeOf(m.state, m.events);
    expect(o.youReleased).toBe(true);
    expect(o.minutesToDecide).toBe(4);
    expect(typeof o.youFiredOnFalseWarning).toBe('boolean');
    expect(o.deadM).toBeGreaterThan(0);
  });

  it('makes releasing cost more lives than holding', () => {
    const held = outcomeOf(run([]).state, run([]).events);
    const fired = outcomeOf(run(CHAIN).state, run(CHAIN).events);
    expect(fired.deadM).toBeGreaterThan(held.deadM);
    expect(globalPop(run(CHAIN).state)).toBeLessThan(globalPop(run([]).state));
  });
});

describe('order parsing', () => {
  it('round-trips the chain and falls back to HOLD on nonsense', () => {
    expect(parseOrder('OPEN_FOOTBALL')).toEqual({ kind: 'OPEN_FOOTBALL' });
    expect(parseOrder('select_option major RUS')).toEqual({
      kind: 'SELECT_OPTION',
      option: 'MAJOR',
      target: 'RUS',
    });
    expect(parseOrder('do a barrel roll')).toEqual({ kind: 'HOLD' });
  });
});

describe('the decision window is not the end of the world', () => {
  it('keeps resolving until weapons in the air have landed', () => {
    const m = run(CHAIN);
    expect(m.state.traces.length).toBe(0);
    // A release ordered inside the window must still produce a detonation.
    expect(m.events.some((e) => e.type === 'impact')).toBe(true);
    expect(m.state.tick).toBeGreaterThan(BOLT.config.maxTicks ?? 26);
  });

  it('ends with a clear board however the match went', () => {
    for (const seed of ['x', 'y', 'z']) {
      expect(run([], seed).state.traces.length).toBe(0);
      expect(run(CHAIN, seed).state.traces.length).toBe(0);
    }
  });
});
