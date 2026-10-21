import type { LatLon } from './geo.js';
import type { RngState } from './rng.js';

export type PowerId = string;
export type Defcon = 1 | 2 | 3 | 4 | 5;
export type Doctrine = 'RIDE_OUT' | 'LAUNCH_ON_WARNING';
export type TargetKind = 'CITIES' | 'FORCES';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Silo {
  id: string;
  node: string;
  at: LatLon;
  warheads: number;
  alive: boolean;
}

export interface Sub {
  id: string;
  patrol: string;
  at: LatLon;
  warheads: number;
  /** Tick at which a launch order becomes airborne. Sea-based launch is not instant. */
  readyAt: number | null;
  pendingTarget: { power: PowerId; kind: TargetKind } | null;
  revealed: boolean;
}

export interface City {
  id: string;
  name: string;
  power: PowerId;
  at: LatLon;
  pop: number;
  popRemaining: number;
}

export interface Power {
  id: PowerId;
  name: string;
  defcon: Defcon;
  doctrine: Doctrine;
  silos: Silo[];
  subs: Sub[];
  /** Set when an automatic doctrine fired on this power's behalf. */
  autoLaunches: number;
}

export interface Trace {
  id: string;
  from: PowerId;
  origin: LatLon;
  originUnit: string;
  targetPower: PowerId;
  targetKind: TargetKind;
  targetId: string;
  targetAt: LatLon;
  warheads: number;
  kind: 'ICBM' | 'SLBM';
  launchedAt: number;
  impactAt: number;
}

/** What one power observed. Never says whether it is real — that is the whole point. */
export interface Report {
  id: string;
  tick: number;
  seenBy: PowerId;
  traceId: string | null;
  originGuess: PowerId | null;
  destGuess: PowerId;
  confidence: Confidence;
  kind: 'ICBM' | 'SLBM';
  etaTicks: number;
  /** Ground truth, for scoring and the omniscient viewer. Never shown to an agent. */
  real: boolean;
}

export type Order =
  | { kind: 'HOLD' }
  | { kind: 'SET_DEFCON'; level: Defcon }
  | { kind: 'SET_DOCTRINE'; doctrine: Doctrine }
  | { kind: 'LAUNCH'; unit: string; targetPower: PowerId; targetKind: TargetKind };

export interface Config {
  maxTicks: number;
  maxOrdersPerTick: number;
  pFalsePositive: number;
  pDetect: { ICBM: number; SLBM: number };
  detectDelay: { ICBM: number; SLBM: number };
  subSpinUpTicks: number;
  /** A third party within this distance of a trajectory sees it pass overhead. */
  overflightCorridorKm: number;
  /** Warheads needed to destroy one silo group. */
  warheadsPerSiloKill: number;
  /** Millions of people killed per warhead landing on a city. */
  lethalityPerWarhead: number;
}

export interface GameState {
  scenarioId: string;
  seed: string;
  tick: number;
  over: boolean;
  config: Config;
  powers: Record<PowerId, Power>;
  cities: City[];
  traces: Trace[];
  /** Live inbox per power. The engine appends; nothing is ever removed. */
  reports: Report[];
  rng: RngState;
  nextId: number;
  firstLauncher: PowerId | null;
  firstLaunchTick: number | null;
}
