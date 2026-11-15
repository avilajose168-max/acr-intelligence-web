const {JSDOM}=require('jsdom');
const fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<div id="corporateAffiliationPanel"></div>',{url:'https://acrintegrity.cl',runScripts:'outside-only'}),w=dom.window;
w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
w.eval(fs.readFileSync('company-local-storage.js','utf8'));
const panel=w.document.querySelector('#companyLocalStoragePanel'),q=s=>panel.querySelector(s),tick=()=>new Promise(r=>setImmediate(r));
let state={configured:false},calls=[],org='A',pending;
async function rpc(name,body){calls.push([name,body]);assert.equal(body.p_organization,org);
 if(name.endsWith('_status'))return structuredClone(state);
 if(name.endsWith('_configure')){state={configured:true,state:'unlinked',server_name:body.p_server_name,root_path:body.p_root_path,jobs:[]};return state;}
 if(name.endsWith('_pairing'))return {code:'ACR1-TEST',expires_at:new Date(Date.now()+600000).toISOString()};
 if(name.endsWith('_probe')){state.jobs=[{id:'write1',kind:'write_probe',state:'queued',relative_path:'ACR_Conexion_Prueba/2026/11/example/informe.html'}];return {id:'write1'};}
 if(name.endsWith('_retrieve')){assert.equal(body.p_original,'write1');state.jobs.unshift({id:'read1',kind:'read_probe',state:'verified',returned_content:'<h1>Leído del disco</h1>'});return {id:'read1'};}
 if(name.endsWith('_revoke')){state.state='unlinked';return state;}
 throw Error(name);
}
const options=()=>({allowed:true,orgId:org,userId:'admin',rpc});
(async()=>{
 w.ACRLocalStorage.configure({allowed:false});assert(panel.hidden);
 w.ACRLocalStorage.configure(options());await tick();assert(!panel.hidden);assert(q('[data-action="pair"]').disabled);
 q('[name="server"]').value='PC Demo';q('[name="folder"]').value='C:\\Users\\Usuario\\Documents\\ACR_Prueba_Servidor\\Empresa_Demo';q('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();await tick();assert(!q('[data-action="pair"]').disabled);
 q('[data-action="pair"]').click();await tick();await tick();assert.equal(q('.ls-code').value,'ACR1-TEST');
 state.state='connected';q('[data-action="refresh"]').click();await tick();assert(!q('[data-action="probe"]').disabled);
 q('[data-action="probe"]').click();await tick();await tick();assert(q('.ls-jobs').textContent.includes('En espera'));assert(!q('.ls-jobs').textContent.includes('Verificado'));
 state.jobs[0].state='verified';q('[data-action="refresh"]').click();await tick();q('.ls-job button').click();await tick();await tick();assert(q('.ls-jobs').textContent.includes('Ver informe recuperado'));
 q('.ls-job button').click();assert(w.document.querySelector('dialog').open);assert.equal(w.document.querySelector('iframe').getAttribute('sandbox'),'');assert.equal(w.document.querySelector('iframe').srcdoc,'<h1>Leído del disco</h1>');
 org='B';state={configured:false};w.ACRLocalStorage.configure(options());await tick();assert.equal(q('[name="folder"]').value,'');assert.equal(q('.ls-code').value,'');assert.equal(q('.ls-jobs').textContent,'');assert(!w.document.querySelector('dialog').open);
 w.ACRLocalStorage.configure({allowed:false});assert(panel.hidden);assert.equal(q('[name="folder"]').value,'');
 w.close();console.log('PASS: admin flow, queue/verified distinction, disk preview, company isolation and reset');
})().catch(e=>{w.close();console.error(e);process.exitCode=1;});
