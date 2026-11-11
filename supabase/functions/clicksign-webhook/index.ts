// FECHOU V156 — Supabase Edge Function: clicksign-webhook
// Recebe eventos autenticados da Clicksign, registra assinaturas por signatário,
// baixa o PDF final, armazena-o em bucket privado e só então confirma o contrato.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const CLICKSIGN_ACCESS_TOKEN = Deno.env.get("CLICKSIGN_ACCESS_TOKEN") || "";
const CLICKSIGN_ENVIRONMENT = (Deno.env.get("CLICKSIGN_ENVIRONMENT") || "sandbox").toLowerCase();
const CLICKSIGN_BASE = CLICKSIGN_ENVIRONMENT === "production" ? "https://app.clicksign.com" : "https://sandbox.clicksign.com";
const CLICKSIGN_WEBHOOK_SECRET = Deno.env.get("CLICKSIGN_WEBHOOK_SECRET") || "";
const BUCKET = "fechou-signed-contracts";
// E-mail de auditoria enviado somente depois de a Clicksign confirmar as duas assinaturas.
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FECHOU_ADMIN_EMAIL = Deno.env.get("FECHOU_ADMIN_EMAIL") || "exyloncompany@gmail.com";
const FECHOU_EMAIL_FROM = Deno.env.get("FECHOU_EMAIL_FROM") || "";

const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
const str = (v: unknown, max = 1000) => String(v ?? "").trim().slice(0, max);
const obj = (v: any): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v : {};

function constantEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
function hex(bytes: Uint8Array) { return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function sha256Hex(bytes: Uint8Array) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}
async function verifyHmac(raw: string, supplied: string, headerName: string) {
  if (!CLICKSIGN_WEBHOOK_SECRET) return false;
  const secretBytes = new TextEncoder().encode(CLICKSIGN_WEBHOOK_SECRET);
  const rawBytes = new TextEncoder().encode(raw);
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBytes));
  const received = supplied.trim().replace(/^sha256=/i, "").replace(/^"|"$/g, "");
  const expectedHex = hex(signature);
  const expectedBase64 = btoa(String.fromCharCode(...signature));
  if (constantEqual(received.toLowerCase(), expectedHex.toLowerCase()) || constantEqual(received, expectedBase64)) return true;

  // Compatibilidade com webhooks legados que enviam Content-Hmac como
  // SHA-256(raw body + secret), diferente do HMAC padrão usado no header v3.
  if (/^content-hmac$/i.test(headerName)) {
    const combined = new Uint8Array(rawBytes.length + secretBytes.length);
    combined.set(rawBytes, 0);
    combined.set(secretBytes, rawBytes.length);
    const legacy = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", combined)));
    return constantEqual(received.toLowerCase(), legacy.toLowerCase());
  }
  return false;
}
function adminClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function clicksignRequest(path: string) {
  if (!CLICKSIGN_ACCESS_TOKEN) throw new Error("CLICKSIGN_ACCESS_TOKEN não está configurado.");
  const response = await fetch(`${CLICKSIGN_BASE}${path}`, {
    headers: { Authorization: CLICKSIGN_ACCESS_TOKEN, Accept: "application/vnd.api+json" },
  });
  const raw = await response.text();
  let parsed: any = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; }
  if (!response.ok) throw new Error(`Clicksign GET ${path} retornou HTTP ${response.status}: ${str(parsed?.errors?.[0]?.detail || parsed?.message || parsed?.raw, 800)}`);
  return parsed;
}
function signerInfoFromEvent(event: any, body: any) {
  const eventData = obj(event?.data);
  const signer = obj(eventData.signer || body?.signer || body?.data?.signer);
  const user = obj(eventData.user || body?.user);
  return {
    id: str(signer.key || signer.id || signer.id_signer || "", 160),
    email: str(signer.email || user.email || body?.email || "", 240).toLowerCase(),
    name: str(signer.name || user.name || "", 160),
  };
}
function signEventsFrom(body: any) {
  const doc = obj(body?.document || body?.data?.document || body?.event?.data?.document);
  const directEvents = Array.isArray(doc.events) ? doc.events : [];
  const envelopeEvents = Array.isArray(body?.events) ? body.events : [];
  const event = obj(body?.event);
  return [...directEvents, ...envelopeEvents, event].filter((x) => str(x?.name || x?.attributes?.name).toLowerCase() === "sign");
}
function signedFileUrl(value: any) {
  if (typeof value === "string") return str(value, 2000);
  if (value && typeof value === "object") return str(value.href || value.url || value.download_url || value.link, 2000);
  return "";
}
async function notifyContractParticipant(admin: any, userId: string, orderId: string, eventKey: string, title: string, body: string) {
  if (!userId) return;
  try {
    const { data: existing, error: lookupError } = await admin.from("notifications")
      .select("id").eq("user_id", userId).contains("data", { event_key: eventKey }).limit(1).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing?.id) return;
    const { error } = await admin.from("notifications").insert({
      user_id: userId, type: "contract_signed", title, body,
      data: { order_id: String(orderId), event_key: eventKey, source: "clicksign_webhook" },
    });
    if (error) throw error;
  } catch (error) {
    // A falha de notificação jamais invalida uma assinatura confirmada.
    console.warn("Clicksign: não foi possível gravar a notificação interna; assinatura preservada.", (error as Error)?.message || error);
  }
}
async function createHeldPayoutLedger(admin:any,userId:string,orderId:string,amount:number,providerReference:string|null){
 const {data,error}=await admin.rpc("fechou_upsert_wallet_ledger_entry",{
  p_user_id:userId,p_order_id:orderId,p_entry_type:"payout",p_amount:amount,p_status:"held",
  p_description:"Valor líquido reservado e vinculado à contratação; aguarda execução do serviço e confirmação do cliente. Ainda não disponível para saque.",
  p_provider:"asaas",p_provider_reference:providerReference,
  p_metadata:{source:"prepaid_contract_fully_signed",release_condition:"client_approval_after_service_completion"}
 });
 if(error||!data?.id)throw new Error("Não foi possível registrar o valor reservado na carteira do profissional: "+(error?.message||"lançamento não retornado"));
 return data;
}

