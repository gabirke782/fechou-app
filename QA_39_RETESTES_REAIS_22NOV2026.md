# FECHOU — Auditoria continuada, 22/11/2026 (rodada com produção)

> **Regra de evidência:** `NAVEGAÇÃO REAL` comprova somente visualização e carregamento; `SQL REAL (LEITURA)` comprova integridade dos dados consultados, não transição pelo aplicativo; `ISOLADO` não equivale a teste ponta a ponta; `PENDENTE` não está aprovado. Não declarar os 39 pendentes como resolvidos.

## Fontes e ambientes
- Produção: `https://startup5.pages.dev/`, cliente e profissional autenticados através de dois navegadores automatizados.
- Registro da sessão cliente: `https://agent.tinyfish.ai/runs/74412fd4-b3e8-4e69-a368-ee1c15916c68`.
- Registro da sessão profissional: `https://agent.tinyfish.ai/runs/a34e0c33-8e3f-4a97-8916-7c5fb57db24b`.
- Supabase `ziubcqxmxialhmwevtiy`, status `ACTIVE_HEALTHY`; consultas de leitura, sem pagamentos, assinaturas, saques, estornos ou registros de teste novos nesta rodada.
- GitHub `gabirke782/fechou-app`, branch `fechou-reteste-22nov2026` (não `main`).
- Checklist-base: `FECHOU_RESULTADO_RETESTES_22NOV2026.md` na Library (ID `libfile_af9aa44535ec8191a8aca4fdbb922866`).

## Testes realmente executados nesta rodada
| Operação | Evidência observada | Limite |
|---|---|---|
| Login Cliente | Entrou, Início, Solicitar, Pedidos, Perfil e Menu abriram; cerca de 40+ solicitações, notificações e ações de chat visíveis | Não percorreu contratação nova nem uploads |
| Login Profissional | Entrou, serviços disponíveis (pintura R$ 1.750), mais de 41 propostas, chat com 28 conversas, ferramentas de contrato e fotos, carteira e notificações | Não publicou proposta, não executou fotos, não disparou assinatura nem saque |
| Carteira profissional | Painéis de repasses, histórico e Pix mascarado carregaram; valores exibidos | Nenhum repasse real iniciado; valores não reconciliados com provedor externo |
| Contratos | UI exibiu painel contratual; DB contém 16 assinaturas completas em `fechou_electronic_signatures`, cada uma com PDF vinculado; 7 estão em execução | Não se testou Clicksign assinando com duas contas nem download/impresso |
| Referências órfãs | SQL achou zero propostas aceitas inexistentes, contratos órfãos, mensagens órfãs e propostas órfãs | Não comprova atualização em tempo real |
| Repasses | SQL: zero pagamentos a profissional para serviços não concluídos; zero repasses de pagamentos diretos, em disputa ou sem aprovação; zero desvios de comissão 2% nos repasses pagos | Sem teste da transição através da carteira |
| Provas de serviço | Trigger BEFORE INSERT limita 5 por etapa, bloqueia envio fora de `in_progress` e upload por não-profissional em execução; trigger BEFORE UPDATE exige Antes, Durante e Depois | Não houve upload ao vivo; dados históricos anteriores às regras podem violar requisitos |
| Mídia Storage | Storage continha 80 objetos `eworkers-chat` e 16 objetos de contratos assinados | Não prova que envio novo pela UI funciona |

## Falha de preço regional — diagnosticada e corrigida em branch
- SQL real: os 132 pedidos existentes apresentam valores zero/ausentes nos campos `metadata.regionalPriceLow`, `regionalPriceAverage`, `regionalPriceHigh`, inclusive 9 pedidos novos desde 20/11. Os registros antigos podem anteceder as regras atuais. Exemplo: pedido de pintura `#221a158d` de 22/11 mostra R$1.750 de referência e a faixa toda zerada.
- Causa possível diretamente no código: duas verificações condicionavam o bloqueio à tela atual `state.page==='request'`, apesar de `createBudget` poder ser acionado fora dela; fluxo protegido `createDraft` possuía fallback para zeros sem validação antes do endpoint.
- Correção no commit `95e719ffb51d310126859404135672c50bf1f1d3`: bloquear publicação direta para Cliente sem faixa válida independentemente da tela; bloquear pelo wrapper; e rejeitar o rascunho protegido sem `low>0`, `low<=average<=high`.
- O commit mudou somente `index.html` e passou **144 de 144 compilações sintáticas de scripts inline**. Isso é teste **estático**, não homologação do novo fluxo com Supabase. Não aplicou correção retroativa aos preços antigos, pois seria necessário preço real da IA para cada serviço.
- **PENDENTE CRÍTICO:** testar após publicação o cálculo e a criação de pedidos direto/protegido, inclusive seleção real de áudio/vídeo/fotos, persistência e visibilidade profissional. O HTML corrigido ainda não foi validado na produção.

