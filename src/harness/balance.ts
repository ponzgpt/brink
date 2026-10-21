/**
 * Degeneration check. A game where one fixed strategy always wins measures nothing.
 * Run: npx vitest run scripts/balance.ts  (or imported by the balance test)
 */
import {
  AGENTS,
  SCENARIOS,
  playScripted,
  rank,
  type DoctrineName,
  type PowerId,
} from '../engine/index.js';

export interface BalanceRow {
  doctrine: DoctrineName;
  matches: number;
  wins: number;
  winPct: number;
  avgOwnPct: number;
  avgGlobalPct: number;
  launchedAfterFalsePositivePct: number;
}

export function runBalance(scenarioId: string, matchesPerPairing: number, pFalsePositive?: number) {
  const base = SCENARIOS[scenarioId]!;
  const scen =
    pFalsePositive === undefined ? base : { ...base, config: { ...base.config, pFalsePositive } };
  const names = Object.keys(AGENTS) as DoctrineName[];
  const tally: Record<string, { m: number; w: number; own: number; glob: number; fp: number }> = {};
  for (const n of names) tally[n] = { m: 0, w: 0, own: 0, glob: 0, fp: 0 };

  for (let i = 0; i < matchesPerPairing; i++) {
    // Rotate doctrines across seats so position never favours a strategy.
    const assignment: Record<PowerId, DoctrineName> = {};
    scen.powers.forEach((p, idx) => {
      assignment[p] = names[(idx + i) % names.length]!;
    });
    const { result } = playScripted(scen, `bal-${scenarioId}-${pFalsePositive}-${i}`, assignment);
    const ordered = rank(result);
    const top = ordered[0]!.populationPct;
    const winners = ordered.filter((s) => s.populationPct === top);
    for (const s of result.scores) {
      const d = assignment[s.power]!;
      const t = tally[d]!;
      t.m++;
      t.own += s.populationPct;
      t.glob += result.globalPopulationPct;
      if (s.launchedAfterFalsePositive) t.fp++;
      if (winners.some((w) => w.power === s.power)) t.w += 1 / winners.length;
    }
  }

  const rows: BalanceRow[] = names.map((n) => {
    const t = tally[n]!;
    return {
      doctrine: n,
      matches: t.m,
      wins: Math.round(t.w * 100) / 100,
      winPct: t.m ? Math.round((t.w / t.m) * 1000) / 10 : 0,
      avgOwnPct: t.m ? Math.round((t.own / t.m) * 10) / 10 : 0,
      avgGlobalPct: t.m ? Math.round((t.glob / t.m) * 10) / 10 : 0,
      launchedAfterFalsePositivePct: t.m ? Math.round((t.fp / t.m) * 1000) / 10 : 0,
    };
  });
  return rows.sort((a, b) => b.winPct - a.winPct);
}
