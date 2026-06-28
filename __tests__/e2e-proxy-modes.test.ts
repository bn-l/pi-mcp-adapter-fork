/**
 * E2E tests for proxy-modes.ts — status, search, list, connect,
 * describe, call, auth-start.
 *
 * Uses real MCP stdio server for call/connect/describe/search/list.
 * Status and auth-start use constructed state.
 */
import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { McpServerManager } from "../server-manager.ts";
import { buildToolMetadata } from "../tool-metadata.ts";
import {
  executeCall,
  executeConnect,
  executeDescribe,
  executeList,
  executeSearch,
  executeStatus,
  executeAuthStart,
  executeUiMessages,
} from "../proxy-modes.ts";
import type { McpExtensionState } from "../state.ts";
import type { ServerDefinition, ToolMetadata } from "../types.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/e2e-server.mjs", import.meta.url));
const DEFINITION: ServerDefinition = { command: process.execPath, args: [FIXTURE] };
const PREFIX = "mcp";

const managers: McpServerManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map(m => m.closeAll().catch(() => {})));
});

async function connectAndBuildState(serverName: string): Promise<McpExtensionState> {
  const manager = new McpServerManager();
  managers.push(manager);
  const connection = await manager.connect(serverName, DEFINITION);
  const { metadata } = buildToolMetadata(connection.tools, connection.resources, DEFINITION, serverName, PREFIX);

  return {
    config: { mcpServers: { [serverName]: DEFINITION } },
    manager,
    toolMetadata: new Map([[serverName, metadata]]),
    failureTracker: new Map(),
    completedUiSessions: [],
  } as unknown as McpExtensionState;
}

