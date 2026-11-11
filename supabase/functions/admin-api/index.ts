import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLIC_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const ADMIN_EMAIL = "fechousuporte@gmail.com";
const MAX_ROWS = 500;

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
        (u.protocol === "https:" && (u.hostname.endsWith(".pages.dev") || u.hostname.endsWith(".workers.dev"))) ||
        ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.protocol === "http:");
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

  if (row && row.active && norm(row.email) === email) return row;

  const { data: invite, error: inviteError } = await db.from("admin_access_invites")
    .select("email,active,permissions,claimed_user_id")
    .eq("email", email).eq("active", true).maybeSingle();
  if (inviteError) throw new Error("Não foi possível validar o convite administrativo.");

  if (invite && (email === ADMIN_EMAIL || invite.claimed_user_id === user.id)) {
    if (invite.claimed_user_id && invite.claimed_user_id !== user.id) {
      throw Object.assign(new Error("Este convite administrativo já foi utilizado por outra conta."), { status: 403 });
    }
    const permissions = asObj(invite.permissions);
    const { error: insertError } = await db.from("admin_access").upsert({
      user_id: user.id,
      email,
      active: true,
      permissions,
      created_by: null
    }, { onConflict: "user_id" });
    if (insertError) throw new Error("Não foi possível vincular a conta à lista administrativa.");
    await db.from("admin_access_invites").update({
      claimed_user_id: user.id,
      claimed_at: new Date().toISOString()
    }).eq("email", email).eq("active", true);
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
  const queries = [profilesQ,ordersQ,proposalsQ,checkoutsQ,eventsQ,payoutsQ,casesQ,reviewCasesQ,supportCasesQ,presenceQ,ledgerQ];
  if (queries.some((q: any) => q.error)) throw new Error("Falha ao carregar os dados reais do dashboard.");
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
  const [a,b,c,ordersQ,profiles,authUsers] = await Promise.all([
    db.from("fechou_service_cases").select("id,order_id,opened_by,case_type,status,reason,decision,decision_reason,created_at,metadata").order("created_at",{ascending:false}).limit(200),
    db.from("fechou_service_review_cases").select("id,order_id,opened_by,case_type,status,reason,decision,decision_reason,created_at").order("created_at",{ascending:false}).limit(200),
    db.from("fechou_support_cases").select("id,order_id,opened_by,case_type,status,reason,decision,created_at,metadata").order("created_at",{ascending:false}).limit(200),
    db.from("orders").select("id,title,total,client_id,professional_id").limit(10000),
    profilesMap(db),listAuthUsers(db)
  ]);
  if(a.error||b.error||c.error||ordersQ.error) throw new Error("Não foi possível consultar as ocorrências.");
  const orderMap=new Map(arr(ordersQ.data).map((x:any)=>[String(x.id),x]));
  const authMap=new Map(authUsers.map((u:any)=>[String(u.id),u]));
  const normalize=(row:any,source:string)=>{
    const o=orderMap.get(String(row.order_id))||{};
    const requester=profiles.get(String(row.opened_by));
    const user=authMap.get(String(row.opened_by))||{};
    const meta=asObj(row.metadata);
    const t=classifyCaseType(row.case_type);
    return {id:row.id,source_table:source,order_id:row.order_id,order_code:String(row.order_id||"").slice(0,8).toUpperCase(),type:t,case_type:row.case_type,requester_name:requester?.full_name||"",requester_email:user.email||"",reason:row.reason||"",amount:meta.amount??o.total??null,created_at:row.created_at,status:normalizedCaseStatus(row),decision:row.decision||null,decision_reason:row.decision_reason||null,description:row.reason||""};
  };
  let items=[...arr(a.data).map((x:any)=>normalize(x,"fechou_service_cases")),...arr(b.data).map((x:any)=>normalize(x,"fechou_service_review_cases")),...arr(c.data).map((x:any)=>normalize(x,"fechou_support_cases"))];
  const type=norm(params.type),status=norm(params.status),search=norm(params.search);
  if(type)items=items.filter((x:any)=>x.type===type);
  if(status)items=items.filter((x:any)=>norm(x.status).includes(status));
  if(search)items=items.filter((x:any)=>[x.order_id,x.order_code,x.requester_name,x.requester_email,x.reason].some(v=>norm(v).includes(search)));
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
  let q=db.from("payments").select("id,order_id,client_id,professional_id,provider,provider_payment_id,amount,currency,status,provider_status,created_at").order("created_at",{ascending:false}).limit(500);
  const since=periodStart(params.period);if(since)q=q.gte("created_at",since);
  const {data,error}=await q;if(error)throw new Error("Não foi possível consultar os pagamentos registrados.");
  return {items:arr(data).map((x:any)=>({id:x.id,type:x.provider||"Pagamento",direction:"entrada",reference:x.provider_payment_id||x.order_id,order_id:x.order_id,asaas_id:x.provider_payment_id,value:x.amount,amount:x.amount,status:x.status||x.provider_status,created_at:x.created_at,provider:x.provider,currency:x.currency})),total:arr(data).length};
}

