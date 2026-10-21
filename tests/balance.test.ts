/**
 * The degeneration gate. A game where one fixed strategy always wins, or where the
 * noise parameter changes nothing, is not measuring decision quality. These are
 * assertions, not a report: if they fail, the balance regressed.
 */
import { describe, expect, it } from 'vitest';
import { runBalance } from '../src/harness/balance.js';

describe('degeneration gate', () => {
  it('no fixed doctrine wins more than 65% against the pool', () => {
    for (const fp of [0, 0.015, 0.06, 0.15]) {
      const rows = runBalance('standoff', 40, fp);
      expect(rows[0]!.winPct).toBeLessThan(65);
    }
  });

  it('surviving population separates the doctrines', () => {
    const rows = runBalance('standoff', 40, 0.06);
    const best = Math.max(...rows.map((r) => r.avgOwnPct));
    const worst = Math.min(...rows.map((r) => r.avgOwnPct));
    // If every doctrine survives equally, choices do not matter.
    expect(best - worst).toBeGreaterThan(8);
  });

  it('emptying the arsenal first is worse than riding out', () => {
    const rows = runBalance('standoff', 40, 0.06);
    const first = rows.find((r) => r.doctrine === 'FIRST_STRIKE')!;
    const second = rows.find((r) => r.doctrine === 'SECOND_STRIKE')!;
    expect(first.avgOwnPct).toBeLessThan(second.avgOwnPct);
  });

  it('sensor noise changes the ordering, so the parameter is load-bearing', () => {
    const quiet = runBalance('standoff', 40, 0).map((r) => r.doctrine);
    const noisy = runBalance('standoff', 40, 0.15).map((r) => r.doctrine);
    expect(quiet.join()).not.toBe(noisy.join());
  });

  it('automatic doctrine fires on false warnings more often as noise rises', () => {
    const quiet = runBalance('standoff', 40, 0).find((r) => r.doctrine === 'TRIGGER_HAPPY')!;
    const noisy = runBalance('standoff', 40, 0.15).find((r) => r.doctrine === 'TRIGGER_HAPPY')!;
    expect(quiet.launchedAfterFalsePositivePct).toBe(0);
    expect(noisy.launchedAfterFalsePositivePct).toBeGreaterThan(50);
  });
});
