/**
 * 后端选择：本地 owner 进程 vs 远程 REST 代理
 *
 * - 常驻服务（systemd）是唯一持有 browser/profile 的 owner。
 * - CLI/MCP 默认优先走 ALI_API_URL；未显式配置时探测本机 REST 服务。
 * - 只有 `--local` 或探测不到服务时才创建本地 App。
 */
import { createApp, type App } from './app.js';
import { loadConfig, type Config } from './config/schema.js';
import type { AliServiceLike } from './service-types.js';
import { RemoteAliClient } from './remote/client.js';
import { AliError } from './errors/catalog.js';

export type BackendMode = 'auto' | 'local' | 'remote';

export interface Backend {
  config: Config;
  service: AliServiceLike;
  mode: 'local' | 'remote';
  app?: App;
  ensureReady(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateBackendOptions {
  mode?: BackendMode;
  url?: string;
  logToStdout?: boolean;
}

async function probeHealth(config: Config, urlOverride?: string): Promise<string | null> {
  const base = urlOverride ?? `http://${config.host}:${config.port}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(2500) });
      if (!response.ok) continue;
      const payload = (await response.json()) as { ok?: boolean; data?: { service?: string } };
      if (payload.ok === true && payload.data?.service === 'ali-client') return base;
    } catch {
      /* retry */
    }
  }
  return null;
}

export async function createBackend(opts: CreateBackendOptions = {}): Promise<Backend> {
  const mode = opts.mode ?? 'auto';
  const config = loadConfig();
  const envUrl = opts.url ?? process.env.ALI_API_URL;
  const defaultUrl = `http://${config.host}:${config.port}`;

  if (mode === 'remote') {
    return {
      config,
      service: new RemoteAliClient(config, envUrl?.trim() ? envUrl : defaultUrl),
      mode: 'remote',
      ensureReady: async () => {},
      close: async () => {},
    };
  }

  if (mode === 'auto') {
    if (envUrl) {
      return { config, service: new RemoteAliClient(config, envUrl), mode: 'remote', ensureReady: async () => {}, close: async () => {} };
    }
    const detected = await probeHealth(config);
    if (detected) {
      return { config, service: new RemoteAliClient(config, detected), mode: 'remote', ensureReady: async () => {}, close: async () => {} };
    }
  }

  const app = await createApp({ logToStdout: opts.logToStdout ?? false });
  await app.start();
  return {
    config,
    service: app.service,
    mode: 'local',
    app,
    ensureReady: async () => {
      await app.start();
    },
    close: () => app.close(),
  };
}

export { AliError };
