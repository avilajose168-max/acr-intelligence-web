(function(root){
 'use strict';
 const names={registration:'Registro de cuenta',login:'Inicio de sesión',membership_requested:'Solicitud de afiliación',membership_updated:'Cambio de acceso',membership_removed:'Desvinculación'};
 const roles={admin:'Administrador de compañía',member:'Usuario'};
 const states={pending:'Pendiente',approved:'Aprobado',rejected:'Rechazado'};
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=value=>value?new Date(value).toLocaleString('es-CL',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}):'Sin ingreso registrado';
 function state(value){return value?[roles[value.role]||value.role,states[value.status]||value.status,value.requested_role==='admin'?'Solicita administración':''].filter(Boolean).join(' · '):'—'}
 let config=null,api=null,panel=null,kind='users',offset=0,total=0,request=0,fingerprint='';
 const find=id=>panel.querySelector('#'+id);
 function mount(){
  if(panel)return;
  panel=document.createElement('section');panel.id='accessAuditPanel';panel.className='card';panel.hidden=true;
  panel.innerHTML=`<div class="between" style="flex-wrap:wrap"><div><div class="eyebrow">CONTROL DE ACCESOS</div><h2>Usuarios y auditoría</h2></div><button class="secondary" type="button" id="accessRefresh">↻ Actualizar registros</button></div>
   <p class="muted" id="accessScopeHelp"></p>
   <div class="toolbar" style="margin:14px 0"><button class="primary" type="button" id="accessUsers">Usuarios registrados</button><button class="secondary" type="button" id="accessEvents">Historial de accesos</button></div>
   <form id="accessFilters" class="toolbar" style="align-items:end;margin:14px 0">
    <label class="field" id="accessOrgField">Ámbito<select id="accessOrg"></select></label>
    <label class="field" style="flex:1;min-width:180px">Buscar<input id="accessSearch" maxlength="150" placeholder="Correo o nombre"></label>
    <label class="field" id="accessEventField" hidden>Movimiento<select id="accessEvent"><option value="">Todos los movimientos</option>${Object.entries(names).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label>
    <label class="field" id="accessFromField" hidden>Desde<input id="accessFrom" type="date"></label>
    <label class="field" id="accessToField" hidden>Hasta<input id="accessTo" type="date"></label>
    <button class="secondary" type="submit">Aplicar filtros</button>
   </form>
   <p class="help">Fechas y horas de Chile (America/Santiago). «Último ingreso» corresponde a una autenticación exitosa; no indica que la persona siga conectada. El historial es de solo lectura.</p>
   <p class="help" id="accessStatus" role="status" aria-live="polite"></p>
   <div class="dashboard-table-wrap"><table class="dashboard-table" style="min-width:950px;width:100%"><thead id="accessHead"></thead><tbody id="accessBody"></tbody></table></div>
   <div class="between" style="margin-top:14px;flex-wrap:wrap"><span class="help" id="accessPage"></span><div class="toolbar"><button type="button" class="secondary" id="accessPrevious">← Anterior</button><button type="button" class="secondary" id="accessNext">Siguiente →</button></div></div>
   <p class="help">Los cambios de afiliación y permisos se registran desde la activación de esta función. «Dato recuperado» identifica fechas de registro y último ingreso que ya existían; no representa un historial completo anterior.</p>`;
  document.getElementById('platformAdminPanel').after(panel);
  find('accessFilters').onsubmit=e=>{e.preventDefault();offset=0;void load()};
  find('accessRefresh').onclick=()=>void load();
  find('accessOrg').onchange=()=>{offset=0;void load()};
  find('accessUsers').onclick=()=>switchTab('users');find('accessEvents').onclick=()=>switchTab('events');
  find('accessPrevious').onclick=()=>{offset=Math.max(0,offset-50);void load()};
  find('accessNext').onclick=()=>{offset+=50;void load()};
 }
 function switchTab(value){kind=value;offset=0;
  find('accessUsers').className=kind==='users'?'primary':'secondary';find('accessEvents').className=kind==='events'?'primary':'secondary';
  ['accessEventField','accessFromField','accessToField'].forEach(id=>find(id).hidden=kind!=='events');
  find('accessSearch').placeholder=kind==='users'?'Correo o nombre':'Correo, actor o compañía';void load();
 }
 function configure(next,fetcher){mount();api=fetcher;config=next;
  const identity=JSON.stringify([next.userId,next.platform,next.allowed,next.orgId,next.organizations]);
  panel.hidden=!next.allowed;
  if(!next.allowed){request++;fingerprint='';find('accessBody').innerHTML='';find('accessStatus').textContent='';return}
  find('accessScopeHelp').textContent=next.platform?'Administración general: consulta todas las cuentas, incluidos profesionales independientes, o filtra por compañía.':'Administración de compañía: consulta únicamente los usuarios y cambios de acceso de tu empresa.';
  if(identity===fingerprint){void load();return}fingerprint=identity;request++;offset=0;
  const previous=find('accessOrg').value;
  find('accessOrg').innerHTML=(next.platform?'<option value="">Toda la plataforma</option>':'')+(next.organizations||[]).filter(o=>next.platform||o.id===next.orgId).map(o=>`<option value="${escape(o.id)}">${escape(o.name)}</option>`).join('');
  find('accessOrg').value=next.platform&&[...find('accessOrg').options].some(o=>o.value===previous)?previous:(next.platform?'':next.orgId);
  find('accessOrgField').hidden=!next.platform;
  void load();
 }
 async function load(){
  if(!config?.allowed||!api)return;
  const ticket=++request,requestedKind=kind;
  const from=find('accessFrom').value,to=find('accessTo').value;
  if(kind==='events'&&from&&to&&from>to){find('accessStatus').textContent='La fecha Desde debe ser anterior o igual a Hasta.';return}
  find('accessStatus').textContent='Cargando registros…';find('accessBody').innerHTML='';
  find('accessPrevious').disabled=true;find('accessNext').disabled=true;
  try{
   const data=await api('/rest/v1/rpc/acr_read_access_console','POST',{
    p_kind:kind,p_org:config.platform?(find('accessOrg').value||null):config.orgId,
    p_search:find('accessSearch').value.trim(),p_event:kind==='events'?find('accessEvent').value:'',
    p_from:kind==='events'?(from||null):null,p_to:kind==='events'?(to||null):null,p_offset:offset});
   if(ticket!==request||requestedKind!==kind||!config.allowed)return;
   if(!data||!Array.isArray(data.rows))throw Error('La respuesta de registros no es válida.');
   total=Number(data.total)||0;
   find('accessHead').innerHTML=kind==='users'?'<tr><th>Usuario / correo</th><th>Registro de cuenta</th><th>Último ingreso</th><th>Compañía, rol y afiliación</th></tr>':'<tr><th>Fecha y hora</th><th>Movimiento / compañía</th><th>Usuario afectado</th><th>Realizado por</th><th>Antes</th><th>Después</th></tr>';
   find('accessBody').innerHTML=data.rows.map(row=>kind==='users'?userRow(row):eventRow(row)).join('')||`<tr><td colspan="${kind==='users'?4:6}">No hay registros para estos filtros.</td></tr>`;
   find('accessStatus').textContent=total+' registro(s) encontrados.';
   find('accessPage').textContent=total?`${offset+1}–${Math.min(offset+50,total)} de ${total}`:'0 registros';
   find('accessPrevious').disabled=offset===0;find('accessNext').disabled=offset+50>=total;
  }catch(error){if(ticket!==request)return;find('accessStatus').textContent='No se pudieron cargar los registros: '+error.message;find('accessPage').textContent='';}
 }
 function userRow(row){
  const memberships=(row.memberships||[]).map(m=>`<div><strong>${escape(m.company)}</strong> · ${escape(roles[m.role]||m.role)} · ${escape(states[m.status]||m.status)}<br><span class="help">Solicitud: ${escape(date(m.affiliated_at))}${m.approved_at?' · Aprobación: '+escape(date(m.approved_at)):''}</span></div>`).join('');
  return `<tr><td><strong>${escape(row.name||row.email)}</strong><br>${escape(row.email)}<br><span class="help">${row.platform_admin?'Administrador general · ':''}${row.confirmed?'Correo confirmado':'Correo pendiente de confirmar'}</span></td><td>${escape(date(row.registered_at))}</td><td>${escape(date(row.last_sign_in_at))}</td><td>${memberships||'Sin afiliación a una compañía'}</td></tr>`;
 }
 function eventRow(row){return `<tr><td>${escape(date(row.occurred_at))}</td><td><strong>${escape(names[row.event_type]||row.event_type)}</strong><br>${escape(row.organization_name||'Cuenta de plataforma')}${row.source==='baseline'?'<br><span class="help">Dato recuperado</span>':''}</td><td>${escape(row.target_email||row.target_user_id)}</td><td>${escape(row.actor_label)}</td><td>${escape(state(row.old_state))}</td><td>${escape(state(row.new_state))}</td></tr>`}
 function reset(){request++;config=null;fingerprint='';offset=0;total=0;if(panel){panel.hidden=true;find('accessBody').innerHTML='';find('accessStatus').textContent='';find('accessPage').textContent='';find('accessSearch').value=''}}
 root.ACRAccessConsole={configure,refresh:load,reset};
 if(typeof module!=='undefined'&&module.exports)module.exports={escape,date,state,userRow,eventRow};
})(typeof window!=='undefined'?window:globalThis);
