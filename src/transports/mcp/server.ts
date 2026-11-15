/**
 * MCP server（stdio）：工具来自 operations 单一事实源；默认代理常驻 REST
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createBackend } from '../../backend.js';
import { createApp } from '../../app.js';
import { mcpTools, getOperation } from '../../api/operations.js';
import { invoke } from '../../api/dispatch.js';
import { asAliError } from '../../errors/catalog.js';
import { buildMcpTools } from '../../generators/openapi.js';
import { VERSION } from '../../config/schema.js';
import type { AliServiceLike } from '../../service-types.js';

const tools = mcpTools();
const toolSpecs = buildMcpTools();
const toolByName = new Map(tools.map((t) => [t.name, t]));

export async function runMcpServer(): Promise<void> {
  let service: AliServiceLike | null = null;
  let closeBackend: (() => Promise<void>) | null = null;
  const getService = async (): Promise<AliServiceLike> => {
    if (service) return service;
    if ((process.env.ALI_MCP_PROXY ?? 'rest') === 'local') {
      const app = await createApp({ logToStdout: false });
      await app.start();
      service = app.service;
      closeBackend = () => app.close();
      return service;
    }
    const backend = await createBackend({ mode: 'auto' });
    service = backend.service;
    closeBackend = backend.close;
    return service;
  };

  const server = new Server(
    { name: 'ali-client', version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolSpecs.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const tool = toolByName.get(name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: `unknown tool: ${name}` } }) }],
      };
    }
    try {
      const svc = await getService();
      const result = await invoke(svc, getOperation(tool.operationId).id, req.params.arguments ?? {});
      const envelope = {
        ok: true,
        data: result.data,
        meta: { schemaVersion: '1.0', mode: result.mode, cached: result.cached ?? false, warnings: result.warnings ?? [] },
        error: null,
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    } catch (err) {
      const e = asAliError(err);
      const envelope = {
        ok: false,
        data: null,
        meta: { schemaVersion: '1.0' },
        error: { code: e.code, message: e.message, retryable: e.retryable, ...(e.details ? { details: e.details } : {}) },
      };
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on('SIGINT', () => {
    void closeBackend?.().finally(() => process.exit(0));
  });
}
