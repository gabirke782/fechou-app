const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('auditoria/R18/candidato/index.html','utf8');
const script=html.match(/<script id="fechou-v115-safe-autosave">([\s\S]*?)<\/script>/)[1];
const sensitive=script.slice(script.indexOf('const sensitive ='),script.indexOf('// Persist only'));
const fn=script.slice(script.indexOf('function clean('),script.indexOf('function snapshot('));
const results=[];function test(name,run){try{run();results.push({name,passed:true})}catch(e){results.push({name,passed:false,error:String(e)})}}
function context(extra={}){const c=vm.createContext(extra);vm.runInContext(sensitive+fn+';globalThis.check=clean;',c);return c;}
const plain=v=>JSON.parse(JSON.stringify(v));
test('Autosave aceita objetos quando APIs de mídia não existem',()=>{const c=context();assert.deepEqual(plain(c.check({service:'Tomada',amount:150},'',0)),{service:'Tomada',amount:150})});
test('Objetos de mídia são descartados quando construtores existem',()=>{for(const name of ['File','Blob','MediaStream','AudioContext','webkitAudioContext']){class Runtime{}const c=context({[name]:Runtime});assert.equal(c.check(new Runtime(),'',0),undefined)}});
test('Credenciais e tokens continuam excluídos recursivamente',()=>{const c=context();assert.deepEqual(plain(c.check({service:'Tomada',password:'fixture',nested:{access_token:'fixture',refresh_token:'fixture',amount:6}},'',0)),{service:'Tomada',nested:{amount:6}})});
test('Blob URL e strings além do limite continuam descartadas',()=>{const c=context();assert.equal(c.check('blob:fixture','',0),undefined);assert.equal(c.check('a'.repeat(1800001),'',0),undefined)});
test('Limites de profundidade e 300 itens continuam ativos',()=>{const c=context();assert.equal(c.check({service:'x'},'',10),undefined);assert.equal(c.check(Array.from({length:305},(_,i)=>i),'',0).length,300)});
test('Reprodução: MediaStream inexistente interrompia salvamento no código anterior',()=>{const c=vm.createContext({File:class{},Blob:class{}});const old=fn.replace(/\(typeof File[\s\S]*?\(typeof webkitAudioContext === "function" && value instanceof webkitAudioContext\)/,'value instanceof File || value instanceof Blob || value instanceof MediaStream || value instanceof AudioContext');vm.runInContext(sensitive+old+';globalThis.check=clean;',c);assert.throws(()=>c.check({service:'Tomada'},'',0),/MediaStream is not defined/)});
fs.mkdirSync('retomada-r18',{recursive:true});fs.writeFileSync('retomada-r18/autosave-results.json',JSON.stringify({kind:'Função real extraída; ambientes com e sem APIs simulados; sem dados reais.',results},null,2));
console.log(JSON.stringify({passed:results.filter(x=>x.passed).length,total:results.length,failed:results.filter(x=>!x.passed)},null,2));process.exitCode=results.some(x=>!x.passed)?1:0;

