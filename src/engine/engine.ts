import type { BrinkEvent } from './events.js';
import { distanceToPathKm, flightTicks, interpolate, type LatLon } from './geo.js';
import { chance, pick, rand } from './rng.js';
import type {
  City,
  Confidence,
  Defcon,
  GameState,
  Order,
  Power,
  PowerId,
  Report,
  Silo,
  Sub,
  TargetKind,
  Trace,
} from './types.js';

/** DEFCON gate: what each readiness level permits. 5 is peace, 1 is general release. */
const LAUNCH_ALLOWED: Record<Defcon, TargetKind[]> = {
  5: [],
  4: [],
  3: [],
  2: ['FORCES'],
  1: ['FORCES', 'CITIES'],
};

export interface StepResult {
  state: GameState;
  events: BrinkEvent[];
}

/**
 * Advances one tick. Pure: the same (state, orders) always yields the same result,
 * because the PRNG state travels inside `state`.
 *
 * Resolution order is fixed and matters. Detection happens after movement, and
 * automatic doctrine fires after detection — that is what lets a false report
 * trigger a real launch inside the same tick.
 */
export function step(prev: GameState, orders: Record<PowerId, Order[]>): StepResult {
  const s: GameState = structuredClone(prev);
  const ev: BrinkEvent[] = [];
  const t = s.tick;
  const emit = (e: Omit<BrinkEvent, 't'>) => ev.push({ t, ...e } as BrinkEvent);

  if (s.over) throw new Error('step() called on a finished match');
  emit({ type: 'tick_begin', payload: {} });

  // 1. Player orders, in a canonical power order so replays are stable.
  for (const pid of Object.keys(s.powers).sort()) {
    const power = s.powers[pid]!;
    const list = orders[pid] ?? [];
    if (list.length > s.config.maxOrdersPerTick) {
      emit({
        type: 'invalid_order',
        payload: {
          power: pid,
          reason: `more than ${s.config.maxOrdersPerTick} orders`,
          order: list,
        },
      });
      continue;
    }
    for (const o of list) applyOrder(s, power, o, emit, false);
  }

  // 2. Sea-based launches whose spin-up completed.
  for (const pid of Object.keys(s.powers).sort()) {
    const power = s.powers[pid]!;
    for (const sub of power.subs) {
      if (sub.readyAt !== null && sub.readyAt <= t && sub.pendingTarget) {
        const { power: tp, kind } = sub.pendingTarget;
        sub.readyAt = null;
        sub.pendingTarget = null;
        sub.revealed = true;
        launch(s, power, sub, tp, kind, 'SLBM', emit, false);
      }
    }
  }

  // 3. Move traces; resolve arrivals.
  const stillFlying: Trace[] = [];
  for (const tr of s.traces) {
    if (tr.impactAt <= t) {
      impact(s, tr, emit);
      continue;
    }
    const progress = (t - tr.launchedAt) / (tr.impactAt - tr.launchedAt);
    emit({
      type: 'trace_update',
      payload: { traceId: tr.id, at: interpolate(tr.origin, tr.targetAt, progress), progress },
    });
    stillFlying.push(tr);
  }
  s.traces = stillFlying;

  // 4. Detection — on first sighting and periodically after, so the picture narrows.
  for (const tr of s.traces) {
    const age = t - tr.launchedAt;
    const delay = s.config.detectDelay[tr.kind];
    if (age < delay) continue;
    if (age !== delay && (age - delay) % 5 !== 0) continue;
    for (const pid of Object.keys(s.powers).sort()) {
      maybeReport(s, pid, tr, emit);
    }
  }

  // 5. False positives: a report indistinguishable from a real one.
  for (const pid of Object.keys(s.powers).sort()) {
    if (!chance(s.rng, s.config.pFalsePositive)) continue;
    const others = Object.keys(s.powers).filter((o) => o !== pid);
    if (others.length === 0) continue;
    const r: Report = {
      id: `r${s.nextId++}`,
      tick: t,
      seenBy: pid,
      traceId: null,
      originGuess: chance(s.rng, 0.6) ? pick(s.rng, others) : null,
      destGuess: pid,
      confidence: pick(s.rng, ['LOW', 'MEDIUM'] as const),
      kind: chance(s.rng, 0.7) ? 'ICBM' : 'SLBM',
      etaTicks: 8 + Math.floor(rand(s.rng) * 18),
      real: false,
    };
    s.reports.push(r);
    emit({ type: 'detection_report', payload: reportPayload(r) });
  }

  // 6. Standing doctrine. This is where an accident becomes a war.
  for (const pid of Object.keys(s.powers).sort()) {
    const power = s.powers[pid]!;
    if (power.doctrine !== 'LAUNCH_ON_WARNING') continue;
    const inbound = s.reports.filter(
      (r) => r.tick === t && r.seenBy === pid && r.destGuess === pid,
    );
    if (inbound.length === 0) continue;
    const target = inbound.find((r) => r.originGuess !== null)?.originGuess;
    const candidates = Object.keys(s.powers).filter((o) => o !== pid);
    const against = target ?? (candidates.length ? pick(s.rng, candidates) : null);
    if (!against) continue;
    const unit = fastestReady(power);
    if (!unit) continue;
    // The doctrine overrides the readiness gate: that is the point of pre-commitment.
    power.autoLaunches++;
    if ('readyAt' in unit) {
      beginSubLaunch(s, power, unit as Sub, against, 'CITIES', emit, true);
    } else {
      launch(s, power, unit as Silo, against, 'CITIES', 'ICBM', emit, true);
    }
  }

  emit({ type: 'tick_end', payload: { traces: s.traces.length } });
  s.tick = t + 1;

  // 7. Termination.
  const armed = Object.values(s.powers).some(
    (p) => p.silos.some((x) => x.alive && x.warheads > 0) || p.subs.some((x) => x.warheads > 0),
  );
  const reason =
    s.tick > s.config.maxTicks
      ? 'tick_limit'
      : !armed && s.traces.length === 0
        ? 'arsenals_empty'
        : null;
  if (reason) {
    s.over = true;
    const survivors: Record<PowerId, number> = {};
    for (const pid of Object.keys(s.powers)) survivors[pid] = popOf(s, pid);
    ev.push({ t: s.tick, type: 'match_end', payload: { reason, survivors } });
  }

  return { state: s, events: ev };
}

