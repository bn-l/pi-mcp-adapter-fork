import { describe, expect, it, vi } from "vitest";

describe("lifecycle checkConnections", () => {
  it("calls reconnect callback after keepAlive reconnect", async () => {
    const { McpLifecycleManager } = await import("../lifecycle.ts");
    const backend = {
      getConnection: () => null,
      connect: vi.fn().mockResolvedValue({ status: "connected" as const }),
      close: vi.fn(),
      closeAll: vi.fn(),
      isIdle: vi.fn(() => false),
    };
    let cbName = "";
    const mgr = new McpLifecycleManager(backend as any);
    mgr.setReconnectCallback((name: string) => { cbName = name; });
    mgr.markKeepAlive("srv", { command: "echo" });
    await (mgr as any).checkConnections();
    expect(cbName).toBe("srv");
    expect(backend.connect).toHaveBeenCalledWith("srv", { command: "echo" });
  });
});
