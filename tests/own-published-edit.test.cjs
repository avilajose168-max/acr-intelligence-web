const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {editableDraft}=require('../own-published-reports.js');
const sample=()=>({id:'pub-a',owner_id:'owner-a',organization_id:'org-a',local_case_id:'case-a',payload:{id:'case-a',title:'Pérdida de presión',equipment:'Bomba QA',photos:[{data:'data:image/png;base64,AAAA'}],actions:[{description:'Modificar plan matriz',status:'En curso'}]}});
test('Recovering a published investigation retains its original identity, evidence and company without changing the publication',()=>{
 const record=sample(),before=structuredClone(record),result=editableDraft(record,'owner-a',[],{whys:[],format:'5why'});
 assert.equal(result.existing,false);assert.equal(result.draft.id,'case-a');assert.equal(result.draft.reportOrganizationId,'org-a');assert.equal(result.draft.corporateOrgId,'org-a');assert.deepEqual(result.draft.photos,record.payload.photos);assert.deepEqual(record,before);
 result.draft.actions[0].description='Edited';assert.equal(record.payload.actions[0].description,'Modificar plan matriz');
});
test('An existing personal draft is opened without replacing its newer edits',()=>{
 const existing={id:'case-a',title:'Cambios personales sin publicar',photos:['local']};const result=editableDraft(sample(),'owner-a',[existing]);assert.equal(result.existing,true);assert.equal(result.draft,existing);assert.equal(existing.title,'Cambios personales sin publicar');
});
test('Another account or a publication without a valid case identity cannot be edited',()=>{
 assert.throws(()=>editableDraft(sample(),'owner-b',[]),/Solo el autor/);assert.throws(()=>editableDraft({...sample(),local_case_id:''},'owner-a',[]),/Solo el autor/);
});
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const begin=html.indexOf('async function editOwnPublishedReport(record){'),end=html.indexOf('\nwindow.acrOwnPublishedReports=window.ACROwnPublishedReports.mount({',begin);assert.ok(begin>=0&&end>begin);const code=html.slice(begin,end);
function environment({synced=true,allowed=true,persisted=true}={}){
 let calls=0;const ctx={activeUser:{id:'owner-a'},corporateCtx:{platform:false,memberships:allowed?[{organization_id:'org-a',status:'approved'}]:[],organizations:[{id:'org-a',active:true}]},db:{cases:[]},selected:null,window:{ACROwnPublishedReports:{editableDraft}},makeCase:()=>({whys:[],photos:[],actions:[]}),personalSync:{flush:async()=>{calls++;return synced}},loadOrganizations:async()=>{},persist:()=>persisted,$:()=>({options:[{value:'org-a'}],value:''}),localStorage:{setItem:()=>{}},navigate:page=>ctx.destination=page};vm.createContext(ctx);vm.runInContext(code,ctx);return {ctx,get calls(){return calls}};
}
test('Editing a missing own draft synchronizes it and opens the event editor without a corporate write',async()=>{
 const env=environment(),record=sample(),before=structuredClone(record);await env.ctx.editOwnPublishedReport(record);assert.equal(env.ctx.db.cases.length,1);assert.equal(env.ctx.selected,'case-a');assert.equal(env.ctx.destination,'registro');assert.equal(env.calls,2);assert.deepEqual(record,before);
});
test('Cloud conflict or unapproved company blocks recovery without altering personal cases',async()=>{
 for(const config of [{synced:false},{allowed:false}]){const env=environment(config);await assert.rejects(env.ctx.editOwnPublishedReport(sample()));assert.equal(env.ctx.db.cases.length,0);assert.equal(env.ctx.destination,undefined)}
});
test('A failed local save rolls back only the attempted addition',async()=>{
 const env=environment({persisted:false});env.ctx.db.cases.push({id:'other',title:'Keep me'});await assert.rejects(env.ctx.editOwnPublishedReport(sample()),/No se pudo guardar/);assert.equal(env.ctx.db.cases.length,1);assert.equal(env.ctx.db.cases[0].id,'other');
});
