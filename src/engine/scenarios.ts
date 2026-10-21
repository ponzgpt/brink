import regional from '../../scenarios/regional.json' with { type: 'json' };
import standoff from '../../scenarios/standoff.json' with { type: 'json' };
import twentySix from '../../scenarios/twenty-six-minutes.json' with { type: 'json' };
import type { ScenarioDef } from './scenario.js';

export const SCENARIOS: Record<string, ScenarioDef> = {
  standoff: standoff as ScenarioDef,
  regional: regional as ScenarioDef,
  'twenty-six-minutes': twentySix as ScenarioDef,
};

export const SCENARIO_IDS = Object.keys(SCENARIOS);
