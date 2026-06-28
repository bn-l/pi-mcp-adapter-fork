/**
 * E2E tests for server-manager.ts — isRetriableConnectionError,
 * connect failures, HTTP auth, and error recovery.
 *
 * All tests use real MCP stdio servers (no mocking).
 */
import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { McpServerManager, isRetriableConnectionError } from "../server-manager.ts";
import type { ServerDefinition } from "../types.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/e2e-server.mjs", import.meta.url));
const DEFINITION: ServerDefinition = { command: process.execPath, args: [FIXTURE] };
const managers: McpServerManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map(m => m.closeAll().catch(() => {})));
});

describe("isRetriableConnectionError", () => {
  it("matches econnrefused", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:8080");
    expect(isRetriableConnectionError(err)).toBe(true);
  });

  it("matches econnreset", () => {
    const err = new Error("read ECONNRESET");
    expect(isRetriableConnectionError(err)).toBe(true);
  });

  it("matches epipe", () => {
    const err = new Error("write EPIPE");
    expect(isRetriableConnectionError(err)).toBe(true);
  });

  it("matches enetunreach", () => {
    const err = new Error("connect ENETUNREACH");
    expect(isRetriableConnectionError(err)).toBe(true);
  });

  it("matches ehostunreach", () => {
    const err = new Error("connect EHOSTUNREACH");
    expect(isRetriableConnectionError(err)).toBe(true);
  });

  it("matches fetch failed", () => {
    const err = new Error("fetch failed");
    expect(isRetriableConnectionError(err)).toBe(true);
  });

  it("matches transport not connected", () => {
    const err = new Error("transport not connected");
    expect(isRetriableConnectionError(err)).toBe(true);
  });

  it("matches transport closed", () => {
    const err = new Error("transport closed");
    expect(isRetriableConnectionError(err)).toBe(true);
  });

  it("matches network error", () => {
    const err = new Error("network error");
    expect(isRetriableConnectionError(err)).toBe(true);
  });

  it("matches HTTP 404 stale session", () => {
    const err = new Error("HTTP 404: Not Found");
    expect(isRetriableConnectionError(err)).toBe(true);
  });

  it("matches HTTP 502 bad gateway", () => {
    const err = new Error("HTTP 502: Bad Gateway");
    expect(isRetriableConnectionError(err)).toBe(true);
  });

  it("matches HTTP 503 service unavailable", () => {
    const err = new Error("HTTP 503: Service Unavailable");
    expect(isRetriableConnectionError(err)).toBe(true);
  });

  it("rejects non-Error values", () => {
    expect(isRetriableConnectionError("error string")).toBe(false);
    expect(isRetriableConnectionError(null)).toBe(false);
    expect(isRetriableConnectionError(undefined)).toBe(false);
    expect(isRetriableConnectionError(42)).toBe(false);
  });

  it("rejects non-retriable errors", () => {
    expect(isRetriableConnectionError(new Error("tool not found"))).toBe(false);
    expect(isRetriableConnectionError(new Error("validation failed"))).toBe(false);
    expect(isRetriableConnectionError(new Error("EHOSTDOWN not a pattern"))).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isRetriableConnectionError(new Error("CONNECT ECONNREFUSED"))).toBe(true);
    expect(isRetriableConnectionError(new Error("FETCH FAILED"))).toBe(true);
  });
});

describe("E2E Server Manager — connect failure and edge cases", () => {
  it("rejects invalid command gracefully", async () => {
    const manager = new McpServerManager();
    managers.push(manager);

    await expect(
      manager.connect("bad", { command: "/nonexistent/binary_xyz_123" })
    ).rejects.toThrow();
  });

  it("rejects server with no command or url", async () => {
    const manager = new McpServerManager();
    managers.push(manager);

    await expect(
      manager.connect("bad", {} as ServerDefinition)
    ).rejects.toThrow("has no command or url");
  });

  it("connect deduplicates concurrent connection attempts (e2e)", async () => {
    const manager = new McpServerManager();
    managers.push(manager);

    const [conn1, conn2] = await Promise.all([
      manager.connect("dedup-e2e", DEFINITION),
      manager.connect("dedup-e2e", DEFINITION),
    ]);

    expect(conn1.status).toBe("connected");
    expect(conn1).toBe(conn2);
  });

  it("getConnection returns undefined for unknown server", () => {
    const manager = new McpServerManager();
    expect(manager.getConnection("nonexistent")).toBeUndefined();
  });

  it("getAllConnections returns empty map for fresh manager", () => {
    const manager = new McpServerManager();
    expect(manager.getAllConnections().size).toBe(0);
  });

  it("touch and isIdle work correctly", async () => {
    const manager = new McpServerManager();
    managers.push(manager);

    await manager.connect("idle-test", DEFINITION);

    // Freshly connected = not idle with 60s threshold (connected within last 60s)
    expect(manager.isIdle("idle-test", 60000)).toBe(false);

    // With 0ms timeout, small delay makes it idle
    await new Promise(r => setTimeout(r, 1));
    expect(manager.isIdle("idle-test", 0)).toBe(true);

    manager.touch("idle-test");
    // After touch, not idle with 60s threshold
    expect(manager.isIdle("idle-test", 60000)).toBe(false);
  });

  it("isIdle returns false for unknown server", () => {
    const manager = new McpServerManager();
    expect(manager.isIdle("unknown", 1000)).toBe(false);
  });

  it("closes all connections cleanly", async () => {
    const manager = new McpServerManager();
    managers.push(manager);

    await manager.connect("e2e-a", DEFINITION);
    await manager.connect("e2e-b", DEFINITION);

    expect(manager.getAllConnections().size).toBe(2);

    await manager.closeAll();
    expect(manager.getAllConnections().size).toBe(0);
  });

  it("close is idempotent for unknown server", async () => {
    const manager = new McpServerManager();
    await expect(manager.close("unknown")).resolves.toBeUndefined();
  });

  it("reconnects after close (e2e)", async () => {
    const manager = new McpServerManager();
    managers.push(manager);

    const conn1 = await manager.connect("reconn", DEFINITION);
    expect(conn1.status).toBe("connected");

    await manager.close("reconn");
    expect(manager.getConnection("reconn")).toBeUndefined();

    const conn2 = await manager.connect("reconn", DEFINITION);
    expect(conn2.status).toBe("connected");
    expect(conn2).not.toBe(conn1);
  });

  it("incrementInFlight and decrementInFlight work", async () => {
    const manager = new McpServerManager();
    managers.push(manager);

    await manager.connect("flight-test", DEFINITION);

    manager.incrementInFlight("flight-test");
    manager.incrementInFlight("flight-test");
    // With inFlight > 0, isIdle with any timeout should return false
    expect(manager.isIdle("flight-test", 60000)).toBe(false);

    manager.decrementInFlight("flight-test");
    expect(manager.isIdle("flight-test", 60000)).toBe(false);

    manager.decrementInFlight("flight-test");
    expect(manager.isIdle("flight-test", -1)).toBe(true);
  });

  it("incrementInFlight is safe for unknown server", () => {
    const manager = new McpServerManager();
    expect(() => manager.incrementInFlight("unknown")).not.toThrow();
    expect(() => manager.decrementInFlight("unknown")).not.toThrow();
  });
});
