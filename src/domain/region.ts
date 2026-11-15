/**
 * 地区字典（中国内地 31 省级行政区 + 地级行政单位）
 *
 * 说明：平台没有省/市筛选，地区用于客户端 strict 回填过滤与 keyword 模式拼词。
 */
import { z } from 'zod';

export const RegionLevelSchema = z.enum(['province', 'city']).meta({ id: 'RegionLevel' });

export const RegionSchema = z
  .object({
    code: z.string().meta({ description: 'GB 行政区划代码风格：CN-13 / CN-13-1311' }),
    level: RegionLevelSchema,
    nameZh: z.string(),
    nameEn: z.string().meta({ description: '英文展示名（阿里页面口径，如 Hebei / Hengshui）' }),
    pinyin: z.string(),
    aliases: z.array(z.string()).default([]),
    aliSpellings: z.array(z.string()).default([]).meta({ description: '在阿里页面上出现过的拼写（含噪声拼写映射）' }),
    parentCode: z.string(),
  })
  .meta({ id: 'Region' });

export type Region = z.infer<typeof RegionSchema>;

export const RegionsQuerySchema = z
  .object({
    level: RegionLevelSchema.optional(),
    province: z.string().optional().meta({ description: '省份（中文/英文/拼音/代码）' }),
  })
  .meta({ id: 'RegionsQuery' });

export const RegionsResponseSchema = z
  .object({
    level: RegionLevelSchema.optional(),
    province: RegionSchema.nullable().optional(),
    items: z.array(RegionSchema),
    count: z.number().int().nonnegative(),
  })
  .meta({ id: 'RegionsResponse' });

export const RegionSearchQuerySchema = z
  .object({
    q: z.string().min(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .meta({ id: 'RegionSearchQuery' });

export const RegionSearchResponseSchema = z
  .object({
    query: z.string(),
    items: z.array(RegionSchema),
    count: z.number().int().nonnegative(),
  })
  .meta({ id: 'RegionSearchResponse' });

export type RegionsResponse = z.infer<typeof RegionsResponseSchema>;
export type RegionSearchResponse = z.infer<typeof RegionSearchResponseSchema>;
export type RegionsQuery = z.infer<typeof RegionsQuerySchema>;
export type RegionSearchQuery = z.infer<typeof RegionSearchQuerySchema>;
