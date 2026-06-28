import { describe, expect, it, vi } from "vitest";
import { createMcpSetupPanel } from "../mcp-setup-panel.ts";

function cd() { return { sources: [], imports: [], hasAnyConfig: false, hasAnyDetectedPaths: false, hasSharedServers: false, hasPiOwnedServers: false, totalServerCount: 0, fingerprint: "x", repoPrompt: { configured: false } }; }
function cs() { return { onImportAdopted: vi.fn(), onSetupCompleted: vi.fn(), scaffoldProjectConfig: vi.fn(), adoptSharedServer: vi.fn(), reloadPi: vi.fn(), openPath: vi.fn() }; }
function so(m: "empty"|"setup"="empty") { return { mode: m, onboardingState: { version: 1, sharedConfigHintShown: false, setupCompleted: false }, keybindings: undefined }; }

describe("McpSetupPanel render", () => {
  it("empty mode", () => { const p = createMcpSetupPanel(cd(), cs(), so("empty"), { requestRender: vi.fn() }, () => {}); expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
  it("setup mode", () => { const d = { ...cd(), hasAnyConfig: true }; const p = createMcpSetupPanel(d, cs(), so("setup"), { requestRender: vi.fn() }, () => {}); expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
  it("narrow 25", () => { const p = createMcpSetupPanel(cd(), cs(), so("empty"), { requestRender: vi.fn() }, () => {}); expect((p as any).render(25).length).toBeGreaterThan(0); p.dispose(); });
  it("wide 160", () => { const d = { ...cd(), hasAnyConfig: true }; const p = createMcpSetupPanel(d, cs(), so("setup"), { requestRender: vi.fn() }, () => {}); expect((p as any).render(160).length).toBeGreaterThan(0); p.dispose(); });
  it("setup with pi-owned", () => { const d = { ...cd(), hasAnyConfig: true, hasPiOwnedServers: true, totalServerCount: 1, sources: [{ id: "p", path: "/p/.mcp.json", kind: "pi-owned" as const, exists: true, serverCount: 1 }] }; const p = createMcpSetupPanel(d, cs(), so("setup"), { requestRender: vi.fn() }, () => {}); expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
});
