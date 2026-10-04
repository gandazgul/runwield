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

RunWield uses Pi's official
[built-in MCP extension](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/mcp.md). Pi owns
connection management, discovery, native tool names, result conversion, resources, reconnection, and shutdown. RunWield
keeps trusted configuration loading, Session ownership, and root Agent access rules.

The current configuration accepts stdio servers and exposes their tools directly. HTTP, OAuth, MCP prompts, and codemode
remain separate work. A server that fails to connect or discover tools produces a redacted warning; the Session remains
usable.

Tools now use Pi's native `mcp__<server>__<tool>` names, replacing RunWield's earlier `mcp_<server>_<tool>` aliases. Pi
adds a stable hash suffix when names collide or exceed the provider limit. Configuration paths remain unchanged.

Pi root Agents receive live `tools/list_changed` updates: new tools become available and withdrawn tools become
unreachable. External CLI Agents refresh the available MCP tools between turns. Connections survive root Agent handoffs
and close with the owning Session. `/reload` rereads configuration.

Servers with resources expose Pi's `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource` tools.
Resources are read on request. Text and images reach the model, structured MCP results remain available as structured
output, and server-reported errors are marked as errors. Pi limits model-facing text to 20 KiB, saving full oversized
output to a private temporary file named in the result. Progress notifications appear as tool updates.

Use `/mcp` in a RunWield session to print Pi's server status, including tool counts and connection details. Use
`/mcp reconnect <server>` to reconnect a server. These commands make no model request. Automatic startup warnings are
redacted; explicitly requesting status can display the server's error text and stderr. The interactive Pi manager,
configuration editing, and sign-in UI are not exposed in this slice. The shell command `wld mcp agy-cli` remains the
separate stdio adapter for Antigravity.

## Trust model

MCP servers are trusted code. They can run commands and receive the plaintext environment values that you configure.
RunWield redacts warnings, but the MCP child process controls its own logs. The child inherits a minimal
operating-system environment plus the values in its configured `env`, rather than all credentials from the RunWield
process.

MCP tool schemas do not reliably say whether a tool only reads data or can change state. RunWield exposes configured MCP
tools to every root Agent. Delegated Agents and isolated validation/review Agents keep their normal tool ceilings and do
not inherit these tools.
