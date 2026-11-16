# FECHOU R14 — relatório de revisão

Data de referência: 15/11/2026 (America/Sao_Paulo).

**Esta é uma revisão de código com testes locais. Não é uma homologação completa do aplicativo em produção.**

O arquivo inteiro entregue foi construído sobre `FECHOU_corrigido_atual_R13.html`. O anterior `FECHOU_ultimo_original_enviado.html` foi usado somente na comparação; nenhuma versão antiga foi adotada como base.

## Entrega e validação

- `index.html`: aplicativo completo com as correções desta revisão, pronto para revisão adicional; não foi publicado em produção.
- `eworkers-api-preparado.ts`: código completo de servidor preparado e testado isoladamente; **não implantado**.
- 21 testes de DOM/lógica do HTML e 15 testes isolados do servidor passaram (36 no total).
- Os testes usam contas, pedidos e dados simulados. Não houve pagamento, estorno, assinatura de contrato, ativação de plano ou repasse real.
- O navegador local não pôde iniciar no ambiente; a tentativa de acesso pelo navegador disponível foi bloqueada. **Não existem screenshots reais desta revisão nem comprovação de layout em Android/iOS.** Nenhuma imagem simulada é apresentada como print.
- O Supabase conectado listou somente `qktkyoqjuacdidsdgzqd` (EXY). O projeto do HTML é `ziubcqxmxialhmwevtiy`; a consulta direta retornou `You do not have permission to perform this action`. O EXY não foi alterado.
- O TinyFish não possui sessão autenticada registrada para o Supabase nesta conexão. Não foi tentado usar credenciais de outra conta.
- GitHub: branch `fechou-r14-revisao-2026-11-15` no repositório `gabirke782/fechou-app`. As alterações estão isoladas da branch principal e do site publicado.

## O que foi corrigido nesta revisão

1. Escolha do contrato opcional realmente confirmada, associada ao pedido e incluída na gravação da proposta.
2. Coerência entre urgência e data em ambas as sequências de escolha, sem alterar o motor de análise de preço regional.
3. Reconhecimento de papéis PT/EN e bloqueio da entrada quando a consulta do perfil falha, sem converter papel desconhecido em cliente.
4. Ausência de plano deixa de selecionar mensal por padrão; botão repetido da página de planos removido.
5. Cancelamento confirmado e solicitação em análise têm mensagens distintas e respeitam a modalidade de pagamento.
6. Total em análise e lista de reembolsos usam a mesma fonte; histórico conserva serviço, motivo, processamento e comprovante e não é refeito repetidamente.
7. Áreas de acompanhamento e ganhos deixam de compartilhar a mesma chave de deduplicação.
8. Textos de implementação do menu reescritos para o usuário e controles de e-mail/senha reunidos no editor de perfil.
9. Seleções/ações azuis, valores brancos, atenção laranja, confirmação verde e cancelamento/erro vermelho; símbolos de pagamento do R13 preservados.
10. Revalidação de elegibilidade no servidor preparada antes de registrar solicitação de repasse, sem executar transferência.

## Situação de cada pedido (44 itens)

