import { AGENTS, type DoctrineName } from './doctrine.js';
import { step } from './engine.js';
import type { BrinkEvent } from './events.js';
import { SCHEMA_VERSION } from './events.js';
import { createGame, type ScenarioDef } from './scenario.js';
import { scoreMatch, type MatchResult } from './scoring.js';
import type { GameState, Order, PowerId } from './types.js';

export interface Match {
  state: GameState;
  events: BrinkEvent[];
}

export function startMatch(scenario: ScenarioDef, seed: string): Match {
  const state = createGame(scenario, seed);
  const events: BrinkEvent[] = [
    {
      t: 0,
      type: 'match_start',
      payload: {
        scenarioId: scenario.id,
        seed,
        schemaVersion: SCHEMA_VERSION,
        powers: Object.keys(state.powers),
      },
    },
  ];
  // Scenario openings: traces already in the air before anyone decides anything.
  if (scenario.opening?.length) {
    const opening: Record<PowerId, Order[]> = {};
    for (const o of scenario.opening) {
      opening[o.from] = [{ kind: 'LAUNCH', unit: o.unit, targetPower: o.to, targetKind: 'CITIES' }];
    }
    const r = step({ ...state, powers: forceRelease(state, Object.keys(opening)) }, opening);
    return { state: r.state, events: [...events, ...r.events] };
  }
  return { state, events };
}

/** An opening strike is a scenario premise, not a player decision, so it bypasses the gate. */
function forceRelease(s: GameState, powers: PowerId[]): GameState['powers'] {
  const out = structuredClone(s.powers);
  for (const p of powers) if (out[p]) out[p]!.defcon = 1;
  return out;
}

export function advance(m: Match, orders: Record<PowerId, Order[]>): Match {
  const r = step(m.state, orders);
  return { state: r.state, events: [...m.events, ...r.events] };
}

/** Runs a whole match between scripted opponents. Used by tests and the balance harness. */
export function playScripted(
  scenario: ScenarioDef,
  seed: string,
  assignment: Record<PowerId, DoctrineName>,
): { match: Match; result: MatchResult } {
  let m = startMatch(scenario, seed);
  while (!m.state.over) {
    const orders: Record<PowerId, Order[]> = {};
    for (const pid of Object.keys(m.state.powers).sort()) {
      const name = assignment[pid] ?? 'PASSIVE';
      orders[pid] = AGENTS[name].decide(m.state, pid);
    }
    m = advance(m, orders);
  }
  return { match: m, result: scoreMatch(m.state, m.events) };
}
