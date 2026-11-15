/**
 * 状态 / 健康检查模型
 */
import { z } from 'zod';
import { IsoDateTimeSchema } from './common.js';

export const HealthResponseSchema = z
  .object({
    service: z.literal('ali-client'),
    status: z.literal('ok'),
    version: z.string(),
    uptimeMs: z.number().int().nonnegative(),
  })
  .meta({ id: 'HealthResponse' });

export const RiskStateSchema = z
  .enum(['normal', 'captcha', 'solving', 'cooling', 'degraded'])
  .meta({ id: 'RiskState' });

export const StatusSchema = z
  .object({
    mode: z.enum(['logged_in', 'anonymous', 'degraded']),
    loggedIn: z.boolean(),
    account: z
      .object({ displayName: z.string().nullable().default(null), country: z.string().nullable().default(null) })
      .nullable()
      .default(null),
    language: z.string(),
    profile: z.object({
      dir: z.string(),
      present: z.boolean(),
      lockedByPid: z.number().int().nullable().default(null),
    }),
    browser: z.object({
      running: z.boolean(),
      pid: z.number().int().nullable().default(null),
      headless: z.boolean(),
      uptimeMs: z.number().int().nonnegative().default(0),
    }),
    worker: z.object({
      url: z.string().nullable().default(null),
      ready: z.boolean().default(false),
      fetchHealthy: z.boolean().default(true),
      lastFetchHungAt: IsoDateTimeSchema.nullable().default(null),
    }),
    risk: z.object({
      state: RiskStateSchema,
      x5secExpiresAt: IsoDateTimeSchema.nullable().default(null),
      cooldownUntil: IsoDateTimeSchema.nullable().default(null),
      captchaRequired: z.boolean().default(false),
      lastSolvedAt: IsoDateTimeSchema.nullable().default(null),
      lastError: z.string().nullable().default(null),
    }),
    upstream: z.object({
      requestsLast10Min: z.number().int().nonnegative().default(0),
      lastPageNavAt: IsoDateTimeSchema.nullable().default(null),
      lastFetchAt: IsoDateTimeSchema.nullable().default(null),
      lastDetailAt: IsoDateTimeSchema.nullable().default(null),
      events: z
        .array(
          z.object({
            at: IsoDateTimeSchema,
            kind: z.string(),
            detail: z.string().nullable().default(null),
          }),
        )
        .default([]),
    }),
    cache: z.object({
      driver: z.string(),
      queries: z.number().int().nonnegative(),
      suppliers: z.number().int().nonnegative(),
      details: z.number().int().nonnegative(),
      factories: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
    }),
    version: z.string(),
  })
  .meta({ id: 'Status' });

export type Status = z.infer<typeof StatusSchema>;
export type RiskState = z.infer<typeof RiskStateSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
