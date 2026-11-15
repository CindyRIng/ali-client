/**
 * 操作注册表（单一事实源：REST 路由 / CLI / MCP / 文档生成）
 */
import { z } from 'zod';
import { HealthResponseSchema, StatusSchema } from '../domain/status.js';
import {
  LoginCancelResponseSchema,
  LoginStartRequestSchema,
  LoginStatusSchema,
  VerificationSolveRequestSchema,
  VerificationSolveResponseSchema,
  VerificationStatusSchema,
} from '../domain/session.js';
import {
  FactoriesQuerySchema,
  FactoriesResponseSchema,
} from '../domain/factories.js';
import {
  RegionSearchQuerySchema,
  RegionSearchResponseSchema,
  RegionsQuerySchema,
  RegionsResponseSchema,
} from '../domain/region.js';
import {
  SearchSuppliersRequestSchema,
  SearchSuppliersResponseSchema,
  SuppliersListQuerySchema,
  SuppliersListResponseSchema,
} from '../domain/query.js';
import {
  CompanyIdSchema,
  StoreSubdomainSchema,
  BooleanQuerySchema,
  LoginIdSchema,
} from '../domain/common.js';
import { SupplierDetailSchema } from '../domain/supplier.js';
import { MembershipCatalogSchema } from '../domain/membership.js';
import { CacheClearQuerySchema, CacheClearResultSchema, CacheStatsSchema } from '../domain/cache.js';

export interface OperationDef {
  id: string;
  summary: string;
  auth: 'none' | 'bearer';
  rest: {
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    pathParams?: z.ZodTypeAny;
    query?: z.ZodTypeAny;
    body?: z.ZodTypeAny;
  };
  cli: { command: string; description: string; example?: string };
  mcp: { name: string; description: string };
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
}

const Empty = z.object({}).strict();

export const CompanyDetailQuerySchema = z
  .object({
    refresh: BooleanQuerySchema,
  })
  .meta({ id: 'CompanyDetailQuery' });

export const SupplierDetailInputSchema = z
  .object({
    companyId: CompanyIdSchema.optional(),
    store: StoreSubdomainSchema.optional(),
    refresh: BooleanQuerySchema,
  })
  .refine((v) => !!v.companyId || !!v.store, { message: 'companyId or store is required' })
  .meta({ id: 'SupplierDetailInput' });

export const LoginStatusQuerySchema = z.object({ loginId: LoginIdSchema }).meta({ id: 'LoginStatusQuery' });

