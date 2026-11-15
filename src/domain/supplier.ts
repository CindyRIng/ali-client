/**
 * 供应商领域模型（列表摘要 / 公司详情）
 */
import { z } from 'zod';
import { IsoDateTimeSchema } from './common.js';
import { MembershipSchema } from './membership.js';

export const LocationConfidenceSchema = z.enum(['high', 'medium', 'low', 'unknown']).meta({ id: 'LocationConfidence' });

export const LocationSchema = z
  .object({
    country: z.string().default('CN'),
    countryName: z.string().optional(),
    province: z.string().nullable().default(null),
    provinceCode: z.string().nullable().default(null),
    city: z.string().nullable().default(null),
    cityCode: z.string().nullable().default(null),
    address: z.string().nullable().default(null),
    display: z.string().nullable().default(null),
    confidence: LocationConfidenceSchema.default('unknown'),
    source: z.enum(['detail', 'list', 'keyword', 'none']).default('none'),
  })
  .meta({ id: 'Location' });

export type SupplierLocation = z.infer<typeof LocationSchema>;

export const SupplierIndexSchema = z
  .object({
    stars: z.number().int().min(0).max(5).nullable(),
    maxStars: z.number().int().min(1).max(5).default(5),
    label: z.string().default('Supplier Index'),
    source: z.string().nullable().default(null),
  })
  .meta({ id: 'SupplierIndex' });

export const BusinessTypeSchema = z
  .object({
    raw: z.string().nullable().default(null),
    manufacturer: z.boolean().nullable().default(null),
    tradingCompany: z.boolean().nullable().default(null),
  })
  .meta({ id: 'BusinessType' });

export const RatingSchema = z
  .object({
    score: z.number().min(0).max(5).nullable().default(null),
    count: z.number().int().nonnegative().nullable().default(null),
  })
  .meta({ id: 'Rating' });

export const SupplierSummarySchema = z
  .object({
    companyId: z.string(),
    companyName: z.string(),
    storeUrl: z.string().nullable().default(null),
    storeSubdomain: z.string().nullable().default(null),
    logoUrl: z.string().nullable().default(null),
    country: z.string().default('CN'),
    location: LocationSchema,
    joinedYears: z.number().int().nullable().default(null),
    joinedYearsText: z.string().nullable().default(null),
    supplierIndex: SupplierIndexSchema.nullable().default(null),
    membership: MembershipSchema,
    mainProducts: z.array(z.string()).default([]),
    mainProductsText: z.string().nullable().default(null),
    rating: RatingSchema,
    businessType: BusinessTypeSchema,
    staffText: z.string().nullable().default(null),
    factoryAreaText: z.string().nullable().default(null),
    transactionsText: z.string().nullable().default(null),
    responseTime: z.string().nullable().default(null),
    capabilityTags: z.array(z.string()).default([]),
    rank: z.number().int().nullable().default(null),
    isAd: z.boolean().default(false),
    adType: z.enum(['top_sponsor', 'p4p']).nullable().default(null),
    position: z.number().int().nonnegative().default(0),
    enriched: z.boolean().default(false),
  })
  .meta({ id: 'SupplierSummary' });

export type SupplierSummary = z.infer<typeof SupplierSummarySchema>;

export const SupplierIdentitySchema = z
  .object({
    key: z.string().nullable().default(null),
    name: z.string().nullable().default(null),
    nameZh: z.string().nullable().default(null),
    verified: z.boolean().nullable().default(null),
    description: z.string().nullable().default(null),
  })
  .meta({ id: 'SupplierIdentity' });

export const SupplierProfileSchema = z
  .object({
    establishedYear: z.number().int().nullable().default(null),
    annualRevenue: z
      .object({
        value: z.string().nullable().default(null),
        kind: z.enum(['number', 'range', 'unknown']).default('unknown'),
      })
      .nullable()
      .default(null),
    employees: z.string().nullable().default(null),
    mainMarkets: z.array(z.string()).default([]),
    paymentMethods: z.string().nullable().default(null),
    deliveryTerms: z.string().nullable().default(null),
    contractManufacturing: z.array(z.string()).default([]),
    description: z.string().nullable().default(null),
    advantageDescription: z.string().nullable().default(null),
    capacityTags: z.array(z.string()).default([]),
    source: z.string().default('companyOverview'),
  })
  .meta({ id: 'SupplierProfile' });

export const SupplierPerformanceSchema = z
  .object({
    storeRating: RatingSchema,
    onTimeDeliveryRate: z.string().nullable().default(null),
    responseTime: z.string().nullable().default(null),
    responseRate: z.string().nullable().default(null),
    totalExportRevenueUSD: z.number().nullable().default(null),
    totalExportRevenueText: z.string().nullable().default(null),
    floorSpaceM2: z.number().nullable().default(null),
    floorSpaceText: z.string().nullable().default(null),
    productionLines: z.number().int().nullable().default(null),
    factoryRank: z
      .object({ text: z.string().nullable().default(null), url: z.string().nullable().default(null) })
      .nullable()
      .default(null),
    topMarkets: z
      .array(
        z.object({
          market: z.string(),
          percent: z.number().nullable().default(null),
          products: z.array(z.string()).default([]),
        }),
      )
      .default([]),
  })
  .meta({ id: 'SupplierPerformance' });

export const SupplierCapabilitiesSchema = z
  .object({
    customization: z.array(z.string()).default([]),
    qualityControl: z.array(z.string()).default([]),
    assessmentTags: z.array(z.string()).default([]),
    serviceTags: z.array(z.string()).default([]),
  })
  .meta({ id: 'SupplierCapabilities' });

export const SupplierTrustSchema = z
  .object({
    tradeAssurance: z
      .object({
        enabled: z.boolean().default(false),
        amountText: z.string().nullable().default(null),
        creditLevel: z.number().int().nullable().default(null),
        hasOrderYear: z.boolean().nullable().default(null),
      })
      .meta({ id: 'TradeAssurance' }),
    baseVerify: z.boolean().nullable().default(null),
    onsiteAssessment: z.boolean().nullable().default(null),
    assessedBy: z.string().nullable().default(null),
    verifiedSupplier: z.boolean().default(false),
    verifiedPro: z.boolean().default(false),
  })
  .meta({ id: 'SupplierTrust' });

export const SupplierDetailSchema = SupplierSummarySchema.extend({
  identity: SupplierIdentitySchema,
  profile: SupplierProfileSchema,
  performance: SupplierPerformanceSchema,
  capabilities: SupplierCapabilitiesSchema,
  trust: SupplierTrustSchema,
  fetchedAt: IsoDateTimeSchema,
  raw: z.record(z.string(), z.unknown()).default({}),
}).meta({ id: 'SupplierDetail' });

export type SupplierDetail = z.infer<typeof SupplierDetailSchema>;

export function storeSubdomainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /\/\/([a-z0-9][a-z0-9-]*)\.en\.alibaba\.com/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

export function absoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `https://www.alibaba.com${url}`;
  return url;
}
