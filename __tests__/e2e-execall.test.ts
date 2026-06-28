import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lazyConnect: vi.fn().mockResolvedValue(true),
  getFailureAgeSeconds: vi.fn().mockReturnValue(null),
  supportsOAuth: vi.fn().mockReturnValue(false),
  authenticate: vi.fn(),
  updateServerMetadata: vi.fn(), updateMetadataCache: vi.fn(), updateStatusBar: vi.fn(),
}));
vi.mock("../mcp-auth-flow.ts", () => ({ authenticate: mocks.authenticate, supportsOAuth: mocks.supportsOAuth, completeAuthFromInput: vi.fn(), startAuth: vi.fn(), removeAuth: vi.fn() }));
vi.mock("../init.ts", () => ({ lazyConnect: mocks.lazyConnect, updateServerMetadata: mocks.updateServerMetadata, updateMetadataCache: mocks.updateMetadataCache, getFailureAgeSeconds: mocks.getFailureAgeSeconds, updateStatusBar: mocks.updateStatusBar }));

import { executeCall } from "../proxy-modes.ts";

describe("executeCall", () => {
  it("native tool detection", async () => {
    const s = { config: { mcpServers: { srv: { command: "echo" } }, settings: { toolPrefix: "server" } }, toolMetadata: new Map(), manager: { getConnection: () => null }, failureTracker: new Map() } as any;
    const r = await executeCall(s, "bash", {}, undefined, () => [{ name: "bash", description: "Bash" }]);
    expect(r.details.error).toBe("native_tool");
  });

  it("backoff after failure", async () => {
    mocks.lazyConnect.mockResolvedValue(false);
    mocks.getFailureAgeSeconds.mockReturnValue(5);
    const s = { config: { mcpServers: { srv: { command: "echo" } }, settings: { toolPrefix: "server" } }, toolMetadata: new Map(), manager: { getConnection: () => ({ status: "closed" }) }, failureTracker: new Map([["srv", Date.now() - 5000]]), completedUiSessions: [] } as any;
    const r = await executeCall(s, "srv_echo", {}, "srv");
    expect(r.details.error).toBe("server_backoff");
  });

  it("error tool shows expected params", async () => {
    const s = {
      config: { mcpServers: { srv: { command: "echo" } }, settings: { toolPrefix: "server" } },
      toolMetadata: new Map([["srv", [{ name: "srv_bad", originalName: "bad", description: "bad", inputSchema: { type: "object", properties: { x: { type: "string" } } } }]]]),
      manager: { getConnection: () => ({ status: "connected", client: { callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "error output" }], isError: true }) } }), touch: vi.fn(), incrementInFlight: vi.fn(), decrementInFlight: vi.fn(), close: vi.fn(), connect: vi.fn(), handleUrlElicitationRequired: vi.fn() },
      failureTracker: new Map(), completedUiSessions: [],
    } as any;
    const r = await executeCall(s, "srv_bad", {});
    expect(r.content[0].text).toContain("Error:");
  });
});