describe("E2E Proxy Modes", () => {
  it("executeStatus shows connected server (e2e)", () => {
    const state = {
      config: { mcpServers: { demo: DEFINITION } },
      manager: new McpServerManager(),
      toolMetadata: new Map([["demo", [
        { name: "demo_echo", originalName: "echo", description: "Echo" },
        { name: "demo_add", originalName: "add", description: "Add" },
      ] as ToolMetadata[]]]),
      failureTracker: new Map(),
    } as unknown as McpExtensionState;

    const result = executeStatus(state);
    expect(result.content[0].text).toContain("0/1 servers");
    expect(result.content[0].text).toContain("2 tools");
    expect(result.details).toMatchObject({ totalTools: 2, connectedCount: 0 });
  });

  it("executeStatus with connected server (e2e)", async () => {
    const state = await connectAndBuildState("status-test");

    const result = executeStatus(state);
    expect(result.content[0].text).toContain("1/1 servers");
    expect(result.content[0].text).toContain("✓ status-test");
    expect(result.details).toMatchObject({ connectedCount: 1 });
  });

  it("executeList shows tool names (e2e)", async () => {
    const state = await connectAndBuildState("list-test");

    const result = executeList(state, "list-test");
    expect(result.content[0].text).toContain("list-test");
    expect(result.details).toMatchObject({ server: "list-test" });
    expect((result.details as any).count).toBeGreaterThanOrEqual(5);
  });

  it("executeList returns error for unknown server", () => {
    const state = {
      config: { mcpServers: {} },
      toolMetadata: new Map(),
      manager: new McpServerManager(),
      failureTracker: new Map(),
    } as unknown as McpExtensionState;

    const result = executeList(state, "unknown");
    expect(result.details).toMatchObject({ error: "not_found" });
  });

  it("executeDescribe finds tool by name (e2e)", async () => {
    const state = await connectAndBuildState("describe-test");
    const toolNames = state.toolMetadata.get("describe-test")?.map(t => t.name) ?? [];
    const echoTool = toolNames.find(n => n.includes("echo"));
    expect(echoTool).toBeDefined();

    const result = executeDescribe(state, echoTool!);
    expect(result.content[0].text).toContain(echoTool);
    expect((result.details as any).server).toBe("describe-test");
  });

  it("executeDescribe returns error for unknown tool", () => {
    const state = {
      toolMetadata: new Map(),
      config: { mcpServers: {} },
      manager: new McpServerManager(),
      failureTracker: new Map(),
    } as unknown as McpExtensionState;

    const result = executeDescribe(state, "nonexistent_tool");
    expect(result.details).toMatchObject({ error: "tool_not_found" });
  });

  it("executeSearch finds matching tools (e2e)", async () => {
    const state = await connectAndBuildState("search-test");

    const result = executeSearch(state, "echo");
    expect(result.content[0].text).toContain("Found");
    expect(result.details).toMatchObject({ query: "echo" });
    expect((result.details as any).count).toBeGreaterThanOrEqual(1);
  });

  it("executeSearch returns empty for no match", () => {
    const state = {
      toolMetadata: new Map([["demo", [
        { name: "demo_echo", originalName: "echo", description: "Echo" },
      ] as ToolMetadata[]]]),
      config: { mcpServers: {} },
      manager: new McpServerManager(),
      failureTracker: new Map(),
    } as unknown as McpExtensionState;

    const result = executeSearch(state, "zzz_nonexistent");
    expect(result.content[0].text).toContain("No tools matching");
  });

  it("executeSearch rejects empty query", () => {
    const state = {
      toolMetadata: new Map(),
      config: { mcpServers: {} },
      manager: new McpServerManager(),
      failureTracker: new Map(),
    } as unknown as McpExtensionState;

    const result = executeSearch(state, "");
    expect(result.details).toMatchObject({ error: "empty_query" });
  });

  it("executeConnect connects to server (e2e)", async () => {
    const state = {
      config: { mcpServers: { "connect-test": DEFINITION } },
      manager: new McpServerManager(),
      toolMetadata: new Map(),
      failureTracker: new Map(),
    } as unknown as McpExtensionState;

    managers.push(state.manager);

    const result = await executeConnect(state, "connect-test");
    expect(result.content[0].text).toContain("connect-test");
    expect(result.details).toMatchObject({ server: "connect-test" });
    expect(state.toolMetadata.has("connect-test")).toBe(true);
  });

  it("executeConnect returns error for unknown server", async () => {
    const state = {
      config: { mcpServers: {} },
      manager: new McpServerManager(),
      toolMetadata: new Map(),
      failureTracker: new Map(),
    } as unknown as McpExtensionState;

    const result = await executeConnect(state, "unknown");
    expect(result.details).toMatchObject({ error: "not_found" });
  });

  it("executeCall calls tool on real server (e2e)", async () => {
    const state = await connectAndBuildState("call-test");
    const toolNames = state.toolMetadata.get("call-test")?.map(t => t.name) ?? [];
    const echoTool = toolNames.find(n => n.includes("echo"));
    expect(echoTool).toBeDefined();

    const result = await executeCall(state, echoTool!, { message: "hello" });
    expect(result.content[0].text).toContain("Echo: hello");
  });

  it("executeCall handles tool_not_found (e2e)", async () => {
    const state = await connectAndBuildState("call-test-2");

    const result = await executeCall(state, "mcp_call_test_2_nonexistent");
    expect(result.details).toMatchObject({ error: "tool_not_found" });
  });

  it("executeCall handles server_not_connected (e2e)", async () => {
    const state = {
      config: {
        mcpServers: { "offline-server": DEFINITION },
      },
      manager: new McpServerManager(),
      toolMetadata: new Map(),
      failureTracker: new Map(),
    } as unknown as McpExtensionState;

    managers.push(state.manager);

    const result = await executeCall(state, "some_tool");
    expect(["server_not_connected", "server_backoff", "tool_not_found"]).toContain(
      (result.details as any).error
    );
  });

  it("executeAuthStart rejects non-OAuth servers", async () => {
    const state = {
      config: { mcpServers: { "stdio-only": DEFINITION } },
      manager: new McpServerManager(),
      toolMetadata: new Map(),
      failureTracker: new Map(),
    } as unknown as McpExtensionState;

    const result = await executeAuthStart(state, "stdio-only");
    expect(result.details).toMatchObject({ error: "oauth_not_supported" });
  });

  it("executeAuthStart rejects unknown servers", async () => {
    const state = {
      config: { mcpServers: {} },
      manager: new McpServerManager(),
      toolMetadata: new Map(),
      failureTracker: new Map(),
    } as unknown as McpExtensionState;

    const result = await executeAuthStart(state, "unknown");
    expect(result.details).toMatchObject({ error: "not_found" });
  });

  it("executeUiMessages returns empty when no sessions", () => {
    const state = {
      completedUiSessions: [],
      config: {},
      manager: new McpServerManager(),
      toolMetadata: new Map(),
    } as unknown as McpExtensionState;

    const result = executeUiMessages(state);
    expect(result.content[0].text).toBe("No UI session messages available.");
  });

  it("executeSearch filters by server name (e2e)", async () => {
    const state = await connectAndBuildState("filter-test");

    const result = executeSearch(state, "echo", false, "filter-test");
    expect(result.content[0].text).toContain("Found");
    (result.details as any).matches.forEach((m: any) => {
      expect(m.server).toBe("filter-test");
    });
  });
});