## Achados históricos em fotografias
- Das 83 fotos de fases `before/during/after`: 3 foram atribuídas a um uploader diferente do profissional selecionado, 4 têm `created_at` anterior ao `service_started_at`, e 6 aparecem cronologicamente após a conclusão (resumos históricos, datas antigas). Outros 11 registros são da fase `contest`, onde uploader cliente é permitido e não devem ser chamados indevidos.
- Entre 14 pedidos concluídos, 3 protegidos de **6, 7 e 8 de novembro** não tinham pelo menos uma foto registrada em cada fase no momento da consulta. A regra de trigger atual rejeita a transição para concluído sem três fases, mas não prova como tais dados antigos chegaram lá. Não modificados.

## Lista dos 50 itens (estado herdado do relatório + evidência desta rodada)
| Item(ns) | Estado verificável até agora | Requisito ainda pendente |
|---|---|---|
| 04,15,16,18,45 | CONFIRMADOS PELO RESPONSÁVEL anteriormente | Fora dos pendentes |
| 01,02 | Correção SIMULADA; SQL real mostra faixa regional zerada | Teste de nova análise/publicação/proposta com os 3 valores no app real; commit de bloqueio recém-feito |
| 03,N01 | Observado real em rodada anterior | Manter regressão quando HTML novo for publicado |
| 05,06,07,08,N02,N03,N04 | ISOLADO/PARCIAL: múltiplos formatos/indicador | Upload e persistência reais com foto grande, vídeo, áudio e erro injetado |
| 09 | Observado real: deduplicação em clique duplo | Regressão com nova versão |
| 10,11,12,13 | Real parcial/ISOLADO; R$1.600 persistiu; contratação direta simulada | Repetir proposta e aceite usando dois perfis reais |
| 14 | Navegação real de pedidos/orçamentos | Garantir ordem cronológica após update/reload |
| 17 | Botão Contrato direto bloqueado no cenário real anterior | Regressão pela nova versão |
| 19,20,21,22,N06,N07,N09 | Assinaturas existentes no SQL; tela contratual navega | Clicksign real, estado nas duas contas, lembrete no sino, PDF e liberação sem reload |
| 23,24 | Chat navega; mensagens antigas visíveis; simulação prévia | Enviar/receber em ambas contas ao vivo; abrir/baixar/imprimir PDF assinado |
| 25,26,27,28,29,30,31,32,33 | Regras de banco presentes, documento chat validado antes, navegação real de fotos | Fotos reais 1/etapa, limite 5, notificações, indicador, trava de finalização, galeria e persistência |
| 34,35,36,37,38 | Navegação e estados reais anteriores, fluxo parcial | Iniciar/finalizar/contestar/aceitar com duas sessões simultâneas |
| 39,40,41,42,43 | SQL real comprova bloqueios de repasse e prazo anterior, atualização de interface simulada | Atualização em tempo real da carteira em toda transição sem movimentar dinheiro real |
| 44,46 | Navegação real de notificações e carteira; mensagens anteriores | Pop-ups para todos eventos e chat do pedido originalmente problemático |
|  N05 | Recusa real previamente confirmada, aceitação simulada | Aceitar proposta e receber notificação no profissional ao vivo |
|  N08 | Faixa/campo proposta somente em simulação | Novo pedido com faixa real e formulário profissional |

## Conclusão operacional
**Não há evidência de 39/39 retestes end-to-end concluídos.** O login e navegação com os dois perfis passaram; verificações reais de banco e uma correção de código foram executadas. O commit não foi mesclado à `main` nem implantado no Cloudflare. Faltam operações integradas com mídias, contratos Clicksign, mensagens bidirecionais, ciclo do serviço e mudanças de carteira. Nenhuma cobrança, saque, assinatura ou exclusão reais foram executados.


## Rodada adicional — 22/11 23h (horário de Brasília)

**Correções aplicadas e evidência separada de homologação:**

