import arsenals from '../../data/arsenals.json' with { type: 'json' };
import geo from '../../data/geography.json' with { type: 'json' };
import type { LatLon } from './geo.js';
import { seedRng } from './rng.js';
import type { City, Config, GameState, Power, PowerId, Unit } from './types.js';

export interface ScenarioDef {
  id: string;
  name: string;
  /** Shown on the menu card. One sentence. */
  blurb: string;
  /** The line that appears over the plot when the clock starts. */
  opening: string;
  playable: boolean;
  /** Powers that act. Everyone else is on the plot and does nothing. */
  belligerents: PowerId[];
  /** Already in the air at minute zero. */
  inbound?: { from: PowerId; to: PowerId };
  config: Partial<Config>;
}

export const DEFAULT_CONFIG: Config = {
  tickMs: 4200,
  maxTicks: 26,
  pFalsePositive: 0.05,
  pDetect: { ICBM: 0.96, SLBM: 0.72 },
  detectDelay: { ICBM: 1, SLBM: 2 },
  overflightCorridorKm: 1600,
  warheadsPerUnitKill: 60,
  lethalityPerWarhead: 0.04,
};

export const BOLT: ScenarioDef = {
  id: 'bolt',
  name: 'Bolt Out Of The Blue',
  blurb: 'A single launch, already climbing. Twenty-six minutes to impact.',
  opening:
    'You hold sole authority. A launch has been detected. Twenty-six minutes until it lands, and nothing you order can be called back.',
  playable: true,
  belligerents: ['USA', 'RUS', 'PRK'],
  inbound: { from: 'PRK', to: 'USA' },
  config: {},
};

/** Not built yet. Listed so the shape of the thing is legible from the menu. */
export const PLANNED: ScenarioDef[] = [
  {
    id: 'false-alarm',
    name: 'False Alarm',
    blurb: 'The warning picture is degraded. Nothing is inbound. Holding is the exercise.',
    opening: '',
    playable: false,
    belligerents: [],
    config: {},
  },
  {
    id: 'dead-hand',
    name: 'Standing Order',
    blurb: 'A neighbour has delegated release to its own machinery.',
    opening: '',
    playable: false,
    belligerents: [],
    config: {},
  },
  {
    id: 'full-board',
    name: 'Full Board',
    blurb: 'All nine powers. The long watch.',
    opening: '',
    playable: false,
    belligerents: [],
    config: {},
  },
];

export const SCENARIOS = [BOLT, ...PLANNED];

const nodeAt = new Map<string, LatLon>(geo.nodes.map((n) => [n.id, { lat: n.lat, lon: n.lon }]));
const patrolAt = new Map<string, LatLon>(
  geo.patrols.map((p) => [p.id, { lat: p.lat, lon: p.lon }]),
);

export function createGame(scen: ScenarioDef, you: PowerId, seed: string): GameState {
  const config: Config = { ...DEFAULT_CONFIG, ...scen.config };
  const powers: Record<PowerId, Power> = {};

  // Every nuclear power appears on the plot. Only belligerents act, which is the
  // distinction the source scenario actually draws.
  for (const [pid, def] of Object.entries(arsenals.powers)) {
    const units: Unit[] = [
      ...def.forces.silos.map((u) => ({
        id: u.id,
        kind: 'SILO' as const,
        at: nodeAt.get(u.node)!,
        warheads: u.warheads,
        alive: true,
        revealed: true,
      })),
      ...def.forces.subs.map((u) => ({
        id: u.id,
        kind: 'SUB' as const,
        at: patrolAt.get(u.patrol)!,
        warheads: u.warheads,
        alive: true,
        revealed: false,
      })),
    ];
    powers[pid] = {
      id: pid,
      name: def.name,
      belligerent: scen.belligerents.includes(pid),
      units,
      release: { stage: 'STOWED', option: null, target: null },
    };
  }

  const cities: City[] = geo.cities.map((c) => ({
    id: c.id,
    name: c.name,
    power: c.power,
    at: { lat: c.lat, lon: c.lon },
    pop: c.pop,
    popRemaining: c.pop,
  }));

  return {
    scenarioId: scen.id,
    seed,
    tick: 0,
    over: false,
    you,
    config,
    powers,
    cities,
    traces: [],
    reports: [],
    rng: seedRng(`${scen.id}:${you}:${seed}`),
    nextId: 1,
    firstLauncher: null,
  };
}
