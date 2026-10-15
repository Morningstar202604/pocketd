import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { join } from "node:path";
import { jsonSchema, tool, type JSONSchema7, type ToolSet } from "ai";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { HOME_DIR, WORKSPACE } from "./runtime.js";
import type { ApprovalBroker, ApprovalRequest } from "./permissions.js";

export interface MCPServerConfig {
  name: string;
  type: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

interface ConnectedServer {
  config: MCPServerConfig;
  client: Client;
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>;
}

const MCP_FILE = join(HOME_DIR, "state", "mcp.json");
const CLIENT_INFO = { name: "pocketd", version: "2.0.0" };

export function sanitizeFunctionName(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
  return cleaned.slice(0, 64);
}

export function mcpToolName(server: string, toolName: string): string {
  return sanitizeFunctionName(`mcp__${server}__${toolName}`);
}

export class MCPManager {
  private servers = new Map<string, ConnectedServer>();
  private errors = new Map<string, string>();

  constructor(private readonly broker: ApprovalBroker) {}

  async loadConfigs(): Promise<MCPServerConfig[]> {
    if (!existsSync(MCP_FILE)) return [];
    try {
      const parsed = JSON.parse(await readFile(MCP_FILE, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (s): s is MCPServerConfig =>
          s && typeof s.name === "string" && (s.type === "http" || s.type === "stdio"),
      );
    } catch {
      return [];
    }
  }

  async saveConfigs(configs: MCPServerConfig[]): Promise<void> {
    await mkdir(join(HOME_DIR, "state"), { recursive: true });
    await writeFile(MCP_FILE, JSON.stringify(configs, null, 2), "utf8");
  }

  private buildTransport(cfg: MCPServerConfig): Transport {
    if (cfg.type === "stdio") {
      if (!cfg.command) throw new Error(`MCP ${cfg.name}: 缺少 command`);
      return new StdioClientTransport({
        command: cfg.command,
        args: cfg.args ?? [],
        env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
        cwd: WORKSPACE,
        stderr: "pipe",
      });
    }
    if (!cfg.url) throw new Error(`MCP ${cfg.name}: 缺少 url`);
    return new StreamableHTTPClientTransport(new URL(cfg.url));
  }

  async connect(cfg: MCPServerConfig): Promise<{ name: string; tools: number; error?: string }> {
    await this.disconnect(cfg.name);
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    try {
      await client.connect(this.buildTransport(cfg));
      const listed = await client.listTools();
      const tools = (listed.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      this.servers.set(cfg.name, { config: cfg, client, tools });
      this.errors.delete(cfg.name);
      return { name: cfg.name, tools: tools.length };
    } catch (err) {
      const message = (err as Error).message;
      this.errors.set(cfg.name, message);
      try {
        await client.close();
      } catch {
        /* 连接未建立，关闭失败无需处理 */
      }
      return { name: cfg.name, tools: 0, error: message };
    }
  }

  async disconnect(name: string): Promise<void> {
    const entry = this.servers.get(name);
    if (!entry) return;
    this.servers.delete(name);
    try {
      await entry.client.close();
    } catch {
      /* 进程可能已退出 */
    }
  }

  async reloadAll(): Promise<Array<{ name: string; tools: number; error?: string }>> {
    const configs = await this.loadConfigs();
    for (const name of [...this.servers.keys()]) await this.disconnect(name);
    const results = [];
    for (const cfg of configs) {
      if (!cfg.enabled) continue;
      results.push(await this.connect(cfg));
    }
    return results;
  }

  describe(): Array<{ name: string; type: string; enabled: boolean; toolCount: number; error?: string }> {
    return [...this.servers.values()].map((s) => ({
      name: s.config.name,
      type: s.config.type,
      enabled: s.config.enabled,
      toolCount: s.tools.length,
    }));
  }

  status(): Array<{ name: string; error: string }> {
    return [...this.errors.entries()].map(([name, error]) => ({ name, error }));
  }

  get toolCount(): number {
    let n = 0;
    for (const s of this.servers.values()) n += s.tools.length;
    return n;
  }

  async buildTools(ctx: {
    onApprovalRequest: (req: ApprovalRequest) => void;
    runId: string;
  }): Promise<ToolSet> {
    const set: Record<string, unknown> = {};
    for (const [serverName, entry] of this.servers) {
      if (!entry.config.enabled) continue;
      for (const t of entry.tools) {
        const name = mcpToolName(serverName, t.name);
        set[name] = tool({
          description: `[MCP:${serverName}] ${t.description ?? t.name}`,
          inputSchema: jsonSchema<Record<string, unknown>>(t.inputSchema as JSONSchema7),
          execute: async (args: Record<string, unknown>) => {
            const guard = await this.broker.evaluate(
              name,
              { server: serverName, tool: t.name, args },
              ctx.onApprovalRequest,
              ctx.runId,
            );
            if (!guard.approved) return `「已拒绝」${guard.reason}`;
            try {
              const result = await entry.client.callTool({ name: t.name, arguments: args });
              const content = (result as { content?: unknown }).content;
              if (Array.isArray(content)) {
                return content
                  .map((c) => {
                    const part = c as { type?: string; text?: string };
                    return part.type === "text" && typeof part.text === "string"
                      ? part.text
                      : JSON.stringify(c).slice(0, 2000);
                  })
                  .join("\n")
                  .slice(0, 30_000);
              }
              return JSON.stringify(result).slice(0, 30_000);
            } catch (err) {
              return `MCP 调用失败 (${serverName}/${t.name}): ${(err as Error).message}`;
            }
          },
        });
      }
    }
    return set as ToolSet;
  }
}
