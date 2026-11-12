/* Separate company approval requests from administrator decisions. */
(function(root){'use strict';
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function authorId(row,userId){return row.pub?.owner_id||userId}
function companyId(row){return row.pub?.organization_id||row.c.reportOrganizationId||''}
function latestDecision(events,request){return request?events.filter(e=>e.kind==='review'&&e.data.requestId===request.id&&e.data.version===request.version).at(-1):null}
function reviewerCanDecide(row,userId,isAdmin,version){const req=row.c.reviewRequest;return !!row.pub&&isAdmin&&row.pub.owner_id!==userId&&req?.reviewerId===userId&&req.version===version}
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
   (req?'<p><b>Administrador revisor:</b> '+E(req.reviewerLabel||'Administrador seleccionado')+'</p><p><b>Solicitud:</b> '+E(new Date(req.requestedAt).toLocaleString('es-CL'))+'</p><p class="ci-pre">'+E(req.message||'Sin comentario adicional')+'</p>':'')+
   (decision?'<p><b>Respuesta del administrador:</b> '+E(decision.data.result)+'</p><p class="ci-pre">'+E(decision.data.notes)+'</p><p class="small">'+E(new Date(decision.created_at).toLocaleString('es-CL'))+' · ID revisor: '+E(decision.actor_id)+'</p>':'');
  common+='<details><summary>Historial de revisiones corporativas ('+events.length+')</summary>'+events.slice().reverse().map(e=>'<p><b>'+E(e.data.result)+'</b> · '+E(new Date(e.created_at).toLocaleString('es-CL'))+' · ID revisor: '+E(e.actor_id)+'</p><p class="ci-pre">'+E(e.data.notes)+'</p>').join('')+'</details>';
  if(isAuthor){const choices=state.reviewers.filter(x=>x.id!==author);return '<h3>Solicitar aprobación del análisis</h3><p class="help">Como creador, selecciona un administrador de la compañía. Al enviar se publica la versión actual del informe para su revisión.</p>'+common+(choices.length?'<form id="trRequestForm"><label class="field">Administrador que revisará<select name="reviewer" required><option value="">Seleccionar administrador…</option>'+choices.map(x=>'<option value="'+E(x.id)+'"'+(req?.reviewerId===x.id?' selected':'')+'>'+E(x.label)+'</option>').join('')+'</select></label><label class="field">Comentario para el revisor<textarea name="message" maxlength="5000" placeholder="Indica qué debe revisar o qué ajustes realizaste."></textarea></label><button class="primary">'+(req?'Enviar nueva solicitud':'Solicitar aprobación')+'</button><p role="status"></p></form>':'<p class="notice">No hay otro administrador aprobado disponible en esta compañía para revisar tu análisis.</p>')}
  if(!req)return common+'<p>El creador todavía no ha solicitado la aprobación de este informe.</p>';
  if(!reviewerCanDecide({...r,c:{...r.c,reviewRequest:req}},api.userId(),api.isAdmin(),version))return common+'<p class="help">'+(!current?'Solicita al creador que vuelva a enviar el análisis actualizado.':'La solicitud está dirigida a otro administrador. Puedes consultar el informe.')+'</p>';
  return '<h3>Decisión del administrador revisor</h3>'+common+'<form id="trDecisionForm"><label class="field">Decisión<select name="result"><option>En revisión</option><option>Solicitar ajustes</option><option>Validado</option></select></label><label class="field">Observaciones y fundamento<textarea name="notes" required></textarea></label><button class="primary">Registrar decisión</button><p role="status"></p></form>';
 }
 function personalHtml(r){const rev=api.activeReview(r.c,api.events(r));return '<h3>Revisión personal del investigador</h3><p class="help">Esta investigación está en tu espacio personal. La revisión del titular no constituye aprobación de una compañía. Para solicitarla, crea el informe con la identidad de una compañía a la que estés afiliado y aprobado.</p><p class="notice">'+E(rev?.data.result==='Revisado por titular'?'Revisión personal registrada':'Pendiente de revisión personal')+'</p><form id="trPersonalForm"><label class="field">Observaciones de tu revisión<textarea name="notes" required></textarea></label><button class="primary">Registrar revisión personal</button><p role="status"></p></form>'}
 function bind(r){const el=api.root();const retry=el.querySelector('#trRetry');if(retry)retry.onclick=()=>{cache.delete(rowKey(r));api.render()};
  const bindForm=(selector,handler)=>{const f=el.querySelector(selector);if(!f)return;f.onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;const status=f.querySelector('[role=status]');status.textContent='Guardando…';const scope=api.scope();try{await handler(new FormData(f));if(scope===api.scope()){cache.delete(rowKey(r));api.render()}}catch(err){if(scope===api.scope()){status.textContent=err.message;button.disabled=false}}}};
  bindForm('#trRequestForm',async d=>{
   const state=cache.get(rowKey(r)),reviewer=state?.reviewers.find(x=>x.id===d.get('reviewer'));
   if(!reviewer||reviewer.id===api.userId())throw Error('Selecciona otro administrador autorizado.');
   if(!r.c.description?.trim()||!r.c.basicCause?.trim()||!r.c.conclusion?.trim()||!['Eléctrica','Mecánica','Operacional'].includes(r.c.failureType))throw Error('Completa los hechos, el tipo de falla, la causa básica y la conclusión antes de solicitar aprobación.');
   const request={id:crypto.randomUUID(),reviewerId:reviewer.id,reviewerLabel:reviewer.label,requestedBy:api.userId(),requestedAt:new Date().toISOString(),version:api.fingerprint(r.c),message:String(d.get('message')||'').trim()};
   await api.publishRequest(r,request);
  });
  bindForm('#trDecisionForm',async d=>{const state=cache.get(rowKey(r)),req=r.c.reviewRequest||state?.pub?.payload?.reviewRequest;const notes=String(d.get('notes')||'').trim();if(!notes)throw Error('Indica el fundamento de la decisión.');if(!reviewerCanDecide({...r,c:{...r.c,reviewRequest:req}},api.userId(),api.isAdmin(),api.fingerprint(r.c)))throw Error('Esta solicitud no está asignada a tu usuario o el análisis cambió.');await api.append(r,'review',{notes,result:d.get('result'),reviewer:api.userLabel(),version:api.fingerprint(r.c),requestId:req.id})});
  bindForm('#trPersonalForm',async d=>{const notes=String(d.get('notes')||'').trim();if(!notes)throw Error('Escribe las observaciones de tu revisión.');await api.append(r,'review',{notes,result:'Revisado por titular',reviewer:api.userLabel(),version:api.fingerprint(r.c)})});
 }
 function inbox(rows,events){if(!api.isAdmin())return '';const items=rows.filter(r=>r.pub&&r.c.reviewRequest).map(r=>({r,q:r.c.reviewRequest})).filter(({r,q})=>q.reviewerId===api.userId()&&authorId(r,api.userId())!==api.userId()).filter(({r,q})=>{const decision=latestDecision(events.filter(e=>e.investigation_id===r.pub.id),q);return q.version===api.fingerprint(r.c)&&!['Validado','Solicitar ajustes'].includes(decision?.data.result)});return '<div class="card"><h2>Solicitudes asignadas a ti · '+items.length+'</h2>'+items.map(({r})=>'<button type="button" class="secondary" data-review-select="'+E(r.key)+'">Revisar '+E(r.c.title||r.c.equipment||'Investigación')+'</button>').join(' ')+(items.length?'':'<p class="help">No tienes solicitudes pendientes para los informes de esta compañía.</p>')+'</div>'}
 return {html,bind,inbox,clear};
}
root.ACRTechnicalReview={mount};if(typeof module!=='undefined')module.exports={reviewerCanDecide,latestDecision,companyId,authorId};
})(typeof window==='undefined'?globalThis:window);