async function createClientServicePaymentLedger(admin:any,userId:string,orderId:string,amount:number,providerReference:string|null,completed:boolean,temporaryTestPrice:boolean){
 if(!userId||!orderId||!Number.isFinite(amount)||amount<=0)throw new Error("Dados insuficientes para registrar o pagamento do cliente na carteira.");
 const {data,error}=await admin.rpc("fechou_upsert_wallet_ledger_entry",{
  p_user_id:userId,p_order_id:orderId,p_entry_type:"service_payment",p_amount:Number(amount.toFixed(2)),
  p_status:completed?"paid":"held",
  p_description:temporaryTestPrice
   ? (completed ? "Pagamento real de valor reduzido confirmado pelo Asaas e registrado como saída do cliente; repasse profissional calculado separadamente."
                : "Pagamento real de valor reduzido confirmado pelo Asaas e reservado até a conclusão do serviço.")
   : completed
    ? "Pagamento do serviço confirmado pelo Asaas; serviço concluído."
    : "Pagamento do serviço confirmado pelo Asaas e reservado até a conclusão e confirmação do cliente.",
  p_provider:"asaas",p_provider_reference:providerReference,
  p_metadata:{
   source:"prepaid_contract_signature_reconciliation",
   payment_id:providerReference,
   temporary_test_price:temporaryTestPrice,
   service_completed:completed,
   wallet_direction:"debit"
  }
 });
 if(error||!data?.id)throw new Error("Não foi possível sincronizar a saída do pagamento na carteira do cliente: "+(error?.message||"lançamento não retornado"));
 return data;
}

async function notifySignatureTransition(admin: any, before: any, after: any, signer: "client" | "professional") {
  const orderId = String(after.order_id || before.order_id || "");
  const clientSigned = Boolean(after.client_signed_at);
  const professionalSigned = Boolean(after.professional_signed_at);
  if (!orderId) return;
  if (clientSigned && professionalSigned) {
    const wasComplete = Boolean(before.client_signed_at && before.professional_signed_at);
    if (!wasComplete) {
      const title = "Contrato assinado pelas duas partes";
      const body = "As duas assinaturas foram registradas. O documento está sendo finalizado para disponibilização na conversa.";
      await notifyContractParticipant(admin, String(after.client_id || ""), orderId, `contract_fully_signed:${orderId}`, title, body);
      await notifyContractParticipant(admin, String(after.professional_id || ""), orderId, `contract_fully_signed:${orderId}`, title, body);
    }
    return;
  }
  const justClient = signer === "client" && !before.client_signed_at && clientSigned;
  const justProfessional = signer === "professional" && !before.professional_signed_at && professionalSigned;
  if (justClient && after.professional_id) {
    await notifyContractParticipant(admin, String(after.professional_id), orderId, `contract_first_signature:${orderId}:client`, "O cliente assinou o contrato", "O cliente já assinou o contrato. Acesse a conversa para revisar e assinar também.");
  } else if (justProfessional && after.client_id) {
    await notifyContractParticipant(admin, String(after.client_id), orderId, `contract_first_signature:${orderId}:professional`, "O profissional assinou o contrato", "O profissional já assinou o contrato. Acesse a conversa para ler e assinar também.");
  }
}

async function applySignerEvent(admin: any, row: any, event: any, body: any) {
  const signer = signerInfoFromEvent(event, body);
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const isClient = (signer.id && signer.id === String(row.client_signer_id)) || (signer.email && signer.email === String(row.client_email || "").toLowerCase());
  const isProfessional = (signer.id && signer.id === String(row.professional_signer_id)) || (signer.email && signer.email === String(row.professional_email || "").toLowerCase());
  if (isClient) patch.client_signed_at = row.client_signed_at || new Date().toISOString();
  else if (isProfessional) patch.professional_signed_at = row.professional_signed_at || new Date().toISOString();
  else return row;
  const clientSigned = Boolean(patch.client_signed_at || row.client_signed_at);
  const professionalSigned = Boolean(patch.professional_signed_at || row.professional_signed_at);
  if (clientSigned && professionalSigned) patch.signature_status = "signed_waiting_close";
  const { data, error } = await admin.from("fechou_electronic_signatures").update(patch).eq("order_id", row.order_id).select("*").single();
  if (error) throw new Error(`Falha ao registrar assinatura individual: ${error.message}`);
  await notifySignatureTransition(admin, row, data, isClient ? "client" : "professional");
  return data;
}
function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
async function notifyOwnerWithSignedPdf(admin: any, row: any, fileBytes: Uint8Array, digest: string, storagePath: string) {
  // A notificação é complementar: falha de e-mail nunca desfaz nem invalida a assinatura confirmada.
  if (row.admin_notification_sent_at) return { sent: true, already_sent: true };
  if (!RESEND_API_KEY || !FECHOU_EMAIL_FROM || !FECHOU_ADMIN_EMAIL) {
    const reason = "E-mail de auditoria não configurado. Configure RESEND_API_KEY, FECHOU_EMAIL_FROM e FECHOU_ADMIN_EMAIL no webhook Clicksign.";
    await admin.from("fechou_electronic_signatures").update({ admin_notification_error: reason, updated_at: new Date().toISOString() }).eq("order_id", row.order_id);
    console.warn("FECHOU Clicksign:", reason);
    return { sent: false, reason };
  }
  try {
    const pdfBase64 = bytesToBase64(fileBytes);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FECHOU_EMAIL_FROM,
        to: [FECHOU_ADMIN_EMAIL],
        subject: `FECHOU — Contrato assinado pelas duas partes · Pedido ${row.order_id}`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#172334"><h2>Contrato FECHOU assinado pelas duas partes</h2><p>O provedor Clicksign confirmou o encerramento do envelope e o PDF final foi arquivado no armazenamento privado da plataforma.</p><p><b>Pedido:</b> ${str(row.order_id, 120)}<br><b>Hash SHA-256 do PDF:</b> ${digest}<br><b>Arquivo privado:</b> ${str(storagePath, 500)}<br><b>Data de confirmação:</b> ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p><p>O PDF assinado segue anexado a este e-mail. Preserve esta mensagem e o anexo para auditoria.</p></div>`,
        attachments: [{ filename: `Contrato-FECHOU-${str(row.order_id, 80)}-assinado.pdf`, content: pdfBase64, content_type: "application/pdf" }],
      }),
    });
    const raw = await response.text();
    let data: any = {}; try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }
    if (!response.ok) throw new Error(`Resend HTTP ${response.status}: ${str(data?.message || data?.name || raw, 700)}`);
    const sentAt = new Date().toISOString();
    const { error } = await admin.from("fechou_electronic_signatures").update({ admin_notification_sent_at: sentAt, admin_notification_error: null, updated_at: sentAt }).eq("order_id", row.order_id);
    if (error) throw new Error(`E-mail enviado, mas não foi possível gravar o recibo no banco: ${error.message}`);
    return { sent: true, id: str(data?.id, 200) };
  } catch (error) {
    const reason = str((error as Error)?.message || error, 1000);
    await admin.from("fechou_electronic_signatures").update({ admin_notification_error: reason, updated_at: new Date().toISOString() }).eq("order_id", row.order_id);
    console.warn("FECHOU Clicksign: assinatura confirmada, mas a notificação por e-mail falhou.", reason);
    return { sent: false, reason };
  }
}

