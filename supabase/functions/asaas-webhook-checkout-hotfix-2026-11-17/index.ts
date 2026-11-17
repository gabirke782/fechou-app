// FECHOU — Supabase Edge Function: asaas-webhook V64 — payment review recovery
// Recebe eventos Asaas. O header asaas-access-token deve corresponder ao secret ASAAS_WEBHOOK_TOKEN.
// Não marca pagamento por redirect do navegador; somente eventos validados do Asaas.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://ziubcqxmxialhmwevtiy.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const WEBHOOK_TOKEN = (Deno.env.get("ASAAS_WEBHOOK_TOKEN") || Deno.env.get("ASAAS_WEBHOOK_SECRET") || "").trim();
const ASAAS_API_KEY = (Deno.env.get("ASAAS_API_KEY") || Deno.env.get("ASAAS_ACCESS_TOKEN") || "").trim();
const ASAAS_KEY_ENV = ASAAS_API_KEY.startsWith("$aact_hmlg_") ? "sandbox" : ASAAS_API_KEY.startsWith("$aact_prod_") ? "production" : "";
const ASAAS_BASE_CONFIG = (Deno.env.get("ASAAS_BASE_URL") || "").trim();
const ASAAS_BASE_ENV = /api-sandbox\.asaas\.com/i.test(ASAAS_BASE_CONFIG) ? "sandbox" : /api\.asaas\.com/i.test(ASAAS_BASE_CONFIG) ? "production" : "";
const ASAAS_ENV_CONFIG = (Deno.env.get("ASAAS_ENV") || "").trim().toLowerCase();
const ASAAS_ENV = ASAAS_KEY_ENV || ASAAS_BASE_ENV || ASAAS_ENV_CONFIG || "production";
const ASAAS_BASE = (ASAAS_ENV === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3");
const corsHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function obj(v: any): Record<string, any> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return {}; } }
  return {};
}
function s(v: any, n = 1000) { return String(v ?? "").trim().slice(0, n); }
function isTemporaryTestOrder(order:any):boolean{
  const metadata=obj(order?.metadata);
  return metadata.temporary_test_price===true||String(metadata.temporary_test_price||"").trim().toLowerCase()==="true";
}
function normalizePixKeyForFingerprint(value: string) {
  const key = String(value || "").trim();
  return /^[+()\d\s.-]+$/.test(key) ? key.replace(/\D/g, "") : key.toLowerCase();
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function webhookPayloadForStorage(body: any, event: string) {
  if (!event.startsWith("TRANSFER_")) return body;
  const transfer = obj(body?.transfer);
  const rawPixKey = s(transfer.pixAddressKey || obj(transfer.bankAccount).pixAddressKey, 250);
  const rawFailReason = s(transfer.failReason, 1000);
  const safeFailReason = rawPixKey ? rawFailReason.split(rawPixKey).join(`[CHAVE PIX OCULTA · FINAL ${rawPixKey.slice(-4)}]`) : rawFailReason;
  return {
    id: s(body?.id, 250), event, dateCreated: s(body?.dateCreated, 80),
    transfer: {
      id: s(transfer.id, 180), externalReference: s(transfer.externalReference, 200),
      status: s(transfer.status, 40), type: s(transfer.type, 60),
      value: Number(transfer.value || 0), effectiveDate: transfer.effectiveDate || null,
      failReason: safeFailReason || null,
      transactionReceiptUrl: s(transfer.transactionReceiptUrl, 1500) || null,
      operationType: s(transfer.operationType, 20), description: s(transfer.description, 250),
    },
  };
}
function secureEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
function db() {
  if (!SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente.");
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function getOrder(admin: any, orderId: string) {
  const { data, error } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error || !data) throw new Error(`Pedido não encontrado para o evento Asaas: ${error?.message || orderId}`);
  const metadata = obj(data.metadata);
  return { ...data, metadata };
}
async function createLedgerEntry(admin: any, row: Record<string, any>) {
  const { data, error } = await admin.rpc("fechou_upsert_wallet_ledger_entry", {
    p_user_id: String(row.user_id || ""),
    p_order_id: String(row.order_id || ""),
    p_entry_type: String(row.entry_type || ""),
    p_amount: Number(row.amount),
    p_status: String(row.status || "pending"),
    p_description: String(row.description || ""),
    p_provider: String(row.provider || "asaas"),
    p_provider_reference: row.provider_reference || row.provider_ref || null,
    p_metadata: obj(row.metadata),
  });
  if (error) throw new Error(`Falha ao sincronizar o extrato na rotina transacional: ${error.message}`);
  if (!data?.id) throw new Error("A rotina financeira não retornou o lançamento confirmado.");
  return data;
}

async function applyMonthlyIntroRecurringRate(admin: any, link: any, subscriptionId: string) {
  const initialAmount = Number(link?.amount || 0);
  if (link?.purpose !== "subscription" || String(link?.plan || "").toLowerCase() !== "mensal" || Math.abs(initialAmount - 9.99) > 0.001) return;
  if (String(link?.status || "").toLowerCase() !== "paid" || !subscriptionId) return;
  if (!ASAAS_API_KEY) throw new Error("ASAAS_API_KEY ausente no webhook; não foi possível ajustar a recorrência mensal após o primeiro pagamento.");

  const { data: profile, error: profileError } = await admin.from("profiles").select("profile_data").eq("id", link.user_id).maybeSingle();
  if (profileError || !profile) throw new Error(`Não foi possível conferir o perfil da assinatura promocional: ${profileError?.message || link.user_id}`);
  const pd = obj(profile.profile_data);
  const current = obj(pd.subscription);
  const pending = obj(pd.subscription_checkout_pending);
  if ((String(current.intro_rate_subscription_id || "") === subscriptionId && current.intro_rate_adjusted_at) ||
      (String(pending.intro_rate_subscription_id || "") === subscriptionId && pending.intro_rate_adjusted_at)) return;
  const currentStatus = String(current.status || "").toLowerCase();
  const activeCurrentSubscription = ["active", "authorized"].includes(currentStatus);
  const sameCurrentSubscription = String(current.id || "") === subscriptionId ||
    String(current.checkout_id || "") === String(link.checkout_id || "");
  const samePendingCheckout = String(pending.checkout_id || "") === String(link.checkout_id || "");
  // Não sobrescreve uma assinatura ativa diferente; ainda pode ajustar o checkout promocional que está pendente na mesma conta.
  if (!sameCurrentSubscription && !samePendingCheckout) return;

  const response = await fetch(`${ASAAS_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "FECHOU/1.0", "access_token": ASAAS_API_KEY },
    body: JSON.stringify({ value: 15.99 }),
  });
  const raw = await response.text();
  let result: any = {};
  try { result = raw ? JSON.parse(raw) : {}; } catch { result = { raw }; }
  if (!response.ok) {
    const detail = s(result?.errors?.[0]?.description || result?.message || raw || `HTTP ${response.status}`, 900);
    throw new Error(`A primeira cobrança mensal foi confirmada, mas a atualização da recorrência para R$ 15,99 falhou: ${detail}`);
  }

  const now = new Date().toISOString();
  const introAudit = { intro_rate_subscription_id: subscriptionId, intro_rate_adjusted_at: now, updated_at: now };
  if (sameCurrentSubscription || !activeCurrentSubscription) {
    pd.subscription = {
      ...current, provider: "asaas", id: subscriptionId, plan: "mensal", amount: 15.99,
      recurring_amount: 15.99, introductory_amount: 9.99, ...introAudit,
    };
  } else {
    pd.subscription_checkout_pending = {
      ...pending, provider: "asaas", id: subscriptionId, plan: "mensal", amount: 9.99,
      recurring_amount: 15.99, introductory_amount: 9.99, ...introAudit,
    };
  }
  const { error: saveError } = await admin.from("profiles").update({ profile_data: pd }).eq("id", link.user_id);
  if (saveError) throw new Error(`A recorrência foi atualizada no provedor, mas o perfil não foi sincronizado: ${saveError.message}`);
}

async function updateOrderForCheckout(admin: any, link: any, event: string, checkout: any, payment: any = {}) {
  if (!link.order_id || !["CHECKOUT_PAID", "CHECKOUT_CANCELED", "CHECKOUT_EXPIRED"].includes(event)) return;
  const order = await getOrder(admin, String(link.order_id));
  const meta = { ...order.metadata, payment_provider: "asaas", payment_checkout_id: checkout.id || link.checkout_id, last_asaas_event: event };
  if (event === "CHECKOUT_PAID") {
    meta.payment_state = "held";
    const { error } = await admin.from("orders").update({
      metadata: meta, payment_status: "approved", paid_at: new Date().toISOString(),
    }).eq("id", order.id);
    if (error) throw new Error(`Não foi possível confirmar o pedido no banco: ${error.message}`);
    await createLedgerEntry(admin, {
      user_id: order.client_id, order_id: String(order.id), entry_type: "service_payment",
      amount: Number(link.amount || order.total || 0), status: "held",
      description: "Pagamento de serviço confirmado pelo webhook do Asaas.",
    });
    let professionalId = String(order.professional_id || "");
    if (!professionalId && order.selected_proposal_id) {
      const { data: proposal, error: proposalError } = await admin.from("proposals").select("professional_id").eq("id", order.selected_proposal_id).maybeSingle();
      if (proposalError) throw new Error(`Falha ao localizar o profissional da contratação: ${proposalError.message}`);
      professionalId = String(proposal?.professional_id || "");
    }
    const gross = Number(order.total || link.amount || checkout.value || 0);
    const orderMetaBefore = obj(order.metadata);
    const professionalPayoutBase = Number(orderMetaBefore.professional_payout_base || gross);
    const professionalNet = professionalId ? Number((professionalPayoutBase * 0.98).toFixed(2)) : 0;
    if (professionalId && professionalNet > 0 && professionalPayoutBase >= professionalNet) {
      const platformFee = Number((professionalPayoutBase - professionalNet).toFixed(2));
      const orderMeta = { ...orderMetaBefore, professional_payout_base: professionalPayoutBase,
        professional_net: professionalNet, platform_fee: platformFee,
        platform_commission_rate: 2, real_money_paid: true, temporary_test_payout_blocked: false };
      const { error: financialUpdateError } = await admin.from("orders").update({
        professional_net: professionalNet, platform_fee: platformFee,
        metadata: orderMeta, updated_at: new Date().toISOString()
      }).eq("id", String(order.id));
      if (financialUpdateError) throw new Error("Pagamento confirmado, mas a composição do repasse profissional não pôde ser atualizada: " + financialUpdateError.message);
      await createLedgerEntry(admin, {
        user_id: professionalId, order_id: String(order.id), entry_type: "payout",
        amount: Number(professionalNet.toFixed(2)), status: "held", provider: "asaas",
        provider_reference: String(payment.id || order.payment_id || ""),
        description: "Valor líquido do pagamento real reservado; aguarda conclusão e confirmação do cliente.",
        metadata: { real_money_paid: true, temporary_test_price: isTemporaryTestOrder(order),
          gross_amount: gross, platform_commission_rate: 2, payment_id: String(payment.id || "") }
      });
    }
  } else {
    const status = event === "CHECKOUT_CANCELED" ? "cancelled" : "expired";
    meta.payment_state = status;
    const { error } = await admin.from("orders").update({ metadata: meta, payment_status: status }).eq("id", order.id);
    if (error) throw new Error(`Não foi possível atualizar o status do checkout: ${error.message}`);
  }
}
async function updateSubscriptionForCheckout(admin: any, link: any, event: string, checkout: any) {
  if (!link.user_id) return;
  const { data: profile, error } = await admin.from("profiles").select("profile_data").eq("id", link.user_id).maybeSingle();
  if (error || !profile) throw new Error(`Perfil da assinatura não encontrado: ${error?.message || link.user_id}`);
  const now = new Date().toISOString();
  const pd = obj(profile.profile_data);
  const current = obj(pd.subscription);
  if (current.provider === "manual_test" && String(current.plan || "").toLowerCase() === "teste") {
    console.info("FECHOU: evento Asaas ignorado para preservar o marcador do Plano Teste manual (ativo ou revogado).", { user_id: link.user_id, event });
    return;
  }
  const providerCustomerId = s(checkout.customer,160) || s(link.asaas_customer_id,160);
  const providerSubscriptionId = s(checkout.subscription || checkout.subscriptionId,160) || s(link.asaas_subscription_id,160);
  const linkPatch:any={updated_at:now,provider_payload:checkout};
  if(providerCustomerId)linkPatch.asaas_customer_id=providerCustomerId;
  if(providerSubscriptionId)linkPatch.asaas_subscription_id=providerSubscriptionId;
  const {error:linkSaveError}=await admin.from("fechou_asaas_checkouts").update(linkPatch).eq("id",link.id);
  if(linkSaveError)throw new Error("Não foi possível salvar o cliente/assinatura retornado pelo Checkout: "+linkSaveError.message);
  const pending = {
    ...obj(pd.subscription_checkout_pending), provider: "asaas", checkout_id: checkout.id || link.checkout_id,
    external_reference: link.external_reference || null, plan: link.plan || null,
    customer_id: providerCustomerId || null, subscription_id: providerSubscriptionId || null,
    amount: Number(link.amount || 0),
    recurring_amount: String(link.plan || "").toLowerCase() === "mensal" && Math.abs(Number(link.amount || 0) - 9.99) < 0.001 ? 15.99 : Number(link.amount || 0),
    introductory_amount: String(link.plan || "").toLowerCase() === "mensal" && Math.abs(Number(link.amount || 0) - 9.99) < 0.001 ? 9.99 : null,
    checkout_status: event === "CHECKOUT_PAID" ? "paid" : event.toLowerCase().replace("checkout_", ""),
    updated_at: now,
  };
  pd.subscription_checkout_pending = pending;
  if(providerCustomerId)pd.asaas_customer_id=providerCustomerId;
  const hasActiveSubscription = ["active", "authorized"].includes(String(current.status || "").toLowerCase());
  const sameExistingCheckout = String(current.checkout_id || "") === String(checkout.id || link.checkout_id || "");
  if (!hasActiveSubscription || sameExistingCheckout) {
    pd.subscription = {
      ...current, ...pending, id: current.id || null,
      amount: Number(pending.recurring_amount || pending.amount || 0),
      status: hasActiveSubscription && sameExistingCheckout ? current.status : event === "CHECKOUT_PAID" ? "pending" : event === "CHECKOUT_CANCELED" ? "cancelled" : "expired",
      provider_status: hasActiveSubscription && sameExistingCheckout ? current.provider_status || current.status : current.provider_status || null,
      updated_at: now,
    };
  }
  const { error: updateError } = await admin.from("profiles").update({ profile_data: pd }).eq("id", link.user_id);
  if (updateError) throw new Error(`Não foi possível atualizar assinatura: ${updateError.message}`);
}
async function applyTransferEvent(admin: any, body: any) {
  const event = s(body.event, 100).toUpperCase();
  const transfer = obj(body.transfer);
  const transferId = s(transfer.id, 180);
  if (!transferId) throw new Error("Evento de transferência sem transfer.id.");
  let { data: attempt, error: attemptError } = await admin.from("fechou_wallet_asaas_transfers")
    .select("*").eq("asaas_transfer_id", transferId).maybeSingle();
  if (attemptError) throw new Error(`Falha ao localizar tentativa Pix pelo ID Asaas: ${attemptError.message}`);
  const providerValue = Number(transfer.value);
  if (!Number.isFinite(providerValue) || providerValue <= 0) throw new Error("O webhook de transferência não trouxe um valor válido para conciliação.");
  const operationType = s(transfer.operationType, 20).toUpperCase();
  if (operationType && operationType !== "PIX") throw new Error("O evento vinculado à tentativa FECHOU não corresponde a uma transferência Pix.");
  if (!attempt) {
    // O webhook pode chegar antes da resposta do POST /transfers ser persistida.
    // Prefere externalReference; se não vier no evento, exige impressão digital exata da chave.
    const externalReference = s(transfer.externalReference, 200);
    if (externalReference) {
      const byReference = await admin.from("fechou_wallet_asaas_transfers").select("*")
        .eq("external_reference", externalReference).maybeSingle();
      if (byReference.error) throw new Error(`Falha ao localizar tentativa Pix pela referência externa: ${byReference.error.message}`);
      attempt = byReference.data;
    }
    if (!attempt) {
      const pixKey = s(transfer.pixAddressKey || obj(transfer.bankAccount).pixAddressKey, 250);
      const fingerprint = pixKey ? await sha256Hex(normalizePixKeyForFingerprint(pixKey)) : "";
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const candidatesResult = await admin.from("fechou_wallet_asaas_transfers").select("*")
        .in("status", ["initiating", "unknown"]).gte("created_at", since)
        .eq("amount", providerValue).order("created_at", { ascending: false }).limit(10);
      if (candidatesResult.error) throw new Error(`Falha ao procurar tentativa Pix sem ID Asaas: ${candidatesResult.error.message}`);
      const candidates = (candidatesResult.data || []).filter((row: any) => fingerprint && String(row.pix_key_fingerprint || "") === fingerprint);
      if (candidates.length === 1) {
        attempt = candidates[0];
        console.warn("FECHOU: tentativa Pix conciliada pela impressão digital da chave e valor porque o webhook chegou antes da resposta do POST.", { attempt_id: attempt.id, transfer_id: transferId });
      } else if (candidates.length > 1 || (candidatesResult.data || []).length > 0) {
        throw new Error("Webhook chegou antes do ID local e não foi possível fazer conciliação exata e única. O evento será reenviado.");
      } else {
        console.warn("Evento de transferência Asaas sem tentativa FECHOU vinculada.", { event, transfer_id: transferId });
        return;
      }
    }
  }
  if (Math.abs(Math.round(providerValue * 100) - Math.round(Number(attempt.amount || 0) * 100)) !== 0) {
    throw new Error("O valor do webhook Asaas não confere com o valor reservado para esta transferência.");
  }
  const eventPixKey = s(transfer.pixAddressKey || obj(transfer.bankAccount).pixAddressKey, 250);
  if (eventPixKey) {
    const eventFingerprint = await sha256Hex(normalizePixKeyForFingerprint(eventPixKey));
    if (String(attempt.pix_key_fingerprint || "") !== eventFingerprint) {
      throw new Error("A chave Pix informada no webhook não corresponde à impressão digital reservada nesta tentativa.");
    }
  }
  const eventMap: Record<string, string> = {
    TRANSFER_CREATED: "pending", TRANSFER_PENDING: "pending",
    TRANSFER_IN_BANK_PROCESSING: "in_bank_processing", TRANSFER_BLOCKED: "blocked",
    TRANSFER_DONE: "done", TRANSFER_FAILED: "failed", TRANSFER_CANCELLED: "cancelled",
  };
  const eventStatus = eventMap[event];
  if (!eventStatus) return;
  const providerStatus = s(transfer.status, 40).toUpperCase();
  const providerMap: Record<string, string> = {
    PENDING: "pending", SCHEDULED: "pending", BANK_PROCESSING: "in_bank_processing",
    IN_BANK_PROCESSING: "in_bank_processing", BLOCKED: "blocked",
    FAILED: "failed", CANCELLED: "cancelled", CANCELED: "cancelled",
  };
  if (event === "TRANSFER_DONE" && providerStatus && providerStatus !== "DONE") {
    throw new Error(`Evento TRANSFER_DONE contradiz o status informado pelo Asaas (${providerStatus}); conciliação bloqueada.`);
  }
  // Status DONE numa fotografia antiga do objeto não substitui o evento de conclusão.
  // Somente o nome explícito TRANSFER_DONE autoriza mapear para done.
  const mapped = event === "TRANSFER_DONE" ? "done" : (providerMap[providerStatus] || eventStatus);
  const current = String(attempt.status || "initiating").toLowerCase();
  const rank: Record<string, number> = { initiating: 0, unknown: 0, pending: 1, in_bank_processing: 2, blocked: 3, failed: 4, cancelled: 4, done: 5 };
  // Os eventos podem chegar fora de sequência; não rebaixar o estado já persistido.
  if ((rank[mapped] ?? 0) < (rank[current] ?? 0)) return;
  const now = new Date().toISOString();
  const receipt = s(transfer.transactionReceiptUrl, 1500);
  let receiptUrl = "";
  try { const parsed = new URL(receipt); if (parsed.protocol === "https:") receiptUrl = parsed.toString(); } catch (_) {}
  const attemptPatch: Record<string, any> = {
    asaas_transfer_id: transferId,
    status: mapped,
    provider_status: s(transfer.status || event.replace("TRANSFER_", ""), 60).toUpperCase(),
    fail_reason: s(transfer.failReason || "", 1400) || null,
    transaction_receipt_url: receiptUrl || null,
    effective_at: transfer.effectiveDate ? new Date(transfer.effectiveDate).toISOString() : null,
    updated_at: now,
  };
  const { error: updateAttemptError } = await admin.from("fechou_wallet_asaas_transfers").update(attemptPatch).eq("id", attempt.id);
  if (updateAttemptError) throw new Error(`Falha ao atualizar status da transferência Pix: ${updateAttemptError.message}`);
  if (mapped === "done") {
    const { data: request, error: requestError } = await admin.from("fechou_wallet_payout_requests")
      .select("id,user_id,order_id,amount").eq("id", attempt.payout_request_id).maybeSingle();
    if (requestError || !request) throw new Error(`Solicitação vinculada à transferência não encontrada: ${requestError?.message || attempt.payout_request_id}`);
    const { data: ledgerRow, error: ledgerReadError } = await admin.from("fechou_wallet_ledger").select("status")
      .eq("user_id", request.user_id).eq("order_id", request.order_id).eq("entry_type", "payout").maybeSingle();
    if (ledgerReadError || !ledgerRow) throw new Error(`Não foi possível localizar o lançamento do repasse: ${ledgerReadError?.message || "sem lançamento"}`);
    if (String(ledgerRow.status || "") !== "paid") {
      if (String(ledgerRow.status || "") !== "release_ready") throw new Error(`O lançamento do repasse está em estado inesperado: ${ledgerRow.status}`);
      const { error: ledgerError } = await admin.from("fechou_wallet_ledger").update({
        status: "paid", description: `Pix transferido pelo Asaas (ID ${transferId}).`, updated_at: now,
      }).eq("user_id", request.user_id).eq("order_id", request.order_id).eq("entry_type", "payout").eq("status", "release_ready");
      if (ledgerError) throw new Error(`Não foi possível confirmar o repasse no extrato: ${ledgerError.message}`);
    }
    const { error: requestUpdateError } = await admin.from("fechou_wallet_payout_requests").update({
      status: "paid", review_reason: "Transferência Pix confirmada pelo evento TRANSFER_DONE do Asaas.", updated_at: now,
    }).eq("id", request.id);
    if (requestUpdateError) throw new Error(`Não foi possível concluir a solicitação de repasse: ${requestUpdateError.message}`);
    const { error: orderUpdateError } = await admin.from("orders").update({
      payout_status: "paid", payout_id: transferId, payout_transfer_id: transferId,
      released_at: now, payout_error: null, updated_at: now,
    }).eq("id", request.order_id);
    if (orderUpdateError) throw new Error(`Transferência confirmada, mas estado do pedido não atualizado: ${orderUpdateError.message}`);
  } else if (["failed", "cancelled"].includes(mapped)) {
    const reason = s(transfer.failReason || `Asaas informou ${event}.`, 1000);
    const { error: requestUpdateError } = await admin.from("fechou_wallet_payout_requests").update({
      status: "under_review", review_reason: reason, updated_at: now,
    }).eq("id", attempt.payout_request_id).neq("status", "paid");
    if (requestUpdateError) throw new Error(`Falha ao devolver solicitação para análise após falha Pix: ${requestUpdateError.message}`);
  } else if (mapped === "blocked") {
    const { error: requestUpdateError } = await admin.from("fechou_wallet_payout_requests").update({
      status: "under_review", review_reason: "O Asaas bloqueou a transferência. Verifique o motivo no painel antes de qualquer nova ação.", updated_at: now,
    }).eq("id", attempt.payout_request_id).neq("status", "paid");
    if (requestUpdateError) throw new Error(`Falha ao atualizar solicitação bloqueada: ${requestUpdateError.message}`);
  } else {
    const { error: requestUpdateError } = await admin.from("fechou_wallet_payout_requests").update({
      status: "transfer_pending", review_reason: "Transferência em processamento no Asaas; aguardando evento de conclusão.", updated_at: now,
    }).eq("id", attempt.payout_request_id).neq("status", "paid");
    if (requestUpdateError) throw new Error(`Falha ao atualizar solicitação em processamento: ${requestUpdateError.message}`);
  }
}


async function v195AsaasPrepayPublish(admin:any,externalReference:string,payment:any,eventId:string,event:string){
 const parts=externalReference.match(/^fechou-prepay:([0-9a-f-]{36}):([0-9a-f-]{36})$/i);
 if(!parts)return false;
 const draftId=parts[1],quoteId=parts[2];
 const {data:d,error}=await admin.from("fechou_prepublication_drafts").select("*").eq("id",draftId).maybeSingle();
 if(error)throw new Error("Falha ao consultar rascunho pré-pago: "+error.message);
 if(!d)throw new Error("Evento Asaas sem rascunho correspondente.");
 const {data:link,error:le}=await admin.from("fechou_asaas_checkouts").select("*").eq("external_reference",externalReference).eq("purpose","prepublication").maybeSingle();
 if(le)throw new Error("Falha ao consultar cobrança vinculada: "+le.message);
 if(!link)throw new Error("Cobrança pré-paga sem vínculo local.");
 const confirmed=["PAYMENT_RECEIVED","PAYMENT_CONFIRMED"].includes(event);
 const amount=Number(payment.value||0),expected=Number(d.payment_total||link.amount||0);
 const currency=String(payment.currency||"BRL").toUpperCase();
 if(confirmed){
  if(currency!=="BRL"||!payment.id||!Number.isFinite(amount)||Math.abs(Math.round(amount*100)-Math.round(expected*100))>1) {
   await admin.from("fechou_prepublication_drafts").update({status:"payment_review",updated_at:new Date().toISOString()}).eq("id",draftId);
   throw new Error("Pagamento pré-pago não confere em moeda/valor; publicação bloqueada para revisão.");
  }
  if(d.status==="cancelled"||d.status==="expired"){
   await admin.from("fechou_prepublication_drafts").update({status:"payment_review",payment_id:payment.id,updated_at:new Date().toISOString()}).eq("id",draftId);
   await admin.from("fechou_prepublication_events").upsert({draft_id:draftId,event_key:"late-paid:"+String(eventId),event_type:"payment_after_cancel_or_expiry",payload:{payment_id:payment.id,amount,event},created_at:new Date().toISOString()},{onConflict:"event_key"});
   throw new Error("Pagamento confirmado após cancelamento/expiração; não publicar automaticamente. Revisão financeira necessária.");
  }
  const {data:published,error:rpcError}=await admin.rpc("fechou_publish_prepaid_draft",{
   p_draft_id:draftId,p_payment_id:String(payment.id),p_paid_amount:amount,p_billing_type:String(payment.billingType||d.billing_type||""),p_event_id:String(eventId)
  });
  if(rpcError)throw new Error("Falha ao publicar pedido após webhook: "+rpcError.message);
  const publishedOrderId=String(published?.order?.id||published?.order_id||draftId);
  if(obj(obj(d.payload).metadata).temporary_test_price===true){
   const {data:testOrder,error:testOrderError}=await admin.from("orders").select("metadata").eq("id",publishedOrderId).maybeSingle();
   if(testOrderError||!testOrder)throw new Error("Não foi possível marcar a contratação de teste após o pagamento: "+(testOrderError?.message||publishedOrderId));
   const testMeta={...obj(testOrder.metadata),temporary_test_price:true,temporary_test_payment_only:true,temporary_test_price_brl:6,temporary_test_payment_confirmed_at:new Date().toISOString()};
   const {error:privateTestError}=await admin.from("orders").update({status:"Recebendo propostas (modo de teste)",metadata:testMeta,updated_at:new Date().toISOString()}).eq("id",publishedOrderId);
   if(privateTestError)throw new Error("Pagamento recebido, mas não foi possível restringir o pedido de teste ao fluxo administrativo: "+privateTestError.message);
  }
  const base=Number(d.amount||0);
  if(base>0)await createLedgerEntry(admin,{user_id:String(d.client_id),order_id:publishedOrderId,entry_type:"service_payment",amount:base,status:"held",provider:"asaas",provider_reference:String(payment.id),description:"Valor do serviço pago e reservado após confirmação autenticada Asaas.",metadata:{source:"prepublication_webhook",payment_id:String(payment.id)}});
  const {data:financialOrder,error:financialOrderError}=await admin.from("orders").select("id,professional_id,selected_proposal_id,professional_net,total,metadata").eq("id",publishedOrderId).maybeSingle();
  if(financialOrderError||!financialOrder)throw new Error("Pagamento confirmado e pedido publicado, mas não foi possível consultar a composição financeira: "+(financialOrderError?.message||publishedOrderId));
  let payoutUser=String(financialOrder.professional_id||"");
  if(!payoutUser&&financialOrder.selected_proposal_id){
   const {data:selectedProposal,error:proposalError}=await admin.from("proposals").select("professional_id").eq("id",financialOrder.selected_proposal_id).maybeSingle();
   if(proposalError)throw new Error("Não foi possível identificar o profissional selecionado para o extrato: "+proposalError.message);
   payoutUser=String(selectedProposal?.professional_id||"");
  }
  const payoutGross=Number(financialOrder.total||base);
  const financialMetaBefore=obj(financialOrder.metadata);
  const professionalPayoutBase=Number(financialMetaBefore.professional_payout_base||payoutGross);
  const payoutNet=Number((professionalPayoutBase*0.98).toFixed(2));
  if(payoutUser&&payoutNet>0&&professionalPayoutBase>=payoutNet){
   const platformFee=Number((professionalPayoutBase-payoutNet).toFixed(2));
   const financialMeta={...financialMetaBefore,professional_payout_base:professionalPayoutBase,professional_net:payoutNet,platform_fee:platformFee,platform_commission_rate:2,real_money_paid:true,temporary_test_payout_blocked:false};
   const {error:financialUpdateError}=await admin.from("orders").update({professional_net:payoutNet,platform_fee:platformFee,metadata:financialMeta,updated_at:new Date().toISOString()}).eq("id",publishedOrderId);
   if(financialUpdateError)throw new Error("Pagamento confirmado, mas a composição do repasse não foi atualizada: "+financialUpdateError.message);
   await createLedgerEntry(admin,{user_id:payoutUser,order_id:publishedOrderId,entry_type:"payout",amount:payoutNet,status:"held",provider:"asaas",provider_reference:String(payment.id),description:"Valor líquido do pagamento real reservado; aguarda a conclusão e a confirmação do cliente.",metadata:{source:"prepublication_webhook",payment_id:String(payment.id),gross_amount:professionalPayoutBase,professional_payout_base:professionalPayoutBase,platform_fee:platformFee,platform_commission_rate:2,real_money_paid:true,temporary_test_price:isTemporaryTestOrder(financialOrder),temporary_test_payout_blocked:false}});
  }
  await admin.from("fechou_asaas_checkouts").update({status:"paid",provider_payload:{...obj(link.provider_payload),last_payment_event:event,payment_id:payment.id,payment_status:payment.status||event},updated_at:new Date().toISOString()}).eq("id",link.id);
 }else if(event==="PAYMENT_OVERDUE"||event==="PAYMENT_DELETED"||event==="PAYMENT_CANCELED"){
  const next=event==="PAYMENT_OVERDUE"?"expired":"cancelled";
  if(["awaiting_payment","payment_pending"].includes(String(d.status)))await admin.from("fechou_prepublication_drafts").update({status:next,updated_at:new Date().toISOString()}).eq("id",draftId);
  await admin.from("fechou_asaas_checkouts").update({status:next,provider_payload:{...obj(link.provider_payload),last_payment_event:event,payment_id:payment.id},updated_at:new Date().toISOString()}).eq("id",link.id);
 }else if(event==="PAYMENT_REFUNDED"){
  const {data:refundDraft,error:refundDraftError}=await admin.from("fechou_prepublication_drafts").select("published_order_id,client_id,amount").eq("id",draftId).maybeSingle();
  if(refundDraftError)throw new Error("Falha ao conciliar rascunho estornado: "+refundDraftError.message);
  await admin.from("fechou_prepublication_drafts").update({status:"payment_review",updated_at:new Date().toISOString()}).eq("id",draftId);
  await admin.from("fechou_prepublication_events").upsert({draft_id:draftId,event_key:"refunded:"+String(eventId),event_type:"payment_refunded_after_publication",payload:{payment_id:payment.id,amount,event},created_at:new Date().toISOString()},{onConflict:"event_key"});
  if(refundDraft?.published_order_id){
    const published=await getOrder(admin,String(refundDraft.published_order_id));
    const refundMeta={...published.metadata,payment_state:"refunded",refund_status:"refunded",refund_event_id:String(eventId),refund_payment_id:String(payment.id||""),refund_confirmed_at:new Date().toISOString()};
    const {error:refundOrderError}=await admin.from("orders").update({
      metadata:refundMeta,payment_status:"refunded",refund_status:"refunded",refund_at:new Date().toISOString(),updated_at:new Date().toISOString()
    }).eq("id",published.id);
    if(refundOrderError)throw new Error("Reembolso confirmado mas não atualizado no pedido: "+refundOrderError.message);
    await createLedgerEntry(admin,{user_id:String(refundDraft.client_id),order_id:String(published.id),entry_type:"refund",amount:Number(refundDraft.amount||0),status:"refunded",description:"Reembolso do valor do serviço confirmado pelo Asaas.",provider:"asaas",provider_reference:String(payment.id||""),metadata:{event_id:eventId,external_reference:externalReference}});
    await createLedgerEntry(admin,{user_id:String(refundDraft.client_id),order_id:String(published.id),entry_type:"service_payment",amount:Number(refundDraft.amount||0),status:"refunded",description:"Valor do serviço originalmente reservado; estorno confirmado pelo Asaas.",provider:"asaas",provider_reference:String(payment.id||""),metadata:{event_id:eventId,external_reference:externalReference}});
  }
 }
 return true;
}

async function v195AsaasCheckoutPaid(admin:any,link:any,checkout:any,eventId:string,event:string){
 if(link.purpose!=="prepublication")return false;
 const externalReference=String(link.external_reference||checkout.externalReference||"");
 if(event!=="CHECKOUT_PAID"){
  const {data:d,error:draftReadError}=await admin.from("fechou_prepublication_drafts")
    .select("id,status,payload").eq("id",String(link.order_id)).maybeSingle();
  if(draftReadError)throw new Error("Não foi possível localizar a solicitação para atualizar o checkout encerrado: "+draftReadError.message);
  const nextStatus=event==="CHECKOUT_CANCELED"?"cancelled":"expired";
  if(d&&["awaiting_payment","payment_pending"].includes(String(d.status||""))){
    // A tentativa de checkout foi encerrada, mas o cliente não cancelou o pedido.
    // Retorna o rascunho à etapa de pagamento para permitir outro meio de cobrança.
    const payload=obj(d.payload),metadata=obj(payload.metadata);
    const {error:reopenError}=await admin.from("fechou_prepublication_drafts").update({
      status:"awaiting_payment",payment_total:null,payment_id:null,external_reference:null,
      billing_type:null,terms_version:null,terms_accepted_at:null,
      payload:{...payload,metadata:{...metadata,last_checkout_ended_event:event,last_checkout_ended_at:new Date().toISOString()}},
      updated_at:new Date().toISOString()
    }).eq("id",d.id).in("status",["awaiting_payment","payment_pending"]);
    if(reopenError)throw new Error("O checkout foi encerrado, mas a solicitação não voltou à etapa de pagamento: "+reopenError.message);
  }
  const {error:checkoutUpdateError}=await admin.from("fechou_asaas_checkouts").update({
    status:nextStatus,provider_payload:checkout,updated_at:new Date().toISOString()
  }).eq("id",link.id).neq("status","paid");
  if(checkoutUpdateError)throw new Error("Não foi possível registrar o encerramento da tentativa de checkout: "+checkoutUpdateError.message);
  return true;
 }
 if(!ASAAS_API_KEY)throw new Error("ASAAS_API_KEY não configurada para reconciliar checkout recebido.");
 // Um evento CHECKOUT_PAID pode chegar depois do PAYMENT_RECEIVED e o Asaas nem sempre
 // retorna a cobrança pela externalReference do checkout. Se o pedido já foi aprovado
 // por webhook autenticado, trate o evento repetido como idempotente.
 const {data:alreadyOrder,error:alreadyOrderError}=await admin.from("orders")
  .select("payment_status,payment_id,metadata").eq("id",String(link.order_id)).maybeSingle();
 if(alreadyOrderError)throw new Error("Não foi possível conferir a confirmação financeira já registrada: "+alreadyOrderError.message);
 if(String(alreadyOrder?.payment_status||"").toLowerCase()==="approved"&&alreadyOrder?.payment_id){
  const checkoutId=String(checkout?.id||link.checkout_id||"");
  const {data:paymentEvents,error:paymentEventsError}=await admin.from("fechou_asaas_webhook_events").select("payload")
   .in("event_name",["PAYMENT_CREATED","PAYMENT_UPDATED","PAYMENT_CONFIRMED","PAYMENT_RECEIVED"])
   .order("received_at",{ascending:false}).limit(100);
  if(paymentEventsError)throw new Error("Não foi possível conferir eventos de pagamento já recebidos para esta sessão: "+paymentEventsError.message);
  const sessionPayment=(paymentEvents||[]).map((row:any)=>obj(obj(row.payload).payment))
   .find((p:any)=>String(p.checkoutSession||"")===checkoutId&&p.id&&["CONFIRMED","RECEIVED","RECEIVED_IN_CASH"].includes(String(p.status||"").toUpperCase()));
  if(sessionPayment?.id&&String(sessionPayment.id)!==String(alreadyOrder.payment_id)){
   await v195FlagDuplicatePrepayPayment(admin,link,sessionPayment,String(alreadyOrder.payment_id),eventId,"PAYMENT_CONFIRMED");
   return true;
  }
  console.info("FECHOU Asaas: CHECKOUT_PAID repetido; pedido já aprovado por cobrança conciliada.",{order_id:link.order_id,payment_id:alreadyOrder.payment_id});
  return true;
 }
 const headers={"access_token":ASAAS_API_KEY,"Accept":"application/json","User-Agent":"FECHOU/1.0"};
 const fetchRows=async(url:string)=>{
  const response=await fetch(ASAAS_BASE+url,{headers});
  const raw=await response.text();let body:any={};try{body=raw?JSON.parse(raw):{}}catch{body={}}
  if(!response.ok)throw new Error("HTTP "+response.status);
  return Array.isArray(body.data)?body.data:[];
 };
 let rows:any[]=[];
 try{rows=await fetchRows("/payments?externalReference="+encodeURIComponent(externalReference)+"&limit=100");}
 catch(error){console.warn("FECHOU Asaas: busca por externalReference falhou; tentando checkoutSession.",text((error as Error)?.message||error,200));}
 let paid=rows.find((x:any)=>["RECEIVED","CONFIRMED","RECEIVED_IN_CASH"].includes(String(x.status||"").toUpperCase())&&Math.abs(Number(x.value||0)-Number(link.amount||0))<0.011&&String(x.currency||"BRL").toUpperCase()==="BRL");
 if(!paid){
  const checkoutId=String(checkout?.id||link.checkout_id||"");
  if(checkoutId){
   try{
    const bySession=await fetchRows("/payments?checkoutSession="+encodeURIComponent(checkoutId)+"&limit=100");
    paid=bySession.find((x:any)=>["RECEIVED","CONFIRMED","RECEIVED_IN_CASH"].includes(String(x.status||"").toUpperCase())&&Math.abs(Number(x.value||0)-Number(link.amount||0))<0.011&&String(x.currency||"BRL").toUpperCase()==="BRL"&&(!x.checkoutSession||String(x.checkoutSession)===checkoutId));
   }catch(error){console.warn("FECHOU Asaas: busca por checkoutSession não concluiu.",text((error as Error)?.message||error,200));}
  }
 }
 if(!paid)throw new Error("Checkout retornou CHECKOUT_PAID, mas a cobrança ainda não pôde ser conciliada por externalReference ou checkoutSession com valor/estado idênticos. Publicação bloqueada.");
 return await v195AsaasPrepayPublish(admin,externalReference,paid,eventId,"PAYMENT_RECEIVED");
}

async function v195FlagDuplicatePrepayPayment(admin:any,link:any,payment:any,existingPaymentId:string,eventId:string,event:string,reason="Uma segunda cobrança confirmada foi associada ao mesmo pedido."){
 const match=String(link.external_reference||"").match(/^fechou-prepay:([0-9a-f-]{36}):([0-9a-f-]{36})$/i);
 if(!match)throw new Error("Não foi possível identificar o rascunho do possível pagamento duplicado.");
 const draftId=match[1],paymentId=String(payment?.id||"");
 if(!paymentId)throw new Error("Evento de possível pagamento duplicado sem ID de cobrança.");
 const now=new Date().toISOString();
 const eventType=event==="PAYMENT_REFUNDED"?"duplicate_payment_refunded":event==="PAYMENT_REVIEW"?"payment_review":"duplicate_payment_review";
 const detail={
  order_id:String(link.order_id||draftId),checkout_id:String(payment.checkoutSession||link.checkout_id||""),
  payment_id:paymentId,existing_payment_id:String(existingPaymentId||"")||null,
  amount:Number(payment.value||0),currency:String(payment.currency||"BRL").toUpperCase(),
  billing_type:String(payment.billingType||""),provider_event:event,event_id:String(eventId||""),
  reason,detected_at:now
 };
 const {error:eventError}=await admin.from("fechou_prepublication_events").upsert({
  draft_id:draftId,event_key:eventType+":"+paymentId,event_type:eventType,payload:detail,created_at:now
 },{onConflict:"event_key"});
 if(eventError)throw new Error("Não foi possível registrar a revisão do possível pagamento duplicado: "+eventError.message);
 const {error:linkError}=await admin.from("fechou_asaas_checkouts").update({
  provider_payload:{...obj(link.provider_payload),[eventType]:detail},updated_at:now
 }).eq("id",link.id);
 if(linkError)throw new Error("Não foi possível anexar a evidência ao checkout: "+linkError.message);
 console.error("FECHOU CRITICAL: pagamento adicional associado a pedido já pago; nenhuma nova publicação ou movimentação foi executada.",{
  order_id:detail.order_id,payment_id:paymentId,existing_payment_id:detail.existing_payment_id,event
 });
 return true;
}

async function v195HandlePrepayPaymentByCheckoutSession(admin:any,link:any,payment:any,eventId:string,event:string){
 const match=String(link.external_reference||"").match(/^fechou-prepay:([0-9a-f-]{36}):([0-9a-f-]{36})$/i);
 if(!match)return false;
 const draftId=match[1];
 const {data:draft,error:draftError}=await admin.from("fechou_prepublication_drafts").select("id,status,payment_id,published_order_id,payment_total").eq("id",draftId).maybeSingle();
 if(draftError)throw new Error("Falha ao localizar o rascunho do checkout por sessão: "+draftError.message);
 if(!draft)throw new Error("Checkout por sessão sem rascunho FECHOU correspondente.");
 const incomingId=String(payment?.id||"");
 const currentId=String(draft.payment_id||"");
 if(String(draft.status||"")==="published"){
  if(incomingId&&incomingId===currentId)return true;
  if(["PAYMENT_CONFIRMED","PAYMENT_RECEIVED","PAYMENT_REFUNDED"].includes(event)){
   await v195FlagDuplicatePrepayPayment(admin,link,payment,currentId,eventId,event);
  }
  return true;
 }
 if(String(draft.status||"")==="payment_review"){
  await v195FlagDuplicatePrepayPayment(admin,link,payment,currentId,eventId,"PAYMENT_REVIEW","O rascunho já estava em revisão financeira; o evento foi registrado sem publicar o pedido.");
  return true;
 }
 if(!["awaiting_payment","payment_pending","cancelled","expired"].includes(String(draft.status||""))){
  console.warn("FECHOU Asaas: pagamento por sessão não aplicado devido ao estado do rascunho.",{draft_id:draftId,status:draft.status,event});
  return true;
 }
 await v195AsaasPrepayPublish(admin,String(link.external_reference),payment,eventId,event);
 return true;
}

async function applyEvent(admin: any, body: any) {
  let event = s(body.event, 100).toUpperCase();
  let payment = obj(body.payment);
  if (["PAYMENT_CREATED","PAYMENT_UPDATED","PAYMENT_CONFIRMED","PAYMENT_RECEIVED"].includes(event) &&
      payment.id && ["CONFIRMED","RECEIVED","RECEIVED_IN_CASH"].includes(String(payment.status||"").toUpperCase())) {
    if (!ASAAS_API_KEY) throw new Error("ASAAS_API_KEY ausente para verificar o estado real da cobrança.");
    const verifyResponse = await fetch(ASAAS_BASE + "/payments/" + encodeURIComponent(s(payment.id,160)), {
      method: "GET", headers: { "accept": "application/json", "access_token": ASAAS_API_KEY },
    });
    const verifyBody = await verifyResponse.json().catch(()=>({}));
    if (!verifyResponse.ok) throw new Error("Não foi possível verificar o pagamento informado no evento diretamente no Asaas.");
    const verified = obj(verifyBody);
    const verifiedStatus = String(verified.status||"").toUpperCase();
    if (verifiedStatus === "CONFIRMED" || verifiedStatus === "RECEIVED" || verifiedStatus === "RECEIVED_IN_CASH") {
      payment = {...payment,...verified,externalReference:verified.externalReference||payment.externalReference||null,checkoutSession:verified.checkoutSession||payment.checkoutSession||null};
      event = verifiedStatus === "CONFIRMED" ? "PAYMENT_CONFIRMED" : "PAYMENT_RECEIVED";
      body = { ...body, event, payment };
    }
  }
  const checkout = obj(body.checkout);
  const subscription = obj(body.subscription);
  if (event.startsWith("TRANSFER_")) {
    await applyTransferEvent(admin, body);
    return;
  }
  if (event.startsWith("CHECKOUT_")) {
    const checkoutId = s(checkout.id, 160);
    if (!checkoutId) return;
    let { data: link, error } = await admin.from("fechou_asaas_checkouts").select("*").eq("checkout_id", checkoutId).maybeSingle();
    if (error) throw new Error(`Falha ao localizar checkout: ${error.message}`);
    if (!link && checkout.externalReference) {
      const fallback = await admin.from("fechou_asaas_checkouts").select("*")
        .eq("external_reference", s(checkout.externalReference, 200)).maybeSingle();
      if (fallback.error) throw new Error(`Falha ao localizar checkout pela referência: ${fallback.error.message}`);
      link = fallback.data;
    }
    if (!link) { console.warn("Checkout Asaas sem vínculo local:", checkoutId); return; }
    const { error: updateLinkError } = await admin.from("fechou_asaas_checkouts").update({
      status: event === "CHECKOUT_PAID" ? "paid" : event === "CHECKOUT_CANCELED" ? "cancelled" : event === "CHECKOUT_EXPIRED" ? "expired" : "active",
      asaas_customer_id: s(checkout.customer, 160) || link.asaas_customer_id || null,
      provider_payload: body, updated_at: new Date().toISOString(),
    }).eq("checkout_id", checkoutId);
    if (updateLinkError) throw new Error(`Falha ao registrar evento de checkout: ${updateLinkError.message}`);
    if (link.purpose === "prepublication") {
      await v195AsaasCheckoutPaid(admin,link,checkout,s(body.id,250),event);
      return;
    }
    if (link.purpose === "subscription") {
      await updateSubscriptionForCheckout(admin, link, event, checkout);
      if (event === "CHECKOUT_PAID") {
        const { data: paidLink, error: paidLinkError } = await admin.from("fechou_asaas_checkouts").select("*").eq("checkout_id", checkoutId).maybeSingle();
        if (paidLinkError) throw new Error(`Falha ao recuperar a assinatura após a confirmação do checkout: ${paidLinkError.message}`);
        if (paidLink?.asaas_subscription_id) await applyMonthlyIntroRecurringRate(admin, { ...paidLink, status: "paid" }, String(paidLink.asaas_subscription_id));
      }
    } else await updateOrderForCheckout(admin, link, event, checkout, payment);
    return;
  }

  if (event.startsWith("SUBSCRIPTION_")) {
    const externalReference = s(subscription.externalReference, 200);
    const subscriptionId = s(subscription.id, 160);
    const customerId = s(subscription.customer, 160);
    let link: any = null;
    if (externalReference) {
      const byReference = await admin.from("fechou_asaas_checkouts").select("*")
        .eq("external_reference", externalReference).eq("purpose", "subscription").maybeSingle();
      if (byReference.error) throw new Error(`Falha ao localizar assinatura pela referência: ${byReference.error.message}`);
      link = byReference.data;
    }
    if (!link && subscriptionId) {
      const bySubscription = await admin.from("fechou_asaas_checkouts").select("*")
        .eq("asaas_subscription_id", subscriptionId).eq("purpose", "subscription").maybeSingle();
      if (bySubscription.error) throw new Error(`Falha ao localizar assinatura pelo ID Asaas: ${bySubscription.error.message}`);
      link = bySubscription.data;
    }
    // O payload oficial de SUBSCRIPTION_* fornece subscription.customer. O webhook
    // CHECKOUT_CREATED/PAID salva o mesmo customer no checkout local para vincular
    // mesmo quando o campo subscription.externalReference vier vazio.
    if (!link && customerId) {
      const byCustomer = await admin.from("fechou_asaas_checkouts").select("*")
        .eq("asaas_customer_id", customerId).eq("purpose", "subscription").in("status", ["paid", "active"])
        .order("created_at", { ascending: false }).limit(1);
      if (byCustomer.error) throw new Error(`Falha ao localizar checkout da assinatura pelo cliente Asaas: ${byCustomer.error.message}`);
      link = byCustomer.data?.[0] || null;
    }
    if (!link?.user_id) {
      console.warn("Evento de assinatura Asaas sem vínculo local confiável:", { event, subscriptionId, customerId, externalReference });
      return;
    }
    const now = new Date().toISOString();
    const providerStatus = s(subscription.status, 40).toUpperCase();
    const firstPaymentConfirmed = String(link.status||"").toLowerCase()==="paid";
    const status = event === "SUBSCRIPTION_DELETED" ? "cancelled"
      : event === "SUBSCRIPTION_INACTIVATED" ? "inactive"
      : providerStatus === "ACTIVE" ? (firstPaymentConfirmed ? "active" : "pending")
      : providerStatus === "INACTIVE" ? "inactive"
      : providerStatus === "EXPIRED" ? "expired"
      : String(obj(subscription).deleted ? "cancelled" : "pending");
    const { error: linkUpdateError } = await admin.from("fechou_asaas_checkouts").update({
      asaas_subscription_id: subscriptionId || link.asaas_subscription_id || null,
      asaas_customer_id: customerId || link.asaas_customer_id || null,
      subscription_status: providerStatus || status, provider_payload: body, updated_at: now,
    }).eq("id", link.id);
    if (linkUpdateError) throw new Error(`Falha ao registrar o ID/status da recorrência Asaas: ${linkUpdateError.message}`);

    const { data: profile, error: profileError } = await admin.from("profiles").select("profile_data").eq("id", link.user_id).maybeSingle();
    if (profileError || !profile) throw new Error(`Perfil não encontrado: ${profileError?.message || link.user_id}`);
    const pd = obj(profile.profile_data);
    const current = obj(pd.subscription);
    if (current.provider === "manual_test" && String(current.plan || "").toLowerCase() === "teste") {
      console.info("FECHOU: evento recorrente Asaas ignorado para preservar o marcador do Plano Teste manual (ativo ou revogado).", { user_id: link.user_id, event });
      return;
    }
    const pending = obj(pd.subscription_checkout_pending);
    const sameCheckout = !pending.checkout_id || String(pending.checkout_id) === String(link.checkout_id || "");
    const nextSubscription = {
      ...current, id: subscriptionId || current.id || null, plan: link.plan || current.plan || pending.plan || null,
      amount: String(link.plan || "").toLowerCase() === "mensal" && Math.abs(Number(link.amount || 0) - 9.99) < 0.001 ? 15.99 : Number(link.amount || subscription.value || current.amount || pending.amount || 0),
      recurring_amount: String(link.plan || "").toLowerCase() === "mensal" && Math.abs(Number(link.amount || 0) - 9.99) < 0.001 ? 15.99 : Number(link.amount || subscription.value || current.amount || pending.amount || 0),
      introductory_amount: String(link.plan || "").toLowerCase() === "mensal" && Math.abs(Number(link.amount || 0) - 9.99) < 0.001 ? 9.99 : current.introductory_amount || null,
      provider: "asaas",
      checkout_id: link.checkout_id || current.checkout_id || pending.checkout_id || null,
      external_reference: link.external_reference || current.external_reference || null,
      cycle: subscription.cycle || current.cycle || link.provider_payload?.subscription?.cycle || null,
      status, provider_status: providerStatus || status,
      next_due_date: subscription.nextDueDate || current.next_due_date || null,
      end_date: subscription.endDate || current.end_date || null,
      billing_type: subscription.billingType || current.billing_type || null,
      customer_id: customerId || current.customer_id || null,
      created_at: subscription.dateCreated || current.created_at || now,
      updated_at: now,
    };
    // Eventos atrasados de um checkout antigo não podem substituir outra assinatura ativa.
    const currentIsDifferentActive = ["active", "authorized"].includes(String(current.status || "").toLowerCase()) && String(current.checkout_id || "") !== String(link.checkout_id || "");
    if (!currentIsDifferentActive) {
      pd.subscription = nextSubscription;
      if (sameCheckout) delete pd.subscription_checkout_pending;
    }
    const { error: updateError } = await admin.from("profiles").update({ profile_data: pd }).eq("id", link.user_id);
    if (updateError) throw new Error(`Falha ao atualizar a assinatura do perfil: ${updateError.message}`);
    if (event === "SUBSCRIPTION_CREATED") {
      await applyMonthlyIntroRecurringRate(admin, link, subscriptionId);
    }
    return;
  }

  if (event.startsWith("PAYMENT_")) {
    const externalReference = s(payment.externalReference, 200);
    if (!externalReference && payment.checkoutSession) {
      const {data:sessionLink,error:sessionLinkError}=await admin.from("fechou_asaas_checkouts").select("*")
        .eq("checkout_id",s(payment.checkoutSession,160)).eq("purpose","prepublication").maybeSingle();
      if(sessionLinkError)throw new Error("Falha ao localizar checkout pré-pago pela sessão Asaas: "+sessionLinkError.message);
      if(sessionLink?.external_reference){
        await v195HandlePrepayPaymentByCheckoutSession(admin,sessionLink,payment,s(body.id,250),event);
        return;
      }
    }
    if (/^fechou-prepay:[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(externalReference)) {
      await v195AsaasPrepayPublish(admin,externalReference,payment,s(body.id,250),event);
      return;
    }
    const subscriptionId=s(payment.subscription||payment.subscriptionId,160);
    const isSubscriptionReference=externalReference.startsWith("fechou-subscription:")||externalReference.startsWith("fechou-sub:");
    if(subscriptionId||isSubscriptionReference){
      let subscriptionLink:any=null;
      if(isSubscriptionReference){
        const byReference=await admin.from("fechou_asaas_checkouts").select("*").eq("external_reference",externalReference).eq("purpose","subscription").maybeSingle();
        if(byReference.error)throw new Error("Falha ao localizar assinatura pelo pagamento: "+byReference.error.message);
        subscriptionLink=byReference.data;
      }
      if(!subscriptionLink&&subscriptionId){
        const bySubscription=await admin.from("fechou_asaas_checkouts").select("*").eq("asaas_subscription_id",subscriptionId).eq("purpose","subscription").maybeSingle();
        if(bySubscription.error)throw new Error("Falha ao localizar assinatura pelo ID recorrente: "+bySubscription.error.message);
        subscriptionLink=bySubscription.data;
      }
      if(!subscriptionLink){console.warn("Pagamento recorrente Asaas sem assinatura FECHOU vinculada.",{subscriptionId,externalReference,event});return;}
      const now=new Date().toISOString(),linkStatus=String(subscriptionLink.status||"").toLowerCase();
      if(["PAYMENT_RECEIVED","PAYMENT_CONFIRMED"].includes(event)){
        const value=Number(payment.value||0),currency=String(payment.currency||"BRL").toUpperCase();
        const expected=Number(subscriptionLink.amount||0);
        if(currency!=="BRL"||!payment.id||!Number.isFinite(value)||value<=0||(!["paid"].includes(linkStatus)&&Math.abs(Math.round(value*100)-Math.round(expected*100))>1)){
          throw new Error("A primeira cobrança da assinatura não confere em moeda ou valor; ativação bloqueada para revisão.");
        }
        const savedPayload={...obj(subscriptionLink.provider_payload),last_payment_event:event,last_payment_id:String(payment.id),last_payment_value:value,first_payment:linkStatus==="paid"?obj(subscriptionLink.provider_payload).first_payment:{payment_id:String(payment.id),value,billing_type:payment.billingType||null,confirmed_at:now}};
        const {error:linkUpdateError}=await admin.from("fechou_asaas_checkouts").update({status:"paid",asaas_subscription_id:subscriptionId||subscriptionLink.asaas_subscription_id||subscriptionLink.checkout_id,subscription_status:"ACTIVE",provider_payload:savedPayload,updated_at:now}).eq("id",subscriptionLink.id);
        if(linkUpdateError)throw new Error("Falha ao registrar a confirmação da primeira cobrança recorrente: "+linkUpdateError.message);
        const {data:profile,error:profileError}=await admin.from("profiles").select("profile_data").eq("id",subscriptionLink.user_id).maybeSingle();
        if(profileError||!profile)throw new Error("Não foi possível localizar o perfil após o pagamento da assinatura: "+(profileError?.message||subscriptionLink.user_id));
        const pd=obj(profile.profile_data),current=obj(pd.subscription),pending=obj(pd.subscription_checkout_pending);
        if(current.provider==="manual_test"&&String(current.plan||"").toLowerCase()==="teste")return;
        const subId=subscriptionId||String(subscriptionLink.asaas_subscription_id||"");
        if(!subId&&obj(subscriptionLink.provider_payload).manual_cycle===true){
          const differentActive=["active","authorized"].includes(String(current.status||"").toLowerCase())&&String(current.external_reference||"")!==String(subscriptionLink.external_reference||"");
          if(!differentActive){
            const baseDate=String(payment.confirmedDate||payment.clientPaymentDate||now).slice(0,10);
            const due=new Date(baseDate+"T12:00:00-03:00");
            const cycle=String(pending.cycle||current.cycle||"MONTHLY").toUpperCase();
            if(cycle==="MONTHLY")due.setMonth(due.getMonth()+1);
            else if(cycle==="SEMIANNUALLY"||cycle==="SEMESTER")due.setMonth(due.getMonth()+6);
            else if(cycle==="YEARLY"||cycle==="ANNUALLY")due.setFullYear(due.getFullYear()+1);
            const nextDueDate=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(due);
            pd.subscription={...current,...pending,provider:"asaas",id:"manual_cycle:"+String(payment.id),checkout_id:subscriptionLink.checkout_id,external_reference:subscriptionLink.external_reference,customer_id:subscriptionLink.asaas_customer_id||current.customer_id||null,plan:subscriptionLink.plan||current.plan||pending.plan||null,amount:Number(pending.recurring_amount||current.recurring_amount||subscriptionLink.amount||value),recurring_amount:Number(pending.recurring_amount||current.recurring_amount||subscriptionLink.amount||value),introductory_amount:pending.introductory_amount??current.introductory_amount??null,cycle,billing_type:payment.billingType||current.billing_type||pending.billing_type||null,status:"active",provider_status:"PAYMENT_CONFIRMED",renewal_mode:"manual",manual_renewal:true,next_due_date:nextDueDate,last_payment_id:String(payment.id),last_payment_at:payment.paymentDate||payment.confirmedDate||now,updated_at:now};
            delete pd.subscription_checkout_pending;
            const {error:profileUpdateError}=await admin.from("profiles").update({profile_data:pd}).eq("id",subscriptionLink.user_id);
            if(profileUpdateError)throw new Error("Pagamento Pix/boleto confirmado, mas não foi possível ativar o ciclo no perfil: "+profileUpdateError.message);
          }
          return;
        }
        if(!subId){console.warn("Pagamento da assinatura confirmado antes de o Asaas informar o ID da recorrência; o vínculo foi marcado como pago e a ativação aguardará SUBSCRIPTION_CREATED.",{checkout_id:subscriptionLink.checkout_id,external_reference:subscriptionLink.external_reference});return;}
        const sameCurrent=String(current.id||"")===subId||String(current.checkout_id||"")===String(subscriptionLink.checkout_id||"");
        const samePending=String(pending.checkout_id||"")===String(subscriptionLink.checkout_id||"")||String(pending.external_reference||"")===String(subscriptionLink.external_reference||"");
        const differentActive=["active","authorized"].includes(String(current.status||"").toLowerCase())&&!sameCurrent&&!samePending;
        if(!differentActive){
          const recurringAmount=String(subscriptionLink.plan||"").toLowerCase()==="mensal"&&Math.abs(Number(subscriptionLink.amount||0)-9.99)<.001?15.99:Number(subscriptionLink.amount||current.recurring_amount||current.amount||value);
          pd.subscription={...current,...pending,provider:"asaas",id:subId||current.id||null,checkout_id:subscriptionLink.checkout_id||current.checkout_id||null,external_reference:subscriptionLink.external_reference||current.external_reference||null,customer_id:subscriptionLink.asaas_customer_id||current.customer_id||null,plan:subscriptionLink.plan||current.plan||pending.plan||null,amount:recurringAmount,recurring_amount:recurringAmount,introductory_amount:String(subscriptionLink.plan||"").toLowerCase()==="mensal"&&Math.abs(Number(subscriptionLink.amount||0)-9.99)<.001?9.99:current.introductory_amount||null,cycle:current.cycle||pending.cycle||subscriptionLink.provider_payload?.cycle||null,billing_type:payment.billingType||current.billing_type||pending.billing_type||null,status:"active",provider_status:"ACTIVE",updated_at:now};
          if(samePending||sameCurrent)delete pd.subscription_checkout_pending;
          const {error:profileUpdateError}=await admin.from("profiles").update({profile_data:pd}).eq("id",subscriptionLink.user_id);
          if(profileUpdateError)throw new Error("Pagamento confirmado, mas o perfil não foi ativado: "+profileUpdateError.message);
        }
        await applyMonthlyIntroRecurringRate(admin,{...subscriptionLink,status:"paid"},subId);
      }else if(["PAYMENT_OVERDUE","PAYMENT_REFUNDED","PAYMENT_CANCELED","PAYMENT_DELETED"].includes(event)){
        const next=event==="PAYMENT_OVERDUE"?"overdue":event==="PAYMENT_REFUNDED"?"refunded":"cancelled";
        const {error:linkUpdateError}=await admin.from("fechou_asaas_checkouts").update({status:next,provider_payload:{...obj(subscriptionLink.provider_payload),last_payment_event:event,last_payment_id:payment.id||null},updated_at:now}).eq("id",subscriptionLink.id);
        if(linkUpdateError)throw new Error("Falha ao atualizar o estado da cobrança recorrente: "+linkUpdateError.message);
        const {data:profile,error:profileError}=await admin.from("profiles").select("profile_data").eq("id",subscriptionLink.user_id).maybeSingle();
        if(profileError||!profile)throw new Error("Não foi possível localizar o perfil da assinatura: "+(profileError?.message||subscriptionLink.user_id));
        const pd=obj(profile.profile_data),current=obj(pd.subscription),subId=subscriptionLink.provider_payload?.manual_cycle?String(current.id||""):subscriptionId||String(subscriptionLink.asaas_subscription_id||subscriptionLink.checkout_id||"");
        const sameManualReference=subscriptionLink.provider_payload?.manual_cycle===true&&String(current.external_reference||"")===String(subscriptionLink.external_reference||"");
        if(String(current.id||"")===subId||sameManualReference){
          pd.subscription={...current,status:next==="overdue"?"past_due":next,provider_status:next.toUpperCase(),updated_at:now};
          const {error:updateError}=await admin.from("profiles").update({profile_data:pd}).eq("id",subscriptionLink.user_id);
          if(updateError)throw new Error("Não foi possível atualizar o status da assinatura no perfil: "+updateError.message);
        }
      }
      return;
    }
    const match = externalReference.match(/^fechou-order:([^:]+)(?::.*)?$/);
    if (!match) return;
    const orderId = match[1];
    const order = await getOrder(admin, orderId);
    const checkoutStatus = ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(event) ? "paid"
      : event === "PAYMENT_REFUNDED" ? "refunded"
      : event === "PAYMENT_OVERDUE" ? "overdue" : "active";
    const { data: linkedCheckout, error: checkoutReadError } = await admin.from("fechou_asaas_checkouts")
      .select("id,provider_payload").eq("external_reference", externalReference).eq("purpose", "service").maybeSingle();
    if (checkoutReadError) throw new Error(`Falha ao localizar o registro de checkout para conciliação: ${checkoutReadError.message}`);
    if (linkedCheckout?.id) {
      const { error: checkoutSyncError } = await admin.from("fechou_asaas_checkouts")
        .update({ status: checkoutStatus, checkout_id: payment.id || null,
          provider_payload: { ...obj(linkedCheckout.provider_payload), last_payment_event: event, payment_id: payment.id || null, payment_status: payment.status || null },
          updated_at: new Date().toISOString() })
        .eq("id", linkedCheckout.id);
      if (checkoutSyncError) throw new Error(`Falha ao conciliar a cobrança no registro de checkout: ${checkoutSyncError.message}`);
    }
    const meta = { ...order.metadata, payment_provider: "asaas", asaas_payment_id: payment.id || null, last_asaas_event: event };
    if (["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(event)) {
      meta.payment_state = "held";
      const { error } = await admin.from("orders").update({
        metadata: meta, payment_status: "approved", payment_id: payment.id || order.payment_id,
        paid_at: payment.paymentDate || payment.confirmedDate || new Date().toISOString(),
      }).eq("id", orderId);
      if (error) throw new Error(`Falha ao atualizar pagamento: ${error.message}`);
      await createLedgerEntry(admin, {
        user_id: String(order.client_id), order_id: orderId, entry_type: "service_payment",
        amount: Number(payment.value || order.total || 0), status: "held",
        description: "Pagamento de serviço confirmado pelo Asaas.",
      });
      let professionalId = String(order.professional_id || "");
      if (!professionalId && order.selected_proposal_id) {
        const { data: proposal, error: proposalError } = await admin.from("proposals").select("professional_id").eq("id", order.selected_proposal_id).maybeSingle();
        if (proposalError) throw new Error(`Falha ao localizar o profissional da contratação: ${proposalError.message}`);
        professionalId = String(proposal?.professional_id || "");
      }
      const professionalNet = Number(order.professional_net || order.metadata?.professional_net || 0);
      if (professionalId && professionalNet > 0) await createLedgerEntry(admin, {
        user_id: professionalId, order_id: orderId, entry_type: "payout",
        amount: Number(professionalNet.toFixed(2)), status: "held",
        description: "Valor líquido do serviço pago; aguardando confirmação da conclusão para liberação.",
      });
    } else if (event === "PAYMENT_REFUNDED") {
      meta.refund_status = "refunded";
      const { error } = await admin.from("orders").update({ metadata: meta, refund_status: "refunded" }).eq("id", orderId);
      if (error) throw new Error(`Falha ao registrar reembolso: ${error.message}`);
      await createLedgerEntry(admin, {
        user_id: order.client_id, order_id: orderId, entry_type: "refund",
        amount: Number(payment.value || order.total || 0), status: "refunded",
        description: "Reembolso confirmado pelo Asaas.",
      });
      await createLedgerEntry(admin, {
        user_id: order.client_id, order_id: orderId, entry_type: "service_payment",
        amount: Number(payment.value || order.total || 0), status: "refunded",
        description: "Pagamento original estornado; reembolso confirmado pelo Asaas.",
      });
    } else if (event === "PAYMENT_OVERDUE") {
      meta.payment_state = "overdue";
      const { error } = await admin.from("orders").update({ metadata: meta, payment_status: "overdue" }).eq("id", orderId);
      if (error) throw new Error(`Falha ao atualizar cobrança vencida: ${error.message}`);
    }
  }
}


async function validateAsaasWithdrawal(admin: any, body: any) {
  const transfer = obj(body?.transfer);
  const transferId = s(transfer.id, 180);
  const value = Number(transfer.value);
  const operationType = s(transfer.operationType, 20).toUpperCase();
  const refuse = (reason: string) => {
    console.warn("FECHOU Asaas withdrawal validation refused", {
      transfer_id: transferId || null,
      reason,
      value: Number.isFinite(value) ? value : null,
      operation_type: operationType || null
    });
    return { status: "REFUSED", refuseReason: reason };
  };
  if (!transferId || !Number.isFinite(value) || value <= 0 || (operationType && operationType !== "PIX")) {
    return refuse("Operação de transferência inválida ou incompleta.");
  }
  // Compatibilidade segura para transferências manuais antigas já criadas antes da desativação.
  // Não cria nem inicia transferências; apenas reconhece uma ordem previamente registrada.
  const { data: legacyManual, error: legacyError } = await admin.from("fechou_admin_manual_transfers")
    .select("id,admin_id,request_id,external_reference,amount,asaas_transfer_id,status")
    .eq("asaas_transfer_id", transferId).maybeSingle();
  if (legacyError) throw new Error("Falha ao conferir registro legado de transferência administrativa: " + legacyError.message);
  if (legacyManual) {
    const manualStatus = String(legacyManual.status || "").toLowerCase();
    const manualReference = s(transfer.externalReference, 200);
    if (!legacyManual.admin_id || !legacyManual.request_id ||
        Math.round(value * 100) !== Math.round(Number(legacyManual.amount || 0) * 100) ||
        (manualReference && manualReference !== String(legacyManual.external_reference || "")) ||
        !["initiating","pending","in_bank_processing","unknown"].includes(manualStatus)) {
      return refuse("A transferência administrativa antiga não corresponde a um registro válido e pendente.");
    }
    console.info("FECHOU Asaas legacy admin transfer validation approved", {
      transfer_id: transferId, record_id: legacyManual.id
    });
    return { status: "APPROVED" };
  }
  const { data: attempt, error: attemptError } = await admin.from("fechou_wallet_asaas_transfers")
    .select("id,payout_request_id,user_id,order_id,admin_id,external_reference,asaas_transfer_id,amount,pix_key_fingerprint,status")
    .eq("asaas_transfer_id", transferId).maybeSingle();
  if (attemptError) throw new Error("Falha ao consultar a tentativa de repasse para validação externa: " + attemptError.message);
  if (!attempt) return refuse("Transferência não encontrada entre os repasses autorizados pelo FECHOU.");
  if (!attempt.admin_id || !attempt.payout_request_id || !attempt.user_id || !attempt.order_id) {
    return refuse("A tentativa não possui vínculo completo com uma autorização administrativa.");
  }
  if (Math.round(value * 100) !== Math.round(Number(attempt.amount || 0) * 100)) {
    return refuse("O valor informado pelo Asaas não corresponde ao valor aprovado no FECHOU.");
  }
  const externalReference = s(transfer.externalReference, 200);
  if (externalReference && externalReference !== String(attempt.external_reference || "")) {
    return refuse("A referência externa não corresponde à tentativa autorizada.");
  }
  // O Asaas pode devolver a chave Pix em representação diferente da enviada
  // (por exemplo, chave normalizada/mascarada ou dados bancários resolvidos).
  // A identidade da transferência é validada pelo ID Asaas persistido, valor,
  // referência externa quando fornecida e vínculo da solicitação já aprovada.
  // Não recusar apenas por divergência de serialização da chave Pix no callback.
  const bank = obj(transfer.bankAccount);
  const eventPixKey = s(transfer.pixAddressKey || bank.pixAddressKey, 250);
  if (eventPixKey) {
    const fingerprint = await sha256Hex(normalizePixKeyForFingerprint(eventPixKey));
    if (fingerprint !== String(attempt.pix_key_fingerprint || "")) {
      console.warn("FECHOU Asaas validation: provider Pix key representation differs; relying on exact transfer ID, amount and external reference", {
        transfer_id: transferId,
        external_reference_present: !!externalReference
      });
    }
  }
  const { data: payout, error: payoutError } = await admin.from("fechou_wallet_payout_requests")
    .select("id,user_id,order_id,amount,status").eq("id", attempt.payout_request_id).maybeSingle();
  if (payoutError) throw new Error("Falha ao consultar a solicitação de saque vinculada: " + payoutError.message);
  if (!payout || String(payout.user_id) !== String(attempt.user_id) ||
      String(payout.order_id) !== String(attempt.order_id) ||
      Math.round(Number(payout.amount || 0) * 100) !== Math.round(Number(attempt.amount || 0) * 100) ||
      String(payout.status || "").toLowerCase() !== "transfer_pending") {
    return refuse("A solicitação de saque não está em estado autorizado para processamento.");
  }
  const currentStatus = String(attempt.status || "").toLowerCase();
  if (!["pending", "in_bank_processing"].includes(currentStatus)) {
    return refuse("A tentativa de transferência não está em estado válido para autorização.");
  }
  const { error: auditError } = await admin.from("admin_audit_log").insert({
    actor_id: attempt.admin_id,
    actor_email: "asaas-webhook@system.invalid",
    action: "asaas_withdrawal_validation_approved",
    target_table: "fechou_wallet_asaas_transfers",
    target_id: attempt.id,
    details: {
      transfer_id: transferId,
      payout_request_id: attempt.payout_request_id,
      amount: Number(attempt.amount),
      validation_source: "asaas_external_withdrawal_webhook",
      validated_at: new Date().toISOString()
    }
  });
  if (auditError) console.warn("FECHOU: não foi possível gravar auditoria da autorização externa:", auditError.message);
  console.info("FECHOU Asaas withdrawal validation approved", { transfer_id: transferId, payout_request_id: attempt.payout_request_id });
  return { status: "APPROVED" };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Método não permitido." });
  if (!WEBHOOK_TOKEN) return json(503, { ok: false, error: "ASAAS_WEBHOOK_TOKEN não configurado." });
  const supplied = req.headers.get("asaas-access-token") || "";
  if (!secureEqual(supplied.trim(), WEBHOOK_TOKEN)) {
    console.warn("FECHOU Asaas webhook auth rejected", {
      configured_token_present: !!WEBHOOK_TOKEN,
      supplied_header_present: !!supplied,
      supplied_header_length: supplied.trim().length,
    });
    return json(401, { ok: false, error: "Token do webhook inválido. Confira se o authToken do Asaas é idêntico ao secret ASAAS_WEBHOOK_TOKEN no Supabase." });
  }
  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "JSON inválido." }); }
  if (String(body?.type || "").toUpperCase() === "TRANSFER" && body?.transfer) {
    try {
      const decision = await validateAsaasWithdrawal(db(), body);
      return json(200, decision);
    } catch (error) {
      console.error("FECHOU Asaas withdrawal validation failed closed", error);
      return json(200, { status: "REFUSED", refuseReason: "Não foi possível validar a transferência com segurança no FECHOU." });
    }
  }
  const eventId = s(body?.id, 250);
  const event = s(body?.event, 100);
  if (!eventId || !event) return json(400, { ok: false, error: "Evento sem id ou nome." });

  try {
    const admin = db();
    const { error: insertError } = await admin.from("fechou_asaas_webhook_events").insert({
      event_id: eventId, event_name: event, payload: webhookPayloadForStorage(body, event), received_at: new Date().toISOString(),
    });
    if (insertError) {
      if (insertError.code === "23505") {
        const { data: existing, error: readError } = await admin.from("fechou_asaas_webhook_events")
          .select("processed_at,processing_error").eq("event_id", eventId).maybeSingle();
        if (readError) throw new Error(readError.message);
        if (existing?.processed_at && !existing?.processing_error) return json(200, { ok: true, duplicate: true });
      } else {
        throw new Error(`Não foi possível registrar o evento recebido: ${insertError.message}`);
      }
    }
    try {
      await applyEvent(admin, body);
      const { error: markProcessedError } = await admin.from("fechou_asaas_webhook_events").update({
        processed_at: new Date().toISOString(), processing_error: null,
      }).eq("event_id", eventId);
      if (markProcessedError) throw new Error(`Evento aplicado, mas não foi possível marcar a idempotência como concluída: ${markProcessedError.message}`);
      return json(200, { ok: true, received: event });
    } catch (processingError) {
      await admin.from("fechou_asaas_webhook_events").update({
        processing_error: s((processingError as Error)?.message, 1500),
      }).eq("event_id", eventId);
      console.error("FECHOU Asaas webhook processing", event, processingError);
      return json(500, { ok: false, error: "Evento recebido, mas o processamento falhou. O Asaas pode reenviar." });
    }
  } catch (error) {
    console.error("FECHOU Asaas webhook", error);
    return json(500, { ok: false, error: "Falha interna ao receber evento do Asaas." });
  }
});