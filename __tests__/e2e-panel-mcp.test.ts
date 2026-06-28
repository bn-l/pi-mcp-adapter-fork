import { describe, expect, it, vi } from "vitest";
import { createMcpPanel } from "../mcp-panel.ts";
import type { McpPanelCallbacks } from "../types.ts";

function cb(): McpPanelCallbacks {
  return { reconnect: vi.fn(async () => true), canAuthenticate: vi.fn(() => true), authenticate: vi.fn(async () => ({ ok: true, message: "ok" })), getConnectionStatus: vi.fn(() => "needs-auth"), refreshCacheAfterReconnect: vi.fn(() => null) };
}

describe("McpPanel render", () => {
  it("authOnly 1 server", () => { const p = createMcpPanel({ mcpServers: { a: { url: "https://a.com", auth: "oauth" } } }, null, new Map(), cb(), { requestRender: vi.fn() }, () => {}, { authOnly: true }); expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
  it("authOnly 3 servers", () => { const p = createMcpPanel({ mcpServers: { a: { url: "https://a.com", auth: "oauth" }, b: { url: "https://b.com", auth: "oauth" }, c: { url: "https://c.com", auth: "oauth" } } }, null, new Map(), cb(), { requestRender: vi.fn() }, () => {}, { authOnly: true }); expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
  it("full mode connected", () => { const c = cb(); c.getConnectionStatus = () => "connected"; c.canAuthenticate = () => false; const p = createMcpPanel({ mcpServers: { a: { url: "https://a.com", auth: "oauth" } } }, null, new Map(), c, { requestRender: vi.fn() }, () => {}, { authOnly: false }); expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
  it("wide 200 authOnly", () => { const p = createMcpPanel({ mcpServers: { a: { url: "https://a.com", auth: "oauth" }, b: { url: "https://b.com", auth: "oauth" } } }, null, new Map(), cb(), { requestRender: vi.fn() }, () => {}, { authOnly: true }); expect((p as any).render(200).length).toBeGreaterThan(0); p.dispose(); });
  it("narrow 25 authOnly", () => { const p = createMcpPanel({ mcpServers: { a: { url: "https://a.com", auth: "oauth" }, b: { url: "https://b.com", auth: "oauth" } } }, null, new Map(), cb(), { requestRender: vi.fn() }, () => {}, { authOnly: true }); expect((p as any).render(25).length).toBeGreaterThan(0); p.dispose(); });
});
