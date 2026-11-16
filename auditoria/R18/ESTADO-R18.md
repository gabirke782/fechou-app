# FECHOU — checkpoint R18 — 16/11/2026

## Estado de publicação

R18 é uma versão candidata. NÃO foi publicada no Cloudflare.
A função central eworkers-api permanece na versão 332. O deploy do backend
R18 e uma tentativa menor limitada à conciliação foram recusados pela revisão
automática. Não houve tentativa de contornar a recusa.

NÃO publicar o HTML R18 isoladamente: ele depende da nova rota autenticada
orders/media-upload-urls. Publicá-lo contra v332 quebraria anexos de pedidos.
O index.html da raiz desta branch foi preservado em R17; o candidato fica em
auditoria/R18/candidato/index.html.

## Mudanças efetivamente aplicadas no Supabase

- Agendamento cron.job id 2 fechou-auto-refund-unassigned: active=false.
- fechou-auto-refund v16: autentica a chamada e retorna disabled=true. A lógica
  anterior de cancelamento e reembolso por falta de propostas foi removida.
- Bucket privado eworkers-chat: limite individual de 50 MiB; MIME audio/webm
  e image/heif adicionados. O bucket permanece privado.
- Nenhuma cobrança, transferência ou solicitação nova de reembolso nesta etapa.

## Backend candidato

Seis funções existentes alteradas: v195Draft, v195PrepublicationCreate,
v195Quote, v195Pay, v195Pending e teamSearch. Sete helpers adicionados.
143 funções preservadas. Autenticação, reembolso, repasse, carteira e contrato
mantêm seus corpos anteriores. Quote/Pay adicionam validação da conclusão dos
uploads. A substituição do módulo central ainda exige aprovação de implantação.

- Upload binário assinado, proprietário autenticado, caminhos privados,
  validação de MIME/tamanho/quantidade e vínculo confirmado com o rascunho.
- Até 300 MiB por solicitação e 50 MiB por arquivo. A interface admite
  90 fotos, 45 vídeos e um áudio. Limites do provedor continuam aplicáveis.
- Conciliação de rascunhos pendentes consulta o provedor antes de publicar;
  não presume pagamento apenas por texto, captura de tela ou status local.
- Busca de profissionais: variações de especialidade, região e distância
  somente quando houver coordenadas válidas.

## HTML candidato

- CEP independente do GPS, duas bases com timeout e descarte de resposta antiga.
- R$ em unitário/subtotal; valores combinados sem quebra interna.
- Upload direto; remoção de mídia remove também a referência usada no envio.
- Foto, vídeo e áudio em detalhes/registro; galeria com anterior/próximo/fechar.
- Vídeo do formulário em largura útil; ajustes de controles nativos.
- Estado pago prevalece sobre rascunho pendente; deduplicação de consulta e
  navegação após pagamento; atualização forçada ao retornar ao aplicativo.
- Reembolso: layout separa linhas antigas de três partes das linhas já
  normalizadas em duas partes; coluna de status limitada para preservar texto.
- Chat: Equipe; abertura compacta; seta; correção da rotina que recolhia as
  ferramentas imediatamente depois de expandir.
- Histórico de concluídos/avaliações no menu, removido do rodapé do perfil.
- Setas do menu laranja; controle de grade/lista e contador reposicionados.

## Evidência real de boleto

Asaas mostrou Recebida para pay_yp2xyvm0ehtu8u0x, em 11/11/2026, com referência
externa vinculada ao rascunho 4b0ca1b1-f897-4342-945f-30a592731b05.
O rascunho do FECHOU ainda estava payment_pending e sem published_order_id.
Não foi alterado manualmente para pago. A conciliação corretiva permanece
dependente do backend aprovado.

Webhook no Asaas: Interrompido, uma fila pausada. Um modal de autorização
financeira impediu consultar detalhes/causa e retomar a fila. Não foram
alterados tokens ou confirmadas operações financeiras.

## Validação e limitações

Os arquivos *results.json distinguem simulação de operação real. DOM, lógica,
upload e conciliação foram testados com dados simulados. Esses resultados não
comprovam pagamento, contrato, convite ou repasse real ponta a ponta.

A revisão visual local confirmou CEP e valores de materiais. Também revelou
o conflito residual da carteira e o recolhimento do chat, corrigidos no código
depois dessa captura. A recaptura final foi bloqueada pela política do navegador.
Não existe conjunto final de prints das seis ferramentas do chat.

Pendentes: confirmação do acesso Cloudflare salvo; implantação central;
sincronização real do boleto; webhook; cartão temporário ainda não fornecido;
fluxo real completo; seis capturas do chat; Apple Sign In e configuração do
provedor; operação financeira administrativa completa; auditoria integral.
Nenhuma promessa de segurança absoluta ou de conclusão total foi feita.

## Reprodução

checkpoint-sources.json contém as fontes auxiliares, construtor e testes.
build-r18.py foi executado a partir do R17 fornecido, preservado em
retomada-r17/codigo-r17/index.html. As alterações substituem os pontos indicados
em changes.json; esta etapa não consolida todos os scripts legados do aplicativo.
