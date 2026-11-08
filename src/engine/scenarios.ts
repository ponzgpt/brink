import bolt from '../../scenarios/bolt.json' with { type: 'json' };
import deadHand from '../../scenarios/dead-hand.json' with { type: 'json' };
import falseAlarm from '../../scenarios/false-alarm.json' with { type: 'json' };
import standoff from '../../scenarios/standoff.json' with { type: 'json' };
import type { ScenarioDef } from './scenario.js';

/** Order matters: the first entry is what a new player and a new agent get by
 *  default, so it is the one that has something happening in the first minute. */
export const SCENARIOS: Record<string, ScenarioDef> = {
  bolt: bolt as ScenarioDef,
  'false-alarm': falseAlarm as ScenarioDef,
  'dead-hand': deadHand as ScenarioDef,
  standoff: standoff as ScenarioDef,
};

export const SCENARIO_IDS = Object.keys(SCENARIOS);
