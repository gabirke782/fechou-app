import {createClient} from 'npm:@supabase/supabase-js@2.95.0';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
// A retirada por falta de interesse foi removida. Este endpoint mantém apenas
// autenticação e resposta explícita para agendamentos/integrações anteriores.
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-fechou-cron-token','Access-Control-Allow-Methods':'POST,OPTIONS'}});
 if(req.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
 const token=String(req.headers.get('x-fechou-cron-token')||'').trim();
 if(token.length<64||token.length>256)return json({ok:false,error:'Unauthorized'},401);
 const db=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Deno.env.get('SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await db.from('fechou_cron_secrets').select('secret_hash').eq('name','fechou_auto_refund_cron').maybeSingle();
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
 const hash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
 const expected=String(data?.secret_hash||'');let difference=hash.length^expected.length;
 for(let i=0;i<Math.max(hash.length,expected.length);i++)difference|=(hash.charCodeAt(i)||0)^(expected.charCodeAt(i)||0);
 if(error||!expected||difference)return json({ok:false,error:'Unauthorized'},401);
 return json({ok:true,disabled:true,reason:'no_interest_auto_refund_removed',scanned:0,processed:0,refunds_requested:0,message:'Pedidos permanecem disponíveis até cancelamento do cliente ou seleção de profissional.'});
});
