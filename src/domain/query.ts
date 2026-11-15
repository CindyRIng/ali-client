/**
 * 搜索查询领域模型：请求 / 响应 / 分页 / 查询记录
 */
import { z } from 'zod';
import {
  BooleanQuerySchema,
  IsoDateTimeSchema,
  LocationModeSchema,
  MaxEnrichSchema,
  PageSchema,
  PagesSchema,
  QueryIdSchema,
  SortTypeSchema,
} from './common.js';
import { RegionSchema } from './region.js';
import { SupplierSummarySchema } from './supplier.js';

export const SearchFiltersSchema = z
  .object({
    verifiedSupplier: z.boolean().default(false).meta({ description: 'Verified Supplier / 金品诚企（assessmentCompany=true）' }),
    verifiedPro: z.boolean().default(false).meta({ description: 'Verified Pro Supplier / 领袖卖家（verifiedPro=1）' }),
    tradeAssurance: z.boolean().default(false).meta({ description: 'Trade Assurance（ta=y）' }),
    minReviewScore: z.enum(['4', '4.5', '5']).optional().meta({ description: '店铺评分下限' }),
    companyAuthTags: z.array(z.string()).default([]).meta({ description: '公司认证：ISO/BSCI/IATF 16949/SEDEX/HACCP/FSC' }),
    productAuthTags: z.array(z.string()).default([]).meta({ description: '产品认证：CE/ROHS/DOT/...' }),
    capabilities: z.array(z.string()).default([]).meta({ description: '能力标签：id 或英文名（Full customization 等）' }),
  })
  .meta({ id: 'SearchFilters' });

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  verifiedSupplier: false,
  verifiedPro: false,
  tradeAssurance: false,
  companyAuthTags: [],
  productAuthTags: [],
  capabilities: [],
};

export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

export const SearchSuppliersRequestSchema = z
  .object({
    keyword: z.string().trim().max(200).optional().meta({ description: '关键词（产品词或地区词）；与 province/city 至少给一个' }),
    province: z.string().trim().max(60).optional().meta({ description: '省份（中文/英文/拼音/代码）' }),
    city: z.string().trim().max(60).optional().meta({ description: '城市（中文/英文/拼音/代码）' }),
    locationMode: LocationModeSchema.optional(),
    includeUnknownCity: z.boolean().default(true).meta({ description: 'city 过滤时是否保留城市未知的供应商' }),
    country: z.string().trim().length(2).default('CN'),
    filters: SearchFiltersSchema.default(DEFAULT_SEARCH_FILTERS),
    pages: PagesSchema.optional(),
    maxEnrich: MaxEnrichSchema.optional(),
    sort: SortTypeSchema.optional(),
    refresh: z.boolean().default(false),
  })
  .meta({ id: 'SearchSuppliersRequest' });

export type SearchSuppliersRequest = z.infer<typeof SearchSuppliersRequestSchema>;

export const QueryPageInfoSchema = z
  .object({
    page: z.number().int().min(1),
    totalCount: z.number().int().nullable().default(null),
    items: z.number().int().nonnegative(),
    ads: z.number().int().nonnegative().default(0),
    fetchedAt: IsoDateTimeSchema,
    cached: z.boolean().default(false),
  })
  .meta({ id: 'QueryPageInfo' });

export const LocationFilterResultSchema = z
  .object({
    requested: z.object({ province: z.string().nullable(), city: z.string().nullable() }),
    normalized: z
      .object({
        province: RegionSchema.nullable().optional(),
        city: RegionSchema.nullable().optional(),
      })
      .optional(),
    mode: LocationModeSchema,
    includeUnknownCity: z.boolean().default(true),
    enrichedCompanies: z.number().int().nonnegative().default(0),
    matched: z.number().int().nonnegative().nullable().default(null),
    unknownLocation: z.number().int().nonnegative().default(0),
    limitReached: z.boolean().default(false),
    confidence: z.enum(['high', 'low']).default('high'),
  })
  .meta({ id: 'LocationFilterResult' });

export const SearchStatsSchema = z
  .object({
    totalCount: z.number().int().nullable().default(null),
    rawItems: z.number().int().nonnegative(),
    deduped: z.number().int().nonnegative(),
    ads: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    detailRequests: z.number().int().nonnegative().default(0),
    detailCacheHits: z.number().int().nonnegative().default(0),
    enrichLimitReached: z.boolean().default(false),
  })
  .meta({ id: 'SearchStats' });

export const SearchSuppliersResponseSchema = z
  .object({
    queryId: QueryIdSchema,
    keyword: z.string().nullable(),
    effectiveKeyword: z.string().nullable(),
    location: LocationFilterResultSchema,
    pages: z.array(QueryPageInfoSchema),
    suppliers: z.array(SupplierSummarySchema),
    stats: SearchStatsSchema,
  })
  .meta({ id: 'SearchSuppliersResponse' });

export type SearchSuppliersResponse = z.infer<typeof SearchSuppliersResponseSchema>;

export const SuppliersListQuerySchema = z
  .object({
    queryId: QueryIdSchema,
    page: PageSchema,
    refresh: BooleanQuerySchema,
  })
  .meta({ id: 'SuppliersListQuery' });

export const SuppliersListResponseSchema = z
  .object({
    queryId: QueryIdSchema,
    page: z.number().int().min(1),
    pageSize: z.number().int().positive(),
    totalCount: z.number().int().nullable().default(null),
    suppliers: z.array(SupplierSummarySchema),
    hasMore: z.boolean(),
    fetchedPages: z.array(z.number().int().min(1)),
    location: LocationFilterResultSchema,
  })
  .meta({ id: 'SuppliersListResponse' });

export const QueryRecordSchema = z
  .object({
    queryId: QueryIdSchema,
    specJson: z.string(),
    keyword: z.string().nullable(),
    province: z.string().nullable(),
    city: z.string().nullable(),
    locationMode: LocationModeSchema,
    filtersJson: z.string(),
    country: z.string(),
    pagesRequested: z.number().int().min(1),
    pagesFetched: z.array(z.number().int().min(1)),
    totalCount: z.number().int().nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .meta({ id: 'QueryRecord' });

export type QueryRecord = z.infer<typeof QueryRecordSchema>;

export type QueryPageInfo = z.infer<typeof QueryPageInfoSchema>;
export type LocationFilterResult = z.infer<typeof LocationFilterResultSchema>;
export type SearchStats = z.infer<typeof SearchStatsSchema>;
export type SuppliersListResponse = z.infer<typeof SuppliersListResponseSchema>;
