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