- **Supabase PRODUÇÃO — corrigido:** a função `public.fechou_update_request_pricing` descartava a faixa regional, pois sua whitelist só permitia outros campos da composição. Atualizada com `regionalPriceLow`, `regionalPriceAverage` e `regionalPriceHigh`, gravando a faixa somente quando os três números são positivos e ordenados. Consulta pós-alteração confirma que os campos passaram a constar da definição. Teste SQL do predicado: faixa 900/1100/1600 aceita; 900/1800/1600 rejeitada. Nenhum pedido foi alterado nesta etapa, e os 132 pedidos históricos não foram preenchidos com preços inventados.
- **GitHub branch — commit `54093eaad770e31a2eed72fc82c3c97ced7f5263`:** validação obrigatória de faixa no ponto final da criação direta do pedido; identificador idempotente por tentativa de publicação; fallback de schema preserva a faixa e a identidade em `metadata`; metatag de descrição. Também mantém as correções da rodada anterior para publicação direta e checkout protegido.
- **SQL reproduzível:** `db/patches/fechou_pricing_range_20261122.sql` registra a função aplicada no banco; terminador SQL conferido, commit `5354608604ffaff14b381a9f34d5ec54b0fedefb`.
- **Robots:** `robots.txt` válido na branch, commit `33e78d64972fd813e5322e753d2c826615d58c70`.
- **Sintaxe:** após as alterações do frontend, 144 scripts inline compilados com `new Function`: **144 sucesso, 0 erros**. Isto **não comprova** chamadas reais, temporização, uploads, comportamento visual, login ou sincronização.
- **Site oficial, auditoria externa de desempenho móvel (Supermetrics):** desempenho 70/100, acessibilidade 94/100, boas práticas 100/100 e SEO 82/100; LCP 5,2 s; FCP 4,1 s. Achados: JavaScript/CSS não utilizados, recursos bloqueantes, ausência da descrição e `robots.txt` inválido no site ATUAL. Os dois últimos têm correções preparadas na branch, não implantadas.
- **Supabase logs últimas 24h:** 132 respostas HTTP 403 em `/functions/v1/eworkers-api`, 5 respostas 503 em `clicksign-webhook`; múltiplas respostas 400 de links temporários Storage. Não há causa específica confirmada para cada código; não alterar autenticação/webhook às cegas.
- **Integridade dos arquivos do pedido:** 91 fotos registradas em `orders.photos`, 32 com caminho de Storage e nenhuma dessas 32 com caminho ausente no bucket; 22 registros antigos contêm URLs `blob:` locais, que não são persistentes após recarregar o navegador. É necessário testar a recuperação do arquivo de origem e o fluxo de upload; não foram removidos os registros.
- **Chat do pedido `#ffd6d7cb`:** SQL confirma proposta selecionada, status `accepted`, profissional consistente e vínculo pedido/proposta íntegro. A falha de abertura do chat reportada anteriormente não foi reproduzida nesta rodada; ainda requer teste em navegador autenticado.
- **Bloqueio do navegador nesta rodada:** o provedor de automação TinyFish recusou iniciar o teste porque a carteira está em **US$ -0,16**. Não houve nova execução, login, envio de documentos ou assinatura em navegador nesta etapa. Os testes reais das duas contas citados antes pertencem à rodada anterior.
- **Lovable:** a única aplicação localizada no workspace conectado é **EXY Central de Agentes**; ela é projeto separado, não foi alterada nem clonada para FECHOU.
- **Release:** mudanças **não mescladas em main** e **não implantadas no Cloudflare** para não substituir sem homologação o aplicativo usado por clientes.

**Estado:** alguns bugs foram corrigidos diretamente no Supabase e na branch, com verificações SQL e sintaxe; **39/39 testes de ponta a ponta continuam não homologados**. Dependências reais: navegador autenticado, revisão das respostas 403/503, mídia, contratos, notificações, serviço e carteira. 


## Continuação 23/11/2026 — sem TinyFish (pedido expresso do responsável)

**Procedimentos:** GitHub conectado, Supabase SQL/logs/Edge Functions e verificação JavaScript no mecanismo V8; navegador TinyFish não utilizado nesta continuação. Nenhum teste visual autenticado nesta etapa nem pagamento, saque ou estorno real.

### Correções verificáveis

