const test=require('node:test');
const assert=require('node:assert/strict');
const {userRow,eventRow,state,date}=require('../access-console.js');
test('Directory escapes untrusted identity and company strings',()=>{
 const html=userRow({email:'<script>alert(1)</script>',name:'<img onerror=x>',memberships:[{company:'<svg onload=x>',role:'admin',status:'approved'}]});
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<svg'));assert.match(html,/&lt;script&gt;/);assert.match(html,/Administrador de compañía/);
});
test('Audit preserves before/after, actor, and recovered-data distinction',()=>{
 const html=eventRow({event_type:'membership_updated',target_email:'user@example.invalid',actor_label:'admin@example.invalid',occurred_at:'2026-11-11T19:00:00Z',old_state:{role:'member',status:'pending'},new_state:{role:'member',status:'approved'},source:'baseline'});
 assert.match(html,/Pendiente/);assert.match(html,/Aprobado/);assert.match(html,/admin@example.invalid/);assert.match(html,/Dato recuperado/);assert.match(html,/Cambio de acceso/);
});
test('Missing sign-in is explicit and Chile timezone is used',()=>{
 assert.equal(date(null),'Sin ingreso registrado');assert.match(date('2026-11-11T19:00:00Z'),/16:00/);assert.equal(state(null),'—');
});
