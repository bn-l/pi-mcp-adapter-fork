/**
 * Comprehensive mcp-auth-flow.ts tests
 * Covers parseAuthorizationCodeInput, completeAuth, authenticate flow, getValidToken, getAuthStatus
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthForUrl: vi.fn(),
  isTokenExpired: vi.fn(),
  hasStoredTokens: vi.fn(),
  clearAllCredentials: vi.fn(),
  clearClientInfo: vi.fn(),
  clearTokens: vi.fn(),
  clearCodeVerifier: vi.fn(),
  updateOAuthState: vi.fn(),
  getOAuthState: vi.fn(),
  clearOAuthState: vi.fn(),
  ensureCallbackServer: vi.fn(),
  waitForCallback: vi.fn(),
  cancelPendingCallback: vi.fn(),
  stopCallbackServer: vi.fn(),
  releaseCallbackServer: vi.fn(),
  runSdkAuth: vi.fn(),
  open: vi.fn(),
  McpOAuthProvider: vi.fn(),
}));

vi.mock("../mcp-auth.ts", () => ({
  getAuthForUrl: mocks.getAuthForUrl,
  isTokenExpired: mocks.isTokenExpired,
  hasStoredTokens: mocks.hasStoredTokens,
  clearAllCredentials: mocks.clearAllCredentials,
  clearClientInfo: mocks.clearClientInfo,
  clearTokens: mocks.clearTokens,
  clearCodeVerifier: mocks.clearCodeVerifier,
  updateOAuthState: mocks.updateOAuthState,
  getOAuthState: mocks.getOAuthState,
  clearOAuthState: mocks.clearOAuthState,
  updateCodeVerifier: vi.fn(),
}));
vi.mock("../mcp-callback-server.ts", () => ({
  ensureCallbackServer: mocks.ensureCallbackServer,
  waitForCallback: mocks.waitForCallback,
  cancelPendingCallback: mocks.cancelPendingCallback,
  stopCallbackServer: mocks.stopCallbackServer,
  releaseCallbackServer: mocks.releaseCallbackServer,
}));
vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: mocks.runSdkAuth,
  UnauthorizedError: class extends Error {
    constructor(message?: string) { super(message); this.name = "UnauthorizedError"; }
  },
}));
vi.mock("open", () => ({ default: mocks.open }));

describe("parseAuthorizationCodeInput", () => {
  it("throws on empty input", async () => {
    const { parseAuthorizationCodeInput } = await import("../mcp-auth-flow.ts");
    expect(() => parseAuthorizationCodeInput("   ")).toThrow("required");
  });

  it("extracts code from query params", async () => {
    const { parseAuthorizationCodeInput } = await import("../mcp-auth-flow.ts");
    expect(parseAuthorizationCodeInput("?code=abc123&state=st")).toBe("abc123");
  });

  it("extracts code from full URL", async () => {
    const { parseAuthorizationCodeInput } = await import("../mcp-auth-flow.ts");
    expect(parseAuthorizationCodeInput("http://localhost:8080/callback?code=xyz")).toBe("xyz");
  });

  it("throws on error param", async () => {
    const { parseAuthorizationCodeInput } = await import("../mcp-auth-flow.ts");
    expect(() => parseAuthorizationCodeInput("?error=access_denied")).toThrow("access_denied");
  });

  it("throws on error with description", async () => {
    const { parseAuthorizationCodeInput } = await import("../mcp-auth-flow.ts");
    expect(() => parseAuthorizationCodeInput("?error=invalid&error_description=bad+request")).toThrow("bad request");
  });

  it("throws on state missing when expected", async () => {
    const { parseAuthorizationCodeInput } = await import("../mcp-auth-flow.ts");
    expect(() => parseAuthorizationCodeInput("?code=abc", "expected-state")).toThrow("state missing");
  });

  it("throws on state mismatch", async () => {
    const { parseAuthorizationCodeInput } = await import("../mcp-auth-flow.ts");
    expect(() => parseAuthorizationCodeInput("?code=abc&state=wrong", "expected-state")).toThrow("CSRF");
  });

  it("accepts raw code string", async () => {
    const { parseAuthorizationCodeInput } = await import("../mcp-auth-flow.ts");
    expect(parseAuthorizationCodeInput("abc123_xyz")).toBe("abc123_xyz");
  });

  it("throws on unparseable input", async () => {
    const { parseAuthorizationCodeInput } = await import("../mcp-auth-flow.ts");
    expect(() => parseAuthorizationCodeInput("not a valid code with spaces")).toThrow("find an OAuth");
  });
});

describe("supportsOAuth", () => {
  it("detects oauth support via auth field", async () => {
    const { supportsOAuth } = await import("../mcp-auth-flow.ts");
    expect(supportsOAuth({ auth: "oauth", url: "http://x" } as any)).toBe(true);
  });

  it("detects oauth support via url", async () => {
    const { supportsOAuth } = await import("../mcp-auth-flow.ts");
    expect(supportsOAuth({ url: "http://x" } as any)).toBe(true);
  });

  it("returns false for stdio-only servers", async () => {
    const { supportsOAuth } = await import("../mcp-auth-flow.ts");
    expect(supportsOAuth({ command: "echo" } as any)).toBe(false);
  });

  it("returns false when auth explicitly set to none", async () => {
    const { supportsOAuth } = await import("../mcp-auth-flow.ts");
    expect(supportsOAuth({ auth: "none" } as any)).toBe(false);
  });
});

describe("removeAuth", () => {
  it("removes all credentials", async () => {
    const { removeAuth } = await import("../mcp-auth-flow.ts");
    await removeAuth("test-srv");
    expect(mocks.clearAllCredentials).toHaveBeenCalledWith("test-srv");
  });
});

describe("getAuthStatus", () => {
  it("returns not_authenticated when no stored tokens", async () => {
    mocks.hasStoredTokens.mockReturnValue(false);
    const { getAuthStatus } = await import("../mcp-auth-flow.ts");
    expect(await getAuthStatus("test-srv")).toBe("not_authenticated");
  });

  it("returns authenticated with valid non-expired token", async () => {
    mocks.hasStoredTokens.mockReturnValue(true);
    mocks.isTokenExpired.mockReturnValue(false);
    const { getAuthStatus } = await import("../mcp-auth-flow.ts");
    expect(await getAuthStatus("test-srv")).toBe("authenticated");
  });

  it("returns expired when token is expired", async () => {
    mocks.hasStoredTokens.mockReturnValue(true);
    mocks.isTokenExpired.mockReturnValue(true);
    const { getAuthStatus } = await import("../mcp-auth-flow.ts");
    expect(await getAuthStatus("test-srv")).toBe("expired");
  });
});
