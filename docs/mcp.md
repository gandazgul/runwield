# MCP Tools

RunWield can start trusted stdio Model Context Protocol (MCP) servers and expose their tools to root Agents.

## Configuration files

Use a dedicated MCP file. Do not put MCP commands or secrets in `settings.json`.

- Global file: `~/.wld/mcp.json`
- Project-local file: `.wld/mcp.json` in the primary checkout

Project-local MCP files are executable configuration. Keep them local:

```gitignore
.wld/mcp.json
```

RunWield uses a project file only when it is a regular file, untracked, not staged, and ignored by Git. If the file can
be committed, RunWield skips it and shows a warning.

Both files are JSONC and should use mode `0600` on POSIX systems.

## File shape

```jsonc
{
    "mcpServers": {
        "project-tools": {
            "command": "my-mcp-server",
            "args": ["--stdio"],
            "env": { "TOKEN": "secret-value" }
        },
        "disabled-global-server": {
            "enabled": false
        }
    }
}
```

Project entries replace complete global entries with the same name. RunWield never merges `command`, `args`, or `env`
from two entries. A project entry with `enabled: false` disables a global server for that Project.

ACP clients can also send stdio MCP servers in `session/new` and `session/load`. Those servers are in memory only and
are not written to disk.

## Supported scope

This version supports stdio MCP tools only. It does not support HTTP, SSE, MCP prompts, MCP resources as active context,
or dynamic `tools/list_changed` updates. Restart the Session or run `/reload` to read new tool lists.

A server that fails to start, initialize, or list tools is skipped. The Session continues and shows a redacted warning.

## Trust model

MCP servers are trusted code. They can run commands and receive the plaintext environment values that you configure.
RunWield redacts warnings, but the MCP child process controls its own logs.

MCP tool schemas do not reliably say whether a tool only reads data or can change state. RunWield exposes configured MCP
tools to every root Agent. Delegated Agents and isolated validation/review Agents keep their normal tool ceilings and do
not inherit these tools.
