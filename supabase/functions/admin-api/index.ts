import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLIC_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const ADMIN_EMAIL = "fechousuporte@gmail.com";
const MAX_ROWS = 500;
const ASAAS_API_KEY = (Deno.env.get("ASAAS_API_KEY") || Deno.env.get("ASAAS_ACCESS_TOKEN") || "").trim();
const ASAAS_WEBHOOK_TOKEN = (Deno.env.get("ASAAS_WEBHOOK_TOKEN") || Deno.env.get("ASAAS_WEBHOOK_SECRET") || "").trim();
const ASAAS_ENV = ASAAS_API_KEY.startsWith("$aact_hmlg_") ? "sandbox" : ASAAS_API_KEY.startsWith("$aact_prod_") ? "production" : ((Deno.env.get("ASAAS_ENV") || "").toLowerCase() === "sandbox" ? "sandbox" : "production");
const ASAAS_BASE = ASAAS_ENV === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3";
const ASAAS_PIX_PAYOUTS_ENABLED = Deno.env.get("FECHOU_ASAAS_PIX_PAYOUTS_ENABLED") === "true";
const ASAAS_PIX_PAYOUTS_PRODUCTION_CONFIRMATION = Deno.env.get("FECHOU_ASAAS_PIX_PAYOUTS_PRODUCTION_CONFIRMATION") || "";

const clean = (v: unknown, max = 300) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const asObj = (v: unknown): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
const norm = (v: unknown) => clean(v, 200).toLowerCase();
const arr = (v: unknown): any[] => Array.isArray(v) ? v : [];
const money = (v: unknown) => Math.max(0, Number(v ?? 0) || 0);
const sum = (rows: any[], key: string) => rows.reduce((n, r) => n + money(r?.[key]), 0);
const paidStatuses = new Set(["paid", "approved", "confirmed", "received"]);
const activeStatuses = new Set(["active", "confirmed", "paid", "received", "authorized"]);
const isPaid = (v: any) => paidStatuses.has(norm(v?.payment_status)) || paidStatuses.has(norm(v?.payment_state));
const isConfirmedCheckout = (v: any) => paidStatuses.has(norm(v?.status)) || activeStatuses.has(norm(v?.status)) || activeStatuses.has(norm(v?.subscription_status));
const isActiveSubscription = (v: any) => activeStatuses.has(norm(v?.subscription_status)) || activeStatuses.has(norm(v?.status));
const isPending = (v: any) => ["open", "in_review", "pending", "requested_review", "under_review", "transfer_pending"].includes(norm(v?.status));
const periodStart = (period: unknown) => {
  const d = new Date();
  const p = clean(period, 20);
  if (p === "7d") d.setDate(d.getDate() - 7);
  else if (p === "90d") d.setDate(d.getDate() - 90);
  else if (p === "12m") d.setMonth(d.getMonth() - 12);
  else if (p === "all") return null;
  else d.setDate(d.getDate() - 30);
  return d.toISOString();
};
const dateLabel = (v: string) => {
  const d = new Date(v + "T12:00:00Z");
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
};
const profileLocation = (p: any) => {
  const d = asObj(p?.profile_data);
  const a = asObj(d.address);
  return {
    city: clean(d.city || d.cidade || a.city || a.cidade || d.municipality || "", 100),
    state: clean(d.state || d.uf || a.state || a.uf || "", 40).toUpperCase()
  };
};
const orderStage = (o: any, proposalCount = 0) => {
  const s = norm(o?.service_state);
  const st = norm(o?.status);
  if (s.includes("cancel") || st.includes("cancel")) return "cancelled";
  if (s.includes("complete") || s.includes("conclu") || st.includes("complete") || st.includes("conclu")) return "completed";
  if (s.includes("progress") || s.includes("started") || s.includes("exec") || st.includes("exec")) return "in_progress";
  if (o?.service_started_at) return "in_progress";
  if (o?.selected_proposal_id || o?.professional_id || st === "contracted") return "accepted";
  if (proposalCount > 0 || st.includes("negocia")) return "quoted";
  return "waiting_quote";
};
const stageLabel: Record<string, string> = {
  waiting_quote: "Aguardando orçamento",
  quoted: "Com orçamentos",
  accepted: "Aguardando início",
  in_progress: "Em execução",
  completed: "Concluído",
  cancelled: "Cancelado"
};

