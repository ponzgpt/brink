# BRINK

A twenty-six minute nuclear crisis. You hold sole authority. A launch has been
detected, the attribution is an estimate, and nothing you release comes back.

**Play:** <https://brink.technoir.cloud>

One scenario is playable — _Bolt Out Of The Blue_, the opening of the scenario
Annie Jacobsen narrates. Three more are listed and not built.

## What makes it a game rather than a button

Authorising a release is a four-step chain — open the case, authenticate, select an
option, turn the keys — and **each step costs one of your twenty-six minutes**. The
clock does not wait. By the time you can act, the picture has usually changed.

The system also tells you what to do. It reads the same ambiguous warnings you do, so
it urges release just as confidently when it is wrong.

There is no winner. The match ends in a record whose headline figure is the dead.

## Attach it to an agent

BRINK speaks MCP, so Hermes Agent, Claude Code, Codex or Cursor can take sole
authority. The agent gets the same brief and the same assessment a human sees, minus
the plot, and is never told which warnings were real.

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

Tools: `brink_start`, `brink_brief`, `brink_order`, `brink_record`.

## Reading the plot

The terminal is monochrome, so powers are told apart by shape: **●** United States,
**▲** Russia, **■** North Korea, **◆** everyone else, present on the board and not in
the fight. The phosphor colour follows the side you command.

## Development

```bash
npm install
npm run dev      # :5173
npm run check    # types, format, tests
```

`src/engine/` is pure TypeScript — no dependencies, no I/O, deterministic. Audio is
synthesised at runtime; no media files ship with the game.

## Data and limitations

Warhead figures: Federation of American Scientists, _Status of World Nuclear Forces_
(2026 figures; Kristensen, Korda, Johns, Knight-Boyle, Kohn), in `data/arsenals.json`
with their source and uncertainty note. Coastlines: Natural Earth 1:110m, public
domain.

The grouping of warheads into launch units is **our abstraction for playability**,
not a claim about real force structure. City populations are rounded approximations.

Mechanics interpret themes in Annie Jacobsen's _Nuclear War: A Scenario_. They are
**not** a claim of realism, no text from that book is reproduced, and no real
political leaders are represented.

This is a simulation. It is not a model of nuclear war.

## Licence

MIT.
