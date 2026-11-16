/**
 * 探路 v2：使用服务 profile 的副本（有 cookie/x5sec），探索阿里「按省/城市列出公司」的路径
 * 输出：/tmp/explore2/{result.json, *.html, network/*.json}
 */
import fs from 'node:fs';
import { launchPersistentContext } from 'cloakbrowser';

const OUT = '/tmp/explore2';
const DIR = '/tmp/ali-explore-svc-profile';
fs.mkdirSync(`${OUT}/network`, { recursive: true });
for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(`${DIR}/${f}`, { force: true });

const ctx = await launchPersistentContext({ userDataDir: DIR, headless: true, timezone: 'Asia/Shanghai', locale: 'en-US', humanize: true, viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const net = [];
page.on('response', async (resp) => {
  const url = resp.url();
  if (!/alibaba\.com/.test(url)) return;
  const ct = (resp.headers()['content-type'] ?? '').split(';')[0];
  if (!/json/.test(ct)) return;
  const item = { url: url.slice(0, 600), status: resp.status(), ct };
  net.push(item);
  if (net.length <= 20) {
    try {
      const body = await resp.text();
      fs.writeFileSync(`${OUT}/network/${String(net.length).padStart(2, '0')}.json`, body.slice(0, 200000));
    } catch {}
  }
});

async function probe(name, url, evalExtra) {
  const item = { name, url, finalUrl: null, title: '', captcha: false, len: 0, ms: 0, anchors: [], info: null, error: null };
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    item.info = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const text = document.body?.innerText ?? '';
      const anchors = [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href') ?? '')
        .filter((h) => /countrysearch|showroom|supplier|manufacturer|region|province|city/i.test(h))
        .slice(0, 30);
      const tags = [...document.querySelectorAll('body *')]
        .filter((el) => el.children.length === 0)
        .map((el) => (el.textContent || '').trim())
        .filter((t) => /^(Location|Region|Province|Country|City|Supplier location|All Countries)/i.test(t))
        .slice(0, 20);
      return {
        finalUrl: location.href,
        title: document.title,
        htmlLen: html.length,
        captcha: /CAPTCHA Verification|slide to verify|Please slide/i.test(text),
        textLen: text.length,
        filterLabels: tags,
        anchors,
        companyIdCount: (html.match(/companyId/g) || []).length,
        pagination: [...new Set([...html.matchAll(/(?:page|pageNo|pageNum)=["']?(\d{1,3})/g)].map((m) => m[1]))].slice(0, 20),
        provinceHits: (html.match(/(?:province|provinceCode|regionCode|locationCode)["']?\s*[:=]\s*["'][^"']{0,40}/gi) || []).slice(0, 10),
        apiUrls: [...new Set([...html.matchAll(/https?:\/\/[^"'\s<>]+?(?:api|json)[^"'\s<>]*/g)].map((m) => m[0]).filter((u) => /alibaba/.test(u)))].slice(0, 20),
      };
    });
    item.finalUrl = item.info.finalUrl;
    item.title = item.info.title;
    item.len = item.info.htmlLen;
    item.captcha = item.info.captcha;
    item.anchors = item.info.anchors;
    fs.writeFileSync(`${OUT}/${name}.html`, await page.content());
    if (page.url().includes('trade/search')) {
      item.pageText = await page.evaluate(() => (document.body?.innerText ?? '').slice(0, 1200));
    }
  } catch (e) {
    item.error = String(e).slice(0, 300);
  }
  item.ms = Date.now() - t0;
  console.log(`[${name}] ${item.finalUrl ?? '-'} title=${(item.title || '').slice(0, 50)} captcha=${item.captcha} len=${item.len} companyIdHits=${item.info?.companyIdCount ?? '-'} ${item.ms}ms ${item.error ? 'ERR' : ''}`);
  if (item.info?.filterLabels?.length) console.log('   filterLabels:', item.info.filterLabels);
  if (item.info?.provinceHits?.length) console.log('   provinceHits:', item.info.provinceHits.slice(0, 4));
  return item;
}

const results = [];
results.push(await probe('svc-search-hebei', 'https://www.alibaba.com/trade/search?fsb=y&IndexArea=product_en&keywords=Hebei&tab=supplier'));
results.push(await probe('svc-search-hebei-prov', 'https://www.alibaba.com/trade/search?fsb=y&IndexArea=product_en&keywords=Hebei&tab=supplier&country=CN&province=Hebei'));
results.push(await probe('svc-search-hebei-provcode', 'https://www.alibaba.com/trade/search?fsb=y&IndexArea=product_en&keywords=Hebei&tab=supplier&country=CN&provinceCode=130000'));
results.push(await probe('countrysearch-hebei', 'https://www.alibaba.com/countrysearch/CN/hebei-suppliers.html'));
results.push(await probe('countrysearch-hebei2', 'https://www.alibaba.com/countrysearch/CN/Hebei.html'));
results.push(await probe('countrysearch-p2', 'https://www.alibaba.com/countrysearch/CN/china-suppliers.html?page=2'));
results.push(await probe('hebei-subdomain', 'https://hebei.en.alibaba.com/'));
results.push(await probe('svc-search-company-tab', 'https://www.alibaba.com/trade/search?fsb=y&IndexArea=company_en&keywords=Hebei'));
results.push(await probe('svc-search-supplier-tab', 'https://www.alibaba.com/trade/search?fsb=y&IndexArea=supplier_en&keywords=Hebei'));
results.push(await probe('sale-factories', 'https://sale.alibaba.com/p/factories/v2/index.html'));
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ net, results }, null, 2));
await ctx.close();
console.log('saved /tmp/explore2/result.json; network', net.length);
