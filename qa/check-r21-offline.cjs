#!/usr/bin/env node
// FECHOU: auditoria de HTML offline, sem rede, pacotes externos, GitHub Actions ou cobrança.
// Uso: node qa/check-r21-offline.cjs /caminho/FECHOU_R21_Apple_login_index.html
'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const filename=process.argv[2];
if(!filename){ console.error('Uso: node qa/check-r21-offline.cjs /caminho/do/HTML');process.exit(2);}
const html=fs.readFileSync(filename,'utf8');
const checks=[];
function test(name,ok,detail=''){checks.push({name,ok,detail});console.log((ok?'OK   ':'FALHA')+' '+name+(detail?' — '+detail:''));}
test('Versão R21',html.includes('data-fechou-revision="R21-2026-11-17-apple-oauth-preparado"'));
test('Tela Cliente',html.includes('Sou cliente'));
test('Tela Profissional',html.includes('Sou profissional'));
test('Botão Apple',html.includes('data-fechou-apple-auth'));
test('Provedor Apple no OAuth',/provider\s*:\s*['"]apple['"]/.test(html));
test('Bloqueio antes da ativação do provedor',html.includes('external?.apple===true'));
test('Persistência de perfil ao autenticar',html.includes('fechou_apple_pending_role'));
test('Sem segredo sb_secret no cliente',!/sb_secret_[A-Za-z0-9_-]{10,}/.test(html));
let scripts=0, jsons=0, syntaxErrors=0;
const re=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
for(const hit of html.matchAll(re)){
  const attr=hit[1], body=hit[2];
  if(/\bsrc\s*=/.test(attr)||!body.trim())continue;
  const type=(attr.match(/\btype\s*=\s*['"]([^'"]+)/i)||[])[1]||'text/javascript';
  if(type==='application/json'||type==='application/ld+json'){
    jsons++;try{JSON.parse(body)}catch(e){syntaxErrors++;console.error('JSON inválido:',e.message);}
  } else if(['text/javascript','application/javascript','module'].includes(type)){
    scripts++;try{new vm.Script(body,{filename:'inline-'+scripts+'.js'});}
    catch(e){syntaxErrors++;console.error('JS inválido:',e.message);}
  }
}
test('JS/JSON sem erros de sintaxe',syntaxErrors===0,scripts+' JS; '+jsons+' JSON');
console.log(JSON.stringify({file:filename,total:checks.length,passed:checks.filter(x=>x.ok).length,failed:checks.filter(x=>!x.ok).length,js:scripts,json:jsons},null,2));
process.exit(checks.every(x=>x.ok)?0:1);
