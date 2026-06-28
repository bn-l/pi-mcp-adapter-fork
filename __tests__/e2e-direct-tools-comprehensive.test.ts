/**
 * Comprehensive direct-tools.ts coverage tests
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lazyConnect: vi.fn().mockResolvedValue(true),
  getFailureAgeSeconds: vi.fn().mockReturnValue(null),
  authenticate: vi.fn(),
  supportsOAuth: vi.fn().mockReturnValue(false),
  isServerCacheValid: vi.fn().mockReturnValue(true),
  computeServerHash: vi.fn().mockReturnValue("hash"),
}));

vi.mock("../init.ts", () => ({
  lazyConnect: mocks.lazyConnect,
  getFailureAgeSeconds: mocks.getFailureAgeSeconds,
  updateStatusBar: vi.fn(),
  updateMetadataCache: vi.fn(),
  updateServerMetadata: vi.fn(),
}));
vi.mock("../mcp-auth-flow.ts", () => ({
  authenticate: mocks.authenticate,
  supportsOAuth: mocks.supportsOAuth,
  removeAuth: vi.fn(),
  completeAuthFromInput: vi.fn(),
  startAuth: vi.fn(),
  getStoredSessionProviderId: vi.fn(),
  MCP_SESSION_HEADER: "x-mcp-session",
}));
vi.mock("../metadata-cache.ts", () => ({
  isServerCacheValid: mocks.isServerCacheValid,
  computeServerHash: mocks.computeServerHash,
  loadMetadataCache: vi.fn().mockReturnValue(null),
  saveMetadataCache: vi.fn(),
  serializeTools: vi.fn().mockReturnValue([]),
  serializeResources: vi.fn().mockReturnValue([]),
  getMetadataCachePath: vi.fn().mockReturnValue(null),
  reconstructToolMetadata: vi.fn(),
}));

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    config: { mcpServers: {}, settings: {} },
    manager: {
      getConnection: vi.fn().mockReturnValue(null),
      connect: vi.fn(),
      close: vi.fn(),
      touch: vi.fn(),
      incrementInFlight: vi.fn(),
      decrementInFlight: vi.fn(),
      handleUrlElicitationRequired: vi.fn().mockResolvedValue("accept"),
    },
    toolMetadata: new Map(),
    failureTracker: new Map(),
    completedUiSessions: [],
    ui: undefined,
    ...overrides,
  };
}

describe("resolveDirectTools", () => {
  it("returns empty for null cache", async () => {
    const { resolveDirectTools } = await import("../direct-tools.ts");
    const result = resolveDirectTools({ mcpServers: {} }, null, "server");
    expect(result).toEqual([]);
  });

  it("handles envOverride server filter", async () => {
    mocks.isServerCacheValid.mockReturnValue(true);
    const { resolveDirectTools } = await import("../direct-tools.ts");
    const config: any = { mcpServers: { srv: { command: "x" } }, settings: {} };
    const cache: any = {
      servers: { srv: { tools: [{ name: "echo", description: "Echo" }], resources: [], cachedAt: Date.now() } },
    };
    const result = resolveDirectTools(config, cache, "server", ["srv"]);
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles envOverride tool filter matching", async () => {
    mocks.isServerCacheValid.mockReturnValue(true);
    const { resolveDirectTools } = await import("../direct-tools.ts");
    const config: any = { mcpServers: { srv: { command: "x" } }, settings: {} };
    const cache: any = {
      servers: { srv: { tools: [{ name: "echo", description: "Echo" }], resources: [], cachedAt: Date.now() } },
    };
    const result = resolveDirectTools(config, cache, "server", ["srv/echo"]);
    expect(result.length).toBe(1);
  });

  it("handles envOverride tool filter no-match", async () => {
    mocks.isServerCacheValid.mockReturnValue(true);
    const { resolveDirectTools } = await import("../direct-tools.ts");
    const config: any = { mcpServers: { srv: { command: "x" } }, settings: {} };
    const cache: any = {
      servers: { srv: { tools: [{ name: "echo", description: "Echo" }], resources: [], cachedAt: Date.now() } },
    };
    const result = resolveDirectTools(config, cache, "server", ["srv/other"]);
    expect(result).toEqual([]);
  });

  it("skips invalid cache entries", async () => {
    mocks.isServerCacheValid.mockReturnValue(false);
    const { resolveDirectTools } = await import("../direct-tools.ts");
    const config: any = { mcpServers: { srv: { command: "x" } }, settings: { directTools: true } };
    const cache: any = {
      servers: { srv: { tools: [{ name: "echo" }], resources: [], cachedAt: Date.now() } },
    };
    const result = resolveDirectTools(config, cache, "server");
    expect(result).toEqual([]);
  });

  it("handles envOverride trailing slash", async () => {
    mocks.isServerCacheValid.mockReturnValue(true);
    const { resolveDirectTools } = await import("../direct-tools.ts");
    const config: any = { mcpServers: { srv: { command: "x" } }, settings: {} };
    const cache: any = {
      servers: { srv: { tools: [{ name: "echo", description: "Echo" }], resources: [], cachedAt: Date.now() } },
    };
    const result = resolveDirectTools(config, cache, "server", ["srv/"]);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("getMissingConfiguredDirectToolServers", () => {
  it("returns empty when no direct tools", async () => {
    const { getMissingConfiguredDirectToolServers } = await import("../direct-tools.ts");
    expect(getMissingConfiguredDirectToolServers({ mcpServers: {} }, null)).toEqual([]);
  });

  it("returns servers with invalid cache", async () => {
    mocks.isServerCacheValid.mockReturnValue(false);
    const { getMissingConfiguredDirectToolServers } = await import("../direct-tools.ts");
    const config: any = { mcpServers: { srv: { directTools: true } } };
    const cache: any = { servers: { srv: { tools: [], resources: [], cachedAt: Date.now() } } };
    expect(getMissingConfiguredDirectToolServers(config, cache)).toContain("srv");
  });

  it("returns empty for valid cache", async () => {
    mocks.isServerCacheValid.mockReturnValue(true);
    const { getMissingConfiguredDirectToolServers } = await import("../direct-tools.ts");
    const config: any = { mcpServers: { srv: { directTools: true } } };
    const cache: any = { servers: { srv: { tools: [], resources: [], cachedAt: Date.now() } } };
    expect(getMissingConfiguredDirectToolServers(config, cache)).toEqual([]);
  });
});

describe("createDirectToolExecutor", () => {
  beforeEach(() => {
    mocks.lazyConnect.mockResolvedValue(true);
    mocks.getFailureAgeSeconds.mockReturnValue(null);
  });
  it("not-initialized state", async () => {
    const { createDirectToolExecutor } = await import("../direct-tools.ts");
    const exec = createDirectToolExecutor(() => null, () => null, { serverName: "srv", originalName: "echo", prefixedName: "srv_echo", description: "" });
    const result = await exec("id", {}, undefined, undefined, {} as any);
    expect(result.details.error).toBe("not_initialized");
  });

  it("init promise rejection", async () => {
    const { createDirectToolExecutor } = await import("../direct-tools.ts");
    const exec = createDirectToolExecutor(
      () => null,
      () => Promise.reject(new Error("config broken")),
      { serverName: "srv", originalName: "echo", prefixedName: "srv_echo", description: "" }
    );
    const result = await exec("id", {}, undefined, undefined, {} as any);
    expect(result.details.error).toBe("init_failed");
  });

  it("successful tool call", async () => {
    const { createDirectToolExecutor } = await import("../direct-tools.ts");
    const s = makeState({
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: {
        ...makeState().manager,
        getConnection: () => ({
          status: "connected",
          client: { callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "result" }], isError: false }) },
        }),
      },
    });
    const exec = createDirectToolExecutor(() => s, () => null, { serverName: "srv", originalName: "echo", prefixedName: "srv_echo", description: "" });
    const result = await exec("id", {}, undefined, undefined, {} as any);
    expect(result.content[0].text).toBe("result");
  });

  it("tool error with schema", async () => {
    const { createDirectToolExecutor } = await import("../direct-tools.ts");
    const s = makeState({
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: {
        ...makeState().manager,
        getConnection: () => ({
          status: "connected",
          client: { callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "bad" }], isError: true }) },
        }),
      },
    });
    const exec = createDirectToolExecutor(() => s, () => null, {
      serverName: "srv", originalName: "echo", prefixedName: "srv_echo",
      description: "", inputSchema: { type: "object", properties: { k: { type: "string" } } },
    });
    const result = await exec("id", {}, undefined, undefined, {} as any);
    expect(result.content[0].text).toContain("Error:");
  });

  it("not connected after lazy connect fail", async () => {
    mocks.lazyConnect.mockResolvedValue(false);
    const { createDirectToolExecutor } = await import("../direct-tools.ts");
    const s = makeState({
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: { ...makeState().manager, getConnection: () => ({ status: "closed" }) },
    });
    const exec = createDirectToolExecutor(() => s, () => null, { serverName: "srv", originalName: "echo", prefixedName: "srv_echo", description: "" });
    const result = await exec("id", {}, undefined, undefined, {} as any);
    expect(result.details.error).toBe("server_unavailable");
  });

  it("UrlElicitationRequiredError is caught", async () => {
    const { UrlElicitationRequiredError } = await import("@modelcontextprotocol/sdk/types.js");
    const { createDirectToolExecutor } = await import("../direct-tools.ts");
    const s = makeState({
      config: { mcpServers: { srv: { command: "x" } }, settings: {} },
      manager: {
        ...makeState().manager,
        getConnection: () => ({
          status: "connected",
          client: { callTool: vi.fn().mockRejectedValue(new UrlElicitationRequiredError("http://e.com", "uuid")) },
        }),
      },
    });
    const exec = createDirectToolExecutor(() => s, () => null, { serverName: "srv", originalName: "echo", prefixedName: "srv_echo", description: "" });
    const result = await exec("id", {}, undefined, undefined, {} as any);
    expect(result.details.error).toBe("url_elicitation_required");
  });
});
