/** 探路：supplierTextSearch API + supplierAttributes 过滤枚举能力 */
import fs from 'node:fs';
import { launchPersistentContext } from 'cloakbrowser';
const OUT='/tmp/explore9'; fs.mkdirSync(OUT,{recursive:true});
const DIR='/tmp/ali-explore-svc-profile';
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie']) fs.rmSync(`${DIR}/${f}`,{force:true});
const ctx=await launchPersistentContext({userDataDir:DIR,headless:true,timezone:'Asia/Shanghai',locale:'en-US',humanize:true,viewport:{width:1440,height:900}});
const page=ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://www.alibaba.com/',{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(2500);
const base=new URL(fs.readFileSync('/tmp/api-url.txt','utf8').trim());
function makeUrl({query='hebei', province='Hebei', page=1, keepCategory=false}) {
  const u=new URL(base.toString());
  const q=(query||'').toLowerCase();
  u.searchParams.set('query', query);
  u.searchParams.set('queryRaw', query);
  u.searchParams.set('productQpKeywords', q);
  u.searchParams.set('queryMachineTranslate', q);
  u.searchParams.set('productName', q);
  u.searchParams.set('queryProduct', q);
  u.searchParams.set('supplierQpKeywords', q);
  u.searchParams.set('keywords', query);
  u.searchParams.set('supplierAttributes', province ? `Province: ${province}` : '');
  u.searchParams.set('page', String(page));
  u.searchParams.set('startTime', String(Date.now()));
  u.searchParams.set('requestId', 'AI_Web_'+Math.random().toString(36).slice(2));
  if (!keepCategory) { u.searchParams.set('cateIdLv1List',''); u.searchParams.set('qpListData',''); }
  return u.toString();
}
async function call(name, url) {
  const t0=Date.now();
  try {
    const r=await page.evaluate(async u=>{const x=await fetch(u,{credentials:'include'});const t=await x.text();return {status:x.status,len:t.length,text:t};},url);
    fs.writeFileSync(`${OUT}/${name}.json`,r.text);
    let d=null; try{d=JSON.parse(r.text);}catch{}
    const m=d?.model??{}; const offers=m.offers??[]; const pg=m.paginationData??{};
    const cities={}; for(const o of offers){cities[o.city]=(cities[o.city]??0)+1;}
    console.log(`[${name}] status=${r.status} ok=${!!d?.success} offers=${offers.length} pages=${pg.totalPage} cur=${pg.currentPage} cities=${JSON.stringify(cities).slice(0,200)} ${Date.now()-t0}ms`);
    console.log('   names:',offers.slice(0,3).map(o=>o.companyName?.slice(0,28)));
    return {name,status:r.status,offers:offers.map(o=>({companyId:o.companyId,companyName:o.companyName,action:o.action,city:o.city,countryCode:o.countryCode,goldYears:o.goldYears,isFactory:o.isFactory,verifiedSupplier:o.verifiedSupplier,verifiedSupplierPro:o.verifiedSupplierPro,mainProducts:o.mainProducts})),pages:pg.totalPage,cities};
  } catch(e){ console.log(`[${name}] ERR`,String(e).slice(0,150)); return {name,error:String(e)}; }
}
const out={};
out.hebei1=await call('hebei-p1', makeUrl({query:'hebei',province:'Hebei',page:1}));
out.hebei2=await call('hebei-p2', makeUrl({query:'hebei',province:'Hebei',page:2}));
out.hebei50=await call('hebei-p50', makeUrl({query:'hebei',province:'Hebei',page:50}));
out.gd1=await call('gd-p1', makeUrl({query:'hebei',province:'Guangdong',page:1}));
out.none1=await call('none-p1', makeUrl({query:'hebei',province:'',page:1}));
out.wiremesh=await call('wiremesh-p1', makeUrl({query:'wire mesh',province:'Hebei',page:1}));
out.queryA=await call('a-p1', makeUrl({query:'a',province:'Hebei',page:1}));
out.cityAttr=await call('cityattr-p1', makeUrl({query:'wire mesh',province:'Hebei',page:1}).replace('supplierAttributes=Province%3A+Hebei','supplierAttributes=Province%3A+Hebei%2C+City%3A+Hengshui'));
fs.writeFileSync(`${OUT}/summary.json`,JSON.stringify(out,null,2));
await ctx.close();
