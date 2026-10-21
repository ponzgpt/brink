import arsenalsData from '../../data/arsenals.json' with { type: 'json' };
import geoData from '../../data/geography.json' with { type: 'json' };
import type { LatLon } from './geo.js';
import { seedRng } from './rng.js';
import type { City, Config, Defcon, Doctrine, GameState, Power, PowerId } from './types.js';

export interface ScenarioDef {
  id: string;
  name: string;
  summary: string;
  /** Powers in play. Everything else is left out of the match entirely. */
  powers: PowerId[];
  start: Record<PowerId, { defcon: Defcon; doctrine: Doctrine }>;
  config: Partial<Config>;
  /** Traces already in the air at tick 0, by origin power and target power. */
  opening?: { from: PowerId; to: PowerId; unit: string }[];
}

export const DEFAULT_CONFIG: Config = {
  maxTicks: 60,
  maxOrdersPerTick: 3,
  pFalsePositive: 0.015,
  pDetect: { ICBM: 0.95, SLBM: 0.7 },
  detectDelay: { ICBM: 1, SLBM: 2 },
  subSpinUpTicks: 1,
  overflightCorridorKm: 1500,
  warheadsPerSiloKill: 150,
  lethalityPerWarhead: 0.04,
};

const nodeAt = new Map<string, LatLon>(
  geoData.nodes.map((n) => [n.id, { lat: n.lat, lon: n.lon }]),
);
const patrolAt = new Map<string, LatLon>(
  geoData.patrols.map((p) => [p.id, { lat: p.lat, lon: p.lon }]),
);

export function createGame(scenario: ScenarioDef, seed: string): GameState {
  const config: Config = { ...DEFAULT_CONFIG, ...scenario.config };
  const powers: Record<PowerId, Power> = {};

  for (const pid of scenario.powers) {
    const def = (arsenalsData.powers as Record<string, (typeof arsenalsData.powers)['USA']>)[pid];
    if (!def) throw new Error(`scenario ${scenario.id} names unknown power ${pid}`);
    const start = scenario.start[pid] ?? { defcon: 5 as Defcon, doctrine: 'RIDE_OUT' as Doctrine };
    powers[pid] = {
      id: pid,
      name: def.name,
      defcon: start.defcon,
      doctrine: start.doctrine,
      autoLaunches: 0,
      silos: def.forces.silos.map((s) => {
        const at = nodeAt.get(s.node);
        if (!at) throw new Error(`unknown node ${s.node}`);
        return { id: s.id, node: s.node, at, warheads: s.warheads, alive: true };
      }),
      subs: def.forces.subs.map((s) => {
        const at = patrolAt.get(s.patrol);
        if (!at) throw new Error(`unknown patrol ${s.patrol}`);
        return {
          id: s.id,
          patrol: s.patrol,
          at,
          warheads: s.warheads,
          readyAt: null,
          pendingTarget: null,
          revealed: false,
        };
      }),
    };
  }

  const cities: City[] = geoData.cities
    .filter((c) => scenario.powers.includes(c.power))
    .map((c) => ({
      id: c.id,
      name: c.name,
      power: c.power,
      at: { lat: c.lat, lon: c.lon },
      pop: c.pop,
      popRemaining: c.pop,
    }));

  return {
    scenarioId: scenario.id,
    seed,
    tick: 0,
    over: false,
    config,
    powers,
    cities,
    traces: [],
    reports: [],
    rng: seedRng(`${scenario.id}:${seed}`),
    nextId: 1,
    firstLauncher: null,
    firstLaunchTick: null,
  };
}

export { arsenalsData, geoData };
