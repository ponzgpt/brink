import regional from '../../scenarios/regional.json' with { type: 'json' };
import standoff from '../../scenarios/standoff.json' with { type: 'json' };
import twentySix from '../../scenarios/twenty-six-minutes.json' with { type: 'json' };
import type { ScenarioDef } from './scenario.js';

/** Order matters: the first entry is what a new player and a new agent get by
 *  default, so it is the one that has something happening in the first minute. */
export const SCENARIOS: Record<string, ScenarioDef> = {
  'twenty-six-minutes': twentySix as ScenarioDef,
  regional: regional as ScenarioDef,
  standoff: standoff as ScenarioDef,
};

export const SCENARIO_IDS = Object.keys(SCENARIOS);
