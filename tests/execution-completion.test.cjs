const test=require('node:test');
const assert=require('node:assert/strict');
const {personalExecutionUpdates,applyPersonalExecutionUpdates,loadPersonalExecutionUpdates,actionKey}=require('../continuous-improvement.js');
const makeCase=()=>({id:'case-a',reportOrganizationId:'org-a',actions:[{description:'Modificar plan matriz',status:'En curso'}]});
const publication=c=>({id:'pub-a',owner_id:'owner-a',organization_id:'org-a',local_case_id:c.id,actions:structuredClone(c.actions)});
const execution=c=>({id:10,investigation_id:'pub-a',kind:'execution',action_key:actionKey(c.actions[0],0),data:{}});
test('An acknowledged execution completes the matching personal commitment and remains idempotent',()=>{
 const c=makeCase(),p=publication(c),e=execution(c),updates=personalExecutionUpdates([c],[p],[e],'owner-a');
 assert.equal(c.actions[0].status,'En curso');assert.equal(applyPersonalExecutionUpdates([c],updates),1);
 assert.equal(c.actions[0].status,'Completado');assert.equal(c.actions[0].executionSummary,'Ejecutada · efectividad pendiente');
 assert.equal(applyPersonalExecutionUpdates([c],updates),0);
});
test('Missing execution, another account or another company cannot complete a commitment',()=>{
 const c=makeCase(),p=publication(c),e=execution(c);
 for(const [pubs,events,user] of [[[p],[],'owner-a'],[[p],[e],'owner-b'],[[{...p,organization_id:'org-b'}],[e],'owner-a'],[[p],[{...e,investigation_id:'another-pub'}],'owner-a']])assert.deepEqual(personalExecutionUpdates([c],pubs,events,user),[]);
 assert.equal(c.actions[0].status,'En curso');
});
test('Edited or reordered actions do not inherit the completion of another commitment',()=>{
 const c=makeCase(),p=publication(c),e=execution(c);c.actions[0].description='Cambiar rodamiento';
 assert.deepEqual(personalExecutionUpdates([c],[p],[e],'owner-a'),[]);
 const original=makeCase(),updates=personalExecutionUpdates([original],[publication(original)],[execution(original)],'owner-a');
 original.actions[0].description='Otra acción';assert.equal(applyPersonalExecutionUpdates([original],updates),0);
});
test('Completion is distinct from effectiveness and only uses verification of that execution',()=>{
 const c=makeCase(),p=publication(c),e=execution(c),v={id:11,investigation_id:p.id,kind:'effectiveness',action_key:e.action_key,data:{executionId:'10',result:'No efectiva'}};
 const updates=personalExecutionUpdates([c],[p],[e,v],'owner-a');applyPersonalExecutionUpdates([c],updates);
 assert.equal(c.actions[0].status,'Completado');assert.equal(c.actions[0].executionSummary,'Efectividad: No efectiva');
 assert.equal(personalExecutionUpdates([c],[p],[e,{...v,data:{executionId:'old',result:'Efectiva'}}],'owner-a')[0].summary,'Ejecutada · efectividad pendiente');
});
test('Refresh requests only the signed-in owner and compact event metadata, with pagination',async()=>{
 const c=makeCase(),p=publication(c),seen=[];
 const updates=await loadPersonalExecutionUpdates([c],async path=>{seen.push(path);return path.includes('acr_corporate_investigations')?[p]:[{...execution(c),result:null,executionId:null}]},'owner-a');
 assert.equal(updates.length,1);assert.ok(seen[0].includes('owner_id=eq.owner-a'));assert.ok(seen[0].includes('actions:payload->actions'));
 assert.ok(seen[1].includes('investigation_id=in.(pub-a)'));assert.ok(!seen[1].includes('select=*'));
});
test('Independent cases make no corporate requests and API failures do not mark completion',async()=>{
 const c=makeCase();await assert.rejects(loadPersonalExecutionUpdates([c],async()=>{throw Error('offline')},'owner-a'),/offline/);
 assert.equal(c.actions[0].status,'En curso');delete c.reportOrganizationId;
 assert.deepEqual(await loadPersonalExecutionUpdates([c],async()=>{throw Error('should not run')},'owner-a'),[]);
});
