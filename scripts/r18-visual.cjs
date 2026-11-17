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
window.__r18Db={};window.__r18Requests=[];window.setInterval=()=>0;window.alert=()=>{};
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
await test('CEP: consulta real dos controles com base simulada',async()=>{await page.evaluate(()=>{window.__r18Scene('request');const s=window.__fechouAppState;s.description='Trocar duas tomadas na sala';s.category='Elétrica';s.service='Tomadas e interruptores';s.location='Centro, Florianópolis';s.includeMaterialsEstimate=true;window.render()});await page.locator('#ewCep').fill('88010-000');await page.locator('[data-act="lookupCep"]').click();await page.waitForFunction(()=>window.__fechouAppState.location.includes('Rua de teste'));await shot('01-cep');});
await test('Materiais: valores em reais e grupos da análise',async()=>{await page.evaluate(async()=>{await window.ExylonHubV56.runAnalysis()});const close=page.locator('.v189-overlay .v189-close');if(await close.count()&&await close.last().isVisible())await close.last().click();await page.locator('#v56-ai-result').waitFor();await page.waitForTimeout(800);if(await page.locator('#ewMessageModal .ew-message-close').count())await page.locator('#ewMessageModal .ew-message-close').click();assert.equal(await page.locator('#ewMessageModal').count(),0);await page.evaluate(()=>document.querySelectorAll('#v56-ai-result details').forEach(d=>d.open=true));await shot('02-materiais','#v56-ai-result');});
await test('Detalhes: status, totais e proposta no celular',async()=>{await page.evaluate(()=>window.__r18Scene('proposals'));await shot('03-detalhes');});
await test('Registro: mídias de foto, vídeo e áudio',async()=>{await page.evaluate(()=>{window.__r18Order.photos=[{url:'http://127.0.0.1:8765/fixture-photo.svg',mime:'image/png',name:'Foto de teste'},{url:'http://127.0.0.1:8765/fixture-video.mp4',mime:'video/mp4',name:'Vídeo de teste'},{url:'http://127.0.0.1:8765/fixture-audio.m4a',mime:'audio/mp4',name:'Áudio de teste'}];window.__r18Scene('archive')});await page.locator('.r17-record-fold summary').first().click();await shot('04-registro');});
await test('Galeria: abrir e fechar sem trocar o pedido',async()=>{await page.locator('[data-request-media-open="0"]').click();await page.locator('#fechou-request-gallery').waitFor();await shot('05-galeria');await page.locator('[data-media-close]').click();});
await test('Menu e histórico de concluídos',async()=>{await page.evaluate(()=>window.__r18Scene('menu','Profissional'));await shot('06-menu');await page.locator('[data-act="page:completedreviews"]').click();await shot('07-historico');});
await test('Carteira: pedido de reembolso com valor e situação',async()=>{await page.evaluate(async()=>{window.__r18Scene('home');window.__r18Db.fechou_wallet_ledger=[{id:'ledger-fixture',user_id:window.__fechouAppState.supabaseUser.id,order_id:window.__r18Order.id,entry_type:'service_payment',amount:150,status:'held',created_at:'2026-11-16T10:00:00Z'}];window.__fechouAppState.__v134Wallet=true;window.render();await window.__fechouRefreshWalletNow()});await page.locator('#v134WalletRoot').waitFor();await shot('08-carteira');const d=page.locator('#v134WalletRoot details');for(let i=0;i<await d.count();i++)await d.nth(i).evaluate(x=>x.open=true);await shot('09-reembolso');});

