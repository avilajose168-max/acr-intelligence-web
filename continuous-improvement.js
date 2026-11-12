/* ACR Integrity: follow-up, recurrence, handover and technical learning. */
(function(root){
'use strict';
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const day=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
function fingerprint(c){const value=JSON.stringify([c.id,c.reportOrganizationId,c.title,c.equipment,c.area,c.datetime,c.stopStart,c.stopEnd,c.failureType,c.safetyCondition,c.safetyDescription,c.safetyAction,c.safetyPhotos,c.description,c.basicCause,c.causeConsequence,c.conclusion,c.whys,c.appliedCorrectiveActions,(c.actions||[]).map(a=>[a.description,a.owner,a.due]),(c.photos||[]).map(p=>[p.caption,p.data])]);let a=2166136261,b=5381;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b,33)^value.charCodeAt(i)}return (a>>>0).toString(16)+':'+(b>>>0).toString(16)}
function actionKey(a,index){return String(index)+':'+norm(a.description)}
function latest(events,kind,key=''){return events.filter(e=>e.kind===kind&&e.action_key===key).at(-1)}
function hours(c){const a=new Date(c.stopStart),b=new Date(c.stopEnd);if(c.stopStart&&c.stopEnd&&Number.isFinite(+a)&&+b>=+a)return (+b-+a)/3600000;const n=Number(String(c.downtime||'').replace(',','.'));return Number.isFinite(n)&&n>0?n:0}
function similar(c,rows){const equipment=norm(c.equipment),words=new Set(norm([c.title,c.description,c.basicCause].join(' ')).split(' ').filter(w=>w.length>4));return rows.filter(r=>r.c!==c&&r.c.id!==c.id&&(r.c.reportOrganizationId||'')===(c.reportOrganizationId||'')).map(r=>({...r,score:(equipment&&equipment===norm(r.c.equipment)?10:0)+[...new Set(norm([r.c.title,r.c.description,r.c.basicCause].join(' ')).split(' '))].filter(w=>words.has(w)).length})).filter(r=>r.score>=2).sort((a,b)=>b.score-a.score).slice(0,8)}
function inRange(c,from,to){const d=String(c.datetime||c.stopStart||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(d)&&d>=from&&d<=to}
function activeReview(c,events){const e=latest(events,'review');return e&&e.data.version===fingerprint(c)&&(!c.reviewRequest||e.data.requestId===c.reviewRequest.id)?e:null}
function executionState(c,a,index,events){const e=latest(events,'execution',actionKey(a,index)),v=latest(events,'effectiveness',actionKey(a,index));return {execution:e,verification:v&&e&&v.data.executionId===String(e.id)?v:null}}
const verifiedReviews=new WeakMap();
function reviewFor(c){const e=verifiedReviews.get(c);return e&&activeReview(c,[e])?e:null}
async function loadCaseReview(c,request,userId){
 verifiedReviews.delete(c);if(!c.reportOrganizationId)return;
 const pubs=await request('/rest/v1/acr_corporate_investigations?select=id&organization_id=eq.'+encodeURIComponent(c.reportOrganizationId)+'&owner_id=eq.'+encodeURIComponent(userId)+'&local_case_id=eq.'+encodeURIComponent(c.id)+'&limit=1');
 if(!pubs.length)return;
 const events=await request('/rest/v1/acr_followup_events?select=*&investigation_id=eq.'+encodeURIComponent(pubs[0].id)+'&kind=eq.review&order=id.asc');
 const e=activeReview(c,events);if(e)verifiedReviews.set(c,e);
}
async function hydrateCorporate(pubs,request){
 if(!pubs.length)return pubs;
 const org=pubs[0].organization_id;if(!org)return pubs;
 let events=[];
 for(let offset=0;offset<100000;offset+=500){
  const batch=await request('/rest/v1/acr_followup_events?select=*,acr_corporate_investigations!inner(organization_id)&acr_corporate_investigations.organization_id=eq.'+encodeURIComponent(org)+'&order=id.asc&limit=500&offset='+offset);
  events.push(...batch);if(batch.length<500)break;
 }
 const hydrated=pubs.map(p=>({...p,payload:{...p.payload,actions:(p.payload?.actions||[]).map((a,i)=>{
  const state=executionState(p.payload,a,i,events.filter(e=>e.investigation_id===p.id));
  return state.execution?{...a,status:'Completado',executionSummary:state.verification?'Efectividad: '+state.verification.data.result:'Ejecutada · efectividad pendiente'}:a;
 })}}));
 hydrated.forEach(p=>{const e=activeReview(p.payload,events.filter(e=>e.investigation_id===p.id));if(e)verifiedReviews.set(p.payload,e)});return hydrated;
}

function followupType(c){return {electrica:'Eléctrica',mecanica:'Mecánica',operacional:'Operacional'}[norm(c.failureType)]||'Sin clasificar'}
function followupSector(c){return String(c.area==='Área Húmeda'?c.productionUnit||c.sector||'':c.sector||c.productionUnit||'').trim()||'Sin clasificar'}
function filterFollowupRows(rows,f){return rows.filter(({c})=>(!f.area||String(c.area||'').trim()===f.area||f.area==='Sin clasificar'&&!String(c.area||'').trim())&&(!f.sector||followupSector(c)===f.sector)&&(!f.type||followupType(c)===f.type))}

function mount(api){
 let mode='auto',rows=[],events=[],scope='',scopeGeneration=0,tab='execution',focus='',busy=false,error='',loadedScope='',filters={from:day(),to:day(),query:'',area:'',sector:'',type:''};
 const el=document.createElement('section');el.id='acrImprovement';el.className='section';
 document.getElementById('mainApp').append(el);
 const nav=document.querySelector('#mainApp>.nav'),btn=document.createElement('button');btn.type='button';btn.textContent='◇ Mejora y seguimiento';btn.dataset.improvementNav='1';const workflow=nav.querySelector('[data-page="registro"]');if(workflow)nav.insertBefore(btn,workflow.previousElementSibling?.classList.contains('workspace-step-label')?workflow.previousElementSibling:workflow);else nav.append(btn);
 btn.onclick=()=>open();
 const style=document.createElement('style');style.textContent=`
 #acrImprovement{min-width:0} .ci-tabs,.ci-tools{display:flex;gap:9px;flex-wrap:wrap;margin:14px 0}.ci-tabs button[aria-selected=true]{background:#e0bd75;color:#132331}.ci-layout{display:grid;grid-template-columns:minmax(220px,.8fr) minmax(0,2fr);gap:15px}.ci-filters>.field{flex:1;min-width:190px}.ci-filters select{min-height:44px}.ci-row{border:1px solid #36566d;padding:14px;border-radius:12px;margin:10px 0;overflow-wrap:anywhere}.ci-row.active{border-color:#e0bd75}.ci-row button{min-height:44px}.ci-state{display:inline-block;border:1px solid #47718c;padding:5px 9px;border-radius:14px;font-size:12px;margin:4px}.ci-state.good{color:#8ee0b0;border-color:#348c71}.ci-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ci-evidence a{display:block;color:#f0cf89;margin:8px 0;overflow-wrap:anywhere}.ci-audit{max-height:260px;overflow:auto}.ci-audit p{border-bottom:1px solid #355369;padding-bottom:9px}.ci-quick{margin:10px 0}.ci-quick button{min-height:44px}.ci-notice{white-space:pre-wrap;overflow-wrap:anywhere}.ci-pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}.ci-file{padding:10px;border:1px dashed #527084;border-radius:10px}.ci-warning{color:#ffd99a}.ci-error{color:#ffb5bd}.ci-metrics{display:flex;gap:12px;flex-wrap:wrap}.ci-metrics strong{font-size:24px;color:#e0bd75}.ci-modal{position:fixed;inset:0;z-index:10000;background:#0009;display:grid;place-items:center;padding:16px}.ci-modal>div{background:#102337;border:1px solid #527084;border-radius:16px;padding:22px;width:min(760px,100%);max-height:85dvh;overflow:auto}@media(max-width:760px){.ci-layout,.ci-grid{grid-template-columns:1fr}.ci-tabs{display:grid;grid-template-columns:1fr 1fr}.ci-tools button,.ci-tabs button{min-height:44px}.ci-layout>.card{max-height:260px;overflow:auto}#acrImprovement h1{font-size:24px}.ci-metrics>div{flex:1;min-width:100px}}
 `;document.head.append(style);
 const shift=root.ACRShiftHandover?.mount({
 today:day,scope:scopeKey,company:isCompany,companyId:api.companyId,
 userId:api.userId,userLabel:api.userLabel,request:api.request,
 personalNotes:()=>api.personalHandovers?.()||[],savePersonal:entry=>api.savePersonalHandover(entry),
 root:()=>el,render,visible:()=>el.classList.contains('active')&&tab==='handover'&&!document.getElementById('mainApp').hidden,
 scopeLabel:()=>isCompany()?api.companyLabel():'Mis investigaciones',brand:cases=>api.handoverBrand?.(isCompany(),cases)||{name:isCompany()?api.companyLabel():'',logo:''},download:api.download,
 rewrite:value=>api.rewriteHandover(value)
 });
 const technical=root.ACRTechnicalReview?.mount({
 scope:scopeKey,userId:api.userId,userLabel:api.userLabel,isAdmin:api.isAdmin,request:api.request,
 root:()=>el,visible:()=>el.classList.contains('active')&&tab==='review'&&!document.getElementById('mainApp').hidden,
 render,fingerprint,activeReview,events:rowEvents,append,returnToCase:api.returnToCase,
 publishRequest:async(r,request)=>{await api.publishReviewRequest(r,request);r.c.reviewRequest=request;}
 });
 function isCompany(){return !!api.companyId()&&api.canCompany()&&(mode==='company'||mode==='auto'&&api.isAdmin())}
 function scopeKey(){return String(api.userId()||'')+':'+(isCompany()?api.companyId():'personal')}
 function options(){return visibleRows().map(r=>'<option value="'+E(r.key)+'"'+(r.key===focus?' selected':'')+'>'+E(r.c.equipment||'Sin equipo')+' · '+E(r.c.title||'Sin título')+'</option>').join('')}
 function currentRow(){const list=visibleRows();return list.find(r=>r.key===focus)||list[0]}
 function visibleRows(){return tab==='handover'?rows:filterFollowupRows(rows,filters)}
 function filterControls(){
  const opts=(values,value)=>'<option value="">Todos</option>'+values.map(v=>'<option value="'+E(v)+'"'+(value===v?' selected':'')+'>'+E(v)+'</option>').join('');
  const areas=[...new Set(rows.map(r=>String(r.c.area||'').trim()||'Sin clasificar'))].sort((a,b)=>a.localeCompare(b,'es'));
  const sectors=[...new Set(filterFollowupRows(rows,{area:filters.area}).map(r=>followupSector(r.c)))].sort((a,b)=>a.localeCompare(b,'es'));
  return '<div class="card"><h2>Filtrar investigaciones</h2><div class="ci-tools ci-filters"><label class="field">Área operacional<select id="ciFilterArea">'+opts(areas,filters.area)+'</select></label><label class="field">Sector del área / unidad productiva<select id="ciFilterSector">'+opts(sectors,filters.sector)+'</select></label><label class="field">Tipo de falla<select id="ciFilterType">'+opts(['Eléctrica','Mecánica','Operacional','Sin clasificar'],filters.type)+'</select></label><button class="secondary" type="button" id="ciClearFilters">Limpiar filtros</button></div><p class="help">'+visibleRows().length+' de '+rows.length+' investigaciones de este espacio. Los filtros se aplican también a las solicitudes de revisión de la compañía.</p></div>';
 }
 function rowEvents(r){return r?.pub?events.filter(e=>e.investigation_id===r.pub.id):(r?.c.followupEvents||[])}
 function eventInfo(e){return E(new Date(e.created_at).toLocaleString('es-CL'))+' · '+E(e.data.actorLabel||'Usuario')+' · ID: '+E(e.actor_id||'')}
 function field(label,name,value='',type='text'){return '<label class="field">'+label+'<input type="'+type+'" name="'+name+'" value="'+E(value)+'"'+(type==='date'?' max="'+day()+'"':'')+'></label>'}
 function area(label,name,value=''){return '<label class="field">'+label+'<textarea name="'+name+'">'+E(value)+'</textarea></label>'}
 function fileField(){return '<label class="field ci-file">Evidencia (foto o PDF, hasta 2 MB por archivo; 3 archivos)<input type="file" name="evidence" multiple accept="image/jpeg,image/png,image/webp,application/pdf"></label>'}
 function files(data){return '<div class="ci-evidence">'+(data?.files||[]).map(f=>/^(data:application\/pdf;base64,|data:image\/(jpeg|png|webp);base64,)[a-z0-9+/=]+$/i.test(f.data)?'<a download="'+E(f.name)+'" href="'+E(f.data)+'">↓ '+E(f.name)+'</a>':'').join('')+'</div>'}
 function stage(r,a,i){const s=executionState(r.c,a,i,rowEvents(r));return !s.execution?'Sin cierre con evidencia':s.verification?'Efectividad: '+s.verification.data.result:'Ejecutada · efectividad pendiente'}
 async function load(force=false){
  const next=scopeKey();if(!force&&next===loadedScope){render();return}
  technical?.clear();shift?.reset();const gen=++scopeGeneration;scope=next;filters.area='';filters.sector='';filters.type='';loadedScope='';rows=[];events=[];focus='';error='';busy=true;render();
  try{
   const uid=api.userId();if(!uid)throw Error('Inicia sesión para consultar el seguimiento.');
   if(isCompany()){
    const org=api.companyId();
    let pubs=[];for(let offset=0;offset<100000;offset+=500){const batch=await api.request('/rest/v1/acr_corporate_investigations?select=id,organization_id,owner_id,local_case_id,title,equipment,payload,updated_at&organization_id=eq.'+encodeURIComponent(org)+'&order=updated_at.desc,id.asc&limit=500&offset='+offset);if(gen!==scopeGeneration||next!==scopeKey())return;pubs.push(...batch);if(batch.length<500)break;}
    if(gen!==scopeGeneration||next!==scopeKey())return;
    rows=pubs.map(p=>({key:p.id,c:p.payload||{},pub:p}));
    // Paginate the immutable journal; avoid silently truncating the audit history.
    let all=[];
    for(let offset=0;offset<100000;offset+=500){
     const list=await api.request('/rest/v1/acr_followup_events?select=*,acr_corporate_investigations!inner(organization_id)&acr_corporate_investigations.organization_id=eq.'+encodeURIComponent(org)+'&order=id.asc&limit=500&offset='+offset);
     if(gen!==scopeGeneration||next!==scopeKey())return;all.push(...list);if(list.length<500)break;
    }
    events=all;
   }else rows=api.personalCases().map(c=>({key:c.id,c}));
   if(shift)await shift.load();if(gen!==scopeGeneration||next!==scopeKey())return;loadedScope=next;
  }catch(e){if(gen===scopeGeneration)error=e.message}
  finally{if(gen===scopeGeneration){busy=false;render()}}
 }
 async function readFiles(input){const out=[];if(input.files.length>3)throw Error('Adjunta como máximo 3 archivos por registro.');for(const f of input.files){if(f.size>2*1024*1024)throw Error('El archivo '+f.name+' supera 2 MB.');if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(f.type))throw Error('Solo se admiten fotos JPG, PNG, WEBP y documentos PDF.');const data=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=()=>reject(Error('No se pudo leer '+f.name));fr.readAsDataURL(f)});out.push({name:f.name.slice(0,180),data})}return out}
 async function append(r,kind,data,key=''){
  if(scope!==scopeKey())throw Error('Cambió el espacio de trabajo. Abre nuevamente esta sección.');
  data.actorLabel=api.userLabel();
  if(r.pub){
   const result=await api.request('/rest/v1/acr_followup_events','POST',{investigation_id:r.pub.id,kind,action_key:key,data},'return=representation');
   if(scope!==scopeKey())return;events.push(...result);if(api.afterCorporateWrite)await api.afterCorporateWrite();
  }else{
   const c=api.personalCases().find(c=>c.id===r.c.id);if(!c)throw Error('La investigación ya no está disponible.');
   const actionIndex=Number(key.split(':')[0]),action=c.actions?.[actionIndex],previousStatus=action?.status;if(kind==='execution'&&action)action.status='Completado';const previous=c.followupEvents||[];c.followupEvents=[...previous,{id:crypto.randomUUID(),kind,action_key:key,data,actor_id:api.userId(),created_at:new Date().toISOString()}];
   if(!api.persist()){c.followupEvents=previous;if(action)action.status=previousStatus;throw Error('No se pudo guardar el registro.');}
   try{await api.flush()}catch(e){throw Error('Guardado en este dispositivo; la sincronización sigue pendiente. '+e.message)}
  }
 }
 function bindForm(selector,handler){const form=el.querySelector(selector);if(!form)return;form.onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;const msg=form.querySelector('[role=status]');msg.textContent='Guardando…';try{await handler(form,new FormData(form));render()}catch(err){msg.textContent=err.message;msg.className='ci-error';button.disabled=false}}}
 function showSnapshot(r){const modal=document.createElement('div');modal.className='ci-modal';modal.innerHTML='<div role="dialog" aria-modal="true" aria-label="Antecedente"><button class="secondary" type="button">Cerrar</button><h2>'+E(r.c.title||'Investigación')+'</h2>'+['equipment','description','basicCause','appliedCorrectiveActions','conclusion'].map((k,i)=>'<h3>'+['Equipo','¿Qué ocurrió?','Causa básica','Acciones realizadas','Conclusión'][i]+'</h3><p class="ci-pre">'+E(r.c[k]||'No registrado')+'</p>').join('')+'</div>';modal.querySelector('button').onclick=()=>modal.remove();modal.onclick=e=>{if(e.target===modal)modal.remove()};modal.onkeydown=e=>{if(e.key==='Escape')modal.remove()};document.body.append(modal);modal.querySelector('button').focus()}
 function execution(r){
  if(!(r.c.actions||[]).some(a=>String(a.description||'').trim()))return '<p>Esta investigación no tiene acciones registradas.</p>';return '<p class="help">Registrar ejecución no confirma su efectividad. El historial conserva los registros anteriores.</p>'+(r.c.actions||[]).map((a,i)=>{
   if(!String(a.description||'').trim())return '';const state=executionState(r.c,a,i,rowEvents(r)),ex=state.execution,verification=state.verification;
   return '<div class="ci-row"><h3>'+E(a.description)+'</h3><p>'+E(a.owner||'Sin responsable')+' · Compromiso: '+E(a.due||'Sin fecha')+'</p><span class="ci-state">'+E(stage(r,a,i))+'</span>'+
    (ex?'<p class="ci-pre">'+E(ex.data.performed)+'<br>Ejecutada el '+E(ex.data.date)+'</p>'+files(ex.data):'')+
    '<details><summary>'+(ex?'Agregar nuevo registro de ejecución':'Registrar ejecución')+'</summary><form data-ex="'+i+'">'+field('Fecha real de ejecución','date',day(),'date')+area('Acciones realizadas','performed')+fileField()+'<p class="help">Describe la intervención y adjunta evidencia para registrar el cierre.</p><button class="primary">Registrar ejecución</button><p role="status"></p></form></details>'+
    (ex&&(!r.pub||api.isAdmin())?'<details><summary>Verificar efectividad</summary><form data-verify="'+i+'">'+field('Fecha de revisión','date',day(),'date')+'<label class="field">Resultado<select name="result"><option>Efectiva</option><option>No efectiva</option><option>En observación</option></select></label>'+area('Evidencia del resultado y seguimiento','notes')+fileField()+'<button class="primary">Guardar verificación</button><p role="status"></p></form></details>':'')+
    (verification?'<p><b>'+E(verification.data.result)+'</b> · '+E(verification.data.date)+'</p><p class="ci-pre">'+E(verification.data.notes)+'</p>'+files(verification.data):'')+'</div>';
  }).join('')||'<p>Esta investigación no tiene acciones registradas.</p>';
 }
 function review(r){if(technical)return technical.html(r);if(r.pub&&!api.isAdmin()){const e=activeReview(r.c,rowEvents(r));return '<p class="notice">'+E(e?.data.result||'Sin revisión corporativa vigente')+'</p><p class="ci-pre">'+E(e?.data.notes||'La revisión técnica corresponde al administrador autorizado de la compañía.')+'</p>'}const rev=activeReview(r.c,rowEvents(r)),old=latest(rowEvents(r),'review');return '<p class="help">La revisión queda vinculada al contenido actual. Si el análisis cambia, se requiere una nueva revisión.'+(!r.pub?' En el espacio personal es una revisión registrada por el titular, sin aprobación corporativa.':' La decisión corporativa queda registrada con tu usuario de administrador.')+'</p><span class="ci-state">'+E(rev?rev.data.result:old?'Análisis modificado · requiere revisión':'Sin revisión registrada')+'</span>'+(old?'<p class="ci-pre">'+E(old.data.notes)+'</p><p class="small">'+eventInfo(old)+'</p>':'')+'<form id="ciReviewForm">'+field('Revisor técnico / cargo','reviewer',api.userLabel())+'<label class="field">Decisión<select name="result"><option>En revisión</option><option>Solicitar ajustes</option><option>Validado</option></select></label>'+area('Observaciones y fundamento de la decisión','notes')+'<button class="primary">Guardar revisión</button><p role="status"></p></form>'}
 function lessons(){const q=norm(filters.query);const matches=visibleRows().map(r=>({r,e:latest(rowEvents(r),'lesson')})).filter(x=>x.e?.data.active&&(!q||norm([x.e.data.title,x.e.data.learning,x.r.c.equipment].join(' ')).includes(q)));return '<label class="field">Buscar lección o equipo<input id="ciLessonSearch" value="'+E(filters.query)+'" placeholder="Equipo, causa o aprendizaje"></label>'+matches.map(({r,e})=>'<article class="ci-row"><span class="ci-state '+(activeReview(r.c,rowEvents(r))?.data.result==='Validado'?'good':'')+'">'+(activeReview(r.c,rowEvents(r))?.data.result==='Validado'?'Análisis validado':activeReview(r.c,rowEvents(r))?.data.result==='Revisado por titular'?'Revisión personal registrada':'Revisión pendiente / contenido modificado')+'</span><h3>'+E(e.data.title)+'</h3><p>'+E(r.c.equipment)+'</p><p class="ci-pre">'+E(e.data.learning)+'</p><button class="secondary" data-read="'+E(r.key)+'">Consultar investigación</button><button class="secondary" data-edit-lesson="'+E(r.key)+'">Editar lección</button></article>').join('')+(matches.length?'':'<p>No hay lecciones publicadas para esta búsqueda.</p>')}
 function lessonEditor(r){if(r.pub&&!api.isAdmin())return '<p>Las lecciones corporativas se publican por un administrador autorizado.</p>';const old=latest(rowEvents(r),'lesson');return '<h3>Lección de la investigación seleccionada</h3><p class="help">Publica aprendizajes de análisis validados. La consulta queda limitada a este espacio.</p><form id="ciLessonForm">'+field('Título del aprendizaje','title',old?.data.title||'')+area('Qué aprendimos y qué aplicar en el futuro','learning',old?.data.learning||'')+'<label class="field">Visibilidad<select name="active"><option value="true"'+(old?.data.active!==false?' selected':'')+'>Publicar en lecciones</option><option value="false"'+(old?.data.active===false?' selected':'')+'>Retirar de lecciones</option></select></label><button class="primary">Guardar lección</button><p role="status"></p></form>'}
 function handover(){if(shift)return shift.html(rows.map(r=>({...r,c:{...r.c,actions:(r.c.actions||[]).map((a,i)=>executionState(r.c,a,i,rowEvents(r)).execution?{...a,status:'Completado'}:a)}})),hours);const selected=rows.filter(r=>inRange(r.c,filters.from,filters.to)),actions=selected.flatMap(r=>(r.c.actions||[]).filter(a=>String(a.description||'').trim()).map(a=>({r,a}))),pending=actions.filter(x=>x.a.status!=='Completado');return '<div class="ci-tools">'+field('Desde','from',filters.from,'date').replace(' max="'+day()+'"','')+field('Hasta','to',filters.to,'date').replace(' max="'+day()+'"','')+'<button class="primary" id="ciExportHandover">Exportar resumen HTML / PDF</button></div><p class="help">Eventos por fecha del evento (inicio de detención como alternativa). Pendientes asociados a esos eventos. No representa una fotografía histórica de sus estados.</p><div class="ci-metrics"><div>Eventos<br><strong>'+selected.length+'</strong></div><div>Horas detenidas<br><strong>'+selected.reduce((n,r)=>n+hours(r.c),0).toLocaleString('es-CL',{maximumFractionDigits:2})+' h</strong></div><div>Acciones pendientes<br><strong>'+pending.length+'</strong></div></div><div id="ciHandoverBody">'+selected.map(r=>'<article class="ci-row"><h3>'+E(r.c.equipment||'Sin equipo')+' · '+E(r.c.title||'Sin título')+'</h3><p>'+E(String(r.c.datetime||r.c.stopStart||'').replace('T',' '))+' · '+hours(r.c).toLocaleString('es-CL',{maximumFractionDigits:2})+' h</p><p class="ci-pre">'+E(r.c.description||'Sin descripción')+'</p><p><b>Acciones realizadas:</b> '+E(r.c.appliedCorrectiveActions||'No registradas')+'</p><p><b>Compromisos:</b></p><ul>'+(r.c.actions||[]).filter(a=>String(a.description||'').trim()).map(a=>'<li>'+E(a.description)+' · '+E(a.owner||'Sin responsable')+' · '+E(a.due||'Sin fecha')+' · '+E(a.status||'Pendiente')+'</li>').join('')+'</ul></article>').join('')+(selected.length?'':'<p>No hay eventos en este período.</p>')+'</div>'}
 function render(){
  if(scope!==scopeKey()){rows=[];events=[];loadedScope='';}
  const r=currentRow();if(r)focus=r.key;
  const titles={execution:'Cierre y efectividad',similar:'Fallas similares',handover:'Entrega de turno',review:'Revisión técnica',lessons:'Lecciones aprendidas'};
  el.innerHTML='<div class="card"><div class="eyebrow">ACR Integrity · Mejora y seguimiento</div><h1>'+titles[tab]+'</h1><p class="notice">'+E(isCompany()?api.companyLabel()+(api.isAdmin()?' · Informes publicados de la compañía':' · Mis informes publicados'):'Mis investigaciones · Espacio personal')+'</p><div class="ci-tabs" role="tablist">'+Object.entries(titles).map(([k,v])=>'<button class="secondary" role="tab" type="button" aria-selected="'+(k===tab)+'" data-ci-tab="'+k+'">'+v+'</button>').join('')+'</div><label class="field">Espacio<select id="ciScope"><option value="personal"'+(!isCompany()?' selected':'')+'>Mis investigaciones</option>'+((api.companyId()&&api.canCompany())?'<option value="company"'+(isCompany()?' selected':'')+'>'+E(api.companyLabel())+'</option>':'')+'</select></label><button class="secondary" id="ciRefresh" type="button">Actualizar</button><p class="ci-error" role="status">'+E(error)+'</p></div>';
  if(busy)el.innerHTML+='<div class="card">Cargando investigaciones e historial…</div>';
  else if(!error){
   if(tab!=='handover')el.innerHTML+=filterControls();
   if(tab==='handover')el.innerHTML+='<div class="card">'+handover()+'</div>';
   else if(tab==='lessons')el.innerHTML+='<div class="card">'+lessons()+'</div>'+(r?'<div class="card"><label class="field">Investigación<select id="ciCase">'+options()+'</select></label>'+lessonEditor(r)+'</div>':'');
   else if(r){
    if(tab==='review'&&technical)el.innerHTML+=technical.inbox(visibleRows(),events);
    let body='';if(tab==='execution')body=execution(r);if(tab==='review')body=review(r);
    if(tab==='similar'){const matches=similar(r.c,visibleRows());body='<p class="help">Coincidencias por equipo y palabras del evento. Son antecedentes para revisar; no confirman la causa de esta falla.</p>'+matches.map(x=>'<article class="ci-row"><h3>'+E(x.c.title||'Sin título')+'</h3><p>'+E(x.c.equipment)+' · '+E(String(x.c.datetime||'').slice(0,10))+'</p><p>'+E(x.c.basicCause||'Sin causa registrada')+'</p><button class="secondary" data-read="'+E(x.key)+'">Consultar antecedente</button></article>').join('')+(matches.length?'':'<p>No se encontraron antecedentes similares en este espacio.</p>')}
    el.innerHTML+='<div class="ci-layout"><div class="card"><label class="field">Investigación<select id="ciCase">'+options()+'</select></label><h3>'+E(r.c.title||'Sin título')+'</h3><p>'+E(r.c.equipment||'Sin equipo')+'</p><p class="help">'+E(r.c.area||'Área sin clasificar')+' · '+E(followupSector(r.c))+' · '+E(followupType(r.c))+'</p><p class="help">'+E(r.c.basicCause||'Sin causa registrada')+'</p><button class="secondary" data-read="'+E(r.key)+'">Consultar investigación</button></div><div class="card">'+body+((tab==='review'&&technical&&(r.pub||r.c.reportOrganizationId))?'':historyHtml(r))+'</div></div>';
   }else el.innerHTML+='<div class="card">No hay investigaciones que coincidan con los filtros en este espacio.</div>';
  }
  el.querySelectorAll('[data-ci-tab]').forEach(b=>b.onclick=()=>{shift?.stop();tab=b.dataset.ciTab;render()});
  el.querySelector('#ciRefresh').onclick=()=>load(true);el.querySelector('#ciScope').onchange=e=>{mode=e.target.value;void load(true)};
  [['Area','area'],['Sector','sector'],['Type','type']].forEach(([id,key])=>{const input=el.querySelector('#ciFilter'+id);if(input)input.onchange=()=>{filters[key]=input.value;if(key==='area')filters.sector='';focus='';render()}});
  const clear=el.querySelector('#ciClearFilters');if(clear)clear.onclick=()=>{filters.area='';filters.sector='';filters.type='';focus='';render()};
  const select=el.querySelector('#ciCase');if(select)select.onchange=()=>{focus=visibleRows().find(r=>r.key===select.value)?.key||'';render()};
  el.querySelectorAll('[data-read]').forEach(b=>b.onclick=()=>{const item=rows.find(r=>r.key===b.dataset.read);if(item)showSnapshot(item)});
  el.querySelectorAll('[data-edit-lesson]').forEach(b=>b.onclick=()=>{focus=b.dataset.editLesson;render();el.querySelector('#ciLessonForm')?.scrollIntoView({block:'center'})});
  const search=el.querySelector('#ciLessonSearch');if(search)search.onchange=()=>{filters.query=search.value;render()};
  ['from','to'].forEach(k=>{const input=el.querySelector('[name='+k+']');if(input)input.onchange=()=>{filters[k]=input.value;if(filters.from>filters.to){input.setCustomValidity('La fecha inicial debe ser anterior a la final.');input.reportValidity();return}input.setCustomValidity('');render()}});
  const exp=el.querySelector('#ciExportHandover');if(exp)exp.onclick=exportHandover;
  if(tab==='handover')shift?.bind();if(tab==='review'&&r&&technical){technical.bind(r);el.querySelectorAll('[data-review-select]').forEach(b=>b.onclick=()=>{focus=b.dataset.reviewSelect;render()})}
  if(r){
   el.querySelectorAll('[data-ex]').forEach(form=>bindForm('[data-ex="'+form.dataset.ex+'"]',async(f,d)=>{const i=Number(f.dataset.ex),a=r.c.actions[i],date=d.get('date'),performed=d.get('performed').trim(),files=await readFiles(f.elements.evidence);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>day()||!performed||!files.length)throw Error('Indica una fecha válida, la intervención realizada y al menos una evidencia.');await append(r,'execution',{date,performed,files},actionKey(a,i))}));
   el.querySelectorAll('[data-verify]').forEach(form=>bindForm('[data-verify="'+form.dataset.verify+'"]',async(f,d)=>{const i=Number(f.dataset.verify),a=r.c.actions[i],ex=executionState(r.c,a,i,rowEvents(r)).execution,date=d.get('date'),notes=d.get('notes').trim();if(!ex||!date||date<ex.data.date||date>day()||!notes)throw Error('La revisión debe ser posterior a la ejecución e incluir el resultado observado.');await append(r,'effectiveness',{date,result:d.get('result'),notes,files:await readFiles(f.elements.evidence),executionId:String(ex.id)},actionKey(a,i))}));
   bindForm('#ciReviewForm',async(f,d)=>{const reviewer=d.get('reviewer').trim(),notes=d.get('notes').trim(),result=d.get('result');if(!reviewer||!notes)throw Error('Indica revisor y fundamento de la decisión.');if(result==='Validado'&&(!r.c.description?.trim()||!r.c.basicCause?.trim()||!r.c.conclusion?.trim()))throw Error('Completa descripción, causa básica y conclusión antes de validar.');await append(r,'review',{reviewer,notes,result,version:fingerprint(r.c)})});
   bindForm('#ciLessonForm',async(f,d)=>{const title=d.get('title').trim(),learning=d.get('learning').trim(),active=d.get('active')==='true';if(!title||!learning)throw Error('Completa el título y el aprendizaje.');if(active&&!['Validado','Revisado por titular'].includes(activeReview(r.c,rowEvents(r))?.data.result))throw Error('Primero registra la revisión correspondiente al análisis actual en Revisión técnica.');await append(r,'lesson',{title,learning,active})});
  }
 }
 function historyHtml(r){const list=rowEvents(r).slice().reverse();const names={execution:'Ejecución',effectiveness:'Efectividad',review:'Revisión',lesson:'Lección'};return '<details style="margin-top:20px"><summary>Historial ('+list.length+')</summary><div class="ci-audit">'+list.map(e=>'<p><b>'+names[e.kind]+'</b> · '+eventInfo(e)+'<br>'+E(e.data.result||e.data.title||e.data.performed||'')+files(e.data)+'</p>').join('')+'</div></details>'}
 function exportHandover(){if(!filters.from||!filters.to||filters.from>filters.to){alert('Selecciona un intervalo válido.');return}const body=(el.querySelector('.ci-metrics')?.outerHTML||'')+(el.querySelector('#ciHandoverBody')?.innerHTML||'');api.download('ACR_Entrega_turno_'+filters.from+'_'+filters.to+'.html','<!doctype html><html lang="es"><meta charset="utf-8"><title>Entrega de turno</title><style>body{font:14px Arial;color:#132331;padding:28px;max-width:1000px;margin:auto}article{border:1px solid #b8c6cf;padding:14px;margin:12px 0;break-inside:avoid}.ci-pre{white-space:pre-wrap}button{padding:12px}@media print{button{display:none}}</style><button onclick="window.print()">Imprimir / Guardar PDF</button><h1>ACR Integrity · Entrega de turno</h1><p>'+E(isCompany()?api.companyLabel():'Mis investigaciones')+'</p><p>'+E(filters.from)+' al '+E(filters.to)+'</p><p>Estados actuales de compromisos asociados a los eventos del período.</p>'+body+'</html>','text/html;charset=utf-8')}
 function open(which=tab,caseId){if(which!=='handover')shift?.stop();if(caseId){mode='personal';filters.area='';filters.sector='';filters.type='';}tab=which;api.leave();document.querySelectorAll('.section').forEach(s=>s.classList.toggle('active',s===el));document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b===btn));document.getElementById('mainApp').dataset.workspace='mejora';document.getElementById('mainApp').dataset.companyModule='';if(scopeKey()!==loadedScope)load().then(()=>{if(caseId){focus=rows.find(r=>r.c.id===caseId)?.key||focus;render()}});else{if(!isCompany())rows=api.personalCases().map(c=>({key:c.id,c}));if(caseId)focus=rows.find(r=>r.c.id===caseId)?.key||focus;render()}window.scrollTo(0,0)}
 function quick(container,which,label,record=false){const p=document.querySelector(container);if(!p)return;const wrap=document.createElement('div');wrap.className='ci-quick noprint';const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.onclick=()=>open(which,record?api.currentId():null);wrap.append(b);p.prepend(wrap)}
 quick('#inicio','handover','◇ Entrega de turno');quick('#analisis','similar','◇ Consultar fallas similares',true);quick('#reporte','review','◇ Revisión técnica',true);quick('#commitmentsDashboard','execution','◇ Cierre con evidencia y efectividad');quick('#corporateCommitmentsPanel','execution','◇ Cierre con evidencia y efectividad');quick('#companyInvestigationsView','similar','◇ Antecedentes y revisión técnica');
 // Clear cached data as soon as the signed-in user or selected company changes.
 const observer=new MutationObserver(()=>{if(scope&&scope!==scopeKey()){technical?.clear();shift?.reset();scopeGeneration++;rows=[];events=[];loadedScope='';scope=scopeKey();if(el.classList.contains('active'))void load(true)}});observer.observe(document.getElementById('companyScopeBanner')||document.getElementById('mainApp'),{childList:true,subtree:!document.getElementById('companyScopeBanner')});
 const voiceExit=new MutationObserver(()=>{if(!el.classList.contains('active')||document.getElementById('mainApp').hidden)shift?.stop()});voiceExit.observe(el,{attributes:true,attributeFilter:['class']});voiceExit.observe(document.getElementById('mainApp'),{attributes:true,attributeFilter:['hidden','data-workspace']});document.addEventListener('visibilitychange',()=>{if(document.hidden)shift?.stop()});
 return {open,refresh:()=>load(true)};
}
root.ACRImprovement={fingerprint,reviewFor,loadCaseReview,mount,hydrateCorporate};
if(typeof module!=='undefined')module.exports={fingerprint,actionKey,latest,hours,similar,inRange,activeReview,executionState,hydrateCorporate,filterFollowupRows,followupType,followupSector};
})(typeof window==='undefined'?globalThis:window);
