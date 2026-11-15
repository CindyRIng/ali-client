/**
 * 缓存统计 / 清理模型
 */
import { z } from 'zod';

export const CacheStatsSchema = z
  .object({
    driver: z.enum(['sqlite', 'memory']),
    queries: z.object({
      count: z.number().int().nonnegative(),
      oldestAt: z.string().nullable().default(null),
    }),
    suppliers: z.object({ count: z.number().int().nonnegative() }),
    details: z.object({ count: z.number().int().nonnegative(), expired: z.number().int().nonnegative() }),
    factories: z.object({ count: z.number().int().nonnegative() }),
    bytes: z.number().int().nonnegative(),
  })
  .meta({ id: 'CacheStats' });

export const CacheClearQuerySchema = z
  .object({
    kind: z.enum(['all', 'queries', 'suppliers', 'details', 'factories']).default('all'),
  })
  .meta({ id: 'CacheClearQuery' });

export const CacheClearResultSchema = z
  .object({
    deleted: z.object({
      queries: z.number().int().nonnegative(),
      suppliers: z.number().int().nonnegative(),
      details: z.number().int().nonnegative(),
      factories: z.number().int().nonnegative(),
    }),
  })
  .meta({ id: 'CacheClearResult' });

export type CacheStats = z.infer<typeof CacheStatsSchema>;
export type CacheClearQuery = z.infer<typeof CacheClearQuerySchema>;
export type CacheClearResult = z.infer<typeof CacheClearResultSchema>;
