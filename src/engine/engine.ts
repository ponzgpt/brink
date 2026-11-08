import type { BrinkEvent } from './events.js';
import { distanceToPathKm, flightTicks, interpolate, type LatLon } from './geo.js';
import { chance, pick } from './rng.js';
import type {
  Confidence,
  GameState,
  Order,
  Power,
  PowerId,
  Release,
  ReleaseStage,
  Report,
  StrikeOption,
  Trace,
  Unit,
} from './types.js';

export interface StepResult {
  state: GameState;
  events: BrinkEvent[];
}

/** One step forward in the chain. Nothing may be skipped and each costs a minute. */
const NEXT: Record<ReleaseStage, ReleaseStage | null> = {
  STOWED: 'OPEN',
  OPEN: 'AUTHENTICATED',
  AUTHENTICATED: 'SELECTED',
  SELECTED: 'RELEASED',
  RELEASED: null,
};

/**
 * Advances one minute. Pure: the PRNG state travels inside `state`, so the same
 * (seed, orders) always produces the same match and a log replays exactly.
 *
 * Order matters. Warnings are issued after movement and before the opposing
 * machinery reacts, which is what lets a bad picture drive a real release inside
 * the same minute.
 */
export function step(prev: GameState, orders: Record<PowerId, Order>): StepResult {
  const s: GameState = structuredClone(prev);
  const ev: BrinkEvent[] = [];
  const t = s.tick;
  const emit = (e: Omit<BrinkEvent, 't'>) => ev.push({ t, ...e } as BrinkEvent);

  if (s.over) throw new Error('step() called on a finished match');
  emit({ type: 'tick', payload: {} });

  // Once the window has closed nobody gives orders any more — including the
  // machinery. What is left is arithmetic on weapons already in the air.
  if (t <= s.config.maxTicks) {
    for (const pid of Object.keys(s.powers).sort()) {
      const order = orders[pid];
      if (order) applyOrder(s, s.powers[pid]!, order, emit);
    }
  }

  // Move tracks; resolve arrivals.
  const flying: Trace[] = [];
  for (const tr of s.traces) {
    if (tr.impactAt <= t) impact(s, tr, emit);
    else flying.push(tr);
  }
  s.traces = flying;

  // Warnings: first sighting, then every third minute, so the picture visibly moves.
  for (const tr of s.traces) {
    const age = t - tr.launchedAt;
    const delay = s.config.detectDelay[tr.kind];
    if (age < delay || (age !== delay && (age - delay) % 3 !== 0)) continue;
    for (const pid of Object.keys(s.powers).sort()) maybeWarn(s, pid, tr, emit);
  }

  // A report of nothing, indistinguishable in every field the player can see.
  for (const pid of Object.keys(s.powers).sort()) {
    if (!s.powers[pid]!.belligerent || !chance(s.rng, s.config.pFalsePositive)) continue;
    const others = Object.keys(s.powers).filter((o) => o !== pid && s.powers[o]!.belligerent);
    if (!others.length) continue;
    file(s, emit, {
      seenBy: pid,
      traceId: null,
      originGuess: chance(s.rng, 0.6) ? pick(s.rng, others) : null,
      destGuess: pid,
      confidence: 'LOW',
      etaTicks: 6 + Math.floor(chance(s.rng, 0.5) ? 4 : 9),
      real: false,
    });
  }

  emit({ type: 'tick', payload: {} });
  s.tick = t + 1;

  // The window is the window for *decisions*. Weapons already in the air still have
  // to land, so the match is not over until the board is clear: releasing at minute
  // twenty-five must still have a consequence the player is shown.
  const armed = Object.values(s.powers).some((p) => p.units.some((u) => u.alive && u.warheads > 0));
  const clear = s.traces.length === 0;
  const reason =
    clear && s.tick > s.config.maxTicks ? 'window_closed' : clear && !armed ? 'spent' : null;
  if (reason) {
    s.over = true;
    ev.push({ t: s.tick, type: 'match_end', payload: { reason } });
  }
  return { state: s, events: ev };
}

function applyOrder(
  s: GameState,
  power: Power,
  o: Order,
  emit: (e: Omit<BrinkEvent, 't'>) => void,
): void {
  const bad = (reason: string) =>
    emit({ type: 'invalid_order', payload: { power: power.id, reason } });
  const r = power.release;
  const advance = (to: ReleaseStage, patch: Partial<Release> = {}) => {
    const from = r.stage;
    Object.assign(r, { stage: to }, patch);
    emit({
      type: 'release_stage',
      payload: { power: power.id, from, to, option: r.option, target: r.target },
    });
  };

  switch (o.kind) {
    case 'HOLD':
      return;

    case 'STAND_DOWN':
      if (r.stage === 'STOWED') return;
      if (r.stage === 'RELEASED') return bad('weapons are already away');
      r.option = null;
      r.target = null;
      advance('STOWED');
      return;

    case 'OPEN_FOOTBALL':
      if (r.stage !== 'STOWED') return bad('already open');
      return advance('OPEN');

    case 'AUTHENTICATE':
      if (r.stage !== 'OPEN') return bad('open the case first');
      return advance('AUTHENTICATED');

    case 'SELECT_OPTION': {
      if (r.stage !== 'AUTHENTICATED' && r.stage !== 'SELECTED') return bad('authenticate first');
      const target = s.powers[o.target];
      if (!target || o.target === power.id) return bad('no such target');
      return advance('SELECTED', { option: o.option, target: o.target });
    }

    case 'TURN_KEYS': {
      if (r.stage !== 'SELECTED') return bad('no option selected');
      if (NEXT[r.stage] === null) return bad('weapons are already away');
      advance('RELEASED');
      release(s, power, r.option!, r.target!, emit);
      return;
    }
  }
}

