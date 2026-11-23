CREATE OR REPLACE FUNCTION public.fechou_update_request_pricing(p_order_id text, p_reference_price numeric, p_client_discount numeric, p_total numeric, p_metadata jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_safe_metadata jsonb;
  v_expected_total numeric;
begin
  if auth.uid() is null then
    raise exception 'Faça login para atualizar o pedido.' using errcode='28000';
  end if;

  select * into v_order
  from public.orders
  where id::text=p_order_id
  for update;

  if not found then raise exception 'Pedido não encontrado.' using errcode='P0002'; end if;
  if v_order.client_id is distinct from auth.uid() then
    raise exception 'Somente o cliente que criou o pedido pode atualizar seu preço.' using errcode='42501';
  end if;

  if v_order.selected_proposal_id is not null or v_order.professional_id is not null then
    raise exception 'O preço não pode ser alterado depois da seleção de um profissional.' using errcode='55000';
  end if;

  if lower(coalesce(v_order.status,'')) like '%cancel%'
     or lower(coalesce(v_order.service_state,'')) like '%cancel%'
     or v_order.cancellation_requested_at is not null
     or nullif(trim(coalesce(v_order.cancel_reason,'')),'') is not null then
    raise exception 'O preço de uma contratação cancelada ou em análise de cancelamento não pode ser alterado.'
      using errcode='55000';
  end if;

  if lower(coalesce(v_order.payment_status,'')) in ('approved','paid','received','confirmed')
     or v_order.payment_id is not null then
    raise exception 'O preço não pode ser alterado depois que existe uma cobrança vinculada ou pagamento confirmado.'
      using errcode='55000';
  end if;

  if p_reference_price is null or p_reference_price <= 0
     or p_total is null or p_total < 0
     or p_client_discount is null or p_client_discount < 0 or p_client_discount > 20 then
    raise exception 'Composição de preço inválida.' using errcode='22023';
  end if;

  v_expected_total := round(p_reference_price * (1 - p_client_discount / 100), 2);
  if abs(round(p_total,2) - v_expected_total) > 0.02 then
    raise exception 'O valor final não corresponde ao preço de referência e ao desconto informado.'
      using errcode='22023';
  end if;

  v_safe_metadata := jsonb_strip_nulls(jsonb_build_object(
    'laborAverage', p_metadata->'laborAverage',
    'urgencyAdd', p_metadata->'urgencyAdd',
    'weekendAdd', p_metadata->'weekendAdd',
    'weekendSurcharge', p_metadata->'weekendSurcharge',
    'grossReferencePrice', p_metadata->'grossReferencePrice',
    'laborReferencePrice', p_metadata->'laborReferencePrice',
    'requestedPrice', p_metadata->'requestedPrice',
    'materialsEstimateAverage', p_metadata->'materialsEstimateAverage',
    'priceComposition', p_metadata->'priceComposition'
  ));
  IF jsonb_typeof(p_metadata->'regionalPriceLow') = 'number'
     AND jsonb_typeof(p_metadata->'regionalPriceAverage') = 'number'
     AND jsonb_typeof(p_metadata->'regionalPriceHigh') = 'number'
     AND (p_metadata->>'regionalPriceLow')::numeric > 0
     AND (p_metadata->>'regionalPriceLow')::numeric <= (p_metadata->>'regionalPriceAverage')::numeric
     AND (p_metadata->>'regionalPriceAverage')::numeric <= (p_metadata->>'regionalPriceHigh')::numeric
  THEN
    v_safe_metadata := v_safe_metadata || jsonb_build_object(
      'regionalPriceLow', p_metadata->'regionalPriceLow',
      'regionalPriceAverage', p_metadata->'regionalPriceAverage',
      'regionalPriceHigh', p_metadata->'regionalPriceHigh'
    );
  END IF;

  update public.orders
  set reference_price=round(p_reference_price,2),
      client_discount=round(p_client_discount,2),
      total=round(p_total,2),
      metadata=coalesce(metadata,'{}'::jsonb)||coalesce(v_safe_metadata,'{}'::jsonb),
      updated_at=now()
  where id=v_order.id
  returning * into v_order;

  return jsonb_build_object('ok',true,'order',to_jsonb(v_order));
end;
$function$;

-- Alteração aplicada em 22/11/2026 no projeto ziubcqxmxialhmwevtiy.
-- Preserva a faixa regional somente se mínimo <= médio <= máximo e todos positivos.
-- A RPC exige auth.uid(), titularidade do pedido, ausência de contratação e ausência de pagamento.
