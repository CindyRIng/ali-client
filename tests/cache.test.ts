/**
 * 内存缓存与 envelope 测试
 */
import { describe, expect, it } from 'vitest';
import { MemoryCacheStore } from '../src/cache/memory.js';
import { successEnvelope, failureEnvelope } from '../src/schemas/envelope.js';
import { AliError } from '../src/errors/catalog.js';
import type { QueryRecord } from '../src/domain/query.js';
import type { SupplierSummary } from '../src/domain/supplier.js';
import { classifyMembership } from '../src/adapters/alibaba/membership.js';

const query: QueryRecord = {
  queryId: 'q_0123456789abcdef',
  specJson: '{}',
  keyword: 'solid tire',
  province: 'CN-13',
  city: null,
  locationMode: 'strict',
  filtersJson: '{}',
  country: 'CN',
  pagesRequested: 1,
  pagesFetched: [1],
  totalCount: 100,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

function summary(): SupplierSummary {
  return {
    companyId: '1',
    companyName: 'Test Co',
    storeUrl: 'https://test.en.alibaba.com/company_profile.html',
    storeSubdomain: 'test',
    logoUrl: null,
    country: 'CN',
    location: { country: 'CN', province: 'Hebei', provinceCode: 'CN-13', city: 'Hengshui', cityCode: 'CN-13-1311', address: null, display: null, confidence: 'high', source: 'detail' },
    joinedYears: 6,
    joinedYearsText: '6 yrs',
    supplierIndex: { stars: 2, maxStars: 5, label: 'Supplier Index', source: 'shopSign.supplierStars' },
    membership: classifyMembership({ list: { isAssessedSupplier: true } }),
    mainProducts: ['Solid Tires'],
    mainProductsText: 'Solid Tires',
    rating: { score: 4.6, count: 10 },
    businessType: { raw: 'Manufacturer', manufacturer: true, tradingCompany: false },
    staffText: null,
    factoryAreaText: null,
    transactionsText: null,
    responseTime: null,
    capabilityTags: [],
    rank: 1,
    isAd: false,
    adType: null,
    position: 1,
    enriched: true,
  };
}

describe('MemoryCacheStore', () => {
  it('query / page / supplier / detail 生命周期', async () => {
    const cache = new MemoryCacheStore();
    await cache.init();
    cache.putQuery(query);
    expect(cache.getQuery(query.queryId)?.keyword).toBe('solid tire');
    const s = summary();
    cache.putPage({ queryId: query.queryId, page: 1, totalCount: 100, items: [s], fetchedAt: Date.now() });
    expect(cache.getPage(query.queryId, 1, 3600)?.value.items.length).toBe(1);
    expect(cache.getPages(query.queryId)).toEqual([1]);
    cache.putSupplier(s);
    expect(cache.getSupplier('1')?.companyName).toBe('Test Co');
    const stats = await cache.stats();
    expect(stats.queries.count).toBe(1);
    expect(stats.suppliers.count).toBe(1);
    const deleted = await cache.clear({ kind: 'all' });
    expect(deleted.queries).toBe(1);
    expect(cache.getQuery(query.queryId)).toBeNull();
  });
  it('过期页不 fresh', () => {
    const cache = new MemoryCacheStore();
    cache.putPage({ queryId: query.queryId, page: 1, totalCount: 1, items: [summary()], fetchedAt: Date.now() - 10_000 });
    expect(cache.getPage(query.queryId, 1, 5)?.fresh).toBe(false);
  });
});

describe('envelope', () => {
  it('success / failure 结构', () => {
    const ok = successEnvelope({ hello: 'world' }, { requestId: 'r_test_123', tookMs: 3, mode: 'anonymous' });
    expect(ok.ok).toBe(true);
    expect(ok.meta.schemaVersion).toBe('1.0');
    const err = new AliError('NOT_FOUND', 'missing');
    const fail = failureEnvelope({ code: err.code, message: err.message, retryable: err.retryable }, { requestId: 'r_test_123', tookMs: 1 });
    expect(fail.ok).toBe(false);
    expect(fail.error.code).toBe('NOT_FOUND');
  });
});
