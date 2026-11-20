// FECHOU CORREÇÃO Nº 2 — SUBSTITUIR APENAS A FUNÇÃO getWalletRefundRequests(ctx)
// Fonte auditada: Edge Function eworkers-api versão 349 (19/11/2026).
// Este arquivo foi preparado na ramificação isolada. NÃO foi implantado no Supabase.
// Na unificação, aplicar estas alterações ao código da função mais recente, preservar
// as outras rotas e testar antes de implantar; não substituir a Edge Function inteira.
async function getWalletRefundRequests(ctx) {
  ensureUserRole(getRole(ctx.profile, ctx.user), "client");
  const { data: orders, error: orderError } = await ctx.admin.from("orders").select("id,client_id,created_at,updated_at,total,payment_status,payment_provider,payment_id,refund_status,refund_at,cancel_reason,metadata,payment_metadata,service,title").eq("client_id", ctx.user.id).order("updated_at", {
    ascending: false
  }).limit(200);
  if (orderError) throw Object.assign(new Error("Falha ao consultar os reembolsos das suas contratações: " + orderError.message), {
    status: 500
  });
  const orderRows = Array.isArray(orders) ? orders : [];
  const orderIds = orderRows.map((o)=>String(o.id)).filter(Boolean);
  if (!orderIds.length) return {
    ok: true,
    requests: []
  };
  const [ledgerResult, checkoutResult] = await Promise.all([
    ctx.admin.from("fechou_wallet_ledger").select("order_id,amount,status,description,created_at,updated_at,provider_reference").eq("user_id", ctx.user.id).eq("entry_type", "refund").in("order_id", orderIds).order("created_at", {
      ascending: false
    }).limit(300),
    ctx.admin.from("fechou_asaas_checkouts").select("order_id,provider_payload,created_at").eq("user_id", ctx.user.id).in("purpose", [
      "service",
      "prepublication"
    ]).in("order_id", orderIds).order("created_at", {
      ascending: false
    }).limit(300)
  ]);
  const { data: ledger, error: ledgerError } = ledgerResult;
  if (ledgerError) throw Object.assign(new Error("Falha ao consultar os lançamentos de reembolso: " + ledgerError.message), {
    status: 500
  });
  const { data: checkouts, error: checkoutError } = checkoutResult;
  if (checkoutError) throw Object.assign(new Error("Falha ao conferir a forma de pagamento: " + checkoutError.message), {
    status: 500
  });
  const ledgerByOrder = new Map();
  for (const row of ledger || []){
    const id = String(row.order_id || "");
    if (id) ledgerByOrder.set(id, [
      ...ledgerByOrder.get(id) || [],
      row
    ]);
  }
  const checkoutByOrder = new Map();
  for (const row of checkouts || []){
    const id = String(row.order_id || "");
    if (id && !checkoutByOrder.has(id)) checkoutByOrder.set(id, row);
  }
  const safeAsaasUrl = (value)=>{
    const raw = text(value, 1200);
    if (!raw) return null;
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      return u.protocol === "https:" && (host === "asaas.com" || host.endsWith(".asaas.com") || host === "asaas.com.br" || host.endsWith(".asaas.com.br")) ? u.toString() : null;
    } catch (_) {
      return null;
    }
  };
  const requests = [];
  for (const order of orderRows){
    const orderId = String(order.id);
    const meta = asObject(order.metadata);
    const paymentMeta = asObject(order.payment_metadata);
    // Consolidar somente confirmações integrais repetidas da mesma cobrança, sem
    // eliminar estornos parciais nem alterar o histórico contábil existente.
    const seenCompleteRefunds = new Set();
    const refundRows = (ledgerByOrder.get(orderId) || []).filter((r)=>{
      if (String(r.status || "").toLowerCase() !== "refunded") return true;
      const providerRef = String(r.provider_reference || "");
      if (!providerRef) return true;
      const key = providerRef + ":" + Number(r.amount || 0).toFixed(2);
      if (seenCompleteRefunds.has(key)) return false;
      seenCompleteRefunds.add(key);
      return true;
    });
    const rawStatus = String(order.refund_status || meta.refund_status || "").toLowerCase();
    const paymentStatus = String(order.payment_status || "").toLowerCase();
    if (!rawStatus && !refundRows.length && paymentStatus !== "refunded") continue;
    const total = Math.max(0, Number(order.total || 0));
    const refundedValue = Math.min(total, refundRows.filter((r)=>[
        "refunded",
        "partially_refunded"
      ].includes(String(r.status || "").toLowerCase())).reduce((sum, r)=>sum + Math.max(0, Number(r.amount || 0)), 0));
    const pendingValue = Math.min(Math.max(0, total - refundedValue), refundRows.filter((r)=>[
        "refund_pending",
        "pending"
      ].includes(String(r.status || "").toLowerCase())).reduce((sum, r)=>sum + Math.max(0, Number(r.amount || 0)), 0));
    let status = rawStatus || String(refundRows[0]?.status || "").toLowerCase();
    if (paymentStatus === "refunded" || status === "refunded") status = "done";
    else if (status === "refund_pending") status = "in_progress";
    else if (status === "pending") status = "submitted";
    else if (status === "partially_refunded") status = "partial";
    const checkout = checkoutByOrder.get(orderId);
    const checkoutPayload = asObject(checkout?.provider_payload);
    const billingType = String(checkoutPayload.billing_type || paymentMeta.billing_type || paymentMeta.billingType || meta.payment_billing_type || meta.billing_type || "").toUpperCase();
    const refundTotal = Math.max(0, Number(meta.refund_total || 0));
    const amount = refundedValue + pendingValue || refundTotal || total;
    const pendingShown = pendingValue || ([
      "submitted",
      "in_progress",
      "pending",
      "bank_slip_action_required"
    ].includes(status) ? amount : 0);
    const requestUrl = safeAsaasUrl(meta.refund_request_url || meta.request_url);
    const receiptUrl = safeAsaasUrl(meta.refund_receipt_url || meta.receipt_url);
    requests.push({
      order_id: orderId,
      billing_type: billingType || "Pagamento protegido",
      created_at: refundRows[0]?.created_at || meta.refund_requested_at || order.refund_at || checkout?.created_at || order.updated_at || order.created_at,
      amount: Number(amount.toFixed(2)),
      status: status || "review_required",
      reason: text(meta.refund_reason || meta.cancel_reason || order.cancel_reason || refundRows[0]?.description || "", 500),
      provider_summary: {
        refunded_value: Number(refundedValue.toFixed(2)),
        pending_value: Number(pendingShown.toFixed(2))
      },
      request_url: requestUrl,
      receipt_url: receiptUrl,
      service: text(order.service || order.title || "Serviço", 160)
    });
  }
  return {
    ok: true,
    requests
  };
}
