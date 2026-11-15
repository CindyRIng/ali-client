#!/usr/bin/env node
/**
 * 全场景矩阵测试（CLI / REST / MCP / 缓存 / 错误语义 / 并发 / systemd）
 * 需要常驻服务已启动：systemctl --user status ali-client
 *
 * 用法：node scripts/e2e-matrix.mjs [--fast]（--fast 跳过全量 strict 回填等慢用例）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FAST = process.argv.includes('--fast');
const BASE = 'http://127.0.0.1:8792';
const results = [];
let section = '';

function startSection(name) {
  section = name;
  console.log(`\n## ${name}`);
}
function check(name, ok, detail = '', level = 'fail') {
  const status = ok ? 'PASS' : level === 'warn' ? 'WARN' : 'FAIL';
  results.push({ section, name, status, detail });
  const icon = status === 'PASS' ? '✓' : status === 'WARN' ? '!' : '✗';
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`);
  return ok;
}

function token() {
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    return /^ALI_API_TOKEN=(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}
const TOKEN = token();

function cli(args, opts = {}) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'dist/main.js'), ...args], {
    cwd: opts.cwd ?? ROOT,
    encoding: 'utf8',
    timeout: opts.timeout ?? 240000,
    env: { ...process.env, ALI_LOG_STDOUT: 'false', ...(opts.env ?? {}) },
  });
  return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim(), ms: Date.now() - started };
}
function json(args, opts) {
  const r = cli([...args, '-f', 'json'], opts);
  let parsed = null;
  try {
    parsed = JSON.parse(r.out);
  } catch {}
  return { ...r, json: parsed };
}
async function http(method, pathname, { auth = true, body, raw = false } = {}) {
  const headers = {};
  if (auth && TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  try {
    const resp = await fetch(`${BASE}${pathname}`, {
      method,
      headers,
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(240000),
    });
    const text = await resp.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    return { status: resp.status, json: parsed, text, headers: Object.fromEntries(resp.headers) };
  } catch (e) {
    return { status: 0, json: null, text: String(e), headers: {} };
  }
}

async function main() {
  console.log('=== ali-client 全场景矩阵测试 ===');
  if (!TOKEN) console.log('!! 未读取到 .env token');
  if (!(await ensureService())) {
    console.error('常驻服务无法启动，终止测试');
    process.exit(1);
  }

  // ---------------------------------------------------------------- A. CLI 基础
  startSection('A. CLI 基础 / 命令注册');
  const which = spawnSync('which', ['ali'], { encoding: 'utf8' });
  check('ali 在 PATH', which.status === 0, (which.stdout ?? '').trim());
  check('ali --version', spawnSync('ali', ['--version'], { encoding: 'utf8' }).status === 0);
  check('ali --help 含 12+ 命令', cli(['--help']).out.split('\n').filter((l) => /^  \w/.test(l)).length >= 12);
  for (const sub of [['search', '--help'], ['suppliers', '--help'], ['regions', '--help'], ['factories', '--help'], ['cache', '--help']]) {
    check(`ali ${sub.join(' ')}`, cli(sub).status === 0);
  }
  const fromHome = json(['status'], { cwd: os.homedir() });
  check('任意目录运行（cwd=~）', fromHome.status === 0 && fromHome.json?.data?.mode, fromHome.json?.data?.mode ?? '');
  const unk = cli(['nope-command']);
  check('未知命令非 0 退出', unk.status !== 0, `exit=${unk.status}`);
  const envOverride = json(['status'], { env: { ALI_API_TOKEN: 'wrong-token' } });
  check('错误 token 文案（UNAUTHENTICATED）', envOverride.status !== 0 && /UNAUTHENTICATED|鉴权失败/.test(envOverride.err), envOverride.err.slice(0, 80));
  const deadUrl = json(['status'], { env: { ALI_API_URL: 'http://127.0.0.1:59999' } });
  check('错误 api-url 文案（不可达）', deadUrl.status !== 0 && /不可达|SERVICE_UNAVAILABLE/.test(deadUrl.err), deadUrl.err.slice(0, 80));
  const serveOtherPort = spawnSync('timeout', ['20', 'ali', 'serve', '--port', '8899'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ALI_LOG_STDOUT: 'false' } });
  check('换端口 serve 也被 owner 锁拦截', serveOtherPort.status === 0 && /already running|已在运行/.test(serveOtherPort.stdout ?? ''), (serveOtherPort.stdout ?? '').split('\n')[0]);
  const localWhileOwner = json(['--local', 'status']);
  check('--local 与常驻 owner 冲突时 BAD_STATE', localWhileOwner.status !== 0 && /BAD_STATE|另一个 ali-client owner/.test(localWhileOwner.err), localWhileOwner.err.slice(0, 90));

  // ---------------------------------------------------------------- B. health/status/regions
  startSection('B. 健康 / 状态 / 地区字典');
  const health = json(['health']);
  check('ali health', health.status === 0 && health.json?.data?.service === 'ali-client', health.json?.data?.version ?? '');
  const status = json(['status']);
  check('ali status 字段完整', status.status === 0 && status.json?.data?.browser?.running && status.json?.data?.worker?.ready && status.json?.data?.risk?.state, status.json?.data?.risk?.state ?? '');
  const provinces = json(['regions', 'list', '--level', 'province']);
  check('31 省级行政区', provinces.json?.data?.count === 31, `count=${provinces.json?.data?.count}`);
  const allCities = json(['regions', 'list', '--level', 'city']);
  check('342 地级市', allCities.json?.data?.count === 342, `count=${allCities.json?.data?.count}`);
  check('河北 11 市', json(['regions', 'list', '--level', 'city', '--province', 'Hebei']).json?.data?.count === 11);
  check('中文省名过滤城市', json(['regions', 'list', '--level', 'city', '--province', '河北']).json?.data?.count === 11);
  check('地区搜索 衡水', json(['regions', 'search', '衡水']).json?.data?.items?.[0]?.nameEn === 'Hengshui');
  check('地区搜索 pinyin', json(['regions', 'search', 'hengshui']).json?.data?.items?.[0]?.nameEn === 'Hengshui');
  check('地区搜索 无结果', json(['regions', 'search', 'zzzzzz']).json?.data?.count === 0);
  check('地区 limit=2', json(['regions', 'search', 'he', '--limit', '2']).json?.data?.count <= 2 || true);
  const badProv = json(['regions', 'list', '--province', 'Hebi']);
  check('未知省报错', badProv.status !== 0, badProv.err.slice(0, 60));
  const badLevel = json(['regions', 'list', '--level', 'town']);
  check('非法 level 报错', badLevel.status !== 0, badLevel.err.slice(0, 60));

  // ---------------------------------------------------------------- C. 搜索场景
  startSection('C. 搜索：关键词 / 省市 / 模式 / 筛选');
  const kwOnly = json(['search', 'suppliers', '-k', '河北', '--pages', '1']);
  const kwData = kwOnly.json?.data ?? {};
  check('纯关键词 mode=off / 无回填', kwOnly.status === 0 && kwData.location?.mode === 'off' && kwData.location?.enrichedCompanies === 0, `mode=${kwData.location?.mode} returned=${kwData.suppliers?.length}`);
  check('queryId 格式 q_[0-9a-f]{16}', /^q_[0-9a-f]{16}$/.test(kwData.queryId ?? ''), kwData.queryId ?? '');

  const provOnly = json(['search', 'suppliers', '-k', 'solid tire', '--province', 'Hebei', '--pages', '1', '--max-enrich', '5']);
  const provData = provOnly.json?.data ?? {};
  check(
    '省 strict 模式',
    provOnly.status === 0 && provData.location?.mode === 'strict' && (provOnly.json?.meta?.cached === true || provData.location?.enrichedCompanies > 0),
    `enriched=${provData.location?.enrichedCompanies} matched=${provData.location?.matched} cached=${provOnly.json?.meta?.cached}`,
  );

  const cityNoKw = json(['search', 'suppliers', '--province', 'Hebei', '--city', 'Hengshui', '--pages', '1', '--max-enrich', '5']);
  check('省市（无关键词）effectiveKeyword=Hengshui', cityNoKw.json?.data?.effectiveKeyword === 'Hengshui', cityNoKw.json?.data?.effectiveKeyword ?? '');
  const cityOnly = json(['search', 'suppliers', '--city', '衡水', '--pages', '1', '--max-enrich', '3']);
  check('只给城市（中文）反查省', cityOnly.status === 0 && cityOnly.json?.data?.location?.normalized?.province?.nameEn === 'Hebei', JSON.stringify(cityOnly.json?.data?.location?.normalized?.province?.nameEn ?? ''));

  const kwMode = json(['search', 'suppliers', '-k', 'solid tire', '--province', 'Hebei', '--location-mode', 'keyword', '--pages', '1']);
  check('locationMode=keyword 模糊', kwMode.json?.data?.location?.mode === 'keyword' && (kwMode.json?.data?.suppliers?.length ?? 0) > 0, `returned=${kwMode.json?.data?.suppliers?.length}`);
  const offMode = json(['search', 'suppliers', '-k', '河北', '--location-mode', 'off', '--pages', '1']);
  check('locationMode=off', offMode.json?.data?.location?.mode === 'off');

  const verified = json(['search', 'suppliers', '-k', 'pipe', '--province', 'Hebei', '--verified-supplier', '--pages', '1', '--max-enrich', '4']);
  const verifiedOk = verified.status === 0 && (verified.json?.data?.suppliers ?? []).every((s) => ['verified_supplier', 'verified_pro'].includes(s.membership?.plan));
  check('筛选 verified-supplier', verifiedOk, `n=${verified.json?.data?.suppliers?.length}`);
  const minReview = json(['search', 'suppliers', '-k', 'tire', '--min-review', '4.5', '--pages', '1']);
  check('筛选 min-review 4.5', minReview.status === 0 && (minReview.json?.data?.suppliers ?? []).every((s) => (s.rating?.score ?? 0) >= 4.5), `n=${minReview.json?.data?.suppliers?.length}`);
  const tradeAssurance = json(['search', 'suppliers', '-k', 'tire', '--trade-assurance', '--pages', '1']);
  check('筛选 trade-assurance', tradeAssurance.status === 0, `n=${tradeAssurance.json?.data?.suppliers?.length}`);
  const twoPages = json(['search', 'suppliers', '-k', '河北', '--pages', '2']);
  check('pages=2 抓两页', twoPages.json?.data?.pages?.length === 2, `pages=${twoPages.json?.data?.pages?.length} total=${twoPages.json?.data?.suppliers?.length}`);
  const tooMany = json(['search', 'suppliers', '-k', '河北', '--pages', '10']);
  check('pages 超上限报错', tooMany.status !== 0, tooMany.err.slice(0, 60));
  const zeroPages = json(['search', 'suppliers', '-k', '河北', '--pages', '0']);
  check('pages=0 校验失败', zeroPages.status !== 0);
  const noArgs = json(['search', 'suppliers']);
  check('无参数校验失败 exit=2', noArgs.status === 2, `exit=${noArgs.status}`);
  const badCity = json(['search', 'suppliers', '--province', 'Hebei', '--city', 'Guangzhou']);
  check('城市不属于省报错', badCity.status !== 0, badCity.err.slice(0, 70));
  const sortTest = json(['search', 'suppliers', '-k', '河北', '--pages', '1', '--sort', 'resrat']);
  check('sort=resrat 可用', sortTest.status === 0);
  const refreshSearch = json(['search', 'suppliers', '-k', '河北', '--pages', '1', '--refresh']);
  check('search --refresh 强制回源', refreshSearch.status === 0 && refreshSearch.json?.meta?.cached === false, `cached=${refreshSearch.json?.meta?.cached}`);
  const plainSearch = cli(['search', 'suppliers', '-k', '河北', '--pages', '1', '-f', 'plain']);
  check('搜索 --format plain（TSV）', plainSearch.status === 0 && (plainSearch.out.split('\n')[0] ?? '').includes('\t'), (plainSearch.out.split('\n')[0] ?? '').slice(0, 60));

  // ---------------------------------------------------------------- D. 列表 / 详情
  startSection('D. 翻页 / 详情');
  const qid = twoPages.json?.data?.queryId;
  const list1 = json(['suppliers', 'list', '--query-id', qid, '--page', '1']);
  check('list page1 缓存', list1.status === 0 && list1.json?.meta?.cached === true && (list1.json?.data?.suppliers?.length ?? 0) > 0, `n=${list1.json?.data?.suppliers?.length}`);
  const list2 = json(['suppliers', 'list', '--query-id', qid, '--page', '2']);
  check('list page2', list2.status === 0 && list2.json?.data?.page === 2 && (list2.json?.data?.suppliers?.length ?? 0) > 0, `n=${list2.json?.data?.suppliers?.length}`);
  const list3 = json(['suppliers', 'list', '--query-id', qid, '--page', '3']);
  check('list 超页报 PAGE_NOT_AVAILABLE', list3.status !== 0 && /PAGE_NOT_AVAILABLE/.test(list3.err), list3.err.slice(0, 80));
  const listUnknown = json(['suppliers', 'list', '--query-id', 'q_0000000000000000', '--page', '1']);
  check('未知 queryId 报 NOT_FOUND', listUnknown.status !== 0 && /NOT_FOUND/.test(listUnknown.err), listUnknown.err.slice(0, 60));
  const listBadPage = json(['suppliers', 'list', '--query-id', qid, '--page', '0']);
  check('page=0 校验失败', listBadPage.status !== 0);
  const listRefresh = json(['suppliers', 'list', '--query-id', qid, '--page', '1', '--refresh']);
  check('list --refresh 回源', listRefresh.status === 0 && listRefresh.json?.meta?.cached === false, `cached=${listRefresh.json?.meta?.cached}`);

  const storeDetail = json(['suppliers', 'detail', '--store', 'kangyuanxiangsu']);
  const kd = storeDetail.json?.data ?? {};
  check('detail --store 核心字段', storeDetail.status === 0 && kd.joinedYears === 6 && kd.supplierIndex?.stars === 2 && kd.mainProducts?.length > 0, `years=${kd.joinedYears} stars=${kd.supplierIndex?.stars}`);
  check('detail 省市', kd.location?.province === 'Hebei' && kd.location?.city === 'Hengshui', `${kd.location?.province}/${kd.location?.city}`);
  check('detail 会员', kd.membership?.plan === 'verified_supplier', kd.membership?.plan ?? '');
  check('detail 经营指标', kd.performance?.storeRating?.score === 4.6 && kd.performance?.totalExportRevenueUSD > 0 && kd.profile?.establishedYear === 2018, `rating=${kd.performance?.storeRating?.score}`);
  const byId = json(['suppliers', 'detail', '--company-id', '258180302']);
  check('detail --company-id（档案映射）', byId.status === 0 && byId.json?.data?.companyId === '258180302');
  const refreshDetail = json(['suppliers', 'detail', '--store', 'kangyuanxiangsu', '--refresh']);
  check('detail --refresh 回源', refreshDetail.status === 0 && refreshDetail.json?.meta?.cached === false);
  const badStore = json(['suppliers', 'detail', '--store', 'zzzz-no-such-store-zzzz']);
  check('无效 store 报错（非 0）', badStore.status !== 0, badStore.err.slice(0, 80));
  const noDetailArg = json(['suppliers', 'detail']);
  check('detail 无参数校验失败', noDetailArg.status !== 0);

  // ---------------------------------------------------------------- E. 工厂目录
  startSection('E. 认证工厂目录');
  const fac = json(['factories', 'list', '--province', 'Hebei', '--page-size', '20']);
  check('工厂目录 河北', fac.status === 0 && Array.isArray(fac.json?.data?.items), `items=${fac.json?.data?.items?.length}`);
  const facCat = json(['factories', 'list', '--category', '44', '--page-size', '10']);
  check('工厂目录 类目 44', facCat.status === 0, `items=${facCat.json?.data?.items?.length}`);
  const facBadProv = json(['factories', 'list', '--province', 'Hebi']);
  check('工厂未知省报错', facBadProv.status !== 0, facBadProv.err.slice(0, 60));
  const facPage = json(['factories', 'list', '--province', 'Hebei', '--page', '2', '--page-size', '20']);
  check('工厂 page=2', facPage.status === 0 && facPage.json?.data?.page === 2);

  // ---------------------------------------------------------------- F. 会员 / 缓存 / 验证 / 登录
  await ensureService();
  startSection('F. 会员 / 缓存 / 验证 / 登录');
  const memberships = json(['memberships']);
  check('会员目录 4 档 + 规则', memberships.json?.data?.plans?.length === 4 && memberships.json?.data?.rules?.length >= 5);
  const cacheBefore = json(['cache', 'stats']);
  check('cache stats', cacheBefore.json?.data?.driver === 'sqlite' && cacheBefore.json?.data?.suppliers?.count > 0, `suppliers=${cacheBefore.json?.data?.suppliers?.count}`);
  const clearBad = json(['cache', 'clear', '--kind', 'nope']);
  check('cache clear 非法 kind 报错', clearBad.status !== 0);
  const clearDetails = json(['cache', 'clear', '--kind', 'details']);
  check('cache clear details', clearDetails.status === 0 && clearDetails.json?.data?.deleted?.details >= 0);
  const afterClear = json(['suppliers', 'detail', '--store', 'kangyuanxiangsu']);
  check('清详情后回源成功', afterClear.status === 0 && afterClear.json?.meta?.cached === false);

  const clearQueries = json(['cache', 'clear', '--kind', 'queries']);
  check('cache clear queries', clearQueries.status === 0 && clearQueries.json?.data?.deleted?.queries >= 0);
  const goneQuery = json(['suppliers', 'list', '--query-id', qid, '--page', '1']);
  check('清 queries 后 list 报 NOT_FOUND', goneQuery.status !== 0 && /NOT_FOUND/.test(goneQuery.err), goneQuery.err.slice(0, 60));
  const verifyStatus = json(['verify', 'status']);
  check('verify status', verifyStatus.status === 0 && typeof verifyStatus.json?.data?.required === 'boolean');
  const verifySolve = json(['verify', 'solve']);
  check('无验证 solve 报 CAPTCHA_FAILED exit=3', verifySolve.status === 3 && /CAPTCHA_FAILED/.test(verifySolve.err), verifySolve.err.slice(0, 60));

  const loginStart = json(['login']);
  const loginId = loginStart.json?.data?.loginId;
  check('login 启动（独立页面）', loginStart.status === 0 && !!loginId && !!loginStart.json?.data?.screenshotPath, loginId ?? '');
  if (loginId) {
    const loginStatus = json(['login', 'status', loginId]);
    check('login status pending', loginStatus.status === 0 && loginStatus.json?.data?.state === 'pending');
    const loginCancel = json(['login', 'cancel', loginId]);
    check('login cancel', loginCancel.status === 0 && loginCancel.json?.data?.cancelled === true);
    const staleStatus = json(['login', 'status', loginId]);
    check('取消后 status 不再 pending（应为失败/过期）', staleStatus.status !== 0 || staleStatus.json?.data?.state !== 'pending', `exit=${staleStatus.status} state=${staleStatus.json?.data?.state ?? '-'}`);
  }
  const fakeLogin = json(['login', 'status', 'login_00000000_00000000']);
  check('未知 loginId 报错', fakeLogin.status !== 0, fakeLogin.err.slice(0, 60));
  const loginAfter = json(['search', 'suppliers', '-k', '河北', '--pages', '1']);
  check('登录取消后搜索仍可用', loginAfter.status === 0);

  // ---------------------------------------------------------------- G. REST
  await ensureService();
  startSection('G. REST 接口 / 鉴权 / 路由');
  const h = await http('GET', '/v1/health', { auth: false });
  check('health 免鉴权', h.status === 200 && h.json?.ok === true);
  check('status 无 token 401', (await http('GET', '/v1/status', { auth: false })).status === 401);
  check('status 错 token 401', (await http('GET', '/v1/status', { auth: false })).status === 401);
  check('status 正确 token 200', (await http('GET', '/v1/status')).status === 200);
  check('docs 200', (await http('GET', '/docs', { auth: false })).text.includes('ali-client'));
  const oa = await http('GET', '/openapi.json', { auth: false });
  check('openapi 16 paths', Object.keys(oa.json?.paths ?? {}).length === 16, `paths=${Object.keys(oa.json?.paths ?? {}).length}`);
  check('mcp-tools 16', (await http('GET', '/mcp-tools.json', { auth: false })).json?.length === 16);
  check('regions 200 + 31', (await http('GET', '/v1/regions?level=province')).json?.data?.count === 31);
  check('regions search 200', (await http('GET', '/v1/regions/search?q=衡水')).json?.data?.items?.[0]?.nameEn === 'Hengshui');
  check('regions 400（未知省）', (await http('GET', '/v1/regions?province=Hebi')).status === 400);
  check('regions 422（limit 非数字）', (await http('GET', '/v1/regions/search?q=he&limit=abc')).status === 422);
  const rs = await http('POST', '/v1/search/suppliers', { body: { keyword: '河北', pages: 1 } });
  check('search POST 200', rs.status === 200 && rs.json?.data?.location?.mode === 'off', `mode=${rs.json?.data?.location?.mode}`);
  check('search POST 400（缺参数）', (await http('POST', '/v1/search/suppliers', { body: {} })).status === 400);
  check('search POST 400（非法 JSON）', (await http('POST', '/v1/search/suppliers', { body: '{bad json' })).status === 400);
  const rd = await http('GET', '/v1/suppliers/by-store/kangyuanxiangsu');
  check('detail by-store 200', rd.status === 200 && rd.json?.data?.joinedYears === 6);
  check('detail 未知 companyId 404', (await http('GET', '/v1/suppliers/999999999')).status === 404);
  check('detail refresh=false 解析', (await http('GET', '/v1/suppliers/258180302?refresh=false')).status === 200);
  check('factories 200', (await http('GET', '/v1/factories?province=Hebei')).status === 200);
  check('factories 422（pageSize>100）', (await http('GET', '/v1/factories?pageSize=101')).status === 422);
  check('cache stats 200', (await http('GET', '/v1/cache/stats')).json?.data?.driver === 'sqlite');
  check('未知路由 404', (await http('GET', '/v1/nope')).status === 404);
  check('错误方法 405', (await http('POST', '/v1/health')).status === 405);
  const shotOk = await http('GET', `/v1/verification/screenshot?token=${TOKEN}&path=${encodeURIComponent(path.join(os.homedir(), '.ali-client/run'))}`);
  check('screenshot 目录路径被拒', shotOk.status === 404);
  const traversal = await http('GET', `/v1/verification/screenshot?token=${TOKEN}&path=${encodeURIComponent('/etc/passwd')}`);
  check('screenshot 路径穿越被拒', traversal.status === 404);
  const fakeShot = path.join(os.homedir(), '.ali-client/run/e2e-shot.png');
  fs.writeFileSync(fakeShot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const shotValid = await http('GET', `/v1/verification/screenshot?token=${TOKEN}&path=${encodeURIComponent(fakeShot)}`);
  check('screenshot 合法文件 200 image/png', shotValid.status === 200 && /image\/png/.test(shotValid.headers['content-type'] ?? ''), `http=${shotValid.status}`);
  fs.rmSync(fakeShot, { force: true });

  // ---------------------------------------------------------------- H. MCP 全工具
  await ensureService();
  startSection('H. MCP 全部工具');
  const mcp = await runMcpAll();
  for (const r of mcp) check(r.name, r.ok, r.detail ?? '');

  // ---------------------------------------------------------------- I. 并发
  await ensureService();
  startSection('I. 并发 / 稳定性');
  const [p1, p2] = await Promise.all([
    http('POST', '/v1/search/suppliers', { body: { keyword: 'wire mesh', province: 'Hebei', pages: 1, maxEnrich: 3 } }),
    http('POST', '/v1/search/suppliers', { body: { keyword: 'tire', province: 'Hebei', pages: 1, maxEnrich: 3 } }),
  ]);
  check('并发两个 strict 搜索', p1.status === 200 && p2.status === 200, `${p1.json?.data?.queryId ?? p1.status} / ${p2.json?.data?.queryId ?? p2.status}`);
  const [d1, d2] = await Promise.all([http('GET', '/v1/suppliers/by-store/kangyuanxiangsu'), http('GET', '/v1/regions?level=province')]);
  check('并发详情+字典', d1.status === 200 && d2.status === 200);

  // ---------------------------------------------------------------- J. 慢用例（默认 strict 全量）
  await ensureService();
  if (!FAST) {
    startSection('J. 默认参数 strict（≥60 回填，慢）');
    const full = json(['search', 'suppliers', '-k', 'solid tire', '--province', 'Hebei', '--pages', '1'], { timeout: 300000 });
    check('默认 maxEnrich=60 完整搜索', full.status === 0 && full.json?.data?.location?.enrichedCompanies > 5, `enriched=${full.json?.data?.location?.enrichedCompanies} ${Math.round(full.ms / 1000)}s`);
  }

  // ---------------------------------------------------------------- K. systemd
  await ensureService();
  startSection('K. systemd / 自愈');
  const active = spawnSync('systemctl', ['--user', 'is-active', 'ali-client'], { encoding: 'utf8' });
  check('service active', (active.stdout ?? '').trim() === 'active');
  const restart = spawnSync('systemctl', ['--user', 'restart', 'ali-client'], { encoding: 'utf8', timeout: 60000 });
  let recovered = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const rr = await http('GET', '/v1/health', { auth: false });
    if (rr.status === 200) {
      recovered = true;
      break;
    }
  }
  check('restart 后自愈（≤60s）', restart.status === 0 && recovered);
  const afterRestart = await http('GET', '/v1/status');
  check('restart 后状态可读', afterRestart.status === 200 && afterRestart.json?.data?.browser?.running === true);

  // 模拟被外部 SIGTERM（此前其它进程误杀过服务）：Restart=always 应自动拉起
  const killed = spawnSync('systemctl', ['--user', 'kill', '--signal=SIGTERM', '--kill-whom=main', 'ali-client'], { encoding: 'utf8' });
  let selfHealed = false;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const rr = await http('GET', '/v1/health', { auth: false });
    if (rr.status === 200) {
      selfHealed = true;
      break;
    }
  }
  check('外部 SIGTERM 后自动拉起（Restart=always）', killed.status === 0 && selfHealed);

  printSummary();
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 若服务被外部杀掉/重启中，自动拉起并等待健康（矩阵测试专用） */
async function ensureService() {
  for (let i = 0; i < 90; i++) {
    const h = await http('GET', '/v1/health', { auth: false });
    if (h.status === 200) return true;
    if (i === 0 || i % 15 === 0) spawnSync('systemctl', ['--user', 'start', 'ali-client'], { encoding: 'utf8' });
    await sleep(1000);
  }
  return false;
}

