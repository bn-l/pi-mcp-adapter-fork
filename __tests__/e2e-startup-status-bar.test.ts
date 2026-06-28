/**
 * Regression test: lazy servers don't auto-connect on startup when cache exists.
 * 
 * Bug: initializeMcp filters startupServers to only keep-alive/eager servers
 * when cache file exists. Default "lazy" servers (no lifecycle field set) are
 * excluded entirely — they never get a connect() call.
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadMcpConfig: vi.fn(() => ({
    mcpServers: {
      srv_a: { command: "echo" },
      srv_b: { command: "echo" },
      srv_c: { command: "echo" },
    },
    settings: {},
  })),
  isServerCacheValid: vi.fn(() => true),
  computeServerHash: vi.fn(() => "hash"),
  loadMetadataCache: vi.fn(),
  saveMetadataCache: vi.fn(),
  getMetadataCachePath: vi.fn(() => "/tmp/mcp-meta-cache.json"),
  reconstructToolMetadata: vi.fn(() => []),
  existsSync: vi.fn(),
  openUrl: vi.fn(),
  connect: vi.fn(),
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

let connectCallCount = 0;

mocks.McpServerManager.mockImplementation(() => {
  const connections = new Map();
  return {
    connect: vi.fn().mockImplementation(async () => { connectCallCount++; return { status: "connected", tools: [], resources: [] }; }),
    close: vi.fn(), closeAll: vi.fn(),
    getConnection: (name: string) => connections.get(name),
    getAllConnections: () => connections,
    setSamplingConfig: vi.fn(), setElicitationConfig: vi.fn(),
    registerUiStreamListener: vi.fn(), removeUiStreamListener: vi.fn(),
    readResource: vi.fn(), touch: vi.fn(), incrementInFlight: vi.fn(),
    decrementInFlight: vi.fn(), isIdle: vi.fn(() => false),
    handleUrlElicitationRequired: vi.fn(),
  };
});
mocks.McpLifecycleManager.mockImplementation(() => ({
  registerServer: vi.fn(), markKeepAlive: vi.fn(),
  setGlobalIdleTimeout: vi.fn(), setReconnectCallback: vi.fn(),
  setIdleShutdownCallback: vi.fn(), startHealthChecks: vi.fn(),
  gracefulShutdown: vi.fn(),
}));
mocks.UiResourceHandler.mockImplementation(() => ({ register: vi.fn() }));
mocks.ConsentManager.mockImplementation(() => ({ setConfig: vi.fn(), approve: vi.fn(), disapprove: vi.fn() }));

describe("startup connection", () => {
  it("lazy servers with valid cache auto-connect on startup (FIXED)", async () => {
    connectCallCount = 0;
    // Simulate non-first startup: cache file exists with valid data
    mocks.existsSync.mockReturnValue(true);
    mocks.loadMetadataCache.mockReturnValue({
      version: 1,
      servers: {
        srv_a: { configHash: "hash", tools: [], resources: [], cachedAt: Date.now() },
        srv_b: { configHash: "hash", tools: [], resources: [], cachedAt: Date.now() },
        srv_c: { configHash: "hash", tools: [], resources: [], cachedAt: Date.now() },
      },
    });

    const { initializeMcp } = await import("../init.ts");
    const pi: any = { getFlag: () => undefined, sendMessage: vi.fn(), exec: vi.fn() };
    const ctx: any = {
      hasUI: true, mode: "tui", cwd: "/tmp",
      ui: { notify: vi.fn(), setStatus: vi.fn(), theme: { fg: (_k: string, s: string) => s } },
      model: "test-model", modelRegistry: undefined, signal: undefined,
    };

    const state = await initializeMcp(pi, ctx);

    // FIXED: 3 servers with valid cache now auto-connect
    expect(connectCallCount).toBe(3);
  });
});