export const OPERATIONS: OperationDef[] = [
  {
    id: 'health.get',
    summary: '健康检查',
    auth: 'none',
    rest: { method: 'GET', path: '/v1/health' },
    cli: { command: 'health', description: '健康检查', example: 'ali health' },
    mcp: { name: 'ali_health', description: '健康检查（进程存活）' },
    input: Empty,
    output: HealthResponseSchema,
  },
  {
    id: 'status.get',
    summary: '运行状态（浏览器/登录/风控/缓存/限频）',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/status' },
    cli: { command: 'status', description: '查看登录态、浏览器/worker、风控、缓存与限频', example: 'ali status' },
    mcp: { name: 'ali_status', description: '运行状态：模式/浏览器/worker/风控(x5sec)/缓存/限频' },
    input: Empty,
    output: StatusSchema,
  },
  {
    id: 'session.login.start',
    summary: '打开登录窗口（可选；anonymous-first）',
    auth: 'bearer',
    rest: { method: 'POST', path: '/v1/session/login', body: LoginStartRequestSchema },
    cli: { command: 'login', description: '打开 owner 浏览器登录页（可选，人工登录一次）', example: 'ali login' },
    mcp: { name: 'ali_login', description: '打开登录窗口（可选）；anonymous-first 下 v1 无需登录' },
    input: LoginStartRequestSchema,
    output: LoginStatusSchema,
  },
  {
    id: 'session.login.status',
    summary: '查询登录流程状态',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/session/login/status', query: LoginStatusQuerySchema },
    cli: { command: 'login status', description: '查询登录状态', example: 'ali login status login_xxx' },
    mcp: { name: 'ali_login_status', description: '查询登录状态' },
    input: LoginStatusQuerySchema,
    output: LoginStatusSchema,
  },
  {
    id: 'session.login.cancel',
    summary: '取消登录流程',
    auth: 'bearer',
    rest: { method: 'DELETE', path: '/v1/session/login/{loginId}', pathParams: z.object({ loginId: LoginIdSchema }) },
    cli: { command: 'login cancel', description: '取消登录流程', example: 'ali login cancel login_xxx' },
    mcp: { name: 'ali_login_cancel', description: '取消登录流程' },
    input: z.object({ loginId: LoginIdSchema }),
    output: LoginCancelResponseSchema,
  },
  {
    id: 'verification.get',
    summary: '查询待处理滑块验证（截图/坐标）',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/verification' },
    cli: { command: 'verify status', description: '查看当前滑块验证信息', example: 'ali verify status' },
    mcp: { name: 'ali_verification_get', description: '查看待处理滑块验证（截图路径/轨道/手柄坐标）' },
    input: Empty,
    output: VerificationStatusSchema,
  },
  {
    id: 'verification.solve',
    summary: '自动/坐标中继过滑块验证',
    auth: 'bearer',
    rest: { method: 'POST', path: '/v1/verification/solve', body: VerificationSolveRequestSchema },
    cli: {
      command: 'verify solve',
      description: '自动过滑块（--mode auto）或坐标中继（--mode drag --from x,y --to x,y）',
      example: 'ali verify solve --mode auto',
    },
    mcp: { name: 'ali_verification_solve', description: '自动/坐标中继过滑块验证' },
    input: VerificationSolveRequestSchema,
    output: VerificationSolveResponseSchema,
  },
  {
    id: 'regions.list',
    summary: '省/市字典',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/regions', query: RegionsQuerySchema },
    cli: { command: 'regions list', description: '省/市字典（31 省 + 地级市）', example: 'ali regions list --level city --province Hebei' },
    mcp: { name: 'ali_regions', description: '省/市字典（中国内地 31 省 + 地级市）' },
    input: RegionsQuerySchema,
    output: RegionsResponseSchema,
  },
  {
    id: 'regions.search',
    summary: '地区搜索（中文/英文/拼音）',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/regions/search', query: RegionSearchQuerySchema },
    cli: { command: 'regions search', description: '按中文/英文/拼音搜索地区', example: 'ali regions search 衡水' },
    mcp: { name: 'ali_region_search', description: '按中文/英文/拼音搜索地区' },
    input: RegionSearchQuerySchema,
    output: RegionSearchResponseSchema,
  },
  {
    id: 'search.suppliers',
    summary: '按关键词 + 省/市搜索供应商（建 queryId）',
    auth: 'bearer',
    rest: { method: 'POST', path: '/v1/search/suppliers', body: SearchSuppliersRequestSchema },
    cli: {
      command: 'search suppliers',
      description: '供应商搜索：关键词 + 省/市 + 筛选 + 多页',
      example: 'ali search suppliers --keyword "solid tire" --province Hebei --city Hengshui --pages 2',
    },
    mcp: {
      name: 'ali_search_suppliers',
      description: '搜索阿里国际站供应商：关键词 + 中国省/市（strict 精确回填过滤 / keyword 模糊）+ 筛选 + 多页；返回 queryId 与列表',
    },
    input: SearchSuppliersRequestSchema,
    output: SearchSuppliersResponseSchema,
  },
  {
    id: 'suppliers.list',
    summary: '按 queryId 翻页',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/suppliers', query: SuppliersListQuerySchema },
    cli: { command: 'suppliers list', description: '按 queryId 翻页', example: 'ali suppliers list --query-id q_xxx --page 2' },
    mcp: { name: 'ali_list_suppliers', description: '按 queryId 翻页（缓存优先）' },
    input: SuppliersListQuerySchema,
    output: SuppliersListResponseSchema,
  },
  {
    id: 'suppliers.detail',
    summary: '供应商详情（年限/Supplier Index/主营产品/会员/省市）',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/suppliers/{companyId}', pathParams: z.object({ companyId: CompanyIdSchema }), query: CompanyDetailQuerySchema },
    cli: {
      command: 'suppliers detail',
      description: '供应商详情（含上平台年限、Supplier Index 星级、主营产品、会员、省市、经营指标）',
      example: 'ali suppliers detail --company-id 258180302',
    },
    mcp: {
      name: 'ali_supplier_detail',
      description: '供应商详情：上平台年限、Supplier Index 星级、主营产品、会员档位与证据、省市、基础经营指标',
    },
    input: SupplierDetailInputSchema,
    output: SupplierDetailSchema,
  },
  {
    id: 'factories.list',
    summary: '认证工厂目录（按省浏览，仅省）',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/factories', query: FactoriesQuerySchema },
    cli: { command: 'factories list', description: '认证工厂目录（按省/类目浏览）', example: 'ali factories list --province Hebei --category 44' },
    mcp: { name: 'ali_factories_list', description: '认证工厂目录（按省/类目浏览；仅省，无城市）' },
    input: FactoriesQuerySchema,
    output: FactoriesResponseSchema,
  },
  {
    id: 'memberships.catalog',
    summary: '会员枚举与识别规则',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/meta/memberships' },
    cli: { command: 'memberships', description: '会员枚举与识别规则', example: 'ali memberships' },
    mcp: { name: 'ali_membership_catalog', description: '会员档位枚举、识别规则、Supplier Index 与注意事项' },
    input: Empty,
    output: MembershipCatalogSchema,
  },
  {
    id: 'cache.stats',
    summary: '缓存统计',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/cache/stats' },
    cli: { command: 'cache stats', description: '缓存统计', example: 'ali cache stats' },
    mcp: { name: 'ali_cache_stats', description: '缓存统计（queries/suppliers/details/factories）' },
    input: Empty,
    output: CacheStatsSchema,
  },
  {
    id: 'cache.clear',
    summary: '清缓存',
    auth: 'bearer',
    rest: { method: 'DELETE', path: '/v1/cache', query: CacheClearQuerySchema },
    cli: { command: 'cache clear', description: '清缓存（--kind all|queries|suppliers|details|factories）', example: 'ali cache clear --kind details' },
    mcp: { name: 'ali_cache_clear', description: '清缓存：kind=all|queries|suppliers|details|factories' },
    input: CacheClearQuerySchema,
    output: CacheClearResultSchema,
  },
];

export function getOperation(id: string): OperationDef {
  const op = OPERATIONS.find((o) => o.id === id);
  if (!op) throw new Error(`unknown operation: ${id}`);
  return op;
}

export function mcpTools(): Array<{ name: string; description: string; input: z.ZodTypeAny; operationId: string }> {
  return OPERATIONS.map((o) => ({ name: o.mcp.name, description: o.mcp.description, input: o.input, operationId: o.id }));
}

export function cliCommands(): Array<{ command: string; description: string; example?: string; operationId: string }> {
  return OPERATIONS.map((o) => ({
    command: `ali ${o.cli.command}`,
    description: o.cli.description,
    ...(o.cli.example ? { example: o.cli.example } : {}),
    operationId: o.id,
  }));
}
