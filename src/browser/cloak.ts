/**
 * cloak 浏览器宿主（cloakbrowser 0.6.5 + Playwright）
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { BrowserContext, Page } from 'playwright-core';
import type { BrowserHost, BrowserInfo, BrowserStartOptions } from './types.js';
import { AliError } from '../errors/catalog.js';

type LaunchPersistentContext = (opts: Record<string, unknown>) => Promise<BrowserContext>;

export class CloakBrowserHost implements BrowserHost {
  private ctx: BrowserContext | null = null;
  private pageRef: Page | null = null;
  private startedAt = 0;

  constructor(private readonly opts: BrowserStartOptions) {}

  async start(): Promise<void> {
    let mod: { launchPersistentContext?: LaunchPersistentContext };
    try {
      mod = (await import('cloakbrowser')) as unknown as { launchPersistentContext?: LaunchPersistentContext };
    } catch (err) {
      throw new AliError(
        'NOT_IMPLEMENTED',
        'cloakbrowser 未安装：请在 cloak-env 的 FHS 中运行（bin/ali-run）',
        { cause: err },
      );
    }
    if (typeof mod.launchPersistentContext !== 'function') {
      throw new AliError('NOT_IMPLEMENTED', 'cloakbrowser API 不兼容：缺少 launchPersistentContext');
    }
    const launch = (): Promise<BrowserContext> =>
      mod.launchPersistentContext?.({
        userDataDir: this.opts.profileDir,
        headless: this.opts.headless,
        humanize: this.opts.humanize ?? true,
        timezone: this.opts.timezone ?? 'Asia/Shanghai',
        locale: this.opts.locale ?? 'en-US',
        viewport: this.opts.viewport ?? { width: 1920, height: 1080 },
        args: this.opts.args ?? ['--start-maximized'],
      }) as Promise<BrowserContext>;
    try {
      this.ctx = await launch();
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);
      if (/existing browser session|SingletonLock|profile is already in use/i.test(msg)) {
        // 崩溃/重启后可能残留 profile 锁或旧 Chromium 进程：清理后重试一次
        this.cleanupStaleProfile();
        await new Promise((r) => setTimeout(r, 1200));
        try {
          this.ctx = await launch();
        } catch (retryErr) {
          msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          throw new AliError('UPSTREAM_UNAVAILABLE', `浏览器启动失败（锁清理重试后仍失败）：${msg}`, { cause: retryErr });
        }
      } else {
        if (this.opts.headless === false && /display|DISPLAY|X11|wayland|ozone/i.test(msg)) {
          throw new AliError('HEADFUL_REQUIRED', '无法打开可见浏览器：请设置 DISPLAY 或使用 Xvfb', { cause: err });
        }
        throw new AliError('UPSTREAM_UNAVAILABLE', `浏览器启动失败：${msg}`, { cause: err });
      }
    }
    this.pageRef = this.ctx.pages()[0] ?? (await this.ctx.newPage());
    this.startedAt = Date.now();
  }

  /** 清理崩溃后残留的 profile 锁与旧 Chromium 进程（仅同 profile） */
  private cleanupStaleProfile(): void {
    try {
      spawnSync('pkill', ['-f', `--user-data-dir=${this.opts.profileDir}`], { timeout: 3000 });
    } catch {
      /* pkill 不存在时忽略 */
    }
    for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      try {
        fs.rmSync(path.join(this.opts.profileDir, name), { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  isConnected(): boolean {
    return this.ctx !== null && this.pageRef !== null;
  }

  context(): BrowserContext {
    if (!this.ctx) throw new AliError('BAD_STATE', '浏览器会话未启动');
    return this.ctx;
  }

  page(): Page {
    if (!this.pageRef) throw new AliError('BAD_STATE', '浏览器会话未启动');
    return this.pageRef;
  }

  info(): BrowserInfo {
    return {
      connected: this.isConnected(),
      headless: this.opts.headless,
      profileDir: this.opts.profileDir,
      ...(this.startedAt ? { browserVersion: 'cloak' } : {}),
    };
  }

  startedAtMs(): number {
    return this.startedAt;
  }

  async close(): Promise<void> {
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.pageRef = null;
    this.startedAt = 0;
  }
}
