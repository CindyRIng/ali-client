#!/usr/bin/env node
/**
 * 河北省企业全量获取实测（性能基线/调优对比）
 *
 * 平台没有"按省列出全部企业"的接口，只能：
 *   1) 认证工厂目录（仅省，最多 ~500，已带省份字段）
 *   2) 关键词/城市名搜索 → 候选公司 → 详情回填确认 province
 * 本脚本做 1+2，去重后统计：
 *   - 搜索阶段耗时/候选数
 *   - 详情阶段耗时/确认 Hebei 数
 *   - 名称启发式（--name-first）跳过明显非河北/明显河北的详情请求
 *
 * 用法：
 *   node scripts/perf-hebei.mjs                     # 基线：详情验证全部候选
 *   node scripts/perf-hebei.mjs --pages 5 --detail-concurrency 6
 *   node scripts/perf-hebei.mjs --name-first        # 名称启发式加速
 *   node scripts/perf-hebei.mjs --refresh           # 强制回源（忽略缓存）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = process.env.ALI_API_URL || 'http://127.0.0.1:8792';
const TOKEN = (() => {
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    return /^ALI_API_TOKEN=(.+)$/m.exec(text)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
})();

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const PAGES = Number(opt('pages', 5));
const DETAIL_CONCURRENCY = Number(opt('detail-concurrency', 6));
const NAME_FIRST = argv.includes('--name-first');
const REFRESH = argv.includes('--refresh');
const SKIP_FACTORY = argv.includes('--skip-factory');
const MAX_CANDIDATES = Number(opt('max-candidates', 0));
const NO_DETAIL = argv.includes('--no-detail');
const DETAIL_SAMPLE = Number(opt('detail-sample', 0));
const VERIFY_SAMPLE = Number(opt('verify-sample', 0));
const DEEP = argv.includes('--deep');
const EXTENDED = argv.includes('--extended');

async function api(method, pathname, body, retries = 6) {
  try {
    return await apiOnce(method, pathname, body);
  } catch (err) {
    if ((err.code === 'RATE_LIMITED' || err.httpStatus === 429) && retries > 0) {
      console.log(`  ! local fetch budget 用尽，等待 20s 后重试（剩余 ${retries}）`);
      await new Promise((r) => setTimeout(r, 20000));
      return api(method, pathname, body, retries - 1);
    }
    if (err.code === 'RISK_COOLDOWN' && retries > 0) {
      console.log(`  ! detail 熔断/风控冷却，等待 60s 后重试（剩余 ${retries}）`);
      await new Promise((r) => setTimeout(r, 60000));
      return api(method, pathname, body, retries - 1);
    }
    throw err;
  }
}

async function apiOnce(method, pathname, body) {
  const headers = { authorization: `Bearer ${TOKEN}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const resp = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(300000),
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!resp.ok || !json?.ok) {
    const err = new Error(`${method} ${pathname} -> HTTP ${resp.status} ${json?.error?.code ?? ''} ${json?.error?.message ?? text.slice(0, 120)}`);
    err.code = json?.error?.code;
    err.httpStatus = resp.status;
    throw err;
  }
  return { data: json.data, meta: json.meta };
}

function now() { return Date.now(); }
const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** 公司名 → 省/市（名称启发式；用于减少详情请求，最终以详情为准） */
let PROVINCES = [];
let CITIES = [];
let COUNTY_HINTS = []; // { zh, en, cityEn }
try {
  const { REGION_SEED } = await import(path.join(ROOT, 'dist/data/regions.js'));
  PROVINCES = REGION_SEED.filter((r) => r.level === 'province');
  CITIES = REGION_SEED.filter((r) => r.level === 'city');
} catch {
  /* no dist */
}

