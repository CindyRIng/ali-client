// Alibaba recon probe: capture request chain + clean HTML/JSON
// usage: cloak-run node probe.mjs <home|search|detail|filter> [--headful]
import { launchPersistentContext } from 'cloakbrowser';
import fs from 'node:fs/promises';
import path from 'node:path';

const HOME = process.env.HOME;
const OUT = path.join(HOME, 'ali-client/exploration/2026-11-15/artifacts');
const PROFILE = process.env.ALI_PROFILE || path.join(HOME, '.ali-recon-profile');
const task = process.argv[2] || 'home';
const headful = process.argv.includes('--headful');
const PREFIX = process.env.NAME || task;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SEARCH_URL = (kw, page = 1) =>
  `https://www.alibaba.com/trade/search?fsb=y&IndexArea=product_en&has4Tab=true&keywords=${encodeURIComponent(kw)}&originKeywords=${encodeURIComponent(kw)}&tab=supplier&page=${page}`;

async function save(name, data) {
  await fs.writeFile(path.join(OUT, name), data);
  return `${name} (${typeof data === 'string' ? data.length : 'obj'} bytes)`;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const t0 = Date.now();
  const ctx = await launchPersistentContext({
    userDataDir: PROFILE,
    headless: !headful,
    humanize: false,
    timezone: 'Asia/Shanghai',
    locale: 'en-US',
    viewport: { width: 1920, height: 1080 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const xhr = [];
  const docs = [];
  page.on('request', (req) => {
    const u = req.url();
    if (!/alibaba\.com/.test(u)) return;
    if (req.resourceType() === 'document') docs.push({ method: req.method(), url: u, ts: Date.now() });
  });
  page.on('response', (resp) => {
    const req = resp.request();
    const u = resp.url();
    if (!/alibaba\.com/.test(u)) return;
    const rt = req.resourceType();
    const ct = (resp.headers()['content-type'] || '').toLowerCase();
    if (!(rt === 'xhr' || rt === 'fetch' || ct.includes('application/json'))) return;
    const rec = { idx: xhr.length, method: req.method(), url: u, status: resp.status(), ct, ts: Date.now() };
    xhr.push(rec);
    resp
      .text()
      .then((t) => {
        rec.bytes = t.length;
        rec.body = t.length > 80000 ? t.slice(0, 80000) + '\n...[TRUNCATED]' : t;
      })
      .catch((e) => {
        rec.bodyErr = String(e).slice(0, 200);
      });
  });

  const summary = { task, headful, profile: PROFILE, startedAt: new Date().toISOString() };
  let targetUrl = 'https://www.alibaba.com/';
  if (task === 'search') targetUrl = SEARCH_URL(process.argv[3] || 'hebei', Number(process.argv[4] || 1));
  if (task === 'detail' || task === 'url') targetUrl = process.argv[3];
  if (process.env.NAME) summary.name = process.env.NAME;

  const resp = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => {
    summary.gotoError = String(e).slice(0, 300);
    return null;
  });
  summary.gotoStatus = resp?.status();
  await sleep(Number(process.env.WAIT_MS || 9000));
  summary.finalUrl = page.url();
  summary.title = await page.title();
  const info = await page.evaluate(() => {
    const txt = document.body ? document.body.innerText : '';
    const html = document.documentElement ? document.documentElement.outerHTML : '';
    const count = (re) => (html.match(re) || []).length;
    return {
      textLen: txt.length,
      textHead: txt.slice(0, 3000),
      htmlLen: html.length,
      signIn: count(/Sign in/gi),
      welcome: count(/Welcome back/gi),
      captcha: /slide to verify|unusual traffic|verify you are human|punish/i.test(html),
      supplierCards: count(/search-card|supplier-card|fy\d+-search-card/gi),
      companyLinks: count(/\/company\//gi),
      jsonLd: count(/application\/ld\+json/gi),
    };
  });
  summary.page = info;
  summary.xhrCount = xhr.length;
  summary.cookies = await ctx.cookies('https://www.alibaba.com').then((cs) => ({
    count: cs.length,
    names: cs.map((c) => c.name).sort(),
  }));

  // save artifacts
  const html = await page.content();
  summary.files = [];
  summary.files.push(await save(`${PREFIX}.html`, html));
  const shot = path.join(OUT, `${PREFIX}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  summary.files.push(`${PREFIX}.png`);
  await sleep(1500); // let body reads settle

  summary.docs = docs;
  summary.xhr = xhr.map((r) => ({
    idx: r.idx,
    method: r.method,
    status: r.status,
    bytes: r.bytes,
    ct: r.ct,
    url: r.url,
  }));
  await fs.writeFile(path.join(OUT, `${PREFIX}.xhr.json`), JSON.stringify(summary.xhr, null, 2));
  await fs.writeFile(
    path.join(OUT, `${PREFIX}.xhr.bodies.json`),
    JSON.stringify(xhr, null, 2)
  );
  summary.elapsedMs = Date.now() - t0;
  await fs.writeFile(path.join(OUT, `${PREFIX}.summary.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, page: { ...info, textHead: info.textHead.slice(0, 500) } }, null, 2));
  await ctx.close();
}

main().catch((e) => {
  console.error('PROBE_FATAL', e?.stack || String(e));
  process.exit(1);
});