| Item | Situação | Evidência e limite |
|---|---|---|
| 1.1 | Preservado do R13 | Mantido somente o acesso à Política de Privacidade no cadastro; aceite e conteúdo jurídico conservados. |
| 1.2 | Corrigido na interface; servidor preparado | Normalização exata dos papéis PT/EN; papel desconhecido não vira cliente; erro ao ler perfil não permite seguir como o papel escolhido. Backend preparado usa somente profiles.role. RLS/contas reais ainda não validados. |
| 1.3 | Preservado; revisão visual pendente | Regras existentes de rodapé conservadas; falta captura real de entrada/cadastro. |
| 2.1 | Conferido no DOM | 21 notificações simuladas: sino/lista indicam 21; marcar uma como lida resulta em 20 e grava atualização com escopo da conta. A janela de consulta foi ampliada de 20 para 200; caixas acima de 200 ainda exigem paginação ou contador no servidor. |
| 2.2 | Preservado do R13 | Filtro existente retira lembretes de execução do cliente. Ainda requer conferir os destinatários gerados no backend. |
| 2.3 | Preservado; validação real pendente | Mecanismo existente de eventos vistos por usuário mantido. Não foi comprovada persistência entre dispositivos com contas reais. |
| 3.1 | Pendente de acesso ao FECHOU | Não foi possível consultar cobranças, logs, webhook nem estado implantado. Não houve marcação manual de boleto como pago nem criação de cobrança de teste. |
| 4.1 | Preservado do R13 | Ajudas contextuais mantidas; inspeção visual por screenshot pendente. |
| 4.2 | Preservado do R13 | Orientações de categoria e serviço permanecem nas ajudas contextuais. |
| 4.3 | Corrigido e testado no DOM | Hoje converte Normal em Hoje. Escolher Normal depois move a data para amanhã e a escolha não é desfeita pelos observers. Urgente permanece Urgente. Datas passadas são corrigidas. |
| 4.4 | Preservado do R13 | Remoção da seção redundante mantida. O motor da IA e a exigência de análise regional foram preservados. |
| 5.1 | Preservado; revisão visual pendente | Setas laranja existentes conservadas. Acompanhamento e ganhos agora possuem chaves distintas, evitando que a deduplicação elimine uma dessas seções. |
| 5.2 | Preservado; revisão visual pendente | Controles de ajuda/expansão do pagamento mantidos. |
| 6.1 | Layout do R13 preservado | Não foi implementada outra reformulação de detalhes/registro completo. A regra de apresentação e aprovação prévia de novo protótipo continua válida. |
| 6.2 | Preservado do R13 | Não foi restaurado o aviso redundante sobre concorrência. |
| 6.3 | Preservado; revisão visual pendente | Organização de ações recebida no R13 conservada. |
| 6.4 | Preservado; fluxo real pendente | Compartilhamento individual existente conservado; falta validar todos os caminhos em navegador real. |
| 7.1 | Ajustado e testado no DOM | Aviso imediato de cancelamento direto não promete devolução; modalidade protegida explica dependência de análise/confirmação do pagamento. |
| 7.2 | Revisado parcialmente | Textos institucionais de implementação reescritos; mantidos fornecedores, finalidades, direitos e canal de suporte. Removido alerta técnico duplicado de SQL após falha de proposta. Ainda falta navegação visual completa. |
| 7.3 | Corrigido e testado no DOM | Resposta de cancelamento confirmado é distinguida de solicitação em análise; atualização local do pedido provoca render imediato. Popup existente mantém duração aproximada de três segundos. |
| 7.4 | Conferido no DOM | Aviso imediato tem somente Fechar; não inclui Abrir chat. |
| 7.5 | Parcial; sincronização real pendente | Resposta contendo pedido atualizado é aplicada imediatamente. Solicitação em análise não é tratada como cancelamento confirmado. Filtros das listas e histórico ainda requerem teste com resposta real do servidor. |
| 8.1 | Revisado; conferido no DOM | Revisados os textos técnicos das políticas/privacidade e cobrança, sem excluir informações sobre tratamento de dados. Fornecedores e LGPD continuam presentes no menu. |
| 8.2 | Complementado e testado no DOM | Editar perfil passa a incluir E-mail e segurança da conta, reutilizando as ações existentes. O campo de senha é criado vazio; dados e botão de salvar perfil permanecem. |
| 9.1 | Conferido no DOM; toque real pendente | Alternância da lista para grade e de volta passou por clique no DOM. Deduplicação foi limitada à mesma lista, preservando controles de listas diferentes. Não equivale a validação Android/iOS por toque. |
| 9.2 | Preservado; conferido no DOM | Ícones de lista e grade de três colunas mantidos; seleção ativa ajustada para azul. Legibilidade em telas físicas ainda depende de revisão visual. |
| 9.3 | Preservado do R13 | SVGs de Pix, código de barras e cartão conservados. Teste confirma disponibilidade desses mesmos símbolos; nenhuma substituição visual foi feita neles. |
| 9.4 | Corrigido e testado no DOM | Popup exige seleção e confirmação, prende foco, aceita Escape e limpa modalidade ao fechar. Escolha fica vinculada ao pedido. generate_contract/contract_requested chegam à RPC de gravação. Ainda exige conferir o resultado na RPC implantada. |
| 9.5 | Proteção local reforçada; RLS pendente | Validação local explícita de proprietário preserva bloqueio ao próprio pedido. Não foi alterada a RPC fechou_save_proposal nem removida sua proteção: causa do 42501 depende de inspeção do banco real. |
| 10.1 | Preservado e complementado | Mensagem de ausência de assinatura conservada; removido também o valor padrão local que marcava plano mensal como selecionado sem contratação. |
| 10.2 | Corrigido e testado no DOM | Sem plano: orientação e Ver planos no painel. Dentro da própria página de planos, o botão redundante Ver planos foi removido. Identificação do perfil foi reforçada. |
| 10.3 | Pendente de homologação real | Fluxos gratuitos e de cobrança existentes mantidos; normalização de papel preparada no backend. Não foram ativados planos nem criadas cobranças reais para validação. |
| 11.1 | Preservado do R13 | Regra de ganhos somente para profissional conservada; ajuste de chaves impede confundir ganhos com acompanhamento. |
| 11.2 | Aplicada orientação mais recente do print | Valores e números permanecem brancos, conforme o print enviado nesta solicitação. Verde identifica confirmação; não foi reaplicado o pedido antigo conflitante de pintar o valor guardado de verde. |
| 11.3 | Corrigido e testado com dados simulados | Total em análise usa a mesma fonte da lista de reembolsos. Serviço, motivo, processamento e comprovante são preservados ao reorganizar registros. Links financeiros só permanecem clicáveis se HTTPS sem credenciais na URL. Consulta real ainda depende do servidor. |
| 11.4 | Padrão recebido preservado; visual pendente | Estrutura da carteira e painéis financeiros mantida. Não foi feita nova reconstrução da carteira. |
| 12.1 | Complementado e testado no DOM | Histórico compacto recebido foi mantido; reconversão do mesmo registro agora é idempotente e não perde motivos/informações/comprovantes. |
| 12.2 | Corrigido na classificação; visual pendente | Pendente/em análise/enviado ficam como atenção; confirmado como sucesso; falhou/cancelado como erro. Números permanecem brancos pela orientação atual do print. |
| 12.3 | Preservado do R13 | Seta expansível padrão conservada. |
| 13.1 | Backend preparado; não implantado | Antes de registrar solicitação, revalida profissional, aceite, pagamento aprovado, modalidade protegida, conclusão, reembolso e contestação. Os testes isolados bloqueiam lançamento release_ready antigo quando o serviço está em execução. Não substitui revisão das transições e permissões no banco real. |
| 13.2 | Parcial; banco real inacessível | Código existente de execução/transferência foi preservado. Preparada revalidação anterior à solicitação e condição de status para atualização. Unicidade, reserva atômica e RLS precisam ser confirmadas no banco; nenhuma migração especulativa foi aplicada. |
| 14.1 | Visual recebido preservado; revisão pendente | Não foi realizada reformulação global sem capturas reais. Estruturas mobile recebidas foram preservadas. |
| 14.2 | Parcial | Padrão de cores das ações ajustado; proporções e organização de botões recebidas mantidas. Falta revisão visual de todas as telas e modais. |
| 14.3 | Parcial | Padrões recebidos mantidos, classificação de estados alinhada. Uniformidade visual final ainda não comprovada em navegador real. |