1. **Frontend: integridade de preços após publicação.** Commit `efd6ede69ad2f4982cedb90e73ce99702d220a0f` removeu o wrapper legado que recalculava `o.total` e `o.referencePrice` somente no estado de memória **após** o servidor confirmar a criação, causando divergência entre valor exibido e valor persistido.
2. **Frontend: normalização e recuperação da faixa regional.** Commit `bc1bbb9057a4d7cc4b19078602016045f3f5a4cf` faz `ewNormalizeOrder` priorizar `orders.total` como valor autoritativo e hidrata explicitamente `regionalPriceLow`, `regionalPriceAverage`, `regionalPriceHigh` do JSON `metadata`. Teste unitário executado com linha artificial: total servidor 1250, labor_reference_price 1100, faixa [900,1100,1700] => normaliza para total 1250 e a mesma faixa; linha histórica sem faixa => 0/0/0 (sem inventar dados). Verificação: 144 scripts executáveis parseados sem erros.
3. **Webhook Clicksign no Supabase PRODUÇÃO.** Versão **59 ACTIVE**, código versionado no GitHub no commit `a87a5f52be0c7c10598833e3b2214642c186750c`, arquivo `supabase/functions/clicksign-webhook/index.ts`. Evita que contratações `temporary_test_price` criem crédito de repasse profissional na finalização de assinatura; preserva contrato e comprovante, marca repasse de teste como bloqueado e altera as duas verificações de notificação de `.maybeSingle()` para resposta em lista com `limit(1)`. Código sintaticamente compilado antes do deploy; pós-deploy, API Supabase confirmou versão 59 ativa. **Ainda não houve novo teste Clicksign E2E após o deploy.**
4. **Reconciliação de registros de webhook já concluídos:** havia 78 eventos sem `processed_at`. Após JOIN rigoroso de `fechou_electronic_signatures`, `orders`, `storage.objects`, com assinatura dos dois participantes, contrato `contract_accepted=true`, PDF assinado presente no bucket correto e flag de teste, foram marcados como concluídos **18 eventos realmente finalizados**, sem qualquer execução financeira. A nova contagem foi confirmada em **60 pendentes**. Permanecem, entre outros, 30 com erro de PDF indisponível, 15 com falha de consulta de notificação, 11 com erro de vínculo do envelope, além de outros erros; esses **não** foram considerados concluídos.
5. **Log de APIs últimas 24h:** 132 respostas 403 no `eworkers-api` (a causa concreta de cada requisição não foi validada); o código do handler inclui controle CORS por origens permitidas. Não foram alteradas as permissões nem desabilitada a autenticação para disfarçar os erros. Linter Supabase health: nenhum aviso; linter de security recomenda inspeção de 24 funções SECURITY DEFINER expostas e duas tabelas com RLS sem policies; nenhuma alteração agressiva em grants ou triggers.

### Limites
- O HTML desta branch **não foi mesclado à main nem publicado no Cloudflare**. A produção frontend ainda pode ter divergências. 
- A versão **59 do webhook foi publicada no Supabase**, mas os 60 eventos pendentes precisam de investigação/reprocessamento legítimo. Não os marcar como aprovados sem vinculação, assinatura e PDF reais.
- 39/39 itens não estão homologados end-to-end. Só o que foi confirmado por SQL, código e status real é relatado acima. **Não usar TinyFish nas próximas rodadas.**


### Retificação da reconciliação Clicksign — 23/11 (após a nota anterior)

O JOIN preliminar por `envelope_id` não identificava parte dos eventos porque 60 registros históricos têm `envelope_id` nulo, mas possuem `document_id` válido. O cruzamento correto por `document_id` encontrou **60 eventos distribuídos por 11 pedidos de teste**, todos com:
- `fechou_electronic_signatures.signature_status='signed'`;
- `client_signed_at` e `professional_signed_at` preenchidos;
- `orders.contract_accepted=true`, `orders.payment_status='approved'` e `orders.metadata.temporary_test_price='true'`;
- objeto físico do PDF assinado encontrado em `storage.objects` no bucket `fechou-signed-contracts`.

Os 60 registros foram reconciliados exclusivamente no diário de webhooks (`processed_at=now(), processing_error=null`) com predicado SQL que exige todas essas condições; nenhuma operação Asaas ou repasse foi realizada. Somados aos 18 eventos anteriores, foram regularizados **78 eventos já comprovadamente concluídos**. Consulta de confirmação: `SELECT count(*) FROM fechou_clicksign_webhook_events WHERE processed_at IS NULL` retornou **0**. Este número prova a limpeza da fila histórica consultada, mas **não comprova novo webhook ponta a ponta** nem que não surgirão novos erros.


### Observação financeira de segurança (histórico, não alterado)
A consulta posterior em `fechou_wallet_ledger` encontrou **15 lançamentos payout historicamente associados a pedidos marcados `temporary_test_price`**: 7 `paid` (R$ 41,16), 5 `held` (R$ 29,40), 2 `release_ready` (R$ 11,76), 1 `cancelled` (R$ 5,88). São lançamentos anteriores à correção do webhook v59 e refletem transações e testes anteriores, possivelmente pagamentos reais de valor reduzido. **Nenhum desses lançamentos foi modificado, excluído, revertido ou sacado nesta rodada.** A v59 impede NOVAS tentativas de criar crédito de repasse quando a contratação carrega a flag de pagamento de teste. Uma análise financeira retroativa de valores pagos deve reconciliar com Asaas antes de qualquer correção.