async function payoutsList(db:any,params:any) {
  let q=db.from("fechou_wallet_payout_requests").select("id,user_id,order_id,amount,status,pix_key_type,pix_key_last4,review_reason,created_at,updated_at").order("created_at",{ascending:false}).limit(500);
  if(norm(params.status)==="pending")q=q.in("status",["requested_review","under_review","transfer_pending"]);
  const [res,profiles,users]=await Promise.all([q,profilesMap(db),listAuthUsers(db)]);
  if(res.error)throw new Error("Não foi possível consultar as solicitações de saque.");
  const userMap=new Map(users.map((u:any)=>[String(u.id),u]));
  let items=arr(res.data).map((x:any)=>{
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
  const [ledger,transfers,profiles,users]=await Promise.all([
    q,
    db.from("fechou_wallet_asaas_transfers").select("id,payout_request_id,user_id,order_id,asaas_transfer_id,amount,pix_key_type,pix_key_last4,status,provider_status,transaction_receipt_url,created_at,effective_at").order("created_at",{ascending:false}).limit(200),
    profilesMap(db),listAuthUsers(db)
  ]);
  if(ledger.error||transfers.error)throw new Error("Não foi possível consultar as movimentações financeiras.");
  const userMap=new Map(users.map((u:any)=>[String(u.id),u]));
  const items:any[]=[];
  for(const x of arr(ledger.data)){
    const p=profiles.get(String(x.user_id));
    items.push({id:x.id,type:x.entry_type,direction:x.entry_type,reference:x.provider_reference||x.provider_ref||x.order_id||x.id,order_id:x.order_id,value:x.amount,amount:x.amount,status:x.status,counterparty_name:p?.full_name||"",created_at:x.created_at,provider:x.provider,asaas_id:x.provider_reference||x.provider_ref||null});
  }
  for(const x of arr(transfers.data)){
    items.push({id:x.id,type:"Transferência Pix",direction:"saída",reference:x.asaas_transfer_id||x.payout_request_id,order_id:x.order_id,asaas_id:x.asaas_transfer_id,value:x.amount,amount:x.amount,status:x.provider_status||x.status,counterparty_name:userMap.get(String(x.user_id))?.email||"",pix_key:maskPix(x),receipt_url:x.transaction_receipt_url||null,created_at:x.effective_at||x.created_at});
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
  if(decision==="approve"){
    await audit(db,user,"payout_approval_blocked","fechou_wallet_payout_requests",id,{reason:"asaas_not_configured_and_transfer_flow_disabled"},requestId);
    throw Object.assign(new Error("Aprovação com pagamento real está desativada. Configure e valide as credenciais e os webhooks do Asaas antes de liberar transferências."),{status:503});
  }
  if(!reason)throw Object.assign(new Error("Informe o motivo para rejeitar a solicitação."),{status:400});
  const {data,error}=await db.from("fechou_wallet_payout_requests")
    .update({status:"rejected",review_reason:reason,updated_at:new Date().toISOString()})
    .eq("id",id).in("status",["requested_review","under_review"]).select("id,status").maybeSingle();
  if(error)throw new Error("Não foi possível rejeitar a solicitação de saque.");
  if(!data)throw Object.assign(new Error("Solicitação não encontrada ou não está em análise."),{status:409});
  await audit(db,user,"payout_rejected","fechou_wallet_payout_requests",id,{reason},requestId);
  return {id,status:data.status};
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
  if(action==="payout_decide")return payoutDecide(db,user,params,requestId);
  if(action==="asaas_balance"||action==="asaas_refund_create"||action==="asaas_transfer_create"){
    await audit(db,user,action+"_blocked",null,null,{reason:"asaas_secrets_and_webhooks_not_validated"},requestId);
    throw Object.assign(new Error("Integração financeira ainda não liberada. Configure ASAAS_API_KEY, ASAAS_ENV e ASAAS_WEBHOOK_TOKEN e valide os webhooks antes de consultar saldo, estornar ou transferir valores."),{status:503});
  }
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
