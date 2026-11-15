/**
 * 浏览器宿主类型（cloakbrowser 封装）
 */
export interface BrowserStartOptions {
  profileDir: string;
  headless: boolean;
  humanize?: boolean;
  timezone?: string;
  locale?: string;
  viewport?: { width: number; height: number };
  args?: string[];
}

export interface BrowserInfo {
  connected: boolean;
  headless: boolean;
  profileDir: string;
  browserVersion?: string;
}

export interface BrowserHost {
  start(): Promise<void>;
  isConnected(): boolean;
  context(): import('playwright-core').BrowserContext;
  page(): import('playwright-core').Page;
  info(): BrowserInfo;
  close(): Promise<void>;
}