/** LIMITED spends one unit against forces. MAJOR empties the arsenal onto cities. */
function release(
  s: GameState,
  power: Power,
  option: StrikeOption,
  target: PowerId,
  emit: (e: Omit<BrinkEvent, 't'>) => void,
): void {
  const ready = power.units.filter((u) => u.alive && u.warheads > 0);
  const chosen = option === 'LIMITED' ? ready.slice(0, 1) : ready;
  for (const u of chosen)
    launch(s, power, u, target, option === 'LIMITED' ? 'FORCES' : 'CITIES', emit);
}

function launch(
  s: GameState,
  power: Power,
  unit: Unit,
  targetPower: PowerId,
  targetKind: 'CITIES' | 'FORCES',
  emit: (e: Omit<BrinkEvent, 't'>) => void,
): void {
  const aim = resolveTarget(s, targetPower, targetKind);
  if (!aim) return;
  const warheads = unit.warheads;
  unit.warheads = 0;
  unit.revealed = true;
  const kind = unit.kind === 'SUB' ? 'SLBM' : 'ICBM';
  const impactAt = s.tick + flightTicks(unit.at, aim.at, kind);
  const tr: Trace = {
    id: `t${s.nextId++}`,
    from: power.id,
    origin: { ...unit.at },
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
  s.firstLauncher ??= power.id;
  emit({
    type: 'launch',
    payload: {
      traceId: tr.id,
      from: power.id,
      unit: unit.id,
      origin: tr.origin,
      targetPower,
      targetKind,
      targetId: tr.targetId,
      targetAt: tr.targetAt,
      warheads,
      kind,
      impactAt,
    },
  });
}

function resolveTarget(
  s: GameState,
  targetPower: PowerId,
  kind: 'CITIES' | 'FORCES',
): { id: string; at: LatLon } | null {
  if (kind === 'CITIES') {
    const c = s.cities
      .filter((x) => x.power === targetPower && x.popRemaining > 0)
      .sort((a, b) => b.popRemaining - a.popRemaining)[0];
    return c ? { id: c.id, at: c.at } : null;
  }
  const u = s.powers[targetPower]?.units
    .filter((x) => x.alive && (x.kind === 'SILO' || x.revealed))
    .sort((a, b) => b.warheads - a.warheads)[0];
  return u ? { id: u.id, at: u.at } : null;
}

function impact(s: GameState, tr: Trace, emit: (e: Omit<BrinkEvent, 't'>) => void): void {
  let killed = 0;
  let destroyed: string | null = null;
  let budget = tr.warheads;

  if (tr.targetKind === 'CITIES') {
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
    const hunted = (s.powers[tr.targetPower]?.units ?? [])
      .filter((u) => u.alive && (u.kind === 'SILO' || u.revealed))
      .sort((a, b) => b.warheads - a.warheads);
    for (const u of hunted) {
      if (budget < s.config.warheadsPerUnitKill) break;
      u.alive = false;
      u.warheads = 0;
      destroyed = destroyed ? `${destroyed},${u.id}` : u.id;
      budget -= s.config.warheadsPerUnitKill;
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

function maybeWarn(
  s: GameState,
  pid: PowerId,
  tr: Trace,
  emit: (e: Omit<BrinkEvent, 't'>) => void,
): void {
  if (pid === tr.from || !s.powers[pid]!.belligerent) return;
  const isTarget = pid === tr.targetPower;
  let p = s.config.pDetect[tr.kind];
  if (!isTarget) {
    const own = [
      ...s.cities.filter((c) => c.power === pid).map((c) => c.at),
      ...s.powers[pid]!.units.filter((u) => u.alive).map((u) => u.at),
    ];
    if (
      !own.some(
        (at) => distanceToPathKm(at, tr.origin, tr.targetAt) < s.config.overflightCorridorKm,
      )
    )
      return;
    p *= 0.7;
  }
  if (!chance(s.rng, p)) return;

  const progress = (s.tick - tr.launchedAt) / Math.max(1, tr.impactAt - tr.launchedAt);
  const others = Object.keys(s.powers).filter((o) => o !== tr.from && s.powers[o]!.belligerent);
  const destGuess = chance(s.rng, Math.min(0.98, 0.5 + 0.48 * progress))
    ? tr.targetPower
    : others.length
      ? pick(s.rng, others)
      : tr.targetPower;
  const confidence: Confidence = progress < 0.34 ? 'LOW' : progress < 0.67 ? 'MEDIUM' : 'HIGH';

  file(s, emit, {
    seenBy: pid,
    traceId: tr.id,
    originGuess: chance(s.rng, 0.5 + 0.45 * progress) ? tr.from : null,
    destGuess,
    confidence,
    etaTicks: Math.max(0, tr.impactAt - s.tick),
    real: true,
  });
}

function file(
  s: GameState,
  emit: (e: Omit<BrinkEvent, 't'>) => void,
  r: Omit<Report, 'id' | 'tick'>,
): void {
  const report: Report = { id: `r${s.nextId++}`, tick: s.tick, ...r };
  s.reports.push(report);
  emit({
    type: 'warning',
    payload: {
      reportId: report.id,
      seenBy: report.seenBy,
      destGuess: report.destGuess,
      originGuess: report.originGuess,
      confidence: report.confidence,
      etaTicks: report.etaTicks,
      real: report.real,
    },
  });
}

export function popOf(s: GameState, pid: PowerId): number {
  return s.cities.filter((c) => c.power === pid).reduce((a, c) => a + c.popRemaining, 0);
}

export function globalPop(s: GameState): number {
  return s.cities.reduce((a, c) => a + c.popRemaining, 0);
}

export { interpolate };
