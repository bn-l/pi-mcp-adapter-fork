/**
 * McpLifecycleManager tests
 */
import { describe, expect, it, vi } from "vitest";

function makeManager() {
  return {
    getConnection: vi.fn().mockReturnValue(null),
    connect: vi.fn().mockResolvedValue({ status: "connected" }),
    close: vi.fn(),
    closeAll: vi.fn(),
    isIdle: vi.fn().mockReturnValue(false),
  };
}

describe("McpLifecycleManager", () => {
  it("constructs", async () => {
    const { McpLifecycleManager } = await import("../lifecycle.ts");
    const mgr = new McpLifecycleManager(makeManager() as any);
    expect(mgr).toBeDefined();
  });

  it("reconnects keepAlive servers", async () => {
    const { McpLifecycleManager } = await import("../lifecycle.ts");
    const backend = makeManager();
    backend.getConnection.mockReturnValue(null);
    const mgr = new McpLifecycleManager(backend as any);

    let reconnected = "";
    mgr.setReconnectCallback((name) => { reconnected = name; });
    mgr.markKeepAlive("srv", { command: "echo" });

    // Access private method via any cast
    await (mgr as any).checkConnections();
    expect(backend.connect).toHaveBeenCalledWith("srv", { command: "echo" });
    expect(reconnected).toBe("srv");
  });

  it("skips reconnect for already connected servers", async () => {
    const { McpLifecycleManager } = await import("../lifecycle.ts");
    const backend = makeManager();
    backend.getConnection.mockReturnValue({ status: "connected" });
    const mgr = new McpLifecycleManager(backend as any);
    mgr.markKeepAlive("srv", { command: "echo" });
    await (mgr as any).checkConnections();
    expect(backend.connect).not.toHaveBeenCalled();
  });

  it("handles reconnect failure gracefully", async () => {
    const { McpLifecycleManager } = await import("../lifecycle.ts");
    const backend = makeManager();
    backend.getConnection.mockReturnValue(null);
    backend.connect.mockRejectedValue(new Error("timeout"));
    const mgr = new McpLifecycleManager(backend as any);
    mgr.markKeepAlive("srv", { command: "echo" });
    // Should not throw
    await expect((mgr as any).checkConnections()).resolves.toBeUndefined();
  });

  it("shuts down idle servers", async () => {
    const { McpLifecycleManager } = await import("../lifecycle.ts");
    const backend = makeManager();
    backend.isIdle.mockReturnValue(true);
    backend.getConnection.mockReturnValue({ status: "connected" });
    const mgr = new McpLifecycleManager(backend as any);
    mgr.registerServer("srv", { command: "echo" }, { idleTimeout: 5 });
    mgr.setGlobalIdleTimeout(10);

    let shutdownName = "";
    mgr.setIdleShutdownCallback((name) => { shutdownName = name; });

    await (mgr as any).checkConnections();
    expect(backend.close).toHaveBeenCalledWith("srv");
    expect(shutdownName).toBe("srv");
  });

  it("does not shut down keepAlive servers on idle", async () => {
    const { McpLifecycleManager } = await import("../lifecycle.ts");
    const backend = makeManager();
    backend.isIdle.mockReturnValue(true);
    const mgr = new McpLifecycleManager(backend as any);
    mgr.markKeepAlive("srv", { command: "echo" });
    mgr.registerServer("srv", { command: "echo" });
    await (mgr as any).checkConnections();
    // keepAlive servers skip idle shutdown
    expect(backend.close).not.toHaveBeenCalled();
  });

  it("does not shut down when idle timeout is 0", async () => {
    const { McpLifecycleManager } = await import("../lifecycle.ts");
    const backend = makeManager();
    backend.isIdle.mockReturnValue(true);
    const mgr = new McpLifecycleManager(backend as any);
    mgr.registerServer("srv", { command: "echo" });
    mgr.setGlobalIdleTimeout(0);
    await (mgr as any).checkConnections();
    expect(backend.close).not.toHaveBeenCalled();
  });

  it("uses per-server idle timeout", async () => {
    const { McpLifecycleManager } = await import("../lifecycle.ts");
    const mgr = new McpLifecycleManager(makeManager() as any);
    mgr.registerServer("srv", { command: "echo" }, { idleTimeout: 3 });
    mgr.setGlobalIdleTimeout(10);
    // Per-server timeout takes precedence
    const timeout = (mgr as any).getIdleTimeout("srv");
    expect(timeout).toBe(3 * 60 * 1000);
  });

  it("uses global idle timeout when no per-server setting", async () => {
    const { McpLifecycleManager } = await import("../lifecycle.ts");
    const mgr = new McpLifecycleManager(makeManager() as any);
    mgr.registerServer("srv", { command: "echo" });
    mgr.setGlobalIdleTimeout(5);
    const timeout = (mgr as any).getIdleTimeout("srv");
    expect(timeout).toBe(5 * 60 * 1000);
  });

  it("gracefulShutdown clears interval and closes all", async () => {
    const { McpLifecycleManager } = await import("../lifecycle.ts");
    const backend = makeManager();
    const mgr = new McpLifecycleManager(backend as any);
    mgr.startHealthChecks(5000);
    await mgr.gracefulShutdown();
    expect(backend.closeAll).toHaveBeenCalled();
  });

  it("gracefulShutdown works without health checks", async () => {
    const { McpLifecycleManager } = await import("../lifecycle.ts");
    const backend = makeManager();
    const mgr = new McpLifecycleManager(backend as any);
    await mgr.gracefulShutdown();
    expect(backend.closeAll).toHaveBeenCalled();
  });
});
