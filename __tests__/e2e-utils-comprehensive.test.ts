/**
 * Comprehensive e2e tests for ALL utils.ts functions — no mocking.
 * 
 * Covers: interpolateEnvVars, interpolateEnvRecord, truncateAtWord,
 * resolveConfigPath, resolveBearerToken, formatAuthRequiredMessage,
 * getConfigPathFromArgv, extractToolUiStreamMode, parallelLimit.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  interpolateEnvVars,
  interpolateEnvRecord,
  truncateAtWord,
  resolveConfigPath,
  resolveBearerToken,
  formatAuthRequiredMessage,
  getConfigPathFromArgv,
  extractToolUiStreamMode,
  parallelLimit,
} from "../utils.ts";

describe("interpolateEnvVars (comprehensive)", () => {
  afterEach(() => {
    delete process.env.MCP_A;
    delete process.env.MCP_B;
  });

  it("basic ${VAR}", () => {
    process.env.MCP_A = "value";
    expect(interpolateEnvVars("${MCP_A}")).toBe("value");
  });

  it("missing var → empty", () => {
    expect(interpolateEnvVars("${MISSING_XYZ}")).toBe("");
  });

  it("${VAR:-default} when missing", () => {
    expect(interpolateEnvVars("${MISSING:-fallback}")).toBe("fallback");
  });

  it("${VAR:-default} when present", () => {
    process.env.MCP_A = "real";
    expect(interpolateEnvVars("${MCP_A:-fallback}")).toBe("real");
  });

  it("${VAR:-default} when empty string → fallback", () => {
    process.env.MCP_A = "";
    expect(interpolateEnvVars("${MCP_A:-fallback}")).toBe("fallback");
  });

  it("${VAR:+alt} when missing → empty", () => {
    expect(interpolateEnvVars("${MISSING:+present}")).toBe("");
  });

  it("${VAR:+alt} when present → alt value", () => {
    process.env.MCP_A = "exists";
    expect(interpolateEnvVars("${MCP_A:+present}")).toBe("present");
  });

  it("$env:VAR syntax", () => {
    process.env.MCP_A = "env_val";
    expect(interpolateEnvVars("$env:MCP_A")).toBe("env_val");
  });

  it("multiple substitutions in one string", () => {
    process.env.MCP_A = "a";
    process.env.MCP_B = "b";
    expect(interpolateEnvVars("${MCP_A}_${MCP_B}_${MISSING:-x}")).toBe("a_b_x");
  });

  it("mixing ${VAR} and ${VAR:-default}", () => {
    process.env.MCP_A = "a";
    expect(interpolateEnvVars("${MCP_A}_${MISSING:-x}")).toBe("a_x");
  });

  it("special characters in default values", () => {
    expect(interpolateEnvVars("${MISSING:-https://example.com/path?q=1}")).toBe("https://example.com/path?q=1");
  });
});

describe("interpolateEnvRecord (comprehensive)", () => {
  afterEach(() => {
    delete process.env.MCP_KEY;
  });

  it("resolves all entries", () => {
    process.env.MCP_KEY = "sk";
    const result = interpolateEnvRecord({
      Auth: "Bearer ${MCP_KEY}",
      Default: "${MISSING:-def}",
      Alt: "${MCP_KEY:+enabled}",
    });
    expect(result).toEqual({
      Auth: "Bearer sk",
      Default: "def",
      Alt: "enabled",
    });
  });

  it("undefined input → undefined", () => {
    expect(interpolateEnvRecord(undefined)).toBeUndefined();
  });

  it("empty record → empty record", () => {
    expect(interpolateEnvRecord({})).toEqual({});
  });
});

describe("truncateAtWord (comprehensive)", () => {
  it("short text unchanged", () => {
    expect(truncateAtWord("hi", 100)).toBe("hi");
  });

  it("empty string unchanged", () => {
    expect(truncateAtWord("", 10)).toBe("");
  });

  it("null/undefined unchanged", () => {
    expect(truncateAtWord(null as any, 10)).toBe(null);
    expect(truncateAtWord(undefined as any, 10)).toBe(undefined);
  });

  it("exact length unchanged", () => {
    expect(truncateAtWord("hello", 5)).toBe("hello");
  });

  it("truncation with space at boundary", () => {
    const r = truncateAtWord("hello world", 10);
    expect(r).toContain("hello");
    expect(r).toContain("...");
  });

  it("hard truncation when no space", () => {
    const r = truncateAtWord("abcdefghijklmnop", 8);
    expect(r).toContain("...");
  });

  it("space after 60% threshold", () => {
    const r = truncateAtWord("hello there friend", 16);
    // "hello there frie" 16 chars, lastSpace=11 > 9.6 → truncate to "hello there..."
    expect(r).toContain("hello there");
    expect(r).toContain("...");
  });
});

describe("resolveConfigPath (comprehensive)", () => {
  it("tilde to home", () => {
    const r = resolveConfigPath("~/test");
    expect(r).not.toContain("~");
    expect(r.endsWith("/test")).toBe(true);
  });

  it("standalone tilde", () => {
    const r = resolveConfigPath("~");
    expect(r).not.toContain("~");
  });

  it("undefined → undefined", () => {
    expect(resolveConfigPath(undefined)).toBeUndefined();
  });

  it("env var interpolation in path", () => {
    process.env.MCP_PATH = "/custom";
    expect(resolveConfigPath("${MCP_PATH}/file")).toBe("/custom/file");
    delete process.env.MCP_PATH;
  });
});

describe("resolveBearerToken (comprehensive)", () => {
  afterEach(() => {
    delete process.env.MCP_TOKEN;
  });

  it("direct token with interpolation", () => {
    process.env.MCP_TOKEN = "tok123";
    expect(resolveBearerToken({ bearerToken: "${MCP_TOKEN}" })).toBe("tok123");
  });

  it("env key lookup", () => {
    process.env.MCP_TOKEN = "tok_abc";
    expect(resolveBearerToken({ bearerTokenEnv: "MCP_TOKEN" })).toBe("tok_abc");
  });

  it("undefined when neither set", () => {
    expect(resolveBearerToken({})).toBeUndefined();
  });

  it("direct token without interpolation", () => {
    expect(resolveBearerToken({ bearerToken: "literal_token" })).toBe("literal_token");
  });
});

describe("formatAuthRequiredMessage (comprehensive)", () => {
  it("template replacement", () => {
    const cfg = { settings: { authRequiredMessage: "Auth ${server} first" } };
    expect(formatAuthRequiredMessage(cfg, "my-srv", "default")).toBe("Auth my-srv first");
  });

  it("falls back to default when no template", () => {
    expect(formatAuthRequiredMessage({ settings: {} }, "srv", "DEFAULT")).toBe("DEFAULT");
  });

  it("replaces all occurrences", () => {
    const cfg = { settings: { authRequiredMessage: "${server}:${server}" } };
    expect(formatAuthRequiredMessage(cfg, "x", "d")).toBe("x:x");
  });
});

describe("getConfigPathFromArgv", () => {
  it("returns undefined when flag not set", () => {
    expect(getConfigPathFromArgv()).toBeUndefined();
  });
});

describe("extractToolUiStreamMode (comprehensive)", () => {
  it("extracts eager mode", () => {
    expect(extractToolUiStreamMode({ ui: { "pi-mcp-adapter.streamMode": "eager" } })).toBe("eager");
  });

  it("extracts stream-first mode", () => {
    expect(extractToolUiStreamMode({ ui: { "pi-mcp-adapter.streamMode": "stream-first" } })).toBe("stream-first");
  });

  it("returns undefined for no ui", () => {
    expect(extractToolUiStreamMode(undefined)).toBeUndefined();
  });

  it("returns undefined for missing streamMode", () => {
    expect(extractToolUiStreamMode({ ui: {} })).toBeUndefined();
  });

  it("returns undefined for unknown mode", () => {
    expect(extractToolUiStreamMode({ ui: { "pi-mcp-adapter.streamMode": "unknown" } })).toBeUndefined();
  });
});

describe("parallelLimit (e2e)", () => {
  it("executes all items with concurrency limit", async () => {
    const results = await parallelLimit([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("handles empty array", async () => {
    const results = await parallelLimit([], 2, async (n: number) => n);
    expect(results).toEqual([]);
  });

  it("respects concurrency limit", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const results = await parallelLimit([1, 2, 3, 4], 2, async (n) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 5));
      concurrent--;
      return n;
    });
    expect(results).toEqual([1, 2, 3, 4]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});
