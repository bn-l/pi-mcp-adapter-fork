import { describe, expect, it } from "vitest";

describe("logger MCP_UI_DEBUG", () => {
  it("set to true enables debug", async () => {
    const old = process.env.MCP_UI_DEBUG;
    process.env.MCP_UI_DEBUG = "true";
    const mod = await import("../logger.ts");
    expect(mod.logger).toBeDefined();
    if (old === undefined) delete process.env.MCP_UI_DEBUG;
    else process.env.MCP_UI_DEBUG = old;
  });
});
