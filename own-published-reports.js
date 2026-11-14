/* Own published reports remain discoverable alongside personal investigations. Read-only. */
(function(root){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function owned(rows,user){return (Array.isArray(rows)?rows:[]).filter(r=>r.owner_id===user&&r.id&&r.organization_id)}
function mount(api){
 const panel=document.createElement('section');panel.className='card own-published-reports';panel.setAttribute('aria-label','Mis informes publicados en compañías');
 document.getElementById('investigationsWorkspace').append(panel);
 const dialog=document.createElement('dialog');dialog.className='own-published-dialog';dialog.setAttribute('aria-label','Informe publicado');document.body.append(dialog);
 const style=document.createElement('style');style.textContent=`.own-published-reports{grid-column:1/-1;min-width:0}.own-published-reports .own-report-row{padding:15px;border:1px solid #376b85;border-radius:10px;background:#0b2b40;margin-top:12px;display:flex;gap:14px;justify-content:space-between;align-items:center;flex-wrap:wrap}.own-report-row>div{flex:1 1 250px;min-width:0;overflow-wrap:anywhere}.own-report-row h3{margin:0 0 7px;font-size:15px}.own-report-row p{margin:5px 0}.own-report-row button{min-height:44px}.own-published-dialog{color:#eaf4fa;background:#0b2538;border:1px solid #5489a2;border-radius:14px;width:min(1150px,96vw);max-width:96vw;max-height:92dvh;padding:18px}.own-published-dialog::backdrop{background:#020c16b8}.own-published-dialog .own-report-tools{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px}.own-report-tools button,.own-report-tools select{min-height:44px}.own-report-document{overflow:auto;max-height:72dvh;background:white;color:#142333;padding:15px;border-radius:8px}.own-report-document .preview{margin:auto;box-shadow:none}.own-published-reports .own-report-error{color:#ffbdc5;overflow-wrap:anywhere}@media(max-width:600px){.own-report-row button{width:100%}.own-published-dialog{padding:12px}.own-report-document{padding:8px}.own-report-tools select{font-size:16px}}@media print{.own-published-reports,.own-published-dialog{display:none!important}}`;document.head.append(style);
 let generation=0,rows=[],owner='',loading=false,failure='',loaded=false,viewGeneration=0;
 function valid(uid,gen){return api.userId()===uid&&generation===gen}
 function close(){viewGeneration++;dialog.close();dialog.replaceChildren()}
 function reset(){generation++;owner='';rows=[];loading=false;failure='';loaded=false;close();render()}
 function render(){
  panel.innerHTML='<div class="between" style="gap:12px;flex-wrap:wrap"><h2>Mis informes publicados en compañías</h2><button type="button" class="secondary" data-own-refresh>Actualizar publicados</button></div><p class="help">Estos informes se conservan en la compañía y pueden no estar en tu lista personal. Aquí puedes consultar los que publicaste con tu cuenta.</p>'+(loading?'<p role="status">Buscando tus informes publicados…</p>':failure?'<p role="status" class="own-report-error">'+esc(failure)+'</p>':!loaded?'':rows.length?rows.map(r=>'<article class="own-report-row"><div><h3>'+esc(r.equipment||'Equipo sin definir')+' · '+esc(r.title||'Investigación sin título')+'</h3><p class="small">'+esc(r.area||'Área sin clasificar')+(r.sector||r.productionUnit?' · '+esc(r.sector||r.productionUnit):'')+'</p><p class="small">'+esc(api.companyName(r.organization_id)||'Informe de compañía')+' · Informe publicado</p></div><button class="secondary" type="button" data-own-view="'+esc(r.id)+'">Ver informe publicado</button></article>').join(''):'<p class="muted">No tienes informes publicados disponibles en compañías.</p>');
  panel.querySelector('[data-own-refresh]').onclick=()=>refresh(true);
  panel.querySelectorAll('[data-own-view]').forEach(b=>b.onclick=()=>show(b.dataset.ownView));
 }
 async function refresh(force=false){
  const uid=api.userId();if(!uid){reset();return}
  if(owner===uid&&(loading||loaded&&!force))return;
  const gen=++generation;owner=uid;rows=[];failure='';loading=true;loaded=false;render();
  try{
   let found=[];
   for(let offset=0;offset<100000;offset+=500){
    const batch=await api.request('/rest/v1/acr_corporate_investigations?select=id,organization_id,owner_id,local_case_id,title,equipment,area:payload->>area,sector:payload->>sector,productionUnit:payload->>productionUnit&owner_id=eq.'+encodeURIComponent(uid)+'&order=updated_at.desc,id.asc&limit=500&offset='+offset);
    if(!valid(uid,gen))return;if(!Array.isArray(batch))throw Error('No se recibió una lista válida de informes.');found.push(...owned(batch,uid));
    if(batch.length<500){rows=found;loaded=true;break}
    if(offset===99500)throw Error('Hay demasiados informes para esta consulta. Solicita una exportación completa.');
   }
  }catch(e){if(valid(uid,gen))failure='No se pudo consultar tus informes publicados: '+e.message}
  finally{if(valid(uid,gen)){loading=false;render()}}
 }
 async function show(id){
  const uid=api.userId(),gen=generation,view=++viewGeneration;if(owner!==uid||!rows.some(r=>r.id===id))return;
  dialog.innerHTML='<div class="own-report-tools"><strong>Informe publicado · Solo lectura</strong><button class="secondary" type="button" data-own-close>Cerrar</button></div><p role="status">Cargando informe…</p>';
  dialog.querySelector('[data-own-close]').onclick=close;if(!dialog.open)dialog.showModal();
  try{
   const result=await api.request('/rest/v1/acr_corporate_investigations?select=id,organization_id,owner_id,local_case_id,title,equipment,payload&owner_id=eq.'+encodeURIComponent(uid)+'&id=eq.'+encodeURIComponent(id)+'&limit=1');
   if(!valid(uid,gen)||view!==viewGeneration)return;
   const record=owned(result,uid).find(r=>r.id===id);if(!record?.payload)throw Error('El informe ya no está disponible para tu cuenta.');
   const orgs=await api.request('/rest/v1/acr_organizations?select=id,name,logo_data&id=eq.'+encodeURIComponent(record.organization_id)+'&limit=1');
   const hydrated=api.hydrate?await api.hydrate([record]):[record];
   if(!valid(uid,gen)||view!==viewGeneration)return;
   const source=hydrated[0];if(!source||source.owner_id!==uid||source.id!==id)throw Error('No se pudo verificar el informe.');
   const brand=(Array.isArray(orgs)?orgs:[]).find(o=>o.id===record.organization_id)||{};
   dialog.innerHTML='<div class="own-report-tools"><strong>Informe publicado · Solo lectura</strong><label>Formato <select aria-label="Formato del informe publicado"><option value="5why">5 Porqués</option><option value="a3">A3 ejecutivo</option><option value="acr">ACR completo</option></select></label><button class="secondary" type="button" data-own-close>Cerrar</button></div><div class="own-report-document"><div data-own-document></div></div>';
   dialog.querySelector('[data-own-close]').onclick=close;const select=dialog.querySelector('select');select.value=['5why','a3','acr'].includes(record.payload.reportFormat||record.payload.format)?record.payload.reportFormat||record.payload.format:'5why';
   const draw=()=>{if(valid(uid,gen)&&view===viewGeneration)api.render(source,dialog.querySelector('[data-own-document]'),select.value,brand)};select.onchange=draw;draw();
  }catch(e){if(valid(uid,gen)&&view===viewGeneration){const p=dialog.querySelector('[role=status]')||document.createElement('p');p.setAttribute('role','status');p.textContent='No se pudo abrir el informe: '+e.message;if(!p.parentNode)dialog.append(p)}}
 }
 dialog.addEventListener('cancel',()=>{viewGeneration++});render();return {refresh,reset};
}
root.ACROwnPublishedReports={mount};
if(typeof module!=='undefined'&&module.exports)module.exports={owned,mount};
})(typeof window==='undefined'?globalThis:window);