function applyOrder(
  s: GameState,
  power: Power,
  o: Order,
  emit: (e: Omit<BrinkEvent, 't'>) => void,
  automatic: boolean,
): void {
  const bad = (reason: string) =>
    emit({ type: 'invalid_order', payload: { power: power.id, reason, order: o } });

  switch (o.kind) {
    case 'HOLD':
      return;

    case 'SET_DEFCON': {
      if (o.level < 1 || o.level > 5) return bad('defcon out of range');
      if (Math.abs(o.level - power.defcon) !== 1) return bad('readiness moves one level per tick');
      const from = power.defcon;
      power.defcon = o.level;
      emit({ type: 'defcon_change', payload: { power: power.id, from, to: o.level } });
      return;
    }

    case 'SET_DOCTRINE': {
      const from = power.doctrine;
      if (from === o.doctrine) return;
      power.doctrine = o.doctrine;
      emit({ type: 'doctrine_change', payload: { power: power.id, from, to: o.doctrine } });
      return;
    }

    case 'LAUNCH': {
      if (!s.powers[o.targetPower]) return bad(`unknown target power ${o.targetPower}`);
      if (o.targetPower === power.id) return bad('cannot target self');
      if (!automatic && !LAUNCH_ALLOWED[power.defcon].includes(o.targetKind))
        return bad(`DEFCON ${power.defcon} does not release ${o.targetKind}`);
      const silo = power.silos.find((x) => x.id === o.unit);
      const sub = power.subs.find((x) => x.id === o.unit);
      if (silo) {
        if (!silo.alive) return bad(`${o.unit} destroyed`);
        if (silo.warheads <= 0) return bad(`${o.unit} empty`);
        launch(s, power, silo, o.targetPower, o.targetKind, 'ICBM', emit, automatic);
        return;
      }
      if (sub) {
        if (sub.warheads <= 0) return bad(`${o.unit} empty`);
        if (sub.readyAt !== null) return bad(`${o.unit} already spinning up`);
        beginSubLaunch(s, power, sub, o.targetPower, o.targetKind, emit, automatic);
        return;
      }
      return bad(`unknown unit ${o.unit}`);
    }
  }
}

