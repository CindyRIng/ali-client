/**
 * 运行配置（env > defaults；支持项目根 .env）
 *
 * 命名：ALI_* 前缀；数据目录 ~/.ali-client；REST 默认 127.0.0.1:8792。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { AliError } from '../errors/catalog.js';

export const VERSION = '0.1.0';
export const SCHEMA_VERSION = '1.0';

function home(): string {
  return process.env.HOME || os.homedir();
}

export function expandHome(p: string): string {
  if (p === '~') return home();
  if (p.startsWith('~/')) return path.join(home(), p.slice(2));
  return p;
}

function str(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const v = env[key];
  return v === undefined || v === '' ? fallback : v;
}
function optStr(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  return v === undefined || v === '' ? undefined : v;
}
function bool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(v)) return true;
  if (/^(0|false|no|off)$/i.test(v)) return false;
  throw new AliError('INVALID_ARGUMENT', `${key} must be boolean`);
}
function int(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  if (!/^\d+$/.test(v)) throw new AliError('INVALID_ARGUMENT', `${key} must be an integer`);
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new AliError('INVALID_ARGUMENT', `${key} out of range`);
  return n;
}

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

export const ConfigSchema = z
  .object({
    version: z.string(),
    dataDir: z.string(),
    baseUrl: z.string().url(),
    searchUrl: z.string().url(),
    loginUrl: z.string().url(),
    factoryApiUrl: z.string().url(),
    language: z.string(),
    currency: z.string(),
    country: z.string(),
    locale: z.string(),
    timezone: z.string(),
    viewportWidth: z.number().int().positive(),
    viewportHeight: z.number().int().positive(),
    profileDir: z.string(),
    headless: z.boolean(),
    humanize: z.boolean(),
    apiToken: z.string().min(1),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    clientUrl: z.string().url().optional(),
    lockFile: z.string(),
    cache: z.object({
      dbPath: z.string(),
      driver: z.enum(['sqlite', 'memory']),
      queryTtlSec: z.number().int().nonnegative(),
      detailTtlSec: z.number().int().nonnegative(),
      factoryTtlSec: z.number().int().nonnegative(),
      maxBytes: z.number().int().positive(),
    }),
    session: z.object({
      maxPages: z.number().int().positive().max(20),
      pageNavIntervalMs: z.number().int().nonnegative(),
      fetchIntervalMs: z.number().int().nonnegative(),
      fetchJitterMs: z.number().int().nonnegative(),
      detailConcurrency: z.number().int().min(1).max(3),
      detailIntervalMs: z.number().int().nonnegative(),
      maxEnrich: z.number().int().positive().max(300),
      watchdogMs: z.number().int().positive(),
      requestTimeoutMs: z.number().int().positive(),
      cooldownSec: z.number().int().nonnegative(),
      cooldownMaxSec: z.number().int().nonnegative(),
      verificationTtlSec: z.number().int().positive(),
      verificationAttempts: z.number().int().min(1).max(5),
      x5secRefreshBeforeSec: z.number().int().nonnegative(),
      fetchBudgetPer10Min: z.number().int().positive(),
      workerRefreshEvery: z.number().int().positive(),
      loginTimeoutSec: z.number().int().positive(),
    }),
    log: z.object({
      level: LogLevelSchema,
      file: z.string(),
      maxBytes: z.number().int().positive(),
      keep: z.number().int().positive(),
      stdout: z.boolean(),
    }),
  })
  .meta({ id: 'AliConfig' });

export type Config = z.infer<typeof ConfigSchema>;

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
}

export function loadConfig(opts: LoadConfigOptions = {}): Config {
  const env = opts.env ?? process.env;
  const dataDir = expandHome(str(env, 'ALI_DATA_DIR', '~/.ali-client'));
  const cfg: Config = {
    version: VERSION,
    dataDir,
    baseUrl: str(env, 'ALI_BASE_URL', 'https://www.alibaba.com').replace(/\/+$/, ''),
    searchUrl: str(env, 'ALI_SEARCH_URL', 'https://www.alibaba.com/trade/search').replace(/\/+$/, ''),
    loginUrl: str(
      env,
      'ALI_LOGIN_URL',
      'https://login.alibaba.com/newlogin/icbuLogin.htm?return_url=https%3A%2F%2Fwww.alibaba.com',
    ),
    factoryApiUrl: str(
      env,
      'ALI_FACTORY_API_URL',
      'https://insights.alibaba.com/openservice/gatewayService',
    ).replace(/\/+$/, ''),
    language: str(env, 'ALI_LANG', 'en-US'),
    currency: str(env, 'ALI_CURRENCY', 'USD'),
    country: str(env, 'ALI_COUNTRY', 'CN'),
    locale: str(env, 'ALI_LOCALE', 'en-US'),
    timezone: str(env, 'ALI_TIMEZONE', 'Asia/Shanghai'),
    viewportWidth: int(env, 'ALI_VIEWPORT_WIDTH', 1920, 320, 4096),
    viewportHeight: int(env, 'ALI_VIEWPORT_HEIGHT', 1080, 240, 2160),
    profileDir: expandHome(str(env, 'ALI_PROFILE_DIR', path.join(dataDir, 'profile'))),
    headless: bool(env, 'ALI_HEADLESS', false),
    humanize: bool(env, 'ALI_HUMANIZE', true),
    apiToken: str(env, 'ALI_API_TOKEN', 'change-me'),
    host: str(env, 'ALI_HOST', '127.0.0.1'),
    port: int(env, 'ALI_PORT', 8792, 1, 65535),
    ...(() => {
      const u = optStr(env, 'ALI_API_URL');
      return u ? { clientUrl: u } : {};
    })(),
    lockFile: expandHome(str(env, 'ALI_LOCK_FILE', path.join(dataDir, 'run/ali.lock'))),
    cache: {
      dbPath: expandHome(str(env, 'ALI_CACHE_DB', path.join(dataDir, 'cache.sqlite'))),
      driver: str(env, 'ALI_CACHE_DRIVER', 'sqlite') as Config['cache']['driver'],
      queryTtlSec: int(env, 'ALI_TTL_SEARCH_S', 7200),
      detailTtlSec: int(env, 'ALI_TTL_DETAIL_S', 604800),
      factoryTtlSec: int(env, 'ALI_TTL_FACTORY_S', 86400),
      maxBytes: int(env, 'ALI_CACHE_MAX_BYTES', 200 * 1024 * 1024, 1024),
    },
    session: {
      maxPages: int(env, 'ALI_MAX_PAGES', 5, 1, 20),
      pageNavIntervalMs: int(env, 'ALI_PAGE_INTERVAL_MS', 10000),
      fetchIntervalMs: int(env, 'ALI_FETCH_INTERVAL_MS', 900),
      fetchJitterMs: int(env, 'ALI_FETCH_JITTER_MS', 500),
      detailConcurrency: int(env, 'ALI_DETAIL_CONCURRENCY', 2, 1, 3),
      detailIntervalMs: int(env, 'ALI_DETAIL_INTERVAL_MS', 700),
      maxEnrich: int(env, 'ALI_MAX_ENRICH', 60, 1, 300),
      watchdogMs: int(env, 'ALI_WATCHDOG_MS', 18000, 3000),
      requestTimeoutMs: int(env, 'ALI_REQUEST_TIMEOUT_MS', 30000, 3000),
      cooldownSec: int(env, 'ALI_COOLDOWN_S', 60),
      cooldownMaxSec: int(env, 'ALI_COOLDOWN_MAX_S', 900),
      verificationTtlSec: int(env, 'ALI_VERIFICATION_TTL_SEC', 600, 30),
      verificationAttempts: int(env, 'ALI_VERIFICATION_ATTEMPTS', 3, 1, 5),
      x5secRefreshBeforeSec: int(env, 'ALI_X5SEC_REFRESH_BEFORE_S', 180),
      fetchBudgetPer10Min: int(env, 'ALI_FETCH_BUDGET_PER_10MIN', 240, 10),
      workerRefreshEvery: int(env, 'ALI_WORKER_REFRESH_EVERY', 200, 10),
      loginTimeoutSec: int(env, 'ALI_LOGIN_TIMEOUT_SEC', 600, 60),
    },
    log: {
      level: str(env, 'ALI_LOG_LEVEL', 'info') as Config['log']['level'],
      file: expandHome(str(env, 'ALI_LOG_FILE', path.join(dataDir, 'logs/ali.log'))),
      maxBytes: int(env, 'ALI_LOG_MAX_BYTES', 10 * 1024 * 1024, 1024),
      keep: int(env, 'ALI_LOG_KEEP', 5, 1),
      stdout: bool(env, 'ALI_LOG_STDOUT', true),
    },
  };
  if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') {
    throw new AliError('INVALID_ARGUMENT', 'ALI_HOST must be 127.0.0.1 (local only)');
  }
  if (cfg.session.maxPages > 20) throw new AliError('INVALID_ARGUMENT', 'ALI_MAX_PAGES max is 20');
  const parsed = ConfigSchema.safeParse(cfg);
  if (!parsed.success) throw new AliError('VALIDATION_FAILED', 'invalid config', { details: { issues: parsed.error.issues } });
  return parsed.data;
}

export function ensureDataDirs(cfg: Config): void {
  for (const dir of [
    path.dirname(cfg.profileDir),
    path.dirname(cfg.cache.dbPath),
    path.dirname(cfg.log.file),
    path.dirname(cfg.lockFile),
    path.join(cfg.dataDir, 'run'),
    path.join(cfg.dataDir, 'logs'),
  ]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function loadDotEnv(file = process.env.ALI_ENV_FILE ?? path.join(process.cwd(), '.env')): void {
  const target = expandHome(file);
  if (!fs.existsSync(target)) return;
  try {
    const text = fs.readFileSync(target, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* .env is optional */
  }
}
