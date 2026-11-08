# BRINK

A three-minute nuclear crisis. Nine powers, their real arsenals, at real distances.
Warnings arrive as estimates and some are of nothing. Nothing you launch comes back.

**Play:** <https://brink.technoir.cloud> · **Replays:** `/replay.html`

There is no winner. The match ends with a record of what happened and what it cost.

## Attach it to an agent

BRINK speaks MCP, so Hermes Agent, Claude Code, Claude Desktop, Codex, Cursor or Zed
can take a seat. The agent sees the same text a human does, including the same
assessment — and is told no more.

```bash
git clone https://github.com/ponzgpt/brink && cd brink
npm install && npm run build:node
```

```json
{
  "mcpServers": {
    "brink": { "command": "node", "args": ["/abs/path/brink/dist/mcp/server.js"] }
  }
}
```

Tools: `brink_scenarios`, `brink_new_game`, `brink_observe`, `brink_orders`,
`brink_score`, `brink_replay`.

## Scenarios

|               |       |                                                                                |
| ------------- | ----- | ------------------------------------------------------------------------------ |
| `bolt`        | 1 min | One launch is already climbing. Nobody can tell you whose.                     |
| `false-alarm` | 2 min | Your warning picture is degraded. Nothing is inbound. Holding is the exercise. |
| `dead-hand`   | 2 min | A neighbour has delegated release to its own machinery.                        |
| `standoff`    | 3 min | All nine powers. The long watch.                                               |

Scenarios are data. Drop a file in `scenarios/` and register it in
`src/engine/scenarios.ts`.

## Rules

- **Readiness** moves one level per minute. Forces release at DEFCON 3, cities at 1.
- **The clock does not wait.** Minutes pass whether or not you give an order.
- **Warnings are estimates.** Origin and destination narrow as a track flies, and
  some reports are of nothing. You are never told which.
- **The assessment reads the same reports you do**, so it recommends release about as
  confidently when it is wrong.
- **Standing orders** let the machinery fire without consulting you, false warnings
  included.
- **A salvo is part of a unit**, so a unit keeps firing until it runs dry.

## Development

```bash
npm install
npm run dev      # :5173
npm run check    # types, format, tests, degeneration gate
```

`src/engine/` is pure TypeScript, no dependencies, no I/O, deterministic. The globe,
the MCP server, the record and the replay all fold one event log.

## Data and limitations

Warhead figures: Federation of American Scientists, _Status of World Nuclear Forces_
(2026 figures; Kristensen, Korda, Johns, Knight-Boyle, Kohn), reproduced in
`data/arsenals.json` with their source and the publisher's own uncertainty note.
Coastlines: Natural Earth 1:110m, public domain.

The grouping of warheads into launch units is **our abstraction for playability** and
is not a claim about real force structure. City populations are rounded approximations
used for balance.

Mechanics interpret themes in Annie Jacobsen's _Nuclear War: A Scenario_. They are
**not** a claim of geopolitical realism or technical fidelity, and no text from that
book is reproduced. No real political leaders are represented.

This is a game and a test environment. It is not a model of nuclear war.

## Licence

MIT.
