# FECHOU — Auditoria de fluxo e estabilidade · 18/11/2026

## Limites de evidência

Esta revisão examina o HTML do ramo main (R21.1) e consultas de leitura do Supabase. A versão publicada no Cloudflare pode estar mais recente. O TinyFish não iniciou testes de navegador porque a carteira do serviço estava zerada; o ambiente local de teste não conseguiu resolver a URL do Cloudflare. Portanto, **nenhuma interação real entre cliente/profissional, pagamento novo, cancelamento, estorno ou repasse foi executada nesta rodada**.

## Correções na branch de QA

- O chat diferencia o ID do pedido mesmo quando o overlay DOM é reutilizado. Ao trocar de pedido, limpa a ação interna anterior e evita preservar o contrato de outra conversa.
- O controlador V335 deixou de suprimir erros da validação obrigatória de fotos. O validador original e as verificações do servidor mantêm a decisão.
- Quatro scripts antigos de melhoria visual deixaram de varrer o DOM a cada 1–1,5 segundo; os MutationObservers existentes e eventos de visibilidade, foco e resize continuam disparando atualizações.
- Removida a menção de nota fiscal de um placeholder de negociação, conforme o adiamento da interface de NFS-e.
- Sintaxe: 132 scripts inline compilados após as alterações. Testes em browser real e prints antes/depois **pendentes**.

## Matriz de caminhos de teste (pedidos do cliente/profissional autorizados)

| Pedido (prefixo) | Situação observada | Caso de QA a testar | Resultado |
| --- | --- | --- | --- |
| 409dc9a0 | Aberto e pré-pagamento aprovado | Oportunidade → proposta profissional → negociação | Pendente E2E |
| 08245264 | Aguardando escolha do cliente, pago | Recusar/aceitar proposta e notificações | Pendente E2E |
| 90b6853d | Profissional escolhido; aguardando contrato | Chat → contrato → duas assinaturas → etapas | Pendente E2E |
| 8c568894 | Em execução e pago | Fotos antes/durante/depois → conclusão → aprovação | Pendente E2E |
| f1b7403b | Em execução, pagamento direto | Execução sem checkout/contrato Asaas | Pendente E2E |
| 98d2aa53 | Análise administrativa e pago | Contestação, provas, painel e decisão | Pendente E2E |
| 8b71057f | Cancelado, estorno pendente | Conciliação Asaas e aviso correto ao cliente | Pendente E2E |
| 4b0ca1b1 | Cancelado, boleto exige providência | Estorno de boleto, fluxo bancário e painel | Pendente E2E |
| cc6a5d80 | Cancelado e já estornado | Prevenir estorno duplicado | Pendente E2E |
| 7b1c6c05 | Concluído e repasse marcado pago | Pós-serviço: extrato, avaliação e histórico | Pendente E2E |

## Fluxo obrigatório, sem atalhos

Cliente autentica → publica com localização, IA de preço regional, mídia e preferência de pagamento → profissional encontra oportunidade e envia proposta → cliente aceita, recusa ou contrapropõe → conversa aberta → **opção direto** (sem checkout/Clicksign) OU **opção protegido** (contrato Clicksign + confirmação real de pagamento Asaas) → iniciar serviço → fotos obrigatórias de cada etapa → finalizar → cliente aprova ou contesta → se protegido, carteira e comissão 2% → liberação/repasse Pix → avaliação e histórico.

Em paralelo: equipes e convites; mensagens e anexos; notificações; cancelamento antes/depois do vínculo; reembolso integral/parcial; suporte, conciliação e auditoria do painel. Toda ação financeira requer confirmação do provedor, nunca somente mudança de status via SQL.

## Indicadores do banco verificados por consultas somente leitura

- 107 pedidos, 24 checkouts com status pago, 41 tentativas históricas de criação de checkout com falha, 5 transferências históricas falhadas, 1 caso administrativo aberto e 0 avaliações.
- Contas de QA cliente/profissional encontradas com os papéis corretos.
- Verificações pontuais: zero pedidos aprovados sem payment_id, zero pedidos estornados divergindo do payment_status, zero serviços concluídos com pagamento pendente e zero cancelados com payout marcado como pago.
- Advisors Supabase: 21 funções SECURITY DEFINER executáveis por usuários autenticados requerem revisão de autorização específica antes do lançamento; o aviso por si só não demonstra exploração.

## Validação e publicação

Rodar `node qa/test-chat-flow-stability.cjs` e os testes existentes em `qa/`. **Não publicar automaticamente** um HTML de 2,5 MB sem smoke test visual, screenshots de antes/depois e confirmação de compatibilidade com a versão publicada mais recente. A branch não faz chamadas nem movimenta dinheiro.
