/* Personal workspace sync. Local recovery copies remain until the server confirms a save. */
(function(root){
'use strict';
const clean=value=>({cases:Array.isArray(value?.cases)?value.cases:[],settings:value?.settings||{companyName:'',logo:''}});
const copy=value=>JSON.parse(JSON.stringify(value));
const populated=value=>value.cases.length>0||Object.values(value.settings).some(Boolean);
const localStorageUnavailable=error=>['QuotaExceededError','NS_ERROR_DOM_QUOTA_REACHED','SecurityError'].includes(error?.name)||[22,1014].includes(error?.code);
class IndexedDBRecovery{
 constructor(indexedDB){this.indexedDB=indexedDB;this.connection=null}
 open(){
  if(this.connection)return this.connection;
  this.connection=new Promise((resolve,reject)=>{
   let settled=false;
   const fail=error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error||Error('No se pudo abrir el respaldo local.'))};
   const timer=setTimeout(()=>fail(Error('El respaldo local no respondió.')),5000);
   let request;try{request=this.indexedDB.open('acr-workspace-recovery',1)}catch(error){fail(error);return}
   request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('copies'))request.result.createObjectStore('copies')};
   request.onerror=()=>fail(request.error);
   request.onblocked=()=>fail(Error('Cierra las pestañas antiguas de ACR Integrity para actualizar el respaldo local.'));
   request.onsuccess=()=>{
    const db=request.result;
    if(settled){db.close();return}
    settled=true;clearTimeout(timer);
    db.onversionchange=()=>{db.close();this.connection=null};resolve(db);
   };
  }).catch(error=>{this.connection=null;throw error});
  return this.connection;
 }
 async load(key,pendingKey){
  const db=await this.open();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction('copies','readonly'),store=tx.objectStore('copies');
   const pending=store.get(pendingKey),cached=store.get(key);
   tx.oncomplete=()=>resolve(pending.result||cached.result||null);
   tx.onabort=()=>reject(tx.error||Error('No se pudo leer el respaldo local.'));
   tx.onerror=()=>{};
  });
 }
 async save(key,pendingKey,encoded,dirty){
  const db=await this.open();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction('copies','readwrite'),store=tx.objectStore('copies');
   store.put(encoded,key);
   if(dirty)store.put(encoded,pendingKey);else store.delete(pendingKey);
   tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||Error('No se pudo conservar el respaldo local.'));tx.onerror=()=>{};
  });
 }
 async backup(key,encoded){
  const db=await this.open();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction('copies','readwrite');tx.objectStore('copies').put(encoded,key);
   tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||Error('No se pudo conservar el respaldo previo.'));tx.onerror=()=>{};
  });
 }
}
class WorkspaceSync{
 constructor(options){
  Object.assign(this,options);
  this.clientId=options.clientId||root.crypto.randomUUID();
  this.recoveryStore=options.recoveryStore===undefined?(root.indexedDB?new IndexedDBRecovery(root.indexedDB):null):options.recoveryStore;
  this.context=null;this.timer=null;
 }
 status(kind,message){this.onStatus?.(kind,message)}
 stop(){clearTimeout(this.timer);this.timer=null;this.context=null}
 async start(owner,key){
  this.stop();
  const pendingKey=key+'-cloud-pending-'+this.clientId;
  const ctx={owner,key,pendingKey,revision:null,dirty:false,blocked:false,flight:null,cacheFlight:null,cacheFailure:null,useRecovery:false,loading:true};
  this.context=ctx;
  let saved;
  if(this.recoveryStore){
   try{const raw=await this.recoveryStore.load(key,pendingKey);if(raw){saved=JSON.parse(raw);ctx.useRecovery=true}}catch(_){/* Keep existing records and try the browser cache. */}
  }
  if(this.context!==ctx)return;
  if(!saved)for(const candidate of [pendingKey,key]){
   try{const raw=this.storage.getItem(candidate);if(raw){saved=JSON.parse(raw);break}}catch(_){/* Keep a damaged copy untouched; try the last valid cache. */}
  }
  const workspace=clean(saved);
  const meta=saved?._cloudSync;
  ctx.revision=meta?.revision??null;ctx.dirty=meta?.dirty??populated(workspace);ctx.loading=false;
  this.apply(copy(workspace));
  await this.flush();
 }
 cache(ctx,workspace,dirty){
  const encoded=JSON.stringify({...clean(workspace),_cloudSync:{revision:ctx.revision,dirty}});
  if(ctx.useRecovery)return this.recoveryCache(ctx,encoded,dirty);
  try{
   // Write the private outbox first. Other tabs cannot overwrite an unconfirmed edit.
   if(dirty){
    this.storage.setItem(ctx.pendingKey,encoded);
    // A confirmed outbox write is sufficient even if a second cache would exceed quota.
    try{this.storage.setItem(ctx.key,encoded)}catch(_){}
   }else{
    this.storage.setItem(ctx.key,encoded);
    this.storage.removeItem(ctx.pendingKey);
   }
   ctx.cacheFailure=null;
  }catch(error){
   if(!localStorageUnavailable(error)||!this.recoveryStore)throw error;
   ctx.useRecovery=true;return this.recoveryCache(ctx,encoded,dirty);
  }
 }
 recoveryCache(ctx,encoded,dirty){
  const write=(ctx.cacheFlight||Promise.resolve()).catch(()=>{}).then(async()=>{
   await this.recoveryStore.save(ctx.key,ctx.pendingKey,encoded,dirty);
   // Remove only this account's redundant cache after the replacement transaction commits.
   try{this.storage.removeItem(ctx.key);this.storage.removeItem(ctx.pendingKey)}catch(_){}
   ctx.cacheFailure=null;
  }).catch(error=>{ctx.cacheFailure=error;throw error});
  ctx.cacheFlight=write;return write;
 }
 async retain(ctx,workspace,dirty){
  try{await this.cache(ctx,workspace,dirty);return true}catch(error){ctx.cacheFailure=error;return false}
 }
 pendingStatus(ctx){
  this.status(ctx.blocked?'conflict':'pending',ctx.blocked?'Hay otra versión en la nube; tu copia local está conservada.':'Guardado en este equipo · pendiente de nube');
 }
 persist(){
  const ctx=this.context;
  if(!ctx)throw Error('No hay una cuenta activa para guardar.');
  ctx.dirty=true;
  const cached=this.cache(ctx,this.read(),true);
  if(cached?.then){
   this.status('pending','Preparando respaldo local de mayor capacidad…');
   cached.then(()=>{if(this.context===ctx&&ctx.dirty)this.pendingStatus(ctx)},()=>{
    if(this.context===ctx)this.status('storage','No se pudo crear el respaldo local. No cierres esta pestaña; intentaremos guardar en la nube.');
   });
  }else this.pendingStatus(ctx);
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
  if(!ctx||ctx.blocked||ctx.loading)return Promise.resolve(false);
  if(ctx.flight)return ctx.flight;
  ctx.flight=this.run(ctx).finally(()=>{ctx.flight=null});
  return ctx.flight;
 }
 async run(ctx){
  try{
   // Finish ordered recovery writes before reading or acknowledging another snapshot.
   if(ctx.cacheFlight)await ctx.cacheFlight.catch(()=>{});
   if(this.context!==ctx)return false;
   let retained=true;
   if(ctx.revision===null||!ctx.dirty){
    const row=await this.remote(ctx);
    if(this.context!==ctx)return false;
    // A local edit may arrive while the read request is in flight.
    if(row){
     if(ctx.dirty&&ctx.revision!==row.revision){
      // A legacy browser copy has no known cloud base; never silently replace either copy.
      ctx.blocked=true;this.status('conflict','Existe otra versión en la nube. Tu copia de este equipo está conservada.');return false;
     }
     if(!ctx.dirty){ctx.revision=row.revision;this.apply(copy(clean(row.payload)));retained=await this.retain(ctx,this.read(),false);if(this.context!==ctx)return false}
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
    retained=await this.retain(ctx,this.read(),ctx.dirty);
    if(this.context!==ctx)return false;
    // An edit may arrive while IndexedDB commits the acknowledgement cache.
    ctx.dirty=ctx.dirty||JSON.stringify(clean(this.read()))!==fingerprint;
    if(ctx.dirty){this.status(retained?'pending':'storage',retained?'Nuevos cambios pendientes de nube':'Hay cambios sin respaldo local. No cierres esta pestaña; nube pendiente.');clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush(),100)}
    else this.status('synced',retained?'Guardado en la nube':'Guardado en la nube · respaldo local no disponible');
   }else this.status('synced',retained?'Sincronizado con la nube':'Sincronizado con la nube · respaldo local no disponible');
   return true;
  }catch(error){
   if(this.context!==ctx)return false;
   if(error.conflict){ctx.blocked=true;this.status('conflict','Otro equipo guardó cambios. Tu copia local está conservada.');}
   else if(ctx.cacheFailure)this.status('storage','Cambios solo en esta pestaña. No la cierres; no hay respaldo local ni confirmación de nube: '+error.message);
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
   const recoveryKey=ctx.key+'-recovery-'+Date.now()+'-'+this.clientId;
   try{this.storage.setItem(recoveryKey,JSON.stringify(local))}catch(error){
    if(!localStorageUnavailable(error)||!this.recoveryStore)throw error;
    await this.recoveryStore.backup(recoveryKey,JSON.stringify(local));
   }
   if(this.context!==ctx)return false;
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
   await this.retain(ctx,merged,true);
   if(this.context!==ctx)return false;
   return await this.flush();
  }catch(error){if(this.context===ctx)this.status('conflict','No se combinaron las copias: '+error.message);return false}
 }
}
if(typeof module!=='undefined'&&module.exports)module.exports={WorkspaceSync,IndexedDBRecovery};
else root.ACRWorkspaceSync=WorkspaceSync;
})(globalThis);

