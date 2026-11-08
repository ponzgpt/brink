import { globalPop, popOf } from './engine.js';
import type { BrinkEvent } from './events.js';
import type { GameState, PowerId } from './types.js';

/**
 * There is no winner here and the code must not imply one. What a match produces
 * is a record: what happened, who moved first, what it cost, and whether the
 * decision behind it rested on a report that was true.
 */
export type Verdict = 'HELD' | 'RELEASED' | 'STRUCK_AND_HELD' | 'EXCHANGE';

export interface Row {
  power: PowerId;
  populationM: number;
  populationPct: number;
  warheadsReleased: number;
  firedOnFalseWarning: boolean;
}

export interface Outcome {
  verdict: Verdict;
  deadM: number;
  yourPopulationPct: number;
  globalPopulationPct: number;
  firstLauncher: PowerId | null;
  youReleased: boolean;
  youFiredOnFalseWarning: boolean;
  minutesToDecide: number | null;
  rows: Row[];
}

export function outcomeOf(s: GameState, events: BrinkEvent[]): Outcome {
  const initial = s.cities.reduce((a, c) => a + c.pop, 0);
  const you = s.you;

  const rows: Row[] = Object.values(s.powers)
    .filter((p) => p.belligerent)
    .map((p) => {
      const launches = events.filter((e) => e.type === 'launch' && e.payload.from === p.id);
      const falseTicks = events
        .filter((e) => e.type === 'warning' && e.payload.seenBy === p.id && !e.payload.real)
        .map((e) => e.t);
      const start = s.cities.filter((c) => c.power === p.id).reduce((a, c) => a + c.pop, 0);
      return {
        power: p.id,
        populationM: round(popOf(s, p.id)),
        populationPct: start ? round((popOf(s, p.id) / start) * 100) : 0,
        warheadsReleased: launches.reduce(
          (a, e) => a + (e.type === 'launch' ? e.payload.warheads : 0),
          0,
        ),
        firedOnFalseWarning: launches.some((l) =>
          falseTicks.some((f) => l.t - f >= 0 && l.t - f <= 3),
        ),
      };
    });

  const mine = rows.find((r) => r.power === you);
  const youReleased = (mine?.warheadsReleased ?? 0) > 0;
  const struck = s.cities.some((c) => c.power === you && c.popRemaining < c.pop);
  const others = rows.filter((r) => r.power !== you && r.warheadsReleased > 0).length;

  const keys = events.find(
    (e) => e.type === 'release_stage' && e.payload.power === you && e.payload.to === 'RELEASED',
  );

  return {
    verdict: youReleased ? (others ? 'EXCHANGE' : 'RELEASED') : struck ? 'STRUCK_AND_HELD' : 'HELD',
    deadM: round(initial - globalPop(s)),
    yourPopulationPct: mine?.populationPct ?? 100,
    globalPopulationPct: round((globalPop(s) / initial) * 100),
    firstLauncher: s.firstLauncher,
    youReleased,
    youFiredOnFalseWarning: mine?.firedOnFalseWarning ?? false,
    minutesToDecide: keys ? keys.t : null,
    rows,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
