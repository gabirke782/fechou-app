CREATE OR REPLACE FUNCTION public.fechou_accept_proposal_and_open_chat(p_order_id text, p_proposal_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_proposal public.proposals%rowtype;
  v_client_mode text;
  v_professional_mode text;
  v_negotiation public.fechou_payment_negotiations%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Faça login.' using errcode='28000'; end if;
  if coalesce(p_order_id,'')='' or coalesce(p_proposal_id,'')='' then
    raise exception 'Pedido ou proposta não informado.' using errcode='22023';
  end if;
  select * into v_order from public.orders where id::text=p_order_id for update;
  if not found or v_order.client_id is distinct from auth.uid() then
    raise exception 'Somente o cliente que publicou o pedido pode aceitar uma proposta.' using errcode='42501';
  end if;
  select * into v_proposal from public.proposals
   where id::text=p_proposal_id and order_id::text=p_order_id for update;
  if not found then raise exception 'Proposta não encontrada para este pedido.' using errcode='P0002'; end if;
  if lower(coalesce(v_order.status,'')) not in ('open','novo','recebendo propostas','em negociação','nova solicitação','aguardando escolha do cliente','')
     and coalesce(v_order.selected_proposal_id::text,'')<>p_proposal_id then
    raise exception 'Este pedido já está em contratação ou encerrado.' using errcode='55000';
  end if;

  v_client_mode := case
    when lower(coalesce(v_order.client_payment_preference,v_order.payment_method,v_order.payment_flow,'direct')) ~ '(asaas|fechou|prepaid|checkout|contract)' then 'contract_prepaid'
    else 'direct' end;
  v_professional_mode := case
    when lower(coalesce(v_proposal.professional_payment_preference,v_proposal.metadata->>'payment_method','direct')) ~ '(asaas|fechou|prepaid|checkout|contract)' then 'contract_prepaid'
    else 'direct' end;

  if v_order.payment_status='approved' and (v_client_mode<>'contract_prepaid' or v_professional_mode<>'contract_prepaid') then
    raise exception 'O pagamento já foi confirmado. A modalidade protegida não pode ser alterada sem análise financeira.' using errcode='55000';
  end if;

  if v_client_mode<>v_professional_mode then
    select * into v_negotiation from public.fechou_payment_negotiations
      where order_id=v_order.id and proposal_id=v_proposal.id
        and status in ('awaiting_client','awaiting_professional')
      order by created_at desc limit 1 for update;
    if not found then
      insert into public.fechou_payment_negotiations(
        order_id,proposal_id,client_id,professional_id,client_mode,professional_mode,
        requested_mode,requested_by,status,revision,metadata
      ) values (
        v_order.id,v_proposal.id,v_order.client_id,v_proposal.professional_id,
        v_client_mode,v_professional_mode,v_professional_mode,v_proposal.professional_id,
        'awaiting_client',1,'{}'::jsonb
      ) returning * into v_negotiation;
    end if;
    update public.orders set
      selected_proposal_id=v_proposal.id,professional_id=v_proposal.professional_id,
      status='in_negotiation',contract_accepted=false,updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('payment_mode_negotiation_id',v_negotiation.id,'payment_mode_negotiation_status',v_negotiation.status)
     where id=v_order.id returning * into v_order;
    insert into public.notifications(user_id,type,title,body,data)
    select v_order.client_id,'payment_mode_negotiation','Confirme a modalidade de pagamento',
      'O profissional selecionado propôs uma modalidade de pagamento diferente. Abra a conversa para concordar ou apresentar sua modalidade.',
      jsonb_build_object('order_id',v_order.id,'negotiation_id',v_negotiation.id,'event_key','payment-mode-'||v_negotiation.id)
    where not exists(select 1 from public.notifications n where n.user_id=v_order.client_id and n.type='payment_mode_negotiation' and n.data->>'negotiation_id'=v_negotiation.id::text);
    insert into public.notifications(user_id,type,title,body,data)
    select v_proposal.professional_id,'payment_mode_negotiation','Aguardando confirmação da modalidade',
      'O cliente precisa confirmar a modalidade de pagamento para concluir a contratação.',
      jsonb_build_object('order_id',v_order.id,'negotiation_id',v_negotiation.id,'event_key','payment-mode-'||v_negotiation.id)
    where not exists(select 1 from public.notifications n where n.user_id=v_proposal.professional_id and n.type='payment_mode_negotiation' and n.data->>'negotiation_id'=v_negotiation.id::text);
    return jsonb_build_object('proposal',to_jsonb(v_proposal),'order',to_jsonb(v_order),'contract',null,'negotiation',to_jsonb(v_negotiation),'payment_mode',null);
  end if;

  v_result := public.fechou_finalize_order_proposal(v_order.id,v_proposal.id,v_client_mode);
  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fechou_save_proposal(p_order_id text, p_price numeric, p_message text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS proposals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_proposal public.proposals%rowtype;
  v_role text;
  v_status text;
  v_prepaid boolean := false;
  v_price numeric;
  v_message text;
  v_metadata jsonb;
  v_high_raw text;
  v_high numeric;
begin
  if auth.uid() is null then
    raise exception 'Faça login para enviar seu interesse.' using errcode='28000';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'Informe um valor válido para a proposta.' using errcode='22023';
  end if;
  select lower(coalesce(role, ''))
    into v_role
  from public.profiles
  where id = auth.uid();
  if coalesce(v_role, '') not in ('professional', 'profissional') then
    raise exception 'Somente uma conta profissional pode enviar proposta.' using errcode='42501';
  end if;

  select *
    into v_order
  from public.orders
  where id::text = trim(p_order_id)
  for update;
  if not found then
    raise exception 'Pedido não encontrado.' using errcode='P0002';
  end if;
  if v_order.client_id = auth.uid() then
    raise exception 'O cliente não pode enviar proposta para o próprio pedido.' using errcode='42501';
  end if;

  v_status := lower(coalesce(v_order.status, ''));
  if v_status not in ('open','novo','recebendo propostas','em negociação','nova solicitação','aguardando escolha do cliente') then
    raise exception 'Este pedido não está recebendo profissionais.' using errcode='55000';
  end if;
  if v_order.professional_id is not null and v_order.professional_id <> auth.uid() then
    raise exception 'Este pedido já está vinculado a outro profissional.' using errcode='55000';
  end if;
  if v_order.selected_proposal_id is not null then
    raise exception 'Este pedido já possui um profissional selecionado.' using errcode='55000';
  end if;

  v_prepaid := lower(coalesce(
    v_order.payment_method,
    v_order.payment_flow,
    v_order.client_payment_preference,
    v_order.metadata->>'payment_method',
    'direct'
  )) in ('contract_prepaid','prepaid','asaas','fechou');

  if not v_prepaid then
    v_high_raw := coalesce(
      nullif(v_order.metadata->>'regionalPriceHigh',''),
      nullif(v_order.metadata->'priceRange'->>'high','')
    );
    if v_high_raw ~ '^[0-9]+(\.[0-9]+)?$' then
      v_high := v_high_raw::numeric;
    end if;
    if coalesce(v_high,0) > 0 and p_price > v_high then
      raise exception 'A proposta não pode ultrapassar o valor alto estimado da região: R$ %.', to_char(v_high,'FM999G999G990D00')
        using errcode='22023';
    end if;
  end if;

  v_price := p_price;
  v_message := left(coalesce(p_message, ''), 5000);
  v_metadata := coalesce(p_metadata, '{}'::jsonb);

  if v_prepaid then
    if lower(coalesce(v_order.payment_status, '')) <> 'approved' then
      raise exception 'O pedido pré-pago ainda não tem pagamento confirmado.' using errcode='55000';
    end if;
    if abs(coalesce(v_order.total, 0) - p_price) > 0.01 then
      raise exception 'O valor deste pedido já foi pago e não pode ser alterado pelo profissional.' using errcode='55000';
    end if;
    v_price := v_order.total;
    v_message := 'Tenho interesse em executar este serviço pelo valor já pago pelo cliente. Confira meu perfil e experiência.';
    v_metadata := v_metadata || jsonb_build_object(
      'intent_type','execution_interest',
      'fixed_prepaid_price',true,
      'payment_method','contract_prepaid',
      'professional_payment_preference','contract_prepaid',
      'price_locked',true
    );
  end if;

  select *
    into v_proposal
  from public.proposals
  where order_id::text = v_order.id::text
    and professional_id = auth.uid()
    and lower(coalesce(status, 'pending')) in ('pending','pendente','em negociação')
  order by coalesce(updated_at,created_at) desc
  limit 1
  for update;

  if found then
    update public.proposals
    set price = v_price,
        message = v_message,
        status = 'pending',
        metadata = v_metadata,
        professional_payment_preference = case
          when v_prepaid then 'contract_prepaid'
          else coalesce(nullif(v_metadata->>'professional_payment_preference',''), professional_payment_preference)
        end,
        updated_at = now()
    where id = v_proposal.id
    returning * into v_proposal;
  else
    insert into public.proposals (
      order_id, professional_id, price, message, status, metadata,
      professional_payment_preference, created_at, updated_at
    )
    values (
      v_order.id, auth.uid(), v_price, v_message, 'pending', v_metadata,
      case when v_prepaid then 'contract_prepaid'
           else coalesce(nullif(v_metadata->>'professional_payment_preference',''),'direct') end,
      now(), now()
    )
    returning * into v_proposal;
  end if;
  return v_proposal;
end;
$function$
;

