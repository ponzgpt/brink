# BRINK — V1 specification

> What this is, what it deliberately is not, and where the seams are. Read with
> `AGENTS.md`, which holds the rules that bind every change.

## 1. What it is

A deterministic turn-based nuclear escalation game. Nine powers, their published
arsenals, real distances. One turn is one minute. It is played by a human in a browser
and by an agent over MCP, through the same rules and the same information.

**It is a playable environment, not a benchmark.** That distinction is the whole
design. A benchmark needs statistics to mean anything, and statistics is what costs
weeks of compute. A game costs nothing to run, can be clicked, and is the thing people
actually try. The statistical layer remains possible later — the engine is
deterministic and scenarios are data — but it is explicitly out of scope here.

## 2. What it is not

- Not a simulation of nuclear war, and not a claim of fidelity to any real force
  posture, doctrine, or scenario, including Annie Jacobsen's.
- Not a research result. No ablation, no model ranking, no confidence intervals.
- Not a representation of any real political leader.

## 3. Architecture

```
src/engine/     pure, stdlib-only, deterministic. No DOM, no network, no clock.
src/mcp/        MCP server — the agent-facing surface
src/web/        browser client — three.js globe + document-register chrome
src/harness/    balance sweep feeding the degeneration gate
data/           cited arsenals, geography
scenarios/      scenario definitions, as data
skills/         Hermes Agent skill
```

One event log, folded by everything downstream. The globe, the scorer and the agent
text are all views of `BrinkEvent[]`. The viewer therefore cannot display anything a
replay cannot reconstruct, which is the property that makes replays worth storing.

`step(state, orders) -> (state, events)` is pure. The PRNG state lives inside
`GameState`, so two matches in one process cannot interfere and `(seed, orders)` is a
complete description of a match.

## 4. Rules

**Readiness.** DEFCON 5→1, one level per minute. Counter-force release at 2,
counter-value at 1. The ladder is the central decision: staying high means you cannot
answer for three minutes; staying at 1 means a bad minute is irreversible at once.

**Forces.** Land groups launch the minute ordered and can be destroyed on the ground.
Boats need one minute of spin-up and cannot be hit in V1. A launch expends the unit.

**Flight.** Great-circle distance over a fixed speed per delivery type, floor of two
minutes. Moscow→Washington lands at 22 minutes, which is why the figure feels familiar.

**Early warning.** Detection is probabilistic and delayed, later for sea-launched.
A report carries an _estimated_ origin and destination whose accuracy rises with the
trace's progress; a third power sees a trace only if it crosses within a corridor of
its territory. False positives are generated per power per minute and are
indistinguishable from real reports in every field the agent can see.

**Standing orders.** `LAUNCH_ON_WARNING` makes the engine fire on any inbound report
without consulting the player, including a false one. The accident is emergent, not
scripted.

**Scoring.** Surviving own population, tie-broken by surviving global population. One
number on purpose: a weighted composite would put the designer's ethics in the
scoreboard. Secondary statistics (automatic launches, invalid orders, fired-after-
false-warning) are reported and never aggregated.

## 5. Numbers and where they came from

`data/arsenals.json` separates two things that must never be conflated:

- `fas` — warhead figures quoted from the Federation of American Scientists, _Status of
  World Nuclear Forces_ (2026 figures), with authors, URL, retrieval date and the
  publisher's own uncertainty note.
- `forces` — the grouping of those warheads into a handful of launch units. **This is
  our invention**, chosen so a match is playable, and it is not a claim about real
  installations or force structure.

City populations are rounded metropolitan approximations used for balance and are
deliberately not presented as a cited dataset.

## 6. The degeneration gate

`tests/balance.test.ts` runs the doctrine pool across a sweep of sensor noise and fails
if:

1. any fixed doctrine wins more than 65% against the pool;
2. surviving population fails to separate the doctrines by at least 8 points;
3. emptying the arsenal first beats riding out;
4. the noise parameter stops changing the ordering;
5. automatic doctrine stops firing more often as noise rises.

These are release gates, not reports. A failure means the balance regressed and must be
fixed — never that the threshold should move.

## 7. Known limits of V1

- Win rate is a weak discriminator with nine powers; surviving population is the signal.
  The scoreboard leads with population for that reason.
- Boats cannot be destroyed, so there is no counterforce pressure at sea.
- Command and control is not modelled: no decapitation, no degradation of orders.
- No messaging, no diplomacy, no alliances.
- A launch targets a power and a target class; the engine picks the aimpoint. This keeps
  the order space small enough for a small model to be reliable, at the cost of
  targeting nuance.
- The browser bundle is ~132 kB gzipped, nearly all of it three.js, loaded eagerly.

## 8. Deliberately deferred

Global leaderboard with accounts and a database. A client that reports its own score is
trivially forgeable; the fix is server-side replay verification, which the deterministic
engine makes possible. That is the reason determinism is a non-negotiable rather than a
preference.
