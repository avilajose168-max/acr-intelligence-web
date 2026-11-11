/* Personal workspace sync. Local recovery copies remain until the server confirms a save. */
(function(root){
'use strict';
const clean=value=>({cases:Array.isArray(value?.cases)?value.cases:[],settings:value?.settings||{companyName:'',logo:''}});
const copy=value=>JSON.parse(JSON.stringify(value));
const populated=value=>value.cases.length>0||Object.values(value.settings).some(Boolean);
class WorkspaceSync{
 constructor(options){
  Object.assign(this,options);
  this.clientId=options.clientId||root.crypto.randomUUID();
  this.context=null;this.timer=null;
 }
 status(kind,message){this.onStatus?.(kind,message)}
 stop(){clearTimeout(this.timer);this.timer=null;this.context=null}
 async start(owner,key){
  this.stop();
  const pendingKey=key+'-cloud-pending-'+this.clientId;
  let saved;
  for(const candidate of [pendingKey,key]){
   try{const raw=this.storage.getItem(candidate);if(raw){saved=JSON.parse(raw);break}}catch(_){/* Keep a damaged copy untouched; try the last valid cache. */}
  }
  const workspace=clean(saved);
  const meta=saved?._cloudSync;
  const ctx={owner,key,pendingKey,revision:meta?.revision??null,dirty:meta?.dirty??populated(workspace),blocked:false,flight:null};
  this.context=ctx;
  this.apply(copy(workspace));
  await this.flush();
 }
 cache(ctx,workspace,dirty){
  const encoded=JSON.stringify({...clean(workspace),_cloudSync:{revision:ctx.revision,dirty}});
  // Write the private outbox first. Other tabs cannot overwrite an unconfirmed edit.
  if(dirty){
   this.storage.setItem(ctx.pendingKey,encoded);
   // A confirmed outbox write is sufficient even if a second cache would exceed quota.
   try{this.storage.setItem(ctx.key,encoded)}catch(_){}
  }else{
   this.storage.setItem(ctx.key,encoded);
   this.storage.removeItem(ctx.pendingKey);
  }
 }
 persist(){
  const ctx=this.context;
  if(!ctx)throw Error('No hay una cuenta activa para guardar.');
  ctx.dirty=true;
  this.cache(ctx,this.read(),true);
  this.status(ctx.blocked?'conflict':'pending',ctx.blocked?'Hay otra versión en la nube; tu copia local está conservada.':'Guardado en este equipo · pendiente de nube');
  clearTimeout(this.timer);
  this.timer=setTimeout(()=>void this.flush(),900);
 }
 async request(ctx,path,body){
  const token=await this.getToken();
  if(this.context!==ctx)throw Error('La cuenta cambió durante la sincronización.');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await this.fetch(this.url+'/rest/v1/'+path,{
    method:body===undefined?'GET':'POST',signal:controller.signal,
    headers:{apikey:this.publicKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
   });
   const data=await response.json().catch(()=>null);
   if(!response.ok){const error=Error(data?.message||'No se pudo sincronizar ('+response.status+').');error.conflict=response.status===409||data?.code==='40001';throw error}
   return data;
  }finally{clearTimeout(timeout)}
 }
 async remote(ctx){
  const rows=await this.request(ctx,'acr_personal_workspaces?select=revision,payload&owner_id=eq.'+encodeURIComponent(ctx.owner));
  if(!Array.isArray(rows))throw Error('Respuesta de sincronización inválida.');
  return rows[0]||null;
 }
 flush(){
  const ctx=this.context;
  if(!ctx||ctx.blocked)return Promise.resolve(false);
  if(ctx.flight)return ctx.flight;
  ctx.flight=this.run(ctx).finally(()=>{ctx.flight=null});
  return ctx.flight;
 }
 async run(ctx){
  try{
   if(ctx.revision===null||!ctx.dirty){
    const row=await this.remote(ctx);
    if(this.context!==ctx)return false;
    // A local edit may arrive while the read request is in flight.
    if(row){
     if(ctx.dirty&&ctx.revision!==row.revision){
      // A legacy browser copy has no known cloud base; never silently replace either copy.
      ctx.blocked=true;this.status('conflict','Existe otra versión en la nube. Tu copia de este equipo está conservada.');return false;
     }
     if(!ctx.dirty){ctx.revision=row.revision;this.apply(copy(clean(row.payload)));this.cache(ctx,this.read(),false)}
    }else if(ctx.revision===null){ctx.revision=0}
    else if(ctx.revision!==0){throw Error('La copia de nube no está disponible. Conservamos la copia de este equipo.')}
   }
   if(ctx.dirty){
    const snapshot=copy(clean(this.read()));
    const fingerprint=JSON.stringify(snapshot);
    this.status('saving','Sincronizando con la nube…');
    const row=await this.request(ctx,'rpc/acr_save_personal_workspace',{workspace_payload:snapshot,expected_revision:ctx.revision});
    if(this.context!==ctx)return false;
    if(!Number.isInteger(row?.revision)||row.revision!==ctx.revision+1)throw Error('El servidor no confirmó el guardado.');
    ctx.revision=row.revision;
    ctx.dirty=JSON.stringify(clean(this.read()))!==fingerprint;
    this.cache(ctx,this.read(),ctx.dirty);
    if(ctx.dirty){this.status('pending','Nuevos cambios pendientes de nube');clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush(),100)}
    else this.status('synced','Guardado en la nube');
   }else this.status('synced','Sincronizado con la nube');
   return true;
  }catch(error){
   if(this.context!==ctx)return false;
   if(error.conflict){ctx.blocked=true;this.status('conflict','Otro equipo guardó cambios. Tu copia local está conservada.');}
   else this.status('offline','Copia local disponible · nube pendiente: '+error.message);
   return false;
  }
 }
 async resolveKeepingBoth(){
  const ctx=this.context;if(!ctx||!ctx.blocked)return false;
  try{
   const row=await this.remote(ctx);if(this.context!==ctx)return false;
   if(!row)throw Error('No se encontró la versión de nube.');
   const local=copy(clean(this.read())),remote=copy(clean(row.payload));
   // Retain an exact recovery copy, including settings, before any merge.
   this.storage.setItem(ctx.key+'-recovery-'+Date.now()+'-'+this.clientId,JSON.stringify(local));
   const merged=copy(remote),byId=new Map(merged.cases.map(c=>[c.id,c]));
   for(const item of local.cases){
    const existing=byId.get(item.id);
    if(!existing){merged.cases.push(item);byId.set(item.id,item)}
    else if(JSON.stringify(existing)!==JSON.stringify(item)){
     merged.cases.push({...item,id:root.crypto.randomUUID(),title:(item.title||'Investigación')+' · copia de este equipo'});
    }
   }
   // Conflicting company settings remain in the recovery copy; use the cloud brand.
   for(const [key,value] of Object.entries(local.settings))if(!merged.settings[key])merged.settings[key]=value;
   this.apply(merged);ctx.revision=row.revision;ctx.blocked=false;ctx.dirty=true;
   this.cache(ctx,merged,true);
   return await this.flush();
  }catch(error){if(this.context===ctx)this.status('conflict','No se combinaron las copias: '+error.message);return false}
 }
}
if(typeof module!=='undefined'&&module.exports)module.exports={WorkspaceSync};
else root.ACRWorkspaceSync=WorkspaceSync;
})(globalThis);
