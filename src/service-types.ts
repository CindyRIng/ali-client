/**
 * 服务接口（本地 AliService 与远程 REST 代理共用）
 */
import type { Status } from './domain/status.js';
import type {
  LoginStatus,
  VerificationSolveRequest,
  VerificationSolveResponse,
  VerificationStatus,
  LoginStartRequest,
} from './domain/session.js';
import type { RegionsResponseSchema, RegionSearchResponseSchema } from './domain/region.js';
import type { SearchSuppliersResponse, SuppliersListResponse } from './domain/query.js';
import type { SupplierDetail } from './domain/supplier.js';
import type { FactoriesResponseSchema } from './domain/factories.js';
import type { MembershipCatalog } from './domain/membership.js';
import type { CacheClearQuerySchema, CacheClearResultSchema, CacheStats } from './domain/cache.js';
import type { z } from 'zod';

export type Mode = 'logged_in' | 'anonymous' | 'degraded';

export interface OpResult<T> {
  data: T;
  cached?: boolean;
  mode?: Mode;
}

export interface AliServiceLike {
  mode(): Mode;
  health(): Promise<{ service: 'ali-client'; status: 'ok'; version: string; uptimeMs: number }>;
  status(): Promise<Status>;
  loginStart(req: LoginStartRequest): Promise<LoginStatus>;
  loginStatus(loginId: string): Promise<LoginStatus>;
  loginCancel(loginId: string): Promise<{ cancelled: true; loginId: string }>;
  verificationGet(): Promise<VerificationStatus>;
  verificationSolve(req: VerificationSolveRequest): Promise<VerificationSolveResponse>;
  regions(
    input: { level?: 'province' | 'city'; province?: string },
  ): z.infer<typeof RegionsResponseSchema> | Promise<z.infer<typeof RegionsResponseSchema>>;
  regionSearch(q: string, limit?: number): z.infer<typeof RegionSearchResponseSchema> | Promise<z.infer<typeof RegionSearchResponseSchema>>;
  memberships(): MembershipCatalog | Promise<MembershipCatalog>;
  cacheStats(): Promise<CacheStats>;
  cacheClear(input: z.infer<typeof CacheClearQuerySchema>): Promise<z.infer<typeof CacheClearResultSchema>>;
  searchSuppliers(input: unknown): Promise<OpResult<SearchSuppliersResponse>>;
  listSuppliers(input: { queryId: string; page: number; refresh: boolean }): Promise<OpResult<SuppliersListResponse>>;
  supplierDetail(input: { companyId?: string; store?: string; refresh: boolean }): Promise<OpResult<SupplierDetail>>;
  factories(input: {
    province?: string;
    categoryId: string;
    page: number;
    pageSize: number;
    refresh: boolean;
  }): Promise<OpResult<z.infer<typeof FactoriesResponseSchema>>>;
}
