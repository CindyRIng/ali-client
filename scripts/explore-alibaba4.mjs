/** 探路 v4：province 参数是否生效 / 公司页相似供应商 / 其它目录入口 */
import fs from 'node:fs';
import { launchPersistentContext } from 'cloakbrowser';
const OUT = '/tmp/explore4'; const DIR = '/tmp/ali-explore-svc-profile';
fs.mkdirSync(OUT, { recursive: true });
for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(`${DIR}/${f}`, { force: true });
const ctx = await launchPersistentContext({ userDataDir: DIR, headless: true, timezone: 'Asia/Shanghai', locale: 'en-US', humanize: true, viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const out = {};
async function grab(name, url, kind = 'search') {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const text = document.body?.innerText ?? '';
      const subs = [...new Set([...html.matchAll(/\/\/([a-z0-9][a-z0-9-]*)\.en\.alibaba\.com(?:\/|["'])/g)].map((m) => m[1]))];
      const ids = [...new Set([...html.matchAll(/companyId["'\s:]+["']?(\d{5,})/g)].map((m) => m[1]))];
      const total = (text.match(/[\d,]+\s+(?:results?|suppliers?|products?|companies)/gi) || []).slice(0, 8);
      const sections = ['Similar','Recommended','You may also like','Related','suppliers like','neighbors'].filter((k) => new RegExp(k, 'i').test(text));
      return { finalUrl: location.href, title: document.title, captcha: /CAPTCHA Verification|slide to verify/i.test(text), subs, ids, total, sections, textHead: text.slice(0, 600), htmlLen: html.length };
    });
    fs.writeFileSync(`${OUT}/${name}.html`, await page.content());
    console.log(`[${name}] title=${info.title.slice(0, 60)} captcha=${info.captcha} subs=${info.subs.length} ids=${info.ids.length} total=${info.total?.slice(0, 3)} sections=${info.sections}`);
    out[name] = info;
  } catch (e) { console.log(`[${name}] ERR`, String(e).slice(0, 150)); out[name] = { error: String(e) }; }
}
const base = 'https://www.alibaba.com/trade/search?fsb=y&IndexArea=product_en&keywords=wire%20mesh&tab=supplier';
await grab('search-wiremesh', base);
await grab('search-wiremesh-prov', base + '&country=CN&province=Hebei');
await grab('search-wiremesh-provcode', base + '&country=CN&provinceCode=130000');
await grab('search-wiremesh-city', base + '&country=CN&province=Hebei&city=Hengshui');
await grab('company-kangyuan', 'https://kangyuanxiangsu.en.alibaba.com/company_profile.html');
await grab('company-anping', 'https://apqunli.en.alibaba.com/company_profile.html');
await grab('fuwu-verified', 'https://fuwu.alibaba.com/page/verifiedsuppliers.htm');
await grab('robots', 'https://www.alibaba.com/robots.txt');
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(out, null, 2));
await ctx.close();
console.log('saved /tmp/explore4/result.json');
