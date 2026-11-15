/**
 * 领域服务：搜索 / 翻页 / 详情 / 地区 / 工厂目录 / 会员 / 缓存 / 状态
 */
import { createHash } from 'node:crypto';
import type { Config } from './config/schema.js';
import { AliError } from './errors/catalog.js';
import type { Logger } from './utils/logger.js';
import type { AlibabaSession, SessionSnapshot } from './session/manager.js';
import type { CacheStore, PageRecord } from './cache/types.js';
import { SearchSuppliersRequestSchema } from './domain/query.js';
import type {
  SearchSuppliersRequest,
  SearchSuppliersResponse,
  SuppliersListResponse,
  LocationFilterResult,
  QueryRecord,
} from './domain/query.js';
import { HealthResponseSchema } from './domain/status.js';
import type { Status } from './domain/status.js';
import type { z } from 'zod';
import type {
  LoginStatus,
  VerificationSolveRequest,
  VerificationSolveResponse,
  VerificationStatus,
  LoginStartRequest,
} from './domain/session.js';
import { CacheClearQuerySchema } from './domain/cache.js';
import type { CacheStats } from './domain/cache.js';
import type { SupplierDetail, SupplierSummary } from './domain/supplier.js';
import { FactoriesResponseSchema } from './domain/factories.js';
import type { FactoryItem } from './domain/factories.js';
import { RegionsResponseSchema, RegionSearchResponseSchema } from './domain/region.js';
import type { MembershipCatalog } from './domain/membership.js';
import {
  buildSearchUrl,
} from './adapters/alibaba/endpoints.js';
import { parseSearchPage } from './adapters/alibaba/page-data.js';
import { parseRenderResponse, mapSupplierDetail } from './adapters/alibaba/detail.js';
import { parseFactoryPage } from './adapters/alibaba/factory.js';
import { classifyMembership } from './adapters/alibaba/membership.js';
import {
  cityByCode,
  listRegions,
  provinceByCode,
  resolveLocationQuery,
  searchRegions,
} from './adapters/alibaba/regions.js';
import { asStr } from './adapters/alibaba/helpers.js';
import { VERSION } from './config/schema.js';

type HealthResponse = z.infer<typeof HealthResponseSchema>;

