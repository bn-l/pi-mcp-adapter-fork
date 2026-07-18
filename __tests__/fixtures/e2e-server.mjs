import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const tools = {
  echo: {
    description: "Echo back the input message",
    inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
  },
  add: {
    description: "Add two numbers",
    inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
  },
  get_time: {
    description: "Get current server timestamp",
    inputSchema: { type: "object", properties: {} },
  },
  get_resource: {
    description: "Get a static resource",
    inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
  always_errors: {
    description: "Always returns an error",
    inputSchema: { type: "object", properties: {} },
  },
};

const prompts = {
  greeting: {
    description: "A friendly greeting prompt",
    arguments: [{ name: "name", description: "Name to greet", required: false }],
  },
  code_review: {
    description: "A code review prompt template",
    arguments: [
      { name: "language", description: "Programming language", required: true },
      { name: "focus", description: "Review focus area", required: false },
    ],
  },
  simple: {
    description: "A simple prompt with no arguments",
  },
};

const server = new Server(
  { name: "e2e-test-server", version: "1.0.0" },
  { capabilities: { tools: {}, prompts: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(tools).map(([name, def]) => ({ name, ...def })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "echo") {
    return { content: [{ type: "text", text: "Echo: " + (args?.message ?? "") }] };
  }
  if (name === "add") {
    const sum = Number(args?.a ?? 0) + Number(args?.b ?? 0);
    return { content: [{ type: "text", text: String(sum) }] };
  }
  if (name === "get_time") {
    return { content: [{ type: "text", text: new Date().toISOString() }] };
  }
  if (name === "get_resource") {
    return { content: [{ type: "text", text: "resource:" + (args?.key ?? "default") }] };
  }
  if (name === "always_errors") {
    return { content: [{ type: "text", text: "Intentional error" }], isError: true };
  }

  throw new Error("Unknown tool: " + name);
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: Object.entries(prompts).map(([name, def]) => ({ name, ...def })),
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "greeting") {
    const nameArg = args?.name ?? "World";
    return {
      messages: [
        { role: "user", content: { type: "text", text: `Hello, ${nameArg}! How can I help you today?` } },
      ],
    };
  }
  if (name === "code_review") {
    const lang = args?.language ?? "unknown";
    const focus = args?.focus ?? "general";
    return {
      messages: [
        { role: "user", content: { type: "text", text: `Please review the following ${lang} code focusing on ${focus}.` } },
      ],
    };
  }
  if (name === "simple") {
    return {
      messages: [
        { role: "user", content: { type: "text", text: "This is a simple prompt with no arguments." } },
        { role: "assistant", content: { type: "text", text: "I understand. Let me help with that." } },
      ],
    };
  }

  throw new Error("Unknown prompt: " + name);
});

const transport = new StdioServerTransport();
await server.connect(transport);
