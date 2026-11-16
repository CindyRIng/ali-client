/** 探路 v3：countrysearch 省级/市级供应商目录分页能力 */
import fs from 'node:fs';
import { launchPersistentContext } from 'cloakbrowser';
const OUT = '/tmp/explore3'; const DIR = '/tmp/ali-explore-svc-profile';
fs.mkdirSync(OUT, { recursive: true });
for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(`${DIR}/${f}`, { force: true });
const ctx = await launchPersistentContext({ userDataDir: DIR, headless: true, timezone: 'Asia/Shanghai', locale: 'en-US', humanize: true, viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const results = [];
async function probe(name, url) {
  const item = { name, url, finalUrl: null, title: '', captcha: false, subdomains: [], count: 0, pag: null, len: 0, error: null, ms: 0 };
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2200);
    const info = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const text = document.body?.innerText ?? '';
      const subs = [...html.matchAll(/\/\/([a-z0-9][a-z0-9-]*)\.en\.alibaba\.com\/company_profile/g)].map((m) => m[1]);
      const pagLinks = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '').filter((h) => /page[=/]\d+|page=\d+/i.test(h)).slice(0, 10);
      const pagText = (text.match(/(?:^|\n)(\d+\s+){0,20}\d+\s*(?:\n|$)/g) || []).slice(0, 3);
      const countText = (text.match(/[\d,]+\s+(?:suppliers|results|products|companies)/gi) || []).slice(0, 6);
      return { finalUrl: location.href, title: document.title, captcha: /CAPTCHA Verification|slide to verify/i.test(text), subs: [...new Set(subs)], pagLinks, pagText, countText, len: html.length, textHead: text.slice(0, 500) };
    });
    Object.assign(item, { finalUrl: info.finalUrl, title: info.title, captcha: info.captcha, subdomains: info.subs, count: info.subs.length, pag: { links: info.pagLinks, text: info.pagText, counts: info.countText }, len: info.len, sample: info.textHead });
    fs.writeFileSync(`${OUT}/${name}.html`, await page.content());
  } catch (e) { item.error = String(e).slice(0, 200); }
  item.ms = Date.now() - t0;
  console.log(`[${name}] ${item.title?.slice(0, 55)} captcha=${item.captcha} subs=${item.count} ${item.ms}ms`, item.pag?.counts?.slice(0, 3) ?? '');
  if (item.pag?.links?.length) console.log('   pagLinks:', item.pag.links.slice(0, 4));
  results.push(item);
  return item;
}
const base = 'https://www.alibaba.com/countrysearch/CN/hebei-suppliers.html';
const p1 = await probe('hebei-p1', base);
const p2 = await probe('hebei-p2', base + '?page=2');
const p3 = await probe('hebei-p3', base + '?page=3');
const p5 = await probe('hebei-p5', base + '?page=5');
const overlap12 = p1.subdomains.filter((s) => p2.subdomains.includes(s)).length;
const overlap23 = p2.subdomains.filter((s) => p3.subdomains.includes(s)).length;
console.log('overlap p1/p2:', overlap12, 'p2/p3:', overlap23);
const city = process.argv[2] ?? 'hengshui';
await probe(`city-${city}-p1`, `https://www.alibaba.com/countrysearch/CN/${city}-suppliers.html`);
await probe(`city-${city}-p2`, `https://www.alibaba.com/countrysearch/CN/${city}-suppliers.html?page=2`);
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(results, null, 2));
await ctx.close();
