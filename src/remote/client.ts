/**
 * 远程 REST 客户端（CLI / MCP 默认代理到常驻 owner，避免浏览器/profile 冲突）
 */
import type { Config } from '../config/schema.js';
import { AliError } from '../errors/catalog.js';
import type { AliServiceLike, Mode, OpResult } from '../service-types.js';
import type { Status } from '../domain/status.js';
import type {
  LoginStatus,
  VerificationSolveRequest,
  VerificationSolveResponse,
  VerificationStatus,
} from '../domain/session.js';
import type { CacheClearResultSchema, CacheStats } from '../domain/cache.js';
import type { RegionsResponseSchema, RegionSearchResponseSchema } from '../domain/region.js';
import type { SearchSuppliersResponse, SuppliersListResponse } from '../domain/query.js';
import type { SupplierDetail } from '../domain/supplier.js';
import type { FactoriesResponseSchema } from '../domain/factories.js';
import type { MembershipCatalog } from '../domain/membership.js';
import type { z } from 'zod';
import type { Envelope } from '../schemas/envelope.js';

export class RemoteAliClient implements AliServiceLike {
  private modeValue: Mode = 'anonymous';

  constructor(
    private readonly config: Config,
    private readonly baseUrl: string = config.clientUrl ?? `http://${config.host}:${config.port}`,
  ) {}

  mode(): Mode {
    return this.modeValue;
  }

  private async request<T>(method: 'GET' | 'POST' | 'DELETE', pathname: string, body?: unknown): Promise<OpResult<T>> {
    const url = new URL(pathname, this.baseUrl);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.config.apiToken}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.config.session.clientTimeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/timeout|aborted|abort/i.test(msg)) {
        throw new AliError(
          'UPSTREAM_TIMEOUT',
          `REST 请求超时（${Math.round(this.config.session.clientTimeoutMs / 1000)}s）：服务可能正在处理长查询（strict 回填较慢），可稍后重试或降低 pages/maxEnrich`,
          { cause: err },
        );
      }
      throw new AliError('SERVICE_UNAVAILABLE', `ali-client REST 服务不可达：${this.baseUrl}（检查 systemctl --user status ali-client）`, { cause: err });
    }
    let payload: Envelope<T>;
    try {
      payload = (await resp.json()) as Envelope<T>;
    } catch {
      throw new AliError('UPSTREAM_ERROR', `invalid REST response (${resp.status})`);
    }
    if (payload.ok !== true || payload.error) {
      const e = payload.error;
      if (!e) throw new AliError('INTERNAL_ERROR', 'unexpected REST envelope');
      const message =
        e.code === 'UNAUTHENTICATED'
          ? `REST 鉴权失败：ALI_API_TOKEN 与常驻服务不一致（检查 ${this.baseUrl} 的 .env / ALI_ENV_FILE）`
          : e.message;
      throw new AliError(e.code, message, { details: e.details, retryAfterMs: e.retryAfterMs });
    }
    if (payload.meta.mode) this.modeValue = payload.meta.mode;
    return { data: payload.data, cached: payload.meta.cached, mode: payload.meta.mode };
  }

  async health(): Promise<{ service: 'ali-client'; status: 'ok'; version: string; uptimeMs: number }> {
    return (await this.request<{ service: 'ali-client'; status: 'ok'; version: string; uptimeMs: number }>('GET', '/v1/health')).data;
  }

  async status(): Promise<Status> {
    return (await this.request<Status>('GET', '/v1/status')).data;
  }

  async loginStart(req: { mode?: 'manual' }): Promise<LoginStatus> {
    return (await this.request<LoginStatus>('POST', '/v1/session/login', req)).data;
  }

  async loginStatus(loginId: string): Promise<LoginStatus> {
    const q = new URLSearchParams({ loginId }).toString();
    return (await this.request<LoginStatus>('GET', `/v1/session/login/status?${q}`)).data;
  }

  async loginCancel(loginId: string): Promise<{ cancelled: true; loginId: string }> {
    return (await this.request<{ cancelled: true; loginId: string }>('DELETE', `/v1/session/login/${encodeURIComponent(loginId)}`)).data;
  }

  async verificationGet(): Promise<VerificationStatus> {
    return (await this.request<VerificationStatus>('GET', '/v1/verification')).data;
  }

  async verificationSolve(req: VerificationSolveRequest): Promise<VerificationSolveResponse> {
    return (await this.request<VerificationSolveResponse>('POST', '/v1/verification/solve', req)).data;
  }

  async regions(input: { level?: 'province' | 'city'; province?: string }): Promise<z.infer<typeof RegionsResponseSchema>> {
    const q = new URLSearchParams();
    if (input.level) q.set('level', input.level);
    if (input.province) q.set('province', input.province);
    const suffix = q.size ? `?${q.toString()}` : '';
    return (await this.request<z.infer<typeof RegionsResponseSchema>>('GET', `/v1/regions${suffix}`)).data;
  }

  async regionSearch(q: string, limit = 20): Promise<z.infer<typeof RegionSearchResponseSchema>> {
    const params = new URLSearchParams({ q, limit: String(limit) });
    return (await this.request<z.infer<typeof RegionSearchResponseSchema>>('GET', `/v1/regions/search?${params.toString()}`)).data;
  }

  async memberships(): Promise<MembershipCatalog> {
    return (await this.request<MembershipCatalog>('GET', '/v1/meta/memberships')).data;
  }

  async cacheStats(): Promise<CacheStats> {
    return (await this.request<CacheStats>('GET', '/v1/cache/stats')).data;
  }

  async cacheClear(input: z.infer<typeof import('../domain/cache.js').CacheClearQuerySchema>): Promise<z.infer<typeof CacheClearResultSchema>> {
    const q = new URLSearchParams({ kind: input.kind });
    return (await this.request<z.infer<typeof CacheClearResultSchema>>('DELETE', `/v1/cache?${q.toString()}`)).data;
  }

  async searchSuppliers(input: unknown): Promise<OpResult<SearchSuppliersResponse>> {
    return this.request<SearchSuppliersResponse>('POST', '/v1/search/suppliers', input);
  }

  async listSuppliers(input: { queryId: string; page: number; refresh: boolean }): Promise<OpResult<SuppliersListResponse>> {
    const q = new URLSearchParams({ queryId: input.queryId, page: String(input.page), refresh: String(input.refresh) });
    return this.request<SuppliersListResponse>('GET', `/v1/suppliers?${q.toString()}`);
  }

  async supplierDetail(input: { companyId?: string; store?: string; refresh: boolean }): Promise<OpResult<SupplierDetail>> {
    const q = new URLSearchParams({ refresh: String(input.refresh) });
    const path = input.companyId ? `/v1/suppliers/${encodeURIComponent(input.companyId)}` : `/v1/suppliers/by-store/${encodeURIComponent(String(input.store))}`;
    return this.request<SupplierDetail>('GET', `${path}?${q.toString()}`);
  }

  async factories(input: { province?: string; categoryId: string; page: number; pageSize: number; refresh: boolean }): Promise<OpResult<z.infer<typeof FactoriesResponseSchema>>> {
    const q = new URLSearchParams({
      categoryId: input.categoryId,
      page: String(input.page),
      pageSize: String(input.pageSize),
      refresh: String(input.refresh),
    });
    if (input.province) q.set('province', input.province);
    return this.request<z.infer<typeof FactoriesResponseSchema>>('GET', `/v1/factories?${q.toString()}`);
  }
}
