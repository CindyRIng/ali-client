/**
 * 认证工厂目录（/factory/index.html 页面数据，仅省、≈500 上限）
 */
import { z } from 'zod';
import { BooleanQuerySchema, IsoDateTimeSchema } from './common.js';

export const FactoryProductSchema = z
  .object({
    title: z.string().nullable().default(null),
    imageUrl: z.string().nullable().default(null),
    url: z.string().nullable().default(null),
  })
  .meta({ id: 'FactoryProduct' });

export const FactoryItemSchema = z
  .object({
    companyId: z.string(),
    companyName: z.string(),
    companyUrl: z.string().nullable().default(null),
    countryCode: z.string().default('CN'),
    province: z.string().nullable().default(null),
    goldSupplierYears: z.number().int().nullable().default(null),
    goldSupplierYearsText: z.string().nullable().default(null),
    assessedSupplier: z.boolean().default(false),
    tradeAssurance: z.boolean().default(false),
    rate: z.number().nullable().default(null),
    reviews: z.number().int().nullable().default(null),
    onTimeShipping: z.string().nullable().default(null),
    responseTime: z.string().nullable().default(null),
    employeesText: z.string().nullable().default(null),
    factorySizeText: z.string().nullable().default(null),
    products: z.array(FactoryProductSchema).default([]),
  })
  .meta({ id: 'FactoryItem' });

export const FactoriesQuerySchema = z
  .object({
    province: z.string().optional(),
    categoryId: z.string().default('0'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(100),
    refresh: BooleanQuerySchema,
  })
  .meta({ id: 'FactoriesQuery' });

export const FactoriesResponseSchema = z
  .object({
    province: z.string().nullable().default(null),
    provinceCode: z.string().nullable().default(null),
    categoryId: z.string().default('0'),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    upstreamTotal: z.number().int().nullable().default(null),
    capped: z.boolean().default(true),
    items: z.array(FactoryItemSchema),
    fetchedAt: IsoDateTimeSchema,
    note: z.string().default('Upstream caps at ~500 manufacturers; city is not available on this directory.'),
  })
  .meta({ id: 'FactoriesResponse' });

export type FactoryItem = z.infer<typeof FactoryItemSchema>;
export type FactoryProduct = z.infer<typeof FactoryProductSchema>;
export type FactoriesQuery = z.infer<typeof FactoriesQuerySchema>;
export type FactoriesResponse = z.infer<typeof FactoriesResponseSchema>;
