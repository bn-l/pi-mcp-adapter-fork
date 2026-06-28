/**
 * Comprehensive proxy-modes tests for complete coverage
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
