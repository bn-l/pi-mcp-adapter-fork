/**
 * Final coverage push — panels, proxy-modes, init, direct-tools
 */
import { describe, expect, it, vi } from "vitest";
import { createMcpPanel } from "../mcp-panel.ts";
import { createMcpSetupPanel } from "../mcp-setup-panel.ts";
import type { McpConfig, McpPanelCallbacks } from "../types.ts";

// ===== McpPanel render =====
function pcbs(): McpPanelCallbacks {
  return { reconnect: vi.fn(async () => true), canAuthenticate: vi.fn(() => true),
    authenticate: vi.fn(async () => ({ ok: true, message: "ok" })),
    getConnectionStatus: vi.fn(() => "needs-auth"), refreshCacheAfterReconnect: vi.fn(() => null) };
}

describe("McpPanel render", () => {
  it("authOnly 3 servers", () => { const p = createMcpPanel({mcpServers:{a:{url:"https://a.com",auth:"oauth"},b:{url:"https://b.com",auth:"oauth"},c:{url:"https://c.com",auth:"oauth"}}},null,new Map(),pcbs(),{requestRender:vi.fn()},()=>{},{authOnly:true}); expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
  it("full mode 3 servers", () => { const p = createMcpPanel({mcpServers:{a:{url:"https://a.com",auth:"oauth"},b:{url:"https://b.com",auth:"oauth"},c:{url:"https://c.com",auth:"oauth"}}},null,new Map(),pcbs(),{requestRender:vi.fn()},()=>{},{authOnly:false}); expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
  it("wide 120", () => { const p = createMcpPanel({mcpServers:{a:{url:"https://a.com",auth:"oauth"}}},null,new Map(),pcbs(),{requestRender:vi.fn()},()=>{},{authOnly:true}); expect((p as any).render(120).length).toBeGreaterThan(0); p.dispose(); });
  it("narrow 25", () => { const p = createMcpPanel({mcpServers:{a:{url:"https://a.com",auth:"oauth"},b:{url:"https://b.com",auth:"oauth"}}},null,new Map(),pcbs(),{requestRender:vi.fn()},()=>{},{authOnly:true}); expect((p as any).render(25).length).toBeGreaterThan(0); p.dispose(); });
  it("with noticeLines", () => { const p = createMcpPanel({mcpServers:{a:{url:"https://a.com",auth:"oauth"}}},null,new Map(),pcbs(),{requestRender:vi.fn()},()=>{},{authOnly:true,noticeLines:["Line 1","Line 2"]}); expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
  it("expand server enter", () => { const cbs=pcbs(); cbs.getConnectionStatus=()=>"connected"; cbs.canAuthenticate=()=>false; const p=createMcpPanel({mcpServers:{a:{url:"https://a.com",auth:"oauth"}}},null,new Map(),cbs,{requestRender:vi.fn()},()=>{},{authOnly:false}); p.handleInput("\r"); expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
});

// ===== McpSetupPanel render =====
function scd() { return {sources:[],imports:[],hasAnyConfig:false,hasAnyDetectedPaths:false,hasSharedServers:false,hasPiOwnedServers:false,totalServerCount:0,fingerprint:"x",repoPrompt:{configured:false}}; }
function scs() { return {onImportAdopted:vi.fn(),onSetupCompleted:vi.fn(),scaffoldProjectConfig:vi.fn(),adoptSharedServer:vi.fn(),reloadPi:vi.fn(),openPath:vi.fn()}; }
function sco(m:"empty"|"setup"="empty") { return {mode:m,onboardingState:{version:1,sharedConfigHintShown:false,setupCompleted:false},keybindings:undefined}; }

describe("McpSetupPanel render", () => {
  it("empty mode", () => { const p=createMcpSetupPanel(scd(),scs(),sco("empty"),{requestRender:vi.fn()},()=>{}); expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
  it("setup mode", () => { const d={...scd(),hasAnyConfig:true}; const p=createMcpSetupPanel(d,scs(),sco("setup"),{requestRender:vi.fn()},()=>{}); expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
  it("setup with pi-owned", () => { const d={...scd(),hasAnyConfig:true,hasPiOwnedServers:true,totalServerCount:1,sources:[{id:"p",path:"/p/.mcp.json",kind:"pi-owned" as const,exists:true,serverCount:1}]}; const p=createMcpSetupPanel(d,scs(),sco("setup"),{requestRender:vi.fn()},()=>{}); expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
  it("wide 140", () => { const p=createMcpSetupPanel(scd(),scs(),sco("empty"),{requestRender:vi.fn()},()=>{}); expect((p as any).render(140).length).toBeGreaterThan(0); p.dispose(); });
  it("narrow 22", () => { const p=createMcpSetupPanel(scd(),scs(),sco("empty"),{requestRender:vi.fn()},()=>{}); expect((p as any).render(22).length).toBeGreaterThan(0); p.dispose(); });
  it("busy notice", () => { const p=createMcpSetupPanel(scd(),scs(),sco("empty"),{requestRender:vi.fn()},()=>{}); (p as any).busy=true; (p as any).notice={text:"Loading...",tone:"muted"}; expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
  it("warning notice", () => { const p=createMcpSetupPanel(scd(),scs(),sco("empty"),{requestRender:vi.fn()},()=>{}); (p as any).notice={text:"Error!",tone:"warning"}; expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
  it("success notice", () => { const p=createMcpSetupPanel(scd(),scs(),sco("empty"),{requestRender:vi.fn()},()=>{}); (p as any).notice={text:"Done.",tone:"success"}; expect((p as any).render(80).length).toBeGreaterThan(0); p.dispose(); });
});

// ===== proxy-modes executeCall =====
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn().mockResolvedValue("authenticated"), completeAuthFromInput: vi.fn(),
  startAuth: vi.fn(), supportsOAuth: vi.fn().mockReturnValue(true),
  lazyConnect: vi.fn().mockResolvedValue(true), updateServerMetadata: vi.fn(),
  updateMetadataCache: vi.fn(), getFailureAgeSeconds: vi.fn().mockReturnValue(null),
  updateStatusBar: vi.fn(),
}));
vi.mock("../mcp-auth-flow.ts", () => ({ authenticate: mocks.authenticate, completeAuthFromInput: mocks.completeAuthFromInput, startAuth: mocks.startAuth, supportsOAuth: mocks.supportsOAuth, removeAuth: vi.fn() }));
vi.mock("../init.ts", () => ({ lazyConnect: mocks.lazyConnect, updateServerMetadata: mocks.updateServerMetadata, updateMetadataCache: mocks.updateMetadataCache, getFailureAgeSeconds: mocks.getFailureAgeSeconds, updateStatusBar: mocks.updateStatusBar }));

import { executeCall, executeConnect, executeStatus } from "../proxy-modes.ts";

describe("proxy-modes push", () => {
  it("executeCall with connected server async call", async () => {
    const s = {
      config: { mcpServers: { srv: { command: "echo" } }, settings: { toolPrefix: "server" } },
      toolMetadata: new Map([["srv", [{ name: "srv_echo", originalName: "echo", description: "Echo" }]]]),
      manager: { getConnection: () => ({ status: "connected", client: { callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }], isError: false }) } }), touch: vi.fn(), incrementInFlight: vi.fn(), decrementInFlight: vi.fn(), connect: vi.fn(), close: vi.fn() },
      failureTracker: new Map(), completedUiSessions: [],
    } as any;
    const result = await executeCall(s, "srv_echo", { x: 1 });
    expect(result.content.some((c: any) => c.text === "ok")).toBe(true);
  });

  it("executeConnect success path", async () => {
    const s = {
      config: { mcpServers: { srv: { command: "echo" } }, settings: { toolPrefix: "server" } },
      manager: { connect: vi.fn().mockResolvedValue({ status: "connected", tools: [], resources: [] }), getConnection: vi.fn(), close: vi.fn() },
      toolMetadata: new Map(), failureTracker: new Map(), completedUiSessions: [],
    } as any;
    const result = await executeConnect(s, "srv");
    expect(result.details.mode).toBe("list");
  });

  it("executeStatus with failed server", () => {
    mocks.getFailureAgeSeconds.mockReturnValue(15);
    const s = {
      config: { mcpServers: { srv: { command: "echo" } }, settings: {} },
      manager: { getConnection: () => null },
      toolMetadata: new Map(), failureTracker: new Map([["srv", Date.now() - 15000]]),
    } as any;
    const result = executeStatus(s);
    expect(result.content[0].text).toContain("failed");
  });
});

// ===== direct-tools =====
import { createDirectToolExecutor } from "../direct-tools.ts";

describe("direct-tools push", () => {
  it("executor with resource URI tool", async () => {
    const s = {
      config: { mcpServers: { srv: { command: "echo" } }, settings: {} },
      manager: { getConnection: () => ({ status: "connected", client: { readResource: vi.fn().mockResolvedValue({ contents: [{ text: "content", uri: "file:///x" }] }) } }), touch: vi.fn(), incrementInFlight: vi.fn(), decrementInFlight: vi.fn(), close: vi.fn(), connect: vi.fn(), handleUrlElicitationRequired: vi.fn() },
      toolMetadata: new Map(), failureTracker: new Map(),
    } as any;
    const exec = createDirectToolExecutor(() => s, () => null, { serverName: "srv", originalName: "get_data", prefixedName: "srv_get_data", description: "", resourceUri: "file:///x" });
    const result = await exec("id", {}, undefined, undefined, {} as any);
    expect(result.details.resourceUri).toBe("file:///x");
  });

  it("executor not initialized", async () => {
    const exec = createDirectToolExecutor(() => null, () => null, { serverName: "srv", originalName: "echo", prefixedName: "srv_echo", description: "" });
    const result = await exec("id", {}, undefined, undefined, {} as any);
    expect(result.details.error).toBe("not_initialized");
  });
});

// ===== types =====
import { parseUiPromptHandoff } from "../types.ts";

describe("types push", () => {
  it("parseUiPromptHandoff valid", () => {
    expect(parseUiPromptHandoff("ask\n{\"q\":\"hi\"}")).toBeDefined();
  });
});

// ===== utils =====
import { formatAuthRequiredMessage } from "../utils.ts";

describe("utils push", () => {
  it("formatAuthRequiredMessage with template", () => {
    const msg = formatAuthRequiredMessage({ settings: { authRequiredMessage: "Go to https://auth.example.com for ${server}" } }, "test", "");
    expect(msg).toContain("test");
  });
});
