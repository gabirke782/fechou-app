-- FECHOU R20.3 | Impede acesso ao chat/evidencias somente por ter enviado proposta.
-- A proposta precisa estar selecionada pelo cliente, mantendo os demais controles existentes.
CREATE OR REPLACE FUNCTION public.fechou_can_access_order(p_order_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.orders o
    where o.id::text=p_order_id
      and (
        o.client_id=(select auth.uid())
        or o.professional_id=(select auth.uid())
        or exists(select 1 from public.proposals p where p.order_id=o.id and p.professional_id=(select auth.uid()) and (o.selected_proposal_id is not null and o.selected_proposal_id=p.id))
      )
      and (
        lower(coalesce(o.payment_method,o.payment_flow,o.client_payment_preference,'direct')) not in ('contract_prepaid','prepaid','asaas','fechou')
        or public.fechou_prepaid_chat_enabled(o.id)
      )
  );
$function$

