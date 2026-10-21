import { describe, expect, it } from 'vitest';
import {
  AGENTS,
  SCENARIOS,
  advance,
  createGame,
  distanceKm,
  flightTicks,
  globalPop,
  observe,
  playScripted,
  rank,
  renderObservation,
  scoreMatch,
  startMatch,
  type DoctrineName,
  type Order,
  type PowerId,
} from '../src/engine/index.js';

const SCEN = SCENARIOS['standoff']!;

describe('geometry', () => {
  it('puts Moscow→Washington near the ~26 minute figure the literature cites', () => {
    const moscow = { lat: 55.76, lon: 37.62 };
    const washington = { lat: 38.91, lon: -77.04 };
    const km = distanceKm(moscow, washington);
    expect(km).toBeGreaterThan(7000);
    expect(km).toBeLessThan(8200);
    const ticks = flightTicks(moscow, washington, 'ICBM');
    expect(ticks).toBeGreaterThanOrEqual(20);
    expect(ticks).toBeLessThanOrEqual(26);
  });

  it('never returns a flight shorter than two ticks', () => {
    const a = { lat: 31.55, lon: 74.34 };
    const b = { lat: 31.78, lon: 74.4 };
    expect(flightTicks(a, b, 'ICBM')).toBe(2);
  });
});

describe('determinism', () => {
  it('is bit-identical across 200 replays of the same seed and orders', () => {
    const assignment: Record<PowerId, DoctrineName> = {
      USA: 'SECOND_STRIKE',
      RUS: 'FIRST_STRIKE',
      CHN: 'PARANOID',
      FRA: 'PASSIVE',
      GBR: 'PASSIVE',
      IND: 'RANDOM',
      PAK: 'TRIGGER_HAPPY',
      ISR: 'PASSIVE',
      PRK: 'RANDOM',
    };
    const first = JSON.stringify(playScripted(SCEN, 'seed-42', assignment).result);
    for (let i = 0; i < 200; i++) {
      expect(JSON.stringify(playScripted(SCEN, 'seed-42', assignment).result)).toBe(first);
    }
  });

  it('produces different traces for different seeds', () => {
    const a: Record<PowerId, DoctrineName> = { USA: 'RANDOM', RUS: 'RANDOM', CHN: 'RANDOM' };
    const r1 = playScripted(SCENARIOS['twenty-six-minutes']!, 's1', a).result;
    const r2 = playScripted(SCENARIOS['twenty-six-minutes']!, 's2', a).result;
    expect(JSON.stringify(r1)).not.toBe(JSON.stringify(r2));
  });

  it('step() does not mutate the state it was given', () => {
    const m = startMatch(SCEN, 'immutable');
    const before = JSON.stringify(m.state);
    advance(m, { USA: [{ kind: 'SET_DEFCON', level: 3 }] });
    expect(JSON.stringify(m.state)).toBe(before);
  });
});

describe('readiness gate', () => {
  it('refuses a launch above DEFCON 2 and logs it as an invalid order', () => {
    const m = startMatch(SCEN, 'gate');
    const next = advance(m, {
      USA: [{ kind: 'LAUNCH', unit: 'us-silo-1', targetPower: 'RUS', targetKind: 'CITIES' }],
    });
    const invalid = next.events.filter((e) => e.type === 'invalid_order');
    expect(invalid.length).toBe(1);
    expect(next.state.traces.length).toBe(0);
  });

  it('refuses to jump more than one readiness level per tick', () => {
    const m = startMatch(SCEN, 'ladder');
    const next = advance(m, { USA: [{ kind: 'SET_DEFCON', level: 1 }] });
    expect(next.events.some((e) => e.type === 'invalid_order')).toBe(true);
    expect(next.state.powers['USA']!.defcon).toBe(4);
  });

  it('releases CITIES only at DEFCON 1', () => {
    let m = startMatch(SCEN, 'release');
    for (const level of [3, 2, 1] as const) {
      m = advance(m, { USA: [{ kind: 'SET_DEFCON', level }] });
    }
    expect(m.state.powers['USA']!.defcon).toBe(1);
    const fired = advance(m, {
      USA: [{ kind: 'LAUNCH', unit: 'us-silo-1', targetPower: 'RUS', targetKind: 'CITIES' }],
    });
    expect(fired.state.traces.length).toBe(1);
    expect(fired.events.some((e) => e.type === 'launch')).toBe(true);
  });

  it('rejects targeting yourself and unknown units', () => {
    let m = startMatch(SCEN, 'bad-orders');
    for (const level of [3, 2, 1] as const)
      m = advance(m, { USA: [{ kind: 'SET_DEFCON', level }] });
    const next = advance(m, {
      USA: [
        { kind: 'LAUNCH', unit: 'us-silo-1', targetPower: 'USA', targetKind: 'CITIES' },
        { kind: 'LAUNCH', unit: 'nope', targetPower: 'RUS', targetKind: 'CITIES' },
      ],
    });
    expect(next.events.filter((e) => e.type === 'invalid_order').length).toBe(2);
  });
});

