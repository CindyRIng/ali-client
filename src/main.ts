#!/usr/bin/env node
/**
 * ali-client 入口
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './config/schema.js';
import { main } from './transports/cli/index.js';

// 1) 显式 ALI_ENV_FILE / 当前目录 .env；2) 回退到仓库根 .env（可从任意目录运行）
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason);
  process.exit(1);
});

loadDotEnv();
if (!process.env.ALI_API_TOKEN) {
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  loadDotEnv(path.join(pkgRoot, '.env'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
