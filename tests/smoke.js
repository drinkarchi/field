const { chromium } = require('playwright');const fs=require('fs'),path=require('path');
(async()=>{const b=await chromium.launch();const p=await b.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname!=='archi.test')return r.abort();let q=u.pathname.replace(/^\/field\//,'/');if(q==='/')q='/index.html';const f=path.join('..',q);if(!fs.existsSync(f))return r.fulfill({status:404,body:''});r.fulfill({status:200,body:fs.readFileSync(f),contentType:q.endsWith('.html')?'text/html':'text/javascript'})});
await p.goto('https://archi.test/field/');await p.waitForTimeout(2500);
console.log('login form:',await p.isVisible('#lgUser'),'ver:',await p.evaluate(()=>typeof window.supabase.createClient));
await p.fill('#lgUser','tes');await p.fill('#lgPin','1357');await p.click('#lgForm button');await p.waitForTimeout(3000);
console.log('after submit:',(await p.innerText('main')).slice(0,200));console.log('errs',errs);await b.close()})();
