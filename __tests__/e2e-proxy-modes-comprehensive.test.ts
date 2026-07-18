/**
 * Comprehensive proxy-modes tests for complete coverage
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { McpServerManager } from "../server-manager.ts";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  completeAuthFromInput: vi.fn(),
  startAuth: vi.fn(),
  supportsOAuth: vi.fn(),
  lazyConnect: vi.fn(),
  updateServerMetadata: vi.fn(),
  updateMetadataCache: vi.fn(),
  getFailureAgeSeconds: vi.fn().mockReturnValue(null),
  updateStatusBar: vi.fn(),
}));

vi.mock("../mcp-auth-flow.ts", () => ({
  authenticate: mocks.authenticate,
  completeAuthFromInput: mocks.completeAuthFromInput,
  startAuth: mocks.startAuth,
  supportsOAuth: mocks.supportsOAuth,
}));

vi.mock("../init.ts", () => ({
  lazyConnect: mocks.lazyConnect,
  updateServerMetadata: mocks.updateServerMetadata,
  updateMetadataCache: mocks.updateMetadataCache,
  getFailureAgeSeconds: mocks.getFailureAgeSeconds,
  updateStatusBar: mocks.updateStatusBar,
}));

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    config: { mcpServers: {}, settings: {} },
    manager: {
      getConnection: vi.fn().mockReturnValue(null),
      connect: vi.fn().mockResolvedValue({
        status: "connected", tools: [{ name: "echo" }], resources: [],
      }),
      close: vi.fn(),
    },
    toolMetadata: new Map(),
    failureTracker: new Map(),
    completedUiSessions: [],
    ui: undefined,
    ...overrides,
  };
}

describe("executeStatus", () => {
  it("shows all status types", async () => {
    const { executeStatus } = await import("../proxy-modes.ts");
    const s = makeState({
      config: {
        mcpServers: {
          a: { command: "a" },
          b: { command: "b" },
          c: { command: "c" },
          d: { command: "d" },
          e: { command: "e" },
        },
        settings: {},
      },
      manager: {
        getConnection: vi.fn((name: string) => {
          if (name === "a") return { status: "connected", tools: [], resources: [] };
          if (name === "b") return { status: "needs-auth" };
          if (name === "c") return null;
          if (name === "e") return null;
          return null;
        }),
      },
      toolMetadata: new Map([
        ["a", [{ name: "t1" }, { name: "t2" }]],
        ["c", [{ name: "t3" }]],
      ]),
    });
    mocks.getFailureAgeSeconds.mockImplementation((_s: any, name: string) => {
      if (name === "d") return 15;
      return null;
    });

    const result = await executeStatus(s);
    const text = result.content[0].text;
    expect(text).toContain("✓ a (2 tools)");
    expect(text).toContain("⚠ b (needs auth)");
    expect(text).toContain("○ c (1 tools, cached)");
    expect(text).toContain("✗ d (failed 15s ago)");
    expect(text).toContain("○ e (not connected)");
    expect(result.details.servers).toHaveLength(5);
  });

  it("shows 0 servers gracefully", async () => {
    const { executeStatus } = await import("../proxy-modes.ts");
    const s = makeState();
    const result = await executeStatus(s);
    expect(result.content[0].text).toContain("0/0 servers");
  });
});

describe("executeAuthStart", () => {
  it("returns error for unknown server", async () => {
    const { executeAuthStart } = await import("../proxy-modes.ts");
    const result = await executeAuthStart(makeState(), "unknown");
    expect(result.details.error).toBe("not_found");
  });

  it("returns error for non-OAuth server", async () => {
    const { executeAuthStart } = await import("../proxy-modes.ts");
    mocks.supportsOAuth.mockReturnValue(false);
    const s = makeState({ config: { mcpServers: { srv: { url: "http://x" } }, settings: {} } });
    const result = await executeAuthStart(s, "srv");
    expect(result.details.error).toBe("oauth_not_supported");
  });

  it("handles immediate auth success", async () => {
    const { executeAuthStart } = await import("../proxy-modes.ts");
    mocks.supportsOAuth.mockReturnValue(true);
    mocks.startAuth.mockResolvedValue({ authorizationUrl: null });
    const s = makeState({ config: { mcpServers: { srv: { url: "http://x" } }, settings: {} } });
    const result = await executeAuthStart(s, "srv");
    expect(result.details.authenticated).toBe(true);
  });

  it("handles auth start failure", async () => {
    const { executeAuthStart } = await import("../proxy-modes.ts");
    mocks.supportsOAuth.mockReturnValue(true);
    mocks.startAuth.mockRejectedValue(new Error("network error"));
    const s = makeState({ config: { mcpServers: { srv: { url: "http://x" } }, settings: {} } });
    const result = await executeAuthStart(s, "srv");
    expect(result.details.error).toBe("auth_start_failed");
  });

  it("provides manual auth instructions", async () => {
    const { executeAuthStart } = await import("../proxy-modes.ts");
    mocks.supportsOAuth.mockReturnValue(true);
    mocks.startAuth.mockResolvedValue({ authorizationUrl: "https://auth.example.com/authorize?redirect_uri=http://localhost:8080/callback" });
    const s = makeState({ config: { mcpServers: { srv: { url: "http://x" } }, settings: {} } });
    const result = await executeAuthStart(s, "srv");
    expect(result.details.authorizationUrl).toContain("auth.example.com");
    expect(result.content[0].text).toContain("port 8080");
  });
});

describe("executeAuthComplete", () => {
  it("returns error for unknown server", async () => {
    const { executeAuthComplete } = await import("../proxy-modes.ts");
    const result = await executeAuthComplete(makeState(), "unknown", "code=123");
    expect(result.details.error).toBe("not_found");
  });

  it("handles incomplete auth", async () => {
    const { executeAuthComplete } = await import("../proxy-modes.ts");
    mocks.completeAuthFromInput.mockResolvedValue("pending");
    const s = makeState({ config: { mcpServers: { srv: {} }, settings: {} } });
    const result = await executeAuthComplete(s, "srv", "code=123");
    expect(result.details.error).toBe("not_authenticated");
  });

  it("handles successful auth", async () => {
    const { executeAuthComplete } = await import("../proxy-modes.ts");
    mocks.completeAuthFromInput.mockResolvedValue("authenticated");
    const s = makeState({ config: { mcpServers: { srv: {} }, settings: {} } });
    const result = await executeAuthComplete(s, "srv", "code=123");
    expect(result.details.authenticated).toBe(true);
    expect(s.manager.close).toHaveBeenCalledWith("srv");
  });

  it("handles auth failure", async () => {
    const { executeAuthComplete } = await import("../proxy-modes.ts");
    mocks.completeAuthFromInput.mockRejectedValue(new Error("invalid token"));
    const s = makeState({ config: { mcpServers: { srv: {} }, settings: {} } });
    const result = await executeAuthComplete(s, "srv", "bad");
    expect(result.details.error).toBe("auth_complete_failed");
  });
});

describe("executeList", () => {
  it("returns error for unknown server", async () => {
    const { executeList } = await import("../proxy-modes.ts");
    const result = executeList(makeState(), "unknown");
    expect(result.details.error).toBe("not_found");
  });

  it("shows no tools for empty metadata", async () => {
    const { executeList } = await import("../proxy-modes.ts");
    const s = makeState({
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: () => ({ status: "connected" }) },
      toolMetadata: new Map([["srv", []]]),
    });
    const result = executeList(s, "srv");
    expect(result.content[0].text).toContain("has no tools");
  });

  it("shows cached tools when not connected", async () => {
    const { executeList } = await import("../proxy-modes.ts");
    const s = makeState({
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: () => null },
      toolMetadata: new Map([["srv", []]]),
    });
    const result = executeList(s, "srv");
    expect(result.content[0].text).toContain("cached");
  });

  it("shows not connected message", async () => {
    const { executeList } = await import("../proxy-modes.ts");
    const s = makeState({
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: () => null },
      toolMetadata: new Map(),
    });
    const result = executeList(s, "srv");
    expect(result.content[0].text).toContain("not connected");
  });

  it("lists tools with descriptions", async () => {
    const { executeList } = await import("../proxy-modes.ts");
    const s = makeState({
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: () => ({ status: "connected" }) },
      toolMetadata: new Map([["srv", [{ name: "srv_echo", originalName: "echo", description: "Echo a message" }]]]),
    });
    const result = executeList(s, "srv");
    expect(result.content[0].text).toContain("srv_echo");
    expect(result.content[0].text).toContain("Echo a message");
  });
});

describe("executeDescribe", () => {
  it("handles resource tool", async () => {
    const { executeDescribe } = await import("../proxy-modes.ts");
    const s = makeState({
      toolMetadata: new Map([["srv", [{
        name: "srv_read",
        originalName: "read",
        description: "Read data",
        resourceUri: "file:///data",
        inputSchema: { type: "string" },
      }]]]),
    });
    const result = executeDescribe(s, "srv_read");
    expect(result.content[0].text).toContain("resource tool");
  });

  it("handles normal tool without inputSchema", async () => {
    const { executeDescribe } = await import("../proxy-modes.ts");
    const s = makeState({
      toolMetadata: new Map([["srv", [{
        name: "srv_action",
        originalName: "action",
        description: "Do action",
      }]]]),
    });
    const result = executeDescribe(s, "srv_action");
    expect(result.content[0].text).toContain("No parameters defined");
  });
});

describe("executeConnect", () => {
  it("returns error for unknown server", async () => {
    const { executeConnect } = await import("../proxy-modes.ts");
    const result = await executeConnect(makeState(), "unknown");
    expect(result.details.error).toBe("not_found");
  });

  it("handles connection failure", async () => {
    const { executeConnect } = await import("../proxy-modes.ts");
    const s = makeState({
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { connect: vi.fn().mockRejectedValue(new Error("timeout")), getConnection: vi.fn(), close: vi.fn() },
      toolMetadata: new Map(),
    });
    const result = await executeConnect(s, "srv");
    expect(result.details.error).toBe("connect_failed");
  });
});

describe("executeListPrompts edge cases", () => {
  it("returns error for unknown server", async () => {
    const { executeListPrompts } = await import("../proxy-modes.ts");
    const result = executeListPrompts(makeState(), "unknown");
    expect(result.details.error).toBe("not_found");
  });

  it("returns not_connected for server with no connection", async () => {
    const { executeListPrompts } = await import("../proxy-modes.ts");
    const s = makeState({
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: vi.fn().mockReturnValue(null) },
    });
    const result = executeListPrompts(s, "srv");
    expect(result.details.error).toBe("not_connected");
  });

  it("returns server_backoff when failure age is set", async () => {
    const { executeListPrompts } = await import("../proxy-modes.ts");
    mocks.getFailureAgeSeconds.mockReturnValue(30);
    const s = makeState({
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: vi.fn().mockReturnValue(null) },
    });
    const result = executeListPrompts(s, "srv");
    expect(result.details.error).toBe("server_backoff");
    expect(result.content[0].text).toContain("30s ago");
    mocks.getFailureAgeSeconds.mockReturnValue(null);
  });

  it("shows prompt arguments with required marker", async () => {
    const { executeListPrompts } = await import("../proxy-modes.ts");
    const s = makeState({
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: {
        getConnection: vi.fn().mockReturnValue({
          status: "connected",
          prompts: [
            { name: "test", description: "A test", arguments: [{ name: "arg1", required: true }, { name: "arg2", required: false }] },
          ],
        }),
      },
    });
    const result = executeListPrompts(s, "srv");
    expect(result.content[0].text).toContain("arg1*");
    expect(result.content[0].text).toContain("arg2");
  });
});

describe("executeGetPrompt edge cases", () => {
  it("returns error for unknown server", async () => {
    const { executeGetPrompt } = await import("../proxy-modes.ts");
    const result = await executeGetPrompt(makeState(), "unknown", "greeting");
    expect(result.details.error).toBe("not_found");
  });

  it("returns not_connected for server with no connection", async () => {
    const { executeGetPrompt } = await import("../proxy-modes.ts");
    const s = makeState({
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: vi.fn().mockReturnValue(null) },
    });
    const result = await executeGetPrompt(s, "srv", "greeting");
    expect(result.details.error).toBe("not_connected");
  });

  it("handles getPrompt failure", async () => {
    const { executeGetPrompt } = await import("../proxy-modes.ts");
    const s = makeState({
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: {
        getConnection: vi.fn().mockReturnValue({
          status: "connected",
          client: {},
        }),
        getPrompt: vi.fn().mockRejectedValue(new Error("prompt not found")),
      },
    });
    const result = await executeGetPrompt(s, "srv", "nonexistent");
    expect(result.details.error).toBe("get_prompt_failed");
  });
});

describe("MCP prompt argument handling via executeGetPrompt", () => {
  it("passes named args correctly (e2e)", async () => {
    const { executeGetPrompt } = await import("../proxy-modes.ts");

    const fixturePath = fileURLToPath(new URL("./fixtures/e2e-server.mjs", import.meta.url));
    const def = { command: process.execPath, args: [fixturePath] };
    const connMgr = new McpServerManager();
    const connection = await connMgr.connect("args-test", def);

    const s = makeState({
      config: { mcpServers: { "args-test": def }, settings: {} },
      manager: {
        getConnection: vi.fn().mockReturnValue(connection),
        getPrompt: connMgr.getPrompt.bind(connMgr),
        close: connMgr.close.bind(connMgr),
        touch: () => {},
        incrementInFlight: () => {},
        decrementInFlight: () => {},
      },
    });

    const result = await executeGetPrompt(s, "args-test", "code_review", { language: "Rust", focus: "unsafe blocks" });
    expect(result.content[0].text).toContain("Rust");
    expect(result.content[0].text).toContain("unsafe blocks");

    await connMgr.closeAll();
  });

  it("handles single remaining positional arg as the value for the sole required arg (e2e)", async () => {
    const { executeGetPrompt } = await import("../proxy-modes.ts");

    const fixturePath = fileURLToPath(new URL("./fixtures/e2e-server.mjs", import.meta.url));
    const def = { command: process.execPath, args: [fixturePath] };
    const connMgr = new McpServerManager();
    const connection = await connMgr.connect("pos-test", def);

    const s = makeState({
      config: { mcpServers: { "pos-test": def }, settings: {} },
      manager: {
        getConnection: vi.fn().mockReturnValue(connection),
        getPrompt: connMgr.getPrompt.bind(connMgr),
        close: connMgr.close.bind(connMgr),
        touch: () => {},
        incrementInFlight: () => {},
        decrementInFlight: () => {},
      },
    });

    const result = await executeGetPrompt(s, "pos-test", "code_review", { language: "Go" });
    expect(result.content[0].text).toContain("Go");
    expect(result.content[0].text).toContain("general");

    await connMgr.closeAll();
  });

  it("no-arg prompt returns messages without arguments (e2e)", async () => {
    const { executeGetPrompt } = await import("../proxy-modes.ts");

    const fixturePath = fileURLToPath(new URL("./fixtures/e2e-server.mjs", import.meta.url));
    const def = { command: process.execPath, args: [fixturePath] };
    const connMgr = new McpServerManager();
    const connection = await connMgr.connect("noarg-test", def);

    const s = makeState({
      config: { mcpServers: { "noarg-test": def }, settings: {} },
      manager: {
        getConnection: vi.fn().mockReturnValue(connection),
        getPrompt: connMgr.getPrompt.bind(connMgr),
        close: connMgr.close.bind(connMgr),
        touch: () => {},
        incrementInFlight: () => {},
        decrementInFlight: () => {},
      },
    });

    const result = await executeGetPrompt(s, "noarg-test", "simple");
    expect(result.content[0].text).toContain("simple prompt with no arguments");
    expect(result.content[0].text).toContain("## user");
    expect(result.content[0].text).toContain("## assistant");

    await connMgr.closeAll();
  });

  it("optional arg defaults when not provided (e2e)", async () => {
    const { executeGetPrompt } = await import("../proxy-modes.ts");

    const fixturePath = fileURLToPath(new URL("./fixtures/e2e-server.mjs", import.meta.url));
    const def = { command: process.execPath, args: [fixturePath] };
    const connMgr = new McpServerManager();
    const connection = await connMgr.connect("opt-test", def);

    const s = makeState({
      config: { mcpServers: { "opt-test": def }, settings: {} },
      manager: {
        getConnection: vi.fn().mockReturnValue(connection),
        getPrompt: connMgr.getPrompt.bind(connMgr),
        close: connMgr.close.bind(connMgr),
        touch: () => {},
        incrementInFlight: () => {},
        decrementInFlight: () => {},
      },
    });

    const result = await executeGetPrompt(s, "opt-test", "greeting");
    expect(result.content[0].text).toContain("Hello, World!");

    await connMgr.closeAll();
  });
});

describe("Prompt command lifecycle simulation", () => {
  it("stale commands are marked unavailable after reconnect (e2e)", async () => {
    const { executeListPrompts } = await import("../proxy-modes.ts");

    const fixturePath = fileURLToPath(new URL("./fixtures/e2e-server.mjs", import.meta.url));
    const def = { command: process.execPath, args: [fixturePath] };
    const connMgr = new McpServerManager();
    const connection = await connMgr.connect("lifecycle-prompts", def);

    // Verify prompts exist when connected
    expect(connection.prompts.length).toBe(3);
    expect(connection.prompts.map(p => p.name)).toContain("greeting");

    // Simulate disconnect by closing
    await connMgr.close("lifecycle-prompts");

    // After disconnect, executeListPrompts should show not_connected
    const s = makeState({
      config: { mcpServers: { "lifecycle-prompts": def }, settings: {} },
      manager: {
        getConnection: vi.fn().mockReturnValue(null),
        close: vi.fn(),
      },
    });
    const result = executeListPrompts(s, "lifecycle-prompts");
    expect(result.details.error).toBe("not_connected");

    await connMgr.closeAll();
  });

  it("reconnect restores prompt list (e2e)", async () => {
    const fixturePath = fileURLToPath(new URL("./fixtures/e2e-server.mjs", import.meta.url));
    const def = { command: process.execPath, args: [fixturePath] };
    const connMgr = new McpServerManager();

    // Connect, disconnect, reconnect
    const c1 = await connMgr.connect("recon-prompts", def);
    expect(c1.prompts.length).toBe(3);
    await connMgr.close("recon-prompts");

    const c2 = await connMgr.connect("recon-prompts", def);
    expect(c2.prompts.length).toBe(3);
    expect(c2.prompts.map(p => p.name)).toContain("greeting");
    expect(c2.prompts.map(p => p.name)).toContain("code_review");
    expect(c2.prompts.map(p => p.name)).toContain("simple");

    await connMgr.closeAll();
  });
});
