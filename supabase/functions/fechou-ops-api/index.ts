import { createClient } from "npm:@supabase/supabase-js@2";
const URL = Deno.env.get("SUPABASE_URL") || "https://ziubcqxmxialhmwevtiy.supabase.co";
const PUBLIC_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const ASAAS_KEY = (Deno.env.get("ASAAS_API_KEY") || Deno.env.get("ASAAS_ACCESS_TOKEN") || "").trim();
const ASAAS_ENV = ASAAS_KEY.startsWith("$aact_hmlg_") ? "sandbox" : ASAAS_KEY.startsWith("$aact_prod_") ? "production" : ((Deno.env.get("ASAAS_ENV") || "production").toLowerCase() === "sandbox" ? "sandbox" : "production");
const ASAAS_BASE = ASAAS_ENV === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3";
const ADMIN_IDS = (Deno.env.get("EW_ADMIN_USER_IDS") || "").split(",").map(x => x.trim()).filter(Boolean);
const origins = (Deno.env.get("FECHOU_ALLOWED_ORIGINS") || "").split(",").map(x => x.trim()).filter(Boolean);
const admin = () => {
  if (!SERVICE_KEY) throw new Error("Serviço administrativo não configurado.");
  return createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
};
const clean = (v: unknown, max = 500) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const obj = (v: unknown): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
const validUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));
const NativeURL = globalThis.URL; // [FECHOU_CORS_FIX_V336] o "const URL" acima sombreia o construtor global URL
const normalizedOrigin = (value: string) => {
  const v = String(value ?? "").trim();
  if (!v) return "";
  try { const o = new NativeURL(v).origin.toLowerCase(); return o === "null" ? "" : o; } catch { return ""; }
};
const allowedOriginSet = new Set([
  ...origins.map(normalizedOrigin),
  normalizedOrigin(Deno.env.get("FECHOU_APP_URL") || ""),
  "https://startup5.pages.dev",
  "https://startup-bur.pages.dev",
  "http://localhost",
  "http://127.0.0.1",
].map(normalizedOrigin).filter(Boolean));
const productionHosts = new Set(["startup5.pages.dev", "www.startup5.pages.dev", "startup-bur.pages.dev"]);
const originDecision = (rawOrigin: string) => {
  const raw = String(rawOrigin || "").trim();
  const normalized = normalizedOrigin(raw);
  let allowed = !raw;
  if (!allowed && normalized) {
    try {
      const parsed = new NativeURL(normalized);
      allowed = (parsed.protocol === "https:" && productionHosts.has(parsed.hostname.toLowerCase())) || allowedOriginSet.has(normalized);
    } catch { allowed = false; }
  }
  console.log("[CORS_DIAGNOSTIC]", JSON.stringify({ rawOrigin: raw, normalizedOrigin: normalized, allowed, allowedOrigins: [...allowedOriginSet].sort() }));
  return { allowed, normalized };
};
const isOriginAllowed = (origin: string) => originDecision(origin).allowed;
const cors = (req: Request) => {
  const decision = originDecision(req.headers.get("origin") || "");
  return { ...(decision.normalized && decision.allowed ? { "Access-Control-Allow-Origin": decision.normalized } : {}), "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-retry-count, x-fechou-request-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400", "Access-Control-Expose-Headers": "x-request-id",
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
};
const reply = (req: Request, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: cors(req) });
async function authenticate(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !PUBLIC_KEY) throw Object.assign(new Error("Sessão inválida. Entre novamente."), { status: 401 });
  const client = createClient(URL, PUBLIC_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: "Bearer " + token } } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) throw Object.assign(new Error("Sessão não autenticada."), { status: 401 });
  return { user: data.user, admin: admin() };
}
async function requireAdmin(db: any, userId: string) {
  if (ADMIN_IDS.includes(userId)) return;
  const { data, error } = await db.from("fechou_ops_admins").select("user_id").eq("user_id", userId).eq("active", true).maybeSingle();
  if (error || !data) throw Object.assign(new Error("Acesso restrito à administração autorizada."), { status: 403 });
}
async function asaas(path: string, method = "GET", body?: Record<string, unknown>) {
  if (!ASAAS_KEY) throw Object.assign(new Error("Integração de pagamentos indisponível."), { status: 503 });
  const response = await fetch(ASAAS_BASE + path, { method,
    headers: { "Content-Type": "application/json", Accept: "application/json", access_token: ASAAS_KEY, "User-Agent": "FECHOU/1.0" },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const raw = await response.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) throw Object.assign(new Error(clean(data?.errors?.[0]?.description || data?.message || ("Provedor respondeu HTTP " + response.status), 500)), { status: response.status >= 500 ? 502 : 422, providerStatus: response.status });
  return data;
}
async function signPath(db: any, bucket: string, path: string, expires = 900) {
  const allowed = new Set(["fechou-contracts", "eworkers-service-evidence", "eworkers-chat", "eworkers-profile-photos"]);
  if (!allowed.has(bucket) || !path || path.startsWith("/") || path.includes("..")) return "";
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, expires);
  return error ? "" : String(data?.signedUrl || "");
}
async function notify(db: any, userId: string, orderId: string, type: string, title: string, body: string, extra: any = {}) {
  if (!validUuid(userId)) return;
  const eventKey = type + ":" + orderId + ":" + clean(extra.event_key || "v1", 80);
  const { data: old } = await db.from("notifications").select("id").eq("user_id", userId).eq("type", type).contains("data", { event_key: eventKey }).limit(1).maybeSingle();
  if (old?.id) return;
  await db.from("notifications").insert({ user_id: userId, type, title, body, data: { order_id: orderId, event_key: eventKey, ...extra } });
}
async function overview(db: any) {
  const now = new Date(), since7 = new Date(now.getTime() - 7 * 86400000).toISOString(), since30 = new Date(now.getTime() - 30 * 86400000).toISOString(), activeSince = new Date(now.getTime() - 90000).toISOString();
  const [profiles, orders, checkouts, ledger, cases, payouts, presence, reviews, events] = await Promise.all([
    db.from("profiles").select("id,role,created_at").limit(10000),
    db.from("orders").select("id,status,service_state,payment_status,refund_status,payout_status,total,platform_fee,professional_net,created_at,completed_at,cancellation_requested_at,payment_method,metadata").order("created_at", { ascending: false }).limit(10000),
    db.from("fechou_asaas_checkouts").select("purpose,status,amount,plan,subscription_status,created_at").limit(10000),
    db.from("fechou_wallet_ledger").select("entry_type,amount,status,created_at,order_id").limit(10000),
    db.from("fechou_service_cases").select("id,status").in("status", ["open", "in_review"]).limit(1000),
    db.from("fechou_wallet_payout_requests").select("id,status,amount").limit(1000),
    db.from("fechou_ops_presence").select("user_id,last_seen_at").gte("last_seen_at", activeSince).limit(5000),
    db.from("service_reviews").select("id,rating").limit(10000),
    db.from("fechou_ops_events").select("id,created_at").order("id", { ascending: false }).limit(1)
  ]);
  for (const [name, x] of Object.entries({ profiles, orders, checkouts, ledger, cases, payouts, presence, reviews, events })) if ((x as any).error) throw new Error("Falha ao consultar " + name + ": " + (x as any).error.message);
  const ps = profiles.data || [], os = orders.data || [], cs = checkouts.data || [], ls = ledger.data || [];
  const isTemporaryTestOrder = (x: any) => {
    const m = obj(x?.metadata);
    return m.temporary_test_price === true || String(m.temporary_test_price || "").trim().toLowerCase() === "true";
  };
  const testOrders = os.filter(isTemporaryTestOrder);
  const operationalOrders = os.filter((x: any) => !isTemporaryTestOrder(x));
  const testOrderIds = new Set(testOrders.map((x: any) => String(x.id)));
  const operationalLedger = ls.filter((x: any) => !x.order_id || !testOrderIds.has(String(x.order_id)));
  const testLedger = ls.filter((x: any) => x.order_id && testOrderIds.has(String(x.order_id)));
  const paid = operationalOrders.filter((x: any) => ["approved", "paid", "received", "confirmed"].includes(String(x.payment_status || "").toLowerCase()));
  const testPaid = testOrders.filter((x: any) => ["approved", "paid", "received", "confirmed"].includes(String(x.payment_status || "").toLowerCase()));
  const completed = operationalOrders.filter((x: any) => String(x.service_state || "").toLowerCase() === "completed");
  const cancelled = operationalOrders.filter((x: any) => ["cancelled", "canceled"].includes(String(x.status || "").toLowerCase()));
  const activeUsers = new Set((presence.data || []).map((x: any) => String(x.user_id))).size;
  const sum = (rows: any[], field: string) => rows.reduce((n, x) => n + Math.max(0, Number(x[field] || 0)), 0);
  const subs = cs.filter((x: any) => String(x.purpose || "").toLowerCase().includes("subscription"));
  const activeSubs = subs.filter((x: any) => ["active", "confirmed", "paid", "received"].includes(String(x.subscription_status || x.status || "").toLowerCase()));
  const daily = new Map<string, any>();
  for (let i = 29; i >= 0; i--) { const date = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10); daily.set(date, { date, accounts: 0, orders: 0, paid: 0 }); }
  for (const p of ps) { const k = String(p.created_at || "").slice(0, 10); if (daily.has(k)) daily.get(k).accounts++; }
  for (const o of operationalOrders) { const k = String(o.created_at || "").slice(0, 10); if (daily.has(k)) { daily.get(k).orders++; if (["approved", "paid", "received", "confirmed"].includes(String(o.payment_status || "").toLowerCase())) daily.get(k).paid++; } }
  const refunds = operationalLedger.filter((x: any) => String(x.entry_type) === "refund"), payoutsLedger = operationalLedger.filter((x: any) => String(x.entry_type) === "payout");
  const testRefunds = testLedger.filter((x: any) => String(x.entry_type) === "refund"), testPayouts = testLedger.filter((x: any) => String(x.entry_type) === "payout");
  return {
    generated_at: now.toISOString(),
    realtime: { active_users_90s: activeUsers, active_sessions: (presence.data || []).length, refresh_seconds: 15 },
    accounts: { total: ps.length, clients: ps.filter((x: any) => /client/i.test(String(x.role))).length, professionals: ps.filter((x: any) => /professional|profissional|pro/i.test(String(x.role))).length,
      new_7d: ps.filter((x: any) => String(x.created_at || "") >= since7).length, new_30d: ps.filter((x: any) => String(x.created_at || "") >= since30).length },
    orders: { total: operationalOrders.length, paid: paid.length, completed: completed.length, cancelled: cancelled.length, open_cases: (cases.data || []).length,
      last_30d: operationalOrders.filter((x: any) => String(x.created_at || "") >= since30).length, test_orders_count: testOrders.length, test_paid_orders_count: testPaid.length },
    finance: { paid_order_value: Number(sum(paid, "total").toFixed(2)), platform_fee_recorded: Number(sum(paid, "platform_fee").toFixed(2)),
      professional_net_recorded: Number(sum(paid, "professional_net").toFixed(2)), refunds_in_ledger: Number(sum(refunds, "amount").toFixed(2)),
      payouts_in_ledger: Number(sum(payoutsLedger, "amount").toFixed(2)), paid_orders_count: paid.length, refund_requests_count: refunds.length,
      test_paid_order_value: Number(sum(testPaid, "total").toFixed(2)), test_platform_fee_recorded: Number(sum(testPaid, "platform_fee").toFixed(2)),
      test_professional_net_recorded: Number(sum(testPaid, "professional_net").toFixed(2)), test_paid_orders_count: testPaid.length,
      test_refunds_in_ledger: Number(sum(testRefunds, "amount").toFixed(2)), test_payouts_in_ledger: Number(sum(testPayouts, "amount").toFixed(2)) },
    subscriptions: { total_records: subs.length, active_records: activeSubs.length, value_recorded: Number(sum(subs.filter((x: any) => ["paid", "received", "confirmed"].includes(String(x.status || "").toLowerCase())), "amount").toFixed(2)) },
    payouts: { pending_requests: (payouts.data || []).filter((x: any) => ["requested_review", "under_review", "transfer_pending"].includes(String(x.status))).length,
      transferred_records: (payouts.data || []).filter((x: any) => String(x.status) === "paid").length },
    reviews: { total: (reviews.data || []).length, average: (reviews.data || []).length ? Number((reviews.data.reduce((n: number, x: any) => n + Number(x.rating || 0), 0) / reviews.data.length).toFixed(2)) : null },
    trend_30d: [...daily.values()], last_event_at: events.data?.[0]?.created_at || null
  };
}
async function casesList(db: any) {
  const [a, b] = await Promise.all([
    db.from("fechou_service_cases").select("*").in("status", ["open", "in_review"]).order("created_at", { ascending: true }).limit(50),
    db.from("fechou_service_review_cases").select("*").in("status", ["open", "in_review"]).order("created_at", { ascending: true }).limit(50)
  ]);
  if (a.error) throw new Error(a.error.message);
  if (b.error && !/does not exist|schema cache/i.test(b.error.message)) throw new Error(b.error.message);
  const all = [...(a.data || []).map((x: any) => ({ ...x, source_table: "fechou_service_cases" })), ...(b.data || []).map((x: any) => ({ ...x, source_table: "fechou_service_review_cases" }))];
  const out = [];
  for (const c of all.slice(0, 60)) {
    const id = String(c.order_id || "");
    const [o, messages, evidence, docs, contract] = await Promise.all([
      db.from("orders").select("id,client_id,professional_id,selected_proposal_id,title,service,description,location,region_approx,total,status,service_state,payment_status,payment_method,payment_id,refund_status,payout_status,created_at,service_started_at,completed_at,cancellation_requested_at,cancel_reason,metadata").eq("id", id).maybeSingle(),
      db.from("fechou_order_messages").select("id,sender_id,message_text,attachments,created_at").eq("order_id", id).order("created_at", { ascending: true }).limit(100),
      db.from("fechou_service_evidence").select("id,phase,storage_path,file_name,mime_type,created_at,uploader_id").eq("order_id", id).order("created_at", { ascending: true }).limit(30),
      db.from("fechou_prepaid_signature_documents").select("id,kind,signature_status,signer_signed_at,signed_pdf_storage_path,signed_pdf_sha256,client_id,professional_id").eq("order_id", id),
      db.from("contracts").select("id,accepted,status,client_accepted_at,professional_accepted_at,accepted_at").eq("order_id", id).maybeSingle()
    ]);
    if (o.error || !o.data) continue;
    const order = o.data;
    const [client, pro] = await Promise.all([
      db.from("profiles").select("id,full_name,role,phone,category").eq("id", order.client_id).maybeSingle(),
      order.professional_id ? db.from("profiles").select("id,full_name,role,phone,category").eq("id", order.professional_id).maybeSingle() : Promise.resolve({ data: null })
    ]);
    const ev = [];
    for (const e of evidence.data || []) ev.push({ ...e, url: await signPath(db, "eworkers-service-evidence", e.storage_path, 1800) });
    const chat = [];
    for (const m of messages.data || []) {
      const attachments = [];
      for (const raw of (Array.isArray(m.attachments) ? m.attachments : [])) {
        const a0 = obj(raw), bucket = clean(a0.bucket || "eworkers-chat", 80), path = clean(a0.path || a0.storage_path, 500);
        attachments.push({ name: clean(a0.name || "Anexo", 160), type: clean(a0.type || "", 40), mime_type: clean(a0.mime_type || "", 120), url: await signPath(db, bucket, path, 1800) });
      }
      chat.push({ id: m.id, sender_id: m.sender_id, message_text: m.message_text, created_at: m.created_at, attachments });
    }
    const signatures = [];
    for (const d of docs.data || []) signatures.push({ id: d.id, kind: d.kind, signature_status: d.signature_status, signer_signed_at: d.signer_signed_at,
      sha256: d.signed_pdf_sha256, pdf_url: d.signed_pdf_storage_path ? await signPath(db, "fechou-contracts", d.signed_pdf_storage_path, 1800) : "" });
    out.push({ ...c, order, client: client.data, professional: pro.data, contract: contract.data, signatures, evidence: ev, messages: chat });
  }
  return out;
}
async function usersList(db: any) {
  const { data, error } = await db.from("profiles").select("id,full_name,role,phone,category,created_at,profile_data").order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data || []).map((p: any) => ({ id: p.id, full_name: p.full_name, role: p.role, phone: p.phone, category: p.category, created_at: p.created_at, photo_path: obj(p.profile_data).photo_path || null }));
}
async function ordersList(db: any) {
  const { data, error } = await db.from("orders").select("id,client_id,professional_id,selected_proposal_id,title,service,category,total,status,service_state,payment_status,refund_status,payout_status,created_at,completed_at,payment_method,platform_fee,professional_net,metadata").order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return (data || []).map((o:any)=>{const m=obj(o.metadata);const test_mode=m.temporary_test_price===true||String(m.temporary_test_price||"").trim().toLowerCase()==="true";const {metadata,...safeOrder}=o;return {...safeOrder,test_mode};});
}
function normalizePixKey(type: string, raw: string) {
  const t = type.toUpperCase(); let key = raw.trim();
  if (t === "CPF" || t === "CNPJ" || t === "PHONE") key = key.replace(/\D/g, "");
  if (!["CPF", "CNPJ", "EMAIL", "PHONE", "EVP"].includes(t)) throw Object.assign(new Error("Tipo de chave Pix inválido."), { status: 400 });
  if (t === "CPF" && key.length !== 11) throw Object.assign(new Error("CPF deve conter 11 dígitos."), { status: 422 });
  if (t === "CNPJ" && key.length !== 14) throw Object.assign(new Error("CNPJ deve conter 14 dígitos."), { status: 422 });
  if (t === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) throw Object.assign(new Error("E-mail da chave Pix inválido."), { status: 422 });
  if (t === "PHONE" && key.length < 10) throw Object.assign(new Error("Telefone da chave Pix inválido."), { status: 422 });
  if (t === "EVP" && key.length < 20) throw Object.assign(new Error("Chave aleatória Pix inválida."), { status: 422 });
  return { type: t, key };
}
async function lookupPix(type: string, key: string) {
  const r = await asaas("/pix/addressKeys/external?type=" + encodeURIComponent(type) + "&key=" + encodeURIComponent(key));
  const owner = obj(r.owner), bank = obj(r.financialInstitution);
  const name = clean(owner.name || r.ownerName || "", 180), bankName = clean(bank.name || r.ispbName || "", 180);
  if (!name || !bankName) throw Object.assign(new Error("O provedor não retornou titular e instituição financeira suficientes para confirmar a chave."), { status: 422 });
  return { owner_name: name, owner_document_masked: clean(owner.cpfCnpj || "", 40), bank_name: bankName,
    bank_code: clean(bank.code || r.ispb || "", 30), ispb: clean(r.ispb || "", 30), key_type: type, key_last4: key.slice(-4) };
}
async function walletLookupPix(db: any, user: any, payload: any) {
  const { data: p, error } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!/professional|profissional|pro/i.test(String(p?.role || ""))) throw Object.assign(new Error("Somente profissionais podem cadastrar chave de recebimento."), { status: 403 });
  const n = normalizePixKey(clean(payload.pix_key_type, 20), clean(payload.pix_key, 250));
  const { data: slot, error: slotError } = await db.rpc("fechou_claim_pix_lookup_slot", { p_user_id: user.id });
  if (slotError) throw new Error(slotError.message);
  if (slot !== true) throw Object.assign(new Error("Limite de segurança: até 5 consultas de chave Pix por minuto na conta Asaas. Aguarde um minuto antes de tentar novamente."), { status: 429 });
  const lookup = await lookupPix(n.type, n.key);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(n.key));
  const keyHash = Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2,"0")).join("");
  const { data: record, error: insertError } = await db.from("fechou_pix_key_lookups").insert({
    user_id: user.id, pix_key_hash: keyHash, pix_key_type: n.type, key_last4: n.key.slice(-4),
    owner_name: lookup.owner_name, owner_document_masked: lookup.owner_document_masked,
    bank_name: lookup.bank_name, bank_code: lookup.bank_code, ispb: lookup.ispb
  }).select("id").single();
  if (insertError || !record) throw new Error(insertError?.message || "Não foi possível guardar a confirmação temporária da titularidade.");
  return { ok: true, lookup_id: record.id, lookup };
}
async function walletConfirmPix(db: any, user: any, payload: any) {
  const { data: p, error } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!/professional|profissional|pro/i.test(String(p?.role || ""))) throw Object.assign(new Error("Somente profissionais podem cadastrar chave de recebimento."), { status: 403 });
  if (payload.confirmed !== true) throw Object.assign(new Error("Confirme que o titular e o banco exibidos correspondem à sua conta."), { status: 400 });
  const n = normalizePixKey(clean(payload.pix_key_type, 20), clean(payload.pix_key, 250));
  const lookupId = clean(payload.lookup_id, 80);
  if (!validUuid(lookupId)) throw Object.assign(new Error("Consulta temporária de titularidade inválida. Consulte a chave novamente."), { status: 400 });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(n.key));
  const keyHash = Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2,"0")).join("");
  const { data: savedLookup, error: lookupError } = await db.from("fechou_pix_key_lookups").select("*").eq("id", lookupId).eq("user_id", user.id).maybeSingle();
  if (lookupError || !savedLookup) throw Object.assign(new Error("Consulta de titularidade não encontrada. Consulte a chave novamente."), { status: 404 });
  if (savedLookup.used_at || new Date(savedLookup.expires_at).getTime() < Date.now() ||
      savedLookup.pix_key_hash !== keyHash || savedLookup.pix_key_type !== n.type) {
    throw Object.assign(new Error("A consulta expirou, já foi utilizada ou não corresponde à chave informada. Consulte novamente."), { status: 409 });
  }
  const lookup = { owner_name: savedLookup.owner_name, owner_document_masked: savedLookup.owner_document_masked,
    bank_name: savedLookup.bank_name, bank_code: savedLookup.bank_code, ispb: savedLookup.ispb };
  const row = { user_id: user.id, provider: "asaas", pix_key: n.key, pix_key_type: n.type, last4: n.key.slice(-4),
    status: "verified", verified: true, verified_at: new Date().toISOString(), verified_by: user.id, confirmed_by_user: true,
    verification_reason: "Titularidade consultada no DICT por meio da API Asaas e confirmada pelo profissional.",
    metadata: { verification_source: "asaas_pix_external_key_lookup", verified_owner_name: lookup.owner_name,
      verified_owner_document_masked: lookup.owner_document_masked, verified_bank_name: lookup.bank_name,
      verified_bank_code: lookup.bank_code, verified_ispb: lookup.ispb, confirmed_by_user: true, confirmed_at: new Date().toISOString() },
    updated_at: new Date().toISOString() };
  const { error: writeError } = await db.from("fechou_payout_profiles").upsert(row, { onConflict: "user_id" });
  if (writeError) throw new Error("Não foi possível salvar a chave verificada: " + writeError.message);
  const { error: usedError } = await db.from("fechou_pix_key_lookups").update({ used_at: new Date().toISOString() }).eq("id", lookupId).eq("user_id", user.id).is("used_at", null);
  if (usedError) throw new Error(usedError.message);
  return { ok: true, lookup, message: "Chave Pix consultada e confirmada. Ela está liberada para solicitar repasses." };
}

