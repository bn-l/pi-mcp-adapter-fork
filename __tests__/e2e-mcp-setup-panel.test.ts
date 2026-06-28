/**
 * McpSetupPanel comprehensive tests — uses real KeybindingsManager from pi-tui
 */
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { createMcpSetupPanel, type SetupPanelCallbacks } from "../mcp-setup-panel.ts";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";

function createEmacsKeybindings() {
  return new KeybindingsManager(TUI_KEYBINDINGS, {
    "tui.select.up": ["up", "ctrl+p"],
    "tui.select.down": ["down", "ctrl+n"],
  });
}

function createSetupCallbacks(): SetupPanelCallbacks {
  return {
    onImportAdopted: vi.fn(async () => {}),
    onSetupCompleted: vi.fn(),
    scaffoldProjectConfig: vi.fn(async () => {}),
    adoptSharedServer: vi.fn(async () => {}),
    reloadPi: vi.fn(async () => {}),
    openPath: vi.fn(async () => {}),
  };
}

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

function discoveryWithConfig() {
  return {
    ...emptyDiscovery,
    hasAnyConfig: true,
    sources: [{ id: "shared-project", path: "/tmp/mcp.json", kind: "shared", exists: true, serverCount: 1 }],
    imports: [{ kind: "claude" as const, path: "/tmp/claude.json", workspacePath: "/ws" }],
  };
}

describe("McpSetupPanel (setup mode)", () => {
  it("navigates and confirms scaffold-project action", async () => {
    const callbacks = createSetupCallbacks();
    const renderFn = { requestRender: vi.fn() };
    const done = vi.fn();
    const panel = createMcpSetupPanel(
      emptyDiscovery,
      callbacks,
      { mode: "empty", onboardingState: { version: 1, sharedConfigHintShown: false, setupCompleted: false }, keybindings: undefined },
      renderFn,
      done,
    );

    // Actions for empty: run-setup, view-example, scaffold-project, show-precedence, close
    // scaffold-project is index 2
    panel.handleInput(DOWN);
    panel.handleInput(DOWN);
    panel.handleInput(ENTER);
    await Promise.resolve();
    await Promise.resolve();
    expect(callbacks.scaffoldProjectConfig).toHaveBeenCalledTimes(1);
    panel.dispose();
  });

  it("escape closes panel from setup screen", () => {
    const renderFn = { requestRender: vi.fn() };
    const done = vi.fn();
    const panel = createMcpSetupPanel(
      emptyDiscovery,
      createSetupCallbacks(),
      { mode: "empty", onboardingState: { version: 1, sharedConfigHintShown: false, setupCompleted: false }, keybindings: undefined },
      renderFn,
      done,
    );

    panel.handleInput(ESC);
    expect(done).toHaveBeenCalled();
    panel.dispose();
  });

  it("navigates up and down actions", () => {
    const renderFn = { requestRender: vi.fn() };
    const panel = createMcpSetupPanel(
      emptyDiscovery,
      createSetupCallbacks(),
      { mode: "empty", onboardingState: { version: 1, sharedConfigHintShown: false, setupCompleted: false }, keybindings: undefined },
      renderFn,
      () => {},
    );

    panel.handleInput(DOWN);
    panel.handleInput(DOWN);
    panel.handleInput(UP);
    // Navigation triggers requestRender
    expect(renderFn.requestRender).toHaveBeenCalledTimes(3);
    panel.dispose();
  });
});

