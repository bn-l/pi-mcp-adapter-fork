/**
 * Push proxy-modes to 85%+ — remaining executeCall, executeConnect branches
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
  authenticate: mocks.authenticate, completeAuthFromInput: mocks.completeAuthFromInput,
  startAuth: mocks.startAuth, supportsOAuth: mocks.supportsOAuth, removeAuth: vi.fn(),
}));
vi.mock("../init.ts", () => ({
  lazyConnect: mocks.lazyConnect, updateServerMetadata: mocks.updateServerMetadata,
  updateMetadataCache: mocks.updateMetadataCache, getFailureAgeSeconds: mocks.getFailureAgeSeconds,
  updateStatusBar: mocks.updateStatusBar,
}));

import { executeCall, executeConnect, executeStatus, executeUiMessages } from "../proxy-modes.ts";

describe("executeCall server override paths", () => {
  beforeEach(() => { mocks.lazyConnect.mockResolvedValue(true); });

  it("serverOverride with lazyConnect returning false", async () => {
    mocks.lazyConnect.mockResolvedValue(false);
    const s = {
      config: { mcpServers: { srv: { command: "echo" } }, settings: { toolPrefix: "server" } },
      toolMetadata: new Map(),
      manager: { getConnection: () => ({ status: "closed" }), connect: vi.fn(), close: vi.fn(), touch: vi.fn(), incrementInFlight: vi.fn(), decrementInFlight: vi.fn() },
      failureTracker: new Map(), completedUiSessions: [],
    } as any;
    const result = await executeCall(s, "srv_echo", {}, "srv");
    expect(result.content[0].text).toContain("not found");
  });

  it("serverOverride with connected server, tool call succeeds", async () => {
    const s = {
      config: { mcpServers: { srv: { command: "echo" } }, settings: { toolPrefix: "server" } },
      toolMetadata: new Map([["srv", [{ name: "srv_echo", originalName: "echo", description: "Echo" }]]]),
      manager: {
        getConnection: () => ({ status: "connected", client: { callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "result" }], isError: false }) } }),
        touch: vi.fn(), incrementInFlight: vi.fn(), decrementInFlight: vi.fn(),
        connect: vi.fn(), close: vi.fn(),
      },
      failureTracker: new Map(), completedUiSessions: [],
    } as any;
    const result = await executeCall(s, "srv_echo", { x: 1 }, "srv");
    expect(result.content.some((c: any) => c.text === "result")).toBe(true);
  });

  it("call with tool that returns isError", async () => {
    const s = {
      config: { mcpServers: { srv: { command: "echo" } }, settings: { toolPrefix: "server" } },
      toolMetadata: new Map([["srv", [{ name: "srv_broken", originalName: "broken", description: "Broken", inputSchema: { type: "object", properties: {} } }]]]),
      manager: {
        getConnection: () => ({ status: "connected", client: { callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "bad" }], isError: true }) } }),
        touch: vi.fn(), incrementInFlight: vi.fn(), decrementInFlight: vi.fn(),
        connect: vi.fn(), close: vi.fn(),
      },
      failureTracker: new Map(), completedUiSessions: [],
    } as any;
    const result = await executeCall(s, "srv_broken", {});
    expect(result.content[0].text).toContain("Error");
  });
});

describe("executeConnect with all branches", () => {
  it("connect succeeds first try", async () => {
    const s = {
      config: {
        mcpServers: { srv: { command: "echo" } },
        settings: { toolPrefix: "server" },
      },
      manager: {
        connect: vi.fn().mockResolvedValue({ status: "connected", tools: [], resources: [] }),
        getConnection: vi.fn(), close: vi.fn(),
      },
      toolMetadata: new Map(), failureTracker: new Map(), completedUiSessions: [],
    } as any;
    const result = await executeConnect(s, "srv");
    expect(result.details.mode).toBe("list");
  });

  it("connect fails with error", async () => {
    const s = {
      config: { mcpServers: { srv: { command: "echo" } }, settings: {} },
      manager: {
        connect: vi.fn().mockRejectedValue(new Error("refused")),
        getConnection: vi.fn(), close: vi.fn(),
      },
      toolMetadata: new Map(), failureTracker: new Map(), completedUiSessions: [],
    } as any;
    const result = await executeConnect(s, "srv");
    expect(result.details.error).toBe("connect_failed");
  });
});

describe("executeStatus with needs-auth", () => {
  it("shows needs-auth for server requiring auth", () => {
    const s = {
      config: { mcpServers: { srv: { url: "http://srv" } }, settings: {} },
      manager: { getConnection: () => ({ status: "needs-auth" }) },
      toolMetadata: new Map(), failureTracker: new Map(),
    } as any;
    const result = executeStatus(s);
    expect(result.content[0].text).toContain("needs auth");
    expect(result.content[0].text).toContain("⚠");
  });
});

describe("executeUiMessages with parsed handoffs", () => {
  it("processes prompt handoffs and intents", () => {
    const s = {
      config: { mcpServers: {}, settings: {} },
      manager: { getConnection: () => null, getAllConnections: () => new Map() },
      toolMetadata: new Map(),
      completedUiSessions: [{
        serverName: "test", toolName: "tool", completedAt: new Date(), reason: "done",
        messages: { prompts: ["ask\n{\"q\":\"hi\"}"], intents: [], notifications: [] },
      }],
    } as any;
    const result = executeUiMessages(s);
    expect(result.details.sessions).toBe(1);
    expect(result.details.handoffs.length).toBe(1);
  });

  it("returns empty for no sessions", () => {
    const s = {
      config: { mcpServers: {}, settings: {} },
      completedUiSessions: [],
    } as any;
    const result = executeUiMessages(s);
    expect(result.content[0].text).toContain("No UI session");
  });
});
