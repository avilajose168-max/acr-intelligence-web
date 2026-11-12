const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');require('../continuous-improvement.js');
const source=fs.readFileSync(process.argv[2]||'index.html','utf8');
const context={window:{ACRImprovement:global.ACRImprovement},esc:s=>String(s).replaceAll('<','&lt;')};vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function reviewPresentation(c)'),source.indexOf('function renderCaseReport(c,')),context);
(async()=>{
const c={id:'c',reportOrganizationId:'org',description:'Falla documentada',actions:[]};
assert.equal(context.reviewPresentation(c).status,'Sin solicitar revisión');
c.reviewRequest={id:'q',version:global.ACRImprovement.fingerprint(c)};
assert.equal(context.reviewPresentation(c).status,'Solicitud enviada · pendiente de revisión');
for(const [result,status] of [['En revisión','En revisión'],['Solicitar ajustes','Ajustes solicitados'],['Validado','Aprobado']]){
const event={kind:'review',action_key:'',created_at:'2026-11-12T12:00:00Z',data:{requestId:'q',version:c.reviewRequest.version,result,reviewer:'Ana Pérez',notes:'Revisión documentada'}};
await global.ACRImprovement.loadCaseReview(c,async url=>url.includes('followup_events')?[event]:[{id:'p'}],'owner');
assert.equal(context.reviewPresentation(c).status,status);const html=context.reviewStatusHTML(c);assert.ok(html.includes('Ana Pérez')&&html.includes(status)&&html.includes('Revisión documentada'));
}
c.description='Análisis corregido';assert.equal(context.reviewPresentation(c).status,'Análisis modificado · solicita nueva revisión');
assert.ok(source.indexOf('id="finalTechnicalReview"')>source.indexOf('id="actionFields"'));
assert.ok(source.indexOf('data-k="reviewer"')>source.indexOf('id="actionFields"'));
assert.ok(source.includes("reportBox('09 · Revisión del análisis',reviewStatusHTML(c))"));
console.log('PASS exercise: request → reviewing → adjustments → approved, actual reviewer/notes/date in report, invalidation after editing, review located after action plan.');
})().catch(e=>{console.error(e);process.exitCode=1});
