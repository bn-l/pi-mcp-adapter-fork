# Security Audit: pi-mcp-adapter v2.10.0

**Date**: 2026-06-28
**Auditor**: pi coding agent
**Scope**: `nicobailon/pi-mcp-adapter` (npm package `pi-mcp-adapter`)

## Executive Summary

**Verdict: CLEAN** — No malicious code, no data exfiltration, no telemetry, no obfuscation found.

## Methodology

1. Grep for network I/O patterns (`fetch`, `http`, `https`, `request`, `axios`)
2. Grep for filesystem access to sensitive paths (`~/.ssh`, `~/.aws`, `.env`, `password`, `secret`, `token`)
3. Grep for code execution patterns (`eval`, `child_process`, `spawn`, `require()`, dynamic `import`)
4. Grep for obfuscation indicators (`base64`, `atob`, `btoa`, `Function()`, `new Function`)
5. Grep for exfiltration patterns (`telemetry`, `exfil`, `send data`, `post url`, `upload`, `webhook`, `analytics`, `report`, `phone home`)
6. Manual review of all TypeScript source files
7. Manual review of bundled JavaScript (`app-bridge.bundle.js`)

## Findings

### Network I/O

| Pattern | Files | Legitimate? | 
|---------|-------|-------------|
| `http://` | `ui-server.ts`, `mcp-callback-server.ts`, test files | ✅ Localhost only — OAuth callback server on `127.0.0.1:19876` and UI proxy server on `127.0.0.1`. No external connections. |
| `https://` | `mcp-oauth-provider.ts` | ✅ Uses MCP SDK's OAuth discovery (RFC 9728) to discover OAuth endpoints from user-configured server URLs |
| `fetch` | MCP SDK internals only | ✅ Used by `@modelcontextprotocol/sdk` for StreamableHTTP transport to user-configured MCP server URLs |
| `request` | MCP SDK internals, test files | ✅ JSON-RPC protocol to user's MCP servers |
| `open` package | `mcp-auth-flow.ts` | ✅ Opens browser for OAuth authorization at user-configured server URLs |
| `child_process.spawn` | `npx-resolver.ts`, `glimpse-ui.ts` | ✅ Resolving npm binary paths (npx-resolver), launching system browser (glimpse-ui) |
| `child_process.execFileSync` | `glimpse-ui.ts` | ✅ Launching TUI applications like `fzf` — user-initiated |

**Conclusion**: ALL network calls go to user-configured MCP server URLs or localhost. No external telemetry, analytics, or data collection endpoints.

### Filesystem Access to Sensitive Paths

| Pattern | Files | Assessment |
|---------|-------|------------|
| `process.env` | Multiple files | ✅ Standard env var reading for MCP server configuration (API keys, tokens). No env vars are sent anywhere except to the user's configured MCP servers. |
| `HOME` / `homedir()` | `utils.ts`, `config.ts` | ✅ Used to resolve `~` in user-configured paths and locate config files. No unauthorized access. |
| `~/.ssh` | NOT FOUND | ✅ No access to SSH keys |
| `~/.aws` | NOT FOUND | ✅ No access to AWS credentials |
| `.env` | NOT FOUND | ✅ No reading of `.env` files |
| `password` | NOT FOUND | ✅ No credential harvesting |
| `secret` / `token` | `utils.ts` (bearerToken), `mcp-oauth-provider.ts` (client_secret), `mcp-auth.ts` | ✅ Token handling for user-configured OAuth flows. Tokens stored in `~/.pi/agent/mcp-auth/` with file permissions. |

**Conclusion**: Filesystem access is limited to pi's config directory and user-specified paths. No access to sensitive system files.

### Code Execution

| Pattern | Files | Assessment |
|---------|-------|------------|
| `child_process.spawn` | `npx-resolver.ts` | ✅ Runs `npx --version` / `npm --version` to detect Node ecosystem. No arbitrary command execution. |
| `child_process.execFileSync` | `glimpse-ui.ts` | ✅ Launches fzf/peco for TUI selection, user-initiated |
| `pi.exec()` | `utils.ts` (openUrl, openPath) | ✅ Uses pi's exec API to open URLs/paths with system default. Standard `open`/`xdg-open`/`start` commands. |
| `eval` | NOT FOUND in source | ✅ No dynamic eval |
| `Function()` | NOT FOUND in source | ✅ No Function constructor |
| `require()` | NOT FOUND in source | ✅ All imports are static ESM `import` statements |

### Bundled Code Review

**`app-bridge.bundle.js`** (67 lines, minified):
- Content: Bundled Zod v4 validation library for client-side form validation in the browser-based UI
- Identified by: `var s={};$e(s,{$brand:()=>pn,...` — matches Zod v4's build output
- The bundle also includes a small `PostMessageTransport` bridge for browser ↔ server communication
- No network calls, no data collection, no obfuscation beyond standard minification

### Telemetry / Exfiltration

| Pattern | Found? |
|---------|--------|
| `telemetry` | ❌ Not found |
| `exfil` | ❌ Not found |
| `analytics` | ❌ Not found |
| `report install` | ❌ Not found |
| `phone home` | ❌ Not found |
| `webhook` | ❌ Not found |
| `upload` | ❌ Not found |
| `send data` (to external) | ❌ Not found |
| `POST` to external URLs | ❌ Not found (all POSTs are JSON-RPC to user's MCP servers) |

## Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| MCP server process execution | MEDIUM | User explicitly configures which commands to run. This is by design — MCP servers are arbitrary processes. |
| OAuth token storage | LOW | Tokens stored in `~/.pi/agent/mcp-auth/`. Standard OAuth 2.1 with PKCE. |
| Browser-based UI | LOW | Serves localhost only, no external content loaded beyond user-configured MCP server URIs. |
| Supply chain (dependencies) | LOW | Standard MCP SDK, Zod, and minimal other deps. `npm audit` reports 0 vulnerabilities. |

## Conclusion

`pi-mcp-adapter` is a legitimate, well-written pi extension. It contains no malware, spyware, data exfiltration, or telemetry. All network activity is explicitly initiated by the user's MCP server configuration. The code is clean, well-structured, and follows security best practices (PKCE for OAuth, localhost-only servers, safe process lifecycle management).
