/**
 * CLI（commander）：人/脚本入口；默认代理常驻 REST，`--local` 时直接启动本地 owner
 */
import { Command } from 'commander';
import { createBackend, type Backend } from '../../backend.js';
import { createApp } from '../../app.js';
import { createRestServer } from '../rest/server.js';
import { runMcpServer } from '../mcp/server.js';
import { invoke } from '../../api/dispatch.js';
import { asAliError } from '../../errors/catalog.js';
import { loadConfig, VERSION } from '../../config/schema.js';
import { readOwnerLock } from '../../utils/lock.js';
import type { AliServiceLike } from '../../service-types.js';

type Format = 'table' | 'json' | 'plain';

interface GlobalOptions {
  format: Format;
  apiUrl?: string;
  local?: boolean;
  verbose?: boolean;
}

const program = new Command();

program
  .name('ali')
  .description(
    '阿里国际站 alibaba.com 本机只读客户端：供应商搜索 / 公司详情 / 地区字典 / 会员识别（CLI / REST / MCP / SKILL）',
  )
  .version(VERSION, '-V, --version', '显示版本')
  .option('-f, --format <format>', '输出格式：table | json | plain', 'table')
  .option('--api-url <url>', 'REST 地址（默认 http://127.0.0.1:8792）')
  .option('--local', '跳过 REST 探测，直接启动本地 owner（调试用）')
  .option('--verbose', '输出调试日志', false);

