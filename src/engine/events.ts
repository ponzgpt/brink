/**
 * The event log is the single source of truth. The browser renderer, the replay
 * viewer and the scorer all fold the same stream — there is no second
 * representation to drift out of sync.
 *
 * CONTRACT: adding a field is fine; renaming or removing one breaks stored
 * replays. Bump SCHEMA_VERSION and say so in the commit.
 */
export const SCHEMA_VERSION = 1;

import type { Confidence, Defcon, Doctrine, PowerId, TargetKind } from './types.js';
import type { LatLon } from './geo.js';

export type BrinkEvent =
  | {
      t: number;
      type: 'match_start';
      payload: { scenarioId: string; seed: string; schemaVersion: number; powers: PowerId[] };
    }
  | { t: number; type: 'tick_begin'; payload: Record<string, never> }
  | {
      t: number;
      type: 'invalid_order';
      payload: { power: PowerId; reason: string; order: unknown };
    }
  | { t: number; type: 'defcon_change'; payload: { power: PowerId; from: Defcon; to: Defcon } }
  | {
      t: number;
      type: 'doctrine_change';
      payload: { power: PowerId; from: Doctrine; to: Doctrine };
    }
  | { t: number; type: 'sub_spinup'; payload: { power: PowerId; unit: string; readyAt: number } }
  | {
      t: number;
      type: 'launch';
      payload: {
        traceId: string;
        from: PowerId;
        unit: string;
        origin: LatLon;
        targetPower: PowerId;
        targetKind: TargetKind;
        targetId: string;
        targetAt: LatLon;
        warheads: number;
        kind: 'ICBM' | 'SLBM';
        impactAt: number;
        automatic: boolean;
      };
    }
  | {
      t: number;
      type: 'detection_report';
      payload: {
        reportId: string;
        seenBy: PowerId;
        destGuess: PowerId;
        originGuess: PowerId | null;
        confidence: Confidence;
        kind: 'ICBM' | 'SLBM';
        etaTicks: number;
        real: boolean;
      };
    }
  | { t: number; type: 'trace_update'; payload: { traceId: string; at: LatLon; progress: number } }
  | {
      t: number;
      type: 'impact';
      payload: {
        traceId: string;
        targetPower: PowerId;
        targetKind: TargetKind;
        targetId: string;
        warheads: number;
        popKilled: number;
        unitDestroyed: string | null;
      };
    }
  | { t: number; type: 'tick_end'; payload: { traces: number } }
  | {
      t: number;
      type: 'match_end';
      payload: { reason: 'tick_limit' | 'arsenals_empty'; survivors: Record<PowerId, number> };
    };

export type EventType = BrinkEvent['type'];
