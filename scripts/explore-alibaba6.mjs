import fs from 'node:fs';
import { launchPersistentContext } from 'cloakbrowser';
const DIR='/tmp/ali-explore-svc-profile';
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie']) fs.rmSync(`${DIR}/${f}`,{force:true});
const ctx=await launchPersistentContext({userDataDir:DIR,headless:true,timezone:'Asia/Shanghai',locale:'en-US',humanize:true,viewport:{width:1280,height:800}});
const page=ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://www.alibaba.com/',{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(2500);
const gateways=[];
page.on('response', async (r)=>{ const u=r.url(); if(/gatewayService|insights\.alibaba\.com/.test(u)) { let b=''; try{b=(await r.text()).slice(0,500);}catch{} gateways.push({url:u.slice(0,500),status:r.status(),body:b}); }});
const fetchInfo = async (u) => {
  try { const r = await page.evaluate(async (url)=>{ const x=await fetch(url,{credentials:'include'}); const t=await x.text(); return {status:x.status, len:t.length, head:t.slice(0,300), hasProvince:/province/i.test(t), title:(t.match(/<title>([^<]*)<\/title>/)||[])[1]||'', subs:[...new Set([...t.matchAll(/\/\/([a-z0-9][a-z0-9-]*)\.en\.alibaba\.com/g)].map(m=>m[1]))].slice(0,10)}; }, u); return r; } catch(e){ return {error:String(e).slice(0,150)}; }
};
const urls=[
 ['mobile-search','https://m.alibaba.com/trade/search?fsb=y&IndexArea=product_en&keywords=Hebei&country=CN'],
 ['m-search2','https://m.alibaba.com/search?SearchText=Hebei&country=CN'],
 ['robots','https://www.alibaba.com/robots.txt'],
 ['sitemap','https://www.alibaba.com/sitemap.xml'],
 ['factories-index','https://sale.alibaba.com/p/factories/v2/index.html'],
 ['countrysearch-cn-hub','https://www.alibaba.com/countrysearch/CN/china-suppliers.html'],
];
const out={};
for (const [n,u] of urls) { const r=await fetchInfo(u); out[n]=r; console.log(n,r.status,r.title,'len',r.len,'province',r.hasProvince,'subs',r.subs?.length, r.error??''); }
// open factories page normally to capture gateway calls
try { await page.goto('https://sale.alibaba.com/p/factories/v2/index.html',{waitUntil:'domcontentloaded',timeout:60000}); await page.waitForTimeout(5000); await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)); await page.waitForTimeout(3000); } catch(e){}
console.log('gateway calls:',gateways.slice(0,6).map(g=>({url:g.url.slice(0,200),status:g.status,body:g.body.slice(0,120)})));
out.gateways=gateways.slice(0,10);
fs.writeFileSync('/tmp/explore6.json',JSON.stringify(out,null,2));
await ctx.close();
