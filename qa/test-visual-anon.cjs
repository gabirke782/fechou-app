#!/usr/bin/env node
'use strict';
// FECHOU: smoke test real Chromium sem login/credenciais. Captura telas antes/depois
// da branch em viewport mobile e desktop. Nenhuma transação e nenhum segredo.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const sources={
  before:fs.readFileSync(path.join(__dirname,'baseline-main.html'),'utf8'),
  after:fs.readFileSync(path.join(root,'index.html'),'utf8')
};
const out=path.join(__dirname,'screenshots');
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
  const key=req.url?.startsWith('/before')?'before':req.url?.startsWith('/after')?'after':null;
  if(!key){res.writeHead(404);return res.end('Not Found');}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end(sources[key]);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const observations=[];
  try{
    for(const [viewportName,viewport] of [['mobile',{width:390,height:844}],['desktop',{width:1280,height:800}]]){
      for(const version of ['before','after']){
        const page=await browser.newPage({viewport,deviceScaleFactor:1,locale:'pt-BR',colorScheme:'dark'});
        const pageErrors=[];
        page.on('pageerror',e=>pageErrors.push(String(e.message||e).slice(0,300)));
        const started=Date.now();
        let status=0;
        try{
          const response=await page.goto('http://127.0.0.1:'+port+'/'+version+'/index.html',{waitUntil:'domcontentloaded',timeout:45000});
          status=response?.status()||0;
          await page.waitForTimeout(1700);
          const info=await page.evaluate(()=>({
            title:document.title,
            bodyCharacters:document.body?.innerText?.trim()?.length||0,
            domNodes:document.querySelectorAll('*').length,
            appPresent:!!document.getElementById('app'),
            paintEntries:performance.getEntriesByType('paint').map(x=>({name:x.name,milliseconds:Math.round(x.startTime)})),
          }));
          assert(status===200,'servidor local respondeu '+status);
          assert(info.bodyCharacters>0,'nenhum conteudo visivel');
          const file=version+'-'+viewportName+'.png';
          await page.screenshot({path:path.join(out,file),fullPage:true,animations:'disabled',timeout:30000});
          observations.push({version,viewport:viewportName,status,elapsedMs:Date.now()-started,screenshot:file,pageErrors:pageErrors.slice(0,12),...info});
          console.log('OK '+version+' '+viewportName+': '+info.bodyCharacters+' caracteres visiveis, '+info.domNodes+' nos DOM, '+file);
        }finally{await page.close();}
      }
    }
    fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify(observations,null,2));
    console.log(JSON.stringify({screenshots:observations.length,metrics:observations.map(o=>({version:o.version,viewport:o.viewport,status:o.status,domNodes:o.domNodes,elapsedMs:o.elapsedMs,pageErrors:o.pageErrors.length}))},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error('Smoke visual falhou:',e.stack||e);process.exitCode=1;}).finally(()=>server.close());
