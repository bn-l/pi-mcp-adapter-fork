/**
 * Coverage gap tests — targets small uncovered lines across multiple modules.
 */
import { describe, expect, it, vi } from "vitest";

// ===== tool-registrar.ts — lines 22-44 (resource, resource_link, audio, fallback) =====
import { transformMcpContent } from "../tool-registrar.ts";

describe("tool-registrar", () => {
  it("transforms resource content", () => {
    const result = transformMcpContent([{ type: "resource", resource: { uri: "res://x", text: "content" } }]);
    expect(result[0].type).toBe("text");
    expect(result[0].text).toContain("[Resource: res://x]");
  });

  it("transforms resource with no text", () => {
    const result = transformMcpContent([{ type: "resource", resource: { uri: "res://x" } }]);
    expect(result[0].text).toContain("[Resource: res://x]");
  });

  it("transforms resource_link", () => {
    const result = transformMcpContent([{ type: "resource_link", name: "doc", uri: "r://doc" }]);
    expect(result[0].text).toContain("[Resource Link: doc]");
    expect(result[0].text).toContain("URI: r://doc");
  });

  it("transforms resource_link with fallback name", () => {
    const result = transformMcpContent([{ type: "resource_link", uri: "r://x" }]);
    expect(result[0].text).toContain("[Resource Link: r://x]");
  });

  it("transforms resource_link with no uri", () => {
    const result = transformMcpContent([{ type: "resource_link" }]);
    expect(result[0].text).toContain("[Resource Link: unknown]");
  });

  it("transforms audio content", () => {
    const result = transformMcpContent([{ type: "audio", mimeType: "audio/mp3" }]);
    expect(result[0].text).toContain("[Audio content: audio/mp3]");
  });

  it("transforms audio with default mimeType", () => {
    const result = transformMcpContent([{ type: "audio" }]);
    expect(result[0].text).toContain("[Audio content: audio/*]");
  });

  it("fallback for unknown type", () => {
    const result = transformMcpContent([{ type: "unknown", x: 1 } as any]);
    expect(result[0].type).toBe("text");
    expect(result[0].text).toContain("\"x\"");
  });
});

// ===== agent-dir.ts — lines 10-11 (PI_CODING_AGENT_DIR configured paths) =====
describe("agent-dir", () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => { process.env = { ...OLD_ENV }; });

  it("uses configured abs path", async () => {
    process.env.PI_CODING_AGENT_DIR = "/custom/agent";
    const { getAgentDir } = await import("../agent-dir.ts");
    expect(getAgentDir()).toBe("/custom/agent");
  });

  it("handles tilde prefix", async () => {
    process.env.PI_CODING_AGENT_DIR = "~/custom";
    const { getAgentDir } = await import("../agent-dir.ts");
    expect(getAgentDir()).toContain("/custom");
  });
});

// ===== utils.ts — getConfigPathFromArgv (line 57-58) =====
describe("getConfigPathFromArgv", () => {
  const oldArgv = process.argv;

  afterEach(() => { process.argv = oldArgv; });

  it("returns value from --mcp-config", async () => {
    process.argv = ["node", "script", "--mcp-config", "/path/to/config"];
    const { getConfigPathFromArgv } = await import("../utils.ts");
    expect(getConfigPathFromArgv()).toBe("/path/to/config");
  });

  it("returns undefined when no --mcp-config", async () => {
    process.argv = ["node", "script"];
    const { getConfigPathFromArgv } = await import("../utils.ts");
    expect(getConfigPathFromArgv()).toBeUndefined();
  });

  it("returns undefined when --mcp-config has no value", async () => {
    process.argv = ["node", "script", "--mcp-config"];
    const { getConfigPathFromArgv } = await import("../utils.ts");
    expect(getConfigPathFromArgv()).toBeUndefined();
  });
});

// ===== types.ts — parseUiPromptHandoff lines 200-213 =====
describe("parseUiPromptHandoff", () => {
  it("returns undefined for non-object JSON", async () => {
    const { parseUiPromptHandoff } = await import("../types.ts");
    expect(parseUiPromptHandoff("intent\n\"just a string\"")).toBeUndefined();
    expect(parseUiPromptHandoff("intent\n[1,2,3]")).toBeUndefined();
  });

  it("returns undefined for unparseable JSON", async () => {
    const { parseUiPromptHandoff } = await import("../types.ts");
    expect(parseUiPromptHandoff("intent\nnot json {{")).toBeUndefined();
  });
});

// ===== utils.ts — execOpen/platform-specific (lines 6-32) via openUrl/openPath + parallelLimit =====
describe("utils win32 exec", () => {
  it("openUrl handles non-zero exit", async () => {
    const pi = { exec: vi.fn().mockResolvedValue({ code: 1, stderr: "boom" }) } as any;
    const { openUrl } = await import("../utils.ts");
    await expect(openUrl(pi, "https://example.com")).rejects.toThrow("boom");
  });

  it("openUrl handles non-zero exit no stderr", async () => {
    const pi = { exec: vi.fn().mockResolvedValue({ code: 127, stderr: "" }) } as any;
    const { openUrl } = await import("../utils.ts");
    await expect(openUrl(pi, "https://example.com")).rejects.toThrow("exit code 127");
  });

  it("openPath handles non-zero exit", async () => {
    const pi = { exec: vi.fn().mockResolvedValue({ code: 1, stderr: "fail" }) } as any;
    const { openPath } = await import("../utils.ts");
    await expect(openPath(pi, "/tmp")).rejects.toThrow("fail");
  });

  it("openPath handles non-zero exit no stderr", async () => {
    const pi = { exec: vi.fn().mockResolvedValue({ code: 99, stderr: "" }) } as any;
    const { openPath } = await import("../utils.ts");
    await expect(openPath(pi, "/tmp")).rejects.toThrow("exit code 99");
  });

  it("parallelLimit with empty items", async () => {
    const { parallelLimit } = await import("../utils.ts");
    const results = await parallelLimit([], 2, async (x) => x);
    expect(results).toEqual([]);
  });
});
