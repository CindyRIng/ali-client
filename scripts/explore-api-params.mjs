import fs from 'node:fs';
import { launchPersistentContext } from 'cloakbrowser';
const DIR='/tmp/ali-explore-svc-profile'; const OUT='/tmp/explore10'; fs.mkdirSync(OUT,{recursive:true});
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie']) fs.rmSync(`${DIR}/${f}`,{force:true});
const ctx=await launchPersistentContext({userDataDir:DIR,headless:true,timezone:'Asia/Shanghai',locale:'en-US',humanize:true,viewport:{width:1280,height:800}});
const page=ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://www.alibaba.com/',{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(2500);
const base=new URL(fs.readFileSync('/tmp/api-url.txt','utf8').trim());
async function call(name, over, extra={}) {
  const u=new URL(base.toString());
  for (const [k,v] of Object.entries(over)) u.searchParams.set(k,v);
  for (const [k,v] of Object.entries(extra)) u.searchParams.set(k,v);
  u.searchParams.set('startTime',String(Date.now())); u.searchParams.set('requestId','AI_Web_'+Math.random().toString(36).slice(2));
  const r=await page.evaluate(async x=>{const y=await fetch(x,{credentials:'include'});const t=await y.text();return {status:y.status,text:t};},u.toString());
  fs.writeFileSync(`${OUT}/${name}.json`,r.text);
  let d=null; try{d=JSON.parse(r.text);}catch{}
  const m=d?.model??{}; const offers=m.offers??[]; const cities={}; for(const o of offers) cities[o.city]=(cities[o.city]??0)+1;
  console.log(`[${name}] status=${r.status} offers=${offers.length} pages=${m.paginationData?.totalPage} cities=${JSON.stringify(cities).slice(0,220)}`);
  return {name,ids:offers.map(o=>o.companyId),cities,pages:m.paginationData?.totalPage};
}
// 统一 query = wire mesh
const q=(extra={})=>({query:'wire mesh',queryRaw:'wire mesh',productQpKeywords:'wire mesh',queryMachineTranslate:'wire mesh',productName:'wire mesh',queryProduct:'wire mesh',supplierQpKeywords:'wire mesh',keywords:'wire mesh',page:'1',...extra});
const out={};
out.none=await call('none', q({}), {supplierAttributes:''});
out.attrHe=await call('attr-he', q({}), {supplierAttributes:'Province: Hebei'});
out.attrGd=await call('attr-gd', q({}), {supplierAttributes:'Province: Guangdong'});
out.attrNoSpace=await call('attr-he-nospace', q({}), {supplierAttributes:'Province:Hebei'});
out.provinceParam=await call('province-param', q({}), {province:'Hebei',country:'CN'});
out.attrCity=await call('attr-city', q({}), {supplierAttributes:'City: Hengshui'});
// 对比
const ids=(x)=>new Set(x.ids);
console.log('overlap none/he', [...ids(out.none)].filter(i=>ids(out.attrHe).has(i)).length);
console.log('overlap none/gd', [...ids(out.none)].filter(i=>ids(out.attrGd).has(i)).length);
fs.writeFileSync(`${OUT}/summary.json`,JSON.stringify(out,null,2));
await ctx.close();
