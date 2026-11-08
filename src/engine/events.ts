/**
 * One append-only stream. The plot, the logs and the record are all folds of it.
 *
 * CONTRACT: renaming or removing a field invalidates stored logs. Bump
 * SCHEMA_VERSION and say so in the commit.
 */
export const SCHEMA_VERSION = 2;

import type { LatLon } from './geo.js';
import type { Confidence, PowerId, ReleaseStage, StrikeOption } from './types.js';

export type BrinkEvent =
  | {
      t: number;
      type: 'match_start';
      payload: {
        scenarioId: string;
        seed: string;
        schemaVersion: number;
        you: PowerId;
        powers: PowerId[];
      };
    }
  | { t: number; type: 'tick'; payload: Record<string, never> }
  | { t: number; type: 'invalid_order'; payload: { power: PowerId; reason: string } }
  | {
      t: number;
      type: 'release_stage';
      payload: {
        power: PowerId;
        from: ReleaseStage;
        to: ReleaseStage;
        option: StrikeOption | null;
        target: PowerId | null;
      };
    }
  | {
      t: number;
      type: 'launch';
      payload: {
        traceId: string;
        from: PowerId;
        unit: string;
        origin: LatLon;
        targetPower: PowerId;
        targetKind: 'CITIES' | 'FORCES';
        targetId: string;
        targetAt: LatLon;
        warheads: number;
        kind: 'ICBM' | 'SLBM';
        impactAt: number;
      };
    }
  | {
      t: number;
      type: 'warning';
      payload: {
        reportId: string;
        seenBy: PowerId;
        destGuess: PowerId;
        originGuess: PowerId | null;
        confidence: Confidence;
        etaTicks: number;
        real: boolean;
      };
    }
  | {
      t: number;
      type: 'impact';
      payload: {
        traceId: string;
        targetPower: PowerId;
        targetKind: 'CITIES' | 'FORCES';
        targetId: string;
        warheads: number;
        popKilled: number;
        unitDestroyed: string | null;
      };
    }
  | { t: number; type: 'match_end'; payload: { reason: 'window_closed' | 'spent' } };

export type EventType = BrinkEvent['type'];
