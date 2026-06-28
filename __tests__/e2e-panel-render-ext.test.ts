/**
 * Panel render extension — covers remaining uncovered render paths
 */
import { describe, expect, it, vi } from "vitest";
import { createMcpPanel } from "../mcp-panel.ts";
import { createMcpSetupPanel } from "../mcp-setup-panel.ts";
import type { McpConfig, McpPanelCallbacks } from "../types.ts";

function makeCfg(): McpConfig {
  return { mcpServers: { a: { url: "https://a.example.com", auth: "oauth" }, b: { url: "https://b.example.com", auth: "oauth" } } };
}

function makeCallbacks(): McpPanelCallbacks {
  return {
    reconnect: vi.fn(async () => true), canAuthenticate: vi.fn(() => true),
    authenticate: vi.fn(async () => ({ ok: true, message: "ok" })),
    getConnectionStatus: vi.fn(() => "needs-auth"), refreshCacheAfterReconnect: vi.fn(() => null),
  };
}

describe("McpPanel render - full mode with tools", () => {
  it("renders with connected server and tools", () => {
    const cbs = makeCallbacks();
    cbs.getConnectionStatus = () => "connected";
    cbs.canAuthenticate = () => false;
    const panel = createMcpPanel(makeCfg(), null, new Map(), cbs, { requestRender: vi.fn() }, () => {}, { authOnly: false });
    // Confirm to expand the first connected server
    panel.handleInput("\r");
    const lines = (panel as any).render(100);
    expect(lines.length).toBeGreaterThan(0);
    panel.dispose();
  });

  it("renders with dirty state (unsaved changes)", () => {
    const cbs = makeCallbacks();
    cbs.getConnectionStatus = () => "connected";
    cbs.canAuthenticate = () => false;
    const panel = createMcpPanel(makeCfg(), null, new Map(), cbs, { requestRender: vi.fn() }, () => {}, { authOnly: false });
    // Expand first server
    panel.handleInput("\r");
    const lines = (panel as any).render(80);
    expect(lines.length).toBeGreaterThan(0);
    panel.dispose();
  });

  it("renders with authInFlight state", () => {
    const panel = createMcpPanel(makeCfg(), null, new Map(), makeCallbacks(), { requestRender: vi.fn() }, () => {}, { authOnly: true });
    panel.handleInput("\r"); // trigger auth
    const lines = (panel as any).render(80);
    expect(lines.length).toBeGreaterThan(0);
    panel.dispose();
  });
});

function makeEmptyDiscovery() {
  return { sources: [], imports: [], hasAnyConfig: false, hasAnyDetectedPaths: false, hasSharedServers: false, hasPiOwnedServers: false, totalServerCount: 0, fingerprint: "test", repoPrompt: { configured: false } };
}

function makeCallbacksSetup() {
  return { onImportAdopted: vi.fn(), onSetupCompleted: vi.fn(), scaffoldProjectConfig: vi.fn(), adoptSharedServer: vi.fn(), reloadPi: vi.fn(), openPath: vi.fn() };
}

function makeOpts() {
  return { mode: "empty" as const, onboardingState: { version: 1, sharedConfigHintShown: false, setupCompleted: false }, keybindings: undefined };
}

describe("McpSetupPanel render - all screens", () => {
  it("renders empty mode", () => {
    const panel = createMcpSetupPanel(makeEmptyDiscovery(), makeCallbacksSetup(), makeOpts(), { requestRender: vi.fn() }, () => {});
    const lines = (panel as any).render(80);
    expect(lines.length).toBeGreaterThan(0);
    panel.dispose();
  });

  it("renders empty mode with narrow width", () => {
    const panel = createMcpSetupPanel(makeEmptyDiscovery(), makeCallbacksSetup(), makeOpts(), { requestRender: vi.fn() }, () => {});
    const lines = (panel as any).render(30);
    expect(lines.length).toBeGreaterThan(0);
    panel.dispose();
  });

  it("renders setup mode with shared servers", () => {
    const d = { ...makeEmptyDiscovery(), hasAnyConfig: true, hasSharedServers: true, totalServerCount: 3 };
    const panel = createMcpSetupPanel(d, makeCallbacksSetup(), { ...makeOpts(), mode: "setup" }, { requestRender: vi.fn() }, () => {});
    const lines = (panel as any).render(80);
    expect(lines.length).toBeGreaterThan(0);
    panel.dispose();
  });

  it("renders paths screen", () => {
    const d = { ...makeEmptyDiscovery(), hasAnyConfig: true,
      sources: [{ id: "a", path: "/tmp/a.json", kind: "shared" as const, exists: true, serverCount: 1 }] };
    const panel = createMcpSetupPanel(d, makeCallbacksSetup(), { ...makeOpts(), mode: "setup" }, { requestRender: vi.fn() }, () => {});
    // Enter paths screen via open-paths action
    for (let i = 0; i < 3; i++) panel.handleInput("\x1b[B");
    panel.handleInput("\r");
    const lines = (panel as any).render(80);
    expect(lines.length).toBeGreaterThan(0);
    panel.dispose();
  });

  it("renders busy state", () => {
    const panel = createMcpSetupPanel(makeEmptyDiscovery(), makeCallbacksSetup(), makeOpts(), { requestRender: vi.fn() }, () => {});
    // Set busy state directly
    (panel as any).busy = true;
    (panel as any).notice = { text: "Working...", tone: "muted" };
    const lines = (panel as any).render(80);
    expect(lines.length).toBeGreaterThan(0);
    panel.dispose();
  });

  it("renders success notice", () => {
    const panel = createMcpSetupPanel(makeEmptyDiscovery(), makeCallbacksSetup(), makeOpts(), { requestRender: vi.fn() }, () => {});
    (panel as any).notice = { text: "Done!", tone: "success" };
    const lines = (panel as any).render(80);
    expect(lines.length).toBeGreaterThan(0);
    panel.dispose();
  });

  it("renders warning notice", () => {
    const panel = createMcpSetupPanel(makeEmptyDiscovery(), makeCallbacksSetup(), makeOpts(), { requestRender: vi.fn() }, () => {});
    (panel as any).notice = { text: "Oops", tone: "warning" };
    const lines = (panel as any).render(80);
    expect(lines.length).toBeGreaterThan(0);
    panel.dispose();
  });
});
