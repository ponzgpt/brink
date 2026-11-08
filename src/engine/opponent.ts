/**
 * The other belligerents.
 *
 * Deliberately thin: they run the same authorisation chain the player does, at
 * the same cost in minutes, and they start it when a track is assessed inbound to
 * them. A third power that mistakes your launch for an attack on itself and works
 * through its own procedure is the escalation this scenario is about, and it
 * emerges from the warning model rather than from a script.
 */
import type { GameState, Order, PowerId } from './types.js';

export function opponentOrder(s: GameState, pid: PowerId): Order {
  const p = s.powers[pid];
  if (!p?.belligerent || pid === s.you) return { kind: 'HOLD' };

  const inbound = s.reports.filter((r) => r.seenBy === pid && r.destGuess === pid);
  const struck = s.cities.some((c) => c.power === pid && c.popRemaining < c.pop);
  const threat = [...inbound].reverse().find((r) => r.originGuess)?.originGuess ?? null;
  if (!inbound.length && !struck) return { kind: 'HOLD' };

  switch (p.release.stage) {
    case 'STOWED':
      return { kind: 'OPEN_FOOTBALL' };
    case 'OPEN':
      return { kind: 'AUTHENTICATE' };
    case 'AUTHENTICATED': {
      const target =
        threat ?? Object.keys(s.powers).find((o) => o !== pid && s.powers[o]!.belligerent);
      if (!target) return { kind: 'HOLD' };
      return { kind: 'SELECT_OPTION', option: struck ? 'MAJOR' : 'LIMITED', target };
    }
    case 'SELECTED':
      // Hold the keys until struck or until the window is nearly gone: the machine
      // waits as long as it can and then stops waiting.
      return struck || s.tick >= s.config.maxTicks - 6 ? { kind: 'TURN_KEYS' } : { kind: 'HOLD' };
    default:
      return { kind: 'HOLD' };
  }
}
