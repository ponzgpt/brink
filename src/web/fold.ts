/**
 * Rebuild what the globe needs from the event log alone.
 *
 * This is the function that makes "one renderer, live and replay" true rather than
 * aspirational: the live client feeds the globe from GameState, the replay feeds it
 * from a fold of the same events, and both produce the same shapes. If the viewer
 * ever needs something this cannot reconstruct, the event log is missing a field.
 */
import geography from '../../data/geography.json' with { type: 'json' };
import type { BrinkEvent, City, PowerId, Trace } from '../engine/index.js';

export interface FoldedFrame {
  tick: number;
  maxTick: number;
  cities: City[];
  traces: Trace[];
  defcon: Record<PowerId, number>;
  powers: PowerId[];
  scenarioId: string;
  seed: string;
  log: { t: number; line: string }[];
}

export function parseJsonl(text: string): BrinkEvent[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BrinkEvent);
}

export function maxTickOf(events: readonly BrinkEvent[]): number {
  return events.reduce((a, e) => Math.max(a, e.t), 0);
}

export function fold(
  events: readonly BrinkEvent[],
  upto: number,
  describe: (e: BrinkEvent) => string | null,
): FoldedFrame {
  const start = events.find((e) => e.type === 'match_start');
  const powers = start?.type === 'match_start' ? start.payload.powers : [];
  const cities: City[] = geography.cities
    .filter((c) => powers.includes(c.power))
    .map((c) => ({
      id: c.id,
      name: c.name,
      power: c.power,
      at: { lat: c.lat, lon: c.lon },
      pop: c.pop,
      popRemaining: c.pop,
    }));

  const defcon: Record<PowerId, number> = {};
  for (const p of powers) defcon[p] = 5;

  const launched = new Map<string, Trace>();
  const landed = new Set<string>();
  const log: { t: number; line: string }[] = [];

  for (const e of events) {
    if (e.t > upto) break;
    const line = describe(e);
    if (line) log.push({ t: e.t, line });

    switch (e.type) {
      case 'defcon_change':
        defcon[e.payload.power] = e.payload.to;
        break;
      case 'launch':
        launched.set(e.payload.traceId, {
          id: e.payload.traceId,
          from: e.payload.from,
          origin: e.payload.origin,
          originUnit: e.payload.unit,
          targetPower: e.payload.targetPower,
          targetKind: e.payload.targetKind,
          targetId: e.payload.targetId,
          targetAt: e.payload.targetAt,
          warheads: e.payload.warheads,
          kind: e.payload.kind,
          launchedAt: e.t,
          impactAt: e.payload.impactAt,
        });
        break;
      case 'impact': {
        landed.add(e.payload.traceId);
        // Spread the loss the same way the engine did: largest surviving city first.
        let remaining = e.payload.popKilled;
        const targets = cities
          .filter((c) => c.power === e.payload.targetPower && c.popRemaining > 0)
          .sort((a, b) => b.popRemaining - a.popRemaining);
        for (const c of targets) {
          if (remaining <= 0) break;
          const loss = Math.min(c.popRemaining, remaining);
          c.popRemaining -= loss;
          remaining -= loss;
        }
        break;
      }
    }
  }

  const traces = [...launched.values()].filter((t) => !landed.has(t.id) && t.launchedAt <= upto);

  return {
    tick: upto,
    maxTick: maxTickOf(events),
    cities,
    traces,
    defcon,
    powers,
    scenarioId: start?.type === 'match_start' ? start.payload.scenarioId : '?',
    seed: start?.type === 'match_start' ? start.payload.seed : '?',
    log,
  };
}
