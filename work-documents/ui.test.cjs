const {JSDOM}=require('jsdom'),{webcrypto,randomUUID,createHash}=require('node:crypto'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<div id="mainApp"><nav class="nav"><div class="workspace-step-label"></div></nav></div>',{url:'https://acrintegrity.cl',runScripts:'outside-only'}),w=dom.window;
Object.defineProperty(w,'crypto',{value:webcrypto});w.Blob=Blob;let urls=0,revoked=[];w.URL.createObjectURL=()=> 'blob:qa-'+(++urls);w.URL.revokeObjectURL=u=>revoked.push(u);w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.eval(fs.readFileSync('work-documents.js','utf8'));
const api=w.ACRWorkDocuments,root=w.document.querySelector('#documentos'),q=s=>root.querySelector(s),form=q('form'),tick=()=>new Promise(r=>setTimeout(r,10));let rows=[],files=new Map(),jobs=new Map(),corrupt=false,failUpload=false,published=0,connected=true,consumed=0;
async function until(predicate){const end=Date.now()+2500;while(!predicate()){if(Date.now()>end)throw Error('Timed out: '+q('[data-message]').textContent);await tick();}}
const assets=[{area:'Área Seca',sector:'Chancado',name:'CHANCADOR PRIMARIO',sap:'10027327'},{area:'Área Húmeda',sector:'AGUAS CALAMA',name:'BBA AGUA CALAMA #1',sap:'51 PMP001'}];
let options;
async function request(path,method,body){
 if(path.startsWith('/rest/v1/acr_work_documents?')){const u=new URL('https://test'+path);return rows.filter(r=>r.organization_id===u.searchParams.get('organization_id').slice(3)&&r.category===u.searchParams.get('category').slice(3)&&(options.platform||r.status==='published'));}
 if(path.endsWith('acr_work_document_transfer')){
  const r=rows.find(r=>r.id===body.p_id),job=jobs.get(body.p_job);
  switch(body.p_op){
   case 'status':return {connected,configured:true};
   case 'begin_upload':if(failUpload)throw Error('Carga interrumpida');files.set(r.id,[]);return {ready:true};
   case 'append_upload':files.get(r.id).push(Buffer.from(body.p_data,'base64'));return {};
   case 'queue_upload':files.set(r.id,new Blob(files.get(r.id),{type:r.mime_type}));r.status='published';r.local_saved_at='2026-11-17';published++;return {state:'queued'};
   case 'retrieve':{const id=randomUUID();jobs.set(id,{id,r});return {id,state:connected?'verified':'queued',connected};}
   case 'read_chunk':{const raw=Buffer.from(await files.get(job.r.id).arrayBuffer()).subarray(body.p_offset,body.p_offset+262144);return {data:corrupt?Buffer.from('changed').toString('base64'):raw.toString('base64'),size:job.r.byte_size,checksum:job.r.sha256};}
   case 'consume':jobs.delete(body.p_job);consumed++;return {cleared:true};
   default:throw Error(body.p_op);
  }
 }
 assert.equal(path,'/rest/v1/rpc/acr_manage_work_document');if(body.p_op==='reserve'){const p=body.p_data,r={...p,id:randomUUID(),organization_id:body.p_organization,status:'draft',storage_backend:'local',created_at:new Date().toISOString(),mime_type:'application/pdf',storage_path:'companyA/'+randomUUID()+'/documento.pdf'};rows.push(r);return {...r};}
 const r=rows.find(r=>r.id===body.p_id);if(body.p_op==='withdraw'){r.status='withdrawn';return {...r};}throw Error(body.p_op);
}
async function fileRequest(){throw Error('Local documents must never use cloud Storage');}
function configure(platform=true,uid='general',orgId='companyA'){options={userId:uid,platform,orgId,organizations:[{id:'companyA',name:'Compañía A'},{id:'companyB',name:'Compañía B'}],catalog:()=>assets,request,fileRequest,navigate:name=>api.open(name==='protocolos'?'protocolo':'procedimiento')};api.configure(options);}
function setFile(file){Object.defineProperty(form.elements.file,'files',{configurable:true,value:[file]});}
function prepare(code='PR-001'){form.elements.code.value=code;form.elements.title.value='Protocolo de cambio de revestimientos';form.elements.area.value='Área Seca';form.elements.area.dispatchEvent(new w.Event('change'));form.elements.sector.value='Chancado';form.elements.sector.dispatchEvent(new w.Event('change'));form.elements.equipment.value='CHANCADOR PRIMARIO · 10027327';form.elements.equipment.dispatchEvent(new w.Event('change'));const file=new Blob(['%PDF-1.4\nDocument QA\n%%EOF'],{type:'application/pdf'});file.name='protocolo.pdf';setFile(file);}
(async()=>{
 configure();api.open('protocolo');await until(()=>q('[data-message]').textContent==='');assert.equal(w.document.querySelectorAll('.nav button').length,2);assert(!q('[data-admin]').hidden);
 assert.equal(form.elements.sector.tagName,'SELECT');form.elements.area.value='Área Húmeda';form.elements.area.dispatchEvent(new w.Event('change'));assert.deepEqual([...form.elements.sector.options].map(x=>x.value),['','AGUAS CALAMA']);form.elements.sector.value='AGUAS CALAMA';form.elements.sector.dispatchEvent(new w.Event('change'));assert.deepEqual([...form.elements.equipment.options].map(x=>x.value),['','BBA AGUA CALAMA #1 · 51 PMP001']);form.elements.equipment.value='BBA AGUA CALAMA #1 · 51 PMP001';form.elements.equipment.dispatchEvent(new w.Event('change'));assert.equal(form.elements.sap.value,'51 PMP001');q('[data-filter="area"]').value='Área Húmeda';q('[data-filter="area"]').dispatchEvent(new w.Event('change'));assert.deepEqual([...q('[data-filter="sector"]').options].map(x=>x.value),['','AGUAS CALAMA']);assert.deepEqual([...q('[data-filter="equipment"]').options].map(x=>x.value),['','BBA AGUA CALAMA #1 · 51 PMP001']);q('[data-clear]').click();
 prepare();assert.equal(form.elements.sap.value,'10027327');form.dispatchEvent(new w.Event('submit',{cancelable:true}));await until(()=>published===1&&!form.querySelector('button').disabled);assert.equal(rows[0].area,'Área Seca');assert.equal(rows[0].equipment_sap,'10027327');assert(q('.wd-list').textContent.includes('PR-001'));
 q('[data-filter="area"]').value='Área Húmeda';q('[data-filter="area"]').dispatchEvent(new w.Event('change'));assert.equal(q('.wd-list').querySelectorAll('article').length,0);q('[data-clear]').click();q('.wd-item button').click();await until(()=>w.document.querySelector('dialog iframe'));assert.equal(w.document.querySelector('dialog iframe').src,'blob:qa-1');w.document.querySelector('[data-close]').click();assert(revoked.includes('blob:qa-1'));
 corrupt=true;q('.wd-item button').click();await until(()=>q('[data-message]').textContent.includes('incompleta'));assert(!w.document.querySelector('dialog iframe'));w.document.querySelector('[data-close]').click();corrupt=false;
 failUpload=true;prepare('PR-002');form.dispatchEvent(new w.Event('submit',{cancelable:true}));await until(()=>q('[data-upload-message]').textContent.includes('Borradores'));assert.equal(published,1);assert.equal(rows.find(r=>r.code==='PR-002').status,'draft');failUpload=false;
 assert.equal(consumed,1);connected=false;q('.wd-item button').click();await until(()=>w.document.querySelector('dialog').textContent.includes('desconectado'));assert(!w.document.querySelector('dialog iframe'));w.document.querySelector('[data-close]').click();connected=true;
 configure(false,'supervisor');api.open('protocolo');await until(()=>q('[data-message]').textContent==='');assert(q('[data-admin]').hidden);assert(q('[data-status-wrap]').hidden);assert(!q('.wd-list').textContent.includes('PR-002'));assert(q('.wd-list').textContent.includes('PR-001'));
 q('[data-company]').value='companyB';q('[data-company]').dispatchEvent(new w.Event('change'));await until(()=>q('[data-message]').textContent==='');assert.equal(q('.wd-list').querySelectorAll('article').length,0);
 api.reset();assert.equal(q('.wd-list').textContent,'');assert.equal(q('[data-company]').options.length,0);w.close();console.log('PASS: local binary chunks and verified read consumption, no Storage access, offline server message, catalog/SAP, filters, interrupted draft, supervisor access and account cleanup');
})().catch(e=>{w.close();console.error(e);process.exitCode=1});