// 河北县级行政区（县/县级市，排除区）：来自 data/pca-code.json + pinyin-pro
let HEBEI_COUNTIES = []; // { zh, en, cityZh, cityEn }
try {
  const pca = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/pca-code.json'), 'utf8'));
  const { pinyin: toPinyin } = await import('pinyin-pro');
  const hb = pca.find((p) => String(p.name).startsWith('河北'));
  const cityEnByZh = new Map(CITIES.map((c) => [c.nameZh, c.nameEn]));
  const strip = (name) =>
    String(name)
      .replace(/(满族|回族|蒙古族|朝鲜族|自治)+/g, '')
      .replace(/(县|市|区)$/g, '');
  for (const city of hb?.children ?? []) {
    const cityEn = cityEnByZh.get(city.name) ?? null;
    for (const g of city.children ?? []) {
      if (String(g.name).endsWith('区')) continue;
      if (!/(县|市)$/.test(String(g.name))) continue;
      const en = toPinyin(strip(g.name), { toneType: 'none', type: 'array' }).join('');
      HEBEI_COUNTIES.push({ zh: g.name, en: en.charAt(0).toUpperCase() + en.slice(1), cityZh: city.name, cityEn });
    }
  }
} catch {
  /* 无 pca 数据时仅用省市 */
}
const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s_'’.·-]/g, '');
const aliasHit = (key, aliases) =>
  (aliases ?? []).some((a) => {
    const n = norm(a);
    if (!n) return false;
    const isLatin = /[a-z]/i.test(n);
    if (isLatin && n.length < 4) return false;
    if (!isLatin && n.length < 2) return false;
    return key.includes(n);
  });
