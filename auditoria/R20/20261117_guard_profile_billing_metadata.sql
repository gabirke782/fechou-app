-- FECHOU R20.2: impedir que o titular da conta atribua para si uma assinatura paga.
-- Uma atualizacao comum de foto/nome/descricao continua permitida.
-- Somente chamadas com JWT role=authenticated sofrem a restricao.
-- Backend com credencial service_role pode registrar confirmacoes reais do Asaas.
create or replace function public.fechou_guard_profile_billing_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
declare
  v_key text;
  v_old jsonb;
  v_protected text[] := array[
    'subscription',
    'subscription_checkout_pending',
    'asaas_customer_id',
    'asaas_subscription_id',
    'asaas_payment_id',
    'subscription_status',
    'subscription_plan',
    'subscription_expires_at',
    'subscription_access_until',
    'billing_status',
    'payment_confirmed',
    'wallet_balance',
    'payout_status'
  ];
begin
  if nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '') is distinct from 'authenticated' then
    return new;
  end if;
  new.profile_data := coalesce(new.profile_data, '{}'::jsonb);
  if pg_catalog.jsonb_typeof(new.profile_data) <> 'object' then
    raise exception 'Dados do perfil invalidos.' using errcode='22023';
  end if;
  v_old := case when tg_op='UPDATE' then coalesce(old.profile_data, '{}'::jsonb)
                else '{}'::jsonb end;
  foreach v_key in array v_protected loop
    if v_old ? v_key then
      new.profile_data := pg_catalog.jsonb_set(new.profile_data, array[v_key], v_old->v_key, true);
    else
      new.profile_data := new.profile_data - v_key;
    end if;
  end loop;
  return new;
end;
$guard$;

revoke all on function public.fechou_guard_profile_billing_metadata() from public, anon, authenticated;
drop trigger if exists fechou_guard_profile_billing_metadata_trigger on public.profiles;
create trigger fechou_guard_profile_billing_metadata_trigger
  before insert or update of profile_data on public.profiles
  for each row
  execute function public.fechou_guard_profile_billing_metadata();
