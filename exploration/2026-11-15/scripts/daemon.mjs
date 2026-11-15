// ali-client recon daemon v2
// single browser session, driven by file queue; supports multiple instances via env:
//   ALI_PROFILE / ALI_OUT / ALI_CMD / ALI_RES / ALI_STATUS / ALI_LOG / ALI_EVENTS / HEADLESS
// actions: goto | loop | eval | evalSave | htmlmodules | screenshot | click | hover | type | press | cookies | ping | close
import { launchPersistentContext } from 'cloakbrowser';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const HOME = process.env.HOME;
const BASE = path.join(HOME, 'ali-client/exploration/2026-11-15');
const OUT = process.env.ALI_OUT || path.join(BASE, 'artifacts');
const PROFILE = process.env.ALI_PROFILE || path.join(HOME, '.ali-recon-profile');
const CMD = process.env.ALI_CMD || '/tmp/ali-cmd.json';
const RES = process.env.ALI_RES || '/tmp/ali-res.json';
const STATUS = process.env.ALI_STATUS || '/tmp/ali-daemon.json';
const LOG = path.join(OUT, process.env.ALI_LOG || 'daemon.log');
const EVENTS = path.join(OUT, process.env.ALI_EVENTS || 'captcha-events.jsonl');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => {
  const line = new Date().toISOString() + ' ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch {}
};
const writeStatus = (obj) => {
  try { fs.writeFileSync(STATUS, JSON.stringify({ ...obj, pid: process.pid, at: new Date().toISOString() })); } catch {}
};
const event = (obj) => { try { fs.appendFileSync(EVENTS, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n'); } catch {} };

async function pageInfo(page) {
  return page.evaluate(() => {
    const html = document.documentElement ? document.documentElement.outerHTML : '';
    const txt = document.body ? document.body.innerText : '';
    return {
      url: location.href,
      title: document.title,
      textHead: txt.slice(0, 900),
      htmlLen: html.length,
      captcha: /slide to verify|拖动滑块|请拖动|CAPTCHA Verification|verify you are human/i.test(html),
      captchaKind: /slide to verify|拖动滑块|请拖动|CAPTCHA Verification/i.test(html) ? 'slider'
        : (/scan|二维码|QR code/i.test(html) && /verify/i.test(html) ? 'qr' : 'unknown'),
    };
  }).catch(() => ({ url: page.url(), title: '', textHead: '', htmlLen: 0, captcha: false, captchaKind: 'unknown' }));
}

async function cookieSnapshot(ctx, domain = 'https://www.alibaba.com') {
  try {
    const cs = await ctx.cookies(domain);
    const pick = {};
    for (const c of cs) {
      if (/x5sec|_m_h5_tk|cookie2|xman_t|xman_us_f|isg|tfstk|sc_g_cfg_f/i.test(c.name)) {
        pick[c.name] = { expires: c.expires, session: c.expires === -1, domain: c.domain };
      }
    }
    return pick;
  } catch (e) { return { error: String(e).slice(0, 120) }; }
}

// ---- human-like slider drag ----
async function dragSlider(page) {
  const geo = await page.evaluate(() => {
    const handle = document.querySelector('#nc_1_n1z') ||
      document.querySelector('.nc_iconfont.btn_slide') ||
      document.querySelector('[id*="_n1z"]');
    const track = document.querySelector('#nc_1_wrapper') ||
      document.querySelector('.nc_wrapper') ||
      (handle && handle.parentElement && handle.parentElement.parentElement);
    if (!handle || !track) return null;
    const h = handle.getBoundingClientRect();
    const t = track.getBoundingClientRect();
    return { hx: h.x + h.width / 2, hy: h.y + h.height / 2, hw: h.width, tx: t.x, tw: t.width };
  });
  if (!geo) return { solved: false, detail: 'no-slider' };
  const startX = geo.hx, startY = geo.hy;
  const endX = Math.min(geo.tx + geo.tw - geo.hw / 2 + 3, geo.tx + geo.tw - 4);
  await page.mouse.move(startX - 4, startY + 1, { steps: 6 });
  await page.waitForTimeout(300 + Math.random() * 200);
  await page.mouse.move(startX, startY, { steps: 3 });
  await page.waitForTimeout(200 + Math.random() * 150);
  await page.mouse.down();
  await page.waitForTimeout(380 + Math.random() * 200);
  await page.mouse.move(startX + 4, startY + 1, { steps: 2 });
  await page.waitForTimeout(150);
  const steps = 54 + Math.floor(Math.random() * 8);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t < 0.35 ? 0.5 * (t / 0.35) * (t / 0.35) * 0.18 : 0.18 + 0.82 * (1 - Math.pow(2, -6 * ((t - 0.35) / 0.65)));
    const x = startX + (endX - startX) * ease + (Math.random() * 2 - 1) * 1.6;
    const y = startY + (Math.random() * 2 - 1) * 1.7;
    await page.mouse.move(x, y);
    await page.waitForTimeout(13 + Math.random() * 20);
  }
  await page.mouse.move(endX, startY + 1, { steps: 5 });
  await page.waitForTimeout(280 + Math.random() * 120);
  await page.mouse.move(endX - 1.5, startY, { steps: 2 });
  await page.waitForTimeout(160);
  await page.mouse.up();
  await page.waitForTimeout(2600);
  const info = await pageInfo(page);
  return { solved: !info.captcha, detail: info.captcha ? 'still-captcha' : 'ok', kind: info.captchaKind };
}

// auto solve with up to N attempts; reload between attempts to re-arm slider
async function solveCaptcha(page, log) {
  const attempts = [];
  for (let i = 0; i < 3; i++) {
    const info = await pageInfo(page);
    if (!info.captcha) return { solved: true, attempts };
    const r = await dragSlider(page).catch((e) => ({ solved: false, detail: String(e).slice(0, 120) }));
    attempts.push({ n: i + 1, ...r });
    if (r.solved) return { solved: true, attempts };
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(3500);
    } catch {}
  }
  const info = await pageInfo(page);
  return { solved: !info.captcha, attempts };
}

async function capturePage(ctx, page, name, opts = {}) {
  const info = await pageInfo(page);
  const res = { url: info.url, title: info.title, textHead: info.textHead, htmlLen: info.htmlLen, captcha: info.captcha, captchaKind: info.captchaKind };
  if (info.captcha && opts.autoSolve !== false) {
    const s = await solveCaptcha(page, log);
    res.autoSolve = s;
    const after = await pageInfo(page);
    Object.assign(res, { url: after.url, title: after.title, textHead: after.textHead, htmlLen: after.htmlLen, captcha: after.captcha });
    event({ kind: 'captcha', name, url: after.url, solved: s.solved, attempts: s.attempts, cookies: await cookieSnapshot(ctx) });
    log('captcha event', JSON.stringify({ solved: s.solved, attempts: s.attempts }));
  }
  if (!res.captcha) {
    const html = await page.content();
    await fsp.writeFile(path.join(OUT, name + '.html'), html);
    const pd = await page.evaluate(() => {
      try { return window._PAGE_DATA_ ?? window.__page_data ?? null; } catch { return null; }
    }).catch(() => null);
    if (pd) {
      await fsp.writeFile(path.join(OUT, name + '.page_data.json'), JSON.stringify(pd));
      res.pageDataBytes = JSON.stringify(pd).length;
      res.pageDataKeys = Object.keys(pd);
    }
    if (opts.screenshot !== false) {
      await page.screenshot({ path: path.join(OUT, name + '.png') });
      res.screenshot = name + '.png';
    }
    if (opts.modules) {
      const mods = await page.evaluate(() => {
        const out = {};
        for (const el of document.querySelectorAll('[module-name][module-data]')) {
          const mn = el.getAttribute('module-name');
          const md = el.getAttribute('module-data');
          if (!md) continue;
          try { out[mn] = JSON.parse(decodeURIComponent(md)); } catch { try { out[mn] = JSON.parse(md); } catch {} }
        }
        return out;
      }).catch(() => null);
      if (mods) {
        await fsp.writeFile(path.join(OUT, name + '.modules.json'), JSON.stringify(mods));
        res.modules = Object.keys(mods);
        res.modulesBytes = JSON.stringify(mods).length;
      }
    }
  }
  res.cookies = await cookieSnapshot(ctx);
  return res;
}

async function main() {
  await fsp.mkdir(OUT, { recursive: true });
  for (const f of [CMD, RES, STATUS]) { try { fs.unlinkSync(f); } catch {} }
  writeStatus({ state: 'launching', profile: PROFILE });
  log('launching', PROFILE, 'out=', OUT, 'headless=', !!process.env.HEADLESS);
  const ctx = await launchPersistentContext({
    userDataDir: PROFILE,
    headless: !!process.env.HEADLESS,
    humanize: false,
    timezone: 'Asia/Shanghai',
    locale: process.env.LOCALE || 'en-US',
    viewport: { width: 1920, height: 1080 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(45000);
  let xhrBuf = [], reqLog = [];
  page.on('response', (resp) => {
    const req = resp.request();
    const u = resp.url();
    if (!/alibaba\.com/.test(u)) return;
    const rt = req.resourceType();
    const ct = (resp.headers()['content-type'] || '').toLowerCase();
    if (!(rt === 'xhr' || rt === 'fetch' || ct.includes('json'))) return;
    const rec = { method: req.method(), url: u, status: resp.status(), ct, ts: Date.now() };
    xhrBuf.push(rec);
    resp.text().then((t) => {
      rec.bytes = t.length;
      if (t.length < 300000) rec.body = t;
    }).catch((e) => { rec.err = String(e).slice(0, 120); });
  });
  page.on('request', (req) => {
    const u = req.url();
    if (!/alisite\/render|gatewayService|trade\/search/i.test(u)) return;
    const rec = { method: req.method(), url: u, ts: Date.now() };
    try { rec.postData = req.postData(); } catch {}
    reqLog.push(rec);
  });
  log('context launched');
  writeStatus({ state: 'ready', profile: PROFILE, url: page.url() });
  let last = 0;
  while (true) {
    await sleep(400);
    let cmd = null;
    try { cmd = JSON.parse(fs.readFileSync(CMD, 'utf8')); } catch { continue; }
    if (!cmd || !cmd.id || cmd.id <= last) continue;
    last = cmd.id;
    xhrBuf = []; reqLog = [];
    const res = { id: cmd.id, ok: true, action: cmd.action };
    const t0 = Date.now();
    try {
      if (cmd.action === 'goto') {
        const name = cmd.name || 'nav' + cmd.id;
        const resp = await page.goto(cmd.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        res.status = resp?.status();
        await sleep(cmd.waitMs ?? 6000);
        Object.assign(res, await capturePage(ctx, page, name, cmd));
      } else if (cmd.action === 'loop') {
        const out = [];
        const gap = cmd.gapMs ?? 12000;
        const prefix = cmd.namePrefix || 'loop' + cmd.id;
        for (let i = 0; i < cmd.urls.length; i++) {
          if (i > 0) await sleep(gap + Math.random() * (cmd.jitterMs ?? 3000));
          const name = `${prefix}_${i + 1}`;
          let r;
          try {
            const resp = await page.goto(cmd.urls[i], { waitUntil: 'domcontentloaded', timeout: 90000 });
            await sleep(cmd.waitMs ?? 6000);
            r = { status: resp?.status(), ...(await capturePage(ctx, page, name, cmd)) };
          } catch (e) {
            r = { error: String(e).slice(0, 200) };
          }
          out.push({ i: i + 1, url: cmd.urls[i], ...r });
          log('loop', i + 1, '/', cmd.urls.length, 'captcha=', r.captcha, 'pd=', r.pageDataBytes);
          if (r.captcha) { res.ok = false; res.error = 'CAPTCHA_NOT_SOLVED'; break; }
        }
        res.pages = out;
      } else if (cmd.action === 'eval') {
        res.value = await page.evaluate(cmd.expr);
        res.url = page.url();
        res.title = await page.title();
      } else if (cmd.action === 'evalSave') {
        const value = await page.evaluate(cmd.expr);
        const name = cmd.name || 'eval' + cmd.id;
        await fsp.writeFile(path.join(OUT, name + '.json'), JSON.stringify(value));
        res.saved = name + '.json';
        res.bytes = JSON.stringify(value).length;
        res.preview = JSON.stringify(value).slice(0, 300);
      } else if (cmd.action === 'htmlmodules') {
        const name = cmd.name || 'modules' + cmd.id;
        const mods = await page.evaluate(() => {
          const out = {};
          for (const el of document.querySelectorAll('[module-name][module-data]')) {
            const mn = el.getAttribute('module-name');
            const md = el.getAttribute('module-data');
            if (!md) continue;
            try { out[mn] = JSON.parse(decodeURIComponent(md)); } catch { try { out[mn] = JSON.parse(md); } catch {} }
          }
          return out;
        });
        await fsp.writeFile(path.join(OUT, name + '.json'), JSON.stringify(mods));
        res.saved = name + '.json';
        res.modules = Object.keys(mods);
        res.bytes = JSON.stringify(mods).length;
      } else if (cmd.action === 'screenshot') {
        const name = cmd.name || 'shot' + cmd.id;
        await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: !!cmd.fullPage });
        res.saved = name + '.png';
      } else if (cmd.action === 'click') {
        const el = cmd.selector ? page.locator(cmd.selector).first() : page.getByText(cmd.text, { exact: !!cmd.exact }).first();
        await el.click({ timeout: 30000 });
        await sleep(cmd.waitMs ?? 2500);
        res.url = page.url();
        res.title = await page.title();
      } else if (cmd.action === 'hover') {
        const el = cmd.selector ? page.locator(cmd.selector).first() : page.getByText(cmd.text, { exact: !!cmd.exact }).first();
        await el.hover({ timeout: 30000 });
        await sleep(cmd.waitMs ?? 2000);
      } else if (cmd.action === 'type') {
        const el = cmd.selector ? page.locator(cmd.selector).first() : page.getByText(cmd.text, { exact: !!cmd.exact }).first();
        await el.click({ timeout: 30000 });
        await page.keyboard.type(cmd.input || '', { delay: cmd.delay ?? 80 });
        await sleep(cmd.waitMs ?? 1500);
      } else if (cmd.action === 'press') {
        await page.keyboard.press(cmd.key || 'Enter');
        await sleep(cmd.waitMs ?? 2500);
        res.url = page.url();
        res.title = await page.title();
      } else if (cmd.action === 'cookies') {
        const cs = await ctx.cookies(cmd.domain || 'https://www.alibaba.com');
        const filter = cmd.filter ? new RegExp(cmd.filter, 'i') : null;
        res.cookies = cs.filter((c) => !filter || filter.test(c.name)).map((c) => ({ name: c.name, domain: c.domain, expires: c.expires, session: c.expires === -1 }));
        res.count = cs.length;
      } else if (cmd.action === 'ping') {
        res.pong = Date.now();
      } else if (cmd.action === 'close') {
        res.closing = true;
      } else {
        res.ok = false;
        res.error = 'unknown action';
      }
    } catch (e) {
      res.ok = false;
      res.error = String(e?.stack || e).slice(0, 2000);
      try { res.url = page.url(); } catch {}
    }
    res.ms = Date.now() - t0;
    try { fs.writeFileSync(RES, JSON.stringify(res)); } catch {}
    writeStatus({ state: 'ready', profile: PROFILE, url: page.url(), lastId: last });
    if (cmd.action === 'close') {
      await ctx.close();
      log('closed');
      process.exit(0);
    }
  }
}
main().catch((e) => {
  log('FATAL', String(e?.stack || e));
  writeStatus({ state: 'failed', error: String(e).slice(0, 800) });
  process.exit(1);
});
