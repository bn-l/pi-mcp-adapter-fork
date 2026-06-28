import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

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

const server = new Server(
  { name: "e2e-test-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
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

const transport = new StdioServerTransport();
await server.connect(transport);
