# FECHOU — Correção nº 4 (isolada)

**Branch:** `correcao-04-login-fotos-contrato-20261119`  
**Arquivo principal:** `index.html` (base: `main` em 19/11/2026)  
**Migração adicional:** `correcoes/correcao-04-contrato-opcional.sql`  
**Implantação:** não publicada no Cloudflare nem aplicada no Supabase; manter isolada até a unificação solicitada.

## Alterações efetivamente incorporadas ao HTML
1. Login por e-mail/senha: após carregar perfil, fecha a tela de entrada e abre `professionaljobs` (profissional, Serviços disponíveis) ou `home` (cliente, Início). Ajustadas também a entrada alternativa e a restauração de sessão.
2. Fotos do chat: profissional só captura com serviço em andamento; `Antes` habilita `Durante`, e `Durante` habilita `Depois`. Etapas bloqueadas ficam acinzentadas, não clicáveis. Preservado limite de cinco por etapa.
3. Sincronização: contagem compartilhada e vinculada ao pedido; atualização imediata após a confirmação de cada inserção; galeria evita substituir miniaturas quando os registros são os mesmos. Upload pendente é aguardado na finalização, sem esperar gerar todas as URLs das miniaturas.
4. Lembretes: consultam a contagem persistida e solicitam a **próxima etapa faltante**, não uma etapa fixa. Avisos da etapa são retirados ao registrar a foto correspondente.
5. Modal **Finalizar serviço**: estado inicial "Sincronizando"; consulta ao banco para Antes/Durante/Depois; confirma somente com três etapas registradas; removido botão **Fechar**, preservado **Voltar**. Fotos extras continuam opcionais (até cinco), sem mexer na seleção que o usuário confirmou funcionar.
6. Pagamento direto: sem solicitação do profissional, a ferramenta Contrato aparece bloqueada/cinza e o painel de condições não é apresentado como contrato. Quando profissional escolhe **Sim** para contrato opcional na proposta, cliente pode aceitar/recusar pelo chat. Só há opção de geração após aceite; pagamento pelo aplicativo + contrato permanece inalterado.

## Migração de banco necessária na unificação
O HTML chama a RPC `fechou_qa4_respond_optional_contract`. A migração SQL cria essa função com autorização do cliente vinculado ao pedido, grava o aceite/recusa na contratação, envia notificação ao profissional e instala gatilho para avisar o cliente quando a proposta selecionada solicitar contrato. Ela **ainda não foi executada** neste projeto, para evitar interferência nas demais correções isoladas.

**Não implantar apenas o HTML para testar o aceite do contrato opcional:** aplique a migração SQL antes ou na mesma publicação coordenada.

## Verificações realizadas
- Validado o parsing sintático dos **132 scripts JavaScript executáveis**; nenhuma falha (quatro blocos de manifesto JSON foram excluídos).
- Conferidas a presença das rotas de login, das travas sequenciais de fotos, da consulta ao banco no modal e da desativação de contrato direto sem solicitação.
- **Pendente:** teste ponta a ponta com duas contas autenticadas, fotos reais, persistência e notificações, além das capturas visuais da interface em ambiente de testes. Estes testes exigem implantar a branch em um ambiente seguro.

## Cenários de aceitação para a unificação
1. Profissional entra com senha → abre Serviços disponíveis, sem formulário de login residual. Cliente entra → abre Início.
2. Antes de iniciar: todas as fotos travadas. Após iniciar: somente Antes. Após salvar Antes: Durante. Após salvar Durante: Depois.
3. Última foto salva → abrir imediatamente Finalizar serviço → três linhas verdes, botão disponível, sem precisar sair e voltar do app. Se ainda está fazendo upload, mostrar "Sincronizando", não um falso "faltando".
4. Foto já registrada não aparece duplicada após refresh; nenhuma tela inteira pisca durante o carregamento.
5. Sem contrato na proposta direta → botão Contrato cinza. Contrato solicitado pelo profissional → cliente recebe aviso e aceita ou recusa. Aceite libera preparação; recusa notifica o profissional e mantém execução direta sem contrato.
6. Pagamento pelo aplicativo + contrato e assinatura Clicksign: fluxo não sofre alteração.

**Não incorporar esta branch diretamente ao `main` sem reconciliar as outras correções numeradas.**
