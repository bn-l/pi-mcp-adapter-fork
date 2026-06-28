/**
 * McpPanel + McpSetupPanel render tests — verifies render() produces output
 */
import { describe, expect, it, vi } from "vitest";
import { createMcpPanel } from "../mcp-panel.ts";
import { createMcpSetupPanel } from "../mcp-setup-panel.ts";
import type { McpConfig, McpPanelCallbacks } from "../types.ts";

function makeCfg(): McpConfig {
  return {
    mcpServers: {
      srv1: { url: "https://srv1.example.com", auth: "oauth" },
      srv2: { url: "https://srv2.example.com", auth: "oauth" },
    },
  };
}

function makeCallbacks(): McpPanelCallbacks {
  return {
    reconnect: vi.fn(async () => true),
    canAuthenticate: vi.fn(() => true),
    authenticate: vi.fn(async () => ({ ok: true, message: "ok" })),
    getConnectionStatus: vi.fn(() => "needs-auth"),
    refreshCacheAfterReconnect: vi.fn(() => null),
  };
}

describe("McpPanel render", () => {
  it("renders authOnly panel without crashing", () => {
    const panel = createMcpPanel(makeCfg(), null, new Map(), makeCallbacks(), { requestRender: vi.fn() }, () => {}, { authOnly: true });
    const lines = (panel as any).render(80);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l: string) => l.includes("MCP"))).toBe(true);
    panel.dispose();
  });

  it("renders full mode panel without crashing", () => {
    const panel = createMcpPanel(makeCfg(), null, new Map(), makeCallbacks(), { requestRender: vi.fn() }, () => {}, { authOnly: false });
    const lines = (panel as any).render(80);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    panel.dispose();
  });
});

describe("McpSetupPanel render", () => {
  const emptyDiscovery = {
    sources: [],
    imports: [],
    hasAnyConfig: false,
    hasAnyDetectedPaths: false,
    hasSharedServers: false,
    hasPiOwnedServers: false,
    totalServerCount: 0,
    fingerprint: "test",
    repoPrompt: { configured: false },
  };

  it("renders empty mode without crashing", () => {
    const panel = createMcpSetupPanel(
      emptyDiscovery,
      { onImportAdopted: vi.fn(), onSetupCompleted: vi.fn(),
        scaffoldProjectConfig: vi.fn(), adoptSharedServer: vi.fn(),
        reloadPi: vi.fn(), openPath: vi.fn() },
      { mode: "empty", onboardingState: { version: 1, sharedConfigHintShown: false, setupCompleted: false }, keybindings: undefined },
      { requestRender: vi.fn() },
      () => {},
    );
    const lines = (panel as any).render(80);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    panel.dispose();
  });

  it("renders setup mode without crashing", () => {
    const discovery = { ...emptyDiscovery, hasAnyConfig: true };
    const panel = createMcpSetupPanel(
      discovery,
      { onImportAdopted: vi.fn(), onSetupCompleted: vi.fn(),
        scaffoldProjectConfig: vi.fn(), adoptSharedServer: vi.fn(),
        reloadPi: vi.fn(), openPath: vi.fn() },
      { mode: "setup", onboardingState: { version: 1, sharedConfigHintShown: false, setupCompleted: false }, keybindings: undefined },
      { requestRender: vi.fn() },
      () => {},
    );
    const lines = (panel as any).render(80);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    panel.dispose();
  });

  // imports screen rendering tested via the McpSetupPanel actions tests above
});
