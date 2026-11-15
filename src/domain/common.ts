/**
 * 通用基础类型与 zod schema（单一事实源）
 */
import { z } from 'zod';

export const IsoDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/, 'must be ISO-8601 with timezone')
  .meta({ id: 'IsoDateTime', description: 'ISO-8601 日期时间（含时区）' });

export const NonEmptyStringSchema = z.string().min(1);
export const UrlSchema = z.string().url();

export const PageSchema = z.coerce.number().int().min(1).default(1).meta({ description: '页码，从 1 开始' });
export const PageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(20)
  .meta({ description: '每页条数（上游固定 20，本字段仅回显）' });
export const PagesSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(20)
  .default(5)
  .meta({ description: '本次抓取页数，默认 5，硬上限 20' });
export const MaxEnrichSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(300)
  .default(60)
  .meta({ description: 'strict 模式详情回填上限（默认 60）' });

/** REST query 里的 boolean：接受 true/false 字符串或布尔 */
export const BooleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true')
  .default(false);

export const CompanyIdSchema = z
  .string()
  .regex(/^\d{4,20}$/, 'companyId must be numeric')
  .meta({ id: 'CompanyId', description: '阿里巴巴供应商 companyId（数字字符串）' });

export const StoreSubdomainSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,60}$/, 'invalid store subdomain')
  .meta({ id: 'StoreSubdomain', description: '供应商店铺子域（如 kangyuanxiangsu）' });

export const QueryIdSchema = z
  .string()
  .regex(/^q_[0-9a-f]{16}$/, 'invalid queryId')
  .meta({ id: 'QueryId', description: '搜索查询 ID（q_ + sha256 前 16 位 hex）' });

export const RegionCodeSchema = z
  .string()
  .regex(/^CN(?:-\d{2,6}){0,2}$/, 'invalid region code')
  .meta({ id: 'RegionCode', description: '地区代码：CN / CN-13 / CN-13-1311' });

export const LoginIdSchema = z
  .string()
  .regex(/^login_[A-Za-z0-9_-]{8,64}$/, 'invalid loginId')
  .meta({ id: 'LoginId', description: '登录流程 ID' });

export const RequestIdSchema = z.string().min(8).meta({ description: '请求 ID，用于日志追踪' });

export const ModeSchema = z
  .enum(['logged_in', 'anonymous', 'degraded'])
  .meta({ id: 'Mode', description: '当前模式：已登录 / 匿名 / 降级（风控冷却或需人工验证）' });

export const LocationModeSchema = z
  .enum(['strict', 'keyword', 'off'])
  .default('strict')
  .meta({ id: 'LocationMode', description: '省市过滤模式：strict 详情回填精确过滤 / keyword 地点关键词模糊 / off 不过滤' });

export const MembershipPlanSchema = z
  .enum(['verified_pro', 'verified_supplier', 'gold_supplier', 'unknown'])
  .meta({ id: 'MembershipPlan', description: '会员档位：verified_pro 领袖卖家 / verified_supplier 金品诚企 / gold_supplier 出口通 / unknown' });

export const SortTypeSchema = z
  .enum(['default', 'resrat'])
  .default('default')
  .meta({ id: 'SortType', description: '搜索排序：default 最佳匹配 / resrat 回复率' });

/** 解析上游 "6 yrs" / "6 年" 之类文本为整数 */
export function parseYears(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? Math.max(0, Math.trunc(text)) : null;
  const m = /(\d{1,3})/.exec(String(text));
  return m ? Number(m[1]) : null;
}

export function maskToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  if (token.length <= 8) return '***';
  return `${token.slice(0, 4)}***${token.slice(-4)}`;
}
