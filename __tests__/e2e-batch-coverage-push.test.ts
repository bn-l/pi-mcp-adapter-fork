/**
 * Batch coverage push — safe extensions on existing passing test patterns.
 */
import { describe, expect, it, vi } from "vitest";

// ===== proxy-modes discovery =====
import { executeSearch } from "../proxy-modes.ts";

describe("executeSearch extended", () => {
  function state() {
    return {
      toolMetadata: new Map([["srv", [
        { name: "srv_echo", originalName: "echo", description: "Echo tool" },
        { name: "srv_add", originalName: "add", description: "Add numbers" },
      ]]]),
    } as any;
  }

  it("regex safe pattern matches multiple", () => {
    const result = executeSearch(state(), "echo|add", true);
    expect(result.details.count).toBe(2);
  });

  it("server filter excludes other", () => {
    const s = {
      toolMetadata: new Map([
        ["srv_a", [{ name: "srv_a_echo", originalName: "echo", description: "Echo" }]],
        ["srv_b", [{ name: "srv_b_add", originalName: "add", description: "Add" }]],
      ]),
    } as any;
    const result = executeSearch(s, "echo", false, "srv_a");
    expect(result.details.count).toBe(1);
  });
});

// ===== types =====
import { parseUiPromptHandoff } from "../types.ts";

describe("parseUiPromptHandoff extended", () => {
  it("null payload", () => {
    expect(parseUiPromptHandoff("intent\nnull")).toBeUndefined();
  });
  it("boolean payload", () => {
    expect(parseUiPromptHandoff("intent\ntrue")).toBeUndefined();
  });
  it("invalid intent name", () => {
    expect(parseUiPromptHandoff("bad-name\n{}")).toBeDefined();
  });
});

// ===== utils =====
import { formatAuthRequiredMessage } from "../utils.ts";

describe("formatAuthRequiredMessage extended", () => {
  it("template substitution", () => {
    const msg = formatAuthRequiredMessage(
      { settings: { authRequiredMessage: "Auth ${server} at URL" } },
      "my-srv",
      "default",
    );
    expect(msg).toContain("Auth my-srv at URL");
  });

  it("fallback to default", () => {
    expect(formatAuthRequiredMessage({ settings: {} }, "srv", "default msg")).toBe("default msg");
  });
});

// ===== tool-metadata =====
import { buildToolMetadata, getToolNames, formatSchema } from "../tool-metadata.ts";

describe("tool-metadata extended", () => {

  it("formatSchema null/undefined/string", () => {
    expect(formatSchema(null)).toContain("no schema");
    expect(formatSchema(undefined)).toContain("no schema");
    expect(formatSchema("string")).toContain("no schema");
  });

  it("formatSchema array type", () => {
    const result = formatSchema({ type: "array", items: { type: "string" } });
    expect(result).toBeDefined();
  });
});

// ===== proxy-modes auth ======
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  completeAuthFromInput: vi.fn(),
  startAuth: vi.fn(),
  supportsOAuth: vi.fn(),
  lazyConnect: vi.fn(),
  updateServerMetadata: vi.fn(),
  updateMetadataCache: vi.fn(),
  getFailureAgeSeconds: vi.fn(),
  updateStatusBar: vi.fn(),
}));

vi.mock("../mcp-auth-flow.ts", () => ({
  authenticate: mocks.authenticate,
  completeAuthFromInput: mocks.completeAuthFromInput,
  startAuth: mocks.startAuth,
  supportsOAuth: mocks.supportsOAuth,
}));
vi.mock("../init.ts", () => ({
  lazyConnect: mocks.lazyConnect,
  updateServerMetadata: mocks.updateServerMetadata,
  updateMetadataCache: mocks.updateMetadataCache,
  getFailureAgeSeconds: mocks.getFailureAgeSeconds,
  updateStatusBar: mocks.updateStatusBar,
}));

describe("manual auth extended", () => {
  it("executeAuthStart not_found", async () => {
    const { executeAuthStart } = await import("../proxy-modes.ts");
    const result = await executeAuthStart({ config: { mcpServers: {}, settings: {} } } as any, "x");
    expect(result.details.error).toBe("not_found");
  });

  it("executeAuthStart oauth_not_supported", async () => {
    mocks.supportsOAuth.mockReturnValue(false);
    const { executeAuthStart } = await import("../proxy-modes.ts");
    const result = await executeAuthStart({ config: { mcpServers: { srv: { command: "echo" } }, settings: {} } } as any, "srv");
    expect(result.details.error).toBe("oauth_not_supported");
  });

  it("executeAuthComplete not_found", async () => {
    const { executeAuthComplete } = await import("../proxy-modes.ts");
    const result = await executeAuthComplete({ config: { mcpServers: {} } } as any, "x", "code");
    expect(result.details.error).toBe("not_found");
  });

  it("executeAuthComplete error path", async () => {
    mocks.completeAuthFromInput.mockRejectedValue(new Error("network error"));
    const { executeAuthComplete } = await import("../proxy-modes.ts");
    const s = { config: { mcpServers: { srv: { command: "echo" } }, settings: {} } } as any;
    const result = await executeAuthComplete(s, "srv", "code");
    expect(result.details.error).toBe("auth_complete_failed");
  });
});