async function serviceCancel(db: any, user: any, payload: any) {
  const orderId = clean(payload.order_id, 80), reason = clean(payload.reason || "Solicitação de cancelamento pelo cliente.", 1000);
  if (!validUuid(orderId)) throw Object.assign(new Error("Identificador de contratação inválido."), { status: 400 });
  const { data: claimed, error: claimError } = await db.rpc("fechou_ops_claim_cancel_order", { p_order_id: orderId, p_actor_id: user.id, p_reason: reason });
  if (claimError) throw Object.assign(new Error(claimError.message), { status: 409 });
  const result = obj(claimed);
  const { data: order, error: orderError } = await db.from("orders").select("id,client_id,professional_id,total,payment_status,payment_id,payment_method,refund_status,payment_metadata,metadata").eq("id", orderId).maybeSingle();
  if (orderError || !order) throw new Error("Não foi possível recarregar a contratação após o cancelamento.");
  if (result.action === "review") {
    await notify(db, String(order.client_id), orderId, "cancellation_review", "Cancelamento em análise", "A solicitação foi encaminhada para análise de até 24 horas. O pagamento permanece protegido enquanto as evidências são verificadas.", { event_key: "review" });
    if (order.professional_id) await notify(db, String(order.professional_id), orderId, "cancellation_review", "Solicitação de cancelamento em análise", "A contratação foi encaminhada para revisão. Consulte o histórico e as evidências no chat.", { event_key: "review" });
    return result;
  }
  if (result.action !== "refund") return result;
  const paymentId = clean(order.payment_id, 120);
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
    await db.from("orders").update({ refund_status: "review_required", metadata: { ...obj(order.metadata), auto_refund_state: "review_required", auto_refund_error: "payment_id_missing_or_invalid" }, updated_at: new Date().toISOString() }).eq("id", orderId);
    return { ...result, refund_status: "review_required", message: "Pedido cancelado. O identificador da cobrança ainda não pôde ser validado; o estorno foi encaminhado para análise financeira." };
  }
  try {
    const [payment, checkouts] = await Promise.all([
      asaas("/payments/" + encodeURIComponent(paymentId)),
      db.from("fechou_asaas_checkouts").select("external_reference,amount,provider_payload").eq("order_id", orderId).in("purpose", ["service", "prepublication"]).order("created_at", { ascending: false }).limit(3)
    ]);
    if (checkouts.error) throw new Error(checkouts.error.message);
    const providerRefunds = Array.isArray(payment.refunds) ? payment.refunds : [];
    if (String(payment.status || "").toUpperCase() === "REFUNDED" || providerRefunds.length > 0) {
      const now = new Date().toISOString();
      const note = "O Asaas já registra um estorno solicitado ou concluído para esta cobrança. Nova solicitação bloqueada para evitar devolução duplicada.";
      await db.from("orders").update({
        refund_status: "review_required",
        metadata: { ...obj(order.metadata), auto_refund_state: "existing_refund_detected", auto_refund_error: note, refund_provider_check_at: now },
        updated_at: now
      }).eq("id", orderId);
      const { data: existingCase } = await db.from("fechou_service_cases").select("id").eq("order_id", orderId).eq("case_type", "refund_provider_reconciliation").in("status", ["open","in_review"]).limit(1).maybeSingle();
      if (!existingCase) await db.from("fechou_service_cases").insert({
        order_id: orderId, opened_by: user.id, case_type: "refund_provider_reconciliation",
        reason: note, status: "open", response_due_at: new Date(Date.now() + 86400000).toISOString(),
        metadata: { payment_id: paymentId, amount: order.total, provider_refunds_count: providerRefunds.length }
      });
      await notify(db, String(order.client_id), orderId, "refund_review_required", "Estorno em conciliação", "O Asaas já possui um registro de estorno para esta cobrança. O FECHOU não enviou uma segunda solicitação; a equipe vai conferir o status.", { event_key: "existing_provider_refund" });
      return { ...result, refund_status: "review_required", message: "O Asaas já registra um estorno. Nenhuma nova solicitação foi enviada; caso encaminhado para conciliação." };
    }
    const checkout = (checkouts.data || []).find((x: any) => x.external_reference && String(x.external_reference) === String(payment.externalReference || ""));
    const expectedAmount = Number(checkout?.amount || 0), paidAmount = Number(payment.value || 0);
    if (!checkout || String(payment.id || "") !== paymentId || !["RECEIVED", "CONFIRMED"].includes(String(payment.status || "").toUpperCase()) ||
      !(expectedAmount > 0) || Math.abs(expectedAmount - paidAmount) > 0.02 ||
      String(payment.externalReference || "") !== String(checkout.external_reference)) {
      throw new Error("A cobrança não corresponde exatamente à contratação ou ainda não está confirmada no provedor.");
    }
    const billing = clean(obj(checkout?.provider_payload).billing_type || obj(checkout?.provider_payload).billingType || obj(order.payment_metadata).billing_type || obj(order.payment_metadata).billingType || obj(order.metadata).payment_billing_type || obj(order.metadata).billing_type || payment.billingType || "", 30).toUpperCase();
    let providerResult: any, requestUrl = "";
    if (billing === "BOLETO") {
      providerResult = await asaas("/payments/" + encodeURIComponent(paymentId) + "/bankSlip/refund", "POST", {});
      requestUrl = clean(providerResult.requestUrl || "", 1000);
      if (!requestUrl) throw new Error("O provedor não retornou a etapa de dados bancários para o estorno de boleto.");
    } else if (billing === "PIX" || billing === "CREDIT_CARD") {
      providerResult = await asaas("/payments/" + encodeURIComponent(paymentId) + "/refund", "POST", { description: clean("FECHOU: cancelamento antes de vínculo contratual ou início do serviço. Motivo: " + reason, 140).replace(/[\uD800-\uDBFF]$/, "") });
    } else throw new Error("A forma de pagamento exige conferência manual antes de solicitar o estorno.");
    const nextStatus = billing === "BOLETO" ? "bank_slip_action_required" : "pending";
    const nextMeta = { ...obj(order.metadata), refund_status: nextStatus, refund_requested_at: new Date().toISOString(), refund_reason: reason,
      refund_request_url: requestUrl || null, refund_provider: "asaas", refund_provider_status: clean(providerResult.status || "requested", 80), auto_refund_state: "provider_requested" };
    const { error: updateError } = await db.from("orders").update({ refund_status: nextStatus, metadata: nextMeta, updated_at: new Date().toISOString() }).eq("id", orderId);
    if (updateError) throw new Error(updateError.message);
    await db.from("fechou_wallet_ledger").upsert({
      user_id: order.client_id, order_id: orderId, entry_type: "refund", amount: Number(expectedAmount.toFixed(2)),
      status: "refund_pending", provider: "asaas", provider_reference: paymentId,
      description: billing === "BOLETO" ? "Estorno solicitado; aguardando dados bancários do cliente no provedor." : "Estorno solicitado ao provedor; aguardando confirmação.",
      idempotency_key: "refund:" + orderId, metadata: { billing_type: billing, request_url: requestUrl || null }
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    await notify(db, String(order.client_id), orderId, "refund_requested", "Solicitação de estorno enviada",
      billing === "BOLETO" ? "O provedor solicitou dados bancários para concluir o estorno. Acesse o link disponibilizado na carteira." : "O estorno foi solicitado ao provedor. A confirmação aparecerá na carteira após o retorno oficial.",
      { event_key: "refund", request_url: requestUrl || null });
    return { ...result, refund_status: nextStatus, request_url: requestUrl || null,
      message: billing === "BOLETO" ? "Pedido cancelado. Para concluir o estorno do boleto, informe os dados bancários no link do provedor." : "Pedido cancelado e estorno solicitado. O valor só será exibido como devolvido após confirmação do provedor." };
  } catch (error) {
    const errorText = clean((error as Error)?.message || error, 500);
    await db.from("orders").update({ refund_status: "review_required", metadata: { ...obj(order.metadata), auto_refund_state: "review_required", auto_refund_error: errorText }, updated_at: new Date().toISOString() }).eq("id", orderId);
    await db.from("fechou_service_cases").insert({ order_id: orderId, opened_by: user.id, case_type: "refund_provider_error",
      reason: "Falha ao solicitar estorno automático: " + errorText, status: "open", response_due_at: new Date(Date.now() + 86400000).toISOString(),
      metadata: { automatic_refund_failed: true } });
    await notify(db, String(order.client_id), orderId, "refund_review_required", "Estorno encaminhado para análise",
      "Não foi possível confirmar a solicitação automática ao provedor. A equipe financeira recebeu o caso e o pagamento permanece registrado para conferência.", { event_key: "provider_error" });
    return { ...result, refund_status: "review_required", message: "Pedido cancelado. O estorno não foi confirmado pelo provedor e foi encaminhado para análise financeira." };
  }
}

async function adminRefundCase(db: any, user: any, payload: any) {
  const caseId = clean(payload.case_id, 80);
  const reason = clean(payload.reason, 1500);
  if (!validUuid(caseId) || reason.length < 8) throw Object.assign(new Error("Informe um caso válido e uma justificativa com pelo menos 8 caracteres."), { status: 400 });
  const { data: item, error: caseError } = await db.from("fechou_service_cases").select("*").eq("id", caseId).maybeSingle();
  if (caseError || !item) throw Object.assign(new Error("Caso de análise não encontrado."), { status: 404 });
  if (String(item.status) === "resolved") throw Object.assign(new Error("Este caso já foi concluído."), { status: 409 });
  const orderId = String(item.order_id || "");
  const { data: order, error: orderError } = await db.from("orders").select("id,client_id,professional_id,total,payment_status,payment_id,refund_status,metadata,payment_metadata").eq("id", orderId).maybeSingle();
  if (orderError || !order) throw new Error("Contratação vinculada ao caso não encontrada.");
  if (!["approved","paid","received","confirmed"].includes(String(order.payment_status || "").toLowerCase())) throw Object.assign(new Error("O pagamento ainda não está confirmado. Não há estorno a executar."), { status: 409 });
  if (["pending","refund_pending","bank_slip_action_required","refunded"].includes(String(order.refund_status || "").toLowerCase())) throw Object.assign(new Error("Já existe uma solicitação de estorno ou uma devolução confirmada para esta contratação."), { status: 409 });
  const paymentId = clean(order.payment_id, 120);
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw Object.assign(new Error("Identificador da cobrança inválido; conciliação manual necessária."), { status: 409 });
  const { data: checkouts, error: checkoutError } = await db.from("fechou_asaas_checkouts").select("external_reference,amount,provider_payload").eq("order_id", orderId).in("purpose", ["service","prepublication"]).order("created_at", { ascending: false }).limit(5);
  if (checkoutError) throw new Error(checkoutError.message);
  const payment = await asaas("/payments/" + encodeURIComponent(paymentId));
  const checkout = (checkouts || []).find((x: any) => x.external_reference && String(x.external_reference) === String(payment.externalReference || ""));
  const amount = Number(checkout?.amount || 0);
  if (!checkout || String(payment.id || "") !== paymentId || !["RECEIVED","CONFIRMED"].includes(String(payment.status || "").toUpperCase()) || !(amount > 0) || Math.abs(amount - Number(payment.value || 0)) > 0.02) {
    throw Object.assign(new Error("A cobrança consultada não corresponde ao pagamento confirmado desta contratação."), { status: 409 });
  }
  const billing = clean(obj(checkout.provider_payload).billing_type || obj(checkout.provider_payload).billingType || obj(order.payment_metadata).billing_type || obj(order.payment_metadata).billingType || obj(order.metadata).payment_billing_type || obj(order.metadata).billing_type || payment.billingType || "", 30).toUpperCase();
  const { data: claim, error: claimError } = await db.from("orders").update({
    refund_status: "initiating", metadata: { ...obj(order.metadata), refund_admin_claimed_at: new Date().toISOString(), refund_admin_claimed_by: user.id },
    updated_at: new Date().toISOString()
  }).eq("id", orderId).eq("refund_status", "review_required").select("id").maybeSingle();
  if (claimError || !claim) throw Object.assign(new Error("Não foi possível reservar a solicitação para evitar um estorno duplicado. Atualize o caso."), { status: 409 });
  try {
    let providerResult: any, requestUrl = "";
    if (billing === "BOLETO") {
      providerResult = await asaas("/payments/" + encodeURIComponent(paymentId) + "/bankSlip/refund", "POST", {});
      requestUrl = clean(providerResult.requestUrl || "", 1000);
      if (!requestUrl) throw new Error("O Asaas não retornou o link necessário para o cliente informar os dados bancários.");
    } else if (billing === "PIX" || billing === "CREDIT_CARD") {
      providerResult = await asaas("/payments/" + encodeURIComponent(paymentId) + "/refund", "POST", { description: clean("FECHOU: reembolso aprovado após análise administrativa. Motivo: " + reason, 140).replace(/[\uD800-\uDBFF]$/, "") });
    } else throw new Error("Esta forma de pagamento exige conciliação manual com o provedor.");
    const status = billing === "BOLETO" ? "bank_slip_action_required" : "pending";
    const metadata = { ...obj(order.metadata), refund_status: status, refund_requested_at: new Date().toISOString(), refund_reason: reason,
      refund_request_url: requestUrl || null, refund_provider: "asaas", refund_provider_status: clean(providerResult.status || "requested", 80), refund_admin_decision_by: user.id };
    const { error: updateError } = await db.from("orders").update({ status: "cancelled", service_state: "cancelled", refund_status: status, metadata, updated_at: new Date().toISOString() }).eq("id", orderId);
    if (updateError) throw new Error(updateError.message);
    const { error: ledgerError } = await db.from("fechou_wallet_ledger").upsert({
      user_id: order.client_id, order_id: orderId, entry_type: "refund", amount: Number(amount.toFixed(2)), status: "refund_pending",
      provider: "asaas", provider_reference: paymentId,
      description: billing === "BOLETO" ? "Estorno aprovado; aguardando dados bancários no provedor." : "Estorno aprovado e solicitado; aguardando confirmação do provedor.",
      idempotency_key: "refund:" + orderId, metadata: { billing_type: billing, request_url: requestUrl || null }
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (ledgerError) throw new Error(ledgerError.message);
    const { error: updateCaseError } = await db.from("fechou_service_cases").update({
      status: "resolved", decision: "refund", decision_reason: reason, decided_by: user.id, decided_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq("id", caseId).eq("status", "open");
    if (updateCaseError) throw new Error(updateCaseError.message);
    await db.from("fechou_admin_audit").insert({ actor_id: user.id, action: "refund_requested", target_type: "order", target_id: orderId, reason,
      metadata: { case_id: caseId, billing_type: billing, amount, provider: "asaas", provider_status: clean(providerResult.status || "requested", 80) } });
    await notify(db, String(order.client_id), orderId, "refund_requested", "Reembolso aprovado e solicitado",
      billing === "BOLETO" ? "O Asaas exige que você informe os dados bancários para concluir o estorno. Abra o link na carteira." : "O reembolso foi solicitado ao provedor. A carteira será atualizada após a confirmação oficial.",
      { event_key: "admin_refund", request_url: requestUrl || null });
    return { ok: true, refund_status: status, request_url: requestUrl || null,
      message: billing === "BOLETO" ? "Decisão registrada. O cliente precisa informar os dados bancários no link do Asaas." : "Reembolso solicitado ao Asaas; aguardando confirmação do provedor." };
  } catch (error) {
    const message = clean((error as Error)?.message || error, 500);
    await db.from("orders").update({ refund_status: "review_required",
      metadata: { ...obj(order.metadata), refund_status: "review_required", refund_error: message, refund_failed_at: new Date().toISOString() },
      updated_at: new Date().toISOString() }).eq("id", orderId);
    throw Object.assign(new Error("Não foi possível concluir o pedido de estorno ao provedor: " + message + ". O caso continua em análise."), { status: 502 });
  }
}


async function financeData(db: any) {
  const [checkouts, ledger, payoutRequests, payoutProfiles, transfers, orders, drafts] = await Promise.all([
    db.from("orders").select("id,metadata").limit(10000),
    db.from("fechou_prepublication_drafts").select("id,published_order_id,payload").limit(10000),
    db.from("fechou_asaas_checkouts").select("id,checkout_id,external_reference,purpose,user_id,order_id,plan,amount,status,subscription_status,asaas_customer_id,asaas_subscription_id,created_at,updated_at,provider_payload").order("created_at",{ascending:false}).limit(500),
    db.from("fechou_wallet_ledger").select("id,user_id,order_id,entry_type,amount,currency,status,provider,provider_reference,description,created_at").order("created_at",{ascending:false}).limit(1000),
    db.from("fechou_wallet_payout_requests").select("id,user_id,order_id,amount,status,pix_key_type,pix_key_last4,review_reason,created_at,updated_at").order("created_at",{ascending:false}).limit(500),
    db.from("fechou_payout_profiles").select("user_id,provider,pix_key_type,last4,status,verified,verified_at,verification_reason,metadata,updated_at").order("updated_at",{ascending:false}).limit(500),
    db.from("fechou_wallet_asaas_transfers").select("id,payout_request_id,user_id,order_id,admin_id,attempt_number,external_reference,asaas_transfer_id,amount,pix_key_type,pix_key_last4,reason,status,provider_status,fail_reason,transaction_receipt_url,effective_at,created_at,updated_at").order("created_at",{ascending:false}).limit(500)
  ]);
  for (const [name, result] of Object.entries({orders,drafts,checkouts,ledger,payoutRequests,payoutProfiles,transfers})) if ((result as any).error) throw new Error("Falha ao consultar "+name+": "+(result as any).error.message);
  const testOrderIds = new Set((orders.data||[]).filter((x:any)=>{
    const m=obj(x.metadata);
    return m.temporary_test_price===true || String(m.temporary_test_price||"").trim().toLowerCase()==="true";
  }).map((x:any)=>String(x.id)));
  const testDraftIds = new Set((drafts.data||[]).filter((x:any)=>{
    const payload=obj(x.payload), metadata=obj(payload.metadata);
    return (x.published_order_id&&testOrderIds.has(String(x.published_order_id))) ||
      metadata.temporary_test_price===true || String(metadata.temporary_test_price||"").trim().toLowerCase()==="true";
  }).map((x:any)=>String(x.id)));
  const isTestLinkedOrder=(id:any)=>Boolean(id&&(testOrderIds.has(String(id))||testDraftIds.has(String(id))));
  const markTest=(x:any)=>({...x,test_mode:isTestLinkedOrder(x.order_id)});
  const safeCheckouts=(checkouts.data||[]).map((x:any)=>{
    const p=obj(x.provider_payload);
    return {id:x.id,checkout_id:x.checkout_id,external_reference:x.external_reference,purpose:x.purpose,user_id:x.user_id,order_id:x.order_id,
      plan:x.plan,amount:x.amount,status:x.status,subscription_status:x.subscription_status,asaas_customer_id:x.asaas_customer_id,test_mode:isTestLinkedOrder(x.order_id),
      asaas_subscription_id:x.asaas_subscription_id,created_at:x.created_at,updated_at:x.updated_at,
      billing_type:clean(p.billing_type||p.billingType||"",30),provider_payment_status:clean(p.status||p.paymentStatus||"",60),
      provider_payment_id:clean(p.payment_id||p.paymentId||p.id||"",100)};
  });
  const safeProfiles=(payoutProfiles.data||[]).map((x:any)=>{
    const m=obj(x.metadata);
    return {user_id:x.user_id,provider:x.provider,pix_key_type:x.pix_key_type,key_last4:x.last4,status:x.status,verified:x.verified,
      verified_at:x.verified_at,verification_reason:x.verification_reason,owner_name:clean(m.verified_owner_name||"",180),
      owner_document_masked:clean(m.verified_owner_document_masked||"",40),bank_name:clean(m.verified_bank_name||"",180),
      bank_code:clean(m.verified_bank_code||"",30),updated_at:x.updated_at};
  });
  return {ok:true,checkouts:safeCheckouts,ledger:(ledger.data||[]).map(markTest),payout_requests:(payoutRequests.data||[]).map(markTest),payout_profiles:safeProfiles,transfers:(transfers.data||[]).map(markTest)};
}

Deno.serve(async (req: Request) => {
  const originCheck = originDecision(req.headers.get("origin") || "");
  if (req.method === "OPTIONS") {
    if (!originCheck.allowed) return new Response("Origem não autorizada.", { status: 403, headers: { "Cache-Control": "no-store", "Vary": "Origin" } });
    return new Response(null, { status: 204, headers: {
      ...(originCheck.normalized ? { "Access-Control-Allow-Origin": originCheck.normalized } : {}),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-retry-count, x-fechou-request-id",
      "Access-Control-Max-Age": "86400", "Vary": "Origin"
    }});
  }
  if (!originCheck.allowed) return reply(req, 403, { ok: false, error: "Origem não autorizada." });
  if (req.method !== "POST") return reply(req, 405, { ok: false, error: "Método não permitido." });
  try {
    const auth = await authenticate(req), body = obj(await req.json().catch(() => ({}))), action = clean(body.action, 100);
    const db = auth.admin, user = auth.user;
    if (action === "presence/heartbeat") {
      const session = clean(body.session_id, 80);
      if (!/^[a-zA-Z0-9_-]{12,80}$/.test(session)) throw Object.assign(new Error("Sessão de presença inválida."), { status: 400 });
      const { data: profile } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
      const screen = clean(body.screen, 80).replace(/[^a-zA-Z0-9_:-]/g, "");
      const { error } = await db.from("fechou_ops_presence").upsert({ user_id: user.id, session_id: session, role: clean(profile?.role || "", 40),
        screen: screen || null, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "user_id,session_id" });
      if (error) throw new Error(error.message);
      await db.from("fechou_ops_presence").delete().lt("last_seen_at", new Date(Date.now() - 7 * 86400000).toISOString());
      return reply(req, 200, { ok: true });
    }
    if (action === "wallet/lookup-pix") return reply(req, 200, await walletLookupPix(db, user, body));
    if (action === "wallet/confirm-pix") return reply(req, 200, await walletConfirmPix(db, user, body));
    if (action === "service/cancel") return reply(req, 200, await serviceCancel(db, user, body));
    await requireAdmin(db, user.id);
    if (action === "admin/overview") return reply(req, 200, { ok: true, overview: await overview(db) });
    if (action === "admin/finance-data") return reply(req, 200, await financeData(db));
    if (action === "admin/verify-duplicate-payment") {
      const orderId = clean(body.order_id, 80);
      if (!validUuid(orderId)) throw Object.assign(new Error("Identificador da contratação inválido."), { status: 400 });
      if (!ASAAS_KEY) throw Object.assign(new Error("Integração Asaas indisponível para consulta."), { status: 503 });
      const { data: reviewRows, error: reviewError } = await db.from("fechou_ops_events")
        .select("payload,created_at").eq("event_type", "payment_duplicate_review").eq("entity_id", orderId)
        .order("created_at", { ascending: false }).limit(1);
      if (reviewError) throw new Error("Não foi possível localizar o registro de revisão financeira: " + reviewError.message);
      const review = reviewRows?.[0];
      if (!review) throw Object.assign(new Error("Não existe revisão de pagamento duplicado para esta contratação."), { status: 404 });
      const evidence = obj(review.payload);
      const ids = [...new Set([clean(evidence.payment_id, 100), clean(evidence.canonical_payment_id, 100)].filter(Boolean))];
      if (ids.length !== 2) throw Object.assign(new Error("A evidência não contém dois identificadores de cobrança distintos."), { status: 409 });
      const payments = await Promise.all(ids.map(async (paymentId: string) => {
        try {
          const p = await asaas("/payments/" + encodeURIComponent(paymentId));
          const refunds = Array.isArray(p.refunds) ? p.refunds.map((r: any) => ({
            status: clean(r.status || "", 40), value: Number(r.value || 0),
            date_created: r.dateCreated || null
          })) : [];
          const refundDone = refunds.some((r: any) => String(r.status).toUpperCase() === "DONE");
          return {
            payment_id: paymentId, found: true, status: clean(p.status || "", 50),
            value: Number(p.value || 0), net_value: Number(p.netValue || 0),
            billing_type: clean(p.billingType || "", 40), date_created: p.dateCreated || null,
            confirmed_date: p.confirmedDate || null, payment_date: p.paymentDate || null,
            checkout_session: clean(p.checkoutSession || "", 120) || null,
            external_reference: clean(p.externalReference || "", 180) || null,
            refund_done: refundDone, refunds
          };
        } catch (error) {
          return {
            payment_id: paymentId, found: false,
            error: clean((error as Error)?.message || "Não foi possível consultar a cobrança.", 250),
            provider_status: Number((error as any)?.providerStatus) || null
          };
        }
      }));
      const confirmed = payments.filter((p: any) => p.found && ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"].includes(String(p.status).toUpperCase()) && !p.refund_done);
      const allFound = payments.every((p: any) => p.found);
      const sameAmount = allFound && Math.abs(Number(payments[0].value) - Number(payments[1].value)) <= 0.01;
      let classification = "needs_manual_review";
      if (ASAAS_ENV === "sandbox" && allFound) classification = "sandbox_records_only";
      else if (ASAAS_ENV === "sandbox" && !allFound) classification = "sandbox_key_lookup_incomplete";
      else if (confirmed.length === 2 && sameAmount) classification = "two_confirmed_charges_check_refund";
      else if (payments.some((p: any) => p.refund_done || String(p.status).toUpperCase() === "REFUNDED")) classification = "refund_found_verify_completion";
      else if (!allFound) classification = "provider_lookup_incomplete";
      return reply(req, 200, {
        ok: true, read_only: true, environment: ASAAS_ENV, classification,
        checked_at: new Date().toISOString(), order_id: orderId, payments,
        warning: "Consulta somente leitura. Nenhum estorno, cancelamento, alteração de pedido ou movimentação financeira foi executado."
      });
    }
    if (action === "admin/reconcile-stale-subscription-checkouts") {
      if (!ASAAS_KEY) throw Object.assign(new Error("Integração Asaas indisponível para conciliação."), { status: 503 });
      const { data: rows, error: rowsError } = await db.from("fechou_asaas_checkouts")
        .select("id,checkout_id,external_reference,created_at,status,provider_payload,subscription_status")
        .eq("purpose","subscription").in("status",["active","pending"])
        .is("asaas_subscription_id",null).not("checkout_id","is",null)
        .order("created_at",{ascending:true}).limit(100);
      if(rowsError)throw new Error("Não foi possível localizar checkouts antigos: "+rowsError.message);
      const candidates=(rows||[]).filter((row:any)=>obj(row.provider_payload).manual_cycle!==true);
      if(!candidates.length)return reply(req,200,{ok:true,read_only:false,checked:0,expired:0,payment_review:0,pending:0,lookup_failed:0,results:[]});
      const oldest=candidates[0].created_at;
      const {data:paymentEvents,error:eventError}=await db.from("fechou_asaas_webhook_events")
        .select("payload").in("event_name",["PAYMENT_CREATED","PAYMENT_UPDATED","PAYMENT_CONFIRMED","PAYMENT_RECEIVED"])
        .gte("received_at",oldest).order("received_at",{ascending:false}).limit(500);
      if(eventError)throw new Error("Não foi possível cruzar os webhooks de pagamento: "+eventError.message);
      const eventPayments=new Map<string,any>();
      for(const row of paymentEvents||[]){
        const payment=obj(obj(row.payload).payment);
        const session=clean(payment.checkoutSession||"",160);
        const status=String(payment.status||"").toUpperCase();
        if(session&&payment.id&&["CONFIRMED","RECEIVED","RECEIVED_IN_CASH"].includes(status)&&!eventPayments.has(session))eventPayments.set(session,payment);
      }
      const results:any[]=[];
      const now=Date.now();
      for(const row of candidates){
        const payload=obj(row.provider_payload);
        const checkoutId=clean(row.checkout_id||"",160);
        const ttl=Math.max(10,Math.min(1440,Number(payload.minutesToExpire||1440)));
        const age=Math.max(0,Math.floor((now-Date.parse(String(row.created_at||"")))/60000));
        if(!checkoutId||!Number.isFinite(age)||age<ttl){
          results.push({checkout:checkoutId.slice(-8),result:"not_expired",age_minutes:age,expires_after_minutes:ttl});
          continue;
        }
        let providerPayments:any[]=[];
        let lookupError="";
        try{
          const response=await asaas("/payments?checkoutSession="+encodeURIComponent(checkoutId)+"&limit=10");
          providerPayments=Array.isArray(response.data)?response.data:[];
        }catch(error){
          lookupError=clean((error as Error)?.message||"Falha na consulta Asaas.",240);
        }
        const providerPaid=providerPayments.find((p:any)=>["CONFIRMED","RECEIVED","RECEIVED_IN_CASH"].includes(String(p.status||"").toUpperCase()));
        const providerOpen=providerPayments.find((p:any)=>!["CONFIRMED","RECEIVED","RECEIVED_IN_CASH","REFUNDED","DELETED","CANCELED","CANCELLED","OVERDUE"].includes(String(p.status||"").toUpperCase()));
        const eventPayment=eventPayments.get(checkoutId)||null;
        const payment=providerPaid||providerOpen||eventPayment;
        if(lookupError&&!payment){
          results.push({checkout:checkoutId.slice(-8),result:"lookup_failed",age_minutes:age,expires_after_minutes:ttl,error:lookupError});
          continue;
        }
        const stamp=new Date().toISOString();
        if(payment){
          const paid=Boolean(providerPaid||(["CONFIRMED","RECEIVED","RECEIVED_IN_CASH"].includes(String(payment.status||"").toUpperCase())));
          const patchPayload={...payload,reconciliation_at:stamp,reconciliation_state:paid?"paid_payment_found_manual_review":"open_payment_found",reconciled_payment_id:clean(payment.id||"",100)||null,reconciled_payment_status:clean(payment.status||"",50)||null};
          const {error:updateError}=await db.from("fechou_asaas_checkouts").update({
            status:"pending",subscription_status:paid?"PAYMENT_REVIEW":clean(payment.status||"PENDING",50).toUpperCase(),
            provider_payload:patchPayload,updated_at:stamp
          }).eq("id",row.id).eq("status",row.status);
          if(updateError){results.push({checkout:checkoutId.slice(-8),result:"update_failed",error:clean(updateError.message,220)});continue;}
          results.push({checkout:checkoutId.slice(-8),result:paid?"payment_review":"pending_payment",payment_status:clean(payment.status||"",50),age_minutes:age});
          continue;
        }
        const {error:updateError}=await db.from("fechou_asaas_checkouts").update({
          status:"expired",subscription_status:"EXPIRED",
          provider_payload:{...payload,checkout_expired_reconciled_at:stamp,checkout_reconciled_empty:true,reconciliation_state:"expired_no_payment_after_ttl"},
          updated_at:stamp
        }).eq("id",row.id).eq("status",row.status);
        if(updateError){results.push({checkout:checkoutId.slice(-8),result:"update_failed",error:clean(updateError.message,220)});continue;}
        results.push({checkout:checkoutId.slice(-8),result:"expired_no_payment",age_minutes:age,expires_after_minutes:ttl});
      }
      return reply(req,200,{
        ok:true,read_only:false,environment:ASAAS_ENV,checked:results.length,
        expired:results.filter(x=>x.result==="expired_no_payment").length,
        payment_review:results.filter(x=>x.result==="payment_review").length,
        pending:results.filter(x=>x.result==="pending_payment").length,
        lookup_failed:results.filter(x=>x.result==="lookup_failed").length,
        not_expired:results.filter(x=>x.result==="not_expired").length,
        results,warning:"Nenhuma cobrança, assinatura, transferência ou estorno foi criado. Apenas estados locais de checkouts vencidos foram reconciliados após consulta ao Asaas."
      });
    }
    if (action === "admin/events") {
      const limit = Math.min(200, Math.max(1, Number(body.limit || 100)));
      const { data, error } = await db.from("fechou_ops_events").select("id,event_type,entity_table,entity_id,actor_id,payload,created_at").order("id", { ascending: false }).limit(limit);
      if (error) throw new Error(error.message);
      return reply(req, 200, { ok: true, events: data || [] });
    }
    if (action === "admin/cases") return reply(req, 200, { ok: true, cases: await casesList(db) });
    if (action === "admin/refund-case") return reply(req, 200, await adminRefundCase(db, user, body));
    if (action === "admin/users") return reply(req, 200, { ok: true, users: await usersList(db) });
    if (action === "admin/orders") return reply(req, 200, { ok: true, orders: await ordersList(db) });
    if (action === "admin/audit") {
      const { data, error } = await db.from("fechou_admin_audit").select("id,actor_id,action,target_type,target_id,reason,metadata,created_at").order("created_at", { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      return reply(req, 200, { ok: true, audit: data || [] });
    }
    return reply(req, 404, { ok: false, error: "Ação não encontrada." });
  } catch (error) {
    const status = Number((error as any)?.status) || 500;
    console.error("FECHOU ops-api", clean((error as Error)?.message || error, 600));
    return reply(req, status, { ok: false, error: clean((error as Error)?.message || "Falha interna.", 600) });
  }
});
