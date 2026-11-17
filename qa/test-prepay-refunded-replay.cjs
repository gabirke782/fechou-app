const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(__dirname+'/../supabase/functions/asaas-webhook-refunded-replay-hotfix-2026-11-17/index.ts','utf8');
const js=stripTypeScriptTypes(source.slice(source.indexOf('async function v195AsaasPrepayPublish('),source.indexOf('async function applyEvent(')));
const draftId='00000000-0000-0000-0000-000000000001',quoteId='00000000-0000-0000-0000-000000000002';
async function run(patch={},event='PAYMENT_RECEIVED',readError=false){
 const writes=[],rpc=[];
 const draft={id:draftId,client_id:'client',payment_total:6,status:'payment_review',published_order_id:draftId};
 const order={id:draftId,client_id:'client',payment_id:'pay_original',payment_status:'refunded',refund_status:'refunded',metadata:{prepublication_draft_id:draftId},...patch};
 const context={obj:v=>v||{},getOrder:async()=>{if(readError)throw Error('read failed');return order}};
 vm.createContext(context);vm.runInContext(js+';this.run=v195AsaasPrepayPublish',context);
 const admin={from:table=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='fechou_prepublication_drafts'?draft:{amount:6},error:null}),update:p=>{writes.push(p);return q}};return q},rpc:async()=>{rpc.push(true);throw Error('normal publication reached')}};
 let result,error;try{result=await context.run(admin,`fechou-prepay:${draftId}:${quoteId}`,{id:'pay_original',value:6},'event',event)}catch(e){error=e.message}
 return {writes,rpc,result,error};
}
(async()=>{
 for(const event of ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED']){const r=await run({},event);assert.equal(r.result,true);assert.equal(r.writes.length,0);assert.equal(r.rpc.length,0)}
 for(const patch of [{client_id:'other'},{payment_id:'other'},{metadata:{prepublication_draft_id:'other'}}]){const r=await run(patch);assert.match(r.error,/não corresponde/);assert.equal(r.writes.length,0);assert.equal(r.rpc.length,0)}
 const r=await run({},'PAYMENT_RECEIVED',true);assert.equal(r.error,'read failed');assert.equal(r.writes.length,0);assert.equal(r.rpc.length,0);
 const p=await run({refund_status:'partial'});assert.equal(p.rpc.length,1);assert.match(p.error,/normal publication/);
 console.log('7/7: replay estornado sem escrita, duas confirmações, três vínculos inválidos, falha de leitura e estorno parcial preservados.');
})().catch(e=>{console.error(e);process.exitCode=1});
