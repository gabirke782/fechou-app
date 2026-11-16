# Matriz dos 44 pedidos originais — estado R16

Itens preservados não foram reconstruídos. Conferência no código/DOM não equivale a homologação financeira ou captura visual. Onde a revisão R16 não acrescentou prova, o limite anterior foi conservado.

| Item | Situação | Evidência e limite |
|---|---|---|
| 1.1 | Preservado do R13 | Mantido somente o acesso à Política de Privacidade no cadastro; aceite e conteúdo jurídico conservados. |
| 1.2 | Servidor ativo e testes locais | Aliases persistidos PT/EN ativos; login real profissional passou. Teste cruzado de todos os perfis ainda pendente. |
| 1.3 | Preservado; revisão visual pendente | Regras existentes de rodapé conservadas; falta captura real de entrada/cadastro. |
| 2.1 | Conferido no DOM | 21 notificações simuladas: sino/lista indicam 21; marcar uma como lida resulta em 20 e grava atualização com escopo da conta. A janela de consulta foi ampliada de 20 para 200; caixas acima de 200 ainda exigem paginação ou contador no servidor. |
| 2.2 | Preservado do R13 | Filtro existente retira lembretes de execução do cliente. Ainda requer conferir os destinatários gerados no backend. |
| 2.3 | Corrigido R15; testes conservados | Eventos antigos/novos e troca de conta passaram em 7 testes; persistência em múltiplos dispositivos ainda não homologada. |
| 3.1 | Conciliação pendente | Tabela de webhooks consultada sem novos eventos desde 07/11; exige conferir Asaas e boleto liquidado real. |
| 4.1 | Preservado do R13 | Ajudas contextuais mantidas; inspeção visual por screenshot pendente. |
| 4.2 | Preservado do R13 | Orientações de categoria e serviço permanecem nas ajudas contextuais. |
| 4.3 | Corrigido e testado no DOM | Hoje converte Normal em Hoje. Escolher Normal depois move a data para amanhã e a escolha não é desfeita pelos observers. Urgente permanece Urgente. Datas passadas são corrigidas. |
| 4.4 | Preservado do R13 | Remoção da seção redundante mantida. O motor da IA e a exigência de análise regional foram preservados. |
| 5.1 | Preservado; revisão visual pendente | Setas laranja existentes conservadas. Acompanhamento e ganhos agora possuem chaves distintas, evitando que a deduplicação elimine uma dessas seções. |
| 5.2 | Corrigido no R16 | CSS dos círculos de ajuda/expansão laranja. Capturas reais após publicação ainda pendentes. |
| 6.1 | Proposta preparada; aprovação pendente | PROTOTIPO_DETALHES.md contém estrutura concreta; layout atual não foi reformulado sem aprovação. |
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
| 9.1 | DOM e navegação real; mobile pendente | Alternância conferida; falta toque e captura do R16 publicado no celular. |
| 9.2 | Preservado; conferido no DOM | Ícones de lista e grade de três colunas mantidos; seleção ativa ajustada para azul. Legibilidade em telas físicas ainda depende de revisão visual. |
| 9.3 | Preservado do R13 | SVGs de Pix, código de barras e cartão conservados. Teste confirma disponibilidade desses mesmos símbolos; nenhuma substituição visual foi feita neles. |
| 9.4 | Corrigido e testado no DOM | Popup exige seleção e confirmação, prende foco, aceita Escape e limpa modalidade ao fechar. Escolha fica vinculada ao pedido. generate_contract/contract_requested chegam à RPC de gravação. Ainda exige conferir o resultado na RPC implantada. |
| 9.5 | RPC corrigida R15 | Estado Aguardando escolha aceito no banco; testes transacionais com rollback passaram. Próprio pedido segue protegido por 42501. |
| 10.1 | Preservado e complementado | Sem plano não inventa assinatura; renovação cancelada tem rótulo próprio e acesso pago preservado no R16. |
| 10.2 | Preservado e testado | Ver planos aparece sem plano; repetição dentro da própria tela continua removida. |
| 10.3 | Papel corrigido; homologação parcial | Login profissional real passou; ativação gratuita e compra de cada plano/meio ainda pendentes. |
| 11.1 | Preservado do R13 | Regra de ganhos somente para profissional conservada; ajuste de chaves impede confundir ganhos com acompanhamento. |
| 11.2 | Aplicada orientação mais recente do print | Valores e números permanecem brancos, conforme o print enviado nesta solicitação. Verde identifica confirmação; não foi reaplicado o pedido antigo conflitante de pintar o valor guardado de verde. |
| 11.3 | Dados locais e operação real parcial | Estorno R$6 solicitado e registrado refund_pending. Leitura da carteira ficou bloqueada pelo checkout antigo. R16 corrige consulta de estorno no checkout; lista/total reais ainda pendentes. |
| 11.4 | Padrão recebido preservado; visual pendente | Estrutura da carteira e painéis financeiros mantida. Não foi feita nova reconstrução da carteira. |
| 12.1 | Complementado e testado no DOM | Histórico compacto recebido foi mantido; reconversão do mesmo registro agora é idempotente e não perde motivos/informações/comprovantes. |
| 12.2 | Corrigido na classificação; visual pendente | Pendente/em análise/enviado ficam como atenção; confirmado como sucesso; falhou/cancelado como erro. Números permanecem brancos pela orientação atual do print. |
| 12.3 | Preservado do R13 | Seta expansível padrão conservada. |
| 13.1 | Servidor ativo; fluxo completo pendente | v331 conserva revalidação de identidade, aceite, pagamento, conclusão e reembolso antes da solicitação de repasse. |
| 13.2 | Parcial | Bloqueios testados; saque histórico com referência paga em outra movimentação segue sem nova transferência. Fluxo concorrente e webhook completo ainda pendentes. |
| 14.1 | Ajustes R16 preparados | Chat compacto e rolável; preservado restante do template. Revisão visual móvel não concluída. |
| 14.2 | Parcial | Cores preservadas e ações de chat ajustadas; todos os conjuntos de botões ainda precisam revisão visual. |
| 14.3 | Parcial | Confirmação de assinatura usa modal escuro; fechamento da equipe e políticas corrigidos. Uniformidade de todas as telas não comprovada. |
