# FECHOU R15 — acessos reais, correções e limites de validação

Data: 16/11/2026 UTC. Esta revisão continua o R14, construído sobre o R13 mais recente enviado. O HTML antigo foi usado somente para comparação. O arquivo completo está incluído; **a homologação integral ainda não foi concluída**.

## Comprovado com as contas de teste

- Login da conta cliente e da conta profissional realizado com sucesso no aplicativo publicado.
- O projeto correto do Supabase está acessível: `ziubcqxmxialhmwevtiy` (Startup serviço). O projeto EXY não foi alterado.
- O site publicado foi comparado por conteúdo com o R14, não apenas pelo rótulo antigo de versão mantido na interface.
- Cliente: painel, perfil, menu e carteira acessados no TinyFish. No segundo navegador, o painel abriu, mas a sequência de avisos antigos dificultou a navegação e um atalho de carteira pediu login. Essa divergência não foi escondida nem considerada resolvida por um teste simulado.
- Profissional: painel, serviços, alternância grade/lista, preparação de proposta sem enviar, planos e perfil acessados. A conta já possui assinatura mensal ativa; não foi ativado outro plano.
- Após a primeira implantação do backend v329 (antes do complemento de bloqueios de reembolso na v330): perfil e carteira profissional abriram e a consulta de status da assinatura funcionou, sem erro de função exclusiva de profissionais, 401 ou 500 nessas ações.
- Os testes de navegador relatam navegação real; não comprovam todos os tamanhos de tela, todos os fluxos de pagamento ou acessibilidade completa.

## Correções já aplicadas no Supabase

1. **Propostas e aceite:** o banco muda um pedido para `Aguardando escolha do cliente` após receber proposta. As RPCs de proposta e aceite rejeitavam esse mesmo estado como se o pedido estivesse encerrado. As duas RPCs agora aceitam esse estado, mantendo autenticação, propriedade do pedido, preço pago, modalidade protegida e bloqueios de contratação existentes. Nenhum status histórico precisou ser reescrito.
2. **Papel no servidor:** normalização exata de cliente/client e profissional/professional usando exclusivamente `profiles.role`; dados editáveis do usuário não concedem função.
3. **Solicitação de repasse:** antes de registrar uma solicitação, o backend reconfere profissional selecionado, aceite, pagamento aprovado, modalidade protegida, conclusão e ausência de reembolso ou contestação aberta. Uma entrada antiga `release_ready` sozinha não basta. A atualização de solicitação existente também exige o mesmo status lido.

A função Edge `eworkers-api` foi atualizada de v328 para **v330**, preservando o código que estava efetivamente em produção. O backend antigo do GitHub/R14 não foi usado como base para essa implantação.

A migração `accept_pending_customer_choice_without_removing_guards` foi aplicada. A função interna de finalização já não era executável diretamente por anon/authenticated; isso foi conferido e conservado.

## Correções no HTML R15, ainda para publicar no Cloudflare

- Pedidos do próprio profissional deixam de aparecer nas oportunidades do painel e da lista. O início da proposta também verifica o proprietário.
- Um pedido com proposta de outro profissional pode continuar disponível enquanto o cliente escolhe; pedidos para os quais o profissional atual já enviou proposta continuam fora das suas oportunidades.
- O estado `Aguardando escolha do cliente` fica compatível com os controles de proposta da interface.
- Avisos são separados pela conta autenticada. Carga assíncrona de histórico e contratos antigos não é tratada como novidade.
- Uma notificação carregada do servidor não cria outra notificação. Avisos sintéticos já apresentados não entram novamente no ciclo de pop-ups.
- Eventos realmente novos podem aparecer imediatamente após o login, sem uma janela cega de sete segundos.
- O menu de ambos os perfis oferece **Sair da conta**, usando a ação de encerramento já existente. O controle de conta não foi reconstruído.
- Cores, template, carteira e símbolos de Pix, boleto e cartão do R14 foram preservados. A análise de preço regional não foi alterada.

## Verificações executadas