const getCorsHeaders = (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const allowedOrigins = (Deno.env.get("FECHOU_ALLOWED_ORIGINS") || "").split(",").map(x => x.trim()).filter(Boolean);
  const appUrl = (Deno.env.get("FECHOU_APP_URL") || "").replace(/\/$/, "");
  let allowed = !origin;
  if (origin) {
    try {
      const u = new URL(origin);
      allowed = allowedOrigins.includes(u.origin) || appUrl === u.origin ||
        ["https://admpainel-6js.pages.dev", "https://startup5.pages.dev"].includes(u.origin) ||
        (ASAAS_ENV === "sandbox" && (u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.protocol === "http:");
    } catch { allowed = false; }
  }
  return {
    ...(allowed && origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
};
const reply = (req: Request, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: getCorsHeaders(req) });

function serviceClient() {
  if (!SUPABASE_URL || !SERVICE_KEY || !PUBLIC_KEY) throw new Error("Backend administrativo não configurado.");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}


async function asaasRequest(path:string,method="GET",body?:Record<string,unknown>) {
  if(!ASAAS_API_KEY) throw Object.assign(new Error("ASAAS_API_KEY não está configurada nos secrets do projeto."),{status:503});
  const response=await fetch(ASAAS_BASE+path,{method,headers:{"Content-Type":"application/json",Accept:"application/json",access_token:ASAAS_API_KEY,"User-Agent":"FECHOU-Admin/1.0"},...(body?{body:JSON.stringify(body)}:{})});
  const raw=await response.text();let data:any={};try{data=raw?JSON.parse(raw):{};}catch{data={};}
  if(!response.ok) {
    const detail=Array.isArray(data.errors)?data.errors.map((x:any)=>clean(x.description||x.code||"",180)).filter(Boolean).join("; "):clean(data.message||"",300);
    throw Object.assign(new Error("Asaas recusou a operação ("+response.status+"). "+(detail||"Verifique permissões da chave e os dados da cobrança.")),{status:response.status===401||response.status===403?503:response.status,provider_rejected:[400,401,403,404,422].includes(response.status)});
  }
  return data;
}
async function asaasBalance() {
  const data=await asaasRequest("/finance/balance");
  return {connected:true,environment:ASAAS_ENV,balance:Number(data.balance||0),checked_at:new Date().toISOString(),webhook_token_configured:Boolean(ASAAS_WEBHOOK_TOKEN)};
}
async function asaasRefundCreate(db:any,user:any,params:any,requestId:string) {
  const caseId=clean(params.case_id,80);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(caseId)) throw Object.assign(new Error("Identificador do caso inválido."),{status:400});
  let item:any=null;
  for(const table of ["fechou_service_cases","fechou_service_review_cases","fechou_support_cases"]) {
    const {data,error}=await db.from(table).select("*").eq("id",caseId).maybeSingle();
    if(error && !/does not exist|schema cache/i.test(error.message)) throw new Error("Falha ao consultar o caso de reembolso.");
    if(data){item=data;break;}
  }
  if(!item) throw Object.assign(new Error("Caso de reembolso não encontrado na fila administrativa."),{status:404});
  const caseMeta=asObj(item.metadata);
  if(norm(item.case_type)==="manual_refund_reconciliation"||caseMeta.manual_refund_reconciliation_required===true||norm(caseMeta.source)==="manual_user_report")throw Object.assign(new Error("Este caso é de conciliação de estorno manual. Consulte o status no Asaas; não emita um novo estorno por esta ação."),{status:409,code:"MANUAL_REFUND_RECONCILIATION_REQUIRED"});
  if(classifyCaseType(item.case_type)!=="refund"||norm(item.decision)!=="approve") throw Object.assign(new Error("O caso precisa ser de reembolso e estar aprovado na análise administrativa."),{status:409});
  const orderId=String(item.order_id||"");
  const {data:order,error:orderError}=await db.from("orders").select("id,client_id,total,payment_status,payment_id,refund_status,metadata,payment_metadata").eq("id",orderId).maybeSingle();
  if(orderError||!order) throw Object.assign(new Error("Contratação vinculada ao caso não encontrada."),{status:404});
  if(!["approved","paid","received","confirmed"].includes(norm(order.payment_status))) throw Object.assign(new Error("O pagamento ainda não está confirmado."),{status:409});
  const orderMeta=asObj(order.metadata);
  if(["initiating","pending","refund_pending","bank_slip_action_required","refunded"].includes(norm(order.refund_status))) throw Object.assign(new Error("Já existe uma solicitação de estorno ou devolução registrada."),{status:409});
  const paymentId=clean(order.payment_id,120);
  if(!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw Object.assign(new Error("Identificador da cobrança Asaas inválido; conciliação manual necessária."),{status:409});
  const {data:checkouts,error:checkoutError}=await db.from("fechou_asaas_checkouts").select("external_reference,amount,provider_payload").eq("order_id",orderId).in("purpose",["service","prepublication"]).order("created_at",{ascending:false}).limit(5);
  if(checkoutError) throw new Error("Não foi possível conferir a contratação no histórico Asaas.");
  const payment=await asaasRequest("/payments/"+encodeURIComponent(paymentId));
  const providerRefunds=Array.isArray(payment.refunds)?payment.refunds:[];
  if(norm(payment.status)==="refunded"||providerRefunds.length>0)throw Object.assign(new Error("O Asaas já registra um estorno solicitado ou concluído para esta cobrança. A ação foi bloqueada para evitar devolução duplicada; faça a conciliação manual."),{status:409,code:"ASAAS_REFUND_ALREADY_EXISTS"});
  const checkout=(checkouts||[]).find((x:any)=>x.external_reference&&String(x.external_reference)===String(payment.externalReference||""));
  const amount=Number(checkout?.amount||0);
  if(!checkout||String(payment.id||"")!==paymentId||!["RECEIVED","CONFIRMED"].includes(String(payment.status||"").toUpperCase())||!(amount>0)||Math.abs(amount-Number(payment.value||0))>0.02) throw Object.assign(new Error("A cobrança não corresponde exatamente ao pagamento confirmado desta contratação."),{status:409});
  const billing=clean(asObj(checkout.provider_payload).billing_type||asObj(checkout.provider_payload).billingType||asObj(order.payment_metadata).billing_type||asObj(order.payment_metadata).billingType||asObj(order.metadata).payment_billing_type||asObj(order.metadata).billing_type||payment.billingType||"",30).toUpperCase();
  let claimQuery=db.from("orders").update({refund_status:"initiating",metadata:{...asObj(order.metadata),refund_admin_claimed_at:new Date().toISOString(),refund_admin_claimed_by:user.id},updated_at:new Date().toISOString()}).eq("id",orderId);
  if(norm(order.refund_status)==="review_required") claimQuery=claimQuery.eq("refund_status","review_required");
  else if(!order.refund_status) claimQuery=claimQuery.is("refund_status",null);
  else throw Object.assign(new Error("O status atual do reembolso não permite nova solicitação."),{status:409});
  const {data:claim,error:claimError}=await claimQuery.select("id").maybeSingle();
  if(claimError||!claim) throw Object.assign(new Error("Não foi possível reservar o reembolso; atualize o caso."),{status:409});
  let providerAccepted=false;
  let providerCallStarted=false;
  try {
    let providerResult:any,requestUrl="";
    if(billing==="BOLETO") {
      providerCallStarted=true;
      providerResult=await asaasRequest("/payments/"+encodeURIComponent(paymentId)+"/bankSlip/refund","POST",{});
      requestUrl=clean(providerResult.requestUrl||"",1000);
      if(!requestUrl) throw new Error("O Asaas não retornou o link para o cliente informar os dados bancários.");
      providerAccepted=true;
    } else if(billing==="PIX"||billing==="CREDIT_CARD") {
      providerCallStarted=true;
      providerResult=await asaasRequest("/payments/"+encodeURIComponent(paymentId)+"/refund","POST",{description:"FECHOU: reembolso aprovado pela administração. Caso "+caseId});
      providerAccepted=true;
    } else throw new Error("Esta forma de pagamento exige conferência manual antes do estorno.");
    const status=billing==="BOLETO"?"bank_slip_action_required":"pending";
    const metadata={...asObj(order.metadata),refund_status:status,refund_requested_at:new Date().toISOString(),refund_provider:"asaas",refund_provider_status:clean(providerResult.status||"requested",80),refund_request_url:requestUrl||null,refund_admin_decision_by:user.id};
    const {error:updateError}=await db.from("orders").update({status:"cancelled",service_state:"cancelled",refund_status:status,metadata,updated_at:new Date().toISOString()}).eq("id",orderId);
    if(updateError) throw new Error("O Asaas recebeu o pedido, mas o FECHOU não sincronizou a contratação: "+updateError.message);
    const {error:ledgerError}=await db.from("fechou_wallet_ledger").upsert({user_id:order.client_id,order_id:orderId,entry_type:"refund",amount:Number(amount.toFixed(2)),status:"refund_pending",provider:"asaas",provider_reference:paymentId,description:billing==="BOLETO"?"Estorno iniciado; aguardando dados bancários do cliente no Asaas.":"Estorno solicitado ao Asaas; aguardando confirmação oficial.",idempotency_key:"refund:"+orderId,metadata:{billing_type:billing,request_url:requestUrl||null,case_id:caseId}},{onConflict:"idempotency_key",ignoreDuplicates:true});
    if(ledgerError) throw new Error("Estorno solicitado ao Asaas, mas houve falha ao registrar a carteira: "+ledgerError.message);
    await audit(db,user,"asaas_refund_requested","orders",orderId,{case_id:caseId,amount,billing_type:billing,provider_status:clean(providerResult.status||"requested",80)},requestId);
    return {ok:true,refund_status:status,amount,request_url:requestUrl||null,provider_status:clean(providerResult.status||"requested",80),message:billing==="BOLETO"?"Solicitação iniciada. O cliente ainda precisa informar os dados bancários no link do Asaas.":"Estorno solicitado ao Asaas; a carteira só será atualizada como devolvida após confirmação do Webhook."};
  } catch(error) {
    const uncertain = providerCallStarted && (error as any)?.provider_rejected !== true;
    if(providerAccepted || uncertain) {
      // Uma resposta perdida não prova recusa. Mantém a reserva e impede outro POST.
      await db.from("orders").update({metadata:{...asObj(order.metadata),refund_status:"pending_sync",refund_reconciliation_required:true,refund_sync_error:clean((error as Error)?.message||error,400),refund_provider_attempted_at:new Date().toISOString(),...(providerAccepted?{refund_provider_accepted_at:new Date().toISOString()}:{})},updated_at:new Date().toISOString()}).eq("id",orderId).eq("refund_status","initiating");
      await audit(db,user,"asaas_refund_reconciliation_required","orders",orderId,{case_id:caseId,provider_response_confirmed:providerAccepted},requestId);
    } else {
      await db.from("orders").update({refund_status:"review_required",metadata:{...asObj(order.metadata),refund_status:"review_required",refund_error:clean((error as Error)?.message||error,400),refund_failed_at:new Date().toISOString()},updated_at:new Date().toISOString()}).eq("id",orderId).eq("refund_status","initiating");
    }
    throw error;
  }
}

async function authenticate(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("Sessão inválida. Entre novamente."), { status: 401 });
  const authClient = createClient(SUPABASE_URL, PUBLIC_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + token } }
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user) throw Object.assign(new Error("Sessão não autenticada. Entre novamente."), { status: 401 });
  return data.user;
}

async function ensureAdmin(db: any, user: any) {
  const email = norm(user?.email);
  if (!email || !user?.id || !user.email_confirmed_at) {
    throw Object.assign(new Error("Confirme o e-mail da conta antes de acessar a administração."), { status: 403 });
  }
  const { data: row, error } = await db.from("admin_access")
    .select("user_id,email,active,permissions")
    .eq("user_id", user.id).maybeSingle();
  if (error) throw new Error("Não foi possível validar a autorização administrativa.");

  if (row) {
    if (row.active === true && norm(row.email) === email) return row;
    // Um convite antigo não pode reativar uma autorização revogada.
    throw Object.assign(new Error("Acesso administrativo desativado ou não autorizado para esta conta."), { status: 403 });
  }

  const { data: invite, error: inviteError } = await db.from("admin_access_invites")
    .select("email,active,permissions,claimed_user_id")
    .eq("email", email).eq("active", true).maybeSingle();
  if (inviteError) throw new Error("Não foi possível validar o convite administrativo.");

  if (invite && invite.claimed_user_id === user.id) {
    if (invite.claimed_user_id && invite.claimed_user_id !== user.id) {
      throw Object.assign(new Error("Este convite administrativo já foi utilizado por outra conta."), { status: 403 });
    }
    const permissions = asObj(invite.permissions);
    const { error: insertError } = await db.from("admin_access").insert({
      user_id: user.id,
      email,
      active: true,
      permissions,
      created_by: null
    });
    if (insertError) throw new Error("Não foi possível vincular a conta à lista administrativa.");
    return { user_id: user.id, email, active: true, permissions };
  }

  throw Object.assign(new Error("Conta autenticada, mas sem autorização administrativa."), { status: 403 });
}

const requiredPermission: Record<string, string> = {
  session_check: "dashboard",
  dashboard_summary: "dashboard",
  revenue_series: "dashboard",
  geo_demand: "dashboard",
  users_list: "users",
  orders_list: "orders",
  subscriptions_list: "subscriptions",
  cases_list: "cases",
  case_decide: "cases",
  activity_list: "activity",
  payments_list: "finance_read",
  transactions_list: "finance_read",
  payouts_list: "finance_read",
  payout_decide: "finance_review",
  asaas_balance: "finance_read",
  asaas_refund_create: "finance_execute",
  asaas_transfer_create: "finance_execute"
};
function assertPermission(admin: any, action: string) {
  const permission = requiredPermission[action];
  if (!permission || asObj(admin.permissions)[permission] !== true) {
    throw Object.assign(new Error("Sua conta não possui permissão para esta ação administrativa."), { status: 403 });
  }
}
async function audit(db: any, user: any, action: string, targetTable?: string, targetId?: string, details: Record<string, unknown> = {}, requestId?: string) {
  try {
    await db.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_email: norm(user.email),
      action: clean(action, 100),
      target_table: targetTable ? clean(targetTable, 100) : null,
      target_id: targetId ? clean(targetId, 150) : null,
      request_id: requestId ? clean(requestId, 100) : null,
      details
    });
  } catch (e) { console.warn("admin audit insert failed", e); }
}
async function listAuthUsers(db: any) {
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error("Não foi possível consultar os usuários autenticados.");
  return arr(data?.users);
}
async function profilesMap(db: any) {
  const { data, error } = await db.from("profiles")
    .select("id,full_name,role,created_at,category,profile_data")
    .limit(10000);
  if (error) throw new Error("Não foi possível consultar os perfis.");
  return new Map(arr(data).map((p: any) => [String(p.id), p]));
}
function userLocation(p: any) { return profileLocation(p); }
function classifyCaseType(value: unknown) {
  const t = norm(value);
  if (t.includes("cancel")) return "cancellation";
  if (t.includes("refund") || t.includes("reembolso") || t.includes("estorno")) return "refund";
  if (t.includes("dispute") || t.includes("contest") || t.includes("chargeback")) return "dispute";
  return "other";
}
function normalizedCaseStatus(row: any) {
  const d = norm(row?.decision);
  if (["approve", "approved", "approve_analysis", "accept"].includes(d)) return "approved";
  if (["reject", "rejected", "deny"].includes(d)) return "rejected";
  return clean(row?.status || "open", 60);
}
function maskPix(r: any) {
  const type = clean(r?.pix_key_type || "PIX", 20);
  const last4 = clean(r?.pix_key_last4 || "", 4);
  return last4 ? type + " ••••" + last4 : type + " (dados protegidos)";
}

