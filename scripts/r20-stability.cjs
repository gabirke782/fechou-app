const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const out=path.resolve('retomada-r18/capturas');fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync('auditoria/R18/candidato/index.html');
const photo='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#1d2c40"/><path d="M170 230h300M220 200h200M270 170h100" stroke="#e8ad48" stroke-width="16"/><text x="320" y="100" fill="#e8edf3" text-anchor="middle" font-family="sans-serif" font-size="28">Registro de teste</text></svg>';
const server=http.createServer((req,res)=>{if(req.url==='/fixture-photo.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end(photo);return}res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'});res.end(html)});
const results=[],errors=[];let browser;
(async()=>{
await new Promise(r=>server.listen(8765,'127.0.0.1',r));
browser=await chromium.launch({headless:true,executablePath:process.env.R18_CHROMIUM_PATH||undefined});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,locale:'en-US'});
page.setDefaultTimeout(7000);
page.on('pageerror',e=>errors.push(String(e)));
await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:8765/')?route.continue():route.fulfill({status:200,contentType:route.request().resourceType()==='script'?'application/javascript':'text/plain',body:''}));
await page.addInitScript(()=>{
window.__r18Db={};window.__r18Requests=[];window.alert=()=>{};
function from(table){let single=false,filters=[];const q={};for(const k of ['select','eq','in','is','order','limit','neq','update','insert','upsert','delete','maybeSingle','single','not','lt'])q[k]=(...args)=>{if(k==='eq')filters.push(args);if(/Single|single/.test(k))single=true;if(['update','insert','upsert','delete'].includes(k))window.__r18Requests.push({table,operation:k});return q};q.then=(resolve,reject)=>{let data=window.__r18Db[table]??[];if(Array.isArray(data)&&filters.length)data=data.filter(row=>filters.every(([k,v])=>row[k]===v||row[k]===undefined));if(single&&Array.isArray(data))data=data[0]||null;return Promise.resolve({data,error:null}).then(resolve,reject)};return q;}
const session=()=>window.__fechouAppState?.supabaseUser?{user:window.__fechouAppState.supabaseUser,access_token:'fixture-only'}:null;
const db={from,rpc:async(name)=>({data:name==='fechou_contract_party_data'?{client:{full_name:'Cliente de teste'},professional:{full_name:'Profissional de teste'}}:{},error:null}),auth:{getSession:async()=>({data:{session:session()}}),getUser:async()=>({data:{user:session()?.user||null}}),refreshSession:async()=>({data:{session:session()}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},channel:()=>({on(){return this},subscribe(){return this},unsubscribe(){}}),removeChannel(){},storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:''}}),createSignedUrl:async()=>({data:{signedUrl:''}}),list:async()=>({data:[],error:null})})}};
window.supabase={createClient:()=>db};
window.__r18Api=async(action,payload={})=>{
window.__r18Requests.push({action});
const s=window.__fechouAppState||{},order=s.orders?.[0]||{};
if(action==='ai/analyze')return {ok:true,analysis:{category:'Elétrica',service:'Tomadas e interruptores',summary:'Substituição de duas tomadas na sala.',estimated_min:120,estimated_average:150,estimated_max:180,currency:'BRL',materials_estimate:{low:20,average:30,high:40},materials_breakdown:[{name:'Tomada 10 A',quantity:2,unit_price:15,subtotal:30}],checklist:['Desligar e conferir o circuito','Verificar as conexões'],questions:['O circuito possui aterramento?'],factors:['Estimativa de teste para Florianópolis.'],regional_sources:[{name:'Referência simulada',url:'https://example.test/'}]}};
if(action==='wallet/refund-requests')return {ok:true,requests:[{id:'refund-fixture',order_id:order.id,service:'Iluminação',title:'Iluminação',amount:42,status:'in_progress',reason:'Solicitação do cliente para análise',created_at:'2026-11-16T10:00:00Z',provider_summary:{pending_value:42}}]};
if(action==='contracts/esign-status')return {ok:true,signature_status:'signed',pdf_available:true,client_signed:true,professional_signed:true,current_user_signed:true,document_id:'contract-fixture'};
if(action.startsWith('team/'))return {ok:true,team:{id:'team-fixture',leader_id:s.supabaseUser?.id},order:{id:order.id,service:'Iluminação'},viewer:{leader:s.currentRole==='Profissional',client:s.currentRole==='Cliente'},participants:[],invites:[],messages:[],turns:[]};
return {ok:true,orders:s.orders||[],entries:[],requests:[],messages:[],photos:[],subscription:s.subscription,team:null,fees:{},balance:{available:0}};
};
window.fetch=async url=>{const u=String(url);if(u.includes('viacep.com.br'))return new Response(JSON.stringify({logradouro:'Rua de teste',bairro:'Centro',localidade:'Florianópolis',uf:'SC'}),{status:200,headers:{'Content-Type':'application/json'}});return new Response(JSON.stringify(await window.__r18Api('fixture/read')),{status:200,headers:{'Content-Type':'application/json'}})};
});
await page.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__fechouAppState&&typeof window.render==='function');
await page.waitForTimeout(400);
await page.evaluate(()=>{
window.ewApi=window.__r18Api;
const client='11111111-1111-4111-8111-111111111111',pro='22222222-2222-4222-8222-222222222222',id='44444444-4444-4444-8444-444444444444',pid='33333333-3333-4333-8333-333333333333';
window.__r18Order={id,client_id:client,client_name:'Cliente de teste',title:'Instalação de luminária',service:'Iluminação',description:'Instalar uma luminária e conferir as conexões do circuito.',category:'Elétrica',location:'Centro, Florianópolis — SC',region_approx:'Centro, Florianópolis — SC',total:150,reference_price:150,referencePrice:150,status:'Aguardando início',service_state:'in_progress',payment_method:'contract_prepaid',payment_status:'approved',selected_proposal_id:pid,selectedProposalId:pid,professional_id:pro,metadata:{payment_method:'contract_prepaid',service_state:'in_progress'},proposals:[{id:pid,order_id:id,professional_id:pro,name:'Profissional de teste',price:150,status:'accepted',metadata:{payment_method:'contract_prepaid'}}],contract:{id:'contract-fixture',status:'signed',client_signed_at:'2026-11-16T10:00:00Z',professional_signed_at:'2026-11-16T10:01:00Z',client_accepted_at:'2026-11-16T10:00:00Z',professional_accepted_at:'2026-11-16T10:01:00Z'}};
window.fechouEnsureContract=async()=>window.__r18Order;
window.__r18Scene=(pageName,role='Cliente')=>{const s=window.__fechouAppState;s.page=pageName;s.currentRole=role;s.supabaseUser={id:role==='Cliente'?client:pro,email:'conta@example.test',user_metadata:{role:role==='Cliente'?'client':'professional'}};s.__v134Wallet=false;s.orders=pageName==='request'?[]:[window.__r18Order];s.activeOrderId=pageName==='request'?null:id;s.budget=pageName==='request'?null:window.__r18Order;s.proName='Profissional de teste';s.clientProfile={name:'Cliente de teste'};s.subscription={id:'subscription-fixture',status:'active',plan:'mensal',access_until:'2026-12-11T00:00:00Z'};s.professionalCategories=['Elétrica'];s.professionalServices=['Iluminação'];document.getElementById('exylonWelcome')?.classList.remove('show');window.render();};
});
async function test(name,run){try{await run();results.push({name,passed:true})}catch(e){results.push({name,passed:false,error:e.message});if(name.startsWith('Chat:'))await page.evaluate(()=>{document.getElementById('fechou-v212-team-overlay')?.remove();document.getElementById('fechouChatAttachmentsOverlay')?.remove();document.getElementById('ewMessageModal')?.remove();document.getElementById('fechou-v335-event-modal')?.remove();window.__fechouCloseChatWithoutReopen(window.__r18Order.id)});}}
async function shot(name,selector){await page.waitForTimeout(180);const target=selector?page.locator(selector):page;const options={path:path.join(out,name+'.png'),animations:'disabled'};if(!selector)options.fullPage=true;await target.screenshot(options);}
await test('R20 estabilidade com timers reais durante 35 segundos',async()=>{
await page.evaluate(async()=>{window.__r18Scene('myquotes','Profissional');await window.__fechouOpenChatByOrder(window.__r18Order.id)});await page.waitForTimeout(1500);await page.locator('#v121ChatDraft').fill('Rascunho preservado');await page.locator('#v121ChatDraft').focus();const root=await page.locator('#v121ChatOverlay').elementHandle();const draft=await page.locator('#v121ChatDraft').elementHandle();const revision=await page.locator('html').getAttribute('data-fechou-revision');await page.waitForTimeout(35000);assert.equal(await root.evaluate(e=>e.isConnected),true);assert.equal(await draft.evaluate(e=>e.isConnected),true);assert.equal(await page.locator('#v121ChatDraft').inputValue(),'Rascunho preservado');assert.equal(await page.locator('html').getAttribute('data-fechou-revision'),revision);assert.equal(await page.evaluate(()=>document.activeElement?.id),'v121ChatDraft');await shot('30-estabilidade-timers-reais');
});
fs.writeFileSync(path.join(out,'stability-results.json'),JSON.stringify({kind:'Chromium real en-US; DOM/CSS e controladores do R19; dados e rede simulados. Não comprova publicação nem transações reais.',results,pageErrors:errors},null,2));
console.log(JSON.stringify({passed:results.filter(x=>x.passed).length,total:results.length,failed:results.filter(x=>!x.passed),pageErrors:errors},null,2));
process.exitCode=results.some(x=>!x.passed)||errors.length?1:0;
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
