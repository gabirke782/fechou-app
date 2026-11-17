const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),ts=require('typescript'),assert=require('node:assert/strict');
const root=process.cwd(),dir=path.join(root,'.r18-ci'),out=path.join(root,'retomada-r18');
fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(out,{recursive:true});
const checkpoint=JSON.parse(fs.readFileSync('auditoria/R18/checkpoint-sources.json','utf8'));
for(const name of ['media-upload-server.ts','team-search.ts','backend-tests.cjs','pending-tests.cjs','acceptance-extra.cjs','auto-refund.ts'])fs.writeFileSync(path.join(dir,name),checkpoint[name]);
const candidate=fs.readFileSync('auditoria/R18/candidato/eworkers-api.ts','utf8'),baseline=fs.readFileSync('supabase/functions/eworkers-api/index.ts','utf8');
const html=fs.readFileSync('auditoria/R18/candidato/index.html','utf8');
fs.writeFileSync(path.join(dir,'eworkers-api.ts'),candidate);fs.writeFileSync(path.join(dir,'eworkers-v332.ts'),baseline);fs.writeFileSync(path.join(out,'index.html'),html);
function fn(source,name){const ast=ts.createSourceFile('api.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);const node=ast.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name?.text===name);assert.ok(node,name);return {text:node.getText(ast),start:node.getStart(ast),end:node.getEnd()};}
const before=fn(baseline,'v195Pending'),after=fn(candidate,'v195Pending');
fs.writeFileSync(path.join(dir,'eworkers-stage1.ts'),baseline.slice(0,before.start)+after.text+baseline.slice(before.end));
const suite=[];
const auto=cp.spawnSync(process.execPath,['scripts/r18-autosave-tests.cjs'],{cwd:root,encoding:'utf8',timeout:15000});process.stdout.write(auto.stdout||'');process.stderr.write(auto.stderr||'');suite.push({name:'r18-autosave-tests.cjs',status:auto.status,error:auto.error?.message});
for(const name of ['backend-tests.cjs','pending-tests.cjs','acceptance-extra.cjs']){
 const result=cp.spawnSync(process.execPath,[path.join(dir,name)],{cwd:root,encoding:'utf8',timeout:120000});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
 suite.push({name,status:result.status,error:result.error?.message});
}
const accepted=path.join(out,'acceptance-results.json');if(fs.existsSync(accepted)){const report=JSON.parse(fs.readFileSync(accepted,'utf8'));suite.push({name:'DOM sem erros de script ao fim do ensaio',status:report.scriptErrors?.length?1:0,errors:report.scriptErrors||[]});}
for(const name of ['backend-results.json','pending-results.json']){const from=path.join(dir,name);if(fs.existsSync(from))fs.copyFileSync(from,path.join(out,name));}
const endpoint='https://ziubcqxmxialhmwevtiy.supabase.co/functions/v1/eworkers-api';
(async()=>{
 const smoke=[];
 for(const [name,init] of [
 ['CORS origem publicada',{method:'OPTIONS',headers:{Origin:'https://startup5.pages.dev','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}}],
 ['Upload sem sessão recusado',{method:'POST',headers:{Origin:'https://startup5.pages.dev','Content-Type':'application/json'},body:JSON.stringify({action:'orders/media-upload-urls',payload:{upload_session:'00000000-0000-4000-8000-000000000000',media:[]}})}]
 ]){
  try{const r=await fetch(endpoint,{...init,signal:AbortSignal.timeout(20000)});const cors=r.headers.get('access-control-allow-origin');const body=await r.text();const passed=name.startsWith('CORS')?([200,204].includes(r.status)&&cors==='https://startup5.pages.dev'):[401,403].includes(r.status);smoke.push({name,status:r.status,cors,passed,response:body.slice(0,300)});}catch(e){smoke.push({name,passed:false,error:e.message});}
 }
 fs.writeFileSync(path.join(out,'ci-summary.json'),JSON.stringify({suite,smoke,limits:['Suites com banco/storage/provedor simulados.','Smoke real somente CORS e recusa de chamada sem sessão. Nenhuma cobrança, pagamento, transferência ou reembolso.']},null,2));
 console.log('CI_SUMMARY '+JSON.stringify({suite,smoke}));
 process.exitCode=suite.some(x=>x.status!==0)||smoke.some(x=>!x.passed)?1:0;
})();