async function confirmEnvelopeClosed(admin: any, row: any) {
  // Confirma os eventos de assinatura com a própria API quando disponíveis.
  let refreshed = row;
  try {
    const eventsResponse = await clicksignRequest(`/api/v3/envelopes/${encodeURIComponent(row.envelope_id)}/documents/${encodeURIComponent(row.document_id)}/events`);
    const eventRows = Array.isArray(eventsResponse?.data) ? eventsResponse.data : Array.isArray(eventsResponse?.events) ? eventsResponse.events : [];
    for (const e of eventRows) {
      const attributes = obj(e?.attributes);
      if (str(attributes.name || e?.name).toLowerCase() === "sign") {
        const data = obj(attributes.data || e?.data);
        refreshed = await applySignerEvent(admin, refreshed, { name: "sign", data }, {});
      }
    }
  } catch (e) {
    console.warn("Clicksign: consulta complementar dos eventos não disponível; usando eventos já recebidos pelo webhook.", (e as Error)?.message);
  }
  if (!refreshed.client_signed_at || !refreshed.professional_signed_at) {
    await admin.from("fechou_electronic_signatures").update({ signature_status: "awaiting_signatures", updated_at: new Date().toISOString() }).eq("order_id", row.order_id);
    return { completed: false, reason: "Aguardando os dois eventos individuais de assinatura." };
  }

  const details = await clicksignRequest(`/api/v3/envelopes/${encodeURIComponent(row.envelope_id)}/documents/${encodeURIComponent(row.document_id)}`);
  const doc = obj(details?.data);
  const files = obj(doc?.links?.files || doc?.attributes?.files);
  const signedUrl = signedFileUrl(files.signed || files.signed_file || doc?.attributes?.signed_file_url || details?.document?.downloads?.signed_file_url);
  if (!signedUrl || !/^https:\/\//i.test(signedUrl)) throw new Error("Clicksign fechou o envelope, mas ainda não disponibilizou o PDF assinado. O webhook será reprocessado.");
  const fileResponse = await fetch(signedUrl);
  if (!fileResponse.ok) throw new Error(`Não foi possível baixar o PDF assinado da Clicksign (HTTP ${fileResponse.status}).`);
  const fileBytes = new Uint8Array(await fileResponse.arrayBuffer());
  if (fileBytes.length < 500 || fileBytes.length > 25 * 1024 * 1024) throw new Error("O PDF final da Clicksign está vazio ou excede 25 MB.");
  if (new TextDecoder().decode(fileBytes.slice(0, 5)) !== "%PDF-") throw new Error("O arquivo final retornado pela Clicksign não é PDF válido.");
  const digest = await sha256Hex(fileBytes);
  const path = `${row.order_id}/contrato-assinado-${digest.slice(0, 16)}.pdf`;
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, fileBytes, { upsert: true, contentType: "application/pdf" });
  if (uploadError) throw new Error(`Falha ao arquivar o PDF assinado no armazenamento privado: ${uploadError.message}`);

  const now = new Date().toISOString();
  const { error: signatureError } = await admin.from("fechou_electronic_signatures").update({
    signature_status: "signed", signed_pdf_storage_path: path, signed_pdf_sha256: digest,
    signed_at: now, updated_at: now, last_error: null,
  }).eq("order_id", row.order_id);
  if (signatureError) throw new Error(`PDF salvo, mas falhou ao concluir o registro da assinatura: ${signatureError.message}`);

  const { error: contractError } = await admin.from("contracts").update({
    accepted: true, status: "active",
    client_accepted_at: refreshed.client_signed_at,
    professional_accepted_at: refreshed.professional_signed_at,
    accepted_at: now,
  }).eq("order_id", row.order_id);
  if (contractError) throw new Error(`Assinatura salva, mas não foi possível atualizar o contrato FECHOU: ${contractError.message}`);

  const { data: order, error: orderError } = await admin.from("orders")
    .select("id,metadata,payment_method,payment_flow,client_payment_preference,payment_status,total,professional_net,professional_id,client_id,selected_proposal_id,payment_id")
    .eq("id", row.order_id).maybeSingle();
  if (orderError || !order) throw new Error(`PDF assinado, mas falhou ao consultar o pedido: ${orderError?.message || "pedido não encontrado"}`);
  const meta = obj(order.metadata);
  meta.electronic_signature = { provider: "clicksign", status: "signed", envelope_id: row.envelope_id, document_id: row.document_id, signed_pdf_sha256: digest, signed_at: now };
  const paymentMode = str(order.payment_method || order.payment_flow || order.client_payment_preference || meta.payment_method || meta.payment_flow || meta.client_payment_preference || "direct").toLowerCase();
  // Nunca gravar rótulo de interface em orders.status: a V163 preserva a constraint dos estados internos.
  meta.contract_state = "active";
  let orderPatch:any = { metadata: meta };
  if (paymentMode === "contract_prepaid") {
    let professionalId = String(order.professional_id || row.professional_id || "");
    if (!professionalId && order.selected_proposal_id) {
      const { data: selectedProposal, error: proposalError } = await admin.from("proposals")
        .select("professional_id").eq("id", order.selected_proposal_id).eq("order_id", row.order_id).maybeSingle();
      if (proposalError) throw new Error("Contrato assinado, mas não foi possível identificar o profissional da proposta aceita: " + proposalError.message);
      professionalId = String(selectedProposal?.professional_id || "");
    }
    // Marca as duas vias locais como assinadas com o mesmo PDF final do envelope
    // compartilhado. A RLS do chat pré-pago só libera mensagens após ambas as assinaturas.
    const masterSignedAt = refreshed.client_signed_at || now;
    const annexSignedAt = refreshed.professional_signed_at || now;
    const { error: masterDocError } = await admin.from("fechou_prepaid_signature_documents").update({
      signature_status: "signed", signer_signed_at: masterSignedAt,
      signed_pdf_storage_path: path, signed_pdf_sha256: digest, updated_at: now, last_error: null
    }).eq("order_id", row.order_id).eq("kind", "master");
    if (masterDocError) throw new Error("PDF final arquivado, mas não foi possível confirmar a assinatura do cliente no registro pré-pago: " + masterDocError.message);
    const { error: annexDocError } = await admin.from("fechou_prepaid_signature_documents").update({
      signature_status: "signed", signer_signed_at: annexSignedAt,
      signed_pdf_storage_path: path, signed_pdf_sha256: digest, updated_at: now, last_error: null
    }).eq("order_id", row.order_id).eq("kind", "proposal_annex");
    if (annexDocError) throw new Error("PDF final arquivado, mas não foi possível confirmar a assinatura do profissional no registro pré-pago: " + annexDocError.message);
    const gross = Number(order.total || 0);
    const storedNet = Number(order.professional_net || meta.professional_net || 0);
    const professionalNet = Number.isFinite(storedNet) && storedNet > 0 ? Math.round(storedNet * 100) / 100 : Math.round(gross * 0.95 * 100) / 100;
    const temporaryTestPrice = meta.temporary_test_price === true ||
      String(meta.temporary_test_price || "").trim().toLowerCase() === "true" ||
      meta.temporary_test_payment_only === true ||
      String(meta.temporary_test_payment_only || "").trim().toLowerCase() === "true";
    if (String(order.payment_status || "").toLowerCase() !== "approved" || !(gross > 0) || !professionalId ||
        !(professionalNet > 0) || professionalNet > gross) {
      throw new Error("Assinaturas confirmadas, mas o pedido pré-pago não possui pagamento, profissional ou valor líquido válidos. O início do serviço permanece bloqueado.");
    }
    const platformFee = Math.round((gross - professionalNet) * 100) / 100;
    meta.contract_state = "active";
    meta.professional_net = professionalNet;
    meta.platform_fee = platformFee;
    meta.platform_commission_rate = 5;
    meta.temporary_test_payout_blocked = temporaryTestPrice;
    meta.real_money_paid = true;
    meta.payout_state = temporaryTestPrice
      ? "suppressed_test_mode"
      : (String(order.service_state || meta.service_state || "").toLowerCase() === "completed" ? "release_ready" : "held");
    if (temporaryTestPrice) meta.payout_suppressed_at = now;
    meta.service_status_label = "Contrato assinado — valor líquido reservado; aguarda a execução e a confirmação do cliente";
    orderPatch = { ...orderPatch, contract_accepted: true, professional_id: professionalId,
      professional_net: professionalNet, platform_fee: platformFee };

    // A carteira do cliente registra o pagamento real. A marca de preço reduzido
    // permanece apenas para auditoria do teste, nunca para impedir o repasse.
    await createClientServicePaymentLedger(
      admin,
      String(order.client_id || ""),
      String(row.order_id),
      gross,
      String(order.payment_id || meta.asaas_payment_id || "") || null,
      String(order.service_state || meta.service_state || "").toLowerCase() === "completed",
      temporaryTestPrice
    );

    if (temporaryTestPrice) {
      // Pagamento de teste/valor temporário: a assinatura é concluída, mas não existe crédito de repasse.
      meta.temporary_test_payout_blocked = true;
      meta.payout_state = "suppressed_test_mode";
      meta.payout_suppressed_at = now;
      console.info("Clicksign: repasse suprimido para contratação com preço temporário de teste.", row.order_id);
    } else {
      await createHeldPayoutLedger(admin, professionalId, String(row.order_id), professionalNet, String(order.payment_id || meta.asaas_payment_id || "") || null);
      const payoutEventKey = "prepaid-payout-held:" + String(row.order_id);
      const { data: priorPayoutNotice, error: noticeReadError } = await admin.from("notifications")
        .select("id").eq("user_id", professionalId).contains("data", { event_key: payoutEventKey }).maybeSingle();
      if (noticeReadError) throw new Error("Não foi possível conferir a notificação do valor reservado: " + noticeReadError.message);
      if (!priorPayoutNotice?.id) {
        const amountLabel = professionalNet.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        const { error: noticeError } = await admin.from("notifications").insert({
          user_id: professionalId, type: "payment_reserved", title: "Pagamento confirmado e valor reservado",
          body: "O contrato foi assinado pelas duas partes. " + amountLabel + " do seu repasse líquido estão registrados como dinheiro recebido e reservados nesta contratação. Após a conclusão e confirmação do cliente, o valor fica liberado para solicitar repasse, sujeito à verificação da chave Pix.",
          data: { order_id: String(row.order_id), event_key: payoutEventKey, amount: professionalNet,
            status: "held", release_condition: "client_approval_after_service_completion",
            real_money_paid: true, temporary_test_price: false }
        });
        if (noticeError) throw new Error("Não foi possível notificar o profissional sobre o valor reservado: " + noticeError.message);
      }
    }
    // Anexa o PDF único, já assinado pelos dois signatários, à conversa da contratação.
    const messageText = "O contrato da contratação foi assinado pelas duas partes pela Clicksign e arquivado no FECHOU. Esta é a via final do mesmo documento, com as duas assinaturas.";
    const attachment = { type: "contract_pdf", bucket: BUCKET, document_id: row.document_id, path, name: "Contrato da contratação assinado pelas duas partes.pdf", mime_type: "application/pdf", size: fileBytes.length, sha256: digest };
    const { data: priorMessages, error: messageReadError } = await admin.from("fechou_order_messages")
      .select("id,attachments").eq("order_id", String(row.order_id)).eq("professional_id", professionalId).eq("message_text", messageText).limit(20);
    if (messageReadError) throw new Error("Não foi possível conferir o anexo contratual já enviado ao chat: " + messageReadError.message);
    const attached = (priorMessages || []).some((m:any) => Array.isArray(m.attachments) && m.attachments.some((a:any) => a.path === path && a.sha256 === digest));
    if (!attached) {
      const { error: messageError } = await admin.from("fechou_order_messages").insert({
        order_id: String(row.order_id), professional_id: professionalId, sender_id: String(order.client_id || row.client_id),
        client_message_id: crypto.randomUUID(), message_text: messageText, attachments: [attachment], created_at: now
      });
      if (messageError) throw new Error("Contrato assinado, mas não foi possível anexar o PDF final à conversa: " + messageError.message);
    }
  } else {
    meta.service_status_label = "Contrato aceito — aguardando início";
  }
  const { error: updateOrderError } = await admin.from("orders").update(orderPatch).eq("id", row.order_id);
  if (updateOrderError) throw new Error(`Assinatura confirmada, mas falhou ao atualizar o pedido: ${updateOrderError.message}`);
  const email = await notifyOwnerWithSignedPdf(admin, { ...row, admin_notification_sent_at: row.admin_notification_sent_at }, fileBytes, digest, path);
  if (!email.sent) {
    // E-mail administrativo é aviso auxiliar; não deve manter um webhook de assinatura em retry
    // quando as duas assinaturas e o PDF final já foram confirmados e arquivados.
    console.warn("Clicksign: assinatura e PDF concluídos; aviso administrativo pendente.", email.reason || "Falha não identificada.");
  }
  return {
    completed: true,
    storage_path: path,
    sha256: digest,
    owner_email_sent: Boolean(email.sent),
    owner_email_error: email.sent ? null : String(email.reason || "Falha não identificada."),
  };
}