function globals(): GlobalOptions {
  return program.opts<GlobalOptions>();
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function makeEnvelope(opId: string, data: unknown, meta: { cached?: boolean; mode?: string; warnings?: string[] }): unknown {
  return {
    ok: true,
    data,
    meta: {
      schemaVersion: '1.0',
      requestId: `r_cli_${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      tookMs: 0,
      cached: meta.cached ?? false,
      mode: meta.mode,
      warnings: meta.warnings ?? [],
      operation: opId,
    },
    error: null,
  };
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return value + ' '.repeat(width - value.length);
}

function printSupplierTable(suppliers: Array<Record<string, unknown>>): void {
  const rows = suppliers.map((s) => {
    const loc = (s.location ?? {}) as Record<string, unknown>;
    const mem = (s.membership ?? {}) as Record<string, unknown>;
    const idx = (s.supplierIndex ?? null) as { stars?: number | null } | null;
    const rating = (s.rating ?? {}) as { score?: number | null; count?: number | null };
    const where = [loc.province, loc.city].filter(Boolean).join('/') || '—';
    return [
      String(s.rank ?? ''),
      String(s.companyName ?? '').slice(0, 40),
      where.slice(0, 18),
      s.joinedYears === null || s.joinedYears === undefined ? '—' : `${s.joinedYears}y`,
      idx?.stars === null || idx?.stars === undefined ? '—' : `${idx.stars}/5`,
      String(mem.plan ?? ''),
      rating.score === null || rating.score === undefined ? '—' : `${rating.score}/5(${rating.count ?? 0})`,
      s.isAd ? 'AD' : '',
    ];
  });
  const header = ['#', 'company', 'location', 'years', 'index', 'plan', 'rating', 'ad'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length), 4));
  console.log(widths.map((w, i) => pad(header[i], w)).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(widths.map((w, i) => pad(r[i], w)).join('  '));
}

function printOp(opId: string, data: unknown, format: Format, meta: { cached?: boolean; mode?: string; warnings?: string[] }): void {
  if (format === 'json') {
    printJson(makeEnvelope(opId, data, meta));
    return;
  }
  const d = data as Record<string, unknown>;
  if (format === 'plain') {
    const tsv = (rows: string[][]): void => {
      for (const row of rows) console.log(row.join('\t'));
    };
    switch (opId) {
      case 'search.suppliers':
      case 'suppliers.list': {
        const list = (d.suppliers as Array<Record<string, unknown>>) ?? [];
        tsv(
          list.map((s) => {
            const loc = (s.location ?? {}) as Record<string, unknown>;
            const mem = (s.membership ?? {}) as Record<string, unknown>;
            const idx = (s.supplierIndex ?? null) as { stars?: number | null } | null;
            return [
              String(s.companyId),
              String(s.companyName),
              String(loc.province ?? ''),
              String(loc.city ?? ''),
              String(s.joinedYears ?? ''),
              String(idx?.stars ?? ''),
              String(mem.plan ?? ''),
            ];
          }),
        );
        return;
      }
      case 'regions.list':
      case 'regions.search': {
        tsv(((d.items as Array<Record<string, unknown>>) ?? []).map((r) => [String(r.code), String(r.level), String(r.nameEn), String(r.nameZh)]));
        return;
      }
      case 'factories.list': {
        tsv(
          ((d.items as Array<Record<string, unknown>>) ?? []).map((it) => [
            String(it.companyId),
            String(it.companyName),
            String(it.province ?? ''),
            String(it.goldSupplierYears ?? ''),
          ]),
        );
        return;
      }
      case 'suppliers.detail': {
        const loc = (d.location ?? {}) as Record<string, unknown>;
        const mem = (d.membership ?? {}) as Record<string, unknown>;
        const idx = (d.supplierIndex ?? {}) as Record<string, unknown>;
        const rows: Array<[string, unknown]> = [
          ['companyId', d.companyId],
          ['companyName', d.companyName],
          ['province', loc.province],
          ['city', loc.city],
          ['joinedYears', d.joinedYears],
          ['supplierIndexStars', idx.stars],
          ['membershipPlan', mem.plan],
          ['mainProducts', d.mainProductsText],
          ['storeUrl', d.storeUrl],
        ];
        tsv(rows.map(([k, v]) => [k, String(v ?? '')]));
        return;
      }
      default:
        printJson(data);
        return;
    }
  }
  switch (opId) {
    case 'search.suppliers': {
      const loc = (d.location ?? {}) as Record<string, unknown>;
      const stats = (d.stats ?? {}) as Record<string, unknown>;
      console.log(`queryId: ${String(d.queryId)}  keyword: ${String(d.effectiveKeyword)}  mode: ${String(loc.mode)}  cached: ${meta.cached ?? false}`);
      console.log(
        `requested: ${JSON.stringify(loc.requested)}  matched: ${String(loc.matched ?? '-')}  enriched: ${String(loc.enrichedCompanies ?? 0)}  limitReached: ${String(stats.enrichLimitReached ?? false)}`,
      );
      printSupplierTable((d.suppliers as Array<Record<string, unknown>>) ?? []);
      break;
    }
    case 'suppliers.list': {
      console.log(`queryId: ${String(d.queryId)}  page: ${String(d.page)}  total: ${String(d.totalCount ?? '-')}  cached: ${meta.cached ?? false}`);
      printSupplierTable((d.suppliers as Array<Record<string, unknown>>) ?? []);
      break;
    }
    case 'suppliers.detail': {
      const loc = (d.location ?? {}) as Record<string, unknown>;
      const mem = (d.membership ?? {}) as Record<string, unknown>;
      const idx = (d.supplierIndex ?? {}) as Record<string, unknown>;
      const perf = (d.performance ?? {}) as Record<string, unknown>;
      const trust = (d.trust ?? {}) as Record<string, unknown>;
      console.log(`companyId: ${String(d.companyId)}`);
      console.log(`name: ${String(d.companyName)}`);
      console.log(`location: ${[loc.province, loc.city].filter(Boolean).join(', ') || '—'}  (${String(loc.confidence)})`);
      console.log(`joinedYears: ${String(d.joinedYears)}  supplierIndex(stars): ${String(idx.stars)}/${String(idx.maxStars ?? 5)}`);
      console.log(`membership: ${String(mem.plan)} (${String(mem.label)})  verifiedSupplier=${String(mem.verifiedSupplier)}  verifiedPro=${String(mem.verifiedPro)}`);
      console.log(`mainProducts: ${String(d.mainProductsText ?? '—')}`);
      console.log(`rating: ${String((perf.storeRating as Record<string, unknown>)?.score ?? '—')}/5  onTime: ${String(perf.onTimeDeliveryRate ?? '—')}  response: ${String(perf.responseTime ?? '—')}`);
      console.log(`tradeAssurance: ${String((trust.tradeAssurance as Record<string, unknown>)?.enabled ?? false)}  assessedBy: ${String(trust.assessedBy ?? '—')}`);
      console.log(`storeUrl: ${String(d.storeUrl ?? '—')}`);
      break;
    }
    case 'regions.list':
    case 'regions.search': {
      for (const r of (d.items as Array<Record<string, unknown>>) ?? []) {
        console.log(`${pad(String(r.code), 16)} ${pad(String(r.level), 9)} ${pad(String(r.nameEn), 16)} ${String(r.nameZh)}`);
      }
      break;
    }
    case 'factories.list': {
      console.log(`province: ${String(d.province ?? '-')}  page: ${String(d.page)}  upstreamTotal: ${String(d.upstreamTotal ?? '-')}  cached: ${meta.cached ?? false}`);
      for (const it of (d.items as Array<Record<string, unknown>>) ?? []) {
        console.log(`${pad(String(it.companyName), 52)} ${pad(String(it.province ?? '-'), 12)} years=${String(it.goldSupplierYears ?? '-')}`);
      }
      break;
    }
    case 'status':
    case 'status.get': {
      printJson(d);
      break;
    }
    case 'health.get': {
      console.log(`ali-client ${String(d.version)} · ${String(d.status)} · uptime ${String(d.uptimeMs)}ms`);
      break;
    }
    default:
      printJson(data);
  }
}

function parseCsv(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function exitCodeFor(code: string): number {
  switch (code) {
    case 'INVALID_ARGUMENT':
    case 'VALIDATION_FAILED':
      return 2;
    case 'RATE_LIMITED':
    case 'CAPTCHA_REQUIRED':
    case 'CAPTCHA_FAILED':
    case 'RISK_COOLDOWN':
    case 'UPSTREAM_TIMEOUT':
    case 'UPSTREAM_BLOCKED':
    case 'PAGE_NOT_AVAILABLE':
    case 'BAD_STATE':
      return 3;
    case 'UNAUTHENTICATED':
    case 'LOGIN_REQUIRED':
      return 4;
    case 'UPSTREAM_ERROR':
    case 'UPSTREAM_CHANGED':
      return 5;
    case 'NOT_IMPLEMENTED':
      return 6;
    default:
      return 1;
  }
}

async function withBackend<T>(fn: (backend: Backend) => Promise<T>): Promise<T> {
  const g = globals();
  const backend = await createBackend({
    mode: g.local ? 'local' : 'auto',
    ...(g.apiUrl ? { url: g.apiUrl } : {}),
    logToStdout: g.verbose ?? false,
  });
  try {
    return await fn(backend);
  } finally {
    await backend.close().catch(() => {});
  }
}

async function runOp(opId: string, input: unknown): Promise<void> {
  const g = globals();
  await withBackend(async (backend) => {
    const result = await invoke(backend.service, opId, input);
    printOp(opId, result.data, g.format, { cached: result.cached, mode: result.mode, warnings: result.warnings });
  });
}

// ------------------------------------------------------------------ commands
program
  .command('health')
  .description('健康检查')
  .action(async () => {
    await runOp('health.get', {});
  });

program
  .command('status')
  .description('查看登录态、浏览器/worker、风控、缓存与限频')
  .action(async () => {
    await runOp('status.get', {});
  });

const login = program.command('login').description('可选：打开 owner 浏览器登录页（anonymous-first 下 v1 无需登录）');
login.action(async () => {
  await runOp('session.login.start', { mode: 'manual' });
});
login
  .command('status')
  .argument('<loginId>')
  .description('查询登录状态')
  .action(async (loginId: string) => {
    await runOp('session.login.status', { loginId });
  });
login
  .command('cancel')
  .argument('<loginId>')
  .description('取消登录流程')
  .action(async (loginId: string) => {
    await runOp('session.login.cancel', { loginId });
  });

const verify = program.command('verify').description('滑块验证：查看/自动过/坐标中继');
verify.action(async () => {
  await runOp('verification.get', {});
});
verify
  .command('status')
  .description('查看当前滑块信息（截图路径/轨道/手柄坐标）')
  .action(async () => {
    await runOp('verification.get', {});
  });
verify
  .command('solve')
  .description('自动过滑块（默认）或坐标中继')
  .option('--mode <mode>', 'auto | drag', 'auto')
  .option('--from <x,y>', 'drag 起点')
  .option('--to <x,y>', 'drag 终点')
  .option('--duration <ms>', '拖拽时长', '900')
  .action(async (opts: { mode: 'auto' | 'drag'; from?: string; to?: string; duration: string }) => {
    const parsePoint = (v?: string): [number, number] | undefined => {
      if (!v) return undefined;
      const [x, y] = v.split(',').map((s) => Number(s.trim()));
      return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
    };
    await runOp('verification.solve', {
      mode: opts.mode,
      ...(parsePoint(opts.from) ? { from: parsePoint(opts.from) } : {}),
      ...(parsePoint(opts.to) ? { to: parsePoint(opts.to) } : {}),
      durationMs: Number(opts.duration),
    });
  });

const regions = program.command('regions').description('地区字典（中国内地 31 省 + 地级市）');
regions
  .command('list')
  .option('--level <level>', 'province | city')
  .option('--province <province>', '省份（中文/英文/拼音/代码）')
  .action(async (opts: { level?: 'province' | 'city'; province?: string }) => {
    await runOp('regions.list', { level: opts.level, province: opts.province });
  });
regions
  .command('search')
  .argument('<q>')
  .description('按中文/英文/拼音搜索地区')
  .action(async (q: string) => {
    await runOp('regions.search', { q });
  });

const search = program.command('search').description('搜索（建 queryId）');
search
  .command('suppliers')
  .description('供应商搜索：关键词 + 省/市 + 筛选 + 多页')
  .option('-k, --keyword <keyword>', '关键词（产品词或地区词）')
  .option('--province <province>', '省份（中文/英文/拼音/代码）')
  .option('--city <city>', '城市（中文/英文/拼音/代码）')
  .option('--location-mode <mode>', 'strict | keyword | off')
  .option('--pages <n>', '抓取页数（默认 5，上限 20）')
  .option('--max-enrich <n>', 'strict 回填上限（默认 60）')
  .option('--exclude-unknown-city', '城市过滤时排除城市未知的供应商', false)
  .option('--verified-supplier', '只看 Verified Supplier / 金品诚企', false)
  .option('--verified-pro', '只看 Verified Pro Supplier / 领袖卖家', false)
  .option('--trade-assurance', '只看 Trade Assurance', false)
  .option('--min-review <score>', '店铺评分下限：4 | 4.5 | 5')
  .option('--company-auth <tags>', '公司认证，逗号分隔：ISO,BSCI,...')
  .option('--product-auth <tags>', '产品认证，逗号分隔：CE,ROHS,...')
  .option('--capability <names>', '能力标签，逗号分隔：Full customization,... 或 id')
  .option('--sort <sort>', 'default | resrat')
  .option('--refresh', '强制回源', false)
  .action(async (opts: Record<string, unknown>) => {
    const filters: Record<string, unknown> = {};
    if (opts.verifiedSupplier) filters.verifiedSupplier = true;
    if (opts.verifiedPro) filters.verifiedPro = true;
    if (opts.tradeAssurance) filters.tradeAssurance = true;
    if (opts.minReview) filters.minReviewScore = String(opts.minReview);
    if (opts.companyAuth) filters.companyAuthTags = parseCsv(String(opts.companyAuth));
    if (opts.productAuth) filters.productAuthTags = parseCsv(String(opts.productAuth));
    if (opts.capability) filters.capabilities = parseCsv(String(opts.capability));
    await runOp('search.suppliers', {
      ...(opts.keyword ? { keyword: String(opts.keyword) } : {}),
      ...(opts.province ? { province: String(opts.province) } : {}),
      ...(opts.city ? { city: String(opts.city) } : {}),
      ...(opts.locationMode ? { locationMode: String(opts.locationMode) } : {}),
      ...(opts.pages ? { pages: Number(opts.pages) } : {}),
      ...(opts.maxEnrich ? { maxEnrich: Number(opts.maxEnrich) } : {}),
      includeUnknownCity: !opts.excludeUnknownCity,
      filters,
      ...(opts.sort ? { sort: String(opts.sort) } : {}),
      refresh: Boolean(opts.refresh),
    });
  });

const suppliers = program.command('suppliers').description('供应商列表/详情');
suppliers
  .command('list')
  .requiredOption('--query-id <queryId>', 'search 返回的 queryId')
  .option('--page <n>', '页码', '1')
  .option('--refresh', '强制回源', false)
  .action(async (opts: { queryId: string; page: string; refresh: boolean }) => {
    await runOp('suppliers.list', { queryId: opts.queryId, page: Number(opts.page), refresh: Boolean(opts.refresh) });
  });
suppliers
  .command('detail')
  .option('--company-id <companyId>', '供应商 companyId')
  .option('--store <subdomain>', '供应商店铺子域（如 kangyuanxiangsu）')
  .option('--refresh', '强制回源', false)
  .action(async (opts: { companyId?: string; store?: string; refresh: boolean }) => {
    await runOp('suppliers.detail', {
      ...(opts.companyId ? { companyId: opts.companyId } : {}),
      ...(opts.store ? { store: opts.store } : {}),
      refresh: Boolean(opts.refresh),
    });
  });

const factories = program.command('factories').description('认证工厂目录（仅省）');
factories
  .command('list')
  .option('--province <province>', '省份')
  .option('--category <id>', '类目 id（默认 0=全部）', '0')
  .option('--page <n>', '页码', '1')
  .option('--page-size <n>', '每页条数（<=100）', '100')
  .option('--refresh', '强制回源', false)
  .action(async (opts: { province?: string; category: string; page: string; pageSize: string; refresh: boolean }) => {
    await runOp('factories.list', {
      ...(opts.province ? { province: opts.province } : {}),
      categoryId: opts.category,
      page: Number(opts.page),
      pageSize: Number(opts.pageSize),
      refresh: Boolean(opts.refresh),
    });
  });

program
  .command('memberships')
  .description('会员档位枚举与识别规则')
  .action(async () => {
    await runOp('memberships.catalog', {});
  });

const cache = program.command('cache').description('缓存管理');
cache
  .command('stats')
  .description('缓存统计')
  .action(async () => {
    await runOp('cache.stats', {});
  });
cache
  .command('clear')
  .option('--kind <kind>', 'all | queries | suppliers | details | factories', 'all')
  .action(async (opts: { kind: string }) => {
    await runOp('cache.clear', { kind: opts.kind });
  });

program
  .command('mcp')
  .description('启动 MCP stdio server（工具前缀 ali_）')
  .action(async () => {
    await runMcpServer();
  });

program
  .command('serve')
  .description('启动常驻 REST owner（默认 127.0.0.1:8792）')
  .option('--port <port>', '端口')
  .option('--host <host>', '监听地址')
  .action(async (opts: { port?: string; host?: string }) => {
    const config = loadConfig();
    const host = opts.host ?? config.host;
    const port = opts.port ? Number(opts.port) : config.port;
    // 全局 owner 锁：即使换端口也不能再起第二个 owner（会抢同一 profile）
    const owner = readOwnerLock(config.lockFile);
    if (owner) {
      console.log(`ali-client 已在运行（pid=${owner.pid}，since ${owner.startedAt}）`);
      console.log('查看状态：ali status；重启：systemctl --user restart ali-client');
      return;
    }
    // 已有 owner 在运行：不要抢 profile，直接提示
    try {
      const probe = await fetch(`http://${host}:${port}/v1/health`, { signal: AbortSignal.timeout(2000) });
      if (probe.ok) {
        const payload = (await probe.json()) as { data?: { service?: string } };
        if (payload.data?.service === 'ali-client') {
          console.log(`ali-client 已在运行：http://${host}:${port}`);
          console.log('查看状态：ali status；重启：systemctl --user restart ali-client');
          return;
        }
      }
    } catch {
      /* not running */
    }
    const app = await createApp({ logToStdout: true });
    config.host = host;
    config.port = port;
    await app.start();
    const server = createRestServer({ config, service: app.service, logger: app.logger });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => resolve());
    });
    console.log(`ali-client REST listening on http://${config.host}:${config.port}`);
    console.log(`docs: http://${config.host}:${config.port}/docs`);
    const shutdown = (): void => {
      server.close(() => {
        void app.close().finally(() => process.exit(0));
      });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

export async function main(argv: string[] = process.argv): Promise<void> {
  try {
    await program.parseAsync(argv);
  } catch (err) {
    const e = asAliError(err as unknown);
    console.error(`error [${e.code}]: ${e.message}`);
    if (e.details) console.error(JSON.stringify(e.details, null, 2));
    process.exit(exitCodeFor(e.code));
  }
}
