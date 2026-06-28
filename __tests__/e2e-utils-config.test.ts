/**
 * E2E tests for utils.ts and config.ts
 *
 * Tests env var interpolation, path resolution, truncation,
 * and config loading/merging — all without mocking.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  interpolateEnvVars,
  interpolateEnvRecord,
  truncateAtWord,
  resolveConfigPath,
  resolveBearerToken,
  formatAuthRequiredMessage,
  getConfigPathFromArgv,
  openPath,
  openUrl,
} from "../utils.ts";
import {
  loadMcpConfig,
  getMcpDiscoverySummary,
  getConfigDiscoveryPaths,
  findAvailableImportConfigs,
} from "../config.ts";
import type { McpConfig } from "../types.ts";

describe("Utils — env var interpolation", () => {
  afterEach(() => {
    delete process.env.MCP_TEST_A;
    delete process.env.MCP_TEST_B;
    delete process.env.MCP_EMPTY;
  });

  it("interpolateEnvVars: ${VAR}", () => {
    process.env.MCP_TEST_A = "val_a";
    expect(interpolateEnvVars("${MCP_TEST_A}")).toBe("val_a");
  });

  it("interpolateEnvVars: missing var → empty", () => {
    expect(interpolateEnvVars("${MCP_MISSING_XYZ}")).toBe("");
  });

  it("interpolateEnvVars: ${VAR:-default}", () => {
    // Missing
    expect(interpolateEnvVars("${MCP_MISSING:-fallback}")).toBe("fallback");
    // Present
    process.env.MCP_TEST_A = "real";
    expect(interpolateEnvVars("${MCP_TEST_A:-fallback}")).toBe("real");
    // Empty string → fallback
    process.env.MCP_TEST_A = "";
    expect(interpolateEnvVars("${MCP_TEST_A:-fallback}")).toBe("fallback");
  });

  it("interpolateEnvVars: ${VAR:+alt}", () => {
    expect(interpolateEnvVars("${MCP_MISSING:+present}")).toBe("");
    process.env.MCP_TEST_A = "exists";
    expect(interpolateEnvVars("${MCP_TEST_A:+present}")).toBe("present");
  });

  it("interpolateEnvVars: multiple substitutions", () => {
    process.env.MCP_TEST_A = "a";
    process.env.MCP_TEST_B = "b";
    expect(interpolateEnvVars("${MCP_TEST_A}_${MCP_TEST_B}_${MCP_MISSING:-x}")).toBe("a_b_x");
  });

  it("interpolateEnvVars: $env:VAR syntax", () => {
    process.env.MCP_TEST_A = "env_val";
    expect(interpolateEnvVars("$env:MCP_TEST_A")).toBe("env_val");
  });

  it("interpolateEnvRecord: resolves all entries", () => {
    process.env.MCP_TEST_A = "key_val";
    const result = interpolateEnvRecord({
      Auth: "Bearer ${MCP_TEST_A}",
      Url: "${MCP_MISSING:-http://default}",
      Empty: "${MCP_EMPTY:-empty}",
    });
    expect(result).toEqual({
      Auth: "Bearer key_val",
      Url: "http://default",
      Empty: "empty",
    });
  });

  it("interpolateEnvRecord: returns undefined for undefined input", () => {
    expect(interpolateEnvRecord(undefined)).toBeUndefined();
  });
});

describe("Utils — truncation and path resolution", () => {
  it("truncateAtWord: short text unchanged", () => {
    expect(truncateAtWord("hi", 100)).toBe("hi");
    expect(truncateAtWord("", 10)).toBe("");
    expect(truncateAtWord(null as any, 10)).toBe(null);
    expect(truncateAtWord(undefined as any, 10)).toBe(undefined);
  });

  it("truncateAtWord: truncates at word boundary", () => {
    // "hello world" — target 10: "hello worl" → lastSpace=5 → 5 > 6? No → hard truncation
    const result = truncateAtWord("hello world foo bar", 10);
    expect(result).toContain("...");
    expect(result.length).toBeLessThanOrEqual(13);
  });

  it("truncateAtWord: no word boundary → hard truncation", () => {
    const result = truncateAtWord("abcdefghijklmnop", 8);
    // Since no space in first 8 chars, hard truncates
    expect(result).toBe("abcdefgh...");
  });

  it("resolveConfigPath: tilde expansion", () => {
    const result = resolveConfigPath("~/test/path");
    expect(result).not.toContain("~");
    expect(result.endsWith("/test/path")).toBe(true);
  });

  it("resolveConfigPath: standalone tilde", () => {
    const result = resolveConfigPath("~");
    expect(result).not.toContain("~");
  });

  it("resolveConfigPath: undefined returns undefined", () => {
    expect(resolveConfigPath(undefined)).toBeUndefined();
  });

  it("resolveConfigPath: env var interpolation", () => {
    process.env.MCP_TEST_A = "/custom";
    expect(resolveConfigPath("${MCP_TEST_A}/file")).toBe("/custom/file");
    delete process.env.MCP_TEST_A;
  });

  it("resolveBearerToken: direct token with interpolation", () => {
    process.env.MCP_TOKEN = "tok_123";
    expect(resolveBearerToken({ bearerToken: "${MCP_TOKEN}" })).toBe("tok_123");
    delete process.env.MCP_TOKEN;
  });

  it("resolveBearerToken: env key lookup", () => {
    process.env.MCP_TOKEN = "tok_abc";
    expect(resolveBearerToken({ bearerTokenEnv: "MCP_TOKEN" })).toBe("tok_abc");
    delete process.env.MCP_TOKEN;
  });

  it("resolveBearerToken: undefined when neither set", () => {
    expect(resolveBearerToken({})).toBeUndefined();
  });

  it("formatAuthRequiredMessage: template replacement", () => {
    const config = { settings: { authRequiredMessage: "Please auth ${server} first" } };
    expect(formatAuthRequiredMessage(config, "my-srv", "default")).toBe("Please auth my-srv first");
  });

  it("formatAuthRequiredMessage: fallback to default", () => {
    const config = { settings: {} };
    expect(formatAuthRequiredMessage(config, "srv", "DEFAULT")).toBe("DEFAULT");
  });

  it("getConfigPathFromArgv: returns undefined when flag not set", () => {
    expect(getConfigPathFromArgv()).toBeUndefined();
  });
});

describe("Config — loading and merging", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `mcp-config-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadMcpConfig: loads from mcp.json file", () => {
    const configPath = join(tmpDir, "mcp.json");
    writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        test: { command: "node", args: ["server.js"] },
      },
    }));

    const config = loadMcpConfig(configPath, tmpDir);
    expect(config.mcpServers.test).toBeDefined();
    expect(config.mcpServers.test.command).toBe("node");
  });

  it("loadMcpConfig: returns empty config for nonexistent file", () => {
    const config = loadMcpConfig(join(tmpDir, "nonexistent.json"), tmpDir);
    expect(config.mcpServers).toEqual({});
  });

  it("loadMcpConfig: merges multiple config layers", () => {
    // pi-global config
    mkdirSync(join(tmpDir, ".pi"), { recursive: true });
    writeFileSync(join(tmpDir, ".pi", "mcp.json"), JSON.stringify({
      mcpServers: { global_srv: { command: "global" } },
      settings: { toolPrefix: "mcp" },
    }));

    // project .mcp.json
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({
      mcpServers: { project_srv: { command: "project" } },
    }));

    const config = loadMcpConfig(undefined, tmpDir);
    // Both servers should be present (merged)
    expect(Object.keys(config.mcpServers)).toContain("global_srv");
    expect(Object.keys(config.mcpServers)).toContain("project_srv");
  });

  it("loadMcpConfig: project overrides global by server name", () => {
    // Write to .mcp.json (shared-project) and .pi/mcp.json (pi-project)
    // pi-project overrides shared-project per mergeConfigs
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({
      mcpServers: { shared: { command: "global_binary" } },
    }));
    mkdirSync(join(tmpDir, ".pi"), { recursive: true });
    writeFileSync(join(tmpDir, ".pi", "mcp.json"), JSON.stringify({
      mcpServers: { shared: { command: "project_binary" } },
    }));

    const config = loadMcpConfig(undefined, tmpDir);
    // Project pi override wins over shared project
    expect(config.mcpServers.shared.command).toBe("project_binary");
  });

  it("loadMcpConfig: validates and rejects malformed config", () => {
    writeFileSync(join(tmpDir, ".mcp.json"), "not json");

    const config = loadMcpConfig(undefined, tmpDir);
    // Should not throw, returns empty/default
    expect(config.mcpServers).toBeDefined();
  });

  it("getConfigDiscoveryPaths: lists all config paths", () => {
    writeFileSync(join(tmpDir, ".mcp.json"), "{}");
    const paths = getConfigDiscoveryPaths(undefined, tmpDir);
    expect(paths.length).toBeGreaterThanOrEqual(1);
    const projectPath = paths.find(p => p.path.endsWith(".mcp.json"));
    expect(projectPath).toBeDefined();
    expect(projectPath!.exists).toBe(true);
  });

  it("getMcpDiscoverySummary: reports server counts", () => {
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({
      mcpServers: { a: { command: "a" }, b: { command: "b" } },
    }));

    const summary = getMcpDiscoverySummary(undefined, tmpDir);
    expect(summary.totalServerCount).toBeGreaterThanOrEqual(2);
    expect(summary.hasAnyConfig).toBe(true);
  });

  it("findAvailableImportConfigs: finds existing host configs", () => {
    // Write a fake Cursor config
    const cursorDir = join(tmpDir, ".cursor");
    mkdirSync(cursorDir, { recursive: true });
    writeFileSync(join(cursorDir, "mcp.json"), JSON.stringify({
      mcpServers: { cursor_srv: { command: "cursor" } },
    }));

    const imports = findAvailableImportConfigs(tmpDir);
    const cursorImport = imports.find(i => i.kind === "cursor");
    expect(cursorImport).toBeDefined();
  });
});