async function dashboard(db: any, period: string) {
  const since = periodStart(period);
  const [profilesQ, ordersQ, proposalsQ, checkoutsQ, eventsQ, payoutsQ, casesQ, reviewCasesQ, supportCasesQ, presenceQ, ledgerQ] = await Promise.all([
    db.from("profiles").select("id,role,created_at,profile_data").limit(10000),
    db.from("orders").select("id,client_id,title,category,status,service_state,created_at,paid_at,total,payment_status,payment_state,platform_fee,professional_net,professional_id,selected_proposal_id,cancellation_requested_at,refund_status,completed_at,service_started_at,region,region_approx,metadata").order("created_at", { ascending: false }).limit(10000),
    db.from("proposals").select("id,order_id,price,status,selected,created_at").limit(10000),
    db.from("fechou_asaas_checkouts").select("id,user_id,order_id,purpose,plan,amount,status,subscription_status,created_at,updated_at").limit(10000),
    (() => { let q = db.from("app_analytics_events").select("event_name,visitor_id,session_id,user_id,source,city,state,device,occurred_at").order("occurred_at", { ascending: false }).limit(10000); if (since) q = q.gte("occurred_at", since); return q; })(),
    db.from("fechou_wallet_payout_requests").select("id,status,amount,created_at").limit(5000),
    db.from("fechou_service_cases").select("id,case_type,status,decision,created_at").limit(5000),
    db.from("fechou_service_review_cases").select("id,case_type,status,decision,created_at").limit(5000),
    db.from("fechou_support_cases").select("id,case_type,status,decision,created_at").limit(5000),
    db.from("fechou_ops_presence").select("user_id,last_seen_at").gte("last_seen_at", new Date(Date.now() - 90000).toISOString()).limit(10000),
    db.from("fechou_wallet_ledger").select("entry_type,amount,status,created_at").limit(10000)
  ]);
  const namedQueries: [string,any][] = [["profiles",profilesQ],["orders",ordersQ],["proposals",proposalsQ],["fechou_asaas_checkouts",checkoutsQ],["app_analytics_events",eventsQ],["fechou_wallet_payout_requests",payoutsQ],["fechou_service_cases",casesQ],["fechou_service_review_cases",reviewCasesQ],["fechou_support_cases",supportCasesQ],["fechou_ops_presence",presenceQ],["fechou_wallet_ledger",ledgerQ]];
  const failed = namedQueries.filter(([,q]) => q?.error).map(([name,q]) => ({table:name,code:q.error.code||null,message:clean(q.error.message||"query failed",300),details:clean(q.error.details||"",200),hint:clean(q.error.hint||"",200)}));
  if (failed.length) {
    console.error("admin-api dashboard query failures", JSON.stringify(failed));
    throw Object.assign(new Error("Dashboard query failure: "+failed.map(x=>x.table+" ["+(x.code||"no-code")+"] "+x.message).join(" | ")),{status:500});
  }
  const profiles = arr(profilesQ.data), orders = arr(ordersQ.data), proposals = arr(proposalsQ.data);
  const operationalOrders = orders.filter((x: any) => { const m = asObj(x.metadata); return !(m.temporary_test_price === true || norm(m.temporary_test_price) === "true" || m.test_order === true || norm(m.test_mode) === "true"); });
  const checkouts = arr(checkoutsQ.data).filter((c: any) => norm(c.purpose) === "subscription");
  const events = arr(eventsQ.data), payoutRows = arr(payoutsQ.data), caseRows = [...arr(casesQ.data),...arr(reviewCasesQ.data),...arr(supportCasesQ.data)];
  const byOrder = new Map<string, number>();
  for (const pr of proposals) byOrder.set(String(pr.order_id), (byOrder.get(String(pr.order_id)) || 0) + 1);
  const inPeriod = (x: any, field = "created_at") => !since || String(x?.[field] || "") >= since;
  const periodProfiles = profiles.filter((x: any) => inPeriod(x));
  const periodOrders = operationalOrders.filter((x: any) => inPeriod(x));
  const paidOrders = operationalOrders.filter((x: any) => isPaid(x) && inPeriod(x, x.paid_at ? "paid_at" : "created_at"));
  const paidSubscriptions = checkouts.filter((x: any) => isConfirmedCheckout(x) && inPeriod(x, x.updated_at ? "updated_at" : "created_at"));
  const payers = new Set<string>();
  for (const o of paidOrders) if (o.client_id) payers.add(String(o.client_id));
  for (const c of paidSubscriptions) if (c.user_id) payers.add(String(c.user_id));
  const pageEvents = events.filter((x: any) => ["page_view","app_page_view"].includes(norm(x.event_name)));
  const visitors = new Set(pageEvents.map((x: any) => x.visitor_id).filter(Boolean)).size;
  const sessions = new Set(pageEvents.map((x: any) => x.session_id).filter(Boolean)).size;
  const activeUsers = new Set(arr(presenceQ.data).map((x: any) => String(x.user_id))).size;
  const ordersByStage = { waiting_quote: 0, quoted: 0, accepted: 0, in_progress: 0, completed: 0, cancelled: 0 };
  for (const o of operationalOrders) ordersByStage[orderStage(o, byOrder.get(String(o.id)) || 0) as keyof typeof ordersByStage]++;
  const pendingCases = caseRows.filter((x: any) => isPending(x));
  const cancellationsPending = operationalOrders.filter((o: any) => o.cancellation_requested_at && !["cancelled","completed"].includes(orderStage(o, byOrder.get(String(o.id)) || 0))).length;
  const disputesPending = pendingCases.filter((x: any) => classifyCaseType(x.case_type) === "dispute").length;
  const refundsPending = pendingCases.filter((x: any) => classifyCaseType(x.case_type) === "refund").length +
    operationalOrders.filter((x: any) => ["pending","requested","processing","refund_pending"].includes(norm(x.refund_status))).length;
  const subscriptionsActive = checkouts.filter(isActiveSubscription).length;
  const subscriptionsNew = checkouts.filter((x: any) => inPeriod(x)).length;
  const subscriptionsCancelled = checkouts.filter((x: any) => norm(x.subscription_status).includes("cancel") || norm(x.status).includes("cancel")).length;
  const totalRevenue = sum(paidOrders, "total") + sum(paidSubscriptions, "amount");
  const confirmedPayments = paidOrders.length + paidSubscriptions.length;
  const averageTicket = confirmedPayments ? totalRevenue / confirmedPayments : 0;
  const serviceStatus = Object.entries(ordersByStage).map(([key,value]) => ({ label: stageLabel[key], value }));
  const channelCounts = new Map<string,number>();
  for (const e of events.filter((x: any) => ["signup","signup_confirmed","login"].includes(norm(x.event_name)))) {
    const k = clean(e.source || "Direto", 60) || "Direto";
    channelCounts.set(k, (channelCounts.get(k) || 0) + 1);
  }
  const statesMap = new Map<string,number>();
  for (const p of profiles) { const loc = profileLocation(p); const key = [loc.city,loc.state].filter(Boolean).join(" / "); if (key) statesMap.set(key,(statesMap.get(key)||0)+1); }
  const pendingPayouts = payoutRows.filter((x: any) => ["requested_review","under_review","transfer_pending"].includes(norm(x.status))).length;
  const summary = {
    visitors_total: visitors,
    signups_total: periodProfiles.length,
    paying_users: payers.size,
    payments_confirmed: confirmedPayments,
    revenue_total: Number(totalRevenue.toFixed(2)),
    payer_conversion_rate: periodProfiles.length ? Number((payers.size / periodProfiles.length * 100).toFixed(1)) : 0,
    average_ticket: Number(averageTicket.toFixed(2)),
    active_users: activeUsers,
    orders_waiting_quote: ordersByStage.waiting_quote,
    orders_with_quotes: ordersByStage.quoted,
    orders_in_progress: ordersByStage.in_progress,
    orders_completed: ordersByStage.completed,
    cancellations_pending: cancellationsPending,
    disputes_pending: disputesPending,
    refunds_pending: refundsPending,
    payouts_pending: pendingPayouts,
    subscriptions_active: subscriptionsActive,
    subscriptions_new: subscriptionsNew,
    subscriptions_cancelled: subscriptionsCancelled,
    service_status: serviceStatus,
    acquisition_channels: [...channelCounts.entries()].map(([label,value]) => ({label,value})).sort((a,b)=>b.value-a.value),
    states: [...statesMap.entries()].map(([label,value]) => ({label,value})).sort((a,b)=>b.value-a.value).slice(0,10),
    visitors_sessions: sessions,
    generated_at: new Date().toISOString()
  };
  const daily = new Map<string,number>();
  const fillStart = since ? new Date(since) : new Date(Date.now() - 29 * 86400000);
  const days = Math.min(366, Math.max(1, Math.ceil((Date.now()-fillStart.getTime())/86400000)));
  for (let i=days-1;i>=0;i--) {
    const d = new Date(Date.now()-i*86400000).toISOString().slice(0,10);
    daily.set(d,0);
  }
  for (const o of paidOrders) {
    const d = String(o.paid_at || o.created_at || "").slice(0,10);
    if (daily.has(d)) daily.set(d,(daily.get(d)||0)+money(o.total));
  }
  for (const c of paidSubscriptions) {
    const d = String(c.updated_at || c.created_at || "").slice(0,10);
    if (daily.has(d)) daily.set(d,(daily.get(d)||0)+money(c.amount));
  }
  const revenue = [...daily.entries()].map(([date,value]) => ({ date, label: dateLabel(date), value: Number(value.toFixed(2)) }));
  const regions = summary.states.map((x: any) => ({ region: x.label, city: x.label.split(" / ")[0] || x.label, state: x.label.split(" / ")[1] || "", orders: orders.filter((o: any) => norm(o.region_approx || o.region).includes(norm(x.label))).length, users: x.value, total: x.value }));
  return { summary, revenue, regions };
}

