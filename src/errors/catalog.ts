/**
 * 统一错误码目录（REST / CLI / MCP 共用）
 *
 * 与 docs/02-接口草案.md §0.3 对齐。
 */
import { z } from 'zod';

export interface ErrorCodeMeta {
  readonly http: number;
  readonly retryable: boolean;
  readonly title: string;
  readonly description: string;
}

export const ERROR_CATALOG = {
  INVALID_ARGUMENT: { http: 400, retryable: false, title: '参数错误', description: '请求参数不合法（格式/范围/必填项/地区归一化失败）' },
  VALIDATION_FAILED: { http: 422, retryable: false, title: '校验失败', description: '请求参数 JSON Schema 校验未通过，details 内给出字段级问题' },
  UNAUTHENTICATED: { http: 401, retryable: false, title: '未授权', description: 'REST/MCP 鉴权失败（Bearer token 缺失或错误）' },
  LOGIN_REQUIRED: { http: 409, retryable: true, title: '需要登录', description: '上游要求登录；v1 匿名模式一般无需登录' },
  LOGIN_EXPIRED: { http: 410, retryable: false, title: '登录过期', description: '登录流程已过期或被取消' },
  LOGIN_CANCELLED: { http: 409, retryable: false, title: '登录已取消', description: '登录流程已被取消' },
  NOT_FOUND: { http: 404, retryable: false, title: '不存在', description: '供应商 / 查询 / 资源不存在' },
  CAPTCHA_REQUIRED: { http: 409, retryable: true, title: '需要人机验证', description: '触发滑块验证；details 内含截图路径、轨道/手柄坐标与恢复方式' },
  CAPTCHA_FAILED: { http: 409, retryable: true, title: '人机验证失败', description: '自动/人工过验证失败；details 可含新截图' },
  RISK_COOLDOWN: { http: 429, retryable: true, title: '风控冷却', description: '连续失败进入冷却；details.cooldownUntil 给出恢复时间' },
  RATE_LIMITED: { http: 429, retryable: true, title: '限频', description: '触发本地限频或上游限流，按 retryAfterMs 退避' },
  PAGE_NOT_AVAILABLE: { http: 409, retryable: true, title: '页不可用', description: '请求页超出查询已抓范围；可提高 pages 或 refresh' },
  BAD_STATE: { http: 409, retryable: true, title: '状态异常', description: '浏览器 / 会话 / profile 状态异常（如被占用、崩溃）' },
  ALREADY_RUNNING: { http: 409, retryable: false, title: '已在运行', description: '同一 profile 已有 owner 进程在运行（单实例约束）' },
  HEADFUL_REQUIRED: { http: 409, retryable: false, title: '需要 headful 浏览器', description: '当前操作需要可用的 DISPLAY（登录/验证码中继）' },
  FORBIDDEN: { http: 403, retryable: false, title: '无权限', description: '账号无权限或上游风控拒绝' },
  METHOD_NOT_ALLOWED: { http: 405, retryable: false, title: '方法不允许', description: 'HTTP 方法不匹配' },
  CONFLICT: { http: 409, retryable: false, title: '状态冲突', description: '当前状态不允许该操作' },
  UPSTREAM_ERROR: { http: 502, retryable: true, title: '上游错误', description: '上游 4xx/5xx 或结构变化' },
  UPSTREAM_CHANGED: { http: 502, retryable: false, title: '上游改版', description: '页面结构 / 接口字段变化导致解析失败' },
  UPSTREAM_BLOCKED: { http: 502, retryable: true, title: '上游风控拦截', description: '风控拦截；冷却后可重试' },
  UPSTREAM_TIMEOUT: { http: 504, retryable: true, title: '上游超时', description: '页面 / 接口响应超时或 fetch 挂起（watchdog）' },
  UPSTREAM_UNAVAILABLE: { http: 503, retryable: true, title: '上游不可用', description: '网络异常 / alibaba.com 不可达' },
  SERVICE_UNAVAILABLE: { http: 503, retryable: true, title: '常驻服务不可达', description: '本地 ali-client REST 服务未启动或不可达' },
  CACHE_ERROR: { http: 500, retryable: false, title: '缓存错误', description: 'SQLite 读写失败' },
  NOT_IMPLEMENTED: { http: 501, retryable: false, title: '未实现', description: '该能力尚未实现（如 search.batch）' },
  INTERNAL_ERROR: { http: 500, retryable: false, title: '内部错误', description: '未分类的客户端内部错误' },
} as const satisfies Record<string, ErrorCodeMeta>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export const ErrorCodeSchema = z
  .enum(Object.keys(ERROR_CATALOG) as [ErrorCode, ...ErrorCode[]])
  .meta({ id: 'ErrorCode', description: '统一错误码' });

export class AliError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly retryAfterMs?: number;
  override readonly cause?: unknown;

  constructor(
    code: ErrorCode,
    message?: string,
    opts: { details?: Record<string, unknown>; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message ?? ERROR_CATALOG[code].title);
    this.name = 'AliError';
    this.code = code;
    this.details = opts.details;
    this.retryAfterMs = opts.retryAfterMs;
    this.cause = opts.cause;
  }

  get retryable(): boolean {
    return ERROR_CATALOG[this.code].retryable;
  }

  get httpStatus(): number {
    return ERROR_CATALOG[this.code].http;
  }

  toJSON(): {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.retryAfterMs !== undefined ? { retryAfterMs: this.retryAfterMs } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function asAliError(err: unknown): AliError {
  if (err instanceof AliError) return err;
  if (err instanceof z.ZodError) {
    return new AliError('VALIDATION_FAILED', 'request validation failed', { details: { issues: err.issues } });
  }
  return new AliError('INTERNAL_ERROR', err instanceof Error ? err.message : String(err), { cause: err });
}
