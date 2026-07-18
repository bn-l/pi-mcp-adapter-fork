import type { ExtensionAPI, ExtensionCommandContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { McpExtensionState } from "./state.ts";
import type { McpPromptArgument } from "./types.ts";
import { Type } from "typebox";
import { showStatus, showTools, reconnectServers, authenticateServer, logoutServer, openMcpAuthPanel, openMcpPanel, openMcpSetup } from "./commands.ts";
import { loadMcpConfig } from "./config.ts";
import { buildProxyDescription, createDirectToolExecutor, getMissingConfiguredDirectToolServers, resolveDirectTools } from "./direct-tools.ts";
import { flushMetadataCache, initializeMcp, updateStatusBar } from "./init.ts";
import { loadMetadataCache } from "./metadata-cache.ts";
import { executeAuthComplete, executeAuthStart, executeCall, executeConnect, executeDescribe, executeGetPrompt, executeList, executeListPrompts, executeSearch, executeStatus, executeUiMessages } from "./proxy-modes.ts";
import { getConfigPathFromArgv, truncateAtWord } from "./utils.ts";
import { initializeOAuth, shutdownOAuth } from "./mcp-auth-flow.ts";
import { createMcpDirectToolCallRenderer, renderMcpProxyToolCall, renderMcpToolResult } from "./tool-result-renderer.ts";

export default function mcpAdapter(pi: ExtensionAPI) {
  let state: McpExtensionState | null = null;
  let initPromise: Promise<McpExtensionState> | null = null;
  let lifecycleGeneration = 0;

  async function shutdownState(currentState: McpExtensionState | null, reason: string): Promise<void> {
    if (!currentState) return;

    if (currentState.uiServer) {
      currentState.uiServer.close(reason);
      currentState.uiServer = null;
    }

    let flushError: unknown;
    try {
      flushMetadataCache(currentState);
    } catch (error) {
      flushError = error;
    }

    try {
      await currentState.lifecycle.gracefulShutdown();
    } catch (error) {
      if (flushError) {
        console.error("MCP: graceful shutdown failed after metadata flush error", error);
      } else {
        throw error;
      }
    }

    if (flushError) {
      throw flushError;
    }
  }

  // --- MCP prompt slash command registration ---
  const registeredPromptCommands = new Set<string>();

  /**
   * Parse prompt arguments from a raw command-line string.
   * Supports --key=value and --key="value" named args, plus positional args
   * for unfilled required arguments. Adapted from Gemini CLI's McpPromptLoader.
   */
  function parsePromptArgs(rawArgs: string, promptArgs?: McpPromptArgument[]): Record<string, string> | string {
    if (!rawArgs.trim() || !promptArgs || promptArgs.length === 0) {
      return {};
    }

    const argValues: Record<string, string> = {};
    // Named args: --key=value or --key="value"
    const namedArgRegex = /--([^=]+)=(?:"((?:\\.|[^"\\])*)"|([^ ]+))/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    const positionalParts: string[] = [];

    while ((match = namedArgRegex.exec(rawArgs)) !== null) {
      const key = match[1];
      const value = (match[2] ?? match[3]).replace(/\\(.)/g, "$1");
      argValues[key] = value;
      if (match.index > lastIndex) {
        positionalParts.push(rawArgs.substring(lastIndex, match.index));
      }
      lastIndex = namedArgRegex.lastIndex;
    }

    if (lastIndex < rawArgs.length) {
      positionalParts.push(rawArgs.substring(lastIndex));
    }

    const positionalString = positionalParts.join("").trim();
    // Extract quoted or unquoted positional args
    const positionalArgRegex = /(?:"((?:\\.|[^"\\])*)"|([^ ]+))/g;
    const positionalArgs: string[] = [];
    while ((match = positionalArgRegex.exec(positionalString)) !== null) {
      positionalArgs.push((match[1] ?? match[2]).replace(/\\(.)/g, "$1"));
    }

    // Fill named args
    const promptInputs: Record<string, string> = {};
    for (const arg of promptArgs) {
      if (argValues[arg.name] !== undefined) {
        promptInputs[arg.name] = argValues[arg.name];
      }
    }

    // Fill remaining required args positionally
    const unfilled = promptArgs.filter(a => a.required && promptInputs[a.name] === undefined);
    if (unfilled.length === 1) {
      promptInputs[unfilled[0].name] = positionalArgs.join(" ");
    } else {
      for (let i = 0; i < unfilled.length; i++) {
        if (i < positionalArgs.length) {
          promptInputs[unfilled[i].name] = positionalArgs[i];
        } else {
          const missing = unfilled.slice(i).map(a => a.name);
          return `Missing required argument(s): ${missing.map(n => `--${n}`).join(", ")}`;
        }
      }
    }

    // Fill optional args positionally (after required are satisfied)
    const optionals = promptArgs.filter(a => !a.required && promptInputs[a.name] === undefined);
    const positionalIdx = unfilled.length;
    for (let i = 0; i < optionals.length; i++) {
      if (positionalIdx + i < positionalArgs.length) {
        promptInputs[optionals[i].name] = positionalArgs[positionalIdx + i];
      }
    }

    return promptInputs;
  }

  function buildPromptHelp(promptArgs?: McpPromptArgument[]): string {
    if (!promptArgs || promptArgs.length === 0) return "No arguments required.";
    const lines = ["Arguments:"];
    for (const arg of promptArgs) {
      const required = arg.required ? " (required)" : "";
      const desc = arg.description ? ` — ${arg.description}` : "";
      lines.push(`  --${arg.name}${required}${desc}`);
    }
    return lines.join("\n");
  }

  function createPromptCommandHandler(
    serverName: string,
    promptName: string,
    promptArgs?: McpPromptArgument[],
  ) {
    return async (args: string, ctx: ExtensionCommandContext) => {
      if (!state && initPromise) {
        try {
          state = await initPromise;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (ctx.hasUI) ctx.ui.notify(`MCP initialization failed: ${message}`, "error");
          return;
        }
      }
      if (!state) {
        if (ctx.hasUI) ctx.ui.notify("MCP not initialized", "error");
        return;
      }

      const parsed = parsePromptArgs(args, promptArgs);
      if (typeof parsed === "string") {
        if (ctx.hasUI) {
          ctx.ui.notify(`${parsed}\n\n${buildPromptHelp(promptArgs)}`, "error");
        }
        return;
      }

      const result = await executeGetPrompt(state, serverName, promptName, parsed);

      if (result.details?.error) {
        if (ctx.hasUI) {
          const errorText = result.content.find(c => c.type === "text") as { type: "text"; text: string } | undefined;
          ctx.ui.notify(errorText?.text ?? `Failed to get prompt "${promptName}"`, "error");
        }
        return;
      }

      const text = result.content
        .filter(c => c.type === "text")
        .map(c => (c as { type: "text"; text: string }).text)
        .join("\n\n");
      if (ctx.hasUI) {
        ctx.ui.setEditorText(text);
      }
    };
  }

  function syncPromptCommands(currentState: McpExtensionState | null) {
    const newCommands = new Map<string, { description: string; args?: McpPromptArgument[] }>();

    if (currentState) {
      for (const serverName of Object.keys(currentState.config.mcpServers)) {
        const connection = currentState.manager.getConnection(serverName);
        if (!connection || connection.status !== "connected") continue;

        for (const prompt of connection.prompts) {
          const commandName = `${serverName}:${prompt.name}`;
          newCommands.set(commandName, {
            description: prompt.description || `MCP prompt from ${serverName}`,
            args: prompt.arguments,
          });
        }
      }
    }

    // Register current prompt commands (overwrites stale ones)
    for (const [name, info] of newCommands) {
      pi.registerCommand(name, {
        description: info.description,
        handler: createPromptCommandHandler(
          name.split(":")[0],
          name.slice(name.indexOf(":") + 1),
          info.args,
        ),
      });
    }

    // Stale commands: overwrite with "unavailable" handler
    for (const oldName of registeredPromptCommands) {
      if (!newCommands.has(oldName)) {
        pi.registerCommand(oldName, {
          description: "MCP prompt (server unavailable)",
          handler: async (_args, ctx) => {
            if (ctx.hasUI) ctx.ui.notify(`MCP prompt "${oldName}" is not available — server may be disconnected.`, "warning");
          },
        });
      }
    }

    registeredPromptCommands.clear();
    for (const name of newCommands.keys()) registeredPromptCommands.add(name);
  }
  // --- end prompt slash command registration ---

  const earlyConfigPath = getConfigPathFromArgv();
  const earlyConfig = loadMcpConfig(earlyConfigPath);
  const earlyCache = loadMetadataCache();
  const prefix = earlyConfig.settings?.toolPrefix ?? "server";

  const envRaw = process.env.MCP_DIRECT_TOOLS;
  const directSpecs = envRaw === "__none__"
    ? []
    : resolveDirectTools(
        earlyConfig,
        earlyCache,
        prefix,
        envRaw?.split(",").map(s => s.trim()).filter(Boolean),
      );
  const missingConfiguredDirectToolServers = getMissingConfiguredDirectToolServers(earlyConfig, earlyCache);
  const shouldRegisterProxyTool =
    earlyConfig.settings?.disableProxyTool !== true
    || directSpecs.length === 0
    || missingConfiguredDirectToolServers.length > 0;

  for (const spec of directSpecs) {
    (pi.registerTool as (tool: unknown) => unknown)({
      name: spec.prefixedName,
      label: `MCP: ${spec.originalName}`,
      description: spec.description || "(no description)",
      promptSnippet: truncateAtWord(spec.description, 100) || `MCP tool from ${spec.serverName}`,
      parameters: Type.Unsafe((spec.inputSchema || { type: "object", properties: {} }) as never),
      execute: createDirectToolExecutor(() => state, () => initPromise, spec),
      renderCall: createMcpDirectToolCallRenderer(spec.prefixedName),
      renderResult: renderMcpToolResult,
    });
  }

  // Bootstrap prompt commands from metadata cache at load time so they
  // appear in slash-command autocomplete before servers connect.
  if (earlyCache) {
    for (const [serverName, entry] of Object.entries(earlyCache.servers)) {
      if (!earlyConfig.mcpServers[serverName]) continue;
      for (const prompt of entry.prompts ?? []) {
        const commandName = `${serverName}:${prompt.name}`;
        pi.registerCommand(commandName, {
          description: prompt.description || `MCP prompt from ${serverName}`,
          handler: createPromptCommandHandler(
            serverName,
            prompt.name,
            prompt.arguments?.map(a => ({
              name: a.name,
              description: a.description,
              required: a.required,
            })) as McpPromptArgument[] | undefined,
          ),
        });
        registeredPromptCommands.add(commandName);
      }
    }
  }

  const getPiTools = (): ToolInfo[] => pi.getAllTools();

  pi.registerFlag("mcp-config", {
    description: "Path to MCP config file",
    type: "string",
  });

  pi.on("session_start", async (_event, ctx) => {
    const generation = ++lifecycleGeneration;
    const previousState = state;
    state = null;
    initPromise = null;

    try {
      await Promise.all([
        shutdownState(previousState, "session_restart"),
        shutdownOAuth(),
      ]);
    } catch (error) {
      console.error("MCP: failed to shut down previous session state", error);
    }

    if (generation !== lifecycleGeneration) {
      return;
    }

    await initializeOAuth().catch(err => {
      console.error("MCP OAuth initialization failed:", err);
    });

    try {
      const nextState = await initializeMcp(pi, ctx);
      if (generation !== lifecycleGeneration) {
        await shutdownState(nextState, "stale_session_start").catch(() => {});
        return;
      }
      state = nextState;
      updateStatusBar(nextState);
      syncPromptCommands(nextState);
    } catch (err) {
      if (generation !== lifecycleGeneration) return;
      console.error("MCP initialization failed:", err);
    }
    initPromise = null;
  });

  pi.on("session_shutdown", async () => {
    ++lifecycleGeneration;
    const currentState = state;
    state = null;
    initPromise = null;

    try {
      await Promise.all([
        shutdownState(currentState, "session_shutdown"),
        shutdownOAuth(),
      ]);
    } catch (error) {
      console.error("MCP: session shutdown cleanup failed", error);
    }

    // Mark all prompt commands as unavailable
    for (const oldName of registeredPromptCommands) {
      pi.registerCommand(oldName, {
        description: "MCP prompt (server unavailable)",
        handler: async (_args, ctx) => {
          if (ctx.hasUI) ctx.ui.notify(`MCP prompt "${oldName}" is not available — server may be disconnected.`, "warning");
        },
      });
    }
    registeredPromptCommands.clear();
  });

  pi.registerCommand("mcp", {
    description: "Show MCP server status",
    handler: async (args, ctx) => {
      if (!state && initPromise) {
        try {
          state = await initPromise;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (ctx.hasUI) ctx.ui.notify(`MCP initialization failed: ${message}`, "error");
          return;
        }
      }
      if (!state) {
        if (ctx.hasUI) ctx.ui.notify("MCP not initialized", "error");
        return;
      }

      const parts = args?.trim()?.split(/\s+/) ?? [];
      const subcommand = parts[0] ?? "";
      const targetServer = parts[1];
      const rest = parts.slice(1).join(" ");

      switch (subcommand) {
        case "reconnect":
          await reconnectServers(state, ctx, targetServer);
          break;
        case "tools":
          await showTools(state, ctx);
          break;
        case "setup": {
          const result = await openMcpSetup(state, pi, ctx, earlyConfigPath, "setup");
          if (result?.configChanged) {
            await ctx.reload();
            return;
          }
          break;
        }
        case "logout": {
          const serverName = rest;
          if (!serverName) {
            if (ctx.hasUI) ctx.ui.notify("Usage: /mcp logout <server>", "error");
            return;
          }
          await logoutServer(serverName, state, ctx);
          break;
        }
        case "status":
        case "":
        default:
          if (ctx.hasUI) {
            const result = await openMcpPanel(state, pi, ctx, earlyConfigPath);
            if (result?.configChanged) {
              await ctx.reload();
              return;
            }
          } else {
            await showStatus(state, ctx);
          }
          break;
      }
    },
  });

  pi.registerCommand("mcp-auth", {
    description: "Authenticate with an MCP server (OAuth)",
    handler: async (args, ctx) => {
      const serverName = args?.trim();
      if (!serverName && !ctx.hasUI) {
        return;
      }

      if (!state && initPromise) {
        try {
          state = await initPromise;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (ctx.hasUI) ctx.ui.notify(`MCP initialization failed: ${message}`, "error");
          return;
        }
      }
      if (!state) {
        if (ctx.hasUI) ctx.ui.notify("MCP not initialized", "error");
        return;
      }

      if (!serverName) {
        await openMcpAuthPanel(state, pi, ctx, earlyConfigPath);
        return;
      }

      await authenticateServer(serverName, state.config, ctx);
    },
  });

  if (shouldRegisterProxyTool) {
    (pi.registerTool as (tool: unknown) => unknown)({
      name: "mcp",
      label: "MCP",
      description: buildProxyDescription(earlyConfig, earlyCache, directSpecs),
      promptSnippet: "MCP gateway - connect to MCP servers and call their tools",
      renderCall: renderMcpProxyToolCall,
      parameters: Type.Object({
        tool: Type.Optional(Type.String({ description: "Tool name to call (e.g., 'xcodebuild_list_sims')" })),
        args: Type.Optional(Type.String({ description: "Arguments as JSON string (e.g., '{\"key\": \"value\"}')" })),
        connect: Type.Optional(Type.String({ description: "Server name to connect (lazy connect + metadata refresh)" })),
        describe: Type.Optional(Type.String({ description: "Tool name to describe (shows parameters)" })),
        search: Type.Optional(Type.String({ description: "Search tools by name/description" })),
        regex: Type.Optional(Type.Boolean({ description: "Treat search as regex (default: substring match)" })),
        includeSchemas: Type.Optional(Type.Boolean({ description: "Include parameter schemas in search results (default: true)" })),
        server: Type.Optional(Type.String({ description: "Filter to specific server (also disambiguates tool calls)" })),
        action: Type.Optional(Type.String({ description: "Action: 'ui-messages', 'auth-start', or 'auth-complete'" })),
        listPrompts: Type.Optional(Type.String({ description: "List prompts from a server (requires server param)" })),
        getPrompt: Type.Optional(Type.String({ description: "Get a prompt by name from a server (requires server param)" })),
      }),
      renderResult: renderMcpToolResult,
      async execute(_toolCallId, params: {
        tool?: string;
        args?: string;
        connect?: string;
        describe?: string;
        search?: string;
        regex?: boolean;
        includeSchemas?: boolean;
        server?: string;
        action?: string;
        listPrompts?: string;
        getPrompt?: string;
      }, _signal, _onUpdate, _ctx) {
        let parsedArgs: Record<string, unknown> | undefined;
        if (params.args) {
          try {
            parsedArgs = JSON.parse(params.args);
            if (typeof parsedArgs !== "object" || parsedArgs === null || Array.isArray(parsedArgs)) {
              const gotType = Array.isArray(parsedArgs) ? "array" : parsedArgs === null ? "null" : typeof parsedArgs;
              throw new Error(`Invalid args: expected a JSON object, got ${gotType}`);
            }
          } catch (error) {
            if (error instanceof SyntaxError) {
              throw new Error(`Invalid args JSON: ${error.message}`, { cause: error });
            }
            throw error;
          }
        }

        if (!state && initPromise) {
          try {
            state = await initPromise;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text" as const, text: `MCP initialization failed: ${message}` }],
              details: { error: "init_failed", message },
            };
          }
        }
        if (!state) {
          return {
            content: [{ type: "text" as const, text: "MCP not initialized" }],
            details: { error: "not_initialized" },
          };
        }

        if (params.action === "ui-messages") {
          return executeUiMessages(state);
        }
        if (params.action === "auth-start") {
          if (!params.server) {
            return {
              content: [{ type: "text" as const, text: "auth-start requires `server`. Example: mcp({ action: \"auth-start\", server: \"linear-server\" })" }],
              details: { mode: "auth-start", error: "missing_server" },
            };
          }
          return executeAuthStart(state, params.server);
        }
        if (params.action === "auth-complete") {
          if (!params.server) {
            return {
              content: [{ type: "text" as const, text: "auth-complete requires `server`." }],
              details: { mode: "auth-complete", error: "missing_server" },
            };
          }
          const input = parsedArgs?.redirectUrl ?? parsedArgs?.code ?? parsedArgs?.input;
          if (typeof input !== "string" || input.trim().length === 0) {
            return {
              content: [{ type: "text" as const, text: "auth-complete requires args with `redirectUrl`, `code`, or `input`." }],
              details: { mode: "auth-complete", error: "missing_input" },
            };
          }
          return executeAuthComplete(state, params.server, input);
        }
        if (params.listPrompts) {
          return executeListPrompts(state, params.listPrompts);
        }
        if (params.getPrompt) {
          if (!params.server) {
            return {
              content: [{ type: "text" as const, text: "getPrompt requires `server`. Example: mcp({ getPrompt: \"greeting\", server: \"my-server\" })" }],
              details: { mode: "get-prompt", error: "missing_server" },
            };
          }
          const promptArgs = parsedArgs as Record<string, string> | undefined;
          return executeGetPrompt(state, params.server, params.getPrompt, promptArgs);
        }
        if (params.tool) {
          return executeCall(state, params.tool, parsedArgs, params.server, getPiTools);
        }
        if (params.connect) {
          return executeConnect(state, params.connect);
        }
        if (params.describe) {
          return executeDescribe(state, params.describe);
        }
        if (params.search) {
          return executeSearch(state, params.search, params.regex, params.server, params.includeSchemas);
        }
        if (params.server) {
          return executeList(state, params.server);
        }
        return executeStatus(state);
      },
    });
  }
}