function beginSubLaunch(
  s: GameState,
  power: Power,
  sub: Sub,
  targetPower: PowerId,
  targetKind: TargetKind,
  emit: (e: Omit<BrinkEvent, 't'>) => void,
  _automatic: boolean,
): void {
  sub.readyAt = s.tick + s.config.subSpinUpTicks;
  sub.pendingTarget = { power: targetPower, kind: targetKind };
  emit({ type: 'sub_spinup', payload: { power: power.id, unit: sub.id, readyAt: sub.readyAt } });
}

function launch(
  s: GameState,
  power: Power,
  unit: Silo | Sub,
  targetPower: PowerId,
  targetKind: TargetKind,
  kind: 'ICBM' | 'SLBM',
  emit: (e: Omit<BrinkEvent, 't'>) => void,
  automatic: boolean,
): void {
  const aim = resolveTarget(s, targetPower, targetKind);
  if (!aim) {
    emit({
      type: 'invalid_order',
      payload: {
        power: power.id,
        reason: `no ${targetKind} target left in ${targetPower}`,
        order: null,
      },
    });
    return;
  }
  const warheads = unit.warheads;
  unit.warheads = 0;
  const impactAt = s.tick + flightTicks(unit.at, aim.at, kind);
  const tr: Trace = {
    id: `t${s.nextId++}`,
    from: power.id,
    origin: { ...unit.at },
    originUnit: unit.id,
    targetPower,
    targetKind,
    targetId: aim.id,
    targetAt: { ...aim.at },
    warheads,
    kind,
    launchedAt: s.tick,
    impactAt,
  };
  s.traces.push(tr);
  if (s.firstLauncher === null) {
    s.firstLauncher = power.id;
    s.firstLaunchTick = s.tick;
  }
  emit({
    type: 'launch',
    payload: {
      traceId: tr.id,
      from: tr.from,
      unit: unit.id,
      origin: tr.origin,
      targetPower,
      targetKind,
      targetId: tr.targetId,
      targetAt: tr.targetAt,
      warheads,
      kind,
      impactAt,
      automatic,
    },
  });
}

function resolveTarget(
  s: GameState,
  targetPower: PowerId,
  kind: TargetKind,
): { id: string; at: LatLon } | null {
  if (kind === 'CITIES') {
    const c = s.cities
      .filter((x) => x.power === targetPower && x.popRemaining > 0)
      .sort((a, b) => b.popRemaining - a.popRemaining)[0];
    return c ? { id: c.id, at: c.at } : null;
  }
  const silo = s.powers[targetPower]?.silos
    .filter((x) => x.alive)
    .sort((a, b) => b.warheads - a.warheads)[0];
  return silo ? { id: silo.id, at: silo.at } : null;
}

