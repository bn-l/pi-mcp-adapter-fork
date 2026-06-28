/**
 * Push proxy-modes from 75% to 90%+ — covers remaining executeCall, executeConnect,
 * and internal helper branches through exported functions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn().mockResolvedValue("authenticated"),
  completeAuthFromInput: vi.fn(),
  startAuth: vi.fn(),
  supportsOAuth: vi.fn().mockReturnValue(true),
  lazyConnect: vi.fn().mockResolvedValue(true),
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
  removeAuth: vi.fn(),
}));
vi.mock("../init.ts", () => ({
  lazyConnect: mocks.lazyConnect,
  updateServerMetadata: mocks.updateServerMetadata,
  updateMetadataCache: mocks.updateMetadataCache,
  getFailureAgeSeconds: mocks.getFailureAgeSeconds,
  updateStatusBar: mocks.updateStatusBar,
}));

// ===== executeCall branches =====
import { executeCall, executeStatus, executeList, executeUiMessages } from "../proxy-modes.ts";

describe("executeCall remaining branches", () => {
  beforeEach(() => {
    mocks.lazyConnect.mockResolvedValue(true);
    mocks.supportsOAuth.mockReturnValue(true);
    mocks.getFailureAgeSeconds.mockReturnValue(null);
  });

  it("call with missing server in serverOverride arg", async () => {
    const s = {
      config: { mcpServers: { srv: { command: "echo" } }, settings: { toolPrefix: "server" } },
      toolMetadata: new Map(),
      manager: { getConnection: () => null },
    } as any;
    const result = await executeCall(s, "srv_echo", { x: 1 }, "nonexistent");
    expect(result.details.error).toBe("server_not_found");
  });

  it("call with serverOverride and tool not found after lazyConnect", async () => {
    mocks.lazyConnect.mockResolvedValue(true);
    const connected = { status: "connected", tools: [], resources: [] };
    const s = {
      config: { mcpServers: { srv: { command: "echo" } }, settings: { toolPrefix: "server" } },
      toolMetadata: new Map([["srv", [{ name: "srv_other", originalName: "other", description: "other" }]]]),
      manager: { getConnection: () => connected, connect: vi.fn(), close: vi.fn(), touch: vi.fn(), incrementInFlight: vi.fn(), decrementInFlight: vi.fn() },
      failureTracker: new Map(),
      completedUiSessions: [],
    } as any;
    const result = await executeCall(s, "srv_echo", undefined, "srv");
    expect(result.content[0].text).toContain("not found");
  });

  it("call with needs-auth connection and autoAuth disabled", async () => {
    mocks.lazyConnect.mockResolvedValue(false);
    const current = { status: "needs-auth" };
    const s = {
      config: {
        mcpServers: { srv: { command: "echo" } },
        settings: { toolPrefix: "server" },
      },
      toolMetadata: new Map(),
      manager: { getConnection: () => current, connect: vi.fn(), close: vi.fn(), touch: vi.fn(), incrementInFlight: vi.fn(), decrementInFlight: vi.fn() },
      failureTracker: new Map(),
      completedUiSessions: [],
    } as any;
    const result = await executeCall(s, "srv_echo", {}, "srv");
    expect(result.details.error).toBe("auth_required");
  });

  it("call with lazyConnect connecting to non-existent server", async () => {
    mocks.lazyConnect.mockResolvedValue(false);
    const s = {
      config: { mcpServers: { srv: { command: "echo" } }, settings: { toolPrefix: "server" } },
      toolMetadata: new Map(),
      manager: { getConnection: () => ({ status: "closed" }) },
      failureTracker: new Map(),
      completedUiSessions: [],
    } as any;
    // No toolMeta anywhere → should return "not found"
    const result = await executeCall(s, "srv_echo", {}, "srv");
    expect(result.content[0].text).toContain("not found");
  });
});

// ===== executeStatus with multiple status types =====
describe("executeStatus comprehensive", () => {
  it("shows fails for unconnected servers when not cached", () => {
    const s = {
      config: { mcpServers: { a: { command: "x" }, b: { command: "y" } }, settings: {} },
      manager: { getConnection: () => null },
      toolMetadata: new Map([["a", [{ name: "t1" }]]]),
      failureTracker: new Map(),
    } as any;
    const result = executeStatus(s);
    // a has cached tools → "cached", b has nothing → "not connected"
    expect(result.content[0].text).toContain("cached");
    expect(result.content[0].text).toContain("not connected");
  });
});

// ===== executeUiMessages with handoffs =====
describe("executeUiMessages with sessions", () => {
  it("processes session with intents and notifications", () => {
    const s = {
      config: { mcpServers: {}, settings: {} },
      manager: { getConnection: () => null, getAllConnections: () => new Map() },
      toolMetadata: new Map(),
      completedUiSessions: [{
        serverName: "demo",
        toolName: "viz",
        completedAt: new Date(),
        reason: "done",
        messages: {
          prompts: ["hello_world\n{\"k\":\"v\"}"],
          intents: [{ intent: "test", params: { x: 1 } }],
          notifications: ["done"],
        },
      }],
    } as any;
    const result = executeUiMessages(s);
    expect(result.details.sessions).toBe(1);
    expect(result.details.prompts.length).toBeGreaterThan(0);
    expect(result.details.intents.length).toBeGreaterThan(0);
  });
});

// ===== executeList server filter edge case =====
describe("executeList edge cases", () => {
  it("lists tools for server with no cached metadata", () => {
    const s = {
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: () => ({ status: "connected" }) },
      toolMetadata: new Map(),
    } as any;
    const result = executeList(s, "srv");
    expect(result.content[0].text).toContain("no tools");
  });
});
