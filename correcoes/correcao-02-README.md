# FECHOU — Correção nº 2 (isolada)

Data: 19/11/2026. Ramificação exclusiva: `correcao-02-campos-precos-reembolsos-20261119`.

## Escopo concluído na ramificação (não publicado)

1. **Controles selecionáveis:** raio de atendimento, urgência, categoria, tipo de serviço, datas e outros campos `select` passam a ter borda azul visível, fundo escuro definido, seta de seleção e realce luminoso laranja no foco.
2. **Campos de digitação:** inputs de formulário, perfil, caixas multilinha e campo de mensagem do chat compartilham a indicação clara de área editável; foco com borda e brilho laranja, preservando o esquema escuro.
3. **Análise de preço:** faixas de mão de obra baixa/média/alta e a seção de materiais começam expandidas; não pode aparecer “solicitação analisada” sem uma faixa de mão de obra válida e, quando materiais forem solicitados, sem uma estimativa numérica confirmada. Se o motor gerou preços válidos mas a interface perdeu os resultados, o resumo é reconstruído a partir dos valores calculados, sem criar preços fictícios.
4. **Carteira / reembolsos:** substituído o bloco visual estreito por um item horizontal legível, sem símbolos ou grade de três colunas; descrições, data, motivo, valor e status respeitam largura total do aparelho. O status diferencia estorno confirmado no Asaas do prazo para crédito aparecer na fatura do cartão. Apresentação, gráfico e totais da carteira deduplicam lançamentos integrais repetidos referentes ao mesmo pedido, pagamento e valor.
5. **Banco — preparação, não executada:** `correcoes/correcao-02-backend-reembolso.sql` contém uma revisão isolada da função `fechou_apply_refund_effects(text)` para não inserir um segundo reembolso quando já existe uma linha confirmada do webhook. Não altera nem exclui lançamentos anteriores.

## Diagnóstico financeiro verificado

Pedido `e1c92404-fcd7-4554-ab83-e3df3c1bad2c`: cobrança de **R$ 6,00**, cartão de crédito. Evento Asaas `PAYMENT_REFUNDED` processado em 19/11/2026 às 20:44 BRT; `payment.status=REFUNDED`, `refunds[0].status=DONE`. A exibição do crédito na fatura do banco pode não ocorrer imediatamente.

A tabela `fechou_wallet_ledger` tinha dois lançamentos `refund` de R$ 6,00 para o mesmo pedido, com `idempotency_key` distintas: `refund:<order>` e `fechou-ledger:v1:refund:<order>:<client>`. A função trigger adicionou outro registro depois do webhook.

## Validação antes de unificar/publicar

- [ ] Rodar o HTML de *Correção 2* em ambiente de teste com conta cliente e profissional; selecionar raio, urgência e campos equivalentes sem alteração de valores salvos.
- [ ] Conferir todos os campos de editar perfil e digitar mensagens no chat com teclado Android aberto; brilho laranja somente no foco.
- [ ] Analisar serviço com materiais marcados e sem materiais; exigir o trio mão de obra baixa/média/alta; em falha de materiais não permitir publicação nem mostrar sucesso.
- [ ] Conferir carteira em largura móvel de 320 a 430 px, especialmente motivo longo e valor monetário, sem linhas verticais ou estouro horizontal.
- [ ] Validar estorno Pix/cartão/boleto, parcial e integral, incluindo transições `PENDING`, `IN_PROGRESS`, `DONE`, `CANCELLED` e `FAILED`, sem extrapolar a confirmação do provedor.
- [ ] Revisar e testar SQL em homologação (duas notificações idênticas, ordem inversa dos webhooks, reembolso parcial). Só depois aplicar no Supabase principal.
- [ ] Conciliar lançamentos antigos duplicados com registros do provedor antes de qualquer remoção; não apagar o histórico indiscriminadamente.
- [ ] Após unificação com outras correções, regressão de solicitação, propostas, chat, contratos, pagamento, carteira e autenticação.

**Observação:** O HTML corrigido está na ramificação citada. O `main` e o Cloudflare não foram alterados por esta correção. A migração SQL ainda não está aplicada em produção, portanto o backend permanece com risco de novos lançamentos duplicados até sua validação e publicação.