/**
 * Comprehensive tests for commands.ts — all exported functions
 * Uses mock UI pattern (vi.fn() stubs for notify, setStatus, custom).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

const mocks = {
  createMcpPanel: vi.fn(),
  createMcpSetupPanel: vi.fn(),
  authenticate: vi.fn(),
  removeAuth: vi.fn(),
  supportsOAuth: vi.fn(),
  lazyConnect: vi.fn(),
  updateServerMetadata: vi.fn(),
  updateMetadataCache: vi.fn(),
  updateStatusBar: vi.fn(),
  getFailureAgeSeconds: vi.fn(),
  buildToolMetadata: vi.fn(),
  getMcpDiscoverySummary: vi.fn(),
  getServerProvenance: vi.fn(),
  loadOnboardingState: vi.fn(),
  persistSetupCompleted: vi.fn(),
  ensureCompatibilityImports: vi.fn(),
  writeStarterProjectConfig: vi.fn(),
  writeSharedServerEntry: vi.fn(),
  openPath: vi.fn(),
};

vi.mock("../mcp-panel.ts", () => ({ createMcpPanel: mocks.createMcpPanel }));
vi.mock("../mcp-setup-panel.ts", () => ({ createMcpSetupPanel: mocks.createMcpSetupPanel }));
vi.mock("../mcp-auth-flow.ts", () => ({
  authenticate: mocks.authenticate,
  removeAuth: mocks.removeAuth,
  supportsOAuth: mocks.supportsOAuth,
}));
vi.mock("../init.ts", () => ({
  lazyConnect: mocks.lazyConnect,
  updateServerMetadata: mocks.updateServerMetadata,
  updateMetadataCache: mocks.updateMetadataCache,
  updateStatusBar: mocks.updateStatusBar,
  getFailureAgeSeconds: mocks.getFailureAgeSeconds,
}));
vi.mock("../tool-metadata.ts", () => ({ buildToolMetadata: mocks.buildToolMetadata }));
vi.mock("../config.ts", () => ({
  getMcpDiscoverySummary: mocks.getMcpDiscoverySummary,
  getServerProvenance: mocks.getServerProvenance,
  ensureCompatibilityImports: mocks.ensureCompatibilityImports,
  writeStarterProjectConfig: mocks.writeStarterProjectConfig,
  writeSharedServerEntry: mocks.writeSharedServerEntry,
}));
vi.mock("../onboarding-state.ts", () => ({
  loadOnboardingState: mocks.loadOnboardingState,
  persistSetupCompleted: mocks.persistSetupCompleted,
}));
vi.mock("../utils.ts", () => ({ openPath: mocks.openPath }));

describe("commands", () => {
  const originalHome = process.env.HOME;
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.resetModules();
    mocks.createMcpPanel.mockReset().mockImplementation((_a, _b, _c, _d, _e, done) => {
      done({ cancelled: true, changes: new Map() });
      return { dispose() {} };
    });
    mocks.createMcpSetupPanel.mockReset().mockImplementation((_a, _b, _c, _d, done) => {
      done();
      return { dispose() {} };
    });
    mocks.getMcpDiscoverySummary.mockReturnValue({
      sources: [], imports: [], hasAnyConfig: true, hasAnyDetectedPaths: false,
      hasSharedServers: false, hasPiOwnedServers: false, totalServerCount: 0,
      fingerprint: "fp1", repoPrompt: { configured: false },
    });
    mocks.getServerProvenance.mockReturnValue(new Map());
    mocks.loadOnboardingState.mockReturnValue({ sharedConfigHintShown: true, setupCompleted: false });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.chdir(originalCwd);
  });

  function ui() {
    return {
      notify: vi.fn(),
      setStatus: vi.fn(),
      custom: vi.fn().mockImplementation((renderer: any) => {
        const tui = { requestRender: vi.fn() };
        const done = vi.fn();
        return renderer(tui, {}, {}, done);
      }),
    };
  }

  describe("showStatus", () => {
    it("shows connected server", async () => {
      const { showStatus } = await import("../commands.ts");
      const u = ui();
      const state = {
        config: { mcpServers: { srv: { command: "x" } } },
        manager: { getConnection: () => ({ status: "connected" }) },
        toolMetadata: new Map([["srv", [{ name: "t1" }, { name: "t2" }]]]),
        failureTracker: new Map(),
      } as any;

      await showStatus(state, { hasUI: true, ui: u } as any);
      expect(u.notify).toHaveBeenCalledWith(expect.stringContaining("✓ srv: connected"), "info");
    });

    it("shows needs-auth server", async () => {
      const { showStatus } = await import("../commands.ts");
      const u = ui();
      const state = {
        config: { mcpServers: { srv: { command: "x" } } },
        manager: { getConnection: () => ({ status: "needs-auth" }) },
        toolMetadata: new Map(),
        failureTracker: new Map(),
      } as any;

      await showStatus(state, { hasUI: true, ui: u } as any);
      expect(u.notify).toHaveBeenCalledWith(expect.stringContaining("⚠ srv: needs auth"), "info");
    });

    it("shows failed server", async () => {
      const { showStatus } = await import("../commands.ts");
      const u = ui();
      mocks.getFailureAgeSeconds.mockReturnValue(30);
      const state = {
        config: { mcpServers: { srv: { command: "x" } } },
        manager: { getConnection: () => undefined },
        toolMetadata: new Map(),
        failureTracker: new Map(),
      } as any;

      await showStatus(state, { hasUI: true, ui: u } as any);
      expect(u.notify).toHaveBeenCalledWith(expect.stringContaining("✗ srv: failed 30s ago"), "info");
    });

    it("shows cached server", async () => {
      const { showStatus } = await import("../commands.ts");
      const u = ui();
      mocks.getFailureAgeSeconds.mockReturnValue(null);
      const state = {
        config: { mcpServers: { srv: { command: "x" } } },
        manager: { getConnection: () => undefined },
        toolMetadata: new Map([["srv", [{ name: "t1" }]]]),
        failureTracker: new Map(),
      } as any;

      await showStatus(state, { hasUI: true, ui: u } as any);
      expect(u.notify).toHaveBeenCalledWith(expect.stringContaining("○ srv"), "info");
    });

    it("shows no servers message", async () => {
      const { showStatus } = await import("../commands.ts");
      const u = ui();
      await showStatus(
        { config: { mcpServers: {} }, manager: { getConnection: () => null }, toolMetadata: new Map(), failureTracker: new Map() } as any,
        { hasUI: true, ui: u } as any
      );
      expect(u.notify).toHaveBeenCalledWith(expect.stringContaining("No MCP servers configured"), "info");
    });

    it("does nothing without UI", async () => {
      const { showStatus } = await import("../commands.ts");
      const u = ui();
      await showStatus({ config: { mcpServers: {} } } as any, { hasUI: false, ui: u } as any);
      expect(u.notify).not.toHaveBeenCalled();
    });
  });

  describe("showTools", () => {
    it("shows tool list", async () => {
      const { showTools } = await import("../commands.ts");
      const u = ui();
      const state = {
        toolMetadata: new Map([["srv", [{ name: "t1" }, { name: "t2" }]]]),
      } as any;

      await showTools(state, { hasUI: true, ui: u } as any);
      expect(u.notify).toHaveBeenCalledWith(expect.stringContaining("Total: 2 tools"), "info");
    });

    it("shows no tools message", async () => {
      const { showTools } = await import("../commands.ts");
      const u = ui();
      await showTools({ toolMetadata: new Map() } as any, { hasUI: true, ui: u } as any);
      expect(u.notify).toHaveBeenCalledWith("No MCP tools available", "info");
    });

    it("does nothing without UI", async () => {
      const { showTools } = await import("../commands.ts");
      const u = ui();
      await showTools({ toolMetadata: new Map() } as any, { hasUI: false, ui: u } as any);
      expect(u.notify).not.toHaveBeenCalled();
    });
  });

  describe("reconnectServers", () => {
    it("reconnects a server successfully", async () => {
      const { reconnectServers } = await import("../commands.ts");
      const u = ui();
      const conn = { status: "connected", tools: [{ name: "t1" }], resources: [{ name: "r1", uri: "r://1" }] };
      const mgr = { close: vi.fn(), connect: vi.fn().mockResolvedValue(conn) };
      const state: any = {
        config: { mcpServers: { srv: { command: "x" } }, settings: {} },
        manager: mgr,
        toolMetadata: new Map(),
        failureTracker: new Map(),
      };
      mocks.buildToolMetadata.mockReturnValue({ metadata: [{ name: "t1" }], failedTools: [] });

      await reconnectServers(state, { hasUI: true, ui: u } as any, "srv");
      expect(mgr.close).toHaveBeenCalledWith("srv");
      expect(mgr.connect).toHaveBeenCalledWith("srv", { command: "x" });
      expect(u.notify).toHaveBeenCalledWith(expect.stringContaining("Reconnected to srv"), "info");
    });

    it("shows error for unknown server", async () => {
      const { reconnectServers } = await import("../commands.ts");
      const u = ui();
      const state: any = {
        config: { mcpServers: {} },
        manager: { close: vi.fn(), connect: vi.fn() },
        toolMetadata: new Map(),
        failureTracker: new Map(),
      };
      await reconnectServers(state, { hasUI: true, ui: u } as any, "unknown");
      expect(u.notify).toHaveBeenCalledWith(expect.stringContaining("not found"), "error");
    });

    it("handles needs-auth after reconnect", async () => {
      const { reconnectServers } = await import("../commands.ts");
      const u = ui();
      const mgr = { close: vi.fn(), connect: vi.fn().mockResolvedValue({ status: "needs-auth", tools: [], resources: [] }) };
      const state: any = {
        config: { mcpServers: { srv: { command: "x" } }, settings: {} },
        manager: mgr,
        toolMetadata: new Map(),
        failureTracker: new Map(),
      };
      await reconnectServers(state, { hasUI: true, ui: u } as any, "srv");
      expect(u.notify).toHaveBeenCalledWith(expect.stringContaining("requires OAuth"), "warning");
    });

    it("handles connection failure", async () => {
      const { reconnectServers } = await import("../commands.ts");
      const u = ui();
      const mgr = { close: vi.fn(), connect: vi.fn().mockRejectedValue(new Error("boom")) };
      const state: any = {
        config: { mcpServers: { srv: { command: "x" } }, settings: {} },
        manager: mgr,
        toolMetadata: new Map(),
        failureTracker: new Map(),
      };
      await reconnectServers(state, { hasUI: true, ui: u } as any, "srv");
      expect(u.notify).toHaveBeenCalledWith(expect.stringContaining("Failed to reconnect"), "error");
      expect(state.failureTracker.has("srv")).toBe(true);
    });
  });

  describe("authenticateServer", () => {
    it("returns error without UI", async () => {
      const { authenticateServer } = await import("../commands.ts");
      const result = await authenticateServer("srv", { mcpServers: {} }, { hasUI: false } as any);
      expect(result.ok).toBe(false);
    });

    it("returns error for unknown server", async () => {
      const { authenticateServer } = await import("../commands.ts");
      const u = ui();
      const result = await authenticateServer("srv", { mcpServers: {} }, { hasUI: true, ui: u } as any);
      expect(result.ok).toBe(false);
      expect(u.notify).toHaveBeenCalledWith(expect.stringContaining("not found"), "error");
    });

    it("returns error for non-OAuth server", async () => {
      const { authenticateServer } = await import("../commands.ts");
      const u = ui();
      mocks.supportsOAuth.mockReturnValue(false);
      const result = await authenticateServer("srv", { mcpServers: { srv: { command: "x" } } }, { hasUI: true, ui: u } as any);
      expect(result.ok).toBe(false);
    });

    it("returns error for OAuth server without URL", async () => {
      const { authenticateServer } = await import("../commands.ts");
      const u = ui();
      mocks.supportsOAuth.mockReturnValue(true);
      const result = await authenticateServer("srv", { mcpServers: { srv: { command: "x" } } }, { hasUI: true, ui: u } as any);
      expect(result.ok).toBe(false);
    });

    it("authenticates successfully", async () => {
      const { authenticateServer } = await import("../commands.ts");
      const u = ui();
      mocks.supportsOAuth.mockReturnValue(true);
      mocks.authenticate.mockResolvedValue("authenticated");
      const result = await authenticateServer("srv", { mcpServers: { srv: { url: "http://srv" } } }, { hasUI: true, ui: u } as any);
      expect(result.ok).toBe(true);
      expect(u.setStatus).toHaveBeenCalledWith("mcp-auth", expect.any(String));
    });

    it("handles auth failure", async () => {
      const { authenticateServer } = await import("../commands.ts");
      const u = ui();
      mocks.supportsOAuth.mockReturnValue(true);
      mocks.authenticate.mockRejectedValue(new Error("auth error"));
      const result = await authenticateServer("srv", { mcpServers: { srv: { url: "http://srv" } } }, { hasUI: true, ui: u } as any);
      expect(result.ok).toBe(false);
      expect(u.setStatus).toHaveBeenCalledWith("mcp-auth", undefined);
    });
  });

  describe("logoutServer", () => {
    it("logs out successfully", async () => {
      const { logoutServer } = await import("../commands.ts");
      const u = ui();
      const state: any = {
        config: { mcpServers: { srv: { command: "x" } } },
        manager: { close: vi.fn() },
      };
      const result = await logoutServer("srv", state, { hasUI: true, ui: u } as any);
      expect(result.ok).toBe(true);
      expect(mocks.removeAuth).toHaveBeenCalledWith("srv");
    });

    it("returns error for unknown server", async () => {
      const { logoutServer } = await import("../commands.ts");
      const u = ui();
      const result = await logoutServer("srv", { config: { mcpServers: {} } } as any, { hasUI: true, ui: u } as any);
      expect(result.ok).toBe(false);
    });
  });

  describe("openMcpPanel", () => {
    it("opens panel for configured servers", async () => {
      const { openMcpPanel } = await import("../commands.ts");
      const u = ui();
      const state: any = {
        config: { mcpServers: { srv: { command: "x" } } },
        manager: { getConnection: () => null },
        toolMetadata: new Map([["srv", [{ name: "t1" }]]]),
        failureTracker: new Map(),
      };
      await openMcpPanel(state, { getFlag: () => undefined } as any, { hasUI: true, ui: u, cwd: "/tmp" } as any);
      expect(mocks.createMcpPanel).toHaveBeenCalled();
    });
  });

  describe("openMcpAuthPanel", () => {
    it("opens auth panel", async () => {
      const { openMcpAuthPanel } = await import("../commands.ts");
      const u = ui();
      const state: any = {
        config: { mcpServers: { srv: { command: "x" } } },
        manager: { getConnection: () => null },
        toolMetadata: new Map(),
        failureTracker: new Map(),
      };
      await openMcpAuthPanel(state, { getFlag: () => undefined } as any, { hasUI: true, ui: u, cwd: "/tmp" } as any);
      expect(mocks.createMcpPanel).toHaveBeenCalled();
    });
  });

  describe("openMcpSetup", () => {
    it("opens setup flow", async () => {
      const { openMcpSetup } = await import("../commands.ts");
      const u = ui();
      const pi = { getFlag: () => undefined };
      await openMcpSetup({} as any, pi as any, { hasUI: true, ui: u, cwd: "/tmp" } as any);
      expect(mocks.createMcpSetupPanel).toHaveBeenCalled();
    });
  });
});
