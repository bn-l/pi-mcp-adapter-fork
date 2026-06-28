/**
 * Regression test: status bar shows misleading "0/3" when cached servers exist.
 * 
 * Reproduces: on non-first startup, "lazy" servers don't auto-connect but have
 * cached metadata. The status bar says "MCP: 0/3 servers" which confuses users
 * into thinking nothing is configured. Should show cached count.
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadMcpConfig: vi.fn(() => ({
    mcpServers: {
      srv_a: { command: "echo", lifecycle: "lazy" },
      srv_b: { command: "echo", lifecycle: "lazy" },
      srv_c: { command: "echo", lifecycle: "lazy" },
    },
    settings: {},
  })),
  isServerCacheValid: vi.fn(() => true),
  computeServerHash: vi.fn(() => "hash"),
  loadMetadataCache: vi.fn(() => ({
    version: 1,
    servers: {
      srv_a: { configHash: "hash", tools: [], resources: [], cachedAt: Date.now() },
      srv_b: { configHash: "hash", tools: [], resources: [], cachedAt: Date.now() },
      srv_c: { configHash: "hash", tools: [], resources: [], cachedAt: Date.now() },
    },
  })),
  saveMetadataCache: vi.fn(),
  getMetadataCachePath: vi.fn(() => "/tmp/cache.json"),
  reconstructToolMetadata: vi.fn(() => [{ name: "cached_tool", originalName: "tool", description: "desc" }]),
  existsSync: vi.fn(() => true),
  connect: vi.fn(),
  openUrl: vi.fn(),
  McpServerManager: vi.fn(),
  McpLifecycleManager: vi.fn(),
  UiResourceHandler: vi.fn(),
  ConsentManager: vi.fn(),
}));

vi.mock("../config.ts", () => ({ loadMcpConfig: mocks.loadMcpConfig }));
vi.mock("../metadata-cache.ts", () => ({
  isServerCacheValid: mocks.isServerCacheValid,
  computeServerHash: mocks.computeServerHash,
  loadMetadataCache: mocks.loadMetadataCache,
  saveMetadataCache: mocks.saveMetadataCache,
  getMetadataCachePath: mocks.getMetadataCachePath,
  reconstructToolMetadata: mocks.reconstructToolMetadata,
}));
vi.mock("../utils.ts", () => ({
  openUrl: mocks.openUrl,
  parallelLimit: async (items: any[], _: number, fn: any) => Promise.all(items.map(fn)),
  openPath: vi.fn(),
}));
vi.mock("node:fs", () => ({ existsSync: mocks.existsSync }));
vi.mock("../server-manager.ts", () => ({ McpServerManager: mocks.McpServerManager }));
vi.mock("../ui-resource-handler.ts", () => ({ UiResourceHandler: mocks.UiResourceHandler }));
vi.mock("../consent-manager.ts", () => ({ ConsentManager: mocks.ConsentManager }));

// Default lazy servers don't connect → status bar says 0
mocks.McpServerManager.mockImplementation(() => {
  const connections = new Map();
  return {
    connect: vi.fn().mockResolvedValue({ status: "connected", tools: [], resources: [] }),
    close: vi.fn(),
    closeAll: vi.fn(),
    getConnection: (name: string) => connections.get(name),
    getAllConnections: () => connections,
    setSamplingConfig: vi.fn(),
    setElicitationConfig: vi.fn(),
    registerUiStreamListener: vi.fn(),
    removeUiStreamListener: vi.fn(),
    readResource: vi.fn(),
    touch: vi.fn(),
    incrementInFlight: vi.fn(),
    decrementInFlight: vi.fn(),
    isIdle: vi.fn(() => false),
    handleUrlElicitationRequired: vi.fn(),
  };
});

mocks.McpLifecycleManager.mockImplementation(() => ({
  registerServer: vi.fn(),
  markKeepAlive: vi.fn(),
  setGlobalIdleTimeout: vi.fn(),
  setReconnectCallback: vi.fn(),
  setIdleShutdownCallback: vi.fn(),
  startHealthChecks: vi.fn(),
  gracefulShutdown: vi.fn(),
}));
mocks.UiResourceHandler.mockImplementation(() => ({ register: vi.fn() }));
mocks.ConsentManager.mockImplementation(() => ({ setConfig: vi.fn(), approve: vi.fn(), disapprove: vi.fn() }));

describe("startup status bar", () => {
  it("shows cached count when lazy servers have metadata but no connection (FIXED)", async () => {
    const { initializeMcp } = await import("../init.ts");

    const setStatus = vi.fn();
    const notify = vi.fn();
    const pi: any = { getFlag: () => undefined, sendMessage: vi.fn(), exec: vi.fn() };
    const ctx: any = {
      hasUI: true,
      mode: "tui",
      cwd: "/tmp",
      ui: { notify, setStatus, theme: { fg: (_k: string, s: string) => s } },
      model: "test-model",
      modelRegistry: undefined,
      signal: undefined,
    };

    const state = await initializeMcp(pi, ctx);

    // BUG: status bar shows 0 connected even though 3 servers have cached metadata
    // The status bar code is in updateStatusBar which is called separately
    // Let's verify: getAllConnections().size is 0 because lazy servers don't auto-connect
    expect(state.manager.getAllConnections().size).toBe(0);
    // But toolMetadata HAS entries from cache
    expect(state.toolMetadata.has("srv_a")).toBe(true);
    expect(state.toolMetadata.has("srv_b")).toBe(true);
    expect(state.toolMetadata.has("srv_c")).toBe(true);

    // FIX: updateStatusBar should show cached count
    state.ui = ctx.ui;
    const { updateStatusBar } = await import("../init.ts");
    updateStatusBar(state);
    // Now shows "0/3 connected (3 cached)" instead of misleading "0/3 servers"
    expect(setStatus).toHaveBeenCalledWith("mcp", "MCP: 0/3 connected (3 cached)");
  });
});
