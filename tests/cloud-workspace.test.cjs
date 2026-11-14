const test=require('node:test');
const assert=require('node:assert/strict');
const {WorkspaceSync}=require('../cloud-workspace.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const empty=()=>({cases:[],settings:{companyName:'',logo:''}});
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),map}};
function server(){
 const rows=new Map();let offline=false,hold=null;
 return {rows,set offline(v){offline=v},set hold(v){hold=v},async fetch(url,options){
  if(offline)throw Error('Sin conexión');
  const owner=options.headers.Authorization.slice(7);
  if(hold){const wait=hold;hold=null;await wait}
  if(options.method==='GET')return {ok:true,json:async()=>rows.has(owner)?[clone(rows.get(owner))]:[]};
  const {expected_revision,workspace_payload}=JSON.parse(options.body);
  const row=rows.get(owner);
  if((row?.revision||0)!==expected_revision)return {ok:false,status:409,json:async()=>({code:'40001',message:'conflict'})};
  const saved={revision:expected_revision+1,payload:clone(workspace_payload)};rows.set(owner,saved);
  return {ok:true,json:async()=>({revision:saved.revision})};
 }};
}
function device(api,store=storage(),clientId='tab',recoveryStore=null){
 let value=empty(),owner='a';const statuses=[];
 const engine=new WorkspaceSync({clientId,recoveryStore,storage:store,fetch:api.fetch.bind(api),url:'https://test.invalid',publicKey:'public',read:()=>value,apply:v=>value=v,getToken:async()=>owner,onStatus:(kind,message)=>statuses.push({kind,message})});
 return {engine,store,statuses,get value(){return value},set value(v){value=v},async start(user='a'){owner=user;await engine.start(user,'workspace-'+user)},edit(cases){value.cases=cases;engine.persist()}};
}
test('Legacy investigations and photographs migrate and reopen on a second device',async()=>{
 const api=server(),s=storage();const local={cases:[{id:'old',title:'MP1000',photos:[{data:'data:image/jpeg;base64,test'}]}],settings:{companyName:'ACR',logo:'image'}};
 s.setItem('workspace-a',JSON.stringify(local));const a=device(api,s),b=device(api);
 try{await a.start();assert.deepEqual(api.rows.get('a').payload,local);await b.start();assert.deepEqual(b.value,local);assert.equal(a.statuses.at(-1).kind,'synced')}finally{a.engine.stop();b.engine.stop()}
});
test('Offline changes survive a restart and upload after reconnection',async()=>{
 const api=server(),s=storage();let a=device(api,s);
 try{await a.start();api.offline=true;a.edit([{id:'offline'}]);assert.equal(await a.engine.flush(),false);a.engine.stop();a=device(api,s);await a.start();assert.equal(a.value.cases[0].id,'offline');api.offline=false;await a.engine.flush();assert.equal(api.rows.get('a').payload.cases[0].id,'offline');assert.equal(s.getItem('workspace-a-cloud-pending-tab'),null)}finally{a.engine.stop()}
});
test('Concurrent changes are blocked, then both versions survive explicit resolution',async()=>{
 const api=server(),a=device(api),b=device(api);
 try{await a.start();a.edit([{id:'one',title:'Original'}]);await a.engine.flush();await b.start();a.edit([{id:'one',title:'Equipo A'}]);await a.engine.flush();b.edit([{id:'one',title:'Equipo B'}]);assert.equal(await b.engine.flush(),false);assert.equal(b.statuses.at(-1).kind,'conflict');assert.equal(api.rows.get('a').payload.cases[0].title,'Equipo A');await b.engine.resolveKeepingBoth();const cases=api.rows.get('a').payload.cases;assert.equal(cases.length,2);assert.ok(cases.some(c=>c.title==='Equipo A'));assert.ok(cases.some(c=>c.title.includes('Equipo B')));assert.ok([...b.store.map.keys()].some(k=>k.includes('-recovery-')))}finally{a.engine.stop();b.engine.stop()}
});
test('A dirty legacy copy cannot overwrite an existing cloud workspace',async()=>{
 const api=server(),s=storage();api.rows.set('a',{revision:3,payload:{...empty(),cases:[{id:'remote'}]}});s.setItem('workspace-a',JSON.stringify({...empty(),cases:[{id:'legacy'}]}));const a=device(api,s);
 try{await a.start();assert.equal(a.statuses.at(-1).kind,'conflict');assert.equal(api.rows.get('a').revision,3);assert.equal(a.value.cases[0].id,'legacy')}finally{a.engine.stop()}
});
test('Edits made during an upload remain pending until separately acknowledged',async()=>{
 const api=server(),a=device(api);let release;
 try{await a.start();a.edit([{id:'one',title:'First'}]);api.hold=new Promise(r=>release=r);const saving=a.engine.flush();await new Promise(r=>setImmediate(r));a.edit([{id:'one',title:'Second'}]);release();await saving;assert.equal(api.rows.get('a').payload.cases[0].title,'First');assert.equal(a.engine.context.dirty,true);await a.engine.flush();assert.equal(api.rows.get('a').payload.cases[0].title,'Second')}finally{a.engine.stop()}
});
test('A response for the previous account cannot change the new account',async()=>{
 const api=server(),a=device(api);let release;
 try{await a.start();a.edit([{id:'private-a'}]);api.hold=new Promise(r=>release=r);const saving=a.engine.flush();await new Promise(r=>setImmediate(r));await a.start('b');release();await saving;assert.deepEqual(a.value,empty());assert.equal(a.engine.context.owner,'b');assert.equal(api.rows.get('b'),undefined);assert.equal(api.rows.get('a').payload.cases[0].id,'private-a')}finally{a.engine.stop()}
});
test('Confirmed deletion synchronizes and does not reappear on another clean device',async()=>{
 const api=server(),a=device(api),b=device(api);
 try{await a.start();a.edit([{id:'delete-me'}]);await a.engine.flush();await b.start();a.edit([]);await a.engine.flush();await b.engine.flush();assert.equal(b.value.cases.length,0);assert.equal(api.rows.get('a').payload.cases.length,0)}finally{a.engine.stop();b.engine.stop()}
});
test('Separate tabs retain separate unconfirmed recovery copies',async()=>{
 const api=server(),s=storage(),a=device(api,s,'tab-a'),b=device(api,s,'tab-b');
 try{await a.start();await b.start();api.offline=true;a.edit([{id:'tab-a'}]);b.edit([{id:'tab-b'}]);assert.equal(JSON.parse(s.getItem('workspace-a-cloud-pending-tab-a')).cases[0].id,'tab-a');assert.equal(JSON.parse(s.getItem('workspace-a-cloud-pending-tab-b')).cases[0].id,'tab-b')}finally{a.engine.stop();b.engine.stop()}
});