await test('R19 carteira cliente: explicação e símbolo clicável sem alterar o valor',async()=>{
await page.locator('#v134WalletRoot .v240-wallet-explainer').evaluate(d=>d.open=false);
const value=await page.locator('#v134WalletRoot .v240-wallet-value').innerText();
await page.locator('[data-r19-wallet-help]').click();
assert.equal(await page.locator('.v240-wallet-explainer').evaluate(d=>d.open),true);
assert.match(await page.locator('.v240-wallet-explainer').innerText(),/ainda não foi repassado ao profissional/);
assert.match(await page.locator('.v240-wallet-explainer').innerText(),/cancelamento e o reembolso/);
assert.equal(await page.locator('.v240-wallet-value').innerText(),value);
await shot('14-carteira-cliente-ajuda');
await page.locator('.v240-wallet-explainer summary').click();await page.waitForFunction(()=>document.querySelector('[data-r19-wallet-help]')?.getAttribute('aria-expanded')==='false');
});
await test('R19 carteira profissional: reserva e repasse explicados separadamente',async()=>{
await page.evaluate(async()=>{window.__r18Scene('home','Profissional');window.__r18Db.fechou_wallet_ledger=[{id:'payout-fixture',user_id:window.__fechouAppState.supabaseUser.id,order_id:window.__r18Order.id,entry_type:'payout',amount:147,status:'held',created_at:'2026-11-16T10:00:00Z'}];window.__fechouAppState.__v134Wallet=true;window.render();await window.__fechouRefreshWalletNow()});
await page.locator('[data-r19-wallet-help]').click();
assert.match(await page.locator('.v240-wallet-explainer').innerText(),/continuam reservados e ainda não estão disponíveis para você/);
assert.match(await page.locator('.v240-wallet-explainer').innerText(),/aprovação do cliente/);
await shot('15-carteira-profissional-ajuda');
});
for(const [scene,role,ids] of [['client','Cliente',['clientPhoto']],['pro','Profissional',['proPhoto','proDocument']]]){
await test('R19 seletores de arquivo em português no perfil '+role,async()=>{
await page.evaluate(([scene,role])=>window.__r18Scene(scene,role),[scene,role]);
for(const id of ids){const picker=page.locator('.r19-file-picker').filter({has:page.locator('#'+id)});await picker.waitFor();assert.equal(await picker.locator('input').isVisible(),false);assert.equal(await picker.locator('button').innerText(),'Escolher arquivo');assert.equal(await picker.locator('.r19-file-status').innerText(),'Nenhum arquivo selecionado');await shot('16-perfil-'+id,'.field:has(#'+id+')');}
});
}
for(const [kind,label] of [['contract','contrato'],['attach','anexar'],['attachments','anexos'],['photos','fotos'],['team','equipe'],['service','servico']]){
await test('Chat: abrir ferramenta '+label,async()=>{
await page.evaluate(async()=>{window.__r18Order.photos=[];window.__r18Scene('myquotes','Profissional');await window.__fechouOpenChatByOrder(window.__r18Order.id)});
await page.locator('#v121ChatOverlay').waitFor();
await page.waitForTimeout(250);
const toggle=page.locator('#v121ChatOverlay [data-fc-tools-toggle]');
if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
await page.waitForTimeout(700);
const toolsState=await page.locator('#v121ChatOverlay').evaluate(ov=>{const t=ov.querySelector('[data-fc-tools-toggle]'),g=ov.querySelector('.fc-chat-tools-grid'),b=g.getBoundingClientRect(),style=getComputedStyle(g);return {expanded:t.getAttribute('aria-expanded'),dataset:ov.dataset.toolsExpanded,classes:g.className,height:b.height,opacity:style.opacity,display:style.display}});console.log('CHAT_TOOLS_STATE '+kind+' '+JSON.stringify(toolsState));
assert.equal(toolsState.expanded,'true','As ferramentas devem permanecer expandidas depois de 700 ms');
await page.evaluate(()=>window.renderV121ChatOverlay());await page.waitForTimeout(250);assert.equal(await toggle.getAttribute('aria-expanded'),'true','Atualizar a conversa deve preservar a expansão');
if(kind==='contract'){for(const icon of ['contract','complete','attach','attachments','photos','team']){await page.locator('#v121ChatOverlay .fc-chat-tools-grid svg[data-chat-icon="'+icon+'"]').waitFor();}await shot('10-chat-ferramentas');}
await page.locator('#v121ChatOverlay [data-fc-tool="'+kind+'"]').click();
await page.waitForTimeout(900);fs.writeFileSync(path.join(out,'diagnostico-'+kind+'.html'),await page.locator('#v121ChatOverlay').evaluate(x=>x.outerHTML));fs.writeFileSync(path.join(out,'modais-'+kind+'.html'),await page.locator('body').evaluate(x=>Array.from(x.children).filter(n=>n.id!=='app'&&n.id!=='v121ChatOverlay'&&n.offsetHeight>0).map(n=>n.outerHTML).join('\n')));if(kind==='contract'){await page.locator('#fechou-v335-chat-action h2').filter({hasText:'Contrato'}).waitFor();await page.locator('#fechou-v335-chat-action [data-v121-print-contract]').waitFor();await page.evaluate(()=>window.renderV121ChatOverlay());await page.waitForTimeout(500);await page.locator('#fechou-v335-chat-action [data-v121-print-contract]').waitFor();}
if(kind==='photos'){for(const phase of ['before','during','after'])await page.locator('#fechou-v335-chat-action .v335-fotos-phase[data-phase="'+phase+'"]').waitFor();assert.equal(await page.locator('#fechou-v335-chat-action .v335-fotos-phase').count(),3);}
if(kind==='attach')await page.locator('#fechou-v335-chat-action [data-v335-pick-file]').waitFor();
if(kind==='attachments')await page.locator('#fechouChatAttachmentsOverlay [data-fechou-attachments-contract]').waitFor();
if(kind==='team')await page.locator('#fechou-v212-team-overlay.open').waitFor();
if(kind==='service'){await page.locator('#fechou-v335-event-modal').waitFor();assert.equal(await page.locator('#fechou-v335-event-modal .v335-check.is-missing').count(),3);assert.equal(await page.locator('#fechou-v335-event-modal [data-v335-kind="confirm-complete"]').isDisabled(),true);assert.equal(await page.locator('#ewMessageModal').count(),0);const picker=page.locator('#fechou-v335-event-modal .r19-file-picker');await picker.waitFor();assert.equal(await picker.locator('input').isVisible(),false);assert.equal(await picker.locator('button').innerText(),'Escolher arquivos');const chooserPromise=page.waitForEvent('filechooser');await picker.locator('button').click();const chooser=await chooserPromise;await chooser.setFiles({name:'foto-teste.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=','base64')});assert.match(await picker.locator('.r19-file-status').innerText(),/foto-teste.png/);await shot('17-arquivo-selecionado-portugues');await picker.locator('input').setInputFiles([]);assert.equal(await picker.locator('.r19-file-status').innerText(),'Nenhum arquivo selecionado');}
assert.ok(await page.locator('#v121ChatOverlay [data-v134-service-action="complete"]').count()<=2,'Não duplicar botões de conclusão');
await shot('11-chat-'+label);
if(kind==='service')await page.locator('#fechou-v335-event-modal [data-v335-kind="close"]').click();
await page.evaluate(()=>{document.getElementById('fechou-v212-team-overlay')?.remove();document.getElementById('fechouChatAttachmentsOverlay')?.remove();window.__fechouCloseChatWithoutReopen(window.__r18Order.id)});
});
}
await test('Chat: reabrir conversa começa compacto e sem painel anterior',async()=>{await page.evaluate(async()=>{await window.__fechouOpenChatByOrder(window.__r18Order.id)});await page.waitForTimeout(250);assert.equal(await page.locator('#v121ChatOverlay [data-fc-tools-toggle]').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#v121ChatOverlay').evaluate(ov=>ov.classList.contains('is-v335-action')),false);assert.equal(await page.locator('#ewMessageModal, #fechou-v335-event-modal').count(),0);await shot('12-chat-reaberto');await page.evaluate(()=>window.__fechouCloseChatWithoutReopen(window.__r18Order.id));});

await test('R19 ícone de iniciar e abertura da confirmação',async()=>{
await page.evaluate(async()=>{window.__r18Order.service_state='pending';window.__r18Order.metadata.service_state='pending';window.__r18Scene('myquotes','Profissional');await window.__fechouOpenChatByOrder(window.__r18Order.id)});
await page.locator('#v121ChatOverlay [data-fc-tools-toggle]').click();await page.locator('[data-fc-tool="service"] svg[data-chat-icon="start"]').waitFor();await shot('18-chat-iniciar');await page.locator('[data-fc-tool="service"]').click();await page.locator('#fechou-v335-event-modal [data-v335-kind="confirm-start"]').waitFor();await page.locator('#fechou-v335-event-modal [data-v335-kind="close"]').click();await page.evaluate(()=>window.__fechouCloseChatWithoutReopen(window.__r18Order.id));
});
await test('R19 ícones de aprovação e contestação do cliente',async()=>{
await page.evaluate(async()=>{window.__r18Order.service_state='awaiting_customer_confirmation';window.__r18Order.metadata.service_state='awaiting_customer_confirmation';window.__r18Scene('orders','Cliente');await window.__fechouOpenChatByOrder(window.__r18Order.id)});
await page.locator('#v121ChatOverlay [data-fc-tools-toggle]').click();await page.locator('[data-fc-tool="approve"] svg[data-chat-icon="approve"]').waitFor();await page.locator('[data-fc-tool="contest"] svg[data-chat-icon="contest"]').waitFor();
assert.equal(await page.locator('#v121ChatOverlay .v134-service-actions:visible, #v121ChatOverlay .v322-inline-actions:visible').count(),0);
assert.equal(await page.locator('#v121ChatOverlay button:visible').filter({hasText:/^Aprovar serviço$/}).count(),1);
assert.equal(await page.locator('#v121ChatOverlay button:visible').filter({hasText:/^Contestar$/}).count(),1);
const layout=await page.locator('.fc-chat-tools-grid').evaluate(g=>{const team=g.querySelector('[data-fc-tool="team"]'),photos=g.querySelector('[data-fc-tool="photos"]'),attach=g.querySelector('[data-fc-tool="attachments"]');return {teamX:team.getBoundingClientRect().x,teamY:team.getBoundingClientRect().y,attachY:attach.getBoundingClientRect().y,photosVisible:!!photos.offsetHeight,teamAfterAttach:team.previousElementSibling===attach};});assert.equal(layout.teamAfterAttach,true);assert.equal(layout.teamY,layout.attachY);assert.equal(layout.photosVisible,false);
await shot('19-chat-aprovar-contestar');await page.evaluate(()=>window.__fechouCloseChatWithoutReopen(window.__r18Order.id));
});
await test('R19 seletor em português no cancelamento do profissional',async()=>{
await page.evaluate(()=>{window.__r18Order.service_state='in_progress';window.__r18Order.metadata.service_state='in_progress';window.__r18Scene('myquotes','Profissional');window.fechouOpenActionSheetV335('cancel',{order:window.__r18Order,orderId:window.__r18Order.id})});
const picker=page.locator('#fechou-v335-event-modal .r19-file-picker');await picker.waitFor();assert.equal(await picker.locator('input').isVisible(),false);assert.equal(await picker.locator('button').innerText(),'Escolher arquivos');await shot('20-cancelamento-portugues');await page.locator('#fechou-v335-event-modal [data-v335-kind="close"]').click();
});
await test('R19 documento indisponível: mensagem clara e assinatura bloqueada',async()=>{
await page.evaluate(async()=>{window.__r18Scene('myquotes','Profissional');await window.__fechouOpenChatByOrder(window.__r18Order.id);try{await window.__fechouOpenContractReview(window.__r18Order);throw new Error('Contrato ausente não deveria liberar assinatura');}catch(error){if(!String(error.message).includes('contrato deste serviço ainda não está disponível'))throw error;window.toast(error.message);}});
await page.locator('#ewMessageModal').waitFor();assert.match(await page.locator('#ewMessageModal').innerText(),/A assinatura só será liberada quando o contrato original estiver pronto/);assert.equal(await page.locator('#fechou-clicksign-sign-modal').count(),0);await shot('21-aviso-contrato');await page.locator('#ewMessageModal .ew-message-close').click();await page.evaluate(()=>window.__fechouCloseChatWithoutReopen(window.__r18Order.id));
});
await test('R20 tela preserva elementos sem mudança e atualiza quando dados mudam',async()=>{
await page.evaluate(()=>window.__r18Scene('request','Cliente'));await page.locator('[data-input="description"]').fill('Rascunho que deve continuar na tela');
const ref=await page.locator('[data-input="description"]').elementHandle();await page.evaluate(()=>{window.__fechouAppState.description='Rascunho que deve continuar na tela';window.render()});
const mounted=await page.locator('[data-input="description"]').elementHandle();await page.evaluate(()=>window.render());assert.equal(await mounted.evaluate(el=>el.isConnected),true);assert.equal(await page.locator('[data-input="description"]').inputValue(),'Rascunho que deve continuar na tela');
await page.evaluate(()=>{window.__fechouAppState.description='Conteúdo atualizado';window.render()});assert.equal(await page.locator('[data-input="description"]').inputValue(),'Conteúdo atualizado');
});
await test('R20 carteira mantém painel expandido e DOM em atualização idêntica',async()=>{
await page.evaluate(async()=>{window.__r18Scene('home','Cliente');window.__fechouAppState.__v134Wallet=true;window.render();await window.__fechouRefreshWalletNow()});await page.locator('.v240-wallet-explainer').evaluate(d=>d.open=true);const hero=await page.locator('.v240-wallet-hero').elementHandle();await page.evaluate(async()=>{await window.__fechouRefreshWalletNow()});assert.equal(await hero.evaluate(el=>el.isConnected),true);assert.equal(await page.locator('.v240-wallet-explainer').evaluate(d=>d.open),true);
await page.evaluate(()=>{window.__fechouAppState.__v134Wallet=false;window.render()});assert.equal(await page.locator('#v134WalletRoot').count(),0);
});
await test('Larguras móveis sem rolagem horizontal nos detalhes',async()=>{for(const width of [320,360,390,430]){await page.setViewportSize({width,height:844});await page.evaluate(()=>window.__r18Scene('proposals'));const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,'largura '+width)}});
fs.writeFileSync(path.join(out,'visual-results.json'),JSON.stringify({kind:'Chromium real en-US; DOM/CSS e controladores do R19; dados e rede simulados. Não comprova publicação nem transações reais.',results,pageErrors:errors},null,2));
console.log(JSON.stringify({passed:results.filter(x=>x.passed).length,total:results.length,failed:results.filter(x=>!x.passed),pageErrors:errors},null,2));
process.exitCode=results.some(x=>!x.passed)||errors.length?1:0;
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
