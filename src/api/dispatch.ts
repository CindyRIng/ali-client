/**
 * 操作分发：REST/CLI/MCP → AliServiceLike
 */
import type { AliServiceLike, Mode, OpResult } from '../service-types.js';
import type { LoginStartRequest, VerificationSolveRequest } from '../domain/session.js';
import type { SearchSuppliersRequest } from '../domain/query.js';
import type { CacheClearQuerySchema } from '../domain/cache.js';
import { getOperation } from './operations.js';
import type { z } from 'zod';

export interface InvocationInput {
  pathParams?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface InvocationResult {
  data: unknown;
  cached?: boolean;
  mode?: Mode;
  warnings?: string[];
}

export function asBool(v: unknown): boolean {
  return v === true || v === 'true';
}

/** 把 REST 的 path/query/body 合成为 op 输入（交给 zod 校验/转换） */
export function composeRestInput(operationId: string, input: InvocationInput): unknown {
  const op = getOperation(operationId);
  const { pathParams = {}, query = {}, body = {} } = input;
  if (op.rest.body) {
    if (op.rest.pathParams) {
      return { ...pathParams, ...(typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}) };
    }
    return body;
  }
  return { ...pathParams, ...query };
}

export async function invoke(service: AliServiceLike, operationId: string, rawInput: unknown): Promise<InvocationResult> {
  const op = getOperation(operationId);
  const parsed = (await op.input.parseAsync(rawInput ?? {})) as Record<string, unknown>;
  switch (operationId) {
    case 'health.get':
      return { data: await service.health(), mode: service.mode() };
    case 'status.get':
      return { data: await service.status(), mode: service.mode() };
    case 'session.login.start':
      return { data: await service.loginStart(parsed as unknown as LoginStartRequest), mode: service.mode() };
    case 'session.login.status':
      return { data: await service.loginStatus(String(parsed.loginId)), mode: service.mode() };
    case 'session.login.cancel':
      return { data: await service.loginCancel(String(parsed.loginId)), mode: service.mode() };
    case 'verification.get':
      return { data: await service.verificationGet(), mode: service.mode() };
    case 'verification.solve':
      return { data: await service.verificationSolve(parsed as unknown as VerificationSolveRequest), mode: service.mode() };
    case 'regions.list':
      return { data: await Promise.resolve(service.regions({ level: parsed.level as never, province: parsed.province as string | undefined })), mode: service.mode() };
    case 'regions.search':
      return { data: await Promise.resolve(service.regionSearch(String(parsed.q), Number(parsed.limit ?? 20))), mode: service.mode() };
    case 'search.suppliers': {
      const r = await service.searchSuppliers(parsed as unknown as SearchSuppliersRequest);
      const warnings: string[] = [];
      if (r.data.location.mode === 'keyword') warnings.push('location_mode_keyword_fuzzy');
      if (r.data.stats.enrichLimitReached) warnings.push('enrich_limit_reached');
      if (r.data.location.unknownLocation > 0) warnings.push(`unknown_location:${r.data.location.unknownLocation}`);
      return { data: r.data, cached: r.cached, mode: r.mode, warnings };
    }
    case 'suppliers.list': {
      const r = await service.listSuppliers({
        queryId: String(parsed.queryId),
        page: Number(parsed.page),
        refresh: asBool(parsed.refresh),
      });
      return { data: r.data, cached: r.cached, mode: r.mode };
    }
    case 'suppliers.detail': {
      const r = await service.supplierDetail({
        companyId: parsed.companyId as string | undefined,
        store: parsed.store as string | undefined,
        refresh: asBool(parsed.refresh),
      });
      return { data: r.data, cached: r.cached, mode: r.mode };
    }
    case 'factories.list': {
      const r = await service.factories({
        province: parsed.province as string | undefined,
        categoryId: String(parsed.categoryId),
        page: Number(parsed.page),
        pageSize: Number(parsed.pageSize),
        refresh: asBool(parsed.refresh),
      });
      return { data: r.data, cached: r.cached, mode: r.mode };
    }
    case 'memberships.catalog':
      return { data: await Promise.resolve(service.memberships()), mode: service.mode() };
    case 'cache.stats':
      return { data: await service.cacheStats(), mode: service.mode() };
    case 'cache.clear':
      return { data: await service.cacheClear(parsed as z.infer<typeof CacheClearQuerySchema>), mode: service.mode() };
    default:
      throw new Error(`unknown operation: ${operationId}`);
  }
}

export async function invokeWithService(service: AliServiceLike, operationId: string, input: InvocationInput): Promise<InvocationResult> {
  const raw = composeRestInput(operationId, input);
  return invoke(service, operationId, raw);
}

export type { OpResult };
