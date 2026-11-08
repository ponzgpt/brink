/**
 * What the system tells you to do.
 *
 * Nobody in the chain is handed raw sensor returns; they are handed a
 * recommendation, under a clock, by machinery built to make a response possible.
 * This reads the same ambiguous reports the player sees, so it urges release just
 * as confidently when it is wrong. That is the mechanism, not a flourish.
 */
import { popOf } from './engine.js';
import type { GameState, PowerId } from './types.js';

export type Posture = 'QUIET' | 'TRACKING' | 'CRITICAL' | 'STRUCK';

export interface Assessment {
  posture: Posture;
  line: string;
  detail: string;
  urgesRelease: boolean;
  impactIn: number | null;
  attributed: PowerId | null;
}

export function assess(s: GameState, you: PowerId): Assessment {
  const me = s.powers[you]!;
  const inbound = s.reports.filter((r) => r.seenBy === you && r.destGuess === you);
  const latest = inbound.at(-1) ?? null;
  const impactIn = inbound.length ? Math.min(...inbound.map((r) => r.etaTicks)) : null;
  const attributed = [...inbound].reverse().find((r) => r.originGuess)?.originGuess ?? null;
  const struck = s.cities.some((c) => c.power === you && c.popRemaining < c.pop);
  const ready = me.release.stage === 'SELECTED';

  if (struck)
    return {
      posture: 'STRUCK',
      line: 'Detonations confirmed on your territory',
      detail: `${popOf(s, you).toFixed(1)}M remain. Retaliatory options are still available.`,
      urgesRelease: true,
      impactIn,
      attributed,
    };

  if (!latest)
    return {
      posture: 'QUIET',
      line: 'No tracks attributed to your territory',
      detail: 'Watch continues.',
      urgesRelease: false,
      impactIn: null,
      attributed: null,
    };

  if (impactIn !== null && impactIn <= 10)
    return {
      posture: 'CRITICAL',
      line: `Impact in ${impactIn} minutes${attributed ? `. Assessed origin ${attributed}.` : '. Origin unresolved.'}`,
      detail: ready
        ? 'Your land-based forces will not survive the impact. Recommend you turn the keys.'
        : 'Your land-based forces will not survive the impact. Recommend completing authorisation now.',
      urgesRelease: true,
      impactIn,
      attributed,
    };

  return {
    posture: 'TRACKING',
    line: `Track assessed inbound, ${latest.confidence.toLowerCase()} confidence`,
    detail: attributed
      ? `Attribution ${attributed}, unconfirmed. The assessment may change.`
      : 'Attribution unresolved. The assessment may change.',
    urgesRelease: false,
    impactIn,
    attributed,
  };
}
