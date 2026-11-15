#!/usr/bin/env node
/**
 * ali-client 自测（需要常驻服务已启动：systemctl --user status ali-client）
 *
 * 覆盖：命令注册 / CLI / REST / MCP / systemd / 关键数据断言
 * 用法：npm run self-test（或 node scripts/self-test.mjs --verbose）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERBOSE = process.argv.includes('--verbose');
const BASE = 'http://127.0.0.1:8792';

function envToken() {
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = /^ALI_API_TOKEN=(.+)$/m.exec(text);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}
const TOKEN = envToken();

const results = [];
function record(name, ok, detail = '', level = 'fail') {
  const status = ok ? 'PASS' : level === 'warn' ? 'WARN' : 'FAIL';
  results.push({ name, status, detail });
  const icon = status === 'PASS' ? '✓' : status === 'WARN' ? '!' : '✗';
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`);
}

function cli(args, opts = {}) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'dist/main.js'), ...args], {
    cwd: opts.cwd ?? ROOT,
    encoding: 'utf8',
    timeout: opts.timeout ?? 180000,
    env: { ...process.env, ALI_LOG_STDOUT: 'false' },
  });
  const out = (r.stdout ?? '').trim();
  const err = (r.stderr ?? '').trim();
  if (VERBOSE && (out || err)) {
    console.log(`   $ ali ${args.join(' ')} (${Date.now() - started}ms, exit=${r.status})`);
    if (out) console.log(out.split('\n').slice(0, 6).map((l) => `     ${l}`).join('\n'));
    if (err) console.log(err.split('\n').slice(0, 3).map((l) => `     ! ${l}`).join('\n'));
  }
  return { status: r.status, out, err, ms: Date.now() - started };
}

function cliJson(args) {
  const r = cli(args);
  if (r.status !== 0) return { ...r, json: null, parseError: r.err || 'non-zero exit' };
  try {
    return { ...r, json: JSON.parse(r.out) };
  } catch (e) {
    return { ...r, json: null, parseError: String(e).slice(0, 120) };
  }
}

async function http(method, pathname, { auth = true, body } = {}) {
  const headers = {};
  if (auth && TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const started = Date.now();
  try {
    const resp = await fetch(`${BASE}${pathname}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(120000),
    });
    const text = await resp.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: resp.status, json, text, ms: Date.now() - started };
  } catch (e) {
    return { status: 0, json: null, text: String(e), ms: Date.now() - started };
  }
}

async function main() {
  console.log('=== ali-client 自测 ===\n');

  // 0. 命令注册
  const which = spawnSync('which', ['ali'], { encoding: 'utf8' });
  record('ali 命令已注册（PATH）', which.status === 0, (which.stdout ?? '').trim());
  const version = spawnSync('ali', ['--version'], { encoding: 'utf8' });
  record('ali --version', version.status === 0, (version.stdout ?? '').trim());
  if (!TOKEN) {
    record('.env 中存在 ALI_API_TOKEN', false, '缺少 .env 或 token');
  }
  // 任意目录可用（自动加载仓库 .env）
  const homeStatus = cli(['status', '-f', 'json'], { cwd: os.homedir() });
  let homeMode = null;
  try {
    homeMode = JSON.parse(homeStatus.out)?.data?.mode;
  } catch {}
  record('任意目录可用（cwd=~，自动加载仓库 .env）', homeStatus.status === 0 && !!homeMode, `mode=${homeMode ?? 'n/a'}`);

  // 1. 服务健康
  const health = await http('GET', '/v1/health', { auth: false });
  record('REST /v1/health', health.status === 200 && health.json?.ok === true, `http=${health.status} ${health.ms}ms`);
  if (health.status !== 200) {
    console.log('\n常驻服务未运行？先执行：systemctl --user start ali-client');
    printSummary();
    process.exit(1);
  }
  record('REST 服务版本', health.json?.data?.service === 'ali-client' && health.json?.data?.version === '0.1.0', health.json?.data?.version);

  // 2. 鉴权
  const noAuth = await http('GET', '/v1/status', { auth: false });
  record('REST 无 token 返回 401', noAuth.status === 401, `http=${noAuth.status}`);
  const status = await http('GET', '/v1/status');
  record('REST /v1/status（Bearer）', status.status === 200 && status.json?.data?.mode, status.json?.data?.mode);

  // 3. 文档端点
  const docs = await http('GET', '/docs', { auth: false });
  record('GET /docs', docs.status === 200 && docs.text.includes('ali-client'), `http=${docs.status}`);
  const openapi = await http('GET', '/openapi.json', { auth: false });
  const pathCount = openapi.json?.paths ? Object.keys(openapi.json.paths).length : 0;
  record('GET /openapi.json', openapi.status === 200 && pathCount >= 10, `paths=${pathCount}`);
  const mcpTools = await http('GET', '/mcp-tools.json', { auth: false });
  const toolCount = Array.isArray(mcpTools.json) ? mcpTools.json.length : 0;
  record('GET /mcp-tools.json', mcpTools.status === 200 && toolCount === 16, `tools=${toolCount}`);

  // 4. CLI 基础
  const regions = cliJson(['regions', 'list', '--level', 'province', '-f', 'json']);
  record('CLI regions list', regions.status === 0 && regions.json?.data?.count === 31, `count=${regions.json?.data?.count}`);
  const citySearch = cliJson(['regions', 'search', '衡水', '-f', 'json']);
  const firstCity = citySearch.json?.data?.items?.[0];
  record('CLI regions search 衡水', citySearch.status === 0 && firstCity?.nameEn === 'Hengshui', firstCity?.nameEn ?? '');
  const cityHe = cliJson(['regions', 'list', '--level', 'city', '--province', 'Hebei', '-f', 'json']);
  record('CLI 河北 11 地级市', cityHe.json?.data?.count === 11, `count=${cityHe.json?.data?.count}`);
  const memberships = cliJson(['memberships', '-f', 'json']);
  record('CLI memberships', memberships.status === 0 && memberships.json?.data?.plans?.length === 4, `plans=${memberships.json?.data?.plans?.length}`);
  const cacheStats = cliJson(['cache', 'stats', '-f', 'json']);
  record('CLI cache stats', cacheStats.status === 0 && cacheStats.json?.data?.driver, cacheStats.json?.data?.driver);
  const verify = cliJson(['verify', 'status', '-f', 'json']);
  record('CLI verify status', verify.status === 0 && typeof verify.json?.data?.required === 'boolean', `required=${verify.json?.data?.required}`);
  const plain = cli(['regions', 'list', '--level', 'province', '-f', 'plain']);
  record('CLI --format plain', plain.status === 0 && plain.out.split('\n')[0]?.includes('\t'), plain.out.split('\n')[0] ?? '');

  // 5. 搜索 / 翻页 / 详情（strict + 缓存）
  const search = cliJson([
    'search', 'suppliers',
    '--keyword', 'solid tire',
    '--province', 'Hebei',
    '--pages', '1',
    '--max-enrich', '5',
    '-f', 'json',
  ]);
  const qid = search.json?.data?.queryId;
  const returned = search.json?.data?.suppliers?.length ?? 0;
  record('CLI search suppliers（strict）', search.status === 0 && !!qid && search.json?.data?.location?.mode === 'strict', `queryId=${qid} returned=${returned} ${search.ms}ms`);
  if (qid) {
    const list = cliJson(['suppliers', 'list', '--query-id', qid, '--page', '1', '-f', 'json']);
    record('CLI suppliers list（缓存）', list.status === 0 && list.json?.meta?.cached === true, `cached=${list.json?.meta?.cached} count=${list.json?.data?.suppliers?.length}`);
  } else {
    record('CLI suppliers list（缓存）', false, '无 queryId，跳过');
  }
  const detailStore = cliJson(['suppliers', 'detail', '--store', 'kangyuanxiangsu', '-f', 'json']);
  const kd = detailStore.json?.data;
  record(
    'CLI detail --store（核心三字段）',
    detailStore.status === 0 && kd?.joinedYears === 6 && kd?.supplierIndex?.stars === 2 && Array.isArray(kd?.mainProducts) && kd.mainProducts.length > 0,
    `years=${kd?.joinedYears} stars=${kd?.supplierIndex?.stars} products=${kd?.mainProducts?.length}`,
  );
  record('详情省/市解析', kd?.location?.province === 'Hebei' && kd?.location?.city === 'Hengshui', `${kd?.location?.province}/${kd?.location?.city}`);
  record('会员识别（Kangyuan=金品诚企）', kd?.membership?.plan === 'verified_supplier', kd?.membership?.plan ?? '');
  const detailId = cliJson(['suppliers', 'detail', '--company-id', '258180302', '-f', 'json']);
  record('CLI detail --company-id（档案映射）', detailId.status === 0 && detailId.json?.data?.companyId === '258180302', detailId.err?.slice(0, 80) ?? '', 'warn');

  // 6. 纯关键词模式：默认 off（不做回填；此前 bug 会默认 strict 导致超时）
  const kwOnly = cliJson(['search', 'suppliers', '-k', '河北', '--pages', '1', '-f', 'json'], { cwd: os.homedir() });
  record(
    '纯关键词搜索默认 off（无回填）',
    kwOnly.status === 0 && kwOnly.json?.data?.location?.mode === 'off' && kwOnly.json?.data?.location?.enrichedCompanies === 0,
    `mode=${kwOnly.json?.data?.location?.mode} enriched=${kwOnly.json?.data?.location?.enrichedCompanies}`,
  );

  // 7. 关键字模式 / 城市模式
  const citySearch2 = cliJson(['search', 'suppliers', '--province', 'Hebei', '--city', 'Hengshui', '--pages', '1', '--max-enrich', '5', '-f', 'json']);
  record(
    'CLI 城市搜索（无关键词）',
    citySearch2.status === 0 && citySearch2.json?.data?.effectiveKeyword === 'Hengshui',
    `effective=${citySearch2.json?.data?.effectiveKeyword} matched=${citySearch2.json?.data?.location?.matched}`,
  );

  // 7. 工厂目录
  const factories = cliJson(['factories', 'list', '--province', 'Hebei', '--page-size', '20', '-f', 'json']);
  record('CLI factories list', factories.status === 0 && Array.isArray(factories.json?.data?.items), `items=${factories.json?.data?.items?.length}`);

  // 8. 错误语义
  const badArg = cli(['search', 'suppliers']);
  record('错误语义：缺参数 exit=2', badArg.status === 2, `exit=${badArg.status}`);
  const verifySolve = cli(['verify', 'solve']);
  record('错误语义：无验证时 solve 报错', verifySolve.status === 3 && /CAPTCHA_FAILED/.test(verifySolve.err), `exit=${verifySolve.status}`);
  const serve = spawnSync('timeout', ['20', 'ali', 'serve'], { encoding: 'utf8', cwd: ROOT, env: { ...process.env, ALI_LOG_STDOUT: 'false' } });
  record('serve 冲突检测', serve.status === 0 && /已在运行/.test(serve.stdout ?? ''), (serve.stdout ?? '').split('\n')[0]);

  // 9. REST 业务端点
  const restSearch = await http('POST', '/v1/search/suppliers', { body: { keyword: 'solid tire', province: 'Hebei', pages: 1, maxEnrich: 3 } });
  record('REST POST /v1/search/suppliers', restSearch.status === 200 && restSearch.json?.ok === true, `http=${restSearch.status} ${restSearch.ms}ms`);
  const restDetail = await http('GET', '/v1/suppliers/by-store/kangyuanxiangsu');
  record('REST GET /v1/suppliers/by-store/{store}', restDetail.status === 200 && restDetail.json?.data?.joinedYears === 6, `http=${restDetail.status}`);
  const restFactories = await http('GET', '/v1/factories?province=Hebei&pageSize=20');
  record('REST GET /v1/factories', restFactories.status === 200 && restFactories.json?.ok === true, `http=${restFactories.status}`);
  const restBad = await http('GET', '/v1/regions?province=Hebi');
  record('REST 参数错误返回 400', restBad.status === 400, `http=${restBad.status}`);

  // 10. MCP smoke
  const mcp = spawnSync(process.execPath, [path.join(ROOT, 'scripts/mcp-smoke.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env },
  });
  const mcpOut = `${mcp.stdout ?? ''}${mcp.stderr ?? ''}`;
  record('MCP stdio smoke（16 tools + 调用）', mcp.status === 0 && /tools: 16/.test(mcpOut), mcpOut.split('\n').filter((l) => l.startsWith('tools:')).join(''));

  // 11. systemd
  const active = spawnSync('systemctl', ['--user', 'is-active', 'ali-client'], { encoding: 'utf8' });
  record('systemd ali-client active', (active.stdout ?? '').trim() === 'active', (active.stdout ?? '').trim());

  printSummary();
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}

function printSummary() {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const warn = results.filter((r) => r.status === 'WARN').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n=== 结果：${pass} passed, ${warn} warn, ${fail} failed（共 ${results.length}）===`);
  if (fail) {
    console.log('失败项：');
    for (const r of results.filter((x) => x.status === 'FAIL')) console.log(` - ${r.name}${r.detail ? ': ' + r.detail : ''}`);
  }
}

main().catch((e) => {
  console.error('SELF_TEST_FATAL', e);
  process.exit(1);
});
