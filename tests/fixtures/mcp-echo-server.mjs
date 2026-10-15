/**
 * stdio MCP 服务器的测试夹具。
 * 用于验证 pocketd 的 MCP stdio transport 端到端可用（见 tests/agent.test.ts）。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "echo-probe", version: "1.0.0" });

server.registerTool(
  "shout",
  { title: "Shout", description: "把文本转成大写返回", inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: "text", text: text.toUpperCase() }] }),
);

server.registerTool(
  "add",
  { title: "Add", description: "两数相加", inputSchema: { a: z.number(), b: z.number() } },
  async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
);

await server.connect(new StdioServerTransport());
