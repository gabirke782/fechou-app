# FECHOU — auditoria complementar de retomada — 16/11/2026

## Escopo e resultado

Retomada a partir do commit 3bc7b43386f9acc113603213e8dd7f6dabf6027b, posterior ao relatório R17 da Library. Nenhuma correção funcional, nova implantação, cobrança, transferência ou reembolso foi aplicada nesta etapa. O ambiente local retornou `No usable execution environment is available`; testes locais e screenshots finais não puderam ser reexecutados.

## Verificações novas no banco ativo

- Advisor health: sem avisos. Alertas security/performance continuam exigindo análise de impacto; não foram eliminados em massa.
- Todas as tabelas comuns do schema public têm RLS habilitada. Isso não comprova a correção de cada política.
- Nenhuma função SECURITY DEFINER pública permite EXECUTE ao papel anon; nenhuma está sem configuração explícita de search_path.
- A sobrecarga interna fechou_notify_event(uuid,text,text,text,text,jsonb), que insere notificações sem validar participante, não é executável por anon nem authenticated. As sobrecargas públicas autorizadas mantêm validação por pedido/proposta.
- Em transação revertida, SET LOCAL ROLE authenticated e JWT com identidade sintética sem vínculo: perfis=0, contratos=0, mensagens=0, objetos privados=0; fechou_can_access_order para UUID inexistente=false; execução da sobrecarga interna de notificação=false.
- Na mesma condição, 3/3 chamadas indevidas foram recusadas: fechou_save_proposal sem perfil profissional (42501), fechou_update_request_pricing para pedido inexistente (P0002) e fechou_submit_service_review para pedido inexistente (P0002). Não são testes de isolamento entre duas contas reais ou de todos os estados válidos.
- Buckets chat, evidências e contratos permanecem privados; fotos de perfil são públicas. Chat mantém 50 MiB por arquivo, audio/webm e image/heif.
- Cron fechou-auto-refund-unassigned permanece active=false.
- eworkers-api v332, admin-api v33 (verify_jwt=true), fechou-auto-refund v16 e fechou-ops-api v26 continuam ativos.

## Hipótese descartada com evidência

Uma hipótese inicial de falha no regex de centavos de fechou_save_proposal foi descartada. A primeira simulação representou as barras de maneira diferente do código ativo. Uma migração com guarda tentou localizar o padrão suspeito, não o encontrou e abortou, sem alteração. Em seguida, o padrão foi extraído diretamente da definição ativa e executado: reconheceu 123.45 e 123. Não há correção aplicada nesse ponto.

## Publicação

Consulta somente leitura no navegador confirmou sessão Cloudflare autenticada e implantação startup5 com sucesso em 16/11/2026 às 17:49:44.487716 UTC (14:49 Brasília). Identificador apresentado: 79143d78-30cf-4c56-9ed1-c5c3912aec7e.

O navegador chamou esse UUID de commit SHA e indicou publicação Git/main, em conflito com a evidência anterior de upload direto. Um UUID de implantação não comprova commit Git. Portanto origem Git e correspondência dos bytes publicados com R17/R18 permanecem NÃO comprovadas. Não houve publicação ou login nesta consulta.

## Conciliação

O rascunho de boleto 4b0ca1b1-f897-4342-945f-30a592731b05 continua payment_pending, payment_confirmed_at=null e published_order_id=null. A tabela de webhooks mantém 64 eventos, último received_at=2026-11-07T02:13:46.678Z. O status atual no provedor não foi consultado nesta etapa. Nenhum estado foi forçado para pago.

## Impedimentos preservados

ESTADO-R18.md registra recusa da revisão automática para implantação central R18 e tentativa menor de conciliação; não informa o motivo detalhado. Nenhuma recusa foi contornada ou nova tentativa de deploy feita. O HTML candidato depende de orders/media-upload-urls e não deve ser publicado contra v332.

Continuam pendentes: implantação compatível; comprovação dos bytes publicados; conciliação com provedor e recuperação do webhook; fluxo autenticado completo; cartão/Pix/boleto, reembolso e repasse reais; seis capturas das ferramentas do chat e demais áreas alteradas; áudio/vídeo real; Apple Sign In; configuração do provedor; operação administrativa completa; auditoria integral. Esta etapa não declara o pedido completo concluído.
