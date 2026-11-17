#!/usr/bin/env node
'use strict';
// FECHOU: verificação somente leitura do HTML em produção.
// Executar com Node.js 18+: node qa/verify-cloudflare-r21-1.cjs
// Não faz login, não escreve dados, não cria pagamentos, não usa APIs pagas.
const {createHash}=require('node:crypto');
const base='https://startup5.pages.dev/';
const expected='df98c300e3c6919b4bbe6543bdc688e07e00cb9b2806dc448dc3e3a3fab40a81';
const hotfix='R21.1-2026-11-17-signature-notifications';
(async()=>{
  const url=new URL(base);url.searchParams.set('fechou_release_probe',Date.now().toString());
  const r=await fetch(url,{method:'GET',cache:'no-store',headers:{accept:'text/html'},signal:AbortSignal.timeout(20000)});
  const raw=Buffer.from(await r.arrayBuffer());
  const sha=createHash('sha256').update(raw).digest('hex');
  const html=raw.toString('utf8');
  const marker=html.includes('name="fechou-hotfix" content="'+hotfix+'"');
  const correctSha=sha===expected;
  console.log(JSON.stringify({url:base,http:r.status,bytes:raw.length,version_marker_present:marker,sha256:sha,expected_sha256:expected,exact_file_match:correctSha},null,2));
  if(!r.ok||!marker||!correctSha) {
    console.error('Cloudflare ainda não serve exatamente o release FECHOU R21.1 verificado. Não declarar deploy concluído.');
    process.exitCode=1;
  }
})().catch(e=>{console.error('Não foi possível validar a publicação:',e.message);process.exitCode=2;});
