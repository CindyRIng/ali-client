/** 探路：countrysearch 目录并发拼音变体（concatenated slugs） */
import fs from 'node:fs';
import { launchPersistentContext } from 'cloakbrowser';
const OUT = '/tmp/places-crawl-concat.json';
const DIR = '/tmp/ali-explore-svc-profile';
for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(`${DIR}/${f}`, { force: true });
const ctx = await launchPersistentContext({ userDataDir: DIR, headless: true, timezone: 'Asia/Shanghai', locale: 'en-US', humanize: true, viewport: { width: 1280, height: 800 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://www.alibaba.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);
const pca = JSON.parse(fs.readFileSync('data/pca-code.json', 'utf8'));
const hb = pca.find((p) => String(p.name).startsWith('河北'));
const { pinyin } = await import('pinyin-pro');
const slug = (name) =>
  pinyin(String(name).replace(/(满族|回族|蒙古族|朝鲜族|自治)+/g, '').replace(/(县|市|区)$/g, ''), { toneType: 'none', type: 'array' })
    .map((s) => s.toLowerCase())
    .join('');
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
console.log('places', list.length);
const state = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { results: {} };
let i = 0;
for (const p of list) {
  if (state.results[p.slug]) continue;
  i++;
  const url = `https://www.alibaba.com/countrysearch/CN/${p.slug}-suppliers.html`;
  try {
    const res = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include' });
      const text = await r.text();
      return { status: r.status, html: text };
    }, url);
    const subs = [...new Set([...res.html.matchAll(/\/\/([a-z0-9][a-z0-9-]*)\.en\.alibaba\.com/g)].map((m) => m[1]))];
    const title = (res.html.match(/<title>([^<]*)<\/title>/) || [])[1] ?? '';
    state.results[p.slug] = { ...p, status: res.status, title: title.slice(0, 120), subs };
    console.log(`[${i}/${list.length}] ${p.slug} subs=${subs.length}`);
  } catch (e) {
    state.results[p.slug] = { ...p, error: String(e).slice(0, 150) };
    console.log(`[${i}/${list.length}] ${p.slug} ERR`);
  }
  if (i % 10 === 0) fs.writeFileSync(OUT, JSON.stringify(state, null, 2));
  await new Promise((r) => setTimeout(r, 700 + Math.random() * 500));
}
fs.writeFileSync(OUT, JSON.stringify(state, null, 2));
const all = new Set();
for (const r of Object.values(state.results)) for (const s of r.subs ?? []) all.add(s);
console.log('done. unique subs', all.size);
await ctx.close();
