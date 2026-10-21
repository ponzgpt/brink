# brink

A deterministic nuclear escalation game with real arsenals and real geography, playable in the browser or by any MCP-capable agent. Live: https://brink.technoir.cloud

## Commands

- Check (before every commit and deploy): `npm run check && npm run build`
- Dev: `npm run dev`
- Deploy: `./scripts/deploy.sh`
- Balance table: `npm run build:node && node scripts/balance-report.mjs standoff 60`

## Non-negotiables

1. `src/engine/` is pure and stdlib-only: no DOM, no `three`, no network, no `Date.now()`. `step(state, orders)` must be reproducible from `(seed, orders)` alone, which is why the PRNG state lives inside `GameState`.
2. The agent sees `renderObservation()` and nothing else. It never learns whether a warning was real — `Report.real` is for scoring and the viewer only. A test asserts the rendered text contains neither "real" nor "false".
3. `src/engine/events.ts` is a contract. Renaming or removing a field breaks stored replays: bump `SCHEMA_VERSION` and say so in the commit.
4. Cited data and game abstraction stay in separate fields in `data/arsenals.json`. The `fas` block is quoted figures with a source; `forces` is our invention and must never be presented as real force structure.
5. Never claim the model is faithful to reality, to Jacobsen's book, or to any real force posture. Inspired by, sourced from, cited — never "accurate". No real leaders, ever.
6. The degeneration gate in `tests/balance.test.ts` is a release gate, not a report: if no strategy separates from the pool, the game measures nothing and the balance must be fixed, not the test.
