#!/usr/bin/env node
/**
 * 公司详情（render.htm）性能/质量基准
 *
 * 用法：
 *   node scripts/detail-bench.mjs --n 60            # 强制回源（refresh）
 *   node scripts/detail-bench.mjs --n 60 --warm     # 走缓存
 *   node scripts/detail-bench.mjs --n 60 --seed 河北 --pages 5
 *
 * 输出：成功/失败、平均/P50/P95 延迟、吞吐、字段完整率、错误码分布。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = 'http://127.0.0.1:8792';
const TOKEN = (() => {
  try { return /^ALI_API_TOKEN=(.+)$/m.exec(fs.readFileSync(path.join(ROOT, '.env'), 'utf8'))?.[1]?.trim() ?? ''; } catch { return ''; }
})();
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); if (i < 0) return def; const v = argv[i + 1]; return v && !v.startsWith('--') ? v : true; };
const N = Number(opt('n', 60));
const WARM = argv.includes('--warm');
const SEED = String(opt('seed', '河北'));
const PAGES = Number(opt('pages', 5));

async function api(method, pathname, body) {
  const headers = { authorization: `Bearer ${TOKEN}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const t0 = Date.now();
  const resp = await fetch(`${BASE}${pathname}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(300000) });
  const text = await resp.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: resp.status, json, ms: Date.now() - t0 };
}

function pct(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0; }

async function main() {
  console.log(`\n=== 详情基准（n=${N}${WARM ? ', warm-cache' : ', refresh'}, seed=${SEED}, pages=${PAGES}）===`);
  const t0 = Date.now();
  const search = await api('POST', '/v1/search/suppliers', { keyword: SEED, pages: PAGES, locationMode: 'off' });
  if (!search.json?.ok) throw new Error(`搜索失败: ${JSON.stringify(search.json?.error)}`);
  const ids = [...new Map((search.json.data.suppliers ?? []).map((s) => [s.companyId, s])).values()].map((s) => s.companyId);
  console.log(`候选 ${ids.length} 家（搜索 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  const targets = ids.slice(0, N);
  const lat = [];
  const errors = {};
  const fields = { joinedYears: 0, stars: 0, products: 0, location: 0, membership: 0 };
  let ok = 0;
  const t1 = Date.now();
  for (const id of targets) {
    const started = Date.now();
    const r = await api('GET', `/v1/suppliers/${id}${WARM ? '' : '?refresh=true'}`);
    const ms = Date.now() - started;
    if (r.status === 200 && r.json?.ok) {
      ok++; lat.push(ms);
      const d = r.json.data;
      if (d.joinedYears !== null && d.joinedYears !== undefined) fields.joinedYears++;
      if (d.supplierIndex?.stars !== null && d.supplierIndex?.stars !== undefined) fields.stars++;
      if (Array.isArray(d.mainProducts) && d.mainProducts.length) fields.products++;
      if (d.location?.province) fields.location++;
      if (d.membership?.plan) fields.membership++;
    } else {
      const code = r.json?.error?.code ?? `HTTP_${r.status}`;
      errors[code] = (errors[code] ?? 0) + 1;
      if (errors[code] <= 2) console.log(`  ! ${id} ${code} ${r.json?.error?.message?.slice(0, 120) ?? ''}`);
    }
    if ((ok + Object.values(errors).reduce((a, b) => a + b, 0)) % 20 === 0) {
      const done = ok + Object.values(errors).reduce((a, b) => a + b, 0);
      console.log(`  ...${done}/${targets.length}（${((Date.now() - t1) / 1000).toFixed(1)}s）`);
    }
  }
  const elapsed = (Date.now() - t1) / 1000;
  lat.sort((a, b) => a - b);
  const avg = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0;
  const total = ok + Object.values(errors).reduce((a, b) => a + b, 0);
  console.log(`\n--- 结果 ---`);
  console.log(`成功 ${ok}/${total}（${((ok / Math.max(1, total)) * 100).toFixed(1)}%）；吞吐 ${(ok / Math.max(0.001, elapsed)).toFixed(2)} 家/s；总耗时 ${elapsed.toFixed(1)}s`);
  console.log(`延迟：avg ${avg.toFixed(0)}ms  p50 ${pct(lat, 50)}ms  p95 ${pct(lat, 95)}ms  max ${lat[lat.length - 1] ?? 0}ms`);
  console.log(`字段完整率：years ${fields.joinedYears}/${ok} · stars ${fields.stars}/${ok} · products ${fields.products}/${ok} · location ${fields.location}/${ok} · membership ${fields.membership}/${ok}`);
  if (Object.keys(errors).length) console.log(`错误码：${JSON.stringify(errors)}`);
  const summary = { generatedAt: new Date().toISOString(), n: N, warm: WARM, seed: SEED, ok, total, elapsedSec: Number(elapsed.toFixed(1)), throughput: Number((ok / Math.max(0.001, elapsed)).toFixed(2)), avgMs: Number(avg.toFixed(0)), p50: pct(lat, 50), p95: pct(lat, 95), maxMs: lat[lat.length - 1] ?? 0, fields, errors };
  const file = `/tmp/detail-bench-${Date.now()}.json`;
  fs.writeFileSync(file, JSON.stringify(summary, null, 2));
  console.log(`JSON: ${file}`);
}
main().catch((e) => { console.error('BENCH_FATAL', e); process.exit(1); });