function recovery(){
 const map=new Map();return {map,async load(key,pending){return map.get(pending)||map.get(key)||null},async save(key,pending,value,dirty){map.set(key,value);if(dirty)map.set(pending,value);else map.delete(pending)},async backup(key,value){map.set(key,value)}};
}
function fullStorage(){const s=storage();s.setItem=()=>{throw Object.assign(Error('quota'),{name:'QuotaExceededError'})};return s}
test('Commitment status and photographs survive full localStorage, offline restart and reconnection',async()=>{
 const api=server(),s=fullStorage(),r=recovery();let a=device(api,s,'tab',r);
 api.rows.set('a',{revision:1,payload:{...empty(),cases:[{id:'case',photos:['original-photo'],actions:[{status:'En curso'}]}]}});
 try{
  await a.start();api.offline=true;a.value.cases[0].actions[0].status='Completado';a.engine.persist();await a.engine.flush();
  assert.equal(a.statuses.at(-1).kind,'offline');a.engine.stop();a=device(api,s,'new-tab',r);await a.start();
  assert.equal(a.value.cases[0].actions[0].status,'Completado');assert.deepEqual(a.value.cases[0].photos,['original-photo']);
  api.offline=false;await a.engine.flush();assert.equal(api.rows.get('a').payload.cases[0].actions[0].status,'Completado');assert.equal(a.statuses.at(-1).kind,'synced');
 }finally{a.engine.stop()}
});
test('Failed replacement keeps the previous cache and reports unavailable local recovery honestly',async()=>{
 const api=server(),s=fullStorage(),r=recovery();const previous=JSON.stringify({...empty(),_cloudSync:{revision:0,dirty:false}});s.map.set('workspace-a',previous);
 r.save=async()=>{throw Error('disk full')};const a=device(api,s,'tab',r);
 try{await a.start();api.offline=true;a.edit([{id:'unsaved'}]);await a.engine.flush();assert.equal(s.getItem('workspace-a'),previous);assert.equal(a.statuses.at(-1).kind,'storage');api.offline=false;await a.engine.flush();assert.equal(api.rows.get('a').payload.cases[0].id,'unsaved');assert.equal(a.statuses.at(-1).kind,'synced')}finally{a.engine.stop()}
});
test('Successful recovery replacement removes only this account cache and this tab outbox',async()=>{
 const api=server(),s=fullStorage(),r=recovery();s.map.set('workspace-b','other-user');s.map.set('workspace-a-cloud-pending-other','other-tab');const a=device(api,s,'tab',r);
 try{await a.start();a.edit([{id:'saved'}]);await a.engine.flush();assert.equal(s.getItem('workspace-b'),'other-user');assert.equal(s.getItem('workspace-a-cloud-pending-other'),'other-tab');assert.equal(s.getItem('workspace-a'),null);assert.ok(r.map.has('workspace-a'))}finally{a.engine.stop()}
});
test('A delayed recovery read from a previous account cannot replace the active account',async()=>{
 const api=server(),r=recovery();let release;r.load=key=>key==='workspace-a'?new Promise(resolve=>release=()=>resolve(JSON.stringify({...empty(),cases:[{id:'private'}]}))):Promise.resolve(null);const a=device(api,storage(),'tab',r);
 try{const old=a.start('a');await a.start('b');release();await old;assert.equal(a.engine.context.owner,'b');assert.deepEqual(a.value,empty())}finally{a.engine.stop()}
});
test('An edit during recovery acknowledgement stays dirty and survives restart',async()=>{
 const api=server(),r=recovery(),s=fullStorage(),a=device(api,s,'tab',r);let release,entered;
 try{
  await a.start();const original=r.save;let block=true;const reached=new Promise(resolve=>entered=resolve);
  r.save=async function(key,pending,value,dirty){if(!dirty&&block){block=false;entered();await new Promise(resolve=>release=resolve)}return original.call(this,key,pending,value,dirty)};
  a.edit([{id:'one',title:'first'}]);const saving=a.engine.flush();await reached;a.edit([{id:'one',title:'second'}]);release();await saving;await a.engine.context.cacheFlight;
  assert.equal(a.engine.context.dirty,true);assert.equal(JSON.parse(r.map.get('workspace-a')).cases[0].title,'second');
  assert.equal(JSON.parse(r.map.get('workspace-a'))._cloudSync.dirty,true);await a.engine.flush();assert.equal(api.rows.get('a').payload.cases[0].title,'second');
 }finally{a.engine.stop()}
});
