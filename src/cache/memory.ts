/**
 * 内存缓存（测试/降级用；不持久化）
 */
import type { QueryRecord } from '../domain/query.js';
import type { SupplierDetail, SupplierSummary } from '../domain/supplier.js';
import type { FactoryItem } from '../domain/factories.js';
import type { CacheStats } from '../domain/cache.js';
import type { CacheStore, CachedValue, FactoryPageRecord, PageRecord } from './types.js';
import { cachedValue } from './types.js';

interface DetailEntry {
  detail: SupplierDetail;
  fetchedAt: number;
}

interface FactoryEntry {
  items: FactoryItem[];
  upstreamTotal: number | null;
  fetchedAt: number;
}

export class MemoryCacheStore implements CacheStore {
  readonly driver = 'memory' as const;
  private queries = new Map<string, QueryRecord>();
  private pages = new Map<string, Map<number, PageRecord>>();
  private suppliers = new Map<string, SupplierSummary>();
  private details = new Map<string, DetailEntry>();
  private factories = new Map<string, FactoryEntry>();
  private meta = new Map<string, string>();

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  getQuery(queryId: string): QueryRecord | null {
    return this.queries.get(queryId) ?? null;
  }

  putQuery(record: QueryRecord): void {
    this.queries.set(record.queryId, record);
  }

  updateQueryProgress(queryId: string, patch: Partial<Pick<QueryRecord, 'pagesFetched' | 'totalCount' | 'updatedAt'>>): void {
    const cur = this.queries.get(queryId);
    if (!cur) return;
    this.queries.set(queryId, { ...cur, ...patch });
  }

  getPage(queryId: string, page: number, ttlSec: number): CachedValue<PageRecord> | null {
    const rec = this.pages.get(queryId)?.get(page);
    if (!rec) return null;
    return cachedValue(rec, rec.fetchedAt, ttlSec);
  }

  putPage(record: PageRecord): void {
    const map = this.pages.get(record.queryId) ?? new Map<number, PageRecord>();
    map.set(record.page, record);
    this.pages.set(record.queryId, map);
  }

  getPages(queryId: string): number[] {
    return [...(this.pages.get(queryId)?.keys() ?? [])].sort((a, b) => a - b);
  }

  getSupplierItems(queryId: string): SupplierSummary[] {
    const map = this.pages.get(queryId);
    if (!map) return [];
    return [...map.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, p]) => p.items);
  }

  getSupplier(companyId: string): SupplierSummary | null {
    return this.suppliers.get(companyId) ?? null;
  }

  putSupplier(summary: SupplierSummary): void {
    this.suppliers.set(summary.companyId, summary);
  }

  getDetail(companyId: string, ttlSec: number): CachedValue<SupplierDetail> | null {
    const entry = this.details.get(companyId);
    if (!entry) return null;
    return cachedValue(entry.detail, entry.fetchedAt, ttlSec);
  }

  putDetail(detail: SupplierDetail): void {
    this.details.set(detail.companyId, { detail, fetchedAt: Date.now() });
  }

  listDetailIds(): string[] {
    return [...this.details.keys()];
  }

  getFactoryPage(categoryId: string, page: number, ttlSec: number): CachedValue<FactoryPageRecord> | null {
    const entry = this.factories.get(`${categoryId}#${page}`);
    if (!entry) return null;
    const rec: FactoryPageRecord = {
      categoryId,
      page,
      items: entry.items,
      upstreamTotal: entry.upstreamTotal,
      fetchedAt: entry.fetchedAt,
    };
    return cachedValue(rec, entry.fetchedAt, ttlSec);
  }

  putFactoryPage(record: FactoryPageRecord): void {
    this.factories.set(`${record.categoryId}#${record.page}`, {
      items: record.items,
      upstreamTotal: record.upstreamTotal,
      fetchedAt: record.fetchedAt,
    });
  }

  getMeta(key: string): string | null {
    return this.meta.get(key) ?? null;
  }

  putMeta(key: string, value: string): void {
    this.meta.set(key, value);
  }

  async stats(): Promise<CacheStats> {
    const now = Date.now();
    const expired = [...this.details.values()].filter((d) => now - d.fetchedAt > 7 * 86400 * 1000).length;
    const bytes = JSON.stringify([...this.queries.values()]).length + JSON.stringify([...this.details.values()]).length;
    const oldest = [...this.queries.values()].map((q) => q.createdAt).sort()[0] ?? null;
    return {
      driver: 'memory',
      queries: { count: this.queries.size, oldestAt: oldest },
      suppliers: { count: this.suppliers.size },
      details: { count: this.details.size, expired },
      factories: { count: this.factories.size },
      bytes,
    };
  }

  async clear(opts: { kind: 'all' | 'queries' | 'suppliers' | 'details' | 'factories' }): Promise<{
    queries: number;
    suppliers: number;
    details: number;
    factories: number;
  }> {
    const deleted = {
      queries: opts.kind === 'all' || opts.kind === 'queries' ? this.queries.size : 0,
      suppliers: opts.kind === 'all' || opts.kind === 'suppliers' ? this.suppliers.size : 0,
      details: opts.kind === 'all' || opts.kind === 'details' ? this.details.size : 0,
      factories: opts.kind === 'all' || opts.kind === 'factories' ? this.factories.size : 0,
    };
    if (opts.kind === 'all' || opts.kind === 'queries') {
      this.queries.clear();
      this.pages.clear();
    }
    if (opts.kind === 'all' || opts.kind === 'suppliers') this.suppliers.clear();
    if (opts.kind === 'all' || opts.kind === 'details') this.details.clear();
    if (opts.kind === 'all' || opts.kind === 'factories') this.factories.clear();
    return deleted;
  }
}
