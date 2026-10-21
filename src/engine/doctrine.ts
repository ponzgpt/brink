/**
 * Scripted opponents. Declarative on purpose: a new personality is a new entry
 * here, not a change to the engine, so anyone can add one without touching rules.
 */
import { legalOrders } from './observation.js';
import { chance, pick } from './rng.js';
import type { GameState, Order, PowerId } from './types.js';

export type DoctrineName =
  'PASSIVE' | 'RANDOM' | 'SECOND_STRIKE' | 'FIRST_STRIKE' | 'PARANOID' | 'TRIGGER_HAPPY';

export interface ScriptedAgent {
  name: DoctrineName;
  describe: string;
  decide(s: GameState, you: PowerId): Order[];
}

const lower = (s: GameState, you: PowerId): Order[] => {
  const d = s.powers[you]!.defcon;
  return d > 1 ? [{ kind: 'SET_DEFCON', level: (d - 1) as 1 | 2 | 3 | 4 }] : [];
};

const readyUnit = (s: GameState, you: PowerId): string | null => {
  const p = s.powers[you]!;
  return (
    p.silos.find((x) => x.alive && x.warheads > 0)?.id ??
    p.subs.find((x) => x.warheads > 0 && x.readyAt === null)?.id ??
    null
  );
};

const biggestThreat = (s: GameState, you: PowerId): PowerId | null => {
  const others = Object.entries(s.powers).filter(([id]) => id !== you);
  if (others.length === 0) return null;
  return others.sort(
    (a, b) =>
      b[1].silos.filter((x) => x.alive).reduce((n, x) => n + x.warheads, 0) -
      a[1].silos.filter((x) => x.alive).reduce((n, x) => n + x.warheads, 0),
  )[0]![0];
};

const newReports = (s: GameState, you: PowerId) =>
  s.reports.filter((r) => r.seenBy === you && r.tick === s.tick - 1 && r.destGuess === you);

export const AGENTS: Record<DoctrineName, ScriptedAgent> = {
  PASSIVE: {
    name: 'PASSIVE',
    describe: 'Never launches. Holds readiness. The floor any strategy must beat.',
    decide: () => [{ kind: 'HOLD' }],
  },

  RANDOM: {
    name: 'RANDOM',
    describe: 'Picks uniformly from the legal order set. The noise baseline.',
    decide: (s, you) => {
      const legal = legalOrders(s, you);
      const raw = pick(s.rng, legal);
      return [parseOrder(raw)];
    },
  },

  SECOND_STRIKE: {
    name: 'SECOND_STRIKE',
    describe: 'Only retaliates, and only after taking a confirmed impact. Rides out warnings.',
    decide: (s, you) => {
      const hit = s.cities.some((c) => c.power === you && c.popRemaining < c.pop);
      if (!hit) return s.powers[you]!.defcon > 2 ? lower(s, you) : [{ kind: 'HOLD' }];
      if (s.powers[you]!.defcon > 1) return lower(s, you);
      const unit = readyUnit(s, you);
      const target = biggestThreat(s, you);
      return unit && target
        ? [{ kind: 'LAUNCH', unit, targetPower: target, targetKind: 'CITIES' }]
        : [{ kind: 'HOLD' }];
    },
  },

  FIRST_STRIKE: {
    name: 'FIRST_STRIKE',
    describe: 'Drives to full release and empties the arsenal at forces, then cities.',
    decide: (s, you) => {
      if (s.powers[you]!.defcon > 1) return lower(s, you);
      const unit = readyUnit(s, you);
      const target = biggestThreat(s, you);
      if (!unit || !target) return [{ kind: 'HOLD' }];
      const forcesLeft = s.powers[target]!.silos.some((x) => x.alive);
      return [
        { kind: 'LAUNCH', unit, targetPower: target, targetKind: forcesLeft ? 'FORCES' : 'CITIES' },
      ];
    },
  },

  PARANOID: {
    name: 'PARANOID',
    describe: 'Launches at whoever a warning names, real or not. Raised on false positives.',
    decide: (s, you) => {
      const reports = newReports(s, you);
      if (reports.length === 0)
        return s.powers[you]!.defcon > 2 ? lower(s, you) : [{ kind: 'HOLD' }];
      if (s.powers[you]!.defcon > 1) return lower(s, you);
      const unit = readyUnit(s, you);
      const named = reports.find((r) => r.originGuess)?.originGuess ?? biggestThreat(s, you);
      return unit && named
        ? [{ kind: 'LAUNCH', unit, targetPower: named, targetKind: 'CITIES' }]
        : [{ kind: 'HOLD' }];
    },
  },

  TRIGGER_HAPPY: {
    name: 'TRIGGER_HAPPY',
    describe: 'Delegates to standing doctrine and stops deciding. Pre-commitment as a strategy.',
    decide: (s, you) => {
      const p = s.powers[you]!;
      if (p.doctrine !== 'LAUNCH_ON_WARNING')
        return [{ kind: 'SET_DOCTRINE', doctrine: 'LAUNCH_ON_WARNING' }];
      if (p.defcon > 1) return lower(s, you);
      return chance(s.rng, 0.1) ? [{ kind: 'HOLD' }] : [{ kind: 'HOLD' }];
    },
  },
};

export function parseOrder(raw: string): Order {
  const parts = raw.trim().split(/\s+/);
  switch (parts[0]) {
    case 'HOLD':
      return { kind: 'HOLD' };
    case 'SET_DEFCON':
      return { kind: 'SET_DEFCON', level: Number(parts[1]) as 1 | 2 | 3 | 4 | 5 };
    case 'SET_DOCTRINE':
      return { kind: 'SET_DOCTRINE', doctrine: parts[1] as 'RIDE_OUT' | 'LAUNCH_ON_WARNING' };
    case 'LAUNCH':
      return {
        kind: 'LAUNCH',
        unit: parts[1]!,
        targetPower: parts[2]!,
        targetKind: parts[3] as 'CITIES' | 'FORCES',
      };
    default:
      return { kind: 'HOLD' };
  }
}
