# brink

A twenty-six minute nuclear crisis, playable in the browser or by any MCP-capable agent. Live: https://brink.technoir.cloud

## Commands

- Check (before every commit and deploy): `npm run check && npm run build`
- Dev: `npm run dev`
- Deploy: `./scripts/deploy.sh`

## Non-negotiables

1. `src/engine/` is pure and stdlib-only: no DOM, no `three`, no network, no `Date.now()`. `step(state, orders)` must be reproducible from `(seed, orders)` alone, which is why the PRNG state lives inside `GameState`.
2. The player and the agent see the same thing, and neither is ever told whether a warning was real. `Report.real` is for the record only; a test asserts the rendered brief contains no such word.
3. The clock does not wait, and authorisation costs minutes. Anything that lets the player stop time or skip a step removes the only pressure the game has.
4. The decision window closes at `maxTicks`, but the match continues until the board is clear. A release at minute twenty-five must still land.
5. There is no winner and the code must not imply one — no ranking, no score, no victory state. The record's headline figure is the dead.
6. `src/engine/events.ts` is a contract. Renaming or removing a field breaks stored logs: bump `SCHEMA_VERSION` and say so in the commit.
7. Cited data and game abstraction stay in separate fields in `data/arsenals.json`. The `fas` block is quoted figures; `forces` is ours and must never be presented as real force structure.
8. Never claim fidelity — to reality, to Jacobsen's book, or to any force posture. Inspired by, sourced from, cited. No real leaders.
9. The terminal is monochrome. Powers are distinguished by shape, never by hue, because a period phosphor screen had one colour.
10. Audio is synthesised at runtime. No media files in the repo.
