const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const edge=fs.readFileSync('supabase/functions/acr-assistant/index.ts','utf8');
const html=fs.readFileSync('index.html','utf8');
const responseData={description:'Descripción técnica de prueba suficientemente extensa.',whys:['a','b','c','d','e'],causes:'Hipótesis iniciales vinculadas al circuito, todas pendientes de verificación.',conclusion:'La causa no ha sido confirmada. Se requiere contrastar la posición de la válvula con la documentación y con mediciones.',basicCause:'Hipótesis: posición de válvula incorrecta. Pendiente de verificar.',causeConsequence:'Detención del chancador por baja presión hidráulica.'};
function service(statuses=[200],data=responseData){
 let handler,calls=0,config;
 const scope={Request,Response,AbortSignal,Date,Map,Set,JSON,String,Promise,setTimeout:fn=>{fn();return 0},console:{info(){},warn(){},error(){}},Deno:{serve:fn=>handler=fn,env:{get:k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'fake-public',GEMINI_API_KEY:'fake-key'}[k])}},fetch:async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:'test-user'}));
  calls++;config=JSON.parse(options.body);const status=statuses[Math.min(calls-1,statuses.length-1)];
  return new Response(JSON.stringify(status===200?{candidates:[{content:{parts:[{text:JSON.stringify(data)}]}}]}:{error:{status:'PROVIDER_ERROR'}}),{status});
 }};vm.runInNewContext(edge,scope);
 return {call:(mode='causes',origin='https://acrintegrity.cl',authorization='Bearer fake-token')=>handler(new Request('https://test.invalid',{method:'POST',headers:{origin,authorization},body:JSON.stringify({mode,description:'El chancador se detuvo por baja presión hidráulica.'})})),get calls(){return calls},get config(){return config},handler};
}
test('Production origins work while untrusted origins and unauthenticated calls are blocked',async()=>{
 const s=service();for(const origin of ['https://acrintegrity.cl','https://acr-integrity.vercel.app','https://avilajose168-max.github.io']){const r=await s.handler(new Request('https://test.invalid',{method:'OPTIONS',headers:{origin}}));assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),origin)}
 assert.equal((await s.call('causes','https://untrusted.invalid')).status,403);assert.equal((await s.call('causes','https://acrintegrity.cl','')).status,401);assert.equal(s.calls,0);
});
test('Gemini receives schema for all causal fields and a conforming answer is accepted',async()=>{const s=service();const r=await s.call();assert.equal(r.status,200);assert.equal((await r.json()).provider,'gemini');assert.ok(s.config.generationConfig.responseJsonSchema.required.includes('basicCause'));assert.ok(s.config.generationConfig.responseJsonSchema.required.includes('causeConsequence'))});
test('One transient provider failure is retried; permanent errors are not',async()=>{const s=service([503,200]);assert.equal((await s.call()).status,200);assert.equal(s.calls,2);const permanent=service([403]);assert.equal((await permanent.call()).status,502);assert.equal(permanent.calls,1)});
test('Incomplete causal data cannot be labeled a successful Gemini response',async()=>{const data={...responseData};delete data.basicCause;const s=service([200],data);assert.equal((await s.call()).status,502)});
function client(data){
 const c={validationStatus:'Causa validada por investigador',validation:'Hay evidencia anterior que no valida una nueva hipótesis.'};let localCalls=0;const elements={};const source=html.slice(html.indexOf('function generateHypotheses(){'),html.indexOf("$('#generateHypotheses').onclick"));
 const scope={String,Error,confirm:()=>true,ensureEvent:()=>c,normalizeText:v=>String(v||'').trim(),withBusy:(_,work)=>work(),assisted:async()=>data,persist(){},navigate(){},fallbackNotice:()=> 'asistente local',proposeHypotheses:()=>{localCalls++;return 'Causas locales'},proposeConclusion:()=> 'Conclusión local',proposeBasicCause:()=> 'Causa básica local',proposeCauseConsequence:()=> 'Consecuencia local',$:key=>elements[key]||(elements[key]={textContent:'',classList:{remove(){}},scrollIntoView(){}})};vm.runInNewContext(source,scope);return {c,scope,get localCalls(){return localCalls}};
}
test('Causal fields displayed in the UI come from Gemini and require renewed validation',async()=>{const x=client(responseData);await x.scope.generateHypotheses();assert.equal(x.c.basicCause,responseData.basicCause);assert.equal(x.c.causeConsequence,responseData.causeConsequence);assert.equal(x.localCalls,0);assert.equal(x.c.validationStatus,'En validación')});
test('A rejected response uses a coherent local fallback without retaining partial AI fields',async()=>{const x=client({...responseData,conclusion:'breve'});await x.scope.generateHypotheses();assert.equal(x.c.basicCause,'Causa básica local');assert.equal(x.c.causeConsequence,'Consecuencia local');assert.equal(x.c.conclusion,'Conclusión local');assert.equal(x.localCalls,1)});
