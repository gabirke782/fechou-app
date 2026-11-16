# FECHOU — continuidade do R17 em 16/11/2026

## Resultado desta etapa

A função administrativa `admin-api` foi atualizada para a versão **33**, ativa no projeto FECHOU, mantendo a verificação de JWT. A fonte ativa foi consultada após a implantação e corresponde exatamente ao código enviado. A alteração foi registrada na branch de validação do GitHub, commit `dcd672cedce7708974f8923e9b881e71d08dc501`.

O HTML continua sendo **FECHOU_R17_index.html**, sem alterações nesta etapa. **R17 ainda não foi publicado no Cloudflare.** Não houve novo pagamento, pedido de reembolso, transferência ou repasse nesta etapa.

## Correção de segurança administrativa

O código anterior permitia que um cadastro administrativo desativado fosse reativado automaticamente por um convite ainda ativo. Além disso, o endereço público de suporte funcionava como exceção para reivindicar um convite sem vínculo prévio com o usuário autenticado.

A versão 33:

- Respeita a desativação de um cadastro existente e encerra a autorização, sem procurar uma alternativa por convite.
- Exige que o convite esteja previamente vinculado ao identificador do usuário autenticado.
- Remove a exceção baseada somente no endereço público de suporte.
- Usa inserção para um cadastro novo, sem sobrescrever um registro criado ou revogado por outra operação concorrente.
- Mantém a exigência de e-mail confirmado e não utiliza metadados editáveis pelo usuário para conceder administração.

A correção ficou restrita à função que autoriza administradores. A conta de suporte existente continua ativa, com as permissões operacionais que já possuía. Nenhuma conta real foi desativada ou teve suas permissões alteradas para testar a correção.

## Evidências de teste

| Verificação | Resultado | Limite da evidência |
| --- | --- | --- |
| Controle de acesso administrativo | 12/12 passaram | Função real extraída; banco simulado; inclui reprodução do defeito anterior |
| Regressão de reembolso | 6/6 passaram | Provedor e banco simulados; não movimenta dinheiro |
| Origens permitidas do painel | 10/10 passaram | Função real; cenários simulados de configuração |
| Fonte implantada da admin-api | Correspondência exata; v33 ativa; JWT habilitado | Confirma implantação, não equivale a teste financeiro completo |
| Inicialização do R17 no navegador | Interface inicial e navegação ao acesso do cliente funcionaram | Sem login real na prévia local; fluxo completo autenticado permanece pendente |

### Limitação de prévia identificada e resolvida

O servidor padrão de prévia injetava código de atualização automática dentro de textos HTML usados pelos modelos de impressão. Essa transformação produzia erros de sintaxe e trechos de código visíveis. A injeção não existe no arquivo R17 salvo.

Foi configurado um comando de desenvolvimento que serve os bytes do HTML sem essa transformação, dentro do mesmo gerenciador de prévia. Depois da recarga, o aplicativo apresentou a tela inicial normal e abriu o formulário do cliente. Não foram registrados novos erros de sintaxe nessa recarga. Os erros anteriores permanecem no histórico do console e não devem ser confundidos com erros da nova recarga.

Não foi necessário modificar o HTML para compensar o comportamento do servidor de prévia. O SHA-256 preservado é `977abf6f815a4a4ecabedf1056c1fba22535587775e1cdf4e2cdff162ef76e8c`.

## Situação financeira observada

- O pedido de teste **Iluminação, R$ 6**, continua cancelado e com reembolso **pendente**. Já existe solicitação anterior; não foi enviada outra.
- O pedido **Torneira e descarga, R$ 6**, permanece pago e aguardando escolha do cliente, preservado para os testes restantes.
- O webhook do projeto no Asaas aparece **interrompido, com uma fila pausada**. O banco não apresenta eventos novos desde 07/11/2026; também não foram encontrados acessos ao endpoint do webhook nos logs das últimas 24 horas consultadas. Esses indícios apontam para a entrega interrompida, mas não identificam sozinhos o motivo original.
- Um modal do Asaas solicita autorização de uma criação de reembolso Pix e impede a consulta completa das configurações. Não houve preenchimento de código, reenvio de código, cancelamento da autorização, retomada da fila ou reenvio de eventos.
- A associação exata dessa autorização ao pedido precisa ser comprovada antes da confirmação. O mesmo valor não basta para identificar uma operação.
- Uma transferência antiga com possível referência duplicada continua sem conciliação definitiva. Não foi reenviada nem marcada como concluída.
- A renovação da assinatura profissional já estava cancelada anteriormente; o período pago permanece válido. Esta etapa não realizou novo cancelamento.

## Publicação e autenticação

A tentativa autorizada de entrar no Cloudflare pelo Google chegou à confirmação no celular, mas o Cloudflare retornou **“Unable to sign in. Try again or use your email and password.”**. Não há evidência de sessão autenticada nem de publicação do R17. Tentativas automáticas não devem ser repetidas em sequência após essa recusa.

O teste público do endereço startup5.pages.dev abriu a navegação sem erro aparente, mas um identificador interno antigo não comprova qual release está publicada. A versão publicada deve ser verificada depois de uma implantação confirmada.

## Trabalho que permanece pendente

1. Restabelecer o acesso ao Cloudflare e publicar o pacote R17 após a validação de implantação.
2. Identificar e concluir a autorização financeira correta, recuperar a entrega do webhook e conciliar o reembolso existente, sem duplicá-lo.
3. Executar e documentar o fluxo autenticado completo do pedido preservado: proposta, equipe, aceite, contrato/assinatura quando aplicável, mensagens, fotos antes/durante/depois, conclusão e aprovação.
4. Testar pagamento, reembolso e repasse reais nas etapas finais autorizadas, com conciliação entre provedor, banco e painel.
5. Comparar o painel administrativo publicado com a fonte mais recente antes de ampliar as operações disponíveis. Ainda não está comprovado que toda a operação financeira pode ser feita exclusivamente pelo painel.
6. Identificar a cobrança com desconto mencionada pelo usuário. O print recebido nesta conversa mostra o layout de serviços; não identifica essa cobrança.
7. Verificar o nome de apresentação permitido nas cobranças. A identidade fiscal legal não deve ser falsificada ou omitida em campos obrigatórios.
8. Prosseguir com a auditoria de autorização, RLS, funções privilegiadas, upload, contratos, webhooks e regras financeiras. Os alertas encontrados não autorizam revogar funções ou remover políticas em massa sem provar o impacto.

A auditoria ainda não é uma comprovação de segurança ponta a ponta e não permite prometer um aplicativo invulnerável. Os testes simulados e as verificações de fonte estão explicitamente separados dos testes reais ainda pendentes.
