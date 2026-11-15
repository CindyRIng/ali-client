/**
 * 缓存接口与数据类型
 */
import type { QueryRecord } from '../domain/query.js';
import type { SupplierDetail, SupplierSummary } from '../domain/supplier.js';
import type { FactoryItem } from '../domain/factories.js';
import type { CacheStats } from '../domain/cache.js';

export interface CachedValue<T> {
  value: T;
  fetchedAt: number;
  expiresAt: number;
  fresh: boolean;
}

export interface PageRecord {
  queryId: string;
  page: number;
  totalCount: number | null;
  items: SupplierSummary[];
  fetchedAt: number;
}

export interface FactoryPageRecord {
  categoryId: string;
  page: number;
  items: FactoryItem[];
  upstreamTotal: number | null;
  fetchedAt: number;
}

export interface CacheStore {
  readonly driver: 'sqlite' | 'memory';
  init(): Promise<void>;
  close(): Promise<void>;

  getQuery(queryId: string): QueryRecord | null;
  putQuery(record: QueryRecord): void;
  updateQueryProgress(
    queryId: string,
    patch: Partial<Pick<QueryRecord, 'pagesFetched' | 'totalCount' | 'updatedAt'>>,
  ): void;

  getPage(queryId: string, page: number, ttlSec: number): CachedValue<PageRecord> | null;
  putPage(record: PageRecord): void;
  getPages(queryId: string): number[];
  getSupplierItems(queryId: string): SupplierSummary[];

  getSupplier(companyId: string): SupplierSummary | null;
  putSupplier(summary: SupplierSummary): void;

  getDetail(companyId: string, ttlSec: number): CachedValue<SupplierDetail> | null;
  putDetail(detail: SupplierDetail): void;
  listDetailIds(): string[];

  getFactoryPage(categoryId: string, page: number, ttlSec: number): CachedValue<FactoryPageRecord> | null;
  putFactoryPage(record: FactoryPageRecord): void;

  getMeta(key: string): string | null;
  putMeta(key: string, value: string): void;

  stats(): Promise<CacheStats>;
  clear(opts: { kind: 'all' | 'queries' | 'suppliers' | 'details' | 'factories' }): Promise<{
    queries: number;
    suppliers: number;
    details: number;
    factories: number;
  }>;
}

export function cachedValue<T>(value: T, fetchedAt: number, ttlSec: number): CachedValue<T> {
  const expiresAt = fetchedAt + ttlSec * 1000;
  return { value, fetchedAt, expiresAt, fresh: Date.now() < expiresAt };
}
