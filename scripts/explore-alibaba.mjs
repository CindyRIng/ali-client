/**
 * 探路：绕过 ali-client，直接用浏览器尝试发现更多「按地区找公司」的路径
 * 用法：node scripts/explore-alibaba.mjs
 * 输出：/tmp/explore-alibaba.json + 关键页面 HTML
 */
import fs from 'node:fs';
import { launchPersistentContext } from 'cloakbrowser';

const OUT = '/tmp/explore-alibaba';
fs.mkdirSync(OUT, { recursive: true });
const ctx = await launchPersistentContext({
  userDataDir: '/tmp/ali-explore-profile',
  headless: true,
  timezone: 'Asia/Shanghai',
  locale: 'en-US',
  humanize: true,
  viewport: { width: 1440, height: 900 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const apiHits = [];
page.on('response', (resp) => {
  const url = resp.url();
  if (!/alibaba\.com/.test(url)) return;
  const ct = resp.headers()['content-type'] ?? '';
  if (/json|javascript/.test(ct) && /(api|search|supplier|company|factory|gateway|service)/i.test(url)) {
    apiHits.push({ url: url.slice(0, 500), status: resp.status(), ct: ct.split(';')[0] });
  }
});

const variants = [
  ['search-company', 'https://www.alibaba.com/trade/search?fsb=y&IndexArea=company_en&keywords=Hebei'],
  ['search-supplier', 'https://www.alibaba.com/trade/search?fsb=y&IndexArea=supplier_en&keywords=Hebei&tab=supplier'],
  ['search-province-param', 'https://www.alibaba.com/trade/search?fsb=y&IndexArea=company_en&keywords=&country=CN&province=Hebei'],
  ['countrysearch-cn', 'https://www.alibaba.com/countrysearch/CN/china-suppliers.html'],
  ['companies', 'https://www.alibaba.com/companies'],
  ['manufacturers', 'https://www.alibaba.com/manufacturers'],
  ['showroom-cn-suppliers', 'https://www.alibaba.com/showroom/china-suppliers.html'],
];
const results = [];
for (const [name, url] of variants) {
  const item = { name, url, finalUrl: null, title: '', htmlLen: 0, captcha: false, companyIds: 0, anchors: [], network: [] };
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const text = document.body?.innerText ?? '';
      const anchors = [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href') || '')
        .filter((h) => /supplier|manufacturer|compan|countrysearch|showroom|factories|region|province/i.test(h))
        .slice(0, 40);
      return {
        finalUrl: location.href,
        title: document.title,
        htmlLen: html.length,
        captcha: /CAPTCHA Verification|slide to verify|Please slide/i.test(text),
        companyIds: (html.match(/companyId["':\s]+[0-9]{5,}/g) || []).slice(0, 3),
        anchorCount: anchors.length,
        anchors,
        hasKeys: Object.keys(window).filter((k) => /^__|data|state|config/i.test(k)).slice(0, 20),
        bodyHead: text.slice(0, 300),
      };
    });
    item.finalUrl = info.finalUrl;
    item.title = info.title;
    item.htmlLen = info.htmlLen;
    item.captcha = info.captcha;
    item.companyIds = info.companyIds?.length ?? 0;
    item.anchors = info.anchors;
    item.network = apiHits.splice(0, 12);
    item.sample = info.bodyHead;
    item.windowKeys = info.hasKeys;
    fs.writeFileSync(`${OUT}/${name}.html`, await page.content());
  } catch (e) {
    item.error = String(e).slice(0, 300);
  }
  item.ms = Date.now() - t0;
  console.log(`[${name}] ${item.finalUrl ?? '-'} title=${item.title?.slice(0, 60)} captcha=${item.captcha} companyIds=${item.companyIds} ${item.ms}ms ${item.error ? 'ERR:' + item.error : ''}`);
  results.push(item);
}

fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(results, null, 2));
await ctx.close();
console.log('saved', `${OUT}/result.json`);