## O que falta para considerar o aplicativo concluído

1. Autorizar acesso ao projeto Supabase `ziubcqxmxialhmwevtiy` para inspecionar funções implantadas, RPCs, constraints, grants/RLS, logs e os registros dos fluxos afetados.
2. Resolver e verificar no servidor os itens 3.1, 9.5, 10.3 e 13.x. Implantar somente o código confirmado contra esse ambiente, depois de conferir seu estado atual. O arquivo preparado não é evidência de implantação.
3. Verificar com o Asaas os boletos pagos, os eventos repetidos e a reconciliação, preservando os pagamentos existentes.
4. Executar os testes financeiros reais/ambiente de homologação apropriado: conclusão e aprovação, repasse antecipado, pedidos duplicados, disputa e reembolso. Os testes isolados não comprovam proteção transacional do banco.
5. Abrir o R14 num navegador de testes funcional, verificar as telas dos dois perfis e os modais em larguras de 320, 360, 390 e 430 px, testar toque, teclado e rolagem, e capturar imagens reais individuais de todas as partes visuais afetadas.
6. Qualquer nova reformulação do item 6.1 continua sujeita a protótipo e aprovação; o layout recebido no R13 foi preservado.

## Integridade

- R13 recebido: `7acedc1c1ce87f8173b8a76ebb2ea40650502885ae88db5dd12eb43b3b290643`
- Anterior usado para comparação: `d95dfb632a51bc84e4a23c7e3dc543d1ee7b4574189c3dc3d1b287485d5b519d`
- R14 entregue: `65e3e83a39f1937bda9fcd955d10e982840508896716e728a70bed12454e425f`

Os nomes, valores e preços comerciais existentes no R13 foram preservados. A comissão de 2% não foi alterada. Nenhum histórico, pedido, proposta ou pagamento real foi removido.