function impact(s: GameState, tr: Trace, emit: (e: Omit<BrinkEvent, 't'>) => void): void {
  let killed = 0;
  let destroyed: string | null = null;
  let budget = tr.warheads;

  if (tr.targetKind === 'CITIES') {
    // Warheads spill onto the next largest surviving city rather than being wasted.
    const targets = s.cities
      .filter((c) => c.power === tr.targetPower && c.popRemaining > 0)
      .sort((a, b) => b.popRemaining - a.popRemaining);
    for (const c of targets) {
      if (budget <= 0) break;
      const capacity = Math.ceil(c.popRemaining / s.config.lethalityPerWarhead);
      const used = Math.min(budget, capacity);
      const loss = Math.min(c.popRemaining, used * s.config.lethalityPerWarhead);
      c.popRemaining = Math.max(0, c.popRemaining - loss);
      killed += loss;
      budget -= used;
    }
  } else {
    const silos = s.powers[tr.targetPower]?.silos.filter((x) => x.alive) ?? [];
    for (const silo of silos.sort((a, b) => b.warheads - a.warheads)) {
      if (budget < s.config.warheadsPerSiloKill) break;
      silo.alive = false;
      silo.warheads = 0;
      destroyed = destroyed ? `${destroyed},${silo.id}` : silo.id;
      budget -= s.config.warheadsPerSiloKill;
    }
  }

  emit({
    type: 'impact',
    payload: {
      traceId: tr.id,
      targetPower: tr.targetPower,
      targetKind: tr.targetKind,
      targetId: tr.targetId,
      warheads: tr.warheads,
      popKilled: Math.round(killed * 100) / 100,
      unitDestroyed: destroyed,
    },
  });
}

function maybeReport(
  s: GameState,
  pid: PowerId,
  tr: Trace,
  emit: (e: Omit<BrinkEvent, 't'>) => void,
): void {
  if (pid === tr.from) return; // you know what you launched
  const isTarget = pid === tr.targetPower;
  let p = s.config.pDetect[tr.kind];
  if (!isTarget) {
    // A third party only sees it if the trajectory crosses near its territory.
    const own = [
      ...s.cities.filter((c) => c.power === pid).map((c) => c.at),
      ...(s.powers[pid]?.silos.map((x) => x.at) ?? []),
    ];
    const near = own.some(
      (at) => distanceToPathKm(at, tr.origin, tr.targetAt) < s.config.overflightCorridorKm,
    );
    if (!near) return;
    p *= 0.7;
  }
  if (!chance(s.rng, p)) return;

  const progress = (s.tick - tr.launchedAt) / (tr.impactAt - tr.launchedAt);
  const pCorrect = Math.min(0.98, 0.45 + 0.5 * progress);
  const others = Object.keys(s.powers).filter((o) => o !== tr.from);
  const destGuess = chance(s.rng, pCorrect)
    ? tr.targetPower
    : others.length
      ? pick(s.rng, others)
      : tr.targetPower;
  const confidence: Confidence = progress < 0.34 ? 'LOW' : progress < 0.67 ? 'MEDIUM' : 'HIGH';

  const r: Report = {
    id: `r${s.nextId++}`,
    tick: s.tick,
    seenBy: pid,
    traceId: tr.id,
    originGuess: chance(s.rng, 0.55 + 0.4 * progress) ? tr.from : null,
    destGuess,
    confidence,
    kind: tr.kind,
    etaTicks: Math.max(0, tr.impactAt - s.tick),
    real: true,
  };
  s.reports.push(r);
  emit({ type: 'detection_report', payload: reportPayload(r) });
}

function reportPayload(r: Report) {
  return {
    reportId: r.id,
    seenBy: r.seenBy,
    destGuess: r.destGuess,
    originGuess: r.originGuess,
    confidence: r.confidence,
    kind: r.kind,
    etaTicks: r.etaTicks,
    real: r.real,
  };
}

function fastestReady(power: Power): Silo | Sub | null {
  const silo = power.silos.find((x) => x.alive && x.warheads > 0);
  if (silo) return silo;
  return power.subs.find((x) => x.warheads > 0 && x.readyAt === null) ?? null;
}

export function popOf(s: GameState, pid: PowerId): number {
  return s.cities.filter((c) => c.power === pid).reduce((a, c) => a + c.popRemaining, 0);
}

export function globalPop(s: GameState): number {
  return s.cities.reduce((a, c) => a + c.popRemaining, 0);
}

export function initialPopOf(cities: City[], pid: PowerId): number {
  return cities.filter((c) => c.power === pid).reduce((a, c) => a + c.pop, 0);
}
