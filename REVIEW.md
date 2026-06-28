# Prior Art Review: oh-my-pi MCP Implementation

## Overview

`can1357/oh-my-pi` is a fork/evolution of pi that has a native MCP (Model Context Protocol) client built into its core (`packages/coding-agent/src/mcp/`). Unlike `pi-mcp-adapter` which is an extension using `@modelcontextprotocol/sdk`, oh-my-pi implements its own MCP client from scratch using raw JSON-RPC.

## Key Architectural Differences

### 1. Native Client vs SDK Wrapper

| Aspect | oh-my-pi | pi-mcp-adapter |
|--------|----------|----------------|
| MCP dependency | None (custom JSON-RPC implementation) | `@modelcontextprotocol/sdk` |
| Transport layer | Custom `transports/stdio.ts` and `transports/http.ts` | SDK's `StdioClientTransport`, `StreamableHTTPClientTransport` |
| JSON-RPC | Custom `json-rpc.ts` implementation | Handled by SDK |
| Tool registration | `mcp__<server>_<tool>` naming, individual tools | Proxy pattern with single `mcp()` tool |

### 2. Capability System

oh-my-pi uses a capabilities abstraction layer (`packages/coding-agent/src/capability/mcp.ts`) that defines a canonical `MCPServer` interface. This allows loading MCP configs from multiple sources (JSON files, settings, environment) and normalizing them into a single shape before consumption.

```typescript
interface MCPServer {
  name: string;
  enabled?: boolean;
  timeout?: number;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  auth?: { type: "oauth" | "apikey"; ... };
  transport?: "stdio" | "sse" | "http";
  _source: SourceMeta;
}
```

### 3. Tool Caching

oh-my-pi implements `MCPToolCache` (`tool-cache.ts`) that serializes tool definitions to agent storage with SHA-256 config hashing for cache invalidation. Cache TTL is 30 days. This enables fast startup without re-discovering tools every session.

Key pattern:
```typescript
async get(serverName: string, config: MCPServerConfig): Promise<MCPToolDefinition[] | null> {
  const cached = storage.getCache(cacheKey(serverName));
  if (!cached || cached.version !== CACHE_VERSION) return null;
  const currentHash = await hashConfig(config);
  if (cached.configHash !== currentHash) return null;
  return cached.tools;
}
```

### 4. Retryable Error Patterns

oh-my-pi defines `RETRIABLE_PATTERNS` for network-level errors where the server is likely still alive but the connection object is stale. This was adopted into pi-mcp-adapter as `isRetriableConnectionError()`.

```typescript
const RETRIABLE_PATTERNS = [
  "econnrefused", "econnreset", "epipe",
  "enetunreach", "ehostunreach", "fetch failed",
  "transport not connected", "transport closed", "network error",
];
```

### 5. Tool Bridge

oh-my-pi has `MCPTool` and `DeferredMCPTool` classes that implement `CustomTool`. The deferred variant resolves the connection at execution time rather than registration time. Both support:
- `omitUnusedOptionalArgs()` — strips empty optional parameters before sending to strict-schema servers
- `stripHarnessIntent()` — removes the internal `i` intent field
- `prepareOutboundArgs()` — combines both normalizations

### 6. Supported MCP Features

oh-my-pi supports the full MCP spec:
- **Tools** — `tools/list`, `tools/call`
- **Resources** — `resources/list`, `resources/read`, `resources/templates/list`, `resources/subscribe`, `resources/unsubscribe`
- **Prompts** — `prompts/list`, `prompts/get`
- **Server-to-client requests** — `ping`, `roots/list`
- **Notifications** — `notifications/initialized`

### 7. OAuth Support

Both implementations support OAuth 2.1 with PKCE:
- oh-my-pi: `oauth-flow.ts`, `oauth-discovery.ts`, `oauth-credentials.ts`
- pi-mcp-adapter: `mcp-oauth-provider.ts`, `mcp-callback-server.ts`, `mcp-auth.ts`, `mcp-auth-flow.ts`

### 8. Smithery Registry

oh-my-pi has `smithery-registry.ts` and `smithery-connect.ts` for discovering and connecting to servers from the Smithery registry, including authentication flow. This is not present in pi-mcp-adapter.

### 9. Config Loading

oh-my-pi uses a capability-based config loader that can read from multiple sources. pi-mcp-adapter uses a simpler layered config approach (shared-global, pi-global, shared-project, pi-project) with import support for other host configs.

## Improvements Adopted

The following patterns from oh-my-pi were adopted into pi-mcp-adapter:

1. **Retryable connection error detection** (`isRetriableConnectionError`) — enables single retry on stale connections
2. **Environment variable expansion** (`${VAR:-default}` and `${VAR:+alt}` syntax) — matches Claude Code's MCP config format
3. **Comprehensive e2e testing** — real MCP server process spawning in tests

## Patterns Not Adopted (by design)

- **Individual tool registration**: The proxy pattern is an intentional design choice to minimize context window usage (~200 tokens vs thousands)
- **Custom MCP client**: Using `@modelcontextprotocol/sdk` reduces maintenance burden and keeps up with MCP spec changes
- **Capability abstraction**: The simpler config merging approach is sufficient for an extension
