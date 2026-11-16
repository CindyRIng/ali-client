/** 探路：新版 /search/page SPA 的搜索 API（看是否有 province/location 过滤参数） */
import fs from 'node:fs';
import { launchPersistentContext } from 'cloakbrowser';
const DIR='/tmp/ali-explore-svc-profile'; const OUT='/tmp/explore7'; fs.mkdirSync(OUT,{recursive:true});
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie']) fs.rmSync(`${DIR}/${f}`,{force:true});
const ctx=await launchPersistentContext({userDataDir:DIR,headless:true,timezone:'Asia/Shanghai',locale:'en-US',humanize:true,viewport:{width:1440,height:900}});
const page=ctx.pages()[0] ?? await ctx.newPage();
const reqs=[]; const resps=[];
page.on('request', (r)=>{ const u=r.url(); if(/alibaba\.com/.test(u) && /(search|supplier|company|filter|json)/i.test(u) && !/\.(js|css|png|jpg|webp|gif|woff)/i.test(u)) reqs.push({method:r.method(),url:u.slice(0,600),post:(r.postData()||'').slice(0,600)}); });
page.on('response', async (r)=>{ const u=r.url(); const ct=(r.headers()['content-type']||''); if(/json/.test(ct) && /alibaba\.com/.test(u) && resps.length<40) { let body=''; try{ body=(await r.text()).slice(0,6000);}catch{} resps.push({url:u.slice(0,600),status:r.status(),body}); } });
const url='https://www.alibaba.com/search/page?SearchScene=suppliers&SearchText=Hebei&fsb=y&IndexArea=product_en&keywords=Hebei&tab=supplier';
await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(7000);
await page.evaluate(()=>window.scrollTo(0,1500)); await page.waitForTimeout(3000);
await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)); await page.waitForTimeout(4000);
const title=await page.title();
const text=(await page.evaluate(()=>document.body?.innerText??'')).slice(0,500);
console.log('title:',title.slice(0,80),'| len:',(await page.content()).length);
console.log('text head:',text.slice(0,200).replace(/\n/g,' | '));
console.log('requests',reqs.length,'responses',resps.length);
for (const r of reqs.slice(0,30)) console.log('REQ',r.method,r.url.slice(0,220), r.post? 'POST '+r.post.slice(0,120):'');
fs.writeFileSync(`${OUT}/requests.json`,JSON.stringify(reqs,null,2));
fs.writeFileSync(`${OUT}/responses.json`,JSON.stringify(resps,null,2));
// find search-ish JSON bodies
for (const r of resps) { const low=r.body.toLowerCase(); if(/supplier|company|offer|result|location|province/.test(low)) { console.log('RESP',r.url.slice(0,200),'|',r.body.slice(0,200)); } }
await ctx.close();
