/**
 * E2E tests for MCP prompt slash-command registration.
 *
 * Verifies that prompts from the metadata cache are registered as
 * Pi slash commands at extension load time (before servers connect),
 * and that the handler correctly fetches + outputs prompt content.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { McpServerManager } from "../server-manager.ts";
import { executeGetPrompt } from "../proxy-modes.ts";
import type { McpExtensionState } from "../state.ts";
import type { ServerDefinition } from "../types.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/e2e-server.mjs", import.meta.url));
const DEFINITION: ServerDefinition = { command: process.execPath, args: [FIXTURE] };

const managers: McpServerManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.closeAll().catch(() => {})));
});

async function makeConnectedState(serverName: string): Promise<McpExtensionState> {
  const manager = new McpServerManager();
  managers.push(manager);
  const connection = await manager.connect(serverName, DEFINITION);
  return {
    config: { mcpServers: { [serverName]: DEFINITION }, settings: {} },
    manager,
    toolMetadata: new Map(),
    failureTracker: new Map(),
    completedUiSessions: [],
  } as unknown as McpExtensionState;
}

describe("MCP prompt slash-command end-to-end", () => {
  it("prompts are discovered and accessible via executeGetPrompt (e2e)", async () => {
    const state = await makeConnectedState("slash-e2e");

    // Verify prompts were discovered on connect
    const conn = state.manager.getConnection("slash-e2e");
    expect(conn).toBeDefined();
    expect(conn!.prompts.length).toBe(3);
    expect(conn!.prompts.map((p) => p.name).sort()).toEqual([
      "code_review",
      "greeting",
      "simple",
    ]);
  });

  it("no-arg prompt returns content directly (e2e)", async () => {
    const state = await makeConnectedState("noarg-cmd");

    const result = await executeGetPrompt(state, "noarg-cmd", "simple");
    expect(result.content[0].text).toContain("simple prompt with no arguments");
    expect(result.content[0].text).toContain("## user");
    expect(result.content[0].text).toContain("## assistant");
    expect(result.details?.error).toBeUndefined();
  });

  it("prompt with optional arg returns content with default when no args (e2e)", async () => {
    const state = await makeConnectedState("opt-cmd");

    // greeting has optional "name" arg — should default to "World"
    const result = await executeGetPrompt(state, "opt-cmd", "greeting");
    expect(result.content[0].text).toContain("Hello, World!");
  });

  it("prompt with optional arg uses provided value (e2e)", async () => {
    const state = await makeConnectedState("optval-cmd");

    const result = await executeGetPrompt(state, "optval-cmd", "greeting", {
      name: "Bastard",
    });
    expect(result.content[0].text).toContain("Hello, Bastard!");
  });

  it("prompt with required arg works with named args (e2e)", async () => {
    const state = await makeConnectedState("req-cmd");

    const result = await executeGetPrompt(state, "req-cmd", "code_review", {
      language: "Python",
      focus: "SQL injection",
    });
    expect(result.content[0].text).toContain("Python");
    expect(result.content[0].text).toContain("SQL injection");
  });

  it("prompt command names use server:prompt format (e2e)", async () => {
    const state = await makeConnectedState("format-test");
    const conn = state.manager.getConnection("format-test");

    const names = conn!.prompts.map(
      (p) => `format-test:${p.name}`,
    );
    expect(names).toContain("format-test:greeting");
    expect(names).toContain("format-test:code_review");
    expect(names).toContain("format-test:simple");
  });

  it("disconnected server returns error from executeGetPrompt (e2e)", async () => {
    const state = {
      config: { mcpServers: { offline: DEFINITION }, settings: {} },
      manager: { getConnection: () => null },
      failureTracker: new Map(),
      toolMetadata: new Map(),
    } as unknown as McpExtensionState;

    const result = await executeGetPrompt(state, "offline", "greeting");
    expect(result.details?.error).toBe("not_connected");
  });

  it("reconnect restores prompt list (e2e)", async () => {
    const connMgr = new McpServerManager();
    managers.push(connMgr);

    const c1 = await connMgr.connect("recon-cmd", DEFINITION);
    expect(c1.prompts.length).toBe(3);

    await connMgr.close("recon-cmd");

    const c2 = await connMgr.connect("recon-cmd", DEFINITION);
    expect(c2.prompts.length).toBe(3);
  });
});

describe("Bootstrap registration from cache", () => {
  it("registers prompt commands from cache at load time", async () => {
    const vi_mod = await import("vitest");

    // Build a cache with prompts
    const mockCache = {
      version: 1,
      servers: {
        "test-srv": {
          configHash: "abc123",
          cachedAt: Date.now(),
          tools: [],
          resources: [],
          prompts: [
            { name: "greeting", description: "Say hello" },
            { name: "review", description: "Code review prompt", arguments: [{ name: "lang", description: "Language", required: true }] },
          ],
        },
      },
    };

    // Track registered commands
    const registeredCommands: Array<{ name: string; description: string }> = [];
    const mockPi = {
      registerCommand: vi_mod.vi.fn((name: string, opts: { description: string; handler: () => void }) => {
        registeredCommands.push({ name, description: opts.description });
      }),
      registerTool: vi_mod.vi.fn(),
      registerFlag: vi_mod.vi.fn(),
      on: vi_mod.vi.fn(),
      getFlag: vi_mod.vi.fn(),
      getAllTools: vi_mod.vi.fn(() => []),
      sendMessage: vi_mod.vi.fn(),
    };

    // Mock the metadata cache load before importing the factory
    vi_mod.vi.doMock("../metadata-cache.ts", () => ({
      loadMetadataCache: () => mockCache,
      saveMetadataCache: () => {},
      computeServerHash: () => "abc123",
      isServerCacheValid: () => true,
      getMetadataCachePath: () => "/tmp/cache.json",
      serializeTools: () => [],
      serializeResources: () => [],
      serializePrompts: () => [],
      reconstructToolMetadata: () => [],
    }));

    vi_mod.vi.doMock("../config.ts", () => ({
      loadMcpConfig: () => ({
        mcpServers: { "test-srv": { command: "node", args: ["server.js"] } },
        settings: {},
      }),
    }));

    vi_mod.vi.doMock("../direct-tools.ts", () => ({
      buildProxyDescription: () => "MCP gateway",
      resolveDirectTools: () => [],
      createDirectToolExecutor: () => () => {},
      getMissingConfiguredDirectToolServers: () => [],
    }));

    vi_mod.vi.doMock("../utils.ts", () => ({
      getConfigPathFromArgv: () => undefined,
      truncateAtWord: (s: string) => s,
    }));

    vi_mod.vi.doMock("../mcp-auth-flow.ts", () => ({
      initializeOAuth: () => Promise.resolve(),
      shutdownOAuth: () => Promise.resolve(),
    }));

    vi_mod.vi.doMock("../tool-result-renderer.ts", () => ({
      createMcpDirectToolCallRenderer: () => () => "",
      renderMcpProxyToolCall: () => "",
      renderMcpToolResult: () => "",
    }));

    // Now import the factory and execute it
    const { default: mcpAdapter } = await import("../index.ts");
    mcpAdapter(mockPi as any);
    // mcp + mcp-auth + mcp-prompts-debug + 2 prompt commands = 5
    expect(registeredCommands.length).toBe(5);
    // Prompt commands are registered first (from cache bootstrap)
    const promptCmds = registeredCommands.filter(c => c.name.includes(":"));
    expect(promptCmds.length).toBe(2);
    expect(promptCmds[0]).toEqual({
      name: "test-srv:greeting",
      description: "Say hello",
    });
    expect(promptCmds[1]).toEqual({
      name: "test-srv:review",
      description: "Code review prompt",
    });
  });
});
