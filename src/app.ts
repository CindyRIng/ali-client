/**
 * 应用容器：配置 + 浏览器会话 + 缓存 + 服务
 */
import { loadConfig, ensureDataDirs, type Config } from './config/schema.js';
import { createLogger, type Logger } from './utils/logger.js';
import { MemoryCacheStore } from './cache/memory.js';
import { SqliteCacheStore } from './cache/sqlite.js';
import type { CacheStore } from './cache/types.js';
import { AlibabaSession } from './session/manager.js';
import { AliService } from './service.js';

export interface App {
  config: Config;
  cache: CacheStore;
  session: AlibabaSession;
  service: AliService;
  logger: Logger;
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateAppOptions {
  env?: NodeJS.ProcessEnv;
  logToStdout?: boolean;
}

async function createCache(config: Config): Promise<CacheStore> {
  if (process.env.ALI_CACHE_DRIVER === 'memory') {
    const memory = new MemoryCacheStore();
    await memory.init();
    return memory;
  }
  const sqlite = new SqliteCacheStore(config.cache.dbPath, {
    queryTtlSec: config.cache.queryTtlSec,
    detailTtlSec: config.cache.detailTtlSec,
    factoryTtlSec: config.cache.factoryTtlSec,
  });
  try {
    await sqlite.init();
    return sqlite;
  } catch (err) {
    console.error('[warn] SQLite 缓存不可用，回退到内存缓存：', (err as Error).message);
    const memory = new MemoryCacheStore();
    await memory.init();
    return memory;
  }
}

export async function createApp(opts: CreateAppOptions = {}): Promise<App> {
  const env = opts.env ?? process.env;
  const config = loadConfig({ env });
  ensureDataDirs(config);
  const logger = createLogger({
    file: config.log.file,
    maxBytes: config.log.maxBytes,
    keep: config.log.keep,
    level: config.log.level,
    stdout: opts.logToStdout ?? config.log.stdout,
  });
  const cache = await createCache(config);
  const session = new AlibabaSession(config, logger);
  const service = new AliService(config, session, cache, logger);
  let started = false;
  const app: App = {
    config,
    cache,
    session,
    service,
    logger,
    async start() {
      if (started) return;
      await session.start();
      started = true;
      logger.info('app.started', { profileDir: config.profileDir, port: config.port });
    },
    async close() {
      await session.stop();
      await cache.close();
      logger.info('app.closed');
    },
  };
  return app;
}
