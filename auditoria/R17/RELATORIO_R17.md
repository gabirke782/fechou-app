# FECHOU R17 — ponto de continuidade e evidências

16/11/2026. **O trabalho completo solicitado ainda não está concluído. O HTML R17 não foi publicado no Cloudflare.** Este pacote conserva o aplicativo completo e permite continuar sem regressar ao R13 ou perder os textos do arquivo recebido.

## Base e alterações desta etapa

Base recebida: `FECHOU_corrigido_R15.html`, 2.492.911 bytes, SHA-256 `dd1f08ca1215690943f59b14930eacd38a34c7e0d6b8cee28ffb3187eb2de01b`.

A comparação usou o R13 comum e o R16 corrigido. Foram resolvidos 19 conflitos: textos recebidos foram incorporados, mantendo as correções funcionais do R16. Não foi feita uma substituição pelo R15 antigo. A política usa a redação mais simples recebida e preserva a identificação dos serviços efetivamente utilizados, como Supabase, Asaas e Cloudflare.

As telas de Detalhes do serviço e Registro completo foram implementadas conforme a referência aprovada: cabeçalho, indicador arredondado sem corte, categoria e pagamento, região aproximada, três indicadores, descrição, propostas, contrapropostas e ações. O registro reúne cinco seções recolhíveis. Datas e notas usam apresentação em português. A política explicita também os anexos de foto, vídeo e áudio utilizados na análise. As ações mantêm os controladores existentes e não geram pagamento por si mesmas. Não se oferece aceitar proposta ou solicitar cancelamento para serviço encerrado. Fotos com protocolo de execução de código são descartadas nesse renderizador. Um pedido inexistente não é substituído silenciosamente pelo primeiro pedido da lista.

O rodapé existente foi preservado. Foram corrigidos conflitos com estilos antigos que aumentavam os botões e duplicavam as setas. Foi acrescentada reserva inferior nas duas telas para que as ações possam ser alcançadas acima do rodapé fixo.

As correções anteriores de análise regional, mensagem sem JSON técnico, descrição prioritária, materiais, política no checkout, assinatura, equipe, chat e sincronização permanecem incorporadas. Seu detalhamento e as operações financeiras anteriores constam do relatório R16 incluído no pacote técnico.

## Servidor realmente alterado

`admin-api` v32 está **ACTIVE**, com `verify_jwt=true`. A fonte foi lida após a publicação e conferida com a fonte enviada.

1. **Reembolso com resultado incerto:** no v30, uma falha de transporte após iniciar o POST ao Asaas podia devolver o caso para nova tentativa. Agora uma resposta perdida ou erro inconclusivo mantém a reserva `initiating`, registra necessidade de conciliação e bloqueia outro POST. Uma recusa explícita válida continua permitindo análise. A confirmação de aceite pelo provedor não é inventada quando a resposta não chegou. Nenhum novo estorno foi enviado para testar essa correção.
2. **Origem do painel:** o código deixou de aceitar genericamente qualquer site `pages.dev` ou `workers.dev`. Os endereços do painel e do aplicativo são permitidos explicitamente; origens adicionais declaradas no ambiente continuam respeitadas. Acesso local automático fica restrito ao ambiente sandbox. Validação do usuário, cadastro administrativo e permissões por ação continuam obrigatórios.

As implantações anteriores `eworkers-api` v332 e `fechou-ops-api` v26 permanecem ativas. O webhook não foi substituído, sua autenticação não foi enfraquecida e nenhuma proteção financeira ou SMS foi desligada.

## Testes de segurança realizados nesta etapa

As verificações de acesso abaixo usaram o papel `authenticated` e os identificadores das duas contas de teste. Não foram apresentadas consultas executadas como proprietário do banco como se comprovassem o bloqueio de usuários comuns. Nenhuma conta alheia foi explorada.

| Tentativa | Evidência obtida |
|---|---|
| Cliente ler perfil do profissional | Zero registros visíveis |
| Cliente ler carteira do profissional | Zero registros visíveis |
| Profissional ler perfil do cliente | Zero registros visíveis |
| Profissional ler carteira do cliente | Zero registros visíveis |
| Profissional ainda não selecionado obter endereço exato | RPC retornou nulo |
| Cliente proprietário consultar seu endereço | RPC permitiu |
| Cliente alterar diretamente seu papel para profissional | Trigger recusou; papel continuou `client` |
| Anônimo consultar tabela de perfis | Permissão negada |
| Ler diretamente a coluna protegida de endereço do pedido | Permissão negada |
| Alterar privilégios administrativos pelo cliente | Políticas inspecionadas negam o acesso às listas administrativas |

