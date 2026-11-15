/**
 * 会话/采集器：常驻 owner 浏览器 + worker 页 + fetch-first 采集 + 滑块治理
 *
 * 设计：
 * - 只保留 1 个 https://www.alibaba.com/ worker 页；搜索/详情/工厂目录都通过 page.evaluate(fetch)；
 * - 页面导航只用于初始化、语言切换、过验证与异常恢复；
 * - 所有 fetch 都有 watchdog（fetch 挂起时 AbortSignal 无效，必须在 Node 侧 race）；
 * - 风控：滑块自动过验证（类人拖拽 + reload 重试）→ 失败转人工中继。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import type { Config } from '../config/schema.js';
import { CloakBrowserHost } from '../browser/cloak.js';
import { AliError } from '../errors/catalog.js';
import type {
  VerificationSolveRequest,
  VerificationSolveResponse,
  VerificationStatus,
  LoginStatus,
} from '../domain/session.js';
import type { RiskState } from '../domain/status.js';
import type { Logger } from '../utils/logger.js';
import { buildRenderApiUrl, renderApiBody, buildFactoryApiUrl } from '../adapters/alibaba/endpoints.js';

const CAPTCHA_RE = /CAPTCHA Verification|Please slide to verify|dragging the slider|拖动滑块|请拖动/i;
const SLIDER_RE = /nc_1_n1z|slide to verify|拖动滑块|请拖动/i;
const QR_RE = /scan the QR code|扫描二维码|scan with alibaba app/i;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number): number => (ms <= 0 ? 0 : Math.floor(Math.random() * ms));

function iso(ms: number | null): string | null {
  return ms && ms > 0 ? new Date(ms).toISOString() : null;
}

export interface FetchResult {
  status: number;
  text: string;
  contentType: string;
  bytes: number;
  latencyMs: number;
}

export interface SessionRiskSnapshot {
  state: RiskState;
  x5secExpiresAt: string | null;
  cooldownUntil: string | null;
  captchaRequired: boolean;
  lastSolvedAt: string | null;
  lastError: string | null;
}

export interface SessionSnapshot {
  mode: 'logged_in' | 'anonymous' | 'degraded';
  loggedIn: boolean;
  account: { displayName: string | null; country: string | null } | null;
  language: string;
  browser: { running: boolean; pid: number | null; headless: boolean; uptimeMs: number };
  worker: { url: string | null; ready: boolean; fetchHealthy: boolean; lastFetchHungAt: string | null };
  risk: SessionRiskSnapshot;
  upstream: {
    requestsLast10Min: number;
    lastPageNavAt: string | null;
    lastFetchAt: string | null;
    lastDetailAt: string | null;
    events: Array<{ at: string; kind: string; detail: string | null }>;
  };
}

interface VerificationChallenge {
  required: boolean;
  type: 'slider' | 'qr' | 'unknown';
  pageUrl: string | null;
  screenshotPath: string | null;
  track: { x: number; y: number; width: number; height: number; viewport: string } | null;
  handle: { x: number; y: number; width: number; height: number } | null;
  attempts: number;
  capturedAt: number;
}

export class AlibabaSession {
  private readonly host: CloakBrowserHost;
  private started = false;
  private workerReady = false;
  private modeValue: 'logged_in' | 'anonymous' | 'degraded' = 'anonymous';
  private loggedIn = false;
  private account: { displayName: string | null; country: string | null } | null = null;
  private riskState: RiskState = 'normal';
  private cooldownUntil = 0;
  private lastSolvedAt = 0;
  private lastFetchHungAt = 0;
  private lastPageNavAt = 0;
  private lastFetchAt = 0;
  private lastDetailAt = 0;
  private consecutiveFailures = 0;
  private fetchCount = 0;
  private requestTimes: number[] = [];
  private events: Array<{ at: string; kind: string; detail: string | null }> = [];
  private challenge: VerificationChallenge | null = null;
  private loginPage: Page | null = null;
  private workerUrl: string | null = null;
  private currentLoginId: string | null = null;
  private loginStates = new Map<string, 'completed' | 'cancelled'>();
  private x5secExpiresAt = 0;
  private lastError: string | null = null;
  private opChain: Promise<unknown> = Promise.resolve();
  private detailInFlight = 0;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {
    this.host = new CloakBrowserHost({
      profileDir: config.profileDir,
      headless: config.headless,
      humanize: config.humanize,
      timezone: config.timezone,
      locale: config.locale,
      viewport: { width: config.viewportWidth, height: config.viewportHeight },
    });
  }

  // ---------------------------------------------------------------- lifecycle
  async start(): Promise<void> {
    if (this.started) return;
    await this.host.start();
    this.started = true;
    try {
      await this.navigate(this.config.baseUrl, { reason: 'init', force: true });
      await this.ensureEnglish();
      await this.refreshCookies();
      await this.detectLogin();
      this.workerReady = true;
      this.logger.info('session.started', { mode: this.modeValue, headless: this.config.headless });
    } catch (err) {
      this.started = false;
      await this.host.close().catch(() => {});
      throw err;
    }
  }

  async stop(): Promise<void> {
    await this.cancelLogin().catch(() => {});
    await this.host.close().catch(() => {});
    this.started = false;
    this.workerReady = false;
  }

  isStarted(): boolean {
    return this.started;
  }

  page(): Page {
    return this.host.page();
  }

  private record(kind: string, detail: string | null = null): void {
    this.events.push({ at: new Date().toISOString(), kind, detail });
    if (this.events.length > 100) this.events.shift();
    this.logger.debug(`session.event.${kind}`, detail ? { detail } : {});
  }

  private nowRequests(): number {
    const cut = Date.now() - 10 * 60 * 1000;
    this.requestTimes = this.requestTimes.filter((t) => t >= cut);
    return this.requestTimes.length;
  }

  private async budgetGuard(): Promise<void> {
    const used = this.nowRequests();
    if (used >= this.config.session.fetchBudgetPer10Min) {
      throw new AliError('RATE_LIMITED', `local fetch budget exceeded (${used}/${this.config.session.fetchBudgetPer10Min} per 10min)`, {
        retryAfterMs: 60_000,
      });
    }
  }

  private assertReady(): void {
    if (!this.started || !this.host.isConnected()) {
      throw new AliError('BAD_STATE', 'browser session is not started');
    }
  }

  // ---------------------------------------------------------------- navigation
  /** 页面导航（仅初始化/恢复/过验证使用） */
  async navigate(url: string, opts: { reason: string; force?: boolean } = { reason: 'nav' }): Promise<{ status: number | null; captcha: boolean }> {
    this.assertReady();
    const minGap = this.config.session.pageNavIntervalMs;
    const wait = this.lastPageNavAt + minGap - Date.now();
    if (!opts.force && wait > 0) await sleep(wait + jitter(1500));
    this.lastPageNavAt = Date.now();
    this.record('nav', opts.reason);
    let status: number | null = null;
    try {
      const resp = await this.host.page().goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.session.requestTimeoutMs });
      status = resp?.status() ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.record('nav_error', msg.slice(0, 200));
      throw new AliError('UPSTREAM_TIMEOUT', `navigation failed: ${msg.slice(0, 160)}`, { cause: err });
    }
    this.workerUrl = this.page().url();
    await sleep(2500 + jitter(1200));
    await this.refreshCookies();
    const captcha = await this.pageHasCaptcha();
    if (captcha) {
      this.record('captcha_detected', url.split('?')[0]);
      this.riskState = 'captcha';
      this.challenge = await this.captureChallenge();
      const solved = await this.solveVerification({ mode: 'auto', durationMs: 900 });
      if (!solved.solved) {
        this.riskState = 'degraded';
        throw new AliError('CAPTCHA_REQUIRED', 'slider verification required', {
          details: { verification: this.challengePayload() },
        });
      }
    }
    this.workerReady = true;
    this.workerUrl = this.page().url();
    return { status, captcha };
  }

  private async ensureEnglish(): Promise<void> {
    try {
      const cookies = await this.host.context().cookies(this.config.baseUrl);
      const cfgCookie = cookies.find((c) => c.name === 'sc_g_cfg_f');
      if (cfgCookie && /sc_b_locale=en_US/i.test(cfgCookie.value)) return;
      this.logger.info('session.locale.switch', { current: cfgCookie?.value?.slice(0, 120) ?? null, note: 'locale only; currency left as-is' });
      // 通过首页语言/货币 React Select 切换（实测可行）
      await this.page().evaluate(() => {
        const trigger = document.querySelector('.switch-to-popover-trigger') as HTMLElement | null;
        trigger?.click();
      });
      await sleep(1500);
      const switched = await this.page().evaluate(() => {
        const input = document.querySelector('#react-select-2-input') as HTMLInputElement | null;
        const save = [...document.querySelectorAll('.tnh-button')].find((el) => (el.textContent || '').includes('保存') || (el.textContent || '').toLowerCase().includes('save'));
        const input2 = document.querySelector('#react-select-3-input') as HTMLInputElement | null;
        return { hasInput: !!input, hasSave: !!save, hasInput2: !!input2 };
      });
      if (switched.hasInput && switched.hasInput2) {
        const setSelect = async (selector: string, text: string): Promise<void> => {
          await this.page().click(selector);
          await this.page().keyboard.type(text, { delay: 80 });
          await sleep(600);
          await this.page().keyboard.press('Enter');
          await sleep(600);
        };
        await setSelect('#react-select-2-input', 'English');
        await setSelect('#react-select-3-input', 'USD');
        await this.page().evaluate(() => {
          const save = [...document.querySelectorAll('.tnh-button')].find(
            (el) => (el.textContent || '').includes('保存') || (el.textContent || '').toLowerCase().includes('save'),
          ) as HTMLElement | null;
          save?.click();
        });
        await sleep(5000);
        await this.page().goto(this.config.baseUrl, { waitUntil: 'domcontentloaded', timeout: this.config.session.requestTimeoutMs });
        await sleep(2500);
      }
      await this.refreshCookies();
    } catch (err) {
      this.logger.warn('session.locale.switch_failed', { error: (err as Error).message.slice(0, 160) });
    }
  }

  private async detectLogin(): Promise<void> {
    try {
      const info = await this.page().evaluate(() => {
        const text = document.body ? document.body.innerText : '';
        return { text: text.slice(0, 3000), url: location.href };
      });
      const hasSignIn = /(^|\n)\s*Sign in\s*($|\n)/i.test(info.text);
      this.loggedIn = !hasSignIn && !/login\.alibaba\.com/i.test(info.url);
      this.modeValue = this.loggedIn ? 'logged_in' : 'anonymous';
    } catch {
      this.loggedIn = false;
      this.modeValue = 'anonymous';
    }
  }

  async refreshLoginState(): Promise<void> {
    await this.detectLogin();
  }

  // ---------------------------------------------------------------- cookies / risk
  async refreshCookies(): Promise<void> {
    try {
      const cookies = await this.host.context().cookies(this.config.baseUrl);
      const x5 = cookies.find((c) => c.name === 'x5sec');
      if (x5 && x5.expires > 0) this.x5secExpiresAt = x5.expires * 1000;
      const dbg = cookies.find((c) => c.name === 'sc_g_cfg_f');
      if (dbg && !/en_US/i.test(dbg.value)) this.lastError = 'locale not en_US (see docs 04)';
    } catch {
      /* ignore */
    }
  }

  async x5secExpiresAtIso(): Promise<string | null> {
    await this.refreshCookies();
    return iso(this.x5secExpiresAt);
  }

  private async pageHasCaptcha(): Promise<boolean> {
    try {
      const html = await this.page().evaluate(() => (document.documentElement ? document.documentElement.outerHTML : ''));
      return CAPTCHA_RE.test(html);
    } catch {
      return false;
    }
  }

  private async captureChallenge(): Promise<VerificationChallenge> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(this.config.dataDir, 'run');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const screenshotPath = path.join(dir, `captcha-${ts}.png`);
    let track: VerificationChallenge['track'] = null;
    let handle: VerificationChallenge['handle'] = null;
    let type: VerificationChallenge['type'] = 'unknown';
    try {
      await this.page().screenshot({ path: screenshotPath });
      const html = await this.page().evaluate(() => (document.documentElement ? document.documentElement.outerHTML : ''));
      type = SLIDER_RE.test(html) ? 'slider' : QR_RE.test(html) ? 'qr' : 'unknown';
      const geo = await this.page().evaluate(() => {
        const h = document.querySelector('#nc_1_n1z') as HTMLElement | null;
        const t = (document.querySelector('#nc_1_wrapper') || document.querySelector('.nc_wrapper')) as HTMLElement | null;
        if (!h || !t) return null;
        const hr = h.getBoundingClientRect();
        const tr = t.getBoundingClientRect();
        return {
          track: { x: tr.x, y: tr.y, width: tr.width, height: tr.height, viewport: `${window.innerWidth}x${window.innerHeight}` },
          handle: { x: hr.x, y: hr.y, width: hr.width, height: hr.height },
        };
      });
      if (geo) {
        track = geo.track;
        handle = geo.handle;
      }
    } catch {
      /* ignore captures */
    }
    return {
      required: true,
      type,
      pageUrl: this.page().url(),
      screenshotPath,
      track,
      handle,
      attempts: 0,
      capturedAt: Date.now(),
    };
  }

  private challengePayload(): VerificationStatus {
    const ch = this.challenge;
    const ttlMs = this.config.session.verificationTtlSec * 1000;
    return {
      required: !!(ch && ch.required),
      type: ch?.type ?? 'unknown',
      pageUrl: ch?.pageUrl ?? null,
      screenshotPath: ch?.screenshotPath ?? null,
      track: ch?.track ?? null,
      handle: ch?.handle ?? null,
      autoSolveSupported: ch?.type === 'slider',
      attempts: ch?.attempts ?? 0,
      expiresAt: ch ? new Date(ch.capturedAt + ttlMs).toISOString() : null,
      message: ch?.type === 'qr' ? 'QR code verification requires manual scan (Alibaba App)' : null,
    };
  }

  async verificationGet(): Promise<VerificationStatus> {
    this.assertReady();
    if (!this.challenge || !this.challenge.required) {
      const captcha = await this.pageHasCaptcha();
      if (captcha) this.challenge = await this.captureChallenge();
    }
    return this.challengePayload();
  }

  private async dragSlider(mode: 'auto' | 'drag', req: VerificationSolveRequest): Promise<{ solved: boolean; detail: string; elapsedMs: number }> {
    const started = Date.now();
    if (mode === 'drag' && req.from && req.to) {
      await this.page().mouse.move(req.from[0], req.from[1], { steps: 4 });
      await this.page().mouse.down();
      const steps = 30;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = req.from[0] + (req.to[0] - req.from[0]) * t;
        const y = req.from[1] + (req.to[1] - req.from[1]) * t;
        await this.page().mouse.move(x, y);
        await sleep(Math.max(8, Math.floor(req.durationMs / steps)));
      }
      await this.page().mouse.up();
      await sleep(2600);
      const captcha = await this.pageHasCaptcha();
      return { solved: !captcha, detail: captcha ? 'still-captcha' : 'ok', elapsedMs: Date.now() - started };
    }
    const geo = await this.page().evaluate(() => {
      const handle = document.querySelector('#nc_1_n1z') as HTMLElement | null;
      const track = (document.querySelector('#nc_1_wrapper') || document.querySelector('.nc_wrapper')) as HTMLElement | null;
      if (!handle || !track) return null;
      const h = handle.getBoundingClientRect();
      const t = track.getBoundingClientRect();
      return { hx: h.x + h.width / 2, hy: h.y + h.height / 2, hw: h.width, tx: t.x, tw: t.width };
    });
    if (!geo) return { solved: !(await this.pageHasCaptcha()), detail: 'no-slider', elapsedMs: Date.now() - started };
    const startX = geo.hx;
    const startY = geo.hy;
    const endX = Math.min(geo.tx + geo.tw - geo.hw / 2 + 3, geo.tx + geo.tw - 4);
    await this.page().mouse.move(startX - 4, startY + 1, { steps: 6 });
    await sleep(300 + jitter(200));
    await this.page().mouse.move(startX, startY, { steps: 3 });
    await sleep(200 + jitter(150));
    await this.page().mouse.down();
    await sleep(380 + jitter(200));
    await this.page().mouse.move(startX + 4, startY + 1, { steps: 2 });
    await sleep(150);
    const steps = 54 + Math.floor(Math.random() * 8);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = t < 0.35 ? 0.5 * (t / 0.35) * (t / 0.35) * 0.18 : 0.18 + 0.82 * (1 - Math.pow(2, -6 * ((t - 0.35) / 0.65)));
      const x = startX + (endX - startX) * ease + (Math.random() * 2 - 1) * 1.6;
      const y = startY + (Math.random() * 2 - 1) * 1.7;
      await this.page().mouse.move(x, y);
      await sleep(13 + jitter(20));
    }
    await this.page().mouse.move(endX, startY + 1, { steps: 5 });
    await sleep(280 + jitter(120));
    await this.page().mouse.move(endX - 1.5, startY, { steps: 2 });
    await sleep(160);
    await this.page().mouse.up();
    await sleep(2600);
    const captcha = await this.pageHasCaptcha();
    return { solved: !captcha, detail: captcha ? 'still-captcha' : 'ok', elapsedMs: Date.now() - started };
  }

  async solveVerification(req: VerificationSolveRequest): Promise<VerificationSolveResponse> {
    this.assertReady();
    const started = Date.now();
    this.riskState = 'solving';
    if (!this.challenge?.required) {
      const captcha = await this.pageHasCaptcha();
      if (!captcha) {
        this.riskState = 'normal';
        throw new AliError('CAPTCHA_FAILED', 'no active captcha challenge; nothing to solve');
      }
      this.challenge = await this.captureChallenge();
    }
    if (this.challenge.type === 'qr') {
      this.riskState = 'captcha';
      throw new AliError('CAPTCHA_FAILED', 'QR code verification requires manual scan (Alibaba App)', {
        details: { verification: this.challengePayload() },
      });
    }
    const attempts: VerificationSolveResponse['attempts'] = [];
    const max = this.config.session.verificationAttempts;
    for (let i = 1; i <= max; i++) {
      const r = await this.dragSlider(req.mode, req);
      attempts.push({ n: i, solved: r.solved, detail: r.detail, elapsedMs: r.elapsedMs });
      if (this.challenge) this.challenge.attempts = i;
      if (r.solved) {
        this.riskState = 'normal';
        this.lastSolvedAt = Date.now();
        this.consecutiveFailures = 0;
        this.challenge = null;
        await this.refreshCookies();
        this.record('captcha_solved', `attempt=${i}`);
        return { solved: true, attempts, elapsedMs: Date.now() - started, x5secExpiresAt: iso(this.x5secExpiresAt) };
      }
      // reload to re-arm slider
      try {
        await this.page().reload({ waitUntil: 'domcontentloaded', timeout: this.config.session.requestTimeoutMs });
        await sleep(3200);
      } catch {
        /* ignore */
      }
    }
    this.consecutiveFailures++;
    const cooldown = Math.min(
      this.config.session.cooldownMaxSec * 1000,
      this.config.session.cooldownSec * 1000 * Math.pow(2, Math.max(0, this.consecutiveFailures - 1)),
    );
    this.cooldownUntil = Date.now() + cooldown;
    this.riskState = 'cooling';
    this.challenge = await this.captureChallenge();
    this.record('captcha_failed', `attempts=${max}`);
    throw new AliError('CAPTCHA_REQUIRED', 'auto solve failed; manual relay required', {
      details: { verification: this.challengePayload(), cooldownUntil: iso(this.cooldownUntil) },
    });
  }

  // ---------------------------------------------------------------- fetch
  private async watchdog<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AliError('UPSTREAM_TIMEOUT', `${label} fetch hung (watchdog ${ms}ms)`)), ms);
    });
    try {
      return (await Promise.race([promise, timeout])) as T;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async rawFetch(url: string, init: { method?: string; body?: string; headers?: Record<string, string> }, lane: 'search' | 'detail' | 'factory'): Promise<FetchResult> {
    const started = Date.now();
    const page = this.page();
    const payload = {
      url,
      method: init.method ?? 'GET',
      body: init.body ?? null,
      headers: init.headers ?? {},
    };
    let fetched: Omit<FetchResult, 'latencyMs'>;
    try {
      fetched = await this.watchdog(
        page.evaluate(
          async (p) => {
            const resp = await fetch(p.url, {
              method: p.method,
              body: p.body ?? undefined,
              headers: p.headers,
              credentials: 'include',
            });
            const text = await resp.text();
            return {
              status: resp.status,
              text: text.slice(0, 6_000_000),
              contentType: resp.headers.get('content-type') ?? '',
              bytes: text.length,
            };
          },
          payload,
        ),
        this.config.session.watchdogMs,
        lane,
      );
    } catch (err) {
      if (err instanceof AliError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new AliError(
        'UPSTREAM_ERROR',
        /Failed to fetch|NetworkError|net::ERR|load failed/i.test(msg)
          ? `upstream fetch failed（CORS/网络/风控）：${msg.slice(0, 200)}`
          : `upstream evaluate failed：${msg.slice(0, 200)}`,
        { retryable: true, details: { url } },
      );
    }
    const latencyMs = Date.now() - started;
    this.lastFetchAt = Date.now();
    if (lane === 'detail') this.lastDetailAt = this.lastFetchAt;
    this.requestTimes.push(this.lastFetchAt);
    this.fetchCount++;
    return { ...fetched, latencyMs };
  }

  private async laneWait(lane: 'search' | 'detail' | 'factory'): Promise<void> {
    if (lane === 'detail') {
      while (this.detailInFlight >= this.config.session.detailConcurrency) await sleep(120);
      const gap = this.lastDetailAt + this.config.session.detailIntervalMs - Date.now();
      if (gap > 0) await sleep(gap + jitter(200));
      this.detailInFlight++;
      return;
    }
    const gap = this.lastFetchAt + this.config.session.fetchIntervalMs - Date.now();
    if (gap > 0) await sleep(gap + jitter(this.config.session.fetchJitterMs));
  }

  private async laneRelease(lane: 'search' | 'detail' | 'factory'): Promise<void> {
    if (lane === 'detail') this.detailInFlight = Math.max(0, this.detailInFlight - 1);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.opChain.then(fn, fn);
    this.opChain = next.catch(() => undefined);
    return next;
  }

  /** 从 worker 页 fetch 文本（搜索页 HTML / 任意 GET） */
  async fetchText(url: string, opts: { lane?: 'search' | 'detail' | 'factory'; autoSolve?: boolean } = {}): Promise<FetchResult> {
    this.assertReady();
    if (Date.now() < this.cooldownUntil) {
      throw new AliError('RISK_COOLDOWN', 'in cooldown after captcha failures', {
        retryAfterMs: this.cooldownUntil - Date.now(),
        details: { cooldownUntil: iso(this.cooldownUntil) },
      });
    }
    const lane = opts.lane ?? 'search';
    return this.enqueue(async () => {
      await this.budgetGuard();
      await this.laneWait(lane);
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          let res: FetchResult;
          try {
            res = await this.rawFetch(url, {}, lane);
          } catch (err) {
            if (err instanceof AliError && err.code === 'UPSTREAM_TIMEOUT') {
              this.lastFetchHungAt = Date.now();
              this.riskState = 'degraded';
              this.record('fetch_hung', url.split('?')[0]);
              const recovered = await this.recoverByNavigation(url);
              if (!recovered) throw err;
              res = await this.rawFetch(url, {}, lane);
            } else {
              throw err;
            }
          }
          if (CAPTCHA_RE.test(res.text)) {
            this.riskState = 'captcha';
            this.record('fetch_captcha', url.split('?')[0]);
            const recovered = await this.recoverByNavigation(url);
            if (!recovered) {
              throw new AliError('CAPTCHA_REQUIRED', 'captcha required before fetch', {
                details: { verification: this.challengePayload() },
              });
            }
            res = await this.rawFetch(url, {}, lane);
          }
          if (res.status >= 400) {
            throw new AliError(res.status >= 500 ? 'UPSTREAM_ERROR' : 'UPSTREAM_ERROR', `upstream status ${res.status}`, {
              details: { status: res.status, url: url.split('?')[0] },
            });
          }
          if (this.riskState === 'degraded' && !this.pageHasCaptchaSafe()) {
            this.riskState = 'normal';
          }
          return res;
        }
        throw new AliError('UPSTREAM_ERROR', 'fetch retry exhausted');
      } finally {
        await this.laneRelease(lane);
      }
    });
  }

  private pageHasCaptchaSafe(): boolean {
    return false;
  }

  /** 从 worker 页跨子域 POST render.htm（CORS 允许） */
  async fetchRender(subdomain: string, componentKeys = 'shopSign,companyCard,companyOverview'): Promise<{ json: unknown; latencyMs: number }> {
    this.assertReady();
    const url = buildRenderApiUrl(subdomain);
    const body = renderApiBody(subdomain, componentKeys);
    const result = await this.fetchTextPost(url, body, { lane: 'detail' });
    let json: unknown;
    try {
      json = JSON.parse(result.text);
    } catch {
      throw new AliError('UPSTREAM_CHANGED', 'render.htm returned non-JSON');
    }
    return { json, latencyMs: result.latencyMs };
  }

  private async fetchTextPost(url: string, body: string, opts: { lane: 'search' | 'detail' | 'factory' }): Promise<FetchResult> {
    return this.enqueue(async () => {
      await this.budgetGuard();
      await this.laneWait(opts.lane);
      try {
        const result = await this.rawFetch(url, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }, opts.lane);
        if (result.status >= 400) {
          throw new AliError('UPSTREAM_ERROR', `render upstream status ${result.status}`);
        }
        return result;
      } finally {
        await this.laneRelease(opts.lane);
      }
    });
  }

  /** 工厂目录 JSON（GET gateway） */
  async fetchFactoryJson(categoryId: string, page: number, pageSize: number): Promise<unknown> {
    this.assertReady();
    const url = buildFactoryApiUrl(this.config, { categoryId, page, pageSize });
    const result = await this.fetchText(url, { lane: 'factory' });
    try {
      return JSON.parse(result.text);
    } catch {
      throw new AliError('UPSTREAM_CHANGED', 'factory api returned non-JSON');
    }
  }

  private async recoverByNavigation(url: string): Promise<boolean> {
    this.record('recover', url.split('?')[0]);
    try {
      await this.navigate(url, { reason: 'recover', force: true });
      return true;
    } catch (err) {
      if (err instanceof AliError && err.code === 'CAPTCHA_REQUIRED') return false;
      return false;
    }
  }

  // ---------------------------------------------------------------- login (optional)
  async loginStart(): Promise<LoginStatus> {
    this.assertReady();
    const loginId = `login_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    if (this.currentLoginId && this.loginPage && !this.loginPage.isClosed()) {
      this.rememberLogin(this.currentLoginId, 'cancelled');
    }
    this.currentLoginId = loginId;
    const ctx = this.host.context();
    if (this.loginPage && !this.loginPage.isClosed()) {
      await this.loginPage.close().catch(() => {});
    }
    this.loginPage = await ctx.newPage();
    await this.loginPage
      .goto(this.config.loginUrl, { waitUntil: 'domcontentloaded', timeout: this.config.session.requestTimeoutMs })
      .catch(() => undefined);
    await sleep(3000);
    let screenshotPath: string | null = null;
    try {
      const dir = path.join(this.config.dataDir, 'run');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      screenshotPath = path.join(dir, `login-${loginId}.png`);
      await this.loginPage.screenshot({ path: screenshotPath });
    } catch {
      /* ignore */
    }
    await this.refreshCookies();
    return {
      state: 'pending',
      action: 'enter_credentials',
      loginId,
      loginUrl: this.config.loginUrl,
      screenshotPath,
      expiresAt: new Date(Date.now() + this.config.session.loginTimeoutSec * 1000).toISOString(),
      message: '请在已打开的登录页完成登录（可选；v1 匿名即可完成全部查询）',
    };
  }

  private async loginPageState(): Promise<{ url: string; loggedIn: boolean } | null> {
    const page = this.loginPage;
    if (!page || page.isClosed()) return null;
    try {
      const info = await page.evaluate(() => ({ url: location.href, text: (document.body ? document.body.innerText : '').slice(0, 4000) }));
      const hasSignIn = /(^|\n)\s*Sign in\s*($|\n)/i.test(info.text);
      const onLoginHost = /login\.alibaba\.com/i.test(info.url);
      return { url: info.url, loggedIn: !hasSignIn && !onLoginHost };
    } catch {
      return null;
    }
  }

  private rememberLogin(loginId: string, state: 'completed' | 'cancelled'): void {
    this.loginStates.set(loginId, state);
    while (this.loginStates.size > 20) {
      const first = this.loginStates.keys().next().value;
      if (first === undefined) break;
      this.loginStates.delete(first);
    }
  }

  private async closeLoginPage(): Promise<void> {
    if (this.loginPage && !this.loginPage.isClosed()) await this.loginPage.close().catch(() => {});
    this.loginPage = null;
  }

  async cancelLogin(): Promise<void> {
    if (this.currentLoginId) this.rememberLogin(this.currentLoginId, 'cancelled');
    await this.closeLoginPage();
    this.currentLoginId = null;
  }

  async loginStatus(loginId: string): Promise<LoginStatus> {
    this.assertReady();
    const remembered = this.loginStates.get(loginId);
    const status = (state: LoginStatus['state'], message: string): LoginStatus => ({
      state,
      action: state === 'logged_in' ? 'none' : 'enter_credentials',
      loginId,
      loginUrl: this.config.loginUrl,
      screenshotPath: null,
      expiresAt: new Date(Date.now() + this.config.session.loginTimeoutSec * 1000).toISOString(),
      message,
    });
    if (remembered === 'cancelled') return status('cancelled', 'login cancelled');
    if (remembered === 'completed') {
      await this.detectLogin();
      return status(this.loggedIn ? 'logged_in' : 'failed', this.loggedIn ? 'logged in' : 'login page closed before completion');
    }
    if (!this.currentLoginId || loginId !== this.currentLoginId) {
      if (this.loggedIn) return status('logged_in', 'already logged in');
      throw new AliError('NOT_FOUND', `unknown loginId: ${loginId}（先用 ali login 开始一次登录）`);
    }
    const pageState = await this.loginPageState();
    if (pageState?.loggedIn) {
      this.loggedIn = true;
      this.modeValue = 'logged_in';
      await this.detectLogin();
      if (this.currentLoginId) this.rememberLogin(this.currentLoginId, 'completed');
      this.currentLoginId = null;
      await this.closeLoginPage();
      this.logger.info('login.completed', { mode: this.modeValue });
      return status('logged_in', 'logged in');
    }
    await this.detectLogin();
    if (this.loggedIn) {
      if (this.currentLoginId) this.rememberLogin(this.currentLoginId, 'completed');
      this.currentLoginId = null;
      await this.closeLoginPage();
      return status('logged_in', 'logged in');
    }
    return {
      ...status('pending', 'waiting for manual login'),
      loginUrl: pageState?.url ?? this.config.loginUrl,
    };
  }

  // ---------------------------------------------------------------- snapshot
  snapshot(): SessionSnapshot {
    const risk: RiskState =
      Date.now() < this.cooldownUntil
        ? 'cooling'
        : this.riskState === 'captcha' || this.riskState === 'solving'
          ? 'captcha'
          : this.riskState === 'degraded'
            ? 'degraded'
            : 'normal';
    let pid: number | null = null;
    try {
      pid = process.pid;
    } catch {
      pid = null;
    }
    return {
      mode: this.modeValue,
      loggedIn: this.loggedIn,
      account: this.account,
      language: this.config.language,
      browser: {
        running: this.host.isConnected(),
        pid,
        headless: this.config.headless,
        uptimeMs: this.host.startedAtMs() ? Date.now() - this.host.startedAtMs() : 0,
      },
      worker: {
        url: this.started ? (this.workerUrl ?? this.config.baseUrl) : null,
        ready: this.workerReady,
        fetchHealthy: this.lastFetchHungAt === 0 || Date.now() - this.lastFetchHungAt > 60_000,
        lastFetchHungAt: iso(this.lastFetchHungAt),
      },
      risk: {
        state: risk,
        x5secExpiresAt: iso(this.x5secExpiresAt),
        cooldownUntil: iso(this.cooldownUntil),
        captchaRequired: this.challenge?.required ?? false,
        lastSolvedAt: iso(this.lastSolvedAt),
        lastError: this.lastError,
      },
      upstream: {
        requestsLast10Min: this.nowRequests(),
        lastPageNavAt: iso(this.lastPageNavAt),
        lastFetchAt: iso(this.lastFetchAt),
        lastDetailAt: iso(this.lastDetailAt),
        events: [...this.events],
      },
    };
  }

  mode(): 'logged_in' | 'anonymous' | 'degraded' {
    return this.riskState === 'degraded' || this.riskState === 'cooling' ? 'degraded' : this.modeValue;
  }
}