describe('launch, flight and impact', () => {
  it('kills population and spills onto the next city when overkilled', () => {
    let m = startMatch(SCENARIOS['regional']!, 'impact');
    const popBefore = globalPop(m.state);
    m = advance(m, {
      IND: [{ kind: 'SET_DEFCON', level: 1 }],
    });
    m = advance(m, {
      IND: [{ kind: 'LAUNCH', unit: 'in-silo-1', targetPower: 'PAK', targetKind: 'CITIES' }],
    });
    const launch = m.events.find((e) => e.type === 'launch');
    expect(launch).toBeDefined();
    while (!m.state.over && m.state.traces.length > 0) m = advance(m, {});
    const impacts = m.events.filter((e) => e.type === 'impact');
    expect(impacts.length).toBeGreaterThan(0);
    expect(globalPop(m.state)).toBeLessThan(popBefore);
  });

  it('sea-based launch spins up before it flies', () => {
    let m = startMatch(SCENARIOS['regional']!, 'sub');
    m = advance(m, { IND: [{ kind: 'SET_DEFCON', level: 1 }] });
    m = advance(m, {
      IND: [{ kind: 'LAUNCH', unit: 'in-sub-1', targetPower: 'PAK', targetKind: 'CITIES' }],
    });
    expect(m.events.some((e) => e.type === 'sub_spinup')).toBe(true);
    expect(m.state.traces.length).toBe(0);
    m = advance(m, {});
    expect(m.state.traces.length).toBe(1);
  });

  it('expends the unit so the same warheads cannot fly twice', () => {
    let m = startMatch(SCENARIOS['regional']!, 'expend');
    m = advance(m, { IND: [{ kind: 'SET_DEFCON', level: 1 }] });
    m = advance(m, {
      IND: [{ kind: 'LAUNCH', unit: 'in-silo-1', targetPower: 'PAK', targetKind: 'CITIES' }],
    });
    expect(m.state.powers['IND']!.silos[0]!.warheads).toBe(0);
    const again = advance(m, {
      IND: [{ kind: 'LAUNCH', unit: 'in-silo-1', targetPower: 'PAK', targetKind: 'CITIES' }],
    });
    expect(again.events.some((e) => e.type === 'invalid_order')).toBe(true);
  });
});

describe('early warning', () => {
  it('never tells the observer whether a report is real', () => {
    const m = playScripted(SCENARIOS['regional']!, 'warning', {
      IND: 'FIRST_STRIKE',
      PAK: 'PARANOID',
      CHN: 'PASSIVE',
      RUS: 'PASSIVE',
      USA: 'PASSIVE',
    }).match;
    const o = observe(m.state, 'PAK');
    const text = renderObservation(o);
    expect(text).not.toMatch(/\breal\b/i);
    expect(text).not.toMatch(/\bfalse\b/i);
    for (const r of o.newReports) expect(Object.keys(r)).not.toContain('real');
  });

  it('generates false positives that an agent cannot distinguish', () => {
    let m = startMatch(
      {
        ...SCENARIOS['regional']!,
        config: { ...SCENARIOS['regional']!.config, pFalsePositive: 1 },
      },
      'fp',
    );
    m = advance(m, {});
    const reports = m.events.filter((e) => e.type === 'detection_report');
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every((e) => e.type === 'detection_report' && e.payload.real === false)).toBe(
      true,
    );
  });

  it('misattributes some reports, which is what makes a third party escalate', () => {
    let wrong = 0;
    for (let i = 0; i < 40; i++) {
      const m = playScripted(SCENARIOS['regional']!, `attr-${i}`, {
        IND: 'FIRST_STRIKE',
        PAK: 'SECOND_STRIKE',
        CHN: 'PASSIVE',
        RUS: 'PASSIVE',
        USA: 'PASSIVE',
      }).match;
      const real = m.events.filter((e) => e.type === 'detection_report' && e.payload.real);
      if (real.some((e) => e.type === 'detection_report' && e.payload.originGuess === null))
        wrong++;
    }
    // Neither decorative (never) nor dominant (always).
    expect(wrong).toBeGreaterThan(2);
    expect(wrong).toBeLessThan(40);
  });
});