function nameHint(companyName) {
  const key = norm(companyName);
  if (!key) return { province: null, city: null };
  let province = null;
  let city = null;
  for (const c of COUNTY_HINTS) {
    if (aliasHit(key, [c.zh, c.en])) {
      return { province: 'Hebei', city: c.cityEn ?? null };
    }
  }
  for (const c of CITIES) {
    if (aliasHit(key, [c.nameEn, c.nameZh, ...(c.aliases ?? [])])) {
      city = c.nameEn;
      province = PROVINCES.find((p) => p.code === c.parentCode)?.nameEn ?? null;
      break;
    }
  }
  if (!province) {
    for (const p of PROVINCES) {
      if (aliasHit(key, [p.nameEn, p.nameZh, ...(p.aliases ?? [])])) {
        province = p.nameEn;
        break;
      }
    }
  }
  return { province, city };
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

async function main() {
  console.log(`\n=== 河北企业获取实测（pages=${PAGES}, detail-concurrency=${DETAIL_CONCURRENCY}${NAME_FIRST ? ', name-first' : ''}${REFRESH ? ', refresh' : ''}）===`);
  const t0 = now();
  const reg = await api('GET', '/v1/regions?level=city&province=Hebei');
  const cityEn = reg.data.items.map((x) => x.nameEn);
  let seeds;
  const seedPages = new Map();
  if (EXTENDED) {
    for (const s of ['Hebei', '河北', '河北省']) seedPages.set(s, 20);
    for (const c of cityEn) seedPages.set(c, 10);
    const countySeeds = HEBEI_COUNTIES.map((c) => c.en).filter((en) => !seedPages.has(en));
    for (const c of HEBEI_COUNTIES) {
      if (seedPages.has(c.en)) continue;
      seedPages.set(c.en, 1);
      void countySeeds;
    }
    seeds = [...seedPages.keys()];
    console.log(`扩展种子：省市 ${3 + cityEn.length} + 县级 ${seeds.length - 3 - cityEn.length}（county 列表 ${HEBEI_COUNTIES.length}）`);
  } else {
    seeds = ['Hebei', '河北', '河北省', ...cityEn];
    console.log(`种子 ${seeds.length} 个：${seeds.join(', ')}`);
  }

  const candidates = new Map(); // companyId -> { summary, seeds:Set, source }
  const add = (s, seed, source) => {
    if (!s?.companyId) return;
    const cur = candidates.get(s.companyId);
    if (cur) {
      cur.seeds.add(seed);
      if (!cur.summary?.storeSubdomain && s.storeSubdomain) cur.summary = s;
    } else {
      candidates.set(s.companyId, { summary: s, seeds: new Set([seed]), source });
    }
  };

  // ---------------- 1) 工厂目录（已带省份）----------------
  const factories = new Map();
  let factoryPages = 0;
  let tFactory = now();
  if (!SKIP_FACTORY) {
    for (let page = 1; page <= 5; page++) {
      const r = await api('GET', `/v1/factories?province=Hebei&page=${page}&pageSize=100${REFRESH ? '&refresh=true' : ''}`);
      factoryPages++;
      for (const it of r.data.items ?? []) {
        if (!factories.has(it.companyId)) factories.set(it.companyId, it);
        add({ companyId: it.companyId, companyName: it.companyName, storeSubdomain: null, location: { province: 'Hebei', city: it.city ?? null, confidence: 'high' }, membership: { plan: 'unknown' } }, 'factory-directory', 'factory');
      }
      if ((r.data.items ?? []).length === 0) break;
    }
  }
  const tFactoryMs = now() - tFactory;
  console.log(`工厂目录：${factories.size} 家 Hebei（${factoryPages} 页，${fmt(tFactoryMs)}，cached=${JSON.stringify(factoryPages > 0 ? '部分' : '-')}）`);

  // ---------------- 2) 关键词/城市名搜索（无回填，快）----------------
  const tSearch = now();
  const perSeed = [];
  for (const seed of seeds) {
    const started = now();
    const pagesForSeed = EXTENDED
      ? (seedPages.get(seed) ?? PAGES)
      : DEEP
        ? (seed === 'Hebei' ? 20 : seed === '河北' ? 10 : PAGES)
        : PAGES;
    const r = await api('POST', '/v1/search/suppliers', {
      keyword: seed,
      pages: pagesForSeed,
      locationMode: 'off',
      ...(REFRESH ? { refresh: true } : {}),
    });
    const list = r.data.suppliers ?? [];
    for (const s of list) add(s, seed, 'search');
    perSeed.push({ seed, items: list.length, pages: r.data.pages?.length ?? 0, ms: now() - started, cached: r.meta.cached });
    console.log(`  - ${seed.padEnd(14)} ${String(list.length).padStart(3)} 家 / ${r.data.pages?.length ?? 0} 页 ${String(now() - started).padStart(6)}ms cached=${r.meta.cached}`);
    if (MAX_CANDIDATES && candidates.size >= MAX_CANDIDATES) break;
  }
  const tSearchMs = now() - tSearch;

  let list = [...candidates.values()];
  if (MAX_CANDIDATES) list = list.slice(0, MAX_CANDIDATES);
  console.log(`\n候选去重：${list.length} 家（搜索 ${tSearchMs}ms + 工厂 ${tFactoryMs}ms）`);

  // ---------------- 3) 地点确认 ----------------
  const known = new Map(); // companyId -> { province, city, source }
  const pending = [];
  for (const c of list) {
    if (c.source === 'factory') {
      known.set(c.summary.companyId, { province: 'Hebei', city: c.summary.location?.city ?? null, source: 'factory' });
      continue;
    }
    const hint = NAME_FIRST ? nameHint(c.summary.companyName) : { province: null, city: null };
    if (hint.province === 'Hebei') {
      known.set(c.summary.companyId, { province: 'Hebei', city: hint.city, source: 'name' });
    } else if (hint.province && hint.province !== 'Hebei') {
      known.set(c.summary.companyId, { province: hint.province, city: hint.city, source: 'name' });
    } else {
      pending.push(c.summary);
    }
  }
  // 抽样验证名称启发式准确率（把 name 来源的 Hebei 候选放回详情队列）
  const nameVerified = new Set();
  if (VERIFY_SAMPLE > 0 && NAME_FIRST) {
    const nameHebei = [...known.entries()].filter(([, v]) => v.source === 'name' && v.province === 'Hebei');
    for (const [id] of nameHebei.slice(0, VERIFY_SAMPLE)) {
      const c = candidates.get(id);
      if (c) pending.push(c.summary);
      nameVerified.add(id);
    }
  }
  console.log(`名称/目录已判定：${known.size}，待详情确认：${pending.length}（其中抽样验证 ${nameVerified.size}）`);

  let pendingWork = pending;
  if (NO_DETAIL) pendingWork = [];
  else if (DETAIL_SAMPLE > 0) pendingWork = pending.slice(0, DETAIL_SAMPLE);
  console.log(`详情请求：${pendingWork.length}（跳过 ${pending.length - pendingWork.length}）`);
  const tDetail = now();
  let detailCalls = 0;
  let detailCached = 0;
  let detailErrors = 0;
  let done = 0;
  await pool(pendingWork, DETAIL_CONCURRENCY, async (s) => {
    try {
      const r = await api('GET', `/v1/suppliers/${s.companyId}${REFRESH ? '?refresh=true' : ''}`);
      detailCalls++;
      if (r.meta.cached) detailCached++;
      known.set(s.companyId, { province: r.data.location?.province ?? null, city: r.data.location?.city ?? null, source: 'detail' });
    } catch (e) {
      detailErrors++;
      known.set(s.companyId, { province: null, city: null, source: 'error', error: String(e).slice(0, 120) });
    } finally {
      done++;
      if (done % 25 === 0) console.log(`  ...详情 ${done}/${pendingWork.length}（${fmt(now() - tDetail)}）`);
    }
  });
  const tDetailMs = now() - tDetail;

  // ---------------- 4) 汇总 ----------------
  const hebei = [];
  const other = new Map();
  const unknown = [];
  for (const c of list) {
    const k = known.get(c.summary.companyId);
    if (!k || !k.province) { unknown.push(c.summary); continue; }
    if (k.province === 'Hebei') hebei.push({ ...c.summary, hebeiLocation: k });
    else other.set(k.province, (other.get(k.province) ?? 0) + 1);
  }
  const bySource = {};
  for (const h of hebei) bySource[h.hebeiLocation.source] = (bySource[h.hebeiLocation.source] ?? 0) + 1;
  const byCity = new Map();
  for (const h of hebei) {
    const city = h.hebeiLocation.city ?? '未知';
    byCity.set(city, (byCity.get(city) ?? 0) + 1);
  }
  let verifyChecked = 0;
  let verifyAgree = 0;
  for (const id of nameVerified) {
    const k = known.get(id);
    if (k?.source === 'detail') {
      verifyChecked++;
      if (k.province === 'Hebei') verifyAgree++;
    }
  }
  const totalMs = now() - t0;

  console.log(`\n=== 结果 ===`);
  console.log(`河北企业（去重）：${hebei.length} 家`);
  console.log(`  来源：${JSON.stringify(bySource)}`);
  console.log(`  城市分布：${[...byCity.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join('  ')}`);
  console.log(`  非河北：${[...other.entries()].map(([p, n]) => `${p}:${n}`).join(' ') || '0'}；地点未知：${unknown.length}`);
  if (verifyChecked > 0) console.log(`名称启发式抽样准确率：${verifyAgree}/${verifyChecked}（province=Hebei）`);
  console.log(`耗时：搜索 ${fmt(tSearchMs)} | 详情 ${fmt(tDetailMs)}（${detailCalls} 次，缓存 ${detailCached}，错误 ${detailErrors}）| 合计 ${fmt(totalMs)}`);
  console.log(`吞吐：搜索 ${(list.length / (tSearchMs / 1000)).toFixed(1)} 候选/s；详情 ${(detailCalls / (Math.max(1, tDetailMs) / 1000)).toFixed(2)} 家/s`);

  const out = {
    generatedAt: new Date().toISOString(),
    options: { pages: PAGES, detailConcurrency: DETAIL_CONCURRENCY, nameFirst: NAME_FIRST, refresh: REFRESH },
    seeds,
    candidates: list.length,
    hebei: hebei.length,
    bySource,
    byCity: Object.fromEntries(byCity),
    other: Object.fromEntries(other),
    unknown: unknown.length,
    timings: { factoryMs: tFactoryMs, searchMs: tSearchMs, detailMs: tDetailMs, totalMs },
    detailCalls,
    detailCached,
    detailErrors,
    perSeed,
    sample: hebei.slice(0, 200).map((h) => ({ companyId: h.companyId, companyName: h.companyName, province: h.hebeiLocation.province, city: h.hebeiLocation.city, source: h.hebeiLocation.source, joinedYears: h.joinedYears, plan: h.membership?.plan })),
  };
  const outFile = `/tmp/hebei-sweep-${Date.now()}.json`;
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`\n结果 JSON：${outFile}`);
}

main().catch((e) => { console.error('PERF_FATAL', e); process.exit(1); });
