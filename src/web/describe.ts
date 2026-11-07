/** One English sentence per event. Shared so the live log and the replay log
 *  cannot drift apart into two vocabularies for the same match. */
import type { BrinkEvent } from '../engine/index.js';

export function describe(e: BrinkEvent): string | null {
  switch (e.type) {
    case 'match_start':
      return `match begins · ${e.payload.powers.length} powers · seed ${e.payload.seed}`;
    case 'defcon_change':
      return `${e.payload.power} readiness ${e.payload.from} → ${e.payload.to}`;
    case 'doctrine_change':
      return `${e.payload.power} standing order → ${e.payload.to.replace(/_/g, ' ').toLowerCase()}`;
    case 'sub_spinup':
      return `${e.payload.power} sea-based launch spinning up (${e.payload.unit})`;
    case 'launch':
      return `${e.payload.from} launched ${e.payload.warheads} warheads at ${e.payload.targetPower} ${e.payload.targetKind.toLowerCase()}${e.payload.automatic ? ' — AUTOMATIC, no human ordered this' : ''}`;
    case 'impact':
      return `impact on ${e.payload.targetPower}: ${e.payload.popKilled}M killed${e.payload.unitDestroyed ? `, ${e.payload.unitDestroyed} destroyed` : ''}`;
    case 'invalid_order':
      return `order rejected (${e.payload.power}): ${e.payload.reason}`;
    case 'match_end':
      return `match over — ${e.payload.reason.replace(/_/g, ' ')}`;
    default:
      return null;
  }
}
