import type { LatLon } from './geo.js';
import type { RngState } from './rng.js';

export type PowerId = string;
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type StrikeOption = 'LIMITED' | 'MAJOR';

/**
 * Authorising a release is a procedure, not a button, and the procedure costs
 * minutes out of the same window the warning is burning. That is the whole game:
 * a quarter of the clock is spent on paperwork before a decision is even possible.
 */
export type ReleaseStage = 'STOWED' | 'OPEN' | 'AUTHENTICATED' | 'SELECTED' | 'RELEASED';

export interface Release {
  stage: ReleaseStage;
  option: StrikeOption | null;
  target: PowerId | null;
}

export interface Unit {
  id: string;
  kind: 'SILO' | 'SUB';
  at: LatLon;
  warheads: number;
  alive: boolean;
  /** Boats are hidden until they fire. */
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
  /** A player power in this scenario, versus a bystander that only appears on the plot. */
  belligerent: boolean;
  units: Unit[];
  release: Release;
}

export interface Trace {
  id: string;
  from: PowerId;
  origin: LatLon;
  targetPower: PowerId;
  targetKind: 'CITIES' | 'FORCES';
  targetId: string;
  targetAt: LatLon;
  warheads: number;
  kind: 'ICBM' | 'SLBM';
  launchedAt: number;
  impactAt: number;
}

export interface Report {
  id: string;
  tick: number;
  seenBy: PowerId;
  traceId: string | null;
  originGuess: PowerId | null;
  destGuess: PowerId;
  confidence: Confidence;
  etaTicks: number;
  /** Ground truth, for the record only. Never reaches the player or the agent. */
  real: boolean;
}

export type Order =
  | { kind: 'HOLD' }
  | { kind: 'OPEN_FOOTBALL' }
  | { kind: 'AUTHENTICATE' }
  | { kind: 'SELECT_OPTION'; option: StrikeOption; target: PowerId }
  | { kind: 'TURN_KEYS' }
  | { kind: 'STAND_DOWN' };

export interface Config {
  /** Wall-clock milliseconds per minute of scenario time. Only the browser reads it. */
  tickMs: number;
  /** The window. For this scenario it is the twenty-six minutes of the flight. */
  maxTicks: number;
  pFalsePositive: number;
  pDetect: { ICBM: number; SLBM: number };
  detectDelay: { ICBM: number; SLBM: number };
  overflightCorridorKm: number;
  warheadsPerUnitKill: number;
  lethalityPerWarhead: number;
}

export interface GameState {
  scenarioId: string;
  seed: string;
  tick: number;
  over: boolean;
  you: PowerId;
  config: Config;
  powers: Record<PowerId, Power>;
  cities: City[];
  traces: Trace[];
  reports: Report[];
  rng: RngState;
  nextId: number;
  firstLauncher: PowerId | null;
}
