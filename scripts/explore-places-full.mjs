/**
 * 探路：countrysearch 市级/县级目录全量抓取（fetch 方式，不导航）
 * 输出 /tmp/places-crawl.json：每个 place 的 supplier 子域 + 状态
 */
import fs from 'node:fs';
import { launchPersistentContext } from 'cloakbrowser';
const OUT = '/tmp/places-crawl.json';
const DIR = '/tmp/ali-explore-svc-profile';
for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(`${DIR}/${f}`, { force: true });
const ctx = await launchPersistentContext({ userDataDir: DIR, headless: true, timezone: 'Asia/Shanghai', locale: 'en-US', humanize: true, viewport: { width: 1280, height: 800 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://www.alibaba.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);

// places: 11 cities + 118 counties, hyphenated pinyin
const pca = JSON.parse(fs.readFileSync('data/pca-code.json', 'utf8'));
const hb = pca.find((p) => String(p.name).startsWith('河北'));
const { pinyin } = await import('pinyin-pro');
const slug = (name) =>
  pinyin(String(name).replace(/(满族|回族|蒙古族|朝鲜族|自治)+/g, '').replace(/(县|市|区)$/g, ''), { toneType: 'none', type: 'array' })
    .map((s) => s.toLowerCase())
    .join('-');
const places = [];
for (const city of hb.children ?? []) {
  places.push({ kind: 'city', zh: city.name, slug: slug(city.name), cityZh: city.name });
  for (const c of city.children ?? []) {
    if (String(c.name).endsWith('区')) continue;
    if (!/(县|市)$/.test(String(c.name))) continue;
    places.push({ kind: 'county', zh: c.name, slug: slug(c.name), cityZh: city.name });
  }
}
const seen = new Set();
const list = places.filter((p) => (seen.has(p.slug) ? false : (seen.add(p.slug), true)));
console.log('places', list.length, list.slice(0, 5));

const state = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { results: {}, startedAt: new Date().toISOString() };
const known = new Set(Object.keys(state.results));
let i = 0;
for (const p of list) {
  if (known.has(p.slug)) continue;
  i++;
  const url = `https://www.alibaba.com/countrysearch/CN/${p.slug}-suppliers.html`;
  const t0 = Date.now();
  try {
    const res = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include' });
      const text = await r.text();
      return { status: r.status, len: text.length, html: text };
    }, url);
    const subs = [...new Set([...res.html.matchAll(/\/\/([a-z0-9][a-z0-9-]*)\.en\.alibaba\.com/g)].map((m) => m[1]))];
    const title = (res.html.match(/<title>([^<]*)<\/title>/) || [])[1] ?? '';
    state.results[p.slug] = { ...p, status: res.status, title: title.slice(0, 120), subs, ms: Date.now() - t0, at: new Date().toISOString() };
    console.log(`[${i}/${list.length}] ${p.slug} (${p.zh}) status=${res.status} subs=${subs.length} ${Date.now() - t0}ms`);
  } catch (e) {
    state.results[p.slug] = { ...p, error: String(e).slice(0, 200), at: new Date().toISOString() };
    console.log(`[${i}/${list.length}] ${p.slug} ERR ${String(e).slice(0, 100)}`);
  }
  if (i % 10 === 0) fs.writeFileSync(OUT, JSON.stringify(state, null, 2));
  await new Promise((r) => setTimeout(r, 700 + Math.random() * 500));
}
state.finishedAt = new Date().toISOString();
fs.writeFileSync(OUT, JSON.stringify(state, null, 2));
const all = new Set();
for (const r of Object.values(state.results)) for (const s of r.subs ?? []) all.add(s);
console.log('done. places:', Object.keys(state.results).length, 'unique subdomains:', all.size);
await ctx.close();
