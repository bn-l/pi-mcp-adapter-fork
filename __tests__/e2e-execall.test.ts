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
});