Foram inspecionadas as definições de 21 rotinas `SECURITY DEFINER` acessíveis a contas autenticadas, além das políticas e gatilhos pertinentes. Elas usam `search_path` explícito. Isso não substitui testar cada combinação de argumentos e estado. As rotinas de repasse consultadas verificam titularidade, saldo liberado, pagamento, serviço e comissão; as tabelas financeiras não oferecem escrita livre ao cliente.

**A auditoria é parcial.** Não é possível afirmar ausência de vulnerabilidades futuras. Permanecem pendentes ensaios completos de isolamento de todas as rotinas, mídia e armazenamento, mensagens/anexos, limites de requisição, dependências, assinatura, recuperação de conta e todos os estados financeiros. Trocar a linguagem do HTML não resolve esses controles.

## Validação e capturas

Os resultados detalhados ficam na pasta `validacao/`: 46/46 verificações de DOM e lógica, 6/6 de reembolso e 10/10 de origens administrativas, totalizando 62/62. As oscilações do teste foram corrigidas na simulação da sessão autenticada e na espera pelo DOM, sem retirar suas verificações. Os testes locais usam banco e provedor simulados, sem movimentar dinheiro. Os testes administrativos cobrem resposta perdida, recusa, erro de servidor, boleto sem link, sucesso pendente e bloqueio de repetição; os testes de origem cobrem os dois domínios válidos e origens indevidas.

As imagens são capturas do navegador de revisão usando o DOM e o CSS do próprio aplicativo com dados de teste, em uma janela interna de celular. Para conferir layout também foi utilizada uma renderização estática desse DOM. Elas **não comprovam publicação, login real, pagamento ou execução dos botões financeiros**. Foram conferidos quadros de 320, 360, 390 e 430 px sem rolagem horizontal na tela de detalhes. O ensaio interativo da prévia apresentou problemas de carregamento; a homologação visual e funcional de todas as telas no endereço publicado continua pendente. Não publicar os arquivos de prévia nem seus controles de teste.

## Financeiro: o que está e o que não está comprovado

| Item | Estado comprovado / pendência |
|---|---|
| Pedido de Iluminação #04CA72A6, R$ 6 | Cancelado; `refund_status=pending` na consulta desta etapa. Uma solicitação já foi enviada anteriormente. Não houve segunda solicitação. Devolução concluída ainda não comprovada. |
| Pedido Torneira e descarga #CC6A5D80, R$ 6 | Pagamento aprovado e aguardando escolha do cliente. Preservado para o fluxo completo. |
| Saque histórico de R$ 5,88 | Associação exata entre tentativa, transferência e contratação ainda precisa de conciliação. Nenhum Pix foi reenviado. |
| Assinatura profissional | Renovação já cancelada no servidor; acesso pago preservado até 11/12/2026 às 00h UTC, equivalente a 10/12 às 21h em Brasília. Não foi atribuído novo cancelamento aos cliques antigos. |
| Webhook Asaas | Fila “Projeto FECHOU startup” interrompida. Consulta de logs não identificou a causa; último evento no banco consultado era de 07/11. Não foram enviados eventos falsos nem reativada a fila às cegas. |
| Autorização Pix pendente no Asaas | A tela exibe uma autorização de R$ 6. Seu vínculo exato com a cobrança desejada não foi comprovado. Nenhum código foi confirmado pelo assistente. |
| Cobrança com desconto relatada pelo usuário | Ainda não identificada. A consulta aos padrões de juros/desconto foi bloqueada pela autorização pendente no Asaas; o print dessa cobrança ainda não foi recebido nesta etapa. Não há base para atribuir o desconto ao aplicativo ou a uma configuração específica. |
| Operar tudo pelo painel | O painel já tem leitura financeira, análise, reembolso e repasse vinculados. A ampliação para toda a operação, inclusive retirada do proprietário, assinatura e configuração de desconto, ainda não foi implementada e homologada por completo. Transferência manual continua desativada no servidor. |

## Nome FECHOU e CNPJ nas faturas