async function v195ApplyPrepaidSigner(admin:any,row:any,event:any,body:any){
 const who=signerInfoFromEvent(event,body);
 const byId=who.id&&who.id===String(row.signer_id||"");
 const byEmail=who.email&&who.email===String(row.signer_email||"").toLowerCase();
 if(!byId&&!byEmail)return row;
 if(row.signer_signed_at)return row;
 const {data,error}=await admin.from("fechou_prepaid_signature_documents").update({signer_signed_at:new Date().toISOString(),signature_status:"signed_waiting_close",updated_at:new Date().toISOString()}).eq("id",row.id).select("*").single();
 if(error)throw new Error("Falha ao registrar assinatura pré-paga: "+error.message);
 const target=row.kind==="master"?row.professional_id:row.client_id;
 if(target)try{await admin.from("notifications").insert({user_id:target,type:"contract_signed",title:row.kind==="master"?"Cliente assinou o contrato-base":"Profissional assinou o aditivo da proposta",body:"A Clicksign registrou a assinatura. O documento final está sendo arquivado.",data:{order_id:row.order_id,document_id:row.id,event_key:"prepaid-sign:"+row.id}})}catch(_){}
 return data;
}
async function v195ConfirmPrepaidEnvelope(admin:any,row:any){
 let current=row;
 try{
  const events=await clicksignRequest("/api/v3/envelopes/"+encodeURIComponent(row.envelope_id)+"/documents/"+encodeURIComponent(row.document_id)+"/events");
  const rows=Array.isArray(events?.data)?events.data:Array.isArray(events?.events)?events.events:[];
  for(const ev of rows){const a=obj(ev.attributes);if(str(a.name||ev.name).toLowerCase()==="sign")current=await v195ApplyPrepaidSigner(admin,current,{name:"sign",data:obj(a.data||ev.data)},{});}
 }catch(e){console.warn("Clicksign v195 event lookup:",(e as Error).message)}
 if(!current.signer_signed_at)return {completed:false,reason:"Aguardando assinatura individual do signatário."};
 const details=await clicksignRequest("/api/v3/envelopes/"+encodeURIComponent(row.envelope_id)+"/documents/"+encodeURIComponent(row.document_id));
 const d=obj(details?.data),files=obj(d?.links?.files||d?.attributes?.files);
 const signedUrl=signedFileUrl(files.signed||files.signed_file||d?.attributes?.signed_file_url||details?.document?.downloads?.signed_file_url);
 if(!signedUrl||!/^https:\/\//i.test(signedUrl))return {completed:false,reason:"Clicksign ainda não disponibilizou o PDF assinado."};
 const response=await fetch(signedUrl);if(!response.ok)throw new Error("Download do PDF assinado falhou: HTTP "+response.status);
 const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length<500||bytes.length>25*1024*1024||new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-")throw new Error("PDF assinado inválido.");
 const digest=await sha256Hex(bytes),path=String(row.order_id)+"/"+String(row.kind)+"-assinado-"+digest.slice(0,16)+".pdf";
 const {error:uploadError}=await admin.storage.from("fechou-contracts").upload(path,bytes,{upsert:true,contentType:"application/pdf"});
 if(uploadError)throw new Error("Falha ao arquivar o aditivo/contrato assinado: "+uploadError.message);
 const now=new Date().toISOString();
 const {error:updateError}=await admin.from("fechou_prepaid_signature_documents").update({signature_status:"signed",signed_pdf_storage_path:path,signed_pdf_sha256:digest,updated_at:now,last_error:null}).eq("id",row.id);
 if(updateError)throw new Error("PDF salvo, mas registro de assinatura não atualizado: "+updateError.message);
 const {data:order,error:orderError}=await admin.from("orders").select("metadata,client_id,professional_id").eq("id",row.order_id).maybeSingle();
 if(orderError)throw new Error(orderError.message);
 const meta=obj(order?.metadata);meta.prepaid_documents=Object.assign({},obj(meta.prepaid_documents),{[row.kind]:{id:row.id,sha256:row.document_sha256,signed_pdf_sha256:digest,signed_at:now}});
 const {error:metaError}=await admin.from("orders").update({metadata:meta,updated_at:now}).eq("id",row.order_id);
 if(metaError)throw new Error("Assinatura arquivada, mas falhou atualizar histórico do pedido: "+metaError.message);
 // The prepaid flow intentionally uses two immutable PDFs: client-signed base + pro-signed proposal annex.
 // Activate the contract row only after both signed PDFs have been archived and their hashes recorded.
 const {data:docs,error:docsError}=await admin.from("fechou_prepaid_signature_documents").select("kind,signature_status,signer_signed_at,signed_pdf_storage_path").eq("order_id",row.order_id);
 if(docsError)throw new Error("Falha ao conferir as duas vias assinadas: "+docsError.message);
 const baseSigned=(docs||[]).some((x:any)=>x.kind==="master"&&x.signature_status==="signed"&&x.signer_signed_at&&x.signed_pdf_storage_path);
 const annexSigned=(docs||[]).some((x:any)=>x.kind==="proposal_annex"&&x.signature_status==="signed"&&x.signer_signed_at&&x.signed_pdf_storage_path);
 if(baseSigned&&annexSigned){
  const base=(docs||[]).find((x:any)=>x.kind==="master");
  const annex=(docs||[]).find((x:any)=>x.kind==="proposal_annex");
  const {data:order,error:orderReadError}=await admin.from("orders").select("client_id,professional_id,selected_proposal_id,contract_accepted,metadata,total,professional_net,payment_status").eq("id",row.order_id).maybeSingle();
  if(orderReadError||!order)throw new Error("Não foi possível consultar contratação para concluir assinaturas.");
  let confirmedProfessional=String(order.professional_id||row.professional_id||"");
  if(!confirmedProfessional&&order.selected_proposal_id){
   const {data:selectedProposal,error:proposalError}=await admin.from("proposals").select("professional_id").eq("id",order.selected_proposal_id).eq("order_id",row.order_id).maybeSingle();
   if(proposalError)throw new Error("Falha ao resolver profissional da proposta aceita: "+proposalError.message);
   confirmedProfessional=String(selectedProposal?.professional_id||"");
  }
  if(!confirmedProfessional)throw new Error("O pedido não possui profissional confirmado após a aceitação da proposta.");
  const {error:masterPartyError}=await admin.from("fechou_prepaid_signature_documents").update({professional_id:confirmedProfessional,updated_at:now}).eq("order_id",row.order_id).eq("kind","master");
  if(masterPartyError)throw new Error("Assinaturas concluídas, mas não foi possível vincular o profissional ao contrato-base: "+masterPartyError.message);
  const signedMeta=obj(order.metadata);
   signedMeta.contract_state="active";
   signedMeta.prepaid_documents={...obj(signedMeta.prepaid_documents),master:{status:"signed",document_id:base.document_id,document_sha256:base.document_sha256,signed_pdf_sha256:base.signed_pdf_sha256,signed_at:base.signer_signed_at},proposal_annex:{status:"signed",document_id:annex.document_id,document_sha256:annex.document_sha256,signed_pdf_sha256:annex.signed_pdf_sha256,signed_at:annex.signer_signed_at}};
   const total=Math.round(Number(order.total||0)*100)/100;
   const storedNet=Number(order.professional_net||signedMeta.professional_net||0);
   const professionalNet=Number.isFinite(storedNet)&&storedNet>0?Math.round(storedNet*100)/100:Math.round(total*0.95*100)/100;
   const temporaryTestPrice=signedMeta.temporary_test_price===true||String(signedMeta.temporary_test_price||"").trim().toLowerCase()==="true"||signedMeta.temporary_test_payment_only===true||String(signedMeta.temporary_test_payment_only||"").trim().toLowerCase()==="true";
   signedMeta.temporary_test_payout_blocked=temporaryTestPrice;
   signedMeta.payout_state=temporaryTestPrice?"suppressed_test_mode":(String(order.service_state||signedMeta.service_state||"").toLowerCase()==="completed"?"release_ready":"held");
   if(temporaryTestPrice)signedMeta.payout_suppressed_at=now;
   signedMeta.professional_net=professionalNet;
   if(String(order.payment_status||"").toLowerCase()!=="approved"||!(total>0)||!(professionalNet>0)||professionalNet>total)throw new Error("Pagamento ou valor líquido inválido; o início do serviço permanece bloqueado.");
   const {error:activateOrderError}=await admin.from("orders").update({professional_id:confirmedProfessional,professional_net:professionalNet,contract_accepted:true,metadata:signedMeta,updated_at:now}).eq("id",row.order_id);
   if(activateOrderError)throw new Error("Assinaturas confirmadas, mas não foi possível ativar contrato e repasse vinculado no pedido: "+activateOrderError.message);
   if(!temporaryTestPrice){
    await createHeldPayoutLedger(admin,confirmedProfessional,String(row.order_id),professionalNet,String(signedMeta.asaas_payment_id||"")||null);
    const payoutEventKey="prepaid-payout-held:"+String(row.order_id);
    const {data:priorPayoutNotice,error:noticeReadError}=await admin.from("notifications").select("id").eq("user_id",confirmedProfessional).contains("data",{event_key:payoutEventKey}).maybeSingle();
    if(noticeReadError)throw new Error("Não foi possível conferir a notificação de valor reservado: "+noticeReadError.message);
    if(!priorPayoutNotice?.id){
     const amountLabel=professionalNet.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
     const {error:noticeError}=await admin.from("notifications").insert({user_id:confirmedProfessional,type:"payment_reserved",title:"Pagamento confirmado e valor reservado",body:"O pagamento do cliente foi confirmado. "+amountLabel+" do seu repasse líquido foram registrados como valor reservado nesta contratação. O valor ainda não está disponível para saque; ele depende da execução do serviço e da confirmação do cliente.",data:{order_id:String(row.order_id),event_key:payoutEventKey,amount:professionalNet,status:"held",release_condition:"client_approval_after_service_completion"}});
     if(noticeError)throw new Error("Não foi possível notificar o profissional sobre o valor reservado: "+noticeError.message);
    }
   } else {
    signedMeta.temporary_test_payout_blocked=true;
    signedMeta.payout_state="suppressed_test_mode";
    signedMeta.payout_suppressed_at=now;
    console.info("Clicksign: repasse pré-pago suprimido para preço temporário de teste.",row.order_id);
   }
   const {data:contracts,error:contractReadError}=await admin.from("contracts").select("id").eq("order_id",row.order_id).order("created_at",{ascending:false}).limit(1);
  if(contractReadError)throw new Error("Falha ao consultar contrato da contratação: "+contractReadError.message);
  const contractPatch={
   professional_id:confirmedProfessional,accepted:true,status:"active",
   client_accepted_at:base.signer_signed_at,professional_accepted_at:annex.signer_signed_at,
   accepted_at:now,signature_provider:"clicksign",signature_method:"clicksign",external_status:"signed",
   document_hash:base.document_sha256,document_version:1,
   client_signature_evidence:{provider:"clicksign",document_id:base.document_id,document_sha256:base.document_sha256,signed_pdf_sha256:base.signed_pdf_sha256,signed_at:base.signer_signed_at},
   professional_signature_evidence:{provider:"clicksign",document_id:annex.document_id,document_sha256:annex.document_sha256,signed_pdf_sha256:annex.signed_pdf_sha256,signed_at:annex.signer_signed_at},
   metadata:{prepaid_immutable_base_document_id:base.document_id,prepaid_proposal_annex_document_id:annex.document_id,prepaid_base_sha256:base.document_sha256,prepaid_annex_sha256:annex.document_sha256,signature_provider:"clicksign"}
  };
  if(contracts?.[0]?.id){
   const {error:contractUpdateError}=await admin.from("contracts").update({...contractPatch,updated_at:now}).eq("id",contracts[0].id);
   if(contractUpdateError)throw new Error("Assinaturas concluídas, mas falhou ativar o contrato no banco: "+contractUpdateError.message);
  }else{
   if(!order.selected_proposal_id)throw new Error("Proposta aceita não foi encontrada para registrar o contrato assinado.");
   const {error:contractInsertError}=await admin.from("contracts").insert({order_id:row.order_id,client_id:order.client_id,proposal_id:order.selected_proposal_id,created_at:now,...contractPatch});
   if(contractInsertError)throw new Error("Assinaturas concluídas, mas não foi possível criar o registro contratual: "+contractInsertError.message);
  }
  const messageText="O contrato da contratação foi assinado pelas duas partes pela Clicksign e arquivado no FECHOU. Esta é a via final do mesmo documento, com as duas assinaturas.";
   const attachments=[
    {type:"contract_pdf",bucket:"fechou-contracts",document_id:annex.id,path:annex.signed_pdf_storage_path,name:"Contrato da contratação assinado pelas duas partes.pdf",mime_type:"application/pdf",size:null,sha256:annex.signed_pdf_sha256}
   ];
   const {data:messages,error:messagesError}=await admin.from("fechou_order_messages").select("id,attachments").eq("order_id",String(row.order_id)).eq("professional_id",confirmedProfessional).eq("message_text",messageText).limit(20);
  if(messagesError)throw new Error("Falha ao consultar anexos contratuais da conversa: "+messagesError.message);
  const alreadyAttached=(messages||[]).some((m:any)=>Array.isArray(m.attachments)&&attachments.every(a=>m.attachments.some((x:any)=>x.document_id===a.document_id&&x.sha256===a.sha256)));
  if(!alreadyAttached){
   const {error:messageError}=await admin.from("fechou_order_messages").insert({order_id:String(row.order_id),professional_id:confirmedProfessional,sender_id:String(order.client_id),message_text:messageText,attachments,created_at:now});
   if(messageError)throw new Error("Documentos assinados não foram anexados à conversa: "+messageError.message);
  }
 }
 const notifyTo=row.kind==="master"?row.professional_id:row.client_id;
 if(notifyTo){const eventKey="prepaid-document-signed:"+row.id;const {data:prior}=await admin.from("notifications").select("id").eq("user_id",notifyTo).contains("data",{event_key:eventKey}).maybeSingle();if(!prior?.id)await admin.from("notifications").insert({user_id:notifyTo,type:"contract_signed",title:row.kind==="master"?"Contrato da contratação assinado pelo cliente":"Contrato da contratação assinado pelo profissional",body:"O documento assinado foi confirmado e arquivado no FECHOU.",data:{order_id:row.order_id,event_key:eventKey,document_id:row.id}})}
 return {completed:true,storage_path:path,sha256:digest};
}
async function v195HandlePrepaidWebhook(admin:any,row:any,eventName:string,eventObj:any,body:any){
 let current=row;
 if(eventName==="sign"){
  current=await v195ApplyPrepaidSigner(admin,current,eventObj,body);
  for(const ev of signEventsFrom(body))current=await v195ApplyPrepaidSigner(admin,current,ev,body);
  if(current.signer_signed_at) {
   const result=await v195ConfirmPrepaidEnvelope(admin,current);
   return result.completed?{completed:true}:{waiting:result.reason};
  }
  return {waiting:"Aguardando assinatura do signatário."};
 }
 if(["close","auto_close","document_closed","envelope_closed","closed","envelope.close"].includes(eventName)){
  const result=await v195ConfirmPrepaidEnvelope(admin,current);
  return result.completed?{completed:true}:{waiting:result.reason};
 }
 if(["cancel","canceled","cancelled","refusal","deadline"].includes(eventName)){
  const status=eventName==="deadline"?"expired":"cancelled";
  const {error}=await admin.from("fechou_prepaid_signature_documents").update({signature_status:status,last_error:"Evento Clicksign: "+eventName,updated_at:new Date().toISOString()}).eq("id",current.id);
  if(error)throw new Error(error.message);
 }
 return {processed:true};
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Método não permitido." });
  if (!CLICKSIGN_WEBHOOK_SECRET) return json(503, { ok: false, error: "CLICKSIGN_WEBHOOK_SECRET não configurado." });
  const raw = await req.text();
  const modernSignature = req.headers.get("x-clicksign-signature") || "";
  const legacySignature = req.headers.get("Content-Hmac") || req.headers.get("content-hmac") || "";
  const supplied = modernSignature || legacySignature;
  const headerName = modernSignature ? "x-clicksign-signature" : "content-hmac";
  if (!(await verifyHmac(raw, supplied, headerName))) return json(401, { ok: false, error: "Assinatura HMAC do webhook inválida." });
  let body: any;
  try { body = JSON.parse(raw); } catch { return json(400, { ok: false, error: "JSON inválido." }); }
  const eventObj = obj(body?.event);
  const eventName = str(eventObj.name || body?.name || body?.type, 100).toLowerCase();
  if (!eventName) return json(400, { ok: false, error: "Evento Clicksign sem nome." });
  const document = obj(body?.document || body?.data?.document || eventObj.data?.document);
  const envelope = obj(body?.envelope || body?.data?.envelope || eventObj.data?.envelope || document?.envelope);
  const envelopeId = str(envelope.key || envelope.id || body?.envelope_id || document?.envelope_id, 160);
  const documentId = str(document.key || document.id || body?.document_id, 160);
  const rawDigest = await sha256Hex(new TextEncoder().encode(raw));
  const eventId = str(eventObj.id || body?.id || body?.event_id, 240) || `${eventName}:${envelopeId}:${documentId}:${rawDigest}`;

  try {
    const admin = adminClient();
    const { error: insertError } = await admin.from("fechou_clicksign_webhook_events").insert({
      event_id: eventId, event_name: eventName, envelope_id: envelopeId || null,
      document_id: documentId || null, payload: body, received_at: new Date().toISOString(),
    });
    if (insertError && insertError.code === "23505") {
      const { data: prior } = await admin.from("fechou_clicksign_webhook_events").select("processed_at,processing_error").eq("event_id", eventId).maybeSingle();
      if (prior?.processed_at && !prior?.processing_error) return json(200, { ok: true, duplicate: true });
    } else if (insertError) throw new Error(`Falha ao registrar evento Clicksign: ${insertError.message}`);

    if (!envelopeId && !documentId) throw new Error("Evento sem identificador do envelope/documento Clicksign.");
    let row: any = null;
    if (envelopeId) {
      const byEnvelope = await admin.from("fechou_electronic_signatures").select("*").eq("envelope_id", envelopeId).maybeSingle();
      if (byEnvelope.error) throw new Error(`Falha ao localizar envelope Clicksign: ${byEnvelope.error.message}`);
      row = byEnvelope.data;
    }
    if (!row && documentId) {
      const byDocument = await admin.from("fechou_electronic_signatures").select("*").eq("document_id", documentId).maybeSingle();
      if (byDocument.error) throw new Error(`Falha ao localizar documento Clicksign: ${byDocument.error.message}`);
      row = byDocument.data;
    }
    if (!row) {
      let prepaid:any=null;
      if(envelopeId){const q=await admin.from("fechou_prepaid_signature_documents").select("*").eq("envelope_id",envelopeId).maybeSingle();if(q.error)throw new Error("Falha ao localizar documento pré-pago: "+q.error.message);prepaid=q.data;}
      if(!prepaid&&documentId){const q=await admin.from("fechou_prepaid_signature_documents").select("*").eq("document_id",documentId).maybeSingle();if(q.error)throw new Error("Falha ao localizar documento pré-pago: "+q.error.message);prepaid=q.data;}
      if(prepaid){
        const result=await v195HandlePrepaidWebhook(admin,prepaid,eventName,eventObj,body);
        const waitingReason=str(result?.waiting||"",500);
        const closureEvents=["close","auto_close","document_closed","envelope_closed","closed","envelope.close"];
        const retryRequired=Boolean(waitingReason)&&(closureEvents.includes(eventName)||waitingReason!=="Aguardando assinatura do signatário.");
        if(retryRequired){
          await admin.from("fechou_clicksign_webhook_events").update({processed_at:null,processing_error:waitingReason}).eq("event_id",eventId);
          return json(503,{ok:false,retry:true,event:eventName,prepaid:true,reason:waitingReason});
        }
        await admin.from("fechou_clicksign_webhook_events").update({processed_at:new Date().toISOString(),processing_error:null}).eq("event_id",eventId);
        return json(200,{ok:true,event:eventName,prepaid:true,...result});
      }
      await admin.from("fechou_clicksign_webhook_events").update({ processed_at: null, processing_error: "Aguardando vínculo do envelope/documento com o registro FECHOU; o provedor deve tentar novamente." }).eq("event_id", eventId);
      return json(503, { ok: false, retry: true, reason: "Envelope ainda não vinculado ao FECHOU; tente novamente." });
    }

    if (eventName === "sign") {
      row = await applySignerEvent(admin, row, eventObj, body);
      // A Clicksign também pode enviar a lista de eventos no objeto document.
      for (const ev of signEventsFrom(body)) row = await applySignerEvent(admin, row, ev, body);
      // Se o evento close chegar antes do último evento sign, a última assinatura
      // também tenta confirmar o fechamento diretamente na API Clicksign.
      if (row.client_signed_at && row.professional_signed_at && (row.signature_status !== "signed" || !row.signed_pdf_storage_path)) {
        // Reprocessa também a notificação quando o PDF já está assinado, mas o e-mail ainda não foi confirmado.
        try { await confirmEnvelopeClosed(admin, row); }
        catch (completionError) {
          console.warn("Clicksign: finalização/notificação ainda pendente após o evento sign.", (completionError as Error)?.message);
          throw completionError;
        }
      }
    } else if (["close", "auto_close", "document_closed", "envelope_closed", "closed", "envelope.close"].includes(eventName)) {
      const result = await confirmEnvelopeClosed(admin, row);
      if (!result.completed) {
        await admin.from("fechou_clicksign_webhook_events").update({ processed_at: new Date().toISOString(), processing_error: null }).eq("event_id", eventId);
        return json(200, { ok: true, waiting: result.reason });
      }
    } else if (["cancel", "canceled", "cancelled", "refusal", "deadline"].includes(eventName)) {
      const status = eventName === "deadline" ? "expired" : "cancelled";
      const { error } = await admin.from("fechou_electronic_signatures").update({ signature_status: status, updated_at: new Date().toISOString(), last_error: `Evento recebido da Clicksign: ${eventName}` }).eq("order_id", row.order_id);
      if (error) throw new Error(`Falha ao atualizar status da assinatura: ${error.message}`);
    }
    await admin.from("fechou_clicksign_webhook_events").update({ processed_at: new Date().toISOString(), processing_error: null }).eq("event_id", eventId);
    return json(200, { ok: true, event: eventName });
  } catch (error) {
    const message = str((error as Error)?.message || error, 1600);
    console.error("FECHOU Clicksign webhook", eventName, message);
    try {
      const admin = adminClient();
      await admin.from("fechou_clicksign_webhook_events").update({ processing_error: message }).eq("event_id", eventId);
    } catch (_) {}
    return json(503, { ok: false, error: message });
  }
});