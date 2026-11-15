/**
 * README 截图：REST /docs（headless cloak 浏览器）
 */
import { launchPersistentContext } from 'cloakbrowser';
const ctx = await launchPersistentContext({
  userDataDir: '/tmp/ali-docs-shot-profile',
  headless: true,
  timezone: 'Asia/Shanghai',
  locale: 'en-US',
  viewport: { width: 1440, height: 1000 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('http://127.0.0.1:8792/docs', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'docs/assets/rest-docs.png', fullPage: true });
await page.goto('http://127.0.0.1:8792/openapi.json', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
await ctx.close();
console.log('saved docs/assets/rest-docs.png');
