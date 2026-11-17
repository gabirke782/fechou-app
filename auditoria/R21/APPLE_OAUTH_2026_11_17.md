# FECHOU R21 — Login com Apple preparado (17/11/2026)

- **Escopo**: frontend único `index.html`, tela de autenticação Cliente/Profissional, sem alterações no backend, contrato, carteira ou Asaas.
- **Revisão**: `R21-2026-11-17-apple-oauth-preparado`.
- **Blob SHA GitHub**: `d78bf4b6d9c1fc501004f9ae3001c7c7b3612e0e`; sincronizados `index.html` e `auditoria/R18/candidato/index.html`.
- **Sem deploy automático** e sem GitHub Actions: alteração via API de conteúdo, preservando o site publicado em Cloudflare.
- **Interface**: botão preto `Continuar com Apple` após `Entrar com o Gmail`, responsivo, com ícone e foco visível.
- **Fluxo**: autenticação OAuth `auth.signInWithOAuth({provider:'apple',options:{redirectTo}})`, reaproveitando o retorno do Supabase e a escolha de perfil Cliente/Profissional. Um usuário que abriu `Já tenho conta` sem selecionar perfil é orientado a escolher antes do primeiro login social.
- **Proteção contra falso login**: antes de redirecionar, consulta pública de `/auth/v1/settings` e verifica `external.apple===true`. Quando o provedor não está habilitado, mostra aviso claro sem tentar navegar a uma página de erro ou criar conta.
- **Teste local**: 132 scripts JS e 4 scripts JSON com sintaxe válida; interface carregou a partir do fluxo `Sou cliente`; 2/2 testes de acionamento passaram (Apple desativado -> mensagem sem OAuth; Apple ativado simulado -> método do SDK com provider Apple e URL de retorno). 0 erros JavaScript registrados no teste local. **Não comprova autenticação real com a Apple.**
- **Prérequisitos reais**: para autenticação Apple no site/PWA (HTML Cloudflare Pages), a Apple requer App ID, Services ID com domínio do projeto Supabase e chave de assinatura; o provedor deve ser configurado no Supabase. Serviço de autenticação web exige conta Apple Developer com capacidade de criar esses identificadores. **Não foi criada conta nem contratado plano**. OAuth web exige manutenção periódica do segredo.
- **Endereços de referência**: Apple website domain `ziubcqxmxialhmwevtiy.supabase.co` e callback `https://ziubcqxmxialhmwevtiy.supabase.co/auth/v1/callback`; configurar a URL do FECHOU na lista de redirecionamento permitida do Supabase.
- **Regras preservadas**: Clicksign continua sandbox e código de verificação inserido pelo próprio signatário no fluxo seguro. Nenhuma nova sessão Clicksign nem configuração Apple Developer foi solicitada ou realizada.
- **Produção**: não publicar R21 como login Apple funcional sem configurar e homologar o provedor. Enquanto isso, e-mail/senha e Gmail permanecem as alternativas para usuários de iPhone.

Documentação:
- https://supabase.com/docs/guides/auth/social-sign-in/auth-apple
- https://developer.apple.com/br/help/account/capabilities/configure-sign-in-with-apple-for-the-web/
