/**
 * 契约生成：OpenAPI 3.1 / MCP tools / CLI commands（由 OPERATIONS 单一事实源生成）
 */
import { z } from 'zod';
import { OPERATIONS, mcpTools, cliCommands, type OperationDef } from '../api/operations.js';
import { toJsonSchema } from './json-schema.js';
import { VERSION } from '../config/schema.js';

function zodSchemaForInput(op: OperationDef): z.ZodTypeAny {
  if (op.rest.body) return op.rest.body;
  if (op.rest.query && op.rest.pathParams) return z.object({});
  if (op.rest.query) return op.rest.query;
  return op.input;
}

function openApiPath(op: OperationDef): string {
  return op.rest.path;
}

export interface OpenApiDocument {
  openapi: string;
  info: Record<string, unknown>;
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, unknown>;
}

export function buildOpenApi(): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const path = openApiPath(op);
    const method = op.rest.method.toLowerCase();
    const parameters: Array<Record<string, unknown>> = [];
    if (op.rest.pathParams) {
      const shape = (op.rest.pathParams as z.ZodObject<z.ZodRawShape>).shape as Record<string, z.ZodTypeAny>;
      for (const [name, schema] of Object.entries(shape)) {
        parameters.push({ name, in: 'path', required: true, schema: toJsonSchema(schema, 'input') });
      }
    }
    const entry: Record<string, unknown> = {
      operationId: op.id,
      summary: op.summary,
      tags: [op.id.split('.')[0]],
      security: op.auth === 'bearer' ? [{ bearerAuth: [] }] : [],
      responses: {
        '200': {
          description: 'Success envelope',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean' },
                  data: toJsonSchema(op.output, 'output'),
                  meta: { type: 'object' },
                  error: { type: 'object', nullable: true },
                },
              },
            },
          },
        },
        default: { description: 'Failure envelope' },
      },
    };
    if (op.rest.query) {
      const schema = toJsonSchema(op.rest.query, 'input');
      const props = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
      for (const [name, propSchema] of Object.entries(props)) {
        parameters.push({ name, in: 'query', required: (schema.required as string[] | undefined)?.includes(name) ?? false, schema: propSchema });
      }
    }
    if (op.rest.body) {
      entry.requestBody = {
        required: true,
        content: { 'application/json': { schema: toJsonSchema(op.rest.body, 'input') } },
      };
    }
    if (parameters.length) entry.parameters = parameters;
    paths[path] = { ...(paths[path] ?? {}), [method]: entry };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'ali-client REST API',
      version: VERSION,
      description:
        '阿里国际站 alibaba.com 本机只读客户端：供应商搜索 / 公司详情 / 地区字典 / 会员识别（CLI / REST / MCP / SKILL）。',
    },
    servers: [{ url: 'http://127.0.0.1:8792' }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    },
  };
}

export interface McpToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; openWorldHint: boolean };
}

export function buildMcpTools(): McpToolSpec[] {
  return mcpTools().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toJsonSchema(t.input, 'input'),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }));
}

export interface CliCommandSpec {
  command: string;
  description: string;
  example?: string;
  operationId: string;
}

export function buildCliCommands(): CliCommandSpec[] {
  return cliCommands();
}

export { zodSchemaForInput };
