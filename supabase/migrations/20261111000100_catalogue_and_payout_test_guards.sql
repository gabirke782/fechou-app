create or replace view public.fechou_public_service_catalogue_v138
with (security_invoker=true)
as
select
  id::text as id,
  coalesce(category, 'Serviço'::text) as category,
  coalesce(service, title, 'Serviço solicitado'::text) as service,
  title,
  nullif(btrim(region_approx), '') as region_approx,
  case
    when length(btrim(coalesce(description, ''::text))) < 8
      then 'O cliente ainda não detalhou o serviço.'::text
    else left(description, 180)
  end as description,
  coalesce(reference_price, total, 0::numeric) as reference_price,
  coalesce(total, reference_price, 0::numeric) as total,
  created_at,
  status
from public.orders o
where lower(coalesce(status, ''::text)) = any (array['open'::text, 'novo'::text, 'recebendo propostas'::text, 'em negociação'::text, 'nova solicitação'::text]);

grant select (id, category, service, title, region_approx, description, reference_price, total, created_at, status) on public.orders to anon;

DO $$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.fechou_request_payout(numeric,text,text,text)'::regprocedure);
  v_old := $old$IF lower(coalesce(v_order.metadata->>'temporary_test_price','false'))='true' OR lower(coalesce(v_order.metadata->>'test_mode','false'))='true' OR lower(coalesce(v_order.metadata->>'test_order','false'))='true' THEN$old$;
  v_new := $new$IF lower(coalesce(v_order.metadata->>'temporary_test_price','false'))='true'
      OR lower(coalesce(v_order.metadata->>'temporary_test_payment_only','false'))='true'
      OR lower(coalesce(v_order.metadata->>'test_mode','false'))='true'
      OR lower(coalesce(v_order.metadata->>'test_order','false'))='true' THEN$new$;
  IF position(v_old in v_def)>0 THEN
    v_def := replace(v_def,v_old,v_new);
    EXECUTE v_def;
  ELSIF position(v_new in v_def)=0 THEN
    RAISE EXCEPTION 'Could not locate the test-order guard in fechou_request_payout.';
  END IF;

  v_def := pg_get_functiondef('public.fechou_reserve_asaas_payout_attempt(uuid,uuid,uuid,uuid,numeric,text,text,text,text,text,text)'::regprocedure);
  v_old := $old$AND lower(coalesce(o.metadata->>'temporary_test_price','false'))='true'$old$;
  v_new := $new$AND (
        lower(coalesce(o.metadata->>'temporary_test_price','false'))='true'
        OR lower(coalesce(o.metadata->>'temporary_test_payment_only','false'))='true'
        OR lower(coalesce(o.metadata->>'test_mode','false'))='true'
        OR lower(coalesce(o.metadata->>'test_order','false'))='true'
      )$new$;
  IF position(v_old in v_def)>0 THEN
    v_def := replace(v_def,v_old,v_new);
    EXECUTE v_def;
  ELSIF position(v_new in v_def)=0 THEN
    RAISE EXCEPTION 'Could not locate the test-order guard in fechou_reserve_asaas_payout_attempt.';
  END IF;
END $$;