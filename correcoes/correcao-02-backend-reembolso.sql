-- FECHOU / CORREÇÃO Nº 2 — MIGRAÇÃO BACKEND ISOLADA
-- NÃO EXECUTADA EM PRODUÇÃO: revisar, testar e aplicar durante a unificação das correções.
-- Diagnóstico: existem dois registros ledger/refund criados pelo webhook e pelo trigger da mesma cobrança.
-- Esta proteção evita nova inserção pelo trigger quando o webhook já confirmou o estorno.
-- Não dispara pagamentos, saques, estornos, nem altera registros históricos.
BEGIN;
CREATE OR REPLACE FUNCTION public.fechou_apply_refund_effects(p_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE o record; v_cancelled int := 0; v_amount numeric; v_ref text;
BEGIN
  SELECT id, client_id, professional_id, total, payment_id, status INTO o FROM public.orders WHERE id::text = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;
  v_amount := COALESCE((SELECT l.amount FROM public.fechou_wallet_ledger l WHERE l.order_id::text = o.id::text AND l.entry_type='service_payment' ORDER BY l.created_at LIMIT 1), o.total, 0);
  v_ref := o.payment_id;
  -- 1) repasse do profissional deixa de existir
  UPDATE public.fechou_wallet_ledger
     SET status = 'cancelled', updated_at = now(),
         metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('cancelled_reason','order_refunded','cancelled_at', now())
   WHERE order_id::text = o.id::text AND entry_type = 'payout' AND status IN ('pending','held','release_ready');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  -- 2) lançamento de reembolso do cliente (sem duplicar)
  IF o.client_id IS NOT NULL AND v_amount > 0 THEN
    -- Protege leitura/verificação contra duas confirmações concorrentes da mesma cobrança.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fechou:refund:' || o.id::text, 0));
    -- O webhook pode ter registrado este estorno com outra chave; não criar outra linha.
    IF NOT EXISTS (
      SELECT 1 FROM public.fechou_wallet_ledger l
       WHERE l.order_id::text = o.id::text
         AND l.user_id = o.client_id
         AND l.entry_type = 'refund'
         AND l.provider = 'asaas'
         AND l.provider_reference IS NOT DISTINCT FROM v_ref
         AND l.amount = v_amount
         AND l.status = 'refunded'
    ) THEN
      INSERT INTO public.fechou_wallet_ledger(user_id, order_id, entry_type, amount, status, provider, provider_reference, description, idempotency_key, metadata)
    VALUES (o.client_id, o.id::text, 'refund', v_amount, 'refunded', 'asaas', v_ref, 'Reembolso confirmado pelo Asaas.',
            'fechou-ledger:v1:refund:' || o.id::text || ':' || o.client_id::text, jsonb_build_object('source','refund_effects'))
      ON CONFLICT (idempotency_key) DO UPDATE SET status = 'refunded', updated_at = now();
    END IF;
  END IF;
  -- 3) pedido cancelado e avisos
  IF o.status NOT IN ('completed','cancelled') THEN
    UPDATE public.orders SET status = 'cancelled' WHERE id::text = o.id::text;
  END IF;
  IF o.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id=o.client_id AND n.type='refund_confirmed' AND n.data @> jsonb_build_object('order_id', o.id::text)) THEN
    INSERT INTO public.notifications(user_id, type, title, body, data)
    VALUES (o.client_id, 'refund_confirmed', 'Reembolso concluído',
            'O valor de R$ ' || replace(to_char(v_amount,'FM999G990D00'),'.',',') || ' foi estornado ao seu meio de pagamento. O prazo para aparecer na fatura depende do banco.',
            jsonb_build_object('order_id', o.id::text, 'event_key', 'refund_confirmed', 'amount', v_amount));
  END IF;
  IF o.professional_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id=o.professional_id AND n.type='service_cancelled_refunded' AND n.data @> jsonb_build_object('order_id', o.id::text)) THEN
    INSERT INTO public.notifications(user_id, type, title, body, data)
    VALUES (o.professional_id, 'service_cancelled_refunded', 'Serviço cancelado e pagamento devolvido',
            'O cliente cancelou e o pagamento foi estornado. O valor reservado na sua carteira foi removido.',
            jsonb_build_object('order_id', o.id::text, 'event_key', 'service_cancelled_refunded'));
  END IF;
  RETURN jsonb_build_object('ok', true, 'payout_entries_cancelled', v_cancelled);
END $function$

COMMIT;

-- Pós-migração: consulta somente leitura para verificar duplicidades anteriores:
-- SELECT order_id, provider_reference, amount, count(*) AS qtd
-- FROM public.fechou_wallet_ledger
-- WHERE entry_type='refund' AND status='refunded'
-- GROUP BY order_id, provider_reference, amount HAVING count(*)>1;
-- Testar em homologação: webhook/trigger em ordem reversa e duplicados, mais estorno parcial.
