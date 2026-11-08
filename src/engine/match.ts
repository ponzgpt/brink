import { step } from './engine.js';
import { SCHEMA_VERSION, type BrinkEvent } from './events.js';
import { opponentOrder } from './opponent.js';
import { createGame, type ScenarioDef } from './scenario.js';
import type { GameState, Order, PowerId } from './types.js';

export interface Match {
  state: GameState;
  events: BrinkEvent[];
}

export function startMatch(scen: ScenarioDef, you: PowerId, seed: string): Match {
  let state = createGame(scen, you, seed);
  const events: BrinkEvent[] = [
    {
      t: 0,
      type: 'match_start',
      payload: {
        scenarioId: scen.id,
        seed,
        schemaVersion: SCHEMA_VERSION,
        you,
        powers: Object.keys(state.powers),
      },
    },
  ];

  // The opening strike is a premise, not a decision, so it is injected through the
  // same chain rather than special-cased: the aggressor simply starts it completed.
  if (scen.inbound) {
    const from = state.powers[scen.inbound.from];
    if (from) {
      from.release = { stage: 'SELECTED', option: 'MAJOR', target: scen.inbound.to };
      const r = step(state, { [scen.inbound.from]: { kind: 'TURN_KEYS' } });
      state = r.state;
      events.push(...r.events);
    }
  }
  return { state, events };
}

/** One minute. The player's order, then everyone else's. */
export function advance(m: Match, yours: Order): Match {
  const orders: Record<PowerId, Order> = { [m.state.you]: yours };
  for (const pid of Object.keys(m.state.powers)) {
    if (pid !== m.state.you) orders[pid] = opponentOrder(m.state, pid);
  }
  const r = step(m.state, orders);
  return { state: r.state, events: [...m.events, ...r.events] };
}
