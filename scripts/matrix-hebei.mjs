#!/usr/bin/env node
/**
 * Plan A 第一轮：行业 × 城市矩阵（通过 ali-client REST，strict 河北过滤）
 * - 每查询 pages=1（20 家），strict 详情回填后只保留河北
 * - 与 SQLite 现有档案对比，统计新增公司
 * - 输出 /tmp/matrix-hebei.json + exploration/2026-11-16-perf/matrix-round1.csv
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = '/home/songqian/ali-client';
const BASE = 'http://127.0.0.1:8792';
const TOKEN = (() => {
  try { return /^ALI_API_TOKEN=(.+)$/m.exec(fs.readFileSync(path.join(ROOT, '.env'), 'utf8'))?.[1]?.trim() ?? ''; } catch { return ''; }
})();
const INDUSTRIES = (process.argv[2] ? process.argv[2].split(',') : [
  'wire mesh', 'auto parts', 'pipe fitting', 'hardware', 'glass', 'bicycle',
]).map((s) => s.trim()).filter(Boolean);
const PAGES = Number(process.argv[3] ?? 1);
const OUT_JSON = '/tmp/matrix-hebei.json';
const CSV = path.join(ROOT, 'exploration/2026-11-16-perf/matrix-round1.csv');

const cities = ['Shijiazhuang', 'Tangshan', 'Qinhuangdao', 'Handan', 'Xingtai', 'Baoding', 'Zhangjiakou', 'Chengde', 'Cangzhou', 'Langfang', 'Hengshui'];

const db = new DatabaseSync(path.join(process.env.HOME, '.ali-client/cache.sqlite'));
const known = new Set(db.prepare('SELECT company_id FROM suppliers').all().map((r) => r.company_id));
const knownHebei = new Set(db.prepare("SELECT company_id FROM suppliers WHERE province='Hebei'").all().map((r) => r.company_id));
db.close();

async function api(method, p, body, retries = 5) {
  const headers = { authorization: `Bearer ${TOKEN}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  try {
    const resp = await fetch(`${BASE}${p}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(600000) });
    const json = await resp.json();
    if (!json.ok) {
      const e = new Error(json.error?.message ?? 'api error');
      e.code = json.error?.code;
      throw e;
    }
    return json;
  } catch (e) {
    if (retries > 0 && /RATE_LIMITED|RISK_COOLDOWN|UPSTREAM_TIMEOUT|SERVICE_UNAVAILABLE/.test(e.code ?? '')) {
      const wait = e.code === 'RATE_LIMITED' ? 20000 : e.code === 'RISK_COOLDOWN' ? 60000 : 5000;
      console.log(`  ! ${e.code} -> wait ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      return api(method, p, body, retries - 1);
    }
    throw e;
  }
}

const state = { startedAt: new Date().toISOString(), queries: [], suppliers: {} };
const t0 = Date.now();
let qi = 0;
for (const industry of INDUSTRIES) {
  for (const city of cities) {
    const keyword = `${city} ${industry}`;
    qi++;
    const started = Date.now();
    try {
      const r = await api('POST', '/v1/search/suppliers', { keyword, province: 'Hebei', pages: PAGES, maxEnrich: 60 });
      const d = r.data;
      const list = d.suppliers ?? [];
      let fresh = 0;
      for (const s of list) {
        if (!state.suppliers[s.companyId]) state.suppliers[s.companyId] = { ...s, firstQuery: keyword };
        if (!known.has(s.companyId)) { fresh++; state.suppliers[s.companyId].isNew = true; }
      }
      const q = { keyword, industry, city, ms: Date.now() - started, returned: list.length, fresh, matched: d.location?.matched, enriched: d.location?.enrichedCompanies, cached: r.meta?.cached, queryId: d.queryId };
      state.queries.push(q);
      console.log(`[${qi}/${INDUSTRIES.length * cities.length}] ${keyword.padEnd(28)} ret=${String(list.length).padStart(2)} new=${String(fresh).padStart(2)} matched=${d.location?.matched} ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (e) {
      state.queries.push({ keyword, industry, city, error: String(e).slice(0, 200), ms: Date.now() - started });
      console.log(`[${qi}/${INDUSTRIES.length * cities.length}] ${keyword.padEnd(28)} ERR ${String(e).slice(0, 120)}`);
    }
    fs.writeFileSync(OUT_JSON, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
  }
}
const total = Date.now() - t0;
const all = Object.values(state.suppliers);
const newOnes = all.filter((s) => s.isNew);
const newHebei = newOnes.filter((s) => s.location?.province === 'Hebei');
const byIndustry = {};
const byCity = {};
for (const q of state.queries) {
  if (!q.fresh) continue;
  byIndustry[q.industry] = (byIndustry[q.industry] ?? 0) + q.fresh;
  byCity[q.city] = (byCity[q.city] ?? 0) + q.fresh;
}
const summary = {
  industries: INDUSTRIES, cities, pages: PAGES,
  queries: state.queries.length,
  returnedTotal: state.queries.reduce((a, q) => a + (q.returned ?? 0), 0),
  uniqueReturned: all.length,
  newCompanies: newOnes.length,
  newHebei: newHebei.length,
  byIndustry, byCity,
  elapsedSec: Number((total / 1000).toFixed(1)),
  avgQuerySec: Number((total / 1000 / Math.max(1, state.queries.length)).toFixed(1)),
  errors: state.queries.filter((q) => q.error).length,
};
fs.writeFileSync('/tmp/matrix-hebei-summary.json', JSON.stringify(summary, null, 2));
// CSV of new companies
const header = ['companyId', 'companyName', 'province', 'city', 'plan', 'joinedYears', 'supplierIndexStars', 'mainProducts', 'storeUrl', 'firstQuery'];
const lines = [header.join(',')];
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
for (const s of newOnes) {
  lines.push([s.companyId, s.companyName, s.location?.province, s.location?.city, s.membership?.plan, s.joinedYears, s.supplierIndex?.stars, (s.mainProducts ?? []).join('|'), s.storeUrl, s.firstQuery].map(esc).join(','));
}
fs.writeFileSync(CSV, lines.join('\n'), 'utf8');
console.log('\n=== 矩阵第一轮结果 ===');
console.log(JSON.stringify(summary, null, 2));
console.log(`CSV: ${CSV}`);
console.log(`JSON: ${OUT_JSON}`);
