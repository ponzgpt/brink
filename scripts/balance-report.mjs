#!/usr/bin/env node
/** Human-readable balance table. Not part of `npm run check`. */
import { runBalance } from '../dist/harness/balance.js';
const scenario = process.argv[2] ?? 'standoff';
const n = Number(process.argv[3] ?? 60);
for (const fp of [0, 0.015, 0.06, 0.15]) {
  console.log(`\n=== ${scenario}, p_false_positive=${fp}, ${n} matches ===`);
  const rows = runBalance(scenario, n, fp);
  console.log(
    'doctrine'.padEnd(15),
    'win%'.padStart(6),
    'ownPop%'.padStart(8),
    'globPop%'.padStart(9),
    'firedOnFP%'.padStart(11),
  );
  for (const r of rows)
    console.log(
      r.doctrine.padEnd(15),
      String(r.winPct).padStart(6),
      String(r.avgOwnPct).padStart(8),
      String(r.avgGlobalPct).padStart(9),
      String(r.launchedAfterFalsePositivePct).padStart(11),
    );
}
