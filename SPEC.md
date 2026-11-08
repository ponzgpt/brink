# BRINK — V1 specification

> What this is, what it deliberately is not, and where the seams are. Read with
> `AGENTS.md`, which holds the rules that bind every change.

## 1. What it is

A three-minute nuclear crisis. Nine powers, their published arsenals, real distances.
One tick is one minute. A human plays it in real time, against a clock that does not
wait; an agent plays the identical match over MCP with no clock at all. Same engine,
two pacings — `Config.tickMs` is honoured only by the browser.

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

## 4. What it is trying to get right

The subject is not the exchange, it is the decision taken before anyone knows
anything. Four things follow from that and are not negotiable:

1. **The clock is the opponent.** Not the other powers. Minutes pass whether or not an
   order is given, and readiness takes minutes to change, so the decision to be _able_
   to answer is itself a commitment made under uncertainty.
2. **The warning is an estimate and the player is never told which ones are real.**
   Origin and destination narrow as a track flies. Some reports are of nothing.
3. **The machinery recommends.** `advisory.ts` reads the same ambiguous reports the
   player does and says what to do. It is confidently wrong exactly as often as they
   are, which is the mechanism the scenario literature is actually about.
4. **No winner.** The match ends in a record whose headline is the dead. Anything that
   ranks players by how well they survived an exchange implies a good exchange exists.

## 5. Rules

**Readiness.** DEFCON 5→1, one level per minute. Counter-force release at 3,
counter-value at 1. The ladder is the central decision: staying high means you cannot
answer for two minutes; staying at 1 means a bad minute is irreversible at once.

**Forces.** Land groups launch the minute ordered and can be destroyed on the ground.
Boats need one minute of spin-up and are hidden until they fire, after which they can
be hunted.

**Salvos.** A launch releases `salvoWarheads`, not the whole unit. One shot per unit
left most arsenals unused and most matches flat; salvos put the decision back in every
minute and let a match actually escalate.

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

## 6. Numbers and where they came from

`data/arsenals.json` separates two things that must never be conflated:

- `fas` — warhead figures quoted from the Federation of American Scientists, _Status of
  World Nuclear Forces_ (2026 figures), with authors, URL, retrieval date and the
  publisher's own uncertainty note.
- `forces` — the grouping of those warheads into a handful of launch units. **This is
  our invention**, chosen so a match is playable, and it is not a claim about real
  installations or force structure.

City populations are rounded metropolitan approximations used for balance and are
deliberately not presented as a cited dataset.

## 7. The degeneration gate

`tests/balance.test.ts` runs the doctrine pool across a sweep of sensor noise and fails
if:

1. any fixed doctrine wins more than 65% against the pool;
2. surviving population fails to separate the doctrines by at least 8 points;
3. emptying the arsenal first beats riding out;
4. the noise parameter stops changing the ordering;
5. automatic doctrine stops firing more often as noise rises.

These are release gates, not reports. A failure means the balance regressed and must be
fixed — never that the threshold should move.

## 8. Known limits

- Win rate is a weak discriminator with nine powers; surviving population is the signal.
  The scoreboard leads with population for that reason.
- Command and control is not modelled: no decapitation, no degradation of orders.
- No messaging, no diplomacy, no alliances.
- A launch targets a power and a target class; the engine picks the aimpoint. This keeps
  the order space small enough for a small model to be reliable, at the cost of
  targeting nuance.
- The 3D library is ~147 kB gzipped. It is loaded on demand, so first paint costs
  about 15 kB, but anyone who starts a match still pays for it.
- Scripted doctrines are cautious, so an unattended round-robin stays fairly peaceful.
  Fine for the gate, which measures separation rather than drama, but it understates
  how violent a human or agent match becomes.
- No model has played a match yet. The protocol is verified; the behaviour is not.
- Interceptors are not modelled at all. Their real-world test record would argue for
  including them only to have them mostly fail, which adds a die roll and no decision.
- Command and control cannot be attacked, so there is no decapitation and no question
  of who is left to decide.

## 9. Visual register

A Cold War command console seen from the American side: olive-charcoal housing, bone
lettering, amber phosphor behind glass, caution yellow and warning red used only where
something is being warned about. Tracks in flight are the one cool colour on the board,
which is what makes the plot read as incoming data. Tokens live in
`src/web/tokens.css` and nowhere else.

The big-board arrangement is a nod to the film the genre comes from, not a copy of it:
the arrangement and the cold-track-on-warm-housing contrast are taken, the palette and
the typography are not.

Two defaults were rejected on the way here. Green-on-black terminal is burnt out by
cinema and signals "hacker project" rather than "instrument". Black-on-white document
reads as a spreadsheet and makes the one screen on the page look pasted in. The whole
page is now the housing and the globe is the glass, which is why the bezel is the
heaviest border in the stylesheet.

No Soviet iconography, no real leaders, no mushroom clouds, no casualty counter as a
hook. Population is a number on a panel.

## 10. Design stance

Where realism and playability conflict, playability wins and the deviation is written
down. Readiness releases a level earlier than the ladder would suggest, salvos exist so
arsenals get used, and the default scenario opens with a launch already in the air —
all three because a match that spends its first three minutes doing nothing is a worse
game, not a more honest one. The things that stay faithful are the ones a reader can
check: the arsenals, the distances, and the flight times that fall out of them.

## 11. Deliberately deferred

Global leaderboard with accounts and a database. A client that reports its own score is
trivially forgeable; the fix is server-side replay verification, which the deterministic
engine makes possible. That is the reason determinism is a non-negotiable rather than a
preference.
