/**
 * 登录（可选）与人机验证（滑块）模型
 *
 * v1 anonymous-first：登录不是必需；验证用于自动化恢复（导航触发滑块时）。
 */
import { z } from 'zod';
import { IsoDateTimeSchema, LoginIdSchema } from './common.js';

export const LoginModeSchema = z.enum(['manual']).meta({ id: 'LoginMode', description: 'v1 仅支持 manual（打开浏览器窗口人工登录一次）' });

export const LoginStartRequestSchema = z
  .object({ mode: LoginModeSchema.default('manual') })
  .meta({ id: 'LoginStartRequest' });

export const LoginStatusSchema = z
  .object({
    state: z.enum(['pending', 'logged_in', 'timeout', 'failed', 'cancelled']),
    action: z.enum(['enter_credentials', 'solve_captcha', 'none']).default('none'),
    loginId: LoginIdSchema,
    loginUrl: z.string(),
    screenshotPath: z.string().nullable().default(null),
    expiresAt: IsoDateTimeSchema,
    message: z.string().nullable().default(null),
  })
  .meta({ id: 'LoginStatus' });

export const VerificationTrackSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    viewport: z.string(),
  })
  .meta({ id: 'VerificationTrack' });

export const VerificationHandleSchema = z
  .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
  .meta({ id: 'VerificationHandle' });

export const VerificationStatusSchema = z
  .object({
    required: z.boolean(),
    type: z.enum(['slider', 'qr', 'unknown']).default('unknown'),
    pageUrl: z.string().nullable().default(null),
    screenshotPath: z.string().nullable().default(null),
    track: VerificationTrackSchema.nullable().default(null),
    handle: VerificationHandleSchema.nullable().default(null),
    autoSolveSupported: z.boolean().default(false),
    attempts: z.number().int().nonnegative().default(0),
    expiresAt: IsoDateTimeSchema.nullable().default(null),
    message: z.string().nullable().default(null),
  })
  .meta({ id: 'VerificationStatus' });

export const VerificationSolveRequestSchema = z
  .object({
    mode: z.enum(['auto', 'drag']).default('auto'),
    from: z.tuple([z.number(), z.number()]).optional().meta({ description: 'drag 模式起点 [x,y]' }),
    to: z.tuple([z.number(), z.number()]).optional().meta({ description: 'drag 模式终点 [x,y]' }),
    durationMs: z.number().int().min(100).max(10000).default(900),
  })
  .meta({ id: 'VerificationSolveRequest' });

export const VerificationAttemptSchema = z.object({
  n: z.number().int().positive(),
  solved: z.boolean(),
  detail: z.string().nullable().default(null),
  elapsedMs: z.number().int().nonnegative().default(0),
});

export const VerificationSolveResponseSchema = z
  .object({
    solved: z.boolean(),
    attempts: z.array(VerificationAttemptSchema),
    elapsedMs: z.number().int().nonnegative(),
    x5secExpiresAt: IsoDateTimeSchema.nullable().default(null),
  })
  .meta({ id: 'VerificationSolveResponse' });

export const LoginCancelResponseSchema = z
  .object({ cancelled: z.literal(true), loginId: LoginIdSchema })
  .meta({ id: 'LoginCancelResponse' });

export type LoginMode = z.infer<typeof LoginModeSchema>;
export type LoginStartRequest = z.infer<typeof LoginStartRequestSchema>;
export type LoginStatus = z.infer<typeof LoginStatusSchema>;
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
export type VerificationSolveRequest = z.infer<typeof VerificationSolveRequestSchema>;
export type VerificationSolveResponse = z.infer<typeof VerificationSolveResponseSchema>;
export type LoginCancelResponse = z.infer<typeof LoginCancelResponseSchema>;