async function usersList(db: any, params: any) {
  const [profiles, authUsers, presence] = await Promise.all([
    profilesMap(db), listAuthUsers(db),
    db.from("fechou_ops_presence").select("user_id,last_seen_at").order("last_seen_at", { ascending: false }).limit(10000)
  ]);
  if (presence.error) throw new Error("Não foi possível consultar a atividade recente.");
  const authMap = new Map(authUsers.map((u: any) => [String(u.id),u]));
  const lastSeen = new Map<string,string>();
  for (const row of arr(presence.data)) if (!lastSeen.has(String(row.user_id))) lastSeen.set(String(row.user_id),String(row.last_seen_at));
  let items = [...profiles.values()].map((p: any) => {
    const auth = authMap.get(String(p.id)) || {};
    const loc = userLocation(p);
    return { id:p.id,name:p.full_name,full_name:p.full_name,email:auth.email || "",role:p.role,city:loc.city,state:loc.state,created_at:p.created_at,last_sign_in_at:auth.last_sign_in_at || null,last_seen_at:lastSeen.get(String(p.id)) || null,status:auth.banned_until ? "Bloqueado" : (auth.deleted_at ? "Excluído" : "Ativo"),active:!auth.banned_until && !auth.deleted_at,category:p.category || null };
  });
  const role = norm(params.role), search = norm(params.search);
  if (role) items = items.filter((x: any) => role === "professional" ? /professional|profissional|pro/.test(norm(x.role)) : /client|cliente/.test(norm(x.role)));
  if (search) items = items.filter((x: any) => [x.name,x.full_name,x.email,x.city,x.state].some(v => norm(v).includes(search)));
  items.sort((a: any,b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  return { items:items.slice(0,100), total:items.length, page:1, page_size:100, has_more:items.length>100 };
}

async function ordersList(db: any, params: any) {
  const [ordersQ, proposalsQ, profiles, authUsers] = await Promise.all([
    db.from("orders").select("id,client_id,title,description,category,status,service_state,created_at,total,professional_id,selected_proposal_id,service_started_at,completed_at,payment_status,payment_state").order("created_at",{ascending:false}).limit(MAX_ROWS),
    db.from("proposals").select("id,order_id,professional_id,price,status,selected,created_at").limit(10000),
    profilesMap(db), listAuthUsers(db)
  ]);
  if (ordersQ.error || proposalsQ.error) throw new Error("Não foi possível consultar os serviços e orçamentos.");
  const authMap = new Map(authUsers.map((u: any) => [String(u.id),u]));
  const proposalCounts = new Map<string,number>();
  for (const p of arr(proposalsQ.data)) proposalCounts.set(String(p.order_id),(proposalCounts.get(String(p.order_id))||0)+1);
  let items = arr(ordersQ.data).map((o: any) => {
    const stage = orderStage(o,proposalCounts.get(String(o.id))||0);
    const client = profiles.get(String(o.client_id));
    const pro = profiles.get(String(o.professional_id));
    const clientAuth = authMap.get(String(o.client_id)) || {};
    const proAuth = authMap.get(String(o.professional_id)) || {};
    return {
      id:o.id,code:String(o.id).slice(0,8).toUpperCase(),title:o.title,service_title:o.title || o.category,
      category:o.category,client_name:client?.full_name || "",client_email:clientAuth.email || "",
      professional_name:pro?.full_name || "",professional_email:proAuth.email || "",
      proposals_count:proposalCounts.get(String(o.id))||0,agreed_amount:o.total,total_amount:o.total,
      status:stage,status_label:stageLabel[stage],created_at:o.created_at,
      payment_status:o.payment_status || o.payment_state
    };
  });
  const search = norm(params.search), status = norm(params.status);
  if (search) items = items.filter((x: any) => [x.id,x.code,x.title,x.category,x.client_name,x.client_email,x.professional_name,x.professional_email].some(v=>norm(v).includes(search)));
  if (status) items = items.filter((x: any) => x.status===status);
  return { items:items.slice(0,100),total:items.length,page:1,page_size:100,has_more:items.length>100 };
}

async function subscriptionsList(db: any, params: any) {
  const [q, authUsers, profiles] = await Promise.all([
    db.from("fechou_asaas_checkouts").select("id,user_id,plan,amount,status,subscription_status,created_at,updated_at,asaas_subscription_id").eq("purpose","subscription").order("created_at",{ascending:false}).limit(MAX_ROWS),
    listAuthUsers(db),profilesMap(db)
  ]);
  if (q.error) throw new Error("Não foi possível consultar as assinaturas.");
  const authMap = new Map(authUsers.map((u: any)=>[String(u.id),u]));
  let items = arr(q.data).map((x: any)=>{
    const p=profiles.get(String(x.user_id));const u=authMap.get(String(x.user_id))||{};
    return {id:x.id,user_id:x.user_id,user_name:p?.full_name||"",professional_name:p?.full_name||"",email:u.email||"",plan:x.plan,plan_name:x.plan,amount:x.amount,value:x.amount,created_at:x.created_at,started_at:x.created_at,next_due_at:null,status:x.subscription_status||x.status,payment_status:x.status,asaas_subscription_id:x.asaas_subscription_id||null};
  });
  const search=norm(params.search),status=norm(params.status);
  if(search)items=items.filter((x:any)=>[x.user_name,x.email,x.plan].some(v=>norm(v).includes(search)));
  if(status)items=items.filter((x:any)=>norm(x.status).includes(status));
  return {items:items.slice(0,100),total:items.length};
}

async function casesList(db: any, params: any) {
  // V29 (painel): além das três filas de casos, inclui pedidos com cancelamento/motivo registrado
  // diretamente em orders (cancelamentos sem caso aberto) e enriquece contestações com fotos e respostas.
  const [a,b,c,ordersQ,profiles,authUsers,repliesQ] = await Promise.all([
    db.from("fechou_service_cases").select("id,order_id,opened_by,case_type,status,reason,decision,decision_reason,created_at,metadata").order("created_at",{ascending:false}).limit(200),
    db.from("fechou_service_review_cases").select("id,order_id,opened_by,case_type,status,reason,decision,decision_reason,created_at").order("created_at",{ascending:false}).limit(200),
    db.from("fechou_support_cases").select("id,order_id,opened_by,case_type,status,reason,decision,created_at,metadata").order("created_at",{ascending:false}).limit(200),
    db.from("orders").select("id,title,total,client_id,professional_id,status,service_state,refund_status,cancellation_requested_at,cancel_reason,updated_at").limit(10000),
    profilesMap(db),listAuthUsers(db),
    db.from("fechou_contest_replies").select("*").limit(500)
  ]);
  if(a.error||b.error||c.error||ordersQ.error) throw new Error("Não foi possível consultar as ocorrências.");
  const orderMap=new Map(arr(ordersQ.data).map((x:any)=>[String(x.id),x]));
  const authMap=new Map(authUsers.map((u:any)=>[String(u.id),u]));
  const repliesByOrder=new Map<string,any[]>();
  if(!repliesQ?.error){for(const r of arr(repliesQ?.data)){const k=String(r.order_id||"");if(!k)continue;if(!repliesByOrder.has(k))repliesByOrder.set(k,[]);repliesByOrder.get(k)!.push(r);}}
  const normalize=(row:any,source:string)=>{
    const o:any=orderMap.get(String(row.order_id))||{};
    const requester=profiles.get(String(row.opened_by));
    const user=authMap.get(String(row.opened_by))||{};
    const meta=asObj(row.metadata);
    const t=classifyCaseType(row.case_type);
    const photos=Array.isArray(meta.photos)?meta.photos.length:0;
    const replies=(repliesByOrder.get(String(row.order_id))||[]).sort((x:any,y:any)=>String(y.created_at).localeCompare(String(x.created_at)));
    const lastReply=replies[0]||null;
    return {id:row.id,source_table:source,order_id:row.order_id,order_code:String(row.order_id||"").slice(0,8).toUpperCase(),order_title:o.title||"",type:t,case_type:row.case_type,requester_name:requester?.full_name||"",requester_email:user.email||"",reason:row.reason||"",amount:meta.amount??o.total??null,created_at:row.created_at,status:normalizedCaseStatus(row),decision:row.decision||null,decision_reason:row.decision_reason||null,description:row.reason||"",photos_count:photos,replies_count:replies.length,last_reply:lastReply?clean(lastReply.message||lastReply.reply||lastReply.text||lastReply.body||"",500):null,actionable:true};
  };
  let items=[...arr(a.data).map((x:any)=>normalize(x,"fechou_service_cases")),...arr(b.data).map((x:any)=>normalize(x,"fechou_service_review_cases")),...arr(c.data).map((x:any)=>normalize(x,"fechou_support_cases"))];
  const ordersWithCancelCase=new Set(items.filter((x:any)=>x.type==="cancellation").map((x:any)=>String(x.order_id)));
  for(const o of arr(ordersQ.data)){
    if(!(o.cancellation_requested_at||o.cancel_reason))continue;
    if(ordersWithCancelCase.has(String(o.id)))continue;
    const requester=profiles.get(String(o.client_id));
    const user=authMap.get(String(o.client_id))||{};
    const st=norm(o.service_state);
    const status=st==="support_review"||norm(o.refund_status)==="review_required"?"in_review":(st.startsWith("cancel")||norm(o.status).startsWith("cancel")?"cancelled":"open");
    items.push({id:"order:"+o.id,source_table:"orders",order_id:o.id,order_code:String(o.id).slice(0,8).toUpperCase(),order_title:o.title||"",type:"cancellation",case_type:"order_cancellation",requester_name:requester?.full_name||"",requester_email:user.email||"",reason:o.cancel_reason||"",amount:o.total??null,created_at:o.cancellation_requested_at||o.updated_at,status,decision:null,decision_reason:null,description:o.cancel_reason||"",refund_status:o.refund_status||null,photos_count:0,replies_count:0,last_reply:null,actionable:false});
  }
  const type=norm(params.type),status=norm(params.status),search=norm(params.search);
  if(type)items=items.filter((x:any)=>x.type===type);
  if(status && status!=="all"){
    if(status==="pending")items=items.filter((x:any)=>["open","in_review","pending","requested_review","under_review"].includes(norm(x.status)));
    else if(status==="approved")items=items.filter((x:any)=>norm(x.status)==="approved");
    else if(status==="rejected")items=items.filter((x:any)=>norm(x.status)==="rejected");
    else items=items.filter((x:any)=>norm(x.status).includes(status));
  }
  if(search)items=items.filter((x:any)=>[x.order_id,x.order_code,x.order_title,x.requester_name,x.requester_email,x.reason].some(v=>norm(v).includes(search)));
  items.sort((x:any,y:any)=>String(y.created_at).localeCompare(String(x.created_at)));
  return {items:items.slice(0,100),total:items.length};
}

async function activityList(db:any,params:any) {
  let q=db.from("app_analytics_events").select("id,event_name,user_id,city,state,source,path,device,occurred_at,visitor_id,session_id").order("occurred_at",{ascending:false}).limit(500);
  const since=periodStart(params.period);if(since)q=q.gte("occurred_at",since);
  if(params.type)q=q.eq("event_name",clean(params.type,100));
  const [res,users]=await Promise.all([q,listAuthUsers(db)]);
  if(res.error)throw new Error("Não foi possível consultar os acessos e eventos.");
  const userMap=new Map(users.map((u:any)=>[String(u.id),u]));
  let items=arr(res.data).map((x:any)=>({id:x.id,event_name:x.event_name,user_id:x.user_id,user_email:userMap.get(String(x.user_id))?.email||"",city:x.city||"",state:x.state||"",source:x.source||"",path:x.path||"",device:x.device||"",created_at:x.occurred_at,occurred_at:x.occurred_at}));
  const search=norm(params.search);if(search)items=items.filter((x:any)=>[x.user_email,x.event_name,x.city,x.state,x.source,x.path].some(v=>norm(v).includes(search)));
  return {items:items.slice(0,200),total:items.length};
}

async function paymentsList(db:any,params:any) {
  const since=periodStart(params.period);
  let cq=db.from("fechou_asaas_checkouts")
    .select("id,checkout_id,external_reference,purpose,user_id,order_id,plan,amount,status,subscription_status,provider_payload,created_at")
    .order("created_at",{ascending:false}).limit(500);
  let lq=db.from("payments")
    .select("id,order_id,client_id,professional_id,provider,provider_payment_id,amount,currency,status,provider_status,created_at")
    .order("created_at",{ascending:false}).limit(500);
  if(since){cq=cq.gte("created_at",since);lq=lq.gte("created_at",since);}
  const [checkouts,legacy]=await Promise.all([cq,lq]);
  if(checkouts.error)throw new Error("Não foi possível consultar os checkouts registrados no Asaas: "+checkouts.error.message);
  if(legacy.error)throw new Error("Não foi possível consultar os pagamentos legados: "+legacy.error.message);
  const items:any[]=[];
  const providerIds=new Set<string>();
  for(const x of arr(checkouts.data)){
    const paymentId=clean(x.checkout_id||"",160);
    if(paymentId)providerIds.add(paymentId);
    const payload=asObj(x.provider_payload);
    const payment=asObj(payload.payment);
    items.push({
      id:x.id,type:x.purpose==="subscription"?"Assinatura":(x.purpose==="prepublication"?"Pagamento de serviço":"Pagamento"),
      direction:"entrada",reference:paymentId||x.external_reference||x.order_id,order_id:x.order_id||null,
      asaas_id:paymentId||null,value:x.amount,amount:x.amount,
      status:x.status,provider_status:payment.status||payload.payment_status||x.subscription_status||x.status,
      created_at:x.created_at,provider:"asaas",currency:"BRL",purpose:x.purpose,plan:x.plan||null
    });
  }
  for(const x of arr(legacy.data)){
    const paymentId=clean(x.provider_payment_id||"",160);
    if(paymentId&&providerIds.has(paymentId))continue;
    items.push({id:x.id,type:x.provider||"Pagamento",direction:"entrada",reference:paymentId||x.order_id,order_id:x.order_id,asaas_id:paymentId||null,value:x.amount,amount:x.amount,status:x.status||x.provider_status,provider_status:x.provider_status||x.status,created_at:x.created_at,provider:x.provider,currency:x.currency});
  }
  const ledgerQuery=await db.from("fechou_wallet_ledger")
    .select("id,order_id,amount,status,provider,provider_reference,created_at")
    .eq("entry_type","service_payment").order("created_at",{ascending:false}).limit(500);
  if(ledgerQuery.error)throw new Error("Não foi possível conciliar os lançamentos de pagamentos na carteira: "+ledgerQuery.error.message);
  const coveredOrders=new Set(items.map((x:any)=>String(x.order_id||"")).filter(Boolean));
  for(const x of arr(ledgerQuery.data)){
    const orderId=String(x.order_id||"");
    const ref=clean(x.provider_reference||"",160);
    if((orderId&&coveredOrders.has(orderId))||(ref&&providerIds.has(ref)))continue;
    if(since&&String(x.created_at)<since)continue;
    items.push({id:x.id,type:"Pagamento de serviço",direction:"entrada",reference:ref||orderId,order_id:orderId||null,asaas_id:ref||null,value:x.amount,amount:x.amount,status:x.status,provider_status:x.status,created_at:x.created_at,provider:x.provider||"asaas",currency:"BRL"});
  }
  items.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const verify=items.filter((x:any)=>x.provider==="asaas"&&/^pay_[A-Za-z0-9]+$/.test(String(x.asaas_id||""))).slice(0,100);
  for(const item of verify){
    try{
      const provider=await asaasRequest("/payments/"+encodeURIComponent(item.asaas_id));
      item.fechou_status=item.status;
      item.provider_status=clean(provider.status||item.provider_status,60);
      item.provider_refunds_count=Array.isArray(provider.refunds)?provider.refunds.length:0;
      item.provider_refunded=String(provider.status||"").toUpperCase()==="REFUNDED"||item.provider_refunds_count>0;
      item.provider_confirmed=["RECEIVED","CONFIRMED","RECEIVED_IN_CASH"].includes(String(provider.status||"").toUpperCase());
      item.status=item.provider_refunded?"REFUNDED":item.provider_status;
      item.notes="FECHOU: "+String(item.fechou_status||"—")+" | Asaas: "+String(item.provider_status||"—")+" | Estornos: "+String(item.provider_refunds_count);
      if(item.purpose&&item.id){
        const {error:reconcileError}=await db.from("fechou_asaas_checkouts").update({
          provider_payload:{...asObj(item.provider_payload),provider_reconciliation:{
            status:item.provider_status,refunds_count:item.provider_refunds_count,refunded:item.provider_refunded,
            confirmed:item.provider_confirmed,checked_at:new Date().toISOString()
          }},
          ...(item.provider_refunded?{status:"refunded"}:{}),
          updated_at:new Date().toISOString()
        }).eq("id",item.id);
        if(reconcileError)throw new Error("Não foi possível registrar a conciliação do Asaas para o pagamento "+String(item.asaas_id||"")+": "+reconcileError.message);
      }
    }catch(error){
      item.provider_lookup_error=clean((error as Error)?.message||error,220);
    }
  }
  return {items:items.slice(0,500),total:items.length,source:"fechou_asaas_checkouts+fechou_wallet_ledger+payments",provider_verified:verify.length};
}

async function reconcilePendingPayoutTransfers(db:any, payoutRows:any[]) {
  if(!ASAAS_API_KEY) return;
  const ids=arr(payoutRows).filter((x:any)=>norm(x.status)==="transfer_pending").map((x:any)=>String(x.id));
  if(!ids.length)return;
  const {data:attempts,error}=await db.from("fechou_wallet_asaas_transfers")
    .select("id,payout_request_id,user_id,order_id,asaas_transfer_id,amount,status")
    .in("payout_request_id",ids).in("status",["pending","in_bank_processing"]).not("asaas_transfer_id","is",null).limit(100);
  if(error)throw new Error("Falha ao consultar transferências pendentes para conciliação: "+error.message);
  for(const attempt of arr(attempts)){
    try{
      const transfer=await asaasRequest("/transfers/"+encodeURIComponent(String(attempt.asaas_transfer_id)));
      const providerStatus=clean(transfer.status||"",40).toUpperCase();
      const statusMap:Record<string,string>={PENDING:"pending",SCHEDULED:"pending",BANK_PROCESSING:"in_bank_processing",IN_BANK_PROCESSING:"in_bank_processing",DONE:"done",FAILED:"failed",CANCELLED:"cancelled",CANCELED:"cancelled",BLOCKED:"blocked"};
      const mapped=statusMap[providerStatus];
      if(!mapped)continue;
      if(Math.round(Number(transfer.value||0)*100)!==Math.round(Number(attempt.amount||0)*100)) {
        console.error("FECHOU payout reconciliation blocked: Asaas amount mismatch",{transfer_id:attempt.asaas_transfer_id});
        continue;
      }
      const now=new Date().toISOString();
      const receipt=clean(transfer.transactionReceiptUrl||"",1500);
      let receiptUrl="";
      try{const u=new URL(receipt);if(u.protocol==="https:")receiptUrl=u.toString();}catch{}
      const {error:updateError}=await db.from("fechou_wallet_asaas_transfers").update({
        status:mapped,provider_status:providerStatus,fail_reason:clean(transfer.failReason||"",1400)||null,
        transaction_receipt_url:receiptUrl||null,effective_at:transfer.effectiveDate?new Date(transfer.effectiveDate).toISOString():null,updated_at:now
      }).eq("id",attempt.id);
      if(updateError)throw new Error("Falha ao atualizar tentativa: "+updateError.message);
      if(mapped==="done"){
        const {data:request,error:reqError}=await db.from("fechou_wallet_payout_requests").select("id,user_id,order_id").eq("id",attempt.payout_request_id).maybeSingle();
        if(reqError||!request)throw new Error("Solicitação vinculada não encontrada: "+(reqError?.message||""));
        const {data:ledger,error:ledgerReadError}=await db.from("fechou_wallet_ledger").select("status").eq("user_id",request.user_id).eq("order_id",request.order_id).eq("entry_type","payout").maybeSingle();
        if(ledgerReadError||!ledger)throw new Error("Lançamento de carteira não encontrado: "+(ledgerReadError?.message||""));
        if(String(ledger.status)==="release_ready"){
          const {error:ledgerUpdateError}=await db.from("fechou_wallet_ledger").update({status:"paid",description:"Pix transferido pelo Asaas (ID "+attempt.asaas_transfer_id+").",updated_at:now}).eq("user_id",request.user_id).eq("order_id",request.order_id).eq("entry_type","payout").eq("status","release_ready");
          if(ledgerUpdateError)throw new Error("Falha ao confirmar carteira: "+ledgerUpdateError.message);
        }else if(String(ledger.status)!=="paid")throw new Error("Estado inesperado do lançamento: "+ledger.status);
        const {error:reqUpdateError}=await db.from("fechou_wallet_payout_requests").update({status:"paid",review_reason:"Transferência confirmada pela consulta direta do status DONE no Asaas.",updated_at:now}).eq("id",request.id).neq("status","paid");
        if(reqUpdateError)throw new Error("Falha ao concluir solicitação: "+reqUpdateError.message);
        const {error:orderError}=await db.from("orders").update({payout_status:"paid",payout_id:attempt.asaas_transfer_id,payout_transfer_id:attempt.asaas_transfer_id,released_at:now,payout_error:null,updated_at:now}).eq("id",request.order_id);
        if(orderError)throw new Error("Falha ao atualizar pedido: "+orderError.message);
      }else if(["failed","cancelled","blocked"].includes(mapped)){
        const {error:reqUpdateError}=await db.from("fechou_wallet_payout_requests").update({status:"under_review",review_reason:clean(transfer.failReason||("Asaas informou "+providerStatus+" na conciliação."),1000),updated_at:now}).eq("id",attempt.payout_request_id).neq("status","paid");
        if(reqUpdateError)throw new Error("Falha ao devolver solicitação para análise: "+reqUpdateError.message);
      }
      console.info("FECHOU payout reconciled from Asaas transfer GET",{transfer_id:attempt.asaas_transfer_id,status:providerStatus});
    }catch(e){console.error("FECHOU payout reconciliation failed",{transfer_id:attempt.asaas_transfer_id,error:clean((e as Error)?.message||e,500)});}
  }
}

async function payoutsList(db:any,params:any) {
  let q=db.from("fechou_wallet_payout_requests").select("id,user_id,order_id,amount,status,pix_key_type,pix_key_last4,review_reason,created_at,updated_at").order("created_at",{ascending:false}).limit(500);
  if(norm(params.status)==="pending")q=q.in("status",["requested_review","under_review","transfer_pending"]);
  const [res,profiles,users]=await Promise.all([q,profilesMap(db),listAuthUsers(db)]);
  if(res.error)throw new Error("Não foi possível consultar as solicitações de saque.");
  await reconcilePendingPayoutTransfers(db,arr(res.data));
  const {data:refreshed,error:refreshError}=await db.from("fechou_wallet_payout_requests")
    .select("id,user_id,order_id,amount,status,pix_key_type,pix_key_last4,review_reason,created_at,updated_at")
    .order("created_at",{ascending:false}).limit(500);
  if(refreshError)throw new Error("Não foi possível atualizar a fila após a conciliação dos saques.");
  const userMap=new Map(users.map((u:any)=>[String(u.id),u]));
  let items=arr(refreshed||res.data).map((x:any)=>{
    const p=profiles.get(String(x.user_id));const u=userMap.get(String(x.user_id))||{};
    const displayStatus = ["requested_review","under_review"].includes(norm(x.status)) ? "Pendente" : (norm(x.status)==="transfer_pending" ? "Em processamento" : x.status);
    return {id:x.id,user_id:x.user_id,professional_name:p?.full_name||"",user_name:p?.full_name||"",professional_email:u.email||"",order_id:x.order_id,order_code:String(x.order_id).slice(0,8).toUpperCase(),amount:x.amount,value:x.amount,pix_key:maskPix(x),status:displayStatus,raw_status:x.status,created_at:x.created_at,review_reason:x.review_reason};
  });
  if(params.period){const since=periodStart(params.period);if(since)items=items.filter((x:any)=>String(x.created_at)>=since);}
  return {items:items.slice(0,200),total:items.length};
}

async function transactionsList(db:any,params:any) {
  const since=periodStart(params.period);
  let q=db.from("fechou_wallet_ledger").select("id,user_id,order_id,entry_type,amount,status,provider,provider_reference,provider_ref,description,created_at").order("created_at",{ascending:false}).limit(400);
  if(since)q=q.gte("created_at",since);
  const [ledger,transfers,manualTransfers,profiles,users]=await Promise.all([
    q,
    db.from("fechou_wallet_asaas_transfers").select("id,payout_request_id,user_id,order_id,asaas_transfer_id,amount,pix_key_type,pix_key_last4,status,provider_status,transaction_receipt_url,created_at,effective_at").order("created_at",{ascending:false}).limit(200),
    db.from("fechou_admin_manual_transfers").select("id,amount,pix_key_type,status,provider_status,asaas_transfer_id,description,created_at,updated_at").order("created_at",{ascending:false}).limit(100),
    profilesMap(db),listAuthUsers(db)
  ]);
  if(ledger.error||transfers.error||manualTransfers.error)throw new Error("Não foi possível consultar as movimentações financeiras.");
  for(const x of arr(manualTransfers.data)) {
    if(!x.asaas_transfer_id||!["pending","in_bank_processing","unknown","initiating"].includes(norm(x.status)))continue;
    try {
      const provider=await asaasRequest("/transfers/"+encodeURIComponent(x.asaas_transfer_id));
      const ps=clean(provider.status||x.provider_status||"UNKNOWN",40).toUpperCase();
      const mapped=ps==="DONE"?"done":["BANK_PROCESSING","IN_BANK_PROCESSING"].includes(ps)?"in_bank_processing":["FAILED","CANCELLED","BLOCKED"].includes(ps)?"failed":"pending";
      await db.from("fechou_admin_manual_transfers").update({
        status:mapped,provider_status:ps,fail_reason:["FAILED","CANCELLED","BLOCKED"].includes(ps)?clean(provider.failReason||provider.description||ps,400):null,
        updated_at:new Date().toISOString()
      }).eq("id",x.id);
      x.status=mapped;x.provider_status=ps;
    } catch(e) { console.warn("manual transfer reconciliation deferred",clean((e as Error)?.message||e,180)); }
  }
  const userMap=new Map(users.map((u:any)=>[String(u.id),u]));
  const items:any[]=[];
  for(const x of arr(ledger.data)){
    const p=profiles.get(String(x.user_id));
    items.push({id:x.id,type:x.entry_type,direction:x.entry_type,reference:x.provider_reference||x.provider_ref||x.order_id||x.id,order_id:x.order_id,value:x.amount,amount:x.amount,status:x.status,counterparty_name:p?.full_name||"",created_at:x.created_at,provider:x.provider,asaas_id:x.provider_reference||x.provider_ref||null});
  }
  for(const x of arr(transfers.data)){
    items.push({id:x.id,type:"Transferência Pix",direction:"saída",reference:x.asaas_transfer_id||x.payout_request_id,order_id:x.order_id,asaas_id:x.asaas_transfer_id,value:x.amount,amount:x.amount,status:x.provider_status||x.status,counterparty_name:userMap.get(String(x.user_id))?.email||"",pix_key:maskPix(x),receipt_url:x.transaction_receipt_url||null,created_at:x.effective_at||x.created_at});
  }
  for(const x of arr(manualTransfers.data)){
    items.push({id:x.id,type:"Transferência administrativa Pix",direction:"saída",reference:x.asaas_transfer_id||x.id,asaas_id:x.asaas_transfer_id,value:x.amount,amount:x.amount,status:x.provider_status||x.status,counterparty_name:"Favorecido autorizado",created_at:x.created_at});
  }
  items.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  return {items:items.slice(0,300),total:items.length};
}

async function geoDemand(db:any,params:any) {
  const since=periodStart(params.period);
  let oq=db.from("orders").select("region,region_approx,created_at").limit(10000);
  let pq=db.from("profiles").select("id,profile_data,created_at").limit(10000);
  if(since){oq=oq.gte("created_at",since);pq=pq.gte("created_at",since);}
  const [orders,profiles]=await Promise.all([oq,pq]);
  if(orders.error||profiles.error)throw new Error("Não foi possível consultar a demanda regional.");
  const map=new Map<string,{region:string,city:string,state:string,orders:number,users:number,total:number}>();
  const ensure=(label:string,city:string,state:string)=>{if(!map.has(label))map.set(label,{region:label,city,state,orders:0,users:0,total:0});return map.get(label)!;};
  for(const p of arr(profiles.data)){const loc=profileLocation(p);if(!loc.city&&!loc.state)continue;const label=[loc.city,loc.state].filter(Boolean).join(" / ");ensure(label,loc.city,loc.state).users++;}
  for(const o of arr(orders.data)){const raw=clean(o.region_approx||o.region,120);if(!raw)continue;const parts=raw.split(/[\/,-]/).map((v:string)=>v.trim()).filter(Boolean);const city=parts[0]||raw,state=parts[1]||"";ensure(raw,city,state).orders++;}
  const items=[...map.values()].map(x=>({...x,total:x.orders+x.users})).sort((a,b)=>b.total-a.total);
  const limit=Math.min(20,Math.max(1,Number(params.limit)||8));
  return {items:items.slice(0,limit),total:items.length};
}

async function decideCase(db:any,user:any,params:any,requestId:string) {
  const id=clean(params.case_id,80),decision=norm(params.decision),reason=clean(params.reason,1000);
  if(!id || !["approve","reject"].includes(decision))throw Object.assign(new Error("Dados da decisão inválidos."),{status:400});
  const tables=["fechou_service_cases","fechou_service_review_cases","fechou_support_cases"];
  for(const table of tables){
    const {data:existing,error:readError}=await db.from(table).select("id,status,decision,metadata").eq("id",id).maybeSingle();
    if(readError && !/does not exist|schema cache/i.test(readError.message))throw new Error("Não foi possível localizar a ocorrência.");
    if(!existing)continue;
    if(!["open","in_review"].includes(norm(existing.status)))throw Object.assign(new Error("Esta ocorrência já foi analisada ou não está pendente."),{status:409});
    let update:any={status:"resolved",decision,updated_at:new Date().toISOString()};
    if(table==="fechou_service_cases"||table==="fechou_service_review_cases"){
      update.decision_reason=reason||null;
      update.decided_by=user.id;
      if(table==="fechou_service_cases")update.decided_at=new Date().toISOString();
    }else{
      update.decision_by=user.id;
      update.decision_at=new Date().toISOString();
      update.metadata={...asObj(existing.metadata),admin_decision_reason:reason||null};
    }
    const {data,error}=await db.from(table).update(update).eq("id",id).in("status",["open","in_review"]).select("id,status,decision").maybeSingle();
    if(error)throw new Error("Não foi possível gravar a decisão administrativa.");
    if(!data)throw Object.assign(new Error("A ocorrência mudou de status. Atualize a lista e tente novamente."),{status:409});
    await audit(db,user,"case_decide",table,id,{decision,reason_provided:!!reason},requestId);
    return {id,status:decision==="approve"?"approved":"rejected",decision,financial_action:"none"};
  }
  throw Object.assign(new Error("Ocorrência não encontrada nas filas administrativas."),{status:404});
}

async function payoutDecide(db:any,user:any,params:any,requestId:string) {
  const id=clean(params.payout_id,80),decision=norm(params.decision),reason=clean(params.reason,1000);
  if(!id||!["approve","reject"].includes(decision))throw Object.assign(new Error("Dados da decisão de saque inválidos."),{status:400});
  if(decision==="reject"){
    if(!reason)throw Object.assign(new Error("Informe o motivo para rejeitar a solicitação."),{status:400});
    const {data,error}=await db.from("fechou_wallet_payout_requests")
      .update({status:"rejected",review_reason:reason,updated_at:new Date().toISOString()})
      .eq("id",id).in("status",["requested_review","under_review"]).select("id,status").maybeSingle();
    if(error)throw new Error("Não foi possível rejeitar a solicitação de saque.");
    if(!data)throw Object.assign(new Error("Solicitação não encontrada ou não está em análise."),{status:409});
    await audit(db,user,"payout_rejected","fechou_wallet_payout_requests",id,{reason},requestId);
    return {id,status:data.status};
  }

  if(!ASAAS_API_KEY)throw Object.assign(new Error("Asaas não configurado para transferências. Confira ASAAS_API_KEY nos secrets."),{status:503});
  const {data:req,error:reqError}=await db.from("fechou_wallet_payout_requests")
    .select("id,user_id,order_id,amount,status,pix_key_type,pix_key_last4").eq("id",id).maybeSingle();
  if(reqError||!req)throw Object.assign(new Error("Solicitação de repasse não encontrada."),{status:404});
  if(!["requested_review","under_review"].includes(norm(req.status)))throw Object.assign(new Error("A solicitação não está disponível para aprovação."),{status:409});

  const {data:active,error:activeError}=await db.from("fechou_wallet_asaas_transfers")
    .select("id,status,asaas_transfer_id").eq("payout_request_id",id)
    .in("status",["initiating","unknown","pending","in_bank_processing"]).limit(1).maybeSingle();
  if(activeError)throw new Error("Não foi possível verificar tentativas anteriores de transferência.");
  if(active)throw Object.assign(new Error("Já existe uma transferência em andamento ou com resultado incerto. Não repita a operação; aguarde o webhook do Asaas."),{status:409});
  const {data:duplicateAttempt,error:duplicateAttemptError}=await db.from("fechou_wallet_asaas_transfers")
    .select("id,fail_reason").eq("payout_request_id",id).eq("status","failed")
    .ilike("fail_reason","%HTTP 409%já havia sido solicitado%").limit(1).maybeSingle();
  if(duplicateAttemptError)throw new Error("Não foi possível verificar conflito anterior de duplicidade no Asaas.");
  if(duplicateAttempt)throw Object.assign(new Error("O Asaas já recusou esta solicitação por possível duplicidade com outra transferência. Não tente novamente até conferir o ID retornado no Asaas e confirmar que não houve pagamento para esta solicitação."),{status:409,code:"ASAAS_DUPLICATE_TRANSFER_REVIEW"});

  const [{data:order,error:orderError},{data:profile,error:profileError},{data:ledger,error:ledgerError}] = await Promise.all([
    db.from("orders").select("id,professional_id,status,service_state,payment_status,total,professional_net,platform_fee,metadata").eq("id",req.order_id).maybeSingle(),
    db.from("fechou_payout_profiles").select("user_id,pix_key,pix_key_type,last4,status,verified,confirmed_by_user,metadata").eq("user_id",req.user_id).maybeSingle(),
    db.from("fechou_wallet_ledger").select("id,amount,status").eq("user_id",req.user_id).eq("order_id",String(req.order_id)).eq("entry_type","payout").eq("status","release_ready").maybeSingle()
  ]);
  if(orderError||!order)throw Object.assign(new Error("Contratação do repasse não encontrada."),{status:404});
  if(profileError||!profile)throw Object.assign(new Error("Perfil de recebimento Pix não encontrado."),{status:409});
  if(ledgerError||!ledger)throw Object.assign(new Error("Não existe saldo release_ready vinculado a esta contratação."),{status:409});
  if(String(order.professional_id||"")!==String(req.user_id))throw Object.assign(new Error("O profissional da contratação não corresponde ao titular da solicitação."),{status:409});
  if(!["approved","paid","received","confirmed"].includes(norm(order.payment_status)))throw Object.assign(new Error("O pagamento da contratação não está confirmado."),{status:409});
  if(!["completed","concluido","concluído"].includes(norm(order.service_state))&&!["completed","concluido","concluído"].includes(norm(order.status)))throw Object.assign(new Error("A contratação ainda não foi concluída."),{status:409});
  const meta=asObj(order.metadata);
  const payoutBase=Number(meta.professional_payout_base||order.total||0);
  const commissionRate=Number(meta.platform_commission_rate||0);
  const expectedNet=Number((payoutBase*0.98).toFixed(2));
  const expectedFee=Number((payoutBase*0.02).toFixed(2));
  if(commissionRate!==2||!Number.isFinite(payoutBase)||payoutBase<=0||
     Math.round(Number(order.professional_net||0)*100)!==Math.round(expectedNet*100)||
     Math.round(Number(order.platform_fee||0)*100)!==Math.round(expectedFee*100)||
     Math.round(Number(ledger.amount||0)*100)!==Math.round(expectedNet*100)) {
    throw Object.assign(new Error("A composição do repasse não confere com a comissão FECHOU de 2%; o saldo não será transferido."),{status:409,code:"PAYOUT_COMPOSITION_INVALID"});
  }
  if(norm(profile.status)!=="verified"||profile.verified!==true||profile.confirmed_by_user!==true||!profile.pix_key)throw Object.assign(new Error("A chave Pix ainda não foi verificada e confirmada pelo profissional."),{status:409});
  const pixType=norm(profile.pix_key_type).toUpperCase();
  const requestType=norm(req.pix_key_type).toUpperCase();
  const pixKey=String(profile.pix_key).trim();
  const last4=pixKey.slice(-4);
  if(!["CPF","CNPJ","EMAIL","PHONE","EVP"].includes(pixType)||pixType!==requestType||last4!==String(req.pix_key_last4||""))throw Object.assign(new Error("A chave Pix verificada não corresponde à chave registrada na solicitação. Solicite novamente após atualizar a chave."),{status:409});
  const amount=Number(req.amount),ledgerAmount=Number(ledger.amount);
  if(!Number.isFinite(amount)||amount<=0||Math.round(amount*100)!==Math.round(ledgerAmount*100))throw Object.assign(new Error("O valor solicitado não confere com o saldo liberado."),{status:409});
  const [openCase,openReview]=await Promise.all([
    db.from("fechou_service_cases").select("id").eq("order_id",String(req.order_id)).in("status",["open","in_review"]).limit(1).maybeSingle(),
    db.from("fechou_service_review_cases").select("id").eq("order_id",String(req.order_id)).in("status",["open","in_review"]).limit(1).maybeSingle()
  ]);
  if(openCase.error||openReview.error)throw new Error("Não foi possível conferir se existe contestação ou análise pendente.");
  if(openCase.data||openReview.data)throw Object.assign(new Error("Existe uma contestação ou revisão de serviço pendente; o repasse permanece bloqueado."),{status:409});

  const balance=await asaasRequest("/finance/balance");
  const available=Number(balance.balance||0);
  if(!Number.isFinite(available)||available+0.0001<amount)throw Object.assign(new Error("Saldo disponível no Asaas insuficiente para este repasse."),{status:409});

  const normalizedKey=/^[+()\d\s.-]+$/.test(pixKey)?pixKey.replace(/\D/g,""):pixKey.toLowerCase();
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(normalizedKey));
  const fingerprint=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
  const adminReason=reason.length>=12?reason:"Aprovação administrativa de repasse após validação de saldo, contratação e titularidade Pix.";
  if(norm(req.status)==="requested_review"){
    const {data:claimed,error:claimError}=await db.from("fechou_wallet_payout_requests")
      .update({status:"under_review",review_reason:"Em validação administrativa para repasse.",updated_at:new Date().toISOString()})
      .eq("id",id).eq("status","requested_review").select("id").maybeSingle();
    if(claimError||!claimed)throw Object.assign(new Error("Não foi possível reservar a solicitação para análise. Atualize a fila e tente novamente."),{status:409});
  }
  {
    /* V338: o Asaas recusa (409 "Saque ... já solicitado") um Pix de mesmo valor para a mesma chave logo após outro. Bloqueia antes de chamar o Asaas. */
    const since=new Date(Date.now()-10*60*1000).toISOString();
    const {data:recentSame,error:recentSameError}=await db.from("fechou_wallet_asaas_transfers")
      .select("id,amount,created_at").eq("pix_key_fingerprint",fingerprint)
      .neq("payout_request_id",id).in("status",["initiating","unknown","pending","in_bank_processing","done"])
      .gte("created_at",since).order("created_at",{ascending:false}).limit(20);
    if(recentSameError)throw new Error("Não foi possível verificar repasses recentes para a mesma chave Pix.");
    const clash=(recentSame||[]).find((x:any)=>Math.round(Number(x.amount||0)*100)===Math.round(amount*100));
    if(clash){
      const waitMin=Math.max(1,Math.ceil((Date.parse(clash.created_at)+10*60*1000-Date.now())/60000));
      throw Object.assign(new Error("Outro repasse de mesmo valor para esta mesma chave Pix foi enviado há poucos minutos e o Asaas bloqueia a sequência como duplicidade. Nada foi transferido nem baixado. Aguarde cerca de "+waitMin+" min e clique em Aprovar e pagar novamente."),{status:409,code:"ASAAS_SAME_KEY_COOLDOWN"});
    }
  }
  const {data:reserved,error:reserveError}=await db.rpc("fechou_reserve_asaas_payout_attempt",{
    p_payout_request_id:id,p_user_id:req.user_id,p_order_id:req.order_id,p_admin_id:user.id,
    p_amount:amount,p_pix_key_type:pixType,p_pix_key_last4:last4,p_pix_key:pixKey,
    p_pix_key_fingerprint:fingerprint,p_reason:adminReason,p_external_reference_prefix:"fechou-payout"
  });
  if(reserveError)throw Object.assign(new Error("Não foi possível reservar a transferência com segurança: "+clean(reserveError.message,300)),{status:409});
  const attempt=Array.isArray(reserved)?reserved[0]:reserved;
  if(!attempt?.id||!attempt?.external_reference)throw new Error("A reserva de transferência não retornou identificador válido.");
  const now=new Date().toISOString();
  const {error:pendingError}=await db.from("fechou_wallet_payout_requests").update({
    status:"transfer_pending",review_reason:"Aprovação administrativa registrada; aguardando confirmação do Asaas.",updated_at:now
  }).eq("id",id).eq("status","under_review");
  if(pendingError)throw new Error("Reserva criada, mas não foi possível atualizar a solicitação para processamento: "+pendingError.message);

  try {
    const transfer=await asaasRequest("/transfers","POST",{
      value:Number(amount.toFixed(2)),pixAddressKey:pixKey,pixAddressKeyType:pixType,operationType:"PIX",
      description:"FECHOU - repasse profissional",externalReference:attempt.external_reference
    });
    const transferId=clean(transfer.id,180);
    if(!transferId)throw Object.assign(new Error("Asaas aceitou a chamada sem retornar o ID da transferência; conciliação pelo webhook necessária."),{status:502,ambiguous:true});
    const providerStatus=clean(transfer.status||"PENDING",40).toUpperCase();
    const mapped=providerStatus==="DONE"?"done":providerStatus==="BANK_PROCESSING"||providerStatus==="IN_BANK_PROCESSING"?"in_bank_processing":providerStatus==="BLOCKED"?"blocked":"pending";
    const {error:updateAttemptError}=await db.from("fechou_wallet_asaas_transfers").update({
      asaas_transfer_id:transferId,status:mapped,provider_status:providerStatus,updated_at:new Date().toISOString()
    }).eq("id",attempt.id);
    if(updateAttemptError)throw new Error("Asaas retornou transferência "+transferId+", mas o ID não foi sincronizado localmente. O webhook fará a conciliação: "+updateAttemptError.message);
    await audit(db,user,"asaas_transfer_created","fechou_wallet_asaas_transfers",attempt.id,{
      payout_request_id:id,amount,transfer_id:transferId,provider_status:providerStatus,external_reference:attempt.external_reference
    },requestId);
    return {id,status:"transfer_pending",transfer_id:transferId,provider_status:providerStatus,amount,
      message:"Transferência enviada ao Asaas. O saldo só será marcado como pago após o webhook TRANSFER_DONE."};
  } catch(error) {
    const status=Number((error as any)?.status)||0;
    const ambiguous=Boolean((error as any)?.ambiguous)||status===0||status>=500||status===502;
    const nextStatus=ambiguous?"unknown":"failed";
    const message=clean((error as Error)?.message||error,500);
    await db.from("fechou_wallet_asaas_transfers").update({
      status:nextStatus,provider_status:ambiguous?"UNKNOWN":"REJECTED",fail_reason:message,updated_at:new Date().toISOString()
    }).eq("id",attempt.id);
    await db.from("fechou_wallet_payout_requests").update({
      status:ambiguous?"transfer_pending":"under_review",
      review_reason:ambiguous?"Resultado da chamada ao Asaas incerto. Não repetir; aguardar webhook ou conciliação manual.":message,
      updated_at:new Date().toISOString()
    }).eq("id",id).neq("status","paid");
    await audit(db,user,ambiguous?"asaas_transfer_unknown":"asaas_transfer_rejected","fechou_wallet_asaas_transfers",attempt.id,{
      payout_request_id:id,amount,error:message,ambiguous
    },requestId);
    throw Object.assign(new Error(ambiguous
      ?"O resultado da solicitação ao Asaas é incerto. O sistema bloqueou uma segunda tentativa para evitar Pix duplicado; aguarde conciliação."
      :"O Asaas recusou a transferência. A solicitação voltou para análise e o saldo não foi baixado: "+message),{status:ambiguous?502:422});
  }
}


async function asaasManualTransferCreate(_db:any,_user:any,_params:any,_requestId:string) {
  throw Object.assign(new Error("Transferências manuais pelo painel administrativo foram desativadas. Utilize o fluxo de saque aprovado do profissional."),{status:410});
}

async function handleAction(db:any,user:any,admin:any,action:string,params:any,requestId:string) {
  if(action==="session_check")return {is_admin:true,isAdmin:true,role:"admin",email:user.email,permissions:admin.permissions};
  assertPermission(admin,action);
  if(action==="dashboard_summary"){const d=await dashboard(db,clean(params.period,20));return d.summary;}
  if(action==="revenue_series"){const d=await dashboard(db,clean(params.period,20));return {items:d.revenue};}
  if(action==="geo_demand")return geoDemand(db,params);
  if(action==="users_list")return usersList(db,params);
  if(action==="orders_list")return ordersList(db,params);
  if(action==="subscriptions_list")return subscriptionsList(db,params);
  if(action==="cases_list")return casesList(db,params);
  if(action==="case_decide")return decideCase(db,user,params,requestId);
  if(action==="activity_list")return activityList(db,params);
  if(action==="payments_list")return paymentsList(db,params);
  if(action==="transactions_list")return transactionsList(db,params);
  if(action==="payouts_list")return payoutsList(db,params);
  if(action==="payout_decide"){
    if(norm(params.decision)==="approve")assertPermission(admin,"asaas_transfer_create");
    return payoutDecide(db,user,params,requestId);
  }
  if(action==="asaas_balance") return await asaasBalance();
  if(action==="asaas_refund_create") return await asaasRefundCreate(db,user,params,requestId);
  if(action==="asaas_transfer_create")return await asaasManualTransferCreate(db,user,params,requestId);
  throw Object.assign(new Error("Ação administrativa desconhecida."),{status:400});
}

Deno.serve(async (req:Request)=>{
  const headers=getCorsHeaders(req);
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return reply(req,405,{ok:false,error:"Método não permitido."});
  const origin=req.headers.get("origin")||"";
  if(origin && !headers["Access-Control-Allow-Origin"])return reply(req,403,{ok:false,error:"Origem não autorizada."});
  try{
    const raw=await req.text();
    if(raw.length>20000)throw Object.assign(new Error("Requisição muito grande."),{status:413});
    let body:any={};try{body=raw?JSON.parse(raw):{};}catch{throw Object.assign(new Error("JSON inválido."),{status:400});}
    const action=clean(body?.action,80);
    const params=asObj(body?.params);
    if(!action)throw Object.assign(new Error("Ação não informada."),{status:400});
    const user=await authenticate(req);
    const db=serviceClient();
    const admin=await ensureAdmin(db,user);
    const requestId=clean(req.headers.get("x-request-id")||crypto.randomUUID(),100);
    const result=await handleAction(db,user,admin,action,params,requestId);
    if(!["session_check","case_decide","payout_decide"].includes(action))await audit(db,user,action,null,null,{success:true},requestId);
    return reply(req,200,{ok:true,data:result});
  }catch(error:any){
    const status=Number(error?.status)||500;
    const message=status>=500&&status!==503?"Erro interno no backend administrativo.":clean(error?.message||"Falha administrativa.",500);
    console.error("admin-api error",status,error?.message||error);
    return reply(req,status,{ok:false,error:message});
  }
});