describe("McpSetupPanel (imports screen)", () => {
  it("escape from imports goes back to setup", () => {
    const discovery = discoveryWithConfig();
    const renderFn = { requestRender: vi.fn() };
    const done = vi.fn();
    const panel = createMcpSetupPanel(
      discovery,
      createSetupCallbacks(),
      { mode: "setup", onboardingState: { version: 1, sharedConfigHintShown: false, setupCompleted: false }, keybindings: undefined },
      renderFn,
      done,
    );

    // "adopt-imports" is the first action (index 0)
    // Press ENTER → sets screen to "imports" synchronously
    panel.handleInput(ENTER);
    renderFn.requestRender.mockClear();
    panel.handleInput(ESC);
    // Back to setup screen, not done
    expect(done).not.toHaveBeenCalled();
    expect(renderFn.requestRender).toHaveBeenCalled();
    panel.dispose();
  });

  it("space toggles import selection in imports screen", () => {
    const discovery = discoveryWithConfig();
    discovery.imports = [{ kind: "codex", path: "/tmp/c.json", workspacePath: "/ws" }];
    const renderFn = { requestRender: vi.fn() };
    const panel = createMcpSetupPanel(
      discovery,
      createSetupCallbacks(),
      { mode: "setup", onboardingState: { version: 1, sharedConfigHintShown: false, setupCompleted: false }, keybindings: undefined },
      renderFn,
      () => {},
    );

    // Enter imports screen
    panel.handleInput(ENTER);
    renderFn.requestRender.mockClear();
    // Space toggles first import at cursor 0
    panel.handleInput(" ");
    expect(renderFn.requestRender).toHaveBeenCalled();
    panel.dispose();
  });
});

describe("McpSetupPanel (paths screen)", () => {
  it("escape from paths goes back to setup", () => {
    const discovery = {
      ...emptyDiscovery,
      hasAnyConfig: true,
      sources: [
        { id: "a", path: "/tmp/a.json", kind: "shared" as const, exists: true, serverCount: 1 },
      ],
      imports: [],
    };
    const renderFn = { requestRender: vi.fn() };
    const done = vi.fn();
    const panel = createMcpSetupPanel(
      discovery,
      createSetupCallbacks(),
      { mode: "setup", onboardingState: { version: 1, sharedConfigHintShown: false, setupCompleted: false }, keybindings: undefined },
      renderFn,
      done,
    );

    // Navigate to "open-paths" action and enter
    // Actions: view-example, scaffold-project, show-precedence, open-paths, close
    for (let i = 0; i < 3; i++) panel.handleInput(DOWN);
    panel.handleInput(ENTER);
    renderFn.requestRender.mockClear();
    // In paths screen. Escape goes back.
    panel.handleInput(ESC);
    expect(done).not.toHaveBeenCalled();
    expect(renderFn.requestRender).toHaveBeenCalled();
    panel.dispose();
  });
});

describe("McpSetupPanel (with emacs bindings)", () => {
  it("navigates with emacs bindings", () => {
    const renderFn = { requestRender: vi.fn() };
    const panel = createMcpSetupPanel(
      emptyDiscovery,
      createSetupCallbacks(),
      { mode: "empty", onboardingState: { version: 1, sharedConfigHintShown: false, setupCompleted: false }, keybindings: createEmacsKeybindings() },
      renderFn,
      () => {},
    );

    panel.handleInput("\x0e"); // ctrl+n = down
    panel.handleInput("\x10"); // ctrl+p = up
    expect(renderFn.requestRender).toHaveBeenCalledTimes(2);
    panel.dispose();
  });

  it("confirm via enter triggers action", async () => {
    const callbacks = createSetupCallbacks();
    const renderFn = { requestRender: vi.fn() };
    const panel = createMcpSetupPanel(
      emptyDiscovery,
      callbacks,
      { mode: "empty", onboardingState: { version: 1, sharedConfigHintShown: false, setupCompleted: false }, keybindings: createEmacsKeybindings() },
      renderFn,
      () => {},
    );

    // scaffold-project is index 2
    panel.handleInput("\x0e"); // down
    panel.handleInput("\x0e"); // down
    panel.handleInput(ENTER);
    await Promise.resolve();
    await Promise.resolve();
    expect(callbacks.scaffoldProjectConfig).toHaveBeenCalledTimes(1);
    panel.dispose();
  });
});
