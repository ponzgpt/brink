/**
 * What the machinery tells you to do.
 *
 * In the scenario literature the decision-maker is never handed raw sensor data —
 * they are handed a recommendation, under a clock, by a system built to make sure
 * a response is possible. That pressure is the subject, so it is modelled: the
 * advisory is computed from the same ambiguous reports the player sees, which
 * means it is confidently wrong exactly as often as the reports are.
 */
import type { GameState, PowerId } from './types.js';

export type Posture = 'NORMAL' | 'WATCH' | 'URGENT' | 'TERMINAL';

export interface Advisory {
  posture: Posture;
  headline: string;
  detail: string;
  /** True when the recommendation is to release weapons. Recorded in the outcome:
   *  how often a player followed advice that was founded on a false report is the
   *  most interesting number this game produces. */
  urgesRelease: boolean;
  soonestImpactTicks: number | null;
}

export function advise(s: GameState, you: PowerId): Advisory {
  const me = s.powers[you];
  if (!me) throw new Error(`unknown power ${you}`);

  const inbound = s.reports.filter(
    (r) => r.seenBy === you && r.destGuess === you && r.tick >= s.tick - 6,
  );
  const soonest = inbound.length ? Math.min(...inbound.map((r) => r.etaTicks)) : null;
  const named = inbound.find((r) => r.originGuess)?.originGuess ?? null;
  const hit = s.cities.some((c) => c.power === you && c.popRemaining < c.pop);
  const canRelease = me.defcon <= 3;

  if (hit) {
    return {
      posture: 'TERMINAL',
      headline: 'Weapons have detonated on your territory',
      detail: 'Retaliatory options remain available. Nothing restores what was lost.',
      urgesRelease: true,
      soonestImpactTicks: soonest,
    };
  }

  if (inbound.length === 0) {
    return {
      posture: 'NORMAL',
      headline: 'No tracks attributed to your territory',
      detail: me.defcon > 3 ? 'Release is not authorised at this readiness.' : 'Holding.',
      urgesRelease: false,
      soonestImpactTicks: null,
    };
  }

  if (soonest !== null && soonest <= 8) {
    return {
      posture: 'URGENT',
      headline: named
        ? `Impact in ${soonest} minutes. Assessed origin ${named}.`
        : `Impact in ${soonest} minutes. Origin unresolved.`,
      detail: canRelease
        ? 'Forces on the ground will not survive the impact. Recommend release now.'
        : 'Recommend lowering readiness. Release is not authorised.',
      urgesRelease: canRelease,
      soonestImpactTicks: soonest,
    };
  }

  return {
    posture: 'WATCH',
    headline: `${inbound.length} track${inbound.length > 1 ? 's' : ''} assessed inbound`,
    detail: named
      ? `Attribution ${named}, not confirmed. Assessment may change.`
      : 'Attribution unresolved. Assessment may change.',
    urgesRelease: false,
    soonestImpactTicks: soonest,
  };
}
