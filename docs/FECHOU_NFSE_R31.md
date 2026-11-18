# FECHOU R31 — Integração com NFS-e Nacional

**Base do frontend:** FECHOU_R30_index.html (R31 preparado para upload manual no Cloudflare).
**Backend ativo:** Supabase `fechou-nfse-api` v1; código desta branch: `supabase/functions/fechou-nfse-api/index.ts`.

## O que está pronto
- Cadastro privado de emitente por CNPJ/município/regime; nunca expor dados fiscais privados em perfil público.
- Tabelas `fechou_nfse_emitentes`, `fechou_nfse_notas`, `fechou_nfse_auditoria` com RLS e sem escrita direta pelo cliente. Bucket privado `fechou-nfse-documentos`.
- Solicitação e preparação do rascunho após `service_state=completed`, vinculados à proposta aceita e valor gravado no banco.
- R31 inclui formulário no painel de comprovantes do chat. Usuário não precisa sair do aplicativo para preparar ou consultar situação.
- Após emissão oficial confirmada, notas e XML/PDF ficam disponíveis ao cliente por URL temporária.
- Proteção contra duplicidade e timeout indeterminado: `conciliacao_pendente` exige verificação da DPS antes de retransmitir.

## Não está ativo: emissão fiscal nacional
O portal da NFS-e **não fornece API key simples**. A emissão exige certificado ICP-Brasil, procuração válida do emitente quando representado, geração/assinatura XMLDSig, XSD oficial, compressão GZip/Base64 da DPS e mTLS na SEFIN. Nenhum certificado ou procuração estava disponível nesta execução. A função bloqueia `emitir` enquanto `FECHOU_NFSE_EMISSAO_ATIVA` não for habilitado e o gateway protegido não existir. **Não declarar que notas reais foram emitidas.**

## Pré-requisitos e segredos (apenas servidor)
- Verificar certificado do integrador ou dos prestadores, prazo de validade e autorização fiscal.
- Contratar/desenvolver signer + mTLS seguro e homologar com produção restrita.
- O gateway `POST /emitir` assina e transmite a DPS, retorna `{autorizada:true,chaveAcesso,nfseXmlBase64,danfsePdfBase64?,dpsId?,numero?}` apenas após confirmação oficial HTTP 201. Não confiar na entrada do cliente como XML assinado.
- No Supabase Secrets: `FECHOU_NFSE_GATEWAY_URL`, `FECHOU_NFSE_GATEWAY_TOKEN`, `FECHOU_NFSE_AMBIENTE=homologacao`, inicialmente `FECHOU_NFSE_EMISSAO_ATIVA=false`.
- Após validação de cada emitente por processo administrativo, marcar apenas este emitente `autorizacao=autorizado`; não oferecer essa permissão ao próprio usuário.

**Não subir PFX, senha ou chave privada ao GitHub/HTML/Storage.** Certificados no cofre do servidor de assinatura.

## Documentação de referência
- https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual
- https://sefin.nfse.gov.br/SefinNacional/docs/index
- https://www.gov.br/nfse/pt-br/noticias/nova-funcionalidade-possibilita-representacao-e-alternancia-de-perfis-na-nfs-e/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/

O projeto `ReceitaFederal/calculadora-rtc-regime-regular` oferece cálculo tributário e **não é uma API emissora** de NFS-e. Nenhuma dependência não auditada de terceiros foi importada.

## Testes
- 144 scripts JS do HTML R31 validados por `node --check`.
- Capturas em Chromium com **dados sintéticos**, incluindo cliente antes/depois, profissional preparando e visualizando NFS-e simulada. Nenhum `pageerror`.
- Supabase confirmado: Edge Function v1 ACTIVE; RLS nas 3 tabelas; bucket fiscal não público; 0 notas fictícias criadas.
- **Pendente** homologação real de certificado/procuração, emissão e download autorizado; testes de contas reais e RLS, Android e fluxo fiscal ponta a ponta.