A documentação oficial do Asaas informa que nome/razão social e CPF/CNPJ não podem ser removidos da fatura. A opção de nome fantasia depende do cadastro e, segundo a documentação consultada, não é disponibilizada para MEI. Não foi confirmado nesta etapa qual é a modalidade atual da conta. Portanto, não foi removida ou falsificada a identificação legal e não foi utilizado nome de outra empresa.

É possível avaliar o uso da marca FECHOU e a personalização permitida, mas isso não equivale a ocultar o CNPJ. Descontos futuros podem ser configurados e ajustados por cobrança; uma cobrança já paga não deve ser tratada como se seu valor pudesse ser reescrito retroativamente.

Referências oficiais:

- https://central.ajuda.asaas.com/hc/pt-br/articles/32092815198235-Como-personalizar-ou-editar-informa%C3%A7%C3%B5es-da-fatura
- https://central.ajuda.asaas.com/hc/pt-br/articles/32093924293659-Como-utilizar-o-nome-fantasia-na-minha-conta-Asaas-e-nas-faturas
- https://central.ajuda.asaas.com/hc/pt-br/articles/32092856749211-Como-padronizar-juros-multa-e-desconto-nas-cobran%C3%A7as-futuras
- https://docs.asaas.com/docs/como-reativar-fila-interrompida

## Bloqueio de publicação

O login autorizado no Google avançou por senha, código e confirmação no aparelho. Ao retornar ao Cloudflare, a página exibiu **“Unable to sign in. Try again or use your email and password.”** O acesso não foi considerado bem-sucedido e a tentativa automática não foi repetida em ciclo. Essa falha não prova que o serviço está fora do ar nem que o usuário perdeu acesso à sua conta. A sessão previamente autenticada no TinyFish não oferece transferência do arquivo local de publicação.

O código foi conservado na branch privada `fechou-r16-correcao-2026-11-16`, PR de revisão #2. A branch principal não foi mesclada. A nova versão não substituiu o aplicativo publicado nem o painel administrativo 1.0.2.

## Pendências para finalizar o pedido completo

1. Publicar uma prévia do HTML exato no projeto Cloudflare correto, verificar o marcador R17 e validar antes de promover a produção.
2. Repetir os controles reais das duas telas novas, propostas/contrapropostas, compartilhamento e cancelamento. Conferir todos os tamanhos de celular.
3. Confirmar a cobrança exata da autorização financeira, recuperar a sincronização do webhook com uma entrega real e conciliar estorno/repasse sem duplicar movimentos.
4. Completar o fluxo do pedido pago restante: equipe antes do aceite, seleção, contrato e assinaturas, mensagens, fotos antes/durante/depois, início, conclusão, aprovação e repasse. Esse fluxo não foi concluído.
5. Validar pagamento/cartão/Pix/boleto, boleto liquidado, reembolso final, cancelamento e repasse com confirmação do provedor. Movimentações históricas não comprovam todos esses caminhos.
6. Validar áudio M4A real e análise com foto/material, políticas do checkout, cancelamento de assinatura e ausência de piscadas no aplicativo publicado.
7. Comparar o painel administrativo efetivamente publicado com o arquivo do repositório e implementar as operações financeiras ainda ausentes, com permissões, auditoria, idempotência e confirmações exigidas pelo provedor.
8. Identificar a cobrança com desconto e verificar as configurações reais de marca e desconto, sem alterar valores já pagos nem ocultar identificação obrigatória.
9. Concluir a auditoria de segurança e as capturas individuais das demais áreas alteradas nas revisões anteriores. Os testes desta etapa não autorizam declarar o aplicativo invulnerável.

## Arquivos

- `FECHOU_R17_index.html`: aplicativo completo em revisão.
- `FECHOU_R17_em_validacao.zip`: somente `index.html` na raiz. A versão ainda exige homologação antes de uso em produção.
- `FECHOU_R17_validacao.zip`: relatório, testes, fontes ativas, referência anterior e capturas. **Não publicar esse pacote técnico como site.**

Nenhuma senha, OTP, sessão real, chave privada ou valor completo de chave Pix foi incluído nos entregáveis.

Integridade do HTML: SHA-256 `977abf6f815a4a4ecabedf1056c1fba22535587775e1cdf4e2cdff162ef76e8c`, 2522258 bytes. Blob GitHub conferido com o arquivo local: `2b165a7d585219b03839b9610eaf9797780c2ddf`.
