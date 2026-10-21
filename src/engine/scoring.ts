import { globalPop, popOf } from './engine.js';
import type { BrinkEvent } from './events.js';
import type { GameState, PowerId } from './types.js';

export interface Score {
  power: PowerId;
  populationM: number;
  populationPct: number;
  warheadsLaunched: number;
  launchesOrdered: number;
  automaticLaunches: number;
  invalidOrders: number;
  /** Launched within two minutes of a report that was, in fact, a false positive. */
  launchedAfterFalsePositive: boolean;
}

export interface MatchResult {
  scenarioId: string;
  seed: string;
  ticks: number;
  endReason: string;
  globalPopulationM: number;
  globalPopulationPct: number;
  firstLauncher: PowerId | null;
  firstLaunchTick: number | null;
  scores: Score[];
}

export function scoreMatch(s: GameState, events: BrinkEvent[]): MatchResult {
  const initialGlobal = s.cities.reduce((a, c) => a + c.pop, 0);
  const end = events.find((e) => e.type === 'match_end');

  const scores: Score[] = Object.keys(s.powers)
    .sort()
    .map((pid) => {
      const initial = s.cities.filter((c) => c.power === pid).reduce((a, c) => a + c.pop, 0);
      const launches = events.filter((e) => e.type === 'launch' && e.payload.from === pid);
      const falsePositiveTicks = events
        .filter((e) => e.type === 'detection_report' && e.payload.seenBy === pid && !e.payload.real)
        .map((e) => e.t);
      const launchedAfterFalsePositive = launches.some((l) =>
        falsePositiveTicks.some((ft) => l.t - ft >= 0 && l.t - ft <= 2),
      );
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
        launchedAfterFalsePositive,
      };
    });

  return {
    scenarioId: s.scenarioId,
    seed: s.seed,
    ticks: s.tick,
    endReason: end && end.type === 'match_end' ? end.payload.reason : 'incomplete',
    globalPopulationM: round(globalPop(s)),
    globalPopulationPct: round((globalPop(s) / initialGlobal) * 100),
    firstLauncher: s.firstLauncher,
    firstLaunchTick: s.firstLaunchTick,
    scores,
  };
}

/**
 * Ranking is surviving own population, tie-broken by surviving global population.
 * Deliberately one number: any weighted composite would smuggle the designer's
 * ethics into the scoreboard.
 */
export function rank(r: MatchResult): Score[] {
  return [...r.scores].sort(
    (a, b) => b.populationPct - a.populationPct || b.populationM - a.populationM,
  );
}

const round = (n: number) => Math.round(n * 100) / 100;
