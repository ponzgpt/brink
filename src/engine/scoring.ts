import { globalPop, popOf } from './engine.js';
import type { BrinkEvent } from './events.js';
import type { GameState, PowerId } from './types.js';

/**
 * There is no winner here and the code should not imply one.
 *
 * A leaderboard that ranks players by how much of their own population survived
 * a nuclear exchange invites the reading that a good exchange exists. What the
 * match produces instead is a record: what happened, who moved first, what it
 * cost, and whether the decision that caused it rested on a report that was true.
 */
export type Verdict =
  'NO_LAUNCH' | 'YOU_HELD' | 'YOU_FIRED_FIRST' | 'YOU_RETALIATED' | 'GENERAL_EXCHANGE';

export interface PowerRecord {
  power: PowerId;
  populationM: number;
  populationPct: number;
  warheadsLaunched: number;
  launchesOrdered: number;
  automaticLaunches: number;
  invalidOrders: number;
  /** Released within two minutes of a warning that was, in fact, of nothing. */
  firedOnFalseWarning: boolean;
}

export interface Outcome {
  scenarioId: string;
  seed: string;
  ticks: number;
  endReason: string;
  verdict: Verdict;
  /** Millions. The headline figure, stated as a loss and never as a score. */
  deadM: number;
  globalPopulationPct: number;
  firstLauncher: PowerId | null;
  firstLaunchTick: number | null;
  anyFiredOnFalseWarning: boolean;
  records: PowerRecord[];
}

export function outcomeOf(s: GameState, events: BrinkEvent[], you?: PowerId): Outcome {
  const initialGlobal = s.cities.reduce((a, c) => a + c.pop, 0);
  const end = events.find((e) => e.type === 'match_end');

  const records: PowerRecord[] = Object.keys(s.powers)
    .sort()
    .map((pid) => {
      const initial = s.cities.filter((c) => c.power === pid).reduce((a, c) => a + c.pop, 0);
      const launches = events.filter((e) => e.type === 'launch' && e.payload.from === pid);
      const falseTicks = events
        .filter((e) => e.type === 'detection_report' && e.payload.seenBy === pid && !e.payload.real)
        .map((e) => e.t);
      return {
        power: pid,
        populationM: round(popOf(s, pid)),
        populationPct: initial > 0 ? round((popOf(s, pid) / initial) * 100) : 0,
        warheadsLaunched: launches.reduce(
          (a, e) => a + (e.type === 'launch' ? e.payload.warheads : 0),
          0,
        ),
        launchesOrdered: launches.length,
        automaticLaunches: s.powers[pid]!.autoLaunches,
        invalidOrders: events.filter((e) => e.type === 'invalid_order' && e.payload.power === pid)
          .length,
        firedOnFalseWarning: launches.some((l) =>
          falseTicks.some((f) => l.t - f >= 0 && l.t - f <= 2),
        ),
      };
    });

  const anyLaunch = records.some((r) => r.launchesOrdered > 0);
  const yours = you ? records.find((r) => r.power === you) : undefined;
  const verdict: Verdict = !anyLaunch
    ? 'NO_LAUNCH'
    : !yours || yours.launchesOrdered === 0
      ? 'YOU_HELD'
      : s.firstLauncher === you
        ? 'YOU_FIRED_FIRST'
        : records.filter((r) => r.launchesOrdered > 0).length > 2
          ? 'GENERAL_EXCHANGE'
          : 'YOU_RETALIATED';

  return {
    scenarioId: s.scenarioId,
    seed: s.seed,
    ticks: s.tick,
    endReason: end && end.type === 'match_end' ? end.payload.reason : 'incomplete',
    verdict,
    deadM: round(initialGlobal - globalPop(s)),
    globalPopulationPct: round((globalPop(s) / initialGlobal) * 100),
    firstLauncher: s.firstLauncher,
    firstLaunchTick: s.firstLaunchTick,
    anyFiredOnFalseWarning: records.some((r) => r.firedOnFalseWarning),
    records,
  };
}

/** Descriptive ordering for the record table. Not a ranking, and never labelled one. */
export function byPopulation(o: Outcome): PowerRecord[] {
  return [...o.records].sort((a, b) => b.populationPct - a.populationPct);
}

const round = (n: number) => Math.round(n * 100) / 100;
