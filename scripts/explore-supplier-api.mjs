/** 探路：/search/api/supplierTextSearch + supplierAttributes=Province 过滤能力 */
import fs from 'node:fs';
import { launchPersistentContext } from 'cloakbrowser';
const OUT='/tmp/explore8'; fs.mkdirSync(OUT,{recursive:true});
const DIR='/tmp/ali-explore-svc-profile';
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie']) fs.rmSync(`${DIR}/${f}`,{force:true});
const ctx=await launchPersistentContext({userDataDir:DIR,headless:true,timezone:'Asia/Shanghai',locale:'en-US',humanize:true,viewport:{width:1440,height:900}});
const page=ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://www.alibaba.com/',{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(3000);
const base=fs.readFileSync('/tmp/api-url.txt','utf8').trim();
function withParams(url, over={}) {
  const u=new URL(url);
  for (const [k,v] of Object.entries(over)) u.searchParams.set(k, v);
  return u.toString();
}
async function call(name, url) {
  try {
    const r=await page.evaluate(async (u)=>{ const x=await fetch(u,{credentials:'include'}); const t=await x.text(); return {status:x.status,len:t.length,text:t}; }, url);
    fs.writeFileSync(`${OUT}/${name}.json`, r.text);
    let d=null; try{d=JSON.parse(r.text);}catch{}
    const model=d?.model ?? {};
    const offers=model.offers ?? [];
    const ids=[...new Set(offers.map(o=>o.companyId).filter(Boolean))];
    const info={
      status:r.status, len:r.len, ok:!!d?.success,
      modelKeys:Object.keys(model).slice(0,40),
      total: model.totalCount ?? model.total_count ?? model.resultNumber ?? model.result_number ?? model.total ?? null,
      offers:offers.length, ids:ids.length,
      offerKeys: offers[0]?Object.keys(offers[0]).slice(0,50):[],
      sample: offers.slice(0,3).map(o=>({companyId:o.companyId,companyName:o.companyName,action:o.action,province:o.province,city:o.city,country:o.country,location:o.location,companyAddress:o.companyAddress,goldYears:o.goldYears})),
      nextPage: model.nextPage ?? model.page ?? model.pageNo ?? null,
    };
    console.log(`[${name}]`, JSON.stringify(info).slice(0,800));
    return {name,url,info};
  } catch(e){ console.log(`[${name}] ERR`,String(e).slice(0,150)); return {name,url,error:String(e)}; }
}
const out=[];
out.push(await call('orig-p1', withParams(base,{page:'1'})));
out.push(await call('orig-p2', withParams(base,{page:'2'})));
out.push(await call('orig-p3', withParams(base,{page:'3'})));
// 不同 supplierAttributes 变体
out.push(await call('attr-plain', withParams(base,{page:'1',supplierAttributes:'Province: Hebei'})));
out.push(await call('attr-hebei-city', withParams(base,{page:'1',supplierAttributes:'Province: Hebei, City: Hengshui'})));
out.push(await call('attr-province-lower', withParams(base,{page:'1',supplierAttributes:'province: Hebei'})));
out.push(await call('attr-only-province', withParams(base,{page:'1',supplierAttributes:'Province%3A+Hebei'})));
// 空 query 尝试（需要其它参数可能报错）
out.push(await call('empty-query', withParams(base,{page:'1',query:'',productQpKeywords:'',queryRaw:'',productName:'',queryProduct:'',keywords:'',supplierAttributes:'Province: Hebei'})));
out.push(await call('pageSize-100', withParams(base,{page:'1',pageSize:'100'})));
fs.writeFileSync(`${OUT}/summary.json`,JSON.stringify(out,null,2));
await ctx.close();