| Verificação | Resultado | Limite |
|---|---|---|
| Scripts completos e DOM do R15 | 24/24 testes passaram | Dados simulados; não é validação visual |
| Elegibilidade e identificação do backend real atualizado | 17/17 passaram | Testes isolados, sem transferência |
| Carga assíncrona e repetição dos eventos | 7/7 passaram | Script real em DOM simulado |
| Aceite pelo cliente no banco real | Passou | Transação revertida ao final; não deixou contratação |
| Proposta do profissional para outro cliente | Passou | Transação revertida ao final |
| Proposta para o próprio pedido | Bloqueada por 42501 | Proteção do banco preservada |
| Integridade após testes transacionais | Conferida | Pedido permaneceu sem profissional/proposta selecionados |
| CORS do backend implantado | OPTIONS 204, origem correta | Teste HTTP real |
| Ação sem sessão | POST 401 | Autenticação no corpo da função mantida |
| Fonte da função implantada | Conteúdo idêntico ao entregue | v330 ativa |
| Navegação profissional após implantação | Passou | Consulta de carteira/perfil/status; não inclui compras |

Total local: **48 testes passaram**. Consultas HTTP e testes transacionais são evidências adicionais. Não foram executados pagamentos, reembolsos, transferências Pix, ativação de assinatura ou assinatura eletrônica para esta validação.

O verificador de segurança ainda aponta 21 funções SECURITY DEFINER acessíveis a usuários autenticados, uma tabela administrativa com RLS sem política e proteção paga de senhas vazadas desativada. Esses avisos não foram automaticamente tratados como vulnerabilidade nem eliminados retirando acesso de RPCs legítimas. A proteção paga não foi ativada.

## Pendências para concluir a homologação

1. **Publicar este R15 em `startup5.pages.dev` e repetir o teste visual.** O servidor já foi atualizado, mas o Cloudflare continua servindo o R14. Não há prints desta interface R15 publicada.
2. **Conciliação Asaas:** confirmar o boleto informado como liquidado diretamente com o provedor e conferir webhook/reconciliação. Nenhum boleto foi marcado manualmente como pago.
3. **Saque histórico HTTP 409:** a carteira profissional mostra uma tentativa antiga com mensagem de duplicidade do provedor e estado de análise. Exige conferir o identificador da transferência e o estado no Asaas antes de qualquer nova tentativa. Esta revisão não enviou novo Pix nem alterou esse histórico financeiro para esconder o erro.
4. **Homologação financeira:** validar pagamentos Pix/boleto/cartão, eventos duplicados, cancelamento/reembolso, execução com fotos, conclusão sem aprovação, aprovação do cliente e reserva concorrente de repasse em ambiente de teste apropriado. Os testes isolados de bloqueio não substituem esses fluxos.
5. **Contas e telas:** repetir sair/entrar, notificação antiga/nova, carteira cliente, contador de notificações e troca de conta depois da publicação. A inconsistência observada no segundo navegador precisa ser reavaliada. No perfil profissional, o resumo básico indicou zero registros e o expandido oito concluídos; falta conciliar a fonte desses indicadores.
6. **Capturas de todas as alterações visuais do R14/R15 e larguras móveis:** ainda faltam. O print incluído mostra o defeito no site publicado, não a correção do R15.
7. **Item 6.1:** o layout de detalhes/registro completo permanece preservado. O documento do usuário exige protótipo e aprovação antes de uma reformulação; isso não foi apresentado nem implementado nesta revisão.

## Evidência visual

`evidencias/cliente-publicado-avisos.jpg` é uma captura real do navegador no site publicado R14, mostrando o aviso que reaparece ao fechar avisos anteriores. Não é imagem gerada nem prova da correção R15. Os relatórios do TinyFish não fornecem arquivos de screenshot exportáveis; não foram inventadas capturas dessas telas.

## Arquivos e publicação

- `index.html`: HTML completo R15. É o arquivo a publicar no Cloudflare.
- `eworkers-api.ts`: fonte completa da função já implantada como v330; não precisa ser implantada novamente para usar o HTML.
- `r15_accept_pending_customer_choice.sql`: migração já aplicada, conservada para rastreabilidade.
- `validacao/`: testes e resultados. Leia o README para execução local.
- `alteracoes_R14_R15.diff`: comparação exata desta revisão.
- GitHub: [branch de revisão](https://github.com/gabirke782/fechou-app/tree/fechou-r15-validacao-2026-11-16). A branch principal não foi alterada.

SHA-256 do HTML: `bb0c24fe65adb3ef918376097157f1017b9b428a20436d29248b2e6a38491d6a`.

As senhas não foram incluídas neste pacote. Nenhum pedido, proposta, contrato, pagamento ou histórico real foi excluído.
