import fs from 'node:fs';
import { launchPersistentContext } from 'cloakbrowser';
const DIR='/tmp/ali-explore-svc-profile'; const OUT='/tmp/explore12'; fs.mkdirSync(OUT,{recursive:true});
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie']) fs.rmSync(`${DIR}/${f}`,{force:true});
const ctx=await launchPersistentContext({userDataDir:DIR,headless:true,timezone:'Asia/Shanghai',locale:'en-US',humanize:true,viewport:{width:1280,height:800}});
const page=ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://www.alibaba.com/',{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(2500);
const base=new URL(fs.readFileSync('/tmp/api-url.txt','utf8').trim());
async function call(name, query, pageNo, opts={}) {
  const u=new URL(base.toString()); const q=(query||'').toLowerCase();
  for (const [k,v] of Object.entries({query, queryRaw:query, productQpKeywords:q, queryMachineTranslate:q, productName:q, queryProduct:q, supplierQpKeywords:q, keywords:query})) u.searchParams.set(k,v);
  u.searchParams.set('page',String(pageNo));
  u.searchParams.set('supplierAttributes','Province: Hebei');
  if (opts.city) u.searchParams.set('city',opts.city);
  u.searchParams.set('startTime',String(Date.now())); u.searchParams.set('requestId','AI_Web_'+Math.random().toString(36).slice(2));
  const r=await page.evaluate(async x=>{const y=await fetch(x,{credentials:'include'});const t=await y.text();return {status:y.status,text:t};},u.toString());
  fs.writeFileSync(`${OUT}/${name}.json`,r.text);
  let d=null;try{d=JSON.parse(r.text);}catch{}
  const m=d?.model??{}; const offers=m.offers??[]; const cities={}; for(const o of offers)cities[o.city]=(cities[o.city]??0)+1;
  console.log(`[${name}] q=${query} p=${pageNo} status=${r.status} offers=${offers.length} pages=${m.paginationData?.totalPage} cities=${JSON.stringify(cities).slice(0,200)}`);
  return {name,offers:offers.map(o=>({companyId:o.companyId,companyName:o.companyName,action:o.action,city:o.city})),pages:m.paginationData?.totalPage};
}
const out={};
for (const p of [1,2,10,20,30,40,50]) out['a'+p]=await call('a-p'+p,'a',p);
out.manufacturer1=await call('manufacturer-p1','manufacturer',1);
out.manufacturer2=await call('manufacturer-p2','manufacturer',2);
out.hebei1=await call('hebei-p1','hebei',1);
out.cityTest=await call('city-test','wire mesh',1,{city:'Hengshui'});
fs.writeFileSync(`${OUT}/summary.json`,JSON.stringify(out,null,2));
await ctx.close();
