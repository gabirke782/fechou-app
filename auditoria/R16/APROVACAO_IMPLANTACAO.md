# Implantação pendente — correção da descrição de estorno

Projeto Supabase: `ziubcqxmxialhmwevtiy`, FECHOU.

| Função | Versão ativa conferida | Alteração proposta |
|---|---|---|
| eworkers-api | 331 | No envio de estorno, limitar description a 140 caracteres em vez de 500 |
| fechou-ops-api | 25 | Limitar a 140 a descrição inteira, incluindo prefixo, nos dois caminhos de estorno |

O motivo completo continua no histórico. Não são alterados valores, conta de destino, autorização, elegibilidade, idempotência ou pagamento. Um eventual caractere Unicode cortado pela metade é retirado da extremidade. As três alterações estão nos arquivos PENDENTE_*.diff. O teste específico tem 8 verificações aprovadas.

A revisão automática rejeitou a substituição das funções completas em produção por considerar amplo o impacto potencial sobre funções financeiras. Por isso, essas duas versões preparadas NÃO foram implantadas. Não foi usada outra rota para contornar a rejeição.

Fontes exatas propostas:
- eworkers-api: SHA-256 `3fba38bb570600b7a4afd12fee42f6855e33e00a751dddf2547ce2f057f591c1`.
- fechou-ops-api: SHA-256 `5f030385b008961d337311f286a001f2a3e152fba5881211f24c42cbf67d9ef3`.

As fontes ativas foram incluídas separadamente para reversão e comparação. É necessária uma aprovação específica para implantar essas duas correções. Aprovação não garante que a revisão automática aceitará uma nova tentativa.
