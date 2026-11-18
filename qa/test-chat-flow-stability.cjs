#!/usr/bin/env node
'use strict';
// FECHOU: regressões estáticas e de estado do chat. Zero rede, zero transações.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const checks=[];
function verify(name,callback){try{callback();checks.push([name,true]);console.log('OK   '+name)}catch(error){checks.push([name,false]);console.error('FALHA '+name+': '+error.message)}}
function script(id){const open='<script id="'+id+'">';const at=html.indexOf(open);assert(at>=0,'script ausente: '+id);const end=html.indexOf('</script>',at);assert(end>at);return html.slice(at+open.length,end);}
verify('Sintaxe de todos os scripts inline',()=>{
 const re=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;let count=0;
 for(const m of html.matchAll(re)){const attrs=m[1];if(/\bsrc\s*=/.test(attrs)||!m[2].trim()||/application\/(ld\+)?json/.test(attrs))continue;new vm.Script(m[2],{filename:'inline-'+(++count)});}
 assert(count>=100,'quantidade inesperada: '+count);
});
verify('Validador de evidências nunca ignora erro',()=>{
 const s=script('fechou-v335-chatux-js');
 assert(!s.includes('function wrapValidateEvidence()'),'fallback de validação restaurado');
 assert(!s.includes('FECHOU_VALIDATE_EVIDENCE.__v335Chatux'),'hook de bypass restaurado');
});
verify('Troca de pedido no mesmo overlay limpa a ação anterior',()=>{
 const s=script('fechou-v335-chatux-js');
 const start=s.indexOf('  function syncChatRoot(ov) {');
 const end=s.indexOf('  function overlay()',start);
 assert(start>=0&&end>start);
 const ctx={};
 vm.runInNewContext("let activeAction=null;let currentChatRoot=null;let currentChatOrderId='';const parked={evidence:null,drawer:null};const orderIdOf=(ov)=>String(ov.dataset.orderId||'');"+s.slice(start,end)+";this.api={sync:syncChatRoot,set:v=>activeAction=v,get:()=>activeAction,id:()=>currentChatOrderId};",ctx);
 const body={clears:0,replaceChildren(){this.clears++}};
 const pane={hidden:false,querySelector:()=>body};
 const ov={dataset:{orderId:'pedido-a',toolsExpanded:'true'},classList:{removed:[],remove(v){this.removed.push(v)}},querySelector(sel){return sel==='#fechou-v335-chat-action'?pane:null}};
 ctx.api.sync(ov);
 ctx.api.set({orderId:'pedido-a',kind:'Contrato'});
 ctx.api.sync(ov);
 assert.equal(ctx.api.get().orderId,'pedido-a');
 ov.dataset.orderId='pedido-b';
 ctx.api.sync(ov);
 assert.equal(ctx.api.get(),null);
 assert.equal(ctx.api.id(),'pedido-b');
 assert.equal(pane.hidden,true);
 assert.equal(body.clears,1);
 assert(ov.classList.removed.includes('is-v335-action'));
});
verify('Correções UI acionadas por eventos, sem varredura fixa por segundo',()=>{
 for(const id of ['fechou-fix-ui-js','fechou-fix-r2-js','fechou-fix-r9-js','fechou-fix-r10-js']){
  const s=script(id);
  assert(!/setInterval\s*\(\s*run\b/.test(s),id+' ainda tem polling');
  assert(s.includes('MutationObserver'),id+' perdeu atualização visual');
  assert(s.includes('visibilitychange'),id+' não atualiza ao voltar para a aba');
 }
});
verify('Referência visual da NFS-e suspensa',()=>assert(!html.includes('necessidade de nota fiscal…')));
verify('Contas de QA não expostas no arquivo público',()=>{
 assert(!html.includes('closeoutsinternacional@gmail.com'));
 assert(!html.includes('soldasrio@gmail.com'));
});
verify('Pagamento direto acordado permite iniciar serviço sem assinatura Clicksign',()=>{
 const found=html.match(/const contractActive = ([\\s\\S]*?);\\s*const paid =/);
 assert(found,'expressão de liberação de serviço não encontrada');
 const contractActive=(agreed,signed)=>vm.runInNewContext('('+found[1]+')',{directAgreed:agreed,window:{fechouBothSigned:()=>signed},o:{contract:null},modeOf:()=>agreed?'direct':'contract_prepaid'});
 assert.equal(contractActive(true,false),true,'pagamento direto acordado bloqueado sem contrato');
 assert.equal(contractActive(false,false),false,'contrato protegido sem assinatura deve ser bloqueado');
 assert.equal(contractActive(false,true),true,'contrato assinado deve liberar checagem de pagamento');
 assert(html.includes('if (contractActive && (modeOf(o) !== "contract_prepaid" || paid))'),'checagem de pagamento protegido removida');
});
const failed=checks.filter(([,ok])=>!ok).length;
console.log(JSON.stringify({scenarios:checks.length,passed:checks.length-failed,failed},null,2));
if(failed)process.exitCode=1;
