const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {stripTypeScriptTypes} = require('node:module');
const source = fs.readFileSync(__dirname+'/../supabase/functions/asaas-webhook-checkout-hotfix-2026-11-17/index.ts','utf8');
const start=source.indexOf('async function updateOrderForCheckout(');
const end=source.indexOf('async function updateSubscriptionForCheckout(',start);
const js=stripTypeScriptTypes(source.slice(start,end));
async function run(event, payment={}, overrides={}) {
 const writes=[],ledger=[];
 const order={id:'order-test',client_id:'client-test',professional_id:'pro-test',total:100,payment_id:'pay_stored',metadata:{},...overrides};
 const ctx={getOrder:async()=>order,obj:v=>v||{},isTemporaryTestOrder:()=>false,createLedgerEntry:async(_,r)=>{ledger.push(r);return {id:'ledger-test'};}};
 vm.createContext(ctx); vm.runInContext(js+';this.runCheckout=updateOrderForCheckout',ctx);
 const admin={from:table=>({update:patch=>({eq:async()=>{writes.push({table,patch});return {error:null}}})})};
 await ctx.runCheckout(admin,{order_id:order.id,amount:100},event,{id:'checkout-test'},payment);
 return {writes,ledger};
}
(async()=>{
 let r=await run('CHECKOUT_PAID');
 assert.equal(r.ledger.length,2); assert.equal(r.ledger[1].amount,98); assert.equal(r.ledger[1].provider_reference,'pay_stored');assert.equal(r.writes[1].patch.platform_fee,2);
 r=await run('CHECKOUT_PAID',{id:'pay_event'});assert.equal(r.ledger[1].provider_reference,'pay_event');assert.equal(r.ledger[1].metadata.payment_id,'pay_event');
 for(const event of ['CHECKOUT_CREATED','CHECKOUT_ACTIVE','CHECKOUT_UNKNOWN']){r=await run(event);assert.equal(r.writes.length,0);assert.equal(r.ledger.length,0);}
 for(const [event,status] of [['CHECKOUT_CANCELED','cancelled'],['CHECKOUT_EXPIRED','expired']]){r=await run(event);assert.equal(r.writes[0].patch.payment_status,status);assert.equal(r.ledger.length,0);}
 r=await run('CHECKOUT_PAID',{}, {professional_id:null});assert.equal(r.ledger.length,1);
 console.log('8/8 cenários aprovados: confirmação, referência, intermediários, cancelamento, expiração, sem profissional. Sem rede ou dinheiro real.');
 const full=stripTypeScriptTypes(source); new vm.Script(full.replace(/^import .*;\s*$/mg,''));console.log('Sintaxe TypeScript integral aprovada.');
})().catch(e=>{console.error(e);process.exitCode=1});
