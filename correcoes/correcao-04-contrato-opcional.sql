-- FECHOU · Correção nº 4 · Contrato opcional em pagamento direto
-- MIGRAÇÃO ISOLADA: aplicar na integração final com a branch nº 4.
-- Não altera contratos já existentes nem ativa fluxo novo para pagamentos pelo app.

create or replace function public.fechou_qa4_respond_optional_contract(
  p_order_id uuid, p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $qa4$
declare
  v_order public.orders%rowtype;
  v_proposal public.proposals%rowtype;
  v_mode text;
  v_state text;
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'Entre na conta para responder à solicitação.' using errcode='28000';
  end if;
  if p_order_id is null or p_accept is null then
    raise exception 'Informe o pedido e a decisão.' using errcode='22023';
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode='P0002'; end if;
  if v_order.client_id is distinct from v_actor then
    raise exception 'Somente o cliente desta contratação pode responder.' using errcode='42501';
  end if;
  if v_order.selected_proposal_id is null then
    raise exception 'Não há proposta selecionada.' using errcode='55000';
  end if;
  if v_order.archived_at is not null
     or lower(coalesce(v_order.service_state,'')) in ('cancelled','completed','support_review')
     or v_order.cancellation_requested_at is not null then
    raise exception 'Esta contratação não pode receber novos aceites.' using errcode='55000';
  end if;
  v_mode := lower(coalesce(nullif(v_order.payment_method,''),nullif(v_order.payment_flow,''),
    nullif(v_order.metadata->>'payment_mode_agreed',''),'direct'));
  if v_mode in ('contract_prepaid','prepaid','asaas','fechou') then
    raise exception 'Contratos do pagamento pelo aplicativo seguem o fluxo de assinatura obrigatório.' using errcode='55000';
  end if;
  select * into v_proposal from public.proposals
    where id=v_order.selected_proposal_id and order_id=v_order.id for share;
  if not found or v_proposal.professional_id is distinct from v_order.professional_id then
    raise exception 'A proposta selecionada não corresponde ao profissional vinculado.' using errcode='42501';
  end if;
  if not (lower(coalesce(v_proposal.metadata->>'generate_contract',
                              v_proposal.metadata->>'contract_requested','false')) in ('true','yes','1')) then
    raise exception 'O profissional não solicitou um contrato nesta proposta.' using errcode='55000';
  end if;
  v_state := lower(coalesce(v_order.metadata->>'optional_direct_contract_status','pending'));
  if v_state in ('accepted','declined') then
    if (v_state='accepted') is distinct from p_accept then
      raise exception 'A decisão já foi registrada. Procure o suporte para alterá-la.' using errcode='55000';
    end if;
    return jsonb_build_object('ok',true,'status',v_state,'reused',true);
  end if;
  v_state := case when p_accept then 'accepted' else 'declined' end;
  update public.orders
  set metadata = coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
           'optional_direct_contract_status',v_state,
           'optional_direct_contract_responded_at',now(),
           'contract_required',p_accept
         ),
      updated_at=now()
  where id=v_order.id;
  insert into public.notifications(user_id,type,title,body,data,metadata)
  values(v_proposal.professional_id,'contract_offer_reply',
    case when p_accept then 'Cliente aceitou o contrato' else 'Cliente recusou o contrato' end,
    case when p_accept then 'O cliente autorizou a preparação do contrato opcional no chat.'
         else 'O cliente prefere seguir sem contrato pelo aplicativo. Revise sua proposta e prossiga pela modalidade direta.' end,
    jsonb_build_object('order_id',v_order.id,'proposal_id',v_proposal.id,'accepted',p_accept),
    jsonb_build_object('source','qa4_optional_contract'));
  return jsonb_build_object('ok',true,'status',v_state,'order_id',v_order.id);
end;
$qa4$;

revoke all on function public.fechou_qa4_respond_optional_contract(uuid,boolean) from public,anon;
grant execute on function public.fechou_qa4_respond_optional_contract(uuid,boolean) to authenticated;

-- Informa ao cliente apenas quando uma proposta que solicita contrato for escolhida.
-- Também trava a geração do contrato direto até que ele aceite.
create or replace function public.fechou_qa4_notify_optional_direct_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $qa4$
declare
  v_proposal public.proposals%rowtype;
  v_mode text;
  v_status text;
begin
  if new.selected_proposal_id is null then return new; end if;
  if new.selected_proposal_id is not distinct from old.selected_proposal_id
     and (new.metadata->>'payment_mode_agreed') is not distinct from (old.metadata->>'payment_mode_agreed') then
    return new;
  end if;
  v_mode := lower(coalesce(nullif(new.payment_method,''),nullif(new.payment_flow,''),
     nullif(new.metadata->>'payment_mode_agreed',''),'direct'));
  if v_mode in ('contract_prepaid','prepaid','asaas','fechou') then return new; end if;
  if exists (select 1 from public.contracts c where c.order_id=new.id and c.status is distinct from 'cancelled') then
    return new;
  end if;
  select * into v_proposal from public.proposals
    where id=new.selected_proposal_id and order_id=new.id;
  if not found then return new; end if;
  v_status := case when lower(coalesce(v_proposal.metadata->>'generate_contract',
                            v_proposal.metadata->>'contract_requested','false')) in ('true','yes','1')
                    then 'pending' else 'not_requested' end;
  update public.orders set
    metadata = coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object('optional_direct_contract_status',v_status,'contract_required',false),
    updated_at=now()
  where id=new.id and coalesce(metadata->>'optional_direct_contract_status','') is distinct from v_status;
  if v_status='pending' and not exists (
    select 1 from public.notifications n
    where n.user_id=new.client_id and n.type='optional_contract_offer'
       and n.data->>'order_id'=new.id::text
       and n.data->>'proposal_id'=new.selected_proposal_id::text
  ) then
    insert into public.notifications(user_id,type,title,body,data,metadata)
    values(new.client_id,'optional_contract_offer','Profissional deseja contrato',
      'O profissional selecionado solicitou um contrato opcional. Abra o chat para aceitar ou recusar.',
      jsonb_build_object('order_id',new.id,'proposal_id',new.selected_proposal_id),
      jsonb_build_object('source','qa4_optional_contract'));
  end if;
  return new;
end;
$qa4$;

revoke all on function public.fechou_qa4_notify_optional_direct_contract() from public,anon,authenticated;
drop trigger if exists fechou_qa4_optional_direct_contract on public.orders;
create trigger fechou_qa4_optional_direct_contract
after update of selected_proposal_id, metadata on public.orders
for each row
when (
  (new.selected_proposal_id is distinct from old.selected_proposal_id)
  or ((new.metadata->>'payment_mode_agreed') is distinct from (old.metadata->>'payment_mode_agreed'))
)
execute function public.fechou_qa4_notify_optional_direct_contract();
