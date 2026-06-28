import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { executeCall, executeSearch, executeDescribe, executeList, executeStatus, executeConnect, executeAuthStart, executeAuthComplete, executeUiMessages } from "../proxy-modes.ts";
import { buildToolMetadata, findToolByName, formatSchema, getToolNames } from "../tool-metadata.ts";
import { transformMcpContent } from "../tool-registrar.ts";
import { parseUiPromptHandoff } from "../types.ts";
import { resolveBearerToken, truncateAtWord, openPath } from "../utils.ts";
import type { McpConfig, ServerDefinition } from "../types.ts";
import type { McpExtensionState } from "../state.ts";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("./fixtures/e2e-server.mjs", import.meta.url));

describe("big e2e pipeline", () => {
  let state: McpExtensionState;
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
    client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    const toolsResult = await client.listTools();
    const { metadata } = buildToolMetadata(toolsResult.tools as any, [], { command: process.execPath, args: [SERVER] }, "e2e", "server");
    state = {
      manager: {
        connect: async () => ({ status: "connected" as const, tools: toolsResult.tools as any, resources: [] }),
        close: async () => {}, getConnection: () => ({ status: "connected" as const, client, tools: [] as any, resources: [] as any }),
        getAllConnections: () => new Map([["e2e", { status: "connected", tools: [] as any, resources: [] as any }]]),
        touch: () => {}, incrementInFlight: () => {}, decrementInFlight: () => {},
        handleUrlElicitationRequired: async () => "accept" as const,
        closeAll: async () => { await client.close(); await transport.close(); },
      } as any,
      config: { mcpServers: { e2e: { command: process.execPath, args: [SERVER] } as ServerDefinition }, settings: { toolPrefix: "server" } } as McpConfig,
      toolMetadata: new Map([["e2e", metadata]]), failureTracker: new Map(), completedUiSessions: [],
      lifecycle: {} as any, uiResourceHandler: {} as any, consentManager: {} as any,
      uiServer: null, openBrowser: async () => {}, ui: undefined, sendMessage: async () => {},
    } as McpExtensionState;
  }, 15000);

  afterAll(async () => {
    try { await client.close(); } catch {}
    try { await transport.close(); } catch {}
  });

  it("s: echo", () => { const r = executeSearch(state, "echo"); expect(r.details.count).toBeGreaterThanOrEqual(1); });
  it("s: regex", () => { const r = executeSearch(state, "echo|add", true); expect(r.details.count).toBeGreaterThanOrEqual(2); });
  it("s: server filter", () => { const r = executeSearch(state, "echo", false, "e2e"); expect(r.details.count).toBe(1); });
  it("s: no schemas", () => { const r = executeSearch(state, "echo", false, undefined, false); expect(r.content[0].text).not.toContain("Parameters:"); });
  it("s: no match", () => { const r = executeSearch(state, "zzz_nonexistent"); expect(r.details.count).toBe(0); });
  it("s: empty query", () => { expect(executeSearch(state, "   ").details.error).toBe("empty_query"); });
  it("s: invalid regex", () => { expect(executeSearch(state, "[invalid", true).details.error).toBe("invalid_pattern"); });
  it("d: echo", () => { expect(executeDescribe(state, "e2e_echo").content[0].text).toContain("Server: e2e"); });
  it("d: unknown", () => { expect(executeDescribe(state, "unknown").details.error).toBe("tool_not_found"); });
  it("l: list", () => { const r = executeList(state, "e2e"); expect(r.details.count).toBeGreaterThanOrEqual(5); });
  it("l: unknown", () => { expect(executeList(state, "nx").details.error).toBe("not_found"); });
  it("st: status", () => { expect(executeStatus(state).details.connectedCount).toBe(1); });
  it("c: call echo", async () => { const r = await executeCall(state, "e2e_echo", { message: "hello" }); expect((r.content.find((c: any) => c.type === "text")?.text ?? "")).toContain("hello"); });
  it("c: call add", async () => { const r = await executeCall(state, "e2e_add", { a: 3, b: 4 }); expect(r.content.find((c: any) => c.type === "text")?.text).toBe("7"); });
  it("c: call error", async () => { expect((await executeCall(state, "e2e_always_errors")).content.length).toBeGreaterThanOrEqual(1); });
  it("c: server_not_found", async () => { expect((await executeCall(state, "e2e_echo", { message: "x" }, "nonexistent")).details.error).toBe("server_not_found"); });
  it("c: server override", async () => { expect((await executeCall(state, "e2e_echo", { message: "hi" }, "e2e")).content.find((c: any) => c.type === "text")?.text).toContain("hi"); });
  it("c: unknown tool in server", async () => { expect((await executeCall(state, "e2e_nonexistent", undefined, "e2e")).content[0].text).toContain("not found"); });
  it("conn: not_found", async () => { expect((await executeConnect(state, "nx")).details.error).toBe("not_found"); });
  it("as: not_found", async () => { expect((await executeAuthStart(state, "nx")).details.error).toBe("not_found"); });
  it("ac: not_found", async () => { expect((await executeAuthComplete(state, "nx", "c")).details.error).toBe("not_found"); });
  it("uimsg: empty", () => { state.completedUiSessions = []; expect(executeUiMessages(state).content[0].text).toContain("No UI session messages"); });
  // Tool metadata and types tested via existing dedicated test files

  it("tr: transformMcpContent", () => { const r = transformMcpContent([{type:"text",text:"a"},{type:"image",data:"b",mimeType:"image/png"},{type:"resource",resource:{uri:"r://1",text:"c"}},{type:"resource_link",name:"d",uri:"d://1"},{type:"audio",mimeType:"audio/mp3"}] as any); expect(r).toHaveLength(5); });
  it("ty: parseUiPromptHandoff", () => { expect(parseUiPromptHandoff("h\n{\"k\":\"v\"}")!.intent).toBe("h"); });
  it("ty: parseUiPromptHandoff invalid", () => { expect(parseUiPromptHandoff("")).toBeUndefined(); });
  it("ut: resolveBearerToken", () => { expect(resolveBearerToken({ bearerToken: "x" })).toBe("x"); process.env.BT2 = "y"; expect(resolveBearerToken({ bearerTokenEnv: "BT2" })).toBe("y"); delete process.env.BT2; expect(resolveBearerToken({})).toBeUndefined(); });
  it("ut: truncateAtWord", () => { expect(typeof truncateAtWord("ab", 5)).toBe("string"); });
  it("ut: openPath err", async () => { await expect(openPath({ exec: async () => ({ code: 1, stderr: "fail" }) } as any, "/x")).rejects.toThrow("fail"); });
});
