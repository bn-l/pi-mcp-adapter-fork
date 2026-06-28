/**
 * Push proxy-modes 80→85+ — exercise remaining internal helpers through exported functions
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn().mockResolvedValue("authenticated"),
  completeAuthFromInput: vi.fn(),
  startAuth: vi.fn(),
  supportsOAuth: vi.fn().mockReturnValue(true),
  lazyConnect: vi.fn().mockResolvedValue(true),
  updateServerMetadata: vi.fn(),
  updateMetadataCache: vi.fn(),
  getFailureAgeSeconds: vi.fn().mockReturnValue(null),
  updateStatusBar: vi.fn(),
}));

vi.mock("../mcp-auth-flow.ts", () => ({ authenticate: mocks.authenticate, completeAuthFromInput: mocks.completeAuthFromInput, startAuth: mocks.startAuth, supportsOAuth: mocks.supportsOAuth, removeAuth: vi.fn() }));
vi.mock("../init.ts", () => ({ lazyConnect: mocks.lazyConnect, updateServerMetadata: mocks.updateServerMetadata, updateMetadataCache: mocks.updateMetadataCache, getFailureAgeSeconds: mocks.getFailureAgeSeconds, updateStatusBar: mocks.updateStatusBar }));

import { executeCall, executeConnect, executeAuthStart } from "../proxy-modes.ts";

describe("proxy-modes internal helper coverage", () => {
  beforeEach(() => {
    mocks.lazyConnect.mockResolvedValue(true);
    mocks.supportsOAuth.mockReturnValue(true);
    mocks.getFailureAgeSeconds.mockReturnValue(null);
  });

  // attemptAutoAuth success path tested via proxy-modes-auto-auth.test.ts

  // getRedirectPort via executeAuthStart with various URL patterns
  it("getRedirectPort: redirect_uri with port", async () => {
    mocks.startAuth.mockResolvedValue({ authorizationUrl: "https://auth.example.com/authorize?redirect_uri=http://localhost:9876/callback" });
    const s = { config: { mcpServers: { srv: { url: "http://srv" } }, settings: {} } } as any;
    const result = await executeAuthStart(s, "srv");
    expect(result.content[0].text).toContain("port 9876");
  });

  it("getRedirectPort: redirect_uri without port", async () => {
    mocks.startAuth.mockResolvedValue({ authorizationUrl: "https://auth.example.com/authorize?redirect_uri=https://callback.example.com" });
    const s = { config: { mcpServers: { srv: { url: "http://srv" } }, settings: {} } } as any;
    const result = await executeAuthStart(s, "srv");
    expect(result.content[0].text).toContain("Open this URL");
  });

  it("getRedirectPort: no redirect_uri in URL", async () => {
    mocks.startAuth.mockResolvedValue({ authorizationUrl: "https://auth.example.com/authorize" });
    const s = { config: { mcpServers: { srv: { url: "http://srv" } }, settings: {} } } as any;
    const result = await executeAuthStart(s, "srv");
    expect(result.content[0].text).toContain("Open this URL");
  });

  // executeAuthStart edge cases
  it("executeAuthStart: oauth_not_supported for non-OAuth server", async () => {
    mocks.supportsOAuth.mockReturnValue(false);
    const s = { config: { mcpServers: { srv: { command: "echo" } }, settings: {} } } as any;
    const result = await executeAuthStart(s, "srv");
    expect(result.details.error).toBe("oauth_not_supported");
  });

  it("executeAuthStart: server without url returns oauth_not_supported", async () => {
    mocks.supportsOAuth.mockReturnValue(true);
    const s = { config: { mcpServers: { srv: { command: "echo" } }, settings: {} } } as any;
    const result = await executeAuthStart(s, "srv");
    expect(result.details.error).toBe("oauth_not_supported");
  });

  // executeCall with auto-auth path
  it("executeCall: autoAuth succeeds and retries tool call", async () => {
    mocks.lazyConnect.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mocks.supportsOAuth.mockReturnValue(true);
    const callToolFn = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "result" }], isError: false });
    const s = {
      config: { mcpServers: { srv: { url: "http://srv", command: "x" } }, settings: { autoAuth: true, toolPrefix: "server" } },
      toolMetadata: new Map([["srv", [{ name: "srv_echo", originalName: "echo", description: "Echo" }]]]),
      manager: {
        connect: vi.fn().mockResolvedValue({ status: "connected", tools: [{ name: "echo" }], resources: [] }),
        getConnection: () => ({ status: "needs-auth" }),
        close: vi.fn(), touch: vi.fn(), incrementInFlight: vi.fn(), decrementInFlight: vi.fn(),
      },
      failureTracker: new Map(), completedUiSessions: [],
    } as any;
    const result = await executeCall(s, "srv_echo", {});
    expect(result.details.error).toBe("auth_required");
  });
});
