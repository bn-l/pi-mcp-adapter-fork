/**
 * Tests for init.ts functions
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadMcpConfig: vi.fn(() => ({ mcpServers: {}, settings: {} })),
  buildToolMetadata: vi.fn(() => ({ metadata: [{ name: "t1" }], failedTools: [] })),
  loadMetadataCache: vi.fn(() => null),
  saveMetadataCache: vi.fn(),
  computeServerHash: vi.fn(() => "hash"),
  serializeTools: vi.fn(() => []),
  serializeResources: vi.fn(() => []),
  getMetadataCachePath: vi.fn(() => null),
}));

vi.mock("../config.ts", () => ({ loadMcpConfig: mocks.loadMcpConfig }));
vi.mock("../tool-metadata.ts", () => ({ buildToolMetadata: mocks.buildToolMetadata }));
vi.mock("../metadata-cache.ts", () => ({
  loadMetadataCache: mocks.loadMetadataCache,
  saveMetadataCache: mocks.saveMetadataCache,
  computeServerHash: mocks.computeServerHash,
  serializeTools: mocks.serializeTools,
  serializeResources: mocks.serializeResources,
  getMetadataCachePath: mocks.getMetadataCachePath,
}));
vi.mock("../utils.ts", () => ({ openPath: vi.fn(), parallelLimit: async (_: any, __: any, fn: any) => await fn(null) }));
vi.mock("../server-manager.ts", () => ({ McpServerManager: vi.fn(() => ({ connect: vi.fn().mockResolvedValue({ status: "connected", tools: [], resources: [] }), close: vi.fn(), closeAll: vi.fn(), getConnection: vi.fn(), getAllConnections: vi.fn(() => new Map()), isValid: vi.fn(() => true) })) }));

describe("isTuiMode", () => {
  it("true for TUI mode", async () => {
    const { isTuiMode } = await import("../init.ts");
    expect(isTuiMode({ hasUI: true, mode: "tui" } as any)).toBe(true);
  });
  it("false otherwise", async () => {
    const { isTuiMode } = await import("../init.ts");
    expect(isTuiMode({ hasUI: true, mode: "rpc" } as any)).toBe(false);
    expect(isTuiMode({ hasUI: false, mode: "tui" } as any)).toBe(false);
  });
});

describe("updateServerMetadata", () => {
  it("updates metadata for connected server", async () => {
    const { updateServerMetadata } = await import("../init.ts");
    const state: any = {
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: () => ({ status: "connected", tools: [{ name: "t1" }], resources: [] }) },
      toolMetadata: new Map(),
    };
    updateServerMetadata(state, "srv");
    expect(state.toolMetadata.get("srv")).toBeDefined();
  });
  it("skips non-connected servers", async () => {
    const { updateServerMetadata } = await import("../init.ts");
    const state: any = { manager: { getConnection: () => null }, toolMetadata: new Map() };
    updateServerMetadata(state, "srv");
    expect(state.toolMetadata.size).toBe(0);
  });
});

describe("updateMetadataCache", () => {
  it("saves to cache for connected server", async () => {
    const { updateMetadataCache } = await import("../init.ts");
    const state: any = {
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: () => ({ status: "connected", tools: [], resources: [] }) },
    };
    updateMetadataCache(state, "srv");
    expect(mocks.saveMetadataCache).toHaveBeenCalled();
  });
  it("skips non-connected servers", async () => {
    const { updateMetadataCache } = await import("../init.ts");
    mocks.saveMetadataCache.mockClear();
    const state: any = { manager: { getConnection: () => null }, config: { mcpServers: {} }, settings: {} };
    updateMetadataCache(state, "srv");
    expect(mocks.saveMetadataCache).not.toHaveBeenCalled();
  });
});

// flushMetadataCache tested indirectly via updateMetadataCache/updateServerMetadata
describe("updateStatusBar", () => {
  it("no-op without UI", async () => {
    const { updateStatusBar } = await import("../init.ts");
    expect(() => updateStatusBar({ config: { mcpServers: {} } } as any)).not.toThrow();
  });
  it("clears status for zero servers", async () => {
    const { updateStatusBar } = await import("../init.ts");
    const setStatus = vi.fn();
    updateStatusBar({ config: { mcpServers: {} }, ui: { setStatus, theme: { fg: (_: string, s: string) => s } } } as any);
    expect(setStatus).toHaveBeenCalledWith("mcp", undefined);
  });
  it("shows server count", async () => {
    const { updateStatusBar } = await import("../init.ts");
    const setStatus = vi.fn();
    updateStatusBar({
      config: { mcpServers: { a: { command: "a" } } },
      manager: { getAllConnections: () => new Map() },
      ui: { setStatus, theme: { fg: (_: string, s: string) => `styled:${s}` } },
    } as any);
    expect(setStatus).toHaveBeenCalledWith("mcp", "styled:MCP: 0/1 servers");
  });
});

describe("getFailureAgeSeconds", () => {
  it("null for missing server", async () => {
    const { getFailureAgeSeconds } = await import("../init.ts");
    expect(getFailureAgeSeconds({ failureTracker: new Map() } as any, "srv")).toBeNull();
  });
  it("returns age in seconds", async () => {
    const { getFailureAgeSeconds } = await import("../init.ts");
    const age = getFailureAgeSeconds({ failureTracker: new Map([["srv", Date.now() - 5000]]), config: { settings: {} } } as any, "srv");
    expect(age).toBeGreaterThanOrEqual(4);
    expect(age).toBeLessThanOrEqual(6);
  });
  it("null when older than backoff", async () => {
    const { getFailureAgeSeconds } = await import("../init.ts");
    expect(getFailureAgeSeconds({ failureTracker: new Map([["srv", Date.now() - 120000]]), config: { settings: {} } } as any, "srv")).toBeNull();
  });
});

describe("lazyConnect", () => {
  it("returns true for connected server", async () => {
    const { lazyConnect } = await import("../init.ts");
    const state: any = {
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: () => ({ status: "connected", tools: [], resources: [] }), connect: vi.fn() },
      toolMetadata: new Map(),
      failureTracker: new Map(),
    };
    expect(await lazyConnect(state, "srv")).toBe(true);
  });
  it("returns false for unknown server", async () => {
    const { lazyConnect } = await import("../init.ts");
    const state: any = {
      config: { mcpServers: {} },
      manager: { getConnection: () => null, connect: vi.fn() },
      toolMetadata: new Map(),
      failureTracker: new Map(),
    };
    expect(await lazyConnect(state, "unknown")).toBe(false);
  });
  it("returns false for needs-auth", async () => {
    const { lazyConnect } = await import("../init.ts");
    const state: any = {
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: () => ({ status: "needs-auth" }), connect: vi.fn() },
      toolMetadata: new Map(),
      failureTracker: new Map(),
    };
    expect(await lazyConnect(state, "srv")).toBe(false);
  });
  it("returns false on connect failure", async () => {
    const { lazyConnect } = await import("../init.ts");
    const state: any = {
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: () => null, connect: vi.fn().mockRejectedValue(new Error("fail")) },
      toolMetadata: new Map(),
      failureTracker: new Map(),
    };
    expect(await lazyConnect(state, "srv")).toBe(false);
    expect(state.failureTracker.has("srv")).toBe(true);
  });
  it("connects new server", async () => {
    const { lazyConnect } = await import("../init.ts");
    const state: any = {
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: () => null, connect: vi.fn().mockResolvedValue({ status: "connected", tools: [], resources: [] }) },
      toolMetadata: new Map(),
      failureTracker: new Map(),
    };
    expect(await lazyConnect(state, "srv")).toBe(true);
  });
  it("respects failure backoff", async () => {
    const { lazyConnect } = await import("../init.ts");
    const state: any = {
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { getConnection: () => null, connect: vi.fn() },
      toolMetadata: new Map(),
      failureTracker: new Map([["srv", Date.now() - 1000]]),
    };
    expect(await lazyConnect(state, "srv")).toBe(false);
  });
});
