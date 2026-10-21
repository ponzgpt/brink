# Hermes Agent skill

`brink/SKILL.md` follows the open skill format used by Hermes Agent's Skills Hub. Copy
the `brink/` directory into your agent's skills directory, and configure the MCP server
alongside it:

```json
{ "mcpServers": { "brink": { "command": "npx", "args": ["-y", "brink-mcp"] } } }
```

The skill supplies the strategy context; the MCP server supplies the game. Neither is
useful without the other.
