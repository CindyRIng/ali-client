import { launchPersistentContext } from 'cloakbrowser';
import fs from 'node:fs';
const DIR='/tmp/ali-explore-svc-profile';
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie']) fs.rmSync(`${DIR}/${f}`,{force:true});
const ctx=await launchPersistentContext({userDataDir:DIR,headless:true,timezone:'Asia/Shanghai',locale:'en-US',humanize:true,viewport:{width:1200,height:800}});
const page=ctx.pages()[0] ?? await ctx.newPage();
const slugs=process.argv.slice(2);
for (const s of slugs) {
  try {
    await page.goto(`https://www.alibaba.com/countrysearch/CN/${s}-suppliers.html`,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(1800);
    const info=await page.evaluate(()=>({title:document.title,captcha:/CAPTCHA Verification|slide to verify/i.test(document.body?.innerText??''),subs:[...new Set([...document.documentElement.innerHTML.matchAll(/\/\/([a-z0-9][a-z0-9-]*)\.en\.alibaba\.com/g)].map(m=>m[1]))].length,text:(document.body?.innerText??'').slice(0,80)}));
    console.log(s,'|',info.title.slice(0,60),'| subs',info.subs,'| captcha',info.captcha);
  } catch(e){ console.log(s,'ERR',String(e).slice(0,120)); }
}
await ctx.close();
