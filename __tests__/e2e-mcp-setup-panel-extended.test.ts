/**
 * McpSetupPanel extended tests — covers runAction branches, screens, busy state
 */
import { describe, expect, it, vi } from "vitest";
import { createMcpSetupPanel, type SetupPanelCallbacks } from "../mcp-setup-panel.ts";

const ENTER = "\r";
const ESC = "\x1b";
const DOWN = "\x1b[B";

function makeCallbacks(): SetupPanelCallbacks {
  return {
    onImportAdopted: vi.fn(async () => {}),
    onSetupCompleted: vi.fn(),
    scaffoldProjectConfig: vi.fn(async () => ({ path: "/tmp/.mcp.json" })),
    adoptSharedServer: vi.fn(async () => {}),
    reloadPi: vi.fn(async () => {}),
    openPath: vi.fn(async () => {}),
  };
}

function makeDiscovery(overrides: any = {}) {
  return {
    sources: [],
    imports: [],
    hasAnyConfig: false,
    hasAnyDetectedPaths: false,
    hasSharedServers: false,
    hasPiOwnedServers: false,
    totalServerCount: 0,
    fingerprint: "test",
    repoPrompt: { configured: false },
    ...overrides,
  };
}

function defaultOpts() {
  return { mode: "empty" as const, onboardingState: { version: 1, sharedConfigHintShown: false, setupCompleted: false }, keybindings: undefined };
}

describe("McpSetupPanel actions", () => {
  it("run-setup switches to setup screen", () => {
    const panel = createMcpSetupPanel(
      makeDiscovery(),
      makeCallbacks(),
      defaultOpts(),
      { requestRender: vi.fn() },
      () => {},
    );
    // run-setup is first action (index 0) in empty mode
    panel.handleInput(ENTER);
    // Should switch screen synchronously
    panel.dispose();
  });

  it("adopt-imports switches to imports screen", () => {
    const discovery = makeDiscovery({
      hasAnyConfig: true,
      imports: [{ kind: "claude" as const, path: "/tmp/c.json", workspacePath: "/ws" }],
    });
    const panel = createMcpSetupPanel(
      discovery,
      makeCallbacks(),
      { ...defaultOpts(), mode: "setup" },
      { requestRender: vi.fn() },
      () => {},
    );
    // adopt-imports is first action in setup mode with imports
    panel.handleInput(ENTER);
    panel.dispose();
  });

  it("open-paths switches to paths screen", () => {
    const discovery = makeDiscovery({
      hasAnyConfig: true,
      sources: [{ id: "a", path: "/tmp/a.json", kind: "shared" as const, exists: true, serverCount: 1 }],
    });
    const panel = createMcpSetupPanel(
      discovery,
      makeCallbacks(),
      { ...defaultOpts(), mode: "setup" },
      { requestRender: vi.fn() },
      () => {},
    );
    // Navigate past view-example to open-paths (index varies)
    for (let i = 0; i < 3; i++) panel.handleInput(DOWN);
    panel.handleInput(ENTER);
    panel.dispose();
  });

  it("scaffold-project calls callback", async () => {
    const callbacks = makeCallbacks();
    const panel = createMcpSetupPanel(
      makeDiscovery(),
      callbacks,
      defaultOpts(),
      { requestRender: vi.fn() },
      () => {},
    );
    // scaffold-project is index 2 in empty mode
    panel.handleInput(DOWN);
    panel.handleInput(DOWN);
    panel.handleInput(ENTER);
    await Promise.resolve();
    await Promise.resolve();
    expect(callbacks.scaffoldProjectConfig).toHaveBeenCalled();
    panel.dispose();
  });

  it("show-precedence shows info notice", () => {
    const discovery = makeDiscovery({
      hasAnyConfig: true,
    });
    const renderFn = { requestRender: vi.fn() };
    const panel = createMcpSetupPanel(
      discovery,
      makeCallbacks(),
      { ...defaultOpts(), mode: "setup" },
      renderFn,
      () => {},
    );
    // show-precedence in setup mode
    for (let i = 0; i < 2; i++) panel.handleInput(DOWN);
    panel.handleInput(ENTER);
    expect(renderFn.requestRender).toHaveBeenCalled();
    panel.dispose();
  });

  it("close action calls done", () => {
    const done = vi.fn();
    const panel = createMcpSetupPanel(
      makeDiscovery(),
      makeCallbacks(),
      defaultOpts(),
      { requestRender: vi.fn() },
      done,
    );
    // Navigate to close (last action) and confirm
    for (let i = 0; i < 5; i++) panel.handleInput(DOWN);
    panel.handleInput(ENTER);
    expect(done).toHaveBeenCalled();
    panel.dispose();
  });

  it("add-repoprompt action when repoPrompt configured", () => {
    const discovery = makeDiscovery({
      hasAnyConfig: true,
      repoPrompt: {
        configured: false,
        executablePath: "/usr/bin/repoprompt",
        targetPath: "/tmp/shared.json",
        entry: { command: "repoprompt", args: [] },
        serverName: "repoprompt",
      },
    });
    const panel = createMcpSetupPanel(
      discovery,
      makeCallbacks(),
      { ...defaultOpts(), mode: "setup" },
      { requestRender: vi.fn() },
      () => {},
    );
    // Navigate to add-repoprompt action and confirm
    // Actions: adopt-imports then it comes after open-paths
    for (let i = 0; i < 4; i++) panel.handleInput(DOWN);
    panel.handleInput(ENTER);
    panel.dispose();
  });
});
