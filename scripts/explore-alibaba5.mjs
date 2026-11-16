/** 探路 v5：县级 countrysearch 目录 / province 参数穷举 / 公司页推荐 API */
import fs from 'node:fs';
import { launchPersistentContext } from 'cloakbrowser';
const OUT = '/tmp/explore5'; const DIR = '/tmp/ali-explore-svc-profile';
fs.mkdirSync(OUT, { recursive: true });
for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(`${DIR}/${f}`, { force: true });
const ctx = await launchPersistentContext({ userDataDir: DIR, headless: true, timezone: 'Asia/Shanghai', locale: 'en-US', humanize: true, viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const net = [];
page.on('response', async (r) => {
  const u = r.url();
  if (/alibaba\.com/.test(u) && /(recommend|similar|company|render|gateway|supplier)/i.test(u) && /json/.test(r.headers()['content-type'] ?? '')) {
    let body = '';
    try { body = (await r.text()).slice(0, 4000); } catch {}
    net.push({ url: u.slice(0, 400), status: r.status(), body });
  }
});
const subsOf = (html) => [...new Set([...html.matchAll(/\/\/([a-z0-9][a-z0-9-]*)\.en\.alibaba\.com(?:\/|["'])/g)].map((m) => m[1]))];
async function load(name, url, wait = 2200) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(wait);
    const info = await page.evaluate(() => ({
      finalUrl: location.href, title: document.title,
      captcha: /CAPTCHA Verification|slide to verify/i.test(document.body?.innerText ?? ''),
      subs: [...new Set([...document.documentElement.innerHTML.matchAll(/\/\/([a-z0-9][a-z0-9-]*)\.en\.alibaba\.com(?:\/|["'])/g)].map((m) => m[1]))],
      len: document.documentElement.innerHTML.length,
      textHead: (document.body?.innerText ?? '').slice(0, 200),
    }));
    fs.writeFileSync(`${OUT}/${name}.html`, await page.content());
    return info;
  } catch (e) {
    return { error: String(e).slice(0, 160), subs: [] };
  }
}
const out = {};
// A. 县级 countrysearch
const places = ['anping','qinghe','ningjin','julu','xinji','gaobeidian','botou','sanhe','zunhua','wu-an'];
const union = new Set();
for (const p of places) {
  const r = await load(`cs-${p}`, `https://www.alibaba.com/countrysearch/CN/${p}-suppliers.html`);
  r.subs.forEach((s) => union.add(s));
  out[`cs-${p}`] = { title: r.title, subs: r.subs, len: r.len, error: r.error };
  console.log(`[cs-${p}] ${r.title?.slice(0, 50)} subs=${r.subs?.length ?? 0} totalUnion=${union.size}`);
}
// B. province param 穷举（同一关键词，比较集合与数量）
const base = 'https://www.alibaba.com/trade/search?fsb=y&IndexArea=product_en&keywords=wire%20mesh&tab=supplier&country=CN';
const variants = {
  none: '',
  province: '&province=Hebei',
  supplierProvince: '&supplierProvince=Hebei',
  location: '&location=Hebei',
  region: '&region=Hebei',
  provinceId: '&provinceId=13',
  provinceCode: '&provinceCode=130000',
  state: '&state=Hebei',
  countryRegion: '&countryRegion=CN-Hebei',
};
out.params = {};
const baseSubs = (await load('param-none', base)).subs;
out.params.none = baseSubs;
console.log('base subs', baseSubs.length);
for (const [k, q] of Object.entries(variants)) {
  if (!q) continue;
  const r = await load(`param-${k}`, base + q);
  out.params[k] = r.subs;
  const overlap = r.subs.filter((s) => baseSubs.includes(s)).length;
  console.log(`[param ${k}] subs=${r.subs.length} overlapWithBase=${overlap}`);
}
// C. 公司页推荐 API（等待更久+滚动）
const prof = await load('company-wait', 'https://kangyuanxiangsu.en.alibaba.com/company_profile.html', 6000);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
await page.waitForTimeout(3000);
const profSubs = await page.evaluate(() => [...new Set([...document.documentElement.innerHTML.matchAll(/\/\/([a-z0-9][a-z0-9-]*)\.en\.alibaba\.com(?:\/|["'])/g)].map((m) => m[1]))]);
out.company = { title: prof.title, subs: profSubs, net: net.filter((n) => /recommend|similar|company/i.test(n.url)).slice(0, 10) };
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(out, null, 2));
await ctx.close();
console.log('union county subs', union.size, 'saved /tmp/explore5/result.json');
