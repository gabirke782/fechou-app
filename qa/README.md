# FECHOU — auditoria gratuita (R21)

Esta pasta contém um verificador **offline** e gratuito para analisar o HTML da versão R21, sem login, sem requisições à internet e sem processar pagamentos.

## Executar

```bash
node qa/check-r21-offline.cjs /caminho/FECHOU_R21_Apple_login_index.html
```

Precisa apenas do Node.js. **Não instala dependências e não executa GitHub Actions.** Para testes visuais locais e simulações adicionais, o pacote Python `fechou_offline_qa.py` fornecido na conversa usa Chromium/Playwright instalado no computador do executor.

O `index.html` do ramo `main` deste repositório pode ser anterior à versão publicada no Cloudflare. Este arquivo de teste **não substitui nem modifica** `index.html`, não presume que o HTML R21 está no GitHub e não afirma validar a publicação.

**Limitações:** não testa Apple real, Clicksign, Asaas, dados de usuários, repasses ou a conexão do site publicado. Esses fluxos exigem acesso apropriado e um ambiente de testes; não executar cobranças reais para obter aprovação dos testes.
