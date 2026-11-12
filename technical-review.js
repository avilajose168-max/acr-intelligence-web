/* Separate company approval requests from administrator decisions. */
(function(root){'use strict';
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function authorId(row,userId){return row.pub?.owner_id||userId}
function companyId(row){return row.pub?.organization_id||row.c.reportOrganizationId||''}
function latestDecision(events,request){return request?events.filter(e=>e.kind==='review'&&e.data.requestId===request.id&&e.data.version===request.version).at(-1):null}
function reviewerCanDecide(row,userId,isAdmin,version){const req=row.c.reviewRequest;return !!row.pub&&isAdmin&&row.pub.owner_id!==userId&&!!req&&req.version===version}
function mount(api){let cache=new Map(),loading=new Map(),generation=0;
 function clear(){generation++;cache.clear();loading.clear()}
 function rowKey(r){return api.scope()+':'+companyId(r)+':'+r.key}
 async function ensure(r,force=false){const k=rowKey(r);if(loading.has(k))return;if(cache.has(k)&&!force)return;const gen=generation,scope=api.scope();loading.set(k,true);try{
  const org=companyId(r);if(!org)return;
  const reviewers=await api.request('/rest/v1/rpc/acr_company_reviewers','POST',{p_org:org});
  let pub=r.pub;if(!pub){const list=await api.request('/rest/v1/acr_corporate_investigations?select=id,organization_id,owner_id,local_case_id,payload,updated_at&organization_id=eq.'+encodeURIComponent(org)+'&owner_id=eq.'+encodeURIComponent(api.userId())+'&local_case_id=eq.'+encodeURIComponent(r.c.id)+'&limit=1');pub=list[0]}
  const events=pub?await api.request('/rest/v1/acr_followup_events?select=*&investigation_id=eq.'+encodeURIComponent(pub.id)+'&kind=eq.review&order=id.asc'):[];
  if(gen!==generation||scope!==api.scope())return;cache.set(k,{reviewers:Array.isArray(reviewers)?reviewers:[],pub,events});
 }catch(e){if(gen===generation&&scope===api.scope())cache.set(k,{error:e.message})}finally{loading.delete(k);if(gen===generation&&scope===api.scope()&&api.visible())api.render()}}
 function html(r){
  const org=companyId(r);if(!org)return personalHtml(r);
  const state=cache.get(rowKey(r));if(!state){void ensure(r);return '<p role="status">Cargando administradores autorizados y estado de aprobación…</p>'}
  if(state.error)return '<p class="notice">No se pudo consultar la revisión: '+E(state.error)+'</p><button type="button" class="secondary" id="trRetry">Volver a consultar</button>';
  const req=r.c.reviewRequest||state.pub?.payload?.reviewRequest,events=state.events,version=api.fingerprint(r.c),decision=latestDecision(events,req),author=authorId(r,api.userId()),isAuthor=author===api.userId(),current=req?.version===version;
  const status=!req?'Sin solicitud de aprobación':!current?'Análisis modificado · requiere nueva solicitud':decision?.data.result||'Aprobación solicitada · pendiente de revisión';
  let common='<p class="notice"><b>'+E(status)+'</b></p><p><b>Tipo de falla:</b> '+E(r.c.failureType||'Por clasificar')+'</p>'+
   (req?'<p><b>Solicitud a la compañía:</b> '+E(new Date(req.requestedAt).toLocaleString('es-CL'))+'</p><p class="ci-pre">'+E(req.message||'Sin comentario adicional')+'</p>':'')+
   (decision?'<p><b>Respuesta del administrador:</b> '+E(decision.data.result)+'</p><p><b>Revisado por:</b> '+E(decision.data.reviewer||'Administrador')+'</p><p class="ci-pre">'+E(decision.data.notes)+'</p><p class="small">'+E(new Date(decision.created_at).toLocaleString('es-CL'))+' · ID revisor: '+E(decision.actor_id)+'</p>':'');
  common+='<details><summary>Historial de revisiones corporativas ('+events.length+')</summary>'+events.slice().reverse().map(e=>'<p><b>'+E(e.data.result)+'</b> · '+E(new Date(e.created_at).toLocaleString('es-CL'))+' · ID revisor: '+E(e.actor_id)+'</p><p class="ci-pre">'+E(e.data.notes)+'</p>').join('')+'</details>';
  if(isAuthor)return '<h3>Solicitar revisión técnica</h3><p class="help">Envía el análisis a la bandeja de la compañía. Sus administradores podrán encontrarlo por área, sector y tipo de falla.</p>'+common+'<form id="trRequestForm"><label class="field">Comentario para la revisión<textarea name="message" maxlength="5000"></textarea></label><button class="primary">'+(req?'Enviar nueva solicitud':'Solicitar revisión')+'</button><p role="status"></p></form>';
  if(!req)return common+'<p>El creador todavía no ha solicitado la aprobación de este informe.</p>';
  if(!reviewerCanDecide({...r,c:{...r.c,reviewRequest:req}},api.userId(),api.isAdmin(),version))return common+'<p class="help">'+(!current?'Solicita al creador que vuelva a enviar el análisis actualizado.':'Solo otro administrador autorizado de esta compañía puede registrar la revisión.')+'</p>';
  return '<h3>Decisión del administrador revisor</h3>'+common+'<form id="trDecisionForm"><label class="field">Decisión<select name="result"><option>En revisión</option><option>Solicitar ajustes</option><option>Validado</option></select></label><label class="field">Observaciones y fundamento<textarea name="notes" required></textarea></label><button class="primary">Registrar decisión</button><p role="status"></p></form>';
 }
 function personalHtml(r){const rev=api.activeReview(r.c,api.events(r));return '<h3>Revisión personal del investigador</h3><p class="help">Esta investigación está en tu espacio personal. La revisión del titular no constituye aprobación de una compañía. Para solicitarla, crea el informe con la identidad de una compañía a la que estés afiliado y aprobado.</p><p class="notice">'+E(rev?.data.result==='Revisado por titular'?'Revisión personal registrada':'Pendiente de revisión personal')+'</p><form id="trPersonalForm"><label class="field">Observaciones de tu revisión<textarea name="notes" required></textarea></label><button class="primary">Registrar revisión personal</button><p role="status"></p></form>'}
 function bind(r){const el=api.root();const retry=el.querySelector('#trRetry');if(retry)retry.onclick=()=>{cache.delete(rowKey(r));api.render()};
  const bindForm=(selector,handler)=>{const f=el.querySelector(selector);if(!f)return;f.onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;const status=f.querySelector('[role=status]');status.textContent='Guardando…';const scope=api.scope();try{await handler(new FormData(f));if(scope===api.scope()){cache.delete(rowKey(r));api.render()}}catch(err){if(scope===api.scope()){status.textContent=err.message;button.disabled=false}}}};
  bindForm('#trRequestForm',async d=>{
   if(!r.c.description?.trim()||!r.c.basicCause?.trim()||!r.c.conclusion?.trim()||!['Eléctrica','Mecánica','Operacional'].includes(r.c.failureType))throw Error('Completa los hechos, el tipo de falla, la causa básica y la conclusión antes de solicitar aprobación.');
   const request={id:crypto.randomUUID(),requestedBy:api.userId(),requestedAt:new Date().toISOString(),version:api.fingerprint(r.c),message:String(d.get('message')||'').trim()};
   await api.publishRequest(r,request);
  });
  bindForm('#trDecisionForm',async d=>{const state=cache.get(rowKey(r)),req=r.c.reviewRequest||state?.pub?.payload?.reviewRequest;const notes=String(d.get('notes')||'').trim();if(!notes)throw Error('Indica el fundamento de la decisión.');if(!reviewerCanDecide({...r,c:{...r.c,reviewRequest:req}},api.userId(),api.isAdmin(),api.fingerprint(r.c)))throw Error('Debes ser otro administrador autorizado y el análisis debe estar vigente.');await api.append(r,'review',{notes,result:d.get('result'),reviewer:api.userLabel(),version:api.fingerprint(r.c),requestId:req.id})});
  bindForm('#trPersonalForm',async d=>{const notes=String(d.get('notes')||'').trim();if(!notes)throw Error('Escribe las observaciones de tu revisión.');await api.append(r,'review',{notes,result:'Revisado por titular',reviewer:api.userLabel(),version:api.fingerprint(r.c)})});
 }
 function inbox(rows,events){if(!api.isAdmin())return '';const items=rows.filter(r=>r.pub&&r.c.reviewRequest).map(r=>({r,q:r.c.reviewRequest})).filter(({r,q})=>{const decision=latestDecision(events.filter(e=>e.investigation_id===r.pub.id),q);return q.version===api.fingerprint(r.c)&&!['Validado','Solicitar ajustes'].includes(decision?.data.result)});
 const groups=new Map();items.forEach(({r})=>{const label=[r.c.area||'Área sin clasificar',(r.c.area==='Área Húmeda'?r.c.productionUnit:r.c.sector)||'Sector sin clasificar',r.c.failureType||'Tipo sin clasificar'].join(' · ');groups.set(label,(groups.get(label)||0)+1)});
 return '<div class="card"><h2>Solicitudes de revisión pendientes · '+items.length+'</h2>'+[...groups].map(([label,n])=>'<p><b>'+E(label)+'</b> · '+n+' solicitud(es)</p>').join('')+items.map(({r})=>'<button type="button" class="secondary" data-review-select="'+E(r.key)+'">Revisar '+E(r.c.title||r.c.equipment||'Investigación')+'</button>').join(' ')+(items.length?'':'<p class="help">No hay solicitudes pendientes para los filtros seleccionados.</p>')+'</div>'}

 return {html,bind,inbox,clear};
}
root.ACRTechnicalReview={mount};if(typeof module!=='undefined')module.exports={reviewerCanDecide,latestDecision,companyId,authorId};
})(typeof window==='undefined'?globalThis:window);
