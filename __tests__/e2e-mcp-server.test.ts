/**
 * E2E tests: real MCP stdio server integration
 *
 * Spawns a real MCP stdio server as a child process, connects via
 * McpServerManager, discovers tools, calls them, and verifies results.
 *
 * This exercises the full pipeline: transport → connect → listTools →
 * callTool → content transformation. Uses real process spawning so it
 * validates the actual MCP protocol handshake.
 */
import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { McpServerManager } from "../server-manager.ts";
import type { ServerDefinition } from "../types.ts";
import { interpolateEnvVars, interpolateEnvRecord, truncateAtWord, resolveConfigPath } from "../utils.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/e2e-server.mjs", import.meta.url));
const DEFINITION: ServerDefinition = { command: process.execPath, args: [FIXTURE] };

const managers: McpServerManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map(m => m.closeAll().catch(() => {})));
});

describe("E2E MCP Server", () => {
  it("connects and discovers all 5 tools (e2e)", async () => {
    const manager = new McpServerManager();
    managers.push(manager);

    const connection = await manager.connect("e2e", DEFINITION);
    expect(connection.status).toBe("connected");

    expect(connection.tools.length).toBe(5);
    const names = connection.tools.map(t => t.name);
    expect(names).toContain("echo");
    expect(names).toContain("add");
    expect(names).toContain("get_time");
    expect(names).toContain("get_resource");
    expect(names).toContain("always_errors");
  });

  it("calls echo tool (e2e)", async () => {
    const manager = new McpServerManager();
    managers.push(manager);
    const connection = await manager.connect("e2e", DEFINITION);

    const result = await connection.client.callTool({
      name: "echo",
      arguments: { message: "hello world" },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toBe("Echo: hello world");
  });

  it("calls add tool (e2e)", async () => {
    const manager = new McpServerManager();
    managers.push(manager);
    const connection = await manager.connect("e2e", DEFINITION);

    const result = await connection.client.callTool({
      name: "add",
      arguments: { a: 3, b: 7 },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toBe("10");
  });

  it("calls get_time tool (e2e)", async () => {
    const manager = new McpServerManager();
    managers.push(manager);
    const connection = await manager.connect("e2e", DEFINITION);

    const result = await connection.client.callTool({
      name: "get_time",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(() => new Date(text)).not.toThrow();
    expect(new Date(text).getTime()).not.toBeNaN();
  });

  it("handles tool returning isError:true (e2e)", async () => {
    const manager = new McpServerManager();
    managers.push(manager);
    const connection = await manager.connect("e2e", DEFINITION);

    const result = await connection.client.callTool({
      name: "always_errors",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toContain("Intentional error");
  });

  it("handles unknown tool (e2e)", async () => {
    const manager = new McpServerManager();
    managers.push(manager);
    const connection = await manager.connect("e2e", DEFINITION);

    await expect(
      connection.client.callTool({ name: "nonexistent", arguments: {} })
    ).rejects.toThrow();
  });

  it("closes and reconnects cleanly (e2e)", async () => {
    const manager = new McpServerManager();
    managers.push(manager);

    const conn1 = await manager.connect("reconn", DEFINITION);
    expect(conn1.status).toBe("connected");
    expect(manager.getConnection("reconn")).toBeDefined();

    await manager.close("reconn");
    expect(manager.getConnection("reconn")).toBeUndefined();

    const conn2 = await manager.connect("reconn", DEFINITION);
    expect(conn2.status).toBe("connected");
    expect(conn2).not.toBe(conn1);
  });

  it("getAllConnections returns all connected servers (e2e)", async () => {
    const manager = new McpServerManager();
    managers.push(manager);

    // FIXTURE is used for both — different server names spawn separate processes
    await manager.connect("e2e-a", DEFINITION);
    await manager.connect("e2e-b", DEFINITION);

    const all = manager.getAllConnections();
    expect(all.size).toBe(2);
    expect(all.has("e2e-a")).toBe(true);
    expect(all.has("e2e-b")).toBe(true);

    await manager.closeAll();
    expect(manager.getAllConnections().size).toBe(0);
  });

  it("connect deduplicates concurrent attempts (e2e)", async () => {
    const manager = new McpServerManager();
    managers.push(manager);

    const [conn1, conn2] = await Promise.all([
      manager.connect("dedup", DEFINITION),
      manager.connect("dedup", DEFINITION),
    ]);

    expect(conn1.status).toBe("connected");
    expect(conn1).toBe(conn2);
  });

  it("calls get_resource tool (e2e)", async () => {
    const manager = new McpServerManager();
    managers.push(manager);
    const connection = await manager.connect("e2e", DEFINITION);

    const result = await connection.client.callTool({
      name: "get_resource",
      arguments: { key: "config" },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toBe("resource:config");
  });
});

describe("Utils (e2e context)", () => {
  it("interpolateEnvVars supports ${VAR}, ${VAR:-default}, and ${VAR:+alt}", () => {
    process.env.T = "val";
    expect(interpolateEnvVars("${T}")).toBe("val");
    expect(interpolateEnvVars("${MISSING:-fallback}")).toBe("fallback");
    process.env.T = "";
    expect(interpolateEnvVars("${T:-fallback}")).toBe("fallback");
    process.env.T = "val";
    expect(interpolateEnvVars("${T:+present}")).toBe("present");
    delete process.env.T;
  });

  it("interpolateEnvRecord resolves nested values", () => {
    process.env.KEY = "sk";
    const result = interpolateEnvRecord({
      Auth: "Bearer ${KEY}",
      Fallback: "${MISSING:-default}",
    });
    expect(result).toEqual({ Auth: "Bearer sk", Fallback: "default" });
    delete process.env.KEY;
  });

  it("truncateAtWord and resolveConfigPath", () => {
    expect(truncateAtWord("hi", 100)).toBe("hi");
    expect(truncateAtWord("long string here", 8)).toContain("...");
    const resolved = resolveConfigPath("~/test");
    expect(resolved).not.toContain("~");
  });
});