const STARTED_AT = Date.now();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function makeQueryId(canonical: unknown): string {
  return `q_${createHash('sha256').update(stableStringify(canonical)).digest('hex').slice(0, 16)}`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function normalizeProvinceKey(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/[\s_'’.]/g, '')
    .replace(/(province|省|市)$/g, '');
}

function normalizeCityKey(value: string | null | undefined): string {
  return normalizeProvinceKey(value);
}

function locationMatches(
  location: SupplierSummary['location'],
  wanted: { province: string | null; city: string | null },
  includeUnknownCity: boolean,
): boolean {
  if (wanted.province) {
    const key = normalizeProvinceKey(location.province);
    if (!key || key !== normalizeProvinceKey(wanted.province)) return false;
  }
  if (wanted.city) {
    const key = normalizeCityKey(location.city);
    if (!key) return includeUnknownCity;
    if (key !== normalizeCityKey(wanted.city)) return false;
  }
  return true;
}

export class AliService {
  constructor(
    private readonly config: Config,
    private readonly session: AlibabaSession,
    private readonly cache: CacheStore,
    private readonly logger: Logger,
  ) {}

  mode(): 'logged_in' | 'anonymous' | 'degraded' {
    return this.session.mode();
  }

  async health(): Promise<HealthResponse> {
    return { service: 'ali-client', status: 'ok', version: VERSION, uptimeMs: Date.now() - STARTED_AT };
  }

  async status(): Promise<Status> {
    const snap: SessionSnapshot = this.session.snapshot();
    const cacheStats = await this.cache.stats();
    return {
      mode: snap.mode,
      loggedIn: snap.loggedIn,
      account: snap.account,
      language: snap.language,
      profile: {
        dir: this.config.profileDir,
        present: true,
        lockedByPid: process.pid,
      },
      browser: { running: snap.browser.running, pid: snap.browser.pid, headless: snap.browser.headless, uptimeMs: snap.browser.uptimeMs },
      worker: snap.worker,
      risk: snap.risk,
      upstream: snap.upstream,
      cache: {
        driver: cacheStats.driver,
        queries: cacheStats.queries.count,
        suppliers: cacheStats.suppliers.count,
        details: cacheStats.details.count,
        factories: cacheStats.factories.count,
        bytes: cacheStats.bytes,
      },
      version: VERSION,
    };
  }

  // ------------------------------------------------------------------ session
  async loginStart(_req: LoginStartRequest): Promise<LoginStatus> {
    return this.session.loginStart();
  }
  async loginStatus(loginId: string): Promise<LoginStatus> {
    return this.session.loginStatus(loginId);
  }
  async loginCancel(loginId: string): Promise<{ cancelled: true; loginId: string }> {
    await this.session.cancelLogin();
    return { cancelled: true, loginId };
  }
  async verificationGet(): Promise<VerificationStatus> {
    return this.session.verificationGet();
  }
  async verificationSolve(req: VerificationSolveRequest): Promise<VerificationSolveResponse> {
    return this.session.solveVerification(req);
  }

  // ------------------------------------------------------------------ regions
  regions(query: { level?: 'province' | 'city'; province?: string }): z.infer<typeof RegionsResponseSchema> {
    const { level, province, items } = listRegions({ level: query.level, province: query.province });
    return { level, province: province ?? undefined, items, count: items.length };
  }

  regionSearch(q: string, limit = 20): z.infer<typeof RegionSearchResponseSchema> {
    const items = searchRegions(q, limit);
    return { query: q, items, count: items.length };
  }

  memberships(): MembershipCatalog {
    return {
      plans: [
        {
          code: 'verified_pro',
          labelEn: 'Verified Pro Supplier',
          labelZh: '领袖卖家',
          rank: 3,
          description: '行业头部金品商家身份标（平台授予，非单独售卖）；list 级 verifiedSupplierPro=true。',
        },
        {
          code: 'verified_supplier',
          labelEn: 'Verified Supplier',
          labelZh: '金品诚企',
          rank: 2,
          description: '付费高级会员，含第三方实地评估/验厂与 Verified 徽章；isAssessedSupplier / companyHasPassAssessment=true。',
        },
        {
          code: 'gold_supplier',
          labelEn: 'Gold Supplier',
          labelZh: '出口通',
          rank: 1,
          description: '基础付费会员；accountIsPaidMember=true 且未通过金品评估。',
        },
        {
          code: 'unknown',
          labelEn: 'Unknown',
          labelZh: '未知',
          rank: 0,
          description: '无法从页面字段判定（可能免费会员或字段缺失）。',
        },
      ],
      rules: [
        { if: 'list.verifiedSupplierPro === true', then: 'verified_pro', confidence: 'high', source: 'list' },
        { if: 'list.isAssessedSupplier === true', then: 'verified_supplier', confidence: 'high', source: 'list' },
        { if: 'detail.companyHasPassAssessment === true', then: 'verified_supplier', confidence: 'high', source: 'detail' },
        { if: 'detail.accountIsPaidMember === true（且未 assessed）', then: 'gold_supplier', confidence: 'high', source: 'detail' },
        { if: 'list.goldYears > 0（弱证据）', then: 'gold_supplier', confidence: 'medium', source: 'list' },
      ],
      supplierIndex: {
        field: 'shopSign.supplierStars',
        range: [3 - 3, 5],
        label: 'Supplier Index（SOPI 星级，0–5 心）',
        note: '与店铺评分 reviewScore（0–5）和评价数 reviewCount 不同；仅详情接口提供。',
      },
      storeRating: {
        field: 'companyCard.supplierRatingReviews.averageStar',
        range: [0, 5],
        label: 'Store rating（买家评价均分）',
      },
      cautions: [
        'memberTag / type / iconList / reviewScore / reviewCount / transactions / tag 不能用于判档',
        'Top Sponsor Listing（adInfo/newAd）是广告，不是会员档位',
        'Trade Assurance 是交易保障，不是会员档位',
        'companyHasPassOnsite=true 表示实地验厂，不等于金品（出口通样本也有）',
        'isGold 不能作出口通主判据（非 assessed 付费商家 isGold=false）',
      ],
    };
  }

  // ------------------------------------------------------------------ cache
  async cacheStats(): Promise<CacheStats> {
    return this.cache.stats();
  }

  async cacheClear(query: z.infer<typeof CacheClearQuerySchema>) {
    return { deleted: await this.cache.clear({ kind: query.kind }) };
  }

  // ------------------------------------------------------------------ search
  private buildCanonical(req: SearchSuppliersRequest): {
    canonical: unknown;
    queryId: string;
    province: string | null;
    city: string | null;
    locationMode: 'strict' | 'keyword' | 'off';
    effectiveKeyword: string;
  } {
    const keyword = req.keyword?.trim() ?? '';
    const hasLocation = !!(req.province || req.city);
    if (!keyword && !hasLocation) {
      throw new AliError('INVALID_ARGUMENT', 'keyword or province/city is required');
    }
    const resolved = hasLocation ? resolveLocationQuery({ province: req.province, city: req.city }) : { province: null, city: null };
    const locationMode: 'strict' | 'keyword' | 'off' =
      req.locationMode ?? (hasLocation ? 'strict' : 'off');
    const placeName = resolved.city?.nameEn ?? resolved.province?.nameEn ?? '';
    const effectiveKeyword = keyword || placeName;
    const canonical = {
      keyword: effectiveKeyword,
      province: resolved.province?.code ?? null,
      city: resolved.city?.code ?? null,
      locationMode,
      country: req.country,
      filters: req.filters,
      pages: req.pages ?? this.config.session.maxPages,
      sort: req.sort ?? 'default',
    };
    return {
      canonical,
      queryId: makeQueryId(canonical),
      province: resolved.province?.code ?? null,
      city: resolved.city?.code ?? null,
      locationMode,
      effectiveKeyword,
    };
  }

  private locationResult(
    req: SearchSuppliersRequest,
    queryId: string,
    opts: { enriched: number; matched: number | null; unknownLocation: number; limitReached: boolean; mode: 'strict' | 'keyword' | 'off' },
  ): LocationFilterResult {
    const resolved = req.province || req.city ? resolveLocationQuery({ province: req.province, city: req.city }) : { province: null, city: null };
    return {
      requested: { province: req.province ?? null, city: req.city ?? null },
      normalized: { province: resolved.province, city: resolved.city },
      mode: opts.mode,
      includeUnknownCity: req.includeUnknownCity,
      enrichedCompanies: opts.enriched,
      matched: opts.matched,
      unknownLocation: opts.unknownLocation,
      limitReached: opts.limitReached,
      confidence: opts.mode === 'keyword' ? 'low' : 'high',
    };
  }

  async searchSuppliers(input: unknown): Promise<{ data: SearchSuppliersResponse; cached: boolean; mode: 'logged_in' | 'anonymous' | 'degraded' }> {
    const req = SearchSuppliersRequestSchema.parse(input);
    const { canonical, queryId, province, city, locationMode, effectiveKeyword } = this.buildCanonical(req);
    const pagesRequested = req.pages ?? this.config.session.maxPages;
    if (pagesRequested > this.config.session.maxPages) {
      throw new AliError('INVALID_ARGUMENT', `pages exceeds ALI_MAX_PAGES (${this.config.session.maxPages})`);
    }
    const now = Date.now();
    const existing = this.cache.getQuery(queryId);
    if (existing && !req.refresh && Date.parse(existing.expiresAt) > now) {
      const pages = this.cache.getPages(queryId);
      const allCached = Array.from({ length: pagesRequested }, (_, i) => i + 1).every((p) => pages.includes(p));
      if (allCached) {
        const suppliers = this.cache.getSupplierItems(queryId);
        const pageInfos = pages
          .filter((p) => p <= pagesRequested)
          .sort((a, b) => a - b)
          .map((p) => {
            const rec = this.cache.getPage(queryId, p, 0);
            return {
              page: p,
              totalCount: existing.totalCount,
              items: rec?.value.items.length ?? 0,
              ads: rec?.value.items.filter((x) => x.isAd).length ?? 0,
              fetchedAt: new Date(rec?.value.fetchedAt ?? now).toISOString(),
              cached: true,
            };
          });
        return {
          data: {
            queryId,
            keyword: req.keyword ?? null,
            effectiveKeyword,
            location: this.locationResult(req, queryId, {
              enriched: 0,
              matched: suppliers.length,
              unknownLocation: suppliers.filter((s) => s.location.confidence === 'unknown').length,
              limitReached: false,
              mode: locationMode,
            }),
            pages: pageInfos,
            suppliers,
            stats: {
              totalCount: existing.totalCount,
              rawItems: suppliers.length,
              deduped: suppliers.length,
              ads: suppliers.filter((s) => s.isAd).length,
              returned: suppliers.length,
              detailRequests: 0,
              detailCacheHits: 0,
              enrichLimitReached: false,
            },
          },
          cached: true,
          mode: this.mode(),
        };
      }
    }

    const filters = {
      ...req.filters,
      ...(req.sort ? { sort: req.sort } : {}),
    };
    const pageResults: Array<{ page: number; totalCount: number | null; ads: number; fetchedAt: number; items: SupplierSummary[] }> = [];
    let rawItems = 0;
    const searchLane = 'search' as const;
    for (let page = 1; page <= pagesRequested; page++) {
      const url = buildSearchUrl(this.config, {
        keyword: effectiveKeyword,
        page,
        country: req.country,
        filters: {
          verifiedSupplier: filters.verifiedSupplier,
          verifiedPro: filters.verifiedPro,
          tradeAssurance: filters.tradeAssurance,
          minReviewScore: filters.minReviewScore,
          companyAuthTags: filters.companyAuthTags,
          productAuthTags: filters.productAuthTags,
          capabilities: filters.capabilities,
        },
        sort: req.sort,
      });
      const res = await this.session.fetchText(url, { lane: searchLane });
      const parsed = parseSearchPage(res.text);
      rawItems += parsed.items.length;
      this.logger.info('search.page', { queryId, page, items: parsed.items.length, total: parsed.totalCount, ms: res.latencyMs });
      pageResults.push({ page, totalCount: parsed.totalCount, ads: parsed.adCount, fetchedAt: Date.now(), items: parsed.items });
      if (parsed.items.length === 0) break;
    }

    const allItems = pageResults.flatMap((p) => p.items);
    const dedupe = new Map<string, SupplierSummary>();
    for (const item of allItems) {
      const prev = dedupe.get(item.companyId);
      if (!prev || (!prev.enriched && item.enriched)) dedupe.set(item.companyId, item);
    }
    const archive = [...dedupe.values()];
    let candidates = [...archive];

    let enrichedCompanies = 0;
    let detailCacheHits = 0;
    let enrichLimitReached = false;
    if (locationMode === 'strict') {
      const resolved = { province: req.province ?? null, city: req.city ?? null };
      const normalized = resolveLocationQuery({ province: req.province, city: req.city });
      const maxEnrich = Math.min(req.maxEnrich ?? this.config.session.maxEnrich, this.config.session.maxEnrich);
      const toEnrich = candidates.slice(0, maxEnrich);
      if (candidates.length > maxEnrich) enrichLimitReached = true;
      const merged = await mapLimit(toEnrich, this.config.session.detailConcurrency, async (item) => {
        try {
          const detail = await this.ensureDetail(item.companyId, item.storeSubdomain ?? '', item, false);
          enrichedCompanies++;
          const summary = detailSummary(detail, item);
          return summary;
        } catch (err) {
          if (err instanceof AliError && (err.code === 'CAPTCHA_REQUIRED' || err.code === 'RISK_COOLDOWN')) throw err;
          this.logger.warn('search.enrich_failed', { companyId: item.companyId, error: (err as Error).message.slice(0, 160) });
          return item;
        }
      });
      const byId = new Map(merged.map((m) => [m.companyId, m]));
      for (const item of candidates) {
        const m = byId.get(item.companyId);
        if (m) candidates = candidates.map((x) => (x.companyId === item.companyId ? m : x));
      }
      const matched = candidates.filter((s) => locationMatches(s.location, {
        province: normalized.province?.nameEn ?? resolved.province,
        city: normalized.city?.nameEn ?? resolved.city,
      }, req.includeUnknownCity));
      const unknownLocation = candidates.filter((s) => s.location.confidence === 'unknown').length;
      candidates = matched;
      const loc = this.locationResult(req, queryId, {
        enriched: enrichedCompanies,
        matched: matched.length,
        unknownLocation,
        limitReached: enrichLimitReached,
        mode: locationMode,
      });
      return this.finishSearch(req, {
        queryId,
        effectiveKeyword,
        locationMode,
        province,
        city,
        pagesRequested,
        pageResults,
        candidates,
        archive,
        rawItems,
        enrichedCompanies,
        detailCacheHits,
        enrichLimitReached,
        location: loc,
      });
    }

    return this.finishSearch(req, {
      queryId,
      effectiveKeyword,
      locationMode,
      province,
      city,
      pagesRequested,
      pageResults,
      candidates,
      archive,
      rawItems,
      enrichedCompanies,
      detailCacheHits,
      enrichLimitReached,
      location: this.locationResult(req, queryId, {
        enriched: 0,
        matched: null,
        unknownLocation: candidates.filter((s) => s.location.confidence === 'unknown').length,
        limitReached: false,
        mode: locationMode,
      }),
    });
  }

  private finishSearch(
    req: SearchSuppliersRequest,
    args: {
      queryId: string;
      effectiveKeyword: string;
      locationMode: 'strict' | 'keyword' | 'off';
      province: string | null;
      city: string | null;
      pagesRequested: number;
      pageResults: Array<{ page: number; totalCount: number | null; ads: number; fetchedAt: number; items: SupplierSummary[] }>;
      candidates: SupplierSummary[];
      archive: SupplierSummary[];
      rawItems: number;
      enrichedCompanies: number;
      detailCacheHits: number;
      enrichLimitReached: boolean;
      location: LocationFilterResult;
    },
  ): { data: SearchSuppliersResponse; cached: boolean; mode: 'logged_in' | 'anonymous' | 'degraded' } {
    const now = Date.now();
    const expiresAt = new Date(now + this.config.cache.queryTtlSec * 1000).toISOString();
    const record: QueryRecord = {
      queryId: args.queryId,
      specJson: stableStringify({
        keyword: args.effectiveKeyword,
        province: args.province,
        city: args.city,
        locationMode: args.locationMode,
        country: req.country,
        filters: req.filters,
        pages: args.pagesRequested,
        sort: req.sort ?? 'default',
      }),
      keyword: req.keyword ?? null,
      province: args.province,
      city: args.city,
      locationMode: args.locationMode,
      filtersJson: stableStringify(req.filters),
      country: req.country,
      pagesRequested: args.pagesRequested,
      pagesFetched: args.pageResults.map((p) => p.page),
      totalCount: args.pageResults[0]?.totalCount ?? null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt,
    };
    this.cache.putQuery(record);
    for (const page of args.pageResults) {
      const filteredPage: PageRecord = {
        queryId: args.queryId,
        page: page.page,
        totalCount: page.totalCount,
        items:
          args.locationMode === 'strict'
            ? args.candidates.filter((s) => page.items.some((x) => x.companyId === s.companyId))
            : page.items,
        fetchedAt: page.fetchedAt,
      };
      this.cache.putPage(filteredPage);
    }
    for (const s of args.candidates) this.cache.putSupplier(s);
    for (const s of args.archive) {
      if (!args.candidates.some((c) => c.companyId === s.companyId && c.enriched)) this.cache.putSupplier(s);
    }
    const pageInfos = args.pageResults.map((p) => ({
      page: p.page,
      totalCount: p.totalCount,
      items: args.locationMode === 'strict'
        ? args.candidates.filter((s) => p.items.some((x) => x.companyId === s.companyId)).length
        : p.items.length,
      ads: p.ads,
      fetchedAt: new Date(p.fetchedAt).toISOString(),
      cached: false,
    }));
    const result: SearchSuppliersResponse = {
      queryId: args.queryId,
      keyword: req.keyword ?? null,
      effectiveKeyword: args.effectiveKeyword,
      location: args.location,
      pages: pageInfos,
      suppliers: args.candidates,
      stats: {
        totalCount: args.pageResults[0]?.totalCount ?? null,
        rawItems: args.rawItems,
        deduped: args.candidates.length,
        ads: args.pageResults.reduce((acc, p) => acc + p.ads, 0),
        returned: args.candidates.length,
        detailRequests: args.enrichedCompanies,
        detailCacheHits: args.detailCacheHits,
        enrichLimitReached: args.enrichLimitReached,
      },
    };
    return { data: result, cached: false, mode: this.mode() };
  }

  // ------------------------------------------------------------------ list
  async listSuppliers(input: { queryId: string; page: number; refresh: boolean }): Promise<{ data: SuppliersListResponse; cached: boolean; mode: 'logged_in' | 'anonymous' | 'degraded' }> {
    const query = this.cache.getQuery(input.queryId);
    if (!query) throw new AliError('NOT_FOUND', `query not found: ${input.queryId}`);
    if (Date.parse(query.expiresAt) < Date.now()) throw new AliError('NOT_FOUND', `query expired: ${input.queryId}`);
    const fetched = this.cache.getPages(input.queryId);
    let record = !input.refresh ? this.cache.getPage(input.queryId, input.page, this.config.cache.queryTtlSec) : null;
    if (!record || !record.fresh) {
      if (input.page > Math.max(...fetched, 0) && input.page > query.pagesRequested) {
        throw new AliError('PAGE_NOT_AVAILABLE', `page ${input.page} not fetched and exceeds query pages (${query.pagesRequested})`, {
          details: { pagesFetched: fetched, pagesRequested: query.pagesRequested, nextAction: 'increase-pages-or-refresh' },
        });
      }
      record = await this.fetchSinglePage(query, input.page);
    }
    const items = record.value.items;
    const pageSize = 20;
    const hasMore = items.length > 0 && input.page < this.config.session.maxPages;
    return {
      data: {
        queryId: input.queryId,
        page: input.page,
        pageSize,
        totalCount: record.value.totalCount ?? query.totalCount,
        suppliers: items,
        hasMore,
        fetchedPages: this.cache.getPages(input.queryId),
        location: {
          requested: { province: query.province, city: query.city },
          mode: query.locationMode,
          includeUnknownCity: true,
          enrichedCompanies: 0,
          matched: null,
          unknownLocation: items.filter((x) => x.location.confidence === 'unknown').length,
          limitReached: false,
          confidence: query.locationMode === 'keyword' ? 'low' : 'high',
        },
      },
      cached: !input.refresh && record.fresh,
      mode: this.mode(),
    };
  }

  private async fetchSinglePage(query: QueryRecord, page: number): Promise<import('./cache/types.js').CachedValue<PageRecord>> {
    const province = query.province ? provinceByCode(query.province) : null;
    const city = query.city ? cityByCode(query.city) : null;
    const keyword = query.keyword ?? city?.nameEn ?? province?.nameEn ?? '';
    const url = buildSearchUrl(this.config, {
      keyword,
      page,
      country: query.country,
      filters: JSON.parse(query.filtersJson) as Record<string, never>,
    });
    const res = await this.session.fetchText(url, { lane: 'search' });
    const parsed = parseSearchPage(res.text);
    let items = parsed.items;
    if (query.locationMode === 'strict' && (query.province || query.city)) {
      const prov = query.province ? provinceByCode(query.province) : null;
      const city = query.city ? cityByCode(query.city) : null;
      const maxEnrich = this.config.session.maxEnrich;
      const subset = items.slice(0, maxEnrich);
      const enriched = await mapLimit(subset, this.config.session.detailConcurrency, async (item) => {
        try {
          const detail = await this.ensureDetail(item.companyId, item.storeSubdomain ?? '', item, false);
          return detailSummary(detail, item);
        } catch (err) {
          if (err instanceof AliError && (err.code === 'CAPTCHA_REQUIRED' || err.code === 'RISK_COOLDOWN')) throw err;
          return item;
        }
      });
      const byId = new Map(enriched.map((s) => [s.companyId, s]));
      items = items.map((item) => byId.get(item.companyId) ?? item);
      for (const s of items) this.cache.putSupplier(s);
      items = items.filter((s) =>
        locationMatches(s.location, { province: prov?.nameEn ?? null, city: city?.nameEn ?? null }, true),
      );
    }
    const rec: PageRecord = {
      queryId: query.queryId,
      page,
      totalCount: parsed.totalCount,
      items,
      fetchedAt: Date.now(),
    };
    this.cache.putPage(rec);
    const pages = new Set([...this.cache.getPages(query.queryId), page]);
    this.cache.updateQueryProgress(query.queryId, {
      pagesFetched: [...pages].sort((a, b) => a - b),
      totalCount: parsed.totalCount,
      updatedAt: new Date().toISOString(),
    });
    return { value: rec, fetchedAt: rec.fetchedAt, expiresAt: Date.now() + this.config.cache.queryTtlSec * 1000, fresh: false };
  }

  // ------------------------------------------------------------------ detail
  async supplierDetail(input: { companyId?: string; store?: string; refresh: boolean }): Promise<{ data: SupplierDetail; cached: boolean; mode: 'logged_in' | 'anonymous' | 'degraded' }> {
    let companyId = input.companyId ?? null;
    if (!companyId && !input.store) throw new AliError('INVALID_ARGUMENT', 'companyId or store is required');
    if (companyId && !input.refresh) {
      const cached = this.cache.getDetail(companyId, this.config.cache.detailTtlSec);
      if (cached && cached.fresh) return { data: cached.value, cached: true, mode: this.mode() };
    }
    const subdomain = input.store ?? (await this.resolveStoreSubdomain(companyId as string));
    if (!subdomain) {
      throw new AliError('NOT_FOUND', `cannot derive store subdomain for companyId=${String(companyId)}（先执行一次 search 让客户端记录映射，或用 --store <subdomain>）`);
    }
    const listSummary = companyId ? this.cache.getSupplier(companyId) : null;
    const detail = await this.ensureDetail(companyId ?? '', subdomain, listSummary, input.refresh);
    if (!companyId) companyId = detail.companyId;
    this.cache.putSupplier(detail);
    return { data: detail, cached: false, mode: this.mode() };
  }

  private async resolveStoreSubdomain(companyId: string): Promise<string | null> {
    const summary = this.cache.getSupplier(companyId);
    return summary?.storeSubdomain ?? null;
  }

  async ensureDetail(companyId: string, subdomain: string, listSummary: SupplierSummary | null, refresh: boolean): Promise<SupplierDetail> {
    if (companyId && !refresh) {
      const cached = this.cache.getDetail(companyId, this.config.cache.detailTtlSec);
      if (cached && cached.fresh) return cached.value;
    }
    const listInput = listSummary
      ? {
          verifiedSupplierPro: listSummary.membership.verifiedPro,
          isAssessedSupplier: listSummary.membership.verifiedSupplier,
          goldYearsText: listSummary.joinedYearsText,
        }
      : null;
    const { json, latencyMs } = await this.session.fetchRender(subdomain);
    const components = parseRenderResponse(json);
    const parsedCompanyId = asStr((components.shopSign as Record<string, unknown> | null)?.companyId) ?? companyId;
    const detail = mapSupplierDetail({
      companyId: parsedCompanyId,
      components,
      list: listInput,
    });
    this.logger.info('detail.fetched', { companyId: detail.companyId, ms: latencyMs, plan: detail.membership.plan });
    this.cache.putDetail(detail);
    this.cache.putSupplier(detailSummary(detail, listSummary));
    return detail;
  }

  // ------------------------------------------------------------------ factories
  async factories(input: { province?: string; categoryId: string; page: number; pageSize: number; refresh: boolean }): Promise<{ data: z.infer<typeof FactoriesResponseSchema>; cached: boolean; mode: 'logged_in' | 'anonymous' | 'degraded' }> {
    const province = input.province ? resolveLocationQuery({ province: input.province }).province : null;
    if (input.province && !province) throw new AliError('INVALID_ARGUMENT', `unknown province: ${input.province}`);
    let record = !input.refresh ? this.cache.getFactoryPage(input.categoryId, input.page, this.config.cache.factoryTtlSec) : null;
    if (!record || !record.fresh) {
      const json = await this.session.fetchFactoryJson(input.categoryId, input.page, input.pageSize);
      const parsed = parseFactoryPage(json);
      const rec = {
        categoryId: input.categoryId,
        page: input.page,
        items: parsed.items,
        upstreamTotal: parsed.totalNum,
        fetchedAt: Date.now(),
      };
      this.cache.putFactoryPage(rec);
      record = { value: rec, fetchedAt: rec.fetchedAt, expiresAt: rec.fetchedAt + this.config.cache.factoryTtlSec * 1000, fresh: false };
    }
    let items: FactoryItem[] = record.value.items;
    if (province) {
      items = items.filter((it) => {
        const key = normalizeProvinceKey(it.province);
        return key === normalizeProvinceKey(province.nameEn) || key === normalizeProvinceKey(province.nameZh);
      });
    }
    return {
      data: {
        province: province?.nameEn ?? null,
        provinceCode: province?.code ?? null,
        categoryId: input.categoryId,
        page: input.page,
        pageSize: input.pageSize,
        upstreamTotal: record.value.upstreamTotal,
        capped: true,
        items,
        fetchedAt: new Date(record.value.fetchedAt).toISOString(),
        note: 'Upstream caps at ~500 manufacturers; city is not available on this directory.',
      },
      cached: record.fresh,
      mode: this.mode(),
    };
  }
}

/** 详情 → 汇总（用于列表/档案），保留列表位置的 rank/isAd 等展示字段 */
export function detailSummary(detail: SupplierDetail, base: SupplierSummary | null): SupplierSummary {
  const membership =
    base != null
      ? classifyMembership({
          list: {
            verifiedSupplierPro: base.membership.verifiedPro,
            isAssessedSupplier: base.membership.verifiedSupplier,
            goldYearsText: base.joinedYearsText,
          },
          detail: {
            companyHasPassAssessment: detail.membership.verifiedSupplier,
            companyHasPassOnsite: detail.membership.onsiteAssessment,
            companyHasPassBaseVerify: detail.membership.baseVerify,
            accountIsPaidMember: detail.membership.paidMember,
            isGold: detail.membership.goldSupplier,
            assessmentCertCompany: detail.membership.assessedBy,
            goldYearsText: detail.joinedYearsText,
          },
        })
      : detail.membership;
  return {
    ...detail,
    rank: base?.rank ?? null,
    isAd: base?.isAd ?? false,
    adType: base?.adType ?? null,
    position: base?.position ?? 0,
    enriched: true,
    membership,
  };
}
