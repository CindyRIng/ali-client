/**
 * REST 服务器（node:http）：路由 / 鉴权 / envelope / 文档端点
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../../config/schema.js';
import type { Logger } from '../../utils/logger.js';
import type { AliServiceLike } from '../../service-types.js';
import { OPERATIONS, type OperationDef } from '../../api/operations.js';
import { invoke } from '../../api/dispatch.js';
import { AliError, asAliError } from '../../errors/catalog.js';
import { failureEnvelope, successEnvelope } from '../../schemas/envelope.js';
import { buildDocsHtml } from './docs.js';
import { buildMcpTools, buildOpenApi } from '../../generators/openapi.js';

const ROUTES: Array<{ op: OperationDef; regex: RegExp; keys: string[] }> = OPERATIONS.map((op) => {
  const keys: string[] = [];
  const pattern = op.rest.path.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { op, regex: new RegExp(`^${pattern}$`), keys };
});

const SPECIAL_GET = new Set(['/docs', '/openapi.json', '/mcp-tools.json', '/v1/verification/screenshot']);

function requestId(): string {
  return `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent || res.writableEnded) return;
  const body = JSON.stringify(payload, null, 2);
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.destroy();
  }
}

function readBody(req: http.IncomingMessage, limit = 2_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new AliError('INVALID_ARGUMENT', 'request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function authorized(req: http.IncomingMessage, url: URL, config: Config, op?: OperationDef): boolean {
  if (op && op.auth === 'none') return true;
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const queryToken = url.searchParams.get('token');
  const cookieToken = parseCookies(req).ali_token;
  const token = bearer ?? queryToken ?? cookieToken;
  return token === config.apiToken;
}

export function createRestServer(opts: {
  config: Config;
  service: AliServiceLike;
  logger: Logger;
}): http.Server {
  const { config, service, logger } = opts;
  let docsCache: string | null = null;
  const toolsJson = JSON.stringify(buildMcpTools(), null, 2);
  const openapiJson = JSON.stringify(buildOpenApi(), null, 2);

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const reqId = requestId();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${config.host}:${config.port}`}`);
    const method = (req.method ?? 'GET').toUpperCase();
    try {
      if (method === 'GET' && url.pathname === '/docs') {
        docsCache ??= buildDocsHtml(config);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(docsCache);
        return;
      }
      if (method === 'GET' && url.pathname === '/openapi.json') {
        sendJson(res, 200, JSON.parse(openapiJson) as unknown);
        return;
      }
      if (method === 'GET' && url.pathname === '/mcp-tools.json') {
        sendJson(res, 200, JSON.parse(toolsJson) as unknown);
        return;
      }
      if (method === 'GET' && url.pathname === '/v1/verification/screenshot') {
        if (!authorized(req, url, config)) throw new AliError('UNAUTHENTICATED', 'invalid token');
        const p = url.searchParams.get('path') ?? '';
        const runDir = path.resolve(config.dataDir, 'run');
        const target = p ? path.resolve(p) : '';
        let buf: Buffer;
        try {
          const stat = target ? fs.statSync(target) : null;
          if (!stat || !stat.isFile() || !target.startsWith(runDir + path.sep)) {
            throw new AliError('NOT_FOUND', 'screenshot not found');
          }
          buf = fs.readFileSync(target);
        } catch (err) {
          if (err instanceof AliError) throw err;
          throw new AliError('NOT_FOUND', 'screenshot not found');
        }
        if (!res.headersSent) {
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
          res.end(buf);
        }
        return;
      }
      // 特殊路由：GET /v1/suppliers/by-store/{store}（供应商店铺子域入口）
      const byStore = /^\/v1\/suppliers\/by-store\/([a-z0-9][a-z0-9-]{1,60})$/.exec(url.pathname);
      if (byStore && method === 'GET') {
        if (!authorized(req, url, config)) throw new AliError('UNAUTHENTICATED', 'invalid token');
        const result = await invoke(service, 'suppliers.detail', {
          store: byStore[1],
          refresh: url.searchParams.get('refresh') === 'true',
        });
        const payload = successEnvelope(result.data, {
          requestId: reqId,
          tookMs: Date.now() - started,
          cached: result.cached ?? false,
          mode: result.mode ?? service.mode(),
          warnings: result.warnings ?? [],
        });
        res.setHeader('x-request-id', reqId);
        sendJson(res, 200, payload);
        return;
      }
      // 路由匹配（区分 404 / 405）
      let matched: { op: OperationDef; params: Record<string, string> } | null = null;
      let pathMatched = false;
      for (const route of ROUTES) {
        const m = route.regex.exec(url.pathname);
        if (!m) continue;
        pathMatched = true;
        if (route.op.rest.method !== method) continue;
        const params: Record<string, string> = {};
        route.keys.forEach((k, i) => {
          params[k] = decodeURIComponent(m[i + 1]);
        });
        matched = { op: route.op, params };
        break;
      }
      if (!matched) {
        if (pathMatched || SPECIAL_GET.has(url.pathname)) {
          throw new AliError('METHOD_NOT_ALLOWED', `method ${method} not allowed for ${url.pathname}`);
        }
        throw new AliError('NOT_FOUND', `no route for ${method} ${url.pathname}`);
      }
      if (!authorized(req, url, config, matched.op)) throw new AliError('UNAUTHENTICATED', 'invalid token');
      const query: Record<string, unknown> = {};
      for (const [k, v] of url.searchParams) query[k] = v;
      let body: unknown = {};
      const contentType = (req.headers['content-type'] ?? '').toLowerCase();
      if (method === 'POST' || method === 'DELETE') {
        const raw = await readBody(req);
        if (raw) {
          if (contentType.includes('application/json') || raw.trim().startsWith('{')) {
            try {
              body = JSON.parse(raw);
            } catch {
              throw new AliError('INVALID_ARGUMENT', 'invalid JSON body');
            }
          } else {
            body = Object.fromEntries(new URLSearchParams(raw));
          }
        }
      }
      const input = matched.op.rest.body
        ? { ...matched.params, ...(typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}) }
        : { ...matched.params, ...query };
      const result = await invoke(service, matched.op.id, input);
      const payload = successEnvelope(result.data, {
        requestId: reqId,
        tookMs: Date.now() - started,
        cached: result.cached ?? false,
        mode: result.mode ?? service.mode(),
        warnings: result.warnings ?? [],
        ...(typeof (result.data as { queryId?: unknown })?.queryId === 'string'
          ? { queryId: (result.data as { queryId: string }).queryId }
          : {}),
      });
      res.setHeader('x-request-id', reqId);
      res.setHeader('x-ali-cached', String(payload.meta.cached));
      sendJson(res, 200, payload);
      logger.info('rest.ok', { op: matched.op.id, ms: Date.now() - started, cached: payload.meta.cached });
    } catch (err) {
      try {
        const e = asAliError(err);
        const payload = failureEnvelope(
          { code: e.code, message: e.message, retryable: e.retryable, ...(e.retryAfterMs ? { retryAfterMs: e.retryAfterMs } : {}), ...(e.details ? { details: e.details } : {}) },
          { requestId: reqId, tookMs: Date.now() - started, mode: service.mode() },
        );
        if (!res.headersSent) res.setHeader('x-request-id', reqId);
        if (e.retryAfterMs && !res.headersSent) res.setHeader('retry-after', String(Math.ceil(e.retryAfterMs / 1000)));
        logger.warn('rest.error', { op: url.pathname, code: e.code, message: e.message.slice(0, 200), ms: Date.now() - started });
        sendJson(res, e.httpStatus, payload);
      } catch (sendErr) {
        logger.error('rest.error_unhandled', { op: url.pathname, message: (sendErr as Error).message.slice(0, 300) });
        try {
          if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
        } catch {
          /* ignore */
        }
        res.destroy();
      }
    }
  });
  return server;
}