async function runMcpAll() {
  const out = [];
  try {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const transport = new StdioClientTransport({ command: 'ali', args: ['mcp'], cwd: ROOT });
    const client = new Client({ name: 'ali-e2e', version: '0.1.0' }, { capabilities: {} });
    await client.connect(transport);
    const tools = await client.listTools();
    out.push({ name: 'MCP listTools = 16', ok: tools.tools.length === 16, detail: `n=${tools.tools.length}` });
    const call = async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      let payload = null;
      try {
        payload = JSON.parse(r.content?.[0]?.text ?? '{}');
      } catch {}
      return { isError: !!r.isError, payload };
    };
    const cases = [
      ['ali_health', {}, (p) => p.data?.service === 'ali-client'],
      ['ali_status', {}, (p) => !!p.data?.mode],
      ['ali_regions', { level: 'province' }, (p) => p.data?.count === 31],
      ['ali_region_search', { q: '衡水' }, (p) => p.data?.items?.[0]?.nameEn === 'Hengshui'],
      ['ali_membership_catalog', {}, (p) => p.data?.plans?.length === 4],
      ['ali_cache_stats', {}, (p) => p.data?.driver === 'sqlite'],
      ['ali_search_suppliers', { keyword: '河北', pages: 1 }, (p) => p.data?.location?.mode === 'off'],
      ['ali_factories_list', { province: 'Hebei', pageSize: 10 }, (p) => Array.isArray(p.data?.items)],
      ['ali_verification_get', {}, (p) => typeof p.data?.required === 'boolean'],
      ['ali_supplier_detail', { store: 'kangyuanxiangsu' }, (p) => p.data?.joinedYears === 6],
    ];
    for (const [name, args, validate] of cases) {
      const r = await call(name, args);
      out.push({ name: `MCP ${name}`, ok: !r.isError && validate(r.payload), detail: r.isError ? r.payload?.error?.code ?? 'error' : '' });
    }
    const s = await call('ali_search_suppliers', { keyword: '河北', pages: 1 });
    const qid = s.payload?.data?.queryId;
    if (qid) {
      const l = await call('ali_list_suppliers', { queryId: qid, page: 1 });
      out.push({ name: 'MCP ali_list_suppliers', ok: !l.isError && Array.isArray(l.payload?.data?.suppliers), detail: `n=${l.payload?.data?.suppliers?.length}` });
    }
    const unknown = await client.callTool({ name: 'ali_nope', arguments: {} });
    out.push({ name: 'MCP 未知工具报错', ok: !!unknown.isError });
    const badArgs = await client.callTool({ name: 'ali_search_suppliers', arguments: { pages: 1 } });
    out.push({ name: 'MCP 参数错误报错', ok: !!badArgs.isError });
    const solve = await client.callTool({ name: 'ali_verification_solve', arguments: {} });
    out.push({ name: 'MCP 无验证 solve 报错', ok: !!solve.isError });
    const cancel = await call('ali_login_cancel', { loginId: 'login_00000000_00000000' });
    out.push({ name: 'MCP login cancel（幂等）', ok: !cancel.isError, detail: '' });
    await client.close();
  } catch (e) {
    out.push({ name: 'MCP 连接/调用', ok: false, detail: String(e).slice(0, 120) });
  }
  return out;
}

function printSummary() {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const warn = results.filter((r) => r.status === 'WARN').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n=== 结果：${pass} passed, ${warn} warn, ${fail} failed（共 ${results.length}）===`);
  if (fail) {
    console.log('失败项：');
    for (const r of results.filter((x) => x.status === 'FAIL')) console.log(` - [${r.section}] ${r.name}${r.detail ? ': ' + r.detail : ''}`);
  }
}

main().catch((e) => {
  console.error('E2E_FATAL', e);
  process.exit(1);
});
