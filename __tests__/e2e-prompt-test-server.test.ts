/**
 * Full e2e test against the real FastMCP prompt-test-server.
 *
 * Verifies the complete pipeline: connect → discover prompts →
 * listPrompts → getPrompt → slash-command names.
 */
import { describe, expect, it, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { McpServerManager } from "../server-manager.ts";
import { executeGetPrompt, executeListPrompts } from "../proxy-modes.ts";
import type { McpExtensionState, ServerDefinition } from "../types.ts";

const FIXTURE = fileURLToPath(
  new URL("./fixtures/prompt-test-server.py", import.meta.url),
);
const DEFINITION: ServerDefinition = {
  command: "python3",
  args: [FIXTURE],
};

const managers: McpServerManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.closeAll().catch(() => {})));
});

function makeState(manager: McpServerManager, serverName: string): McpExtensionState {
  return {
    config: { mcpServers: { [serverName]: DEFINITION } },
    manager,
    toolMetadata: new Map(),
    failureTracker: new Map(),
    completedUiSessions: [],
  } as unknown as McpExtensionState;
}

describe("prompt-test-server integration", () => {
  it("connects and discovers 3 prompts", async () => {
    const manager = new McpServerManager();
    managers.push(manager);

    const conn = await manager.connect("pts", DEFINITION);
    expect(conn.status).toBe("connected");
    expect(conn.prompts.length).toBe(3);

    const names = conn.prompts.map((p) => p.name).sort();
    expect(names).toEqual(["code_review", "greeting", "simple"]);
  });

  it("executeListPrompts shows all 3 prompts", async () => {
    const manager = new McpServerManager();
    managers.push(manager);
    await manager.connect("pts-list", DEFINITION);

    const state = makeState(manager, "pts-list");
    const result = executeListPrompts(state, "pts-list");

    expect(result.content[0].text).toContain("greeting");
    expect(result.content[0].text).toContain("code_review");
    expect(result.content[0].text).toContain("simple");
    expect(result.content[0].text).toContain("3 prompts");
  });

  it("executeGetPrompt greeting with arg", async () => {
    const manager = new McpServerManager();
    managers.push(manager);
    await manager.connect("pts-get", DEFINITION);

    const state = makeState(manager, "pts-get");
    const result = await executeGetPrompt(state, "pts-get", "greeting", {
      name: "Alice",
    });

    expect(result.content[0].text).toContain("Prompt");
    expect(result.content[0].text).toContain("Hello, Alice!");
  });

  it("executeGetPrompt greeting without arg uses default", async () => {
    const manager = new McpServerManager();
    managers.push(manager);
    await manager.connect("pts-default", DEFINITION);

    const state = makeState(manager, "pts-default");
    const result = await executeGetPrompt(state, "pts-default", "greeting");

    expect(result.content[0].text).toContain("Hello, World!");
  });

  it("executeGetPrompt code_review with required+optional args", async () => {
    const manager = new McpServerManager();
    managers.push(manager);
    await manager.connect("pts-review", DEFINITION);

    const state = makeState(manager, "pts-review");
    const result = await executeGetPrompt(state, "pts-review", "code_review", {
      language: "Rust",
      focus: "unsafe blocks",
    });

    expect(result.content[0].text).toContain("Rust");
    expect(result.content[0].text).toContain("unsafe blocks");
  });

  it("executeGetPrompt code_review with optional arg default", async () => {
    const manager = new McpServerManager();
    managers.push(manager);
    await manager.connect("pts-review-dflt", DEFINITION);

    const state = makeState(manager, "pts-review-dflt");
    const result = await executeGetPrompt(state, "pts-review-dflt", "code_review", {
      language: "Go",
    });

    expect(result.content[0].text).toContain("Go");
    expect(result.content[0].text).toContain("correctness");
  });

  it("executeGetPrompt simple has no args and auto-returns", async () => {
    const manager = new McpServerManager();
    managers.push(manager);
    await manager.connect("pts-simple", DEFINITION);

    const state = makeState(manager, "pts-simple");
    const result = await executeGetPrompt(state, "pts-simple", "simple");

    expect(result.content[0].text).toContain(
      "simple no-argument prompt that auto-executes",
    );
  });

  it("slash-command names are server:prompt format", async () => {
    const manager = new McpServerManager();
    managers.push(manager);
    const conn = await manager.connect("pts-fmt", DEFINITION);

    const cmdNames = conn.prompts.map((p) => `pts-fmt:${p.name}`);
    expect(cmdNames).toContain("pts-fmt:greeting");
    expect(cmdNames).toContain("pts-fmt:code_review");
    expect(cmdNames).toContain("pts-fmt:simple");
  });
});