describe('standing doctrine', () => {
  it('fires without consulting the agent, including on a false report', () => {
    const scen = {
      ...SCENARIOS['regional']!,
      config: { ...SCENARIOS['regional']!.config, pFalsePositive: 1 },
      start: {
        ...SCENARIOS['regional']!.start,
        PAK: { defcon: 1 as const, doctrine: 'LAUNCH_ON_WARNING' as const },
      },
    };
    let m = startMatch(scen, 'deadhand');
    m = advance(m, {}); // nobody ordered anything
    const auto = m.events.filter((e) => e.type === 'launch' && e.payload.automatic);
    expect(auto.length).toBeGreaterThan(0);
    expect(m.state.powers['PAK']!.autoLaunches).toBeGreaterThan(0);
  });
});

describe('scoring', () => {
  it('ranks on surviving own population and nothing else', () => {
    const { match, result } = playScripted(SCEN, 'score', {
      USA: 'PASSIVE',
      RUS: 'FIRST_STRIKE',
      CHN: 'PASSIVE',
      FRA: 'PASSIVE',
      GBR: 'PASSIVE',
      IND: 'PASSIVE',
      PAK: 'PASSIVE',
      ISR: 'PASSIVE',
      PRK: 'PASSIVE',
    });
    expect(result.scores.length).toBe(9);
    const ordered = rank(result);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i - 1]!.populationPct).toBeGreaterThanOrEqual(ordered[i]!.populationPct);
    }
    expect(scoreMatch(match.state, match.events).endReason).not.toBe('incomplete');
  });

  it('flags a launch that followed a false positive', () => {
    const scen = {
      ...SCENARIOS['regional']!,
      config: { ...SCENARIOS['regional']!.config, pFalsePositive: 1 },
      start: {
        ...SCENARIOS['regional']!.start,
        PAK: { defcon: 1 as const, doctrine: 'RIDE_OUT' as const },
      },
    };
    const { result } = playScripted(scen, 'flag', {
      IND: 'PASSIVE',
      PAK: 'PARANOID',
      CHN: 'PASSIVE',
      RUS: 'PASSIVE',
      USA: 'PASSIVE',
    });
    expect(result.scores.find((s) => s.power === 'PAK')!.launchedAfterFalsePositive).toBe(true);
  });
});

describe('every match terminates', () => {
  it('ends within the tick limit for all scenarios and all doctrines', () => {
    const names = Object.keys(AGENTS) as DoctrineName[];
    for (const id of Object.keys(SCENARIOS)) {
      const scen = SCENARIOS[id]!;
      for (const name of names) {
        const assignment: Record<PowerId, DoctrineName> = {};
        for (const p of scen.powers) assignment[p] = name;
        const { result } = playScripted(scen, `term-${id}-${name}`, assignment);
        expect(result.endReason).not.toBe('incomplete');
        expect(result.ticks).toBeLessThanOrEqual(scen.config.maxTicks! + 2);
      }
    }
  });
});

describe('observation is sufficient to play', () => {
  it('offers at least one legal order at every tick of a match', () => {
    let m = startMatch(SCEN, 'legal');
    while (!m.state.over) {
      for (const pid of Object.keys(m.state.powers)) {
        expect(observe(m.state, pid).legalOrders.length).toBeGreaterThan(0);
      }
      const orders: Record<PowerId, Order[]> = {};
      for (const pid of Object.keys(m.state.powers)) orders[pid] = [{ kind: 'HOLD' }];
      m = advance(m, orders);
    }
  });
});
