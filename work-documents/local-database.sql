begin;
alter table public.acr_work_documents add column storage_backend text not null default 'cloud' check(storage_backend in ('cloud','local')),add column local_saved_at timestamptz,add column local_read_at timestamptz;
alter table public.acr_work_documents alter column storage_backend set default 'local';
alter table acr_connector_private.settings add column document_worker_seen timestamptz;
create table acr_connector_private.work_files(
 document_id uuid primary key references public.acr_work_documents(id) on delete cascade,organization_id uuid not null,
 relative_path text not null unique,upload_bytes bytea,upload_started_at timestamptz,uploaded_by uuid references auth.users(id),
 check(octet_length(upload_bytes)<=10485760)
);
create table acr_connector_private.work_jobs(
 id uuid primary key default gen_random_uuid(),document_id uuid not null references acr_connector_private.work_files(document_id) on delete cascade,
 organization_id uuid not null,kind text not null check(kind in ('work_write','work_read')),state text not null default 'queued' check(state in ('queued','leased','verified','error','expired','consumed')),
 requested_by uuid not null references auth.users(id),created_at timestamptz not null default now(),lease_id uuid,lease_until timestamptz,attempts integer not null default 0,
 received bytea not null default ''::bytea,verified_at timestamptz,error_message text,check(octet_length(received)<=10485760)
);
create index acr_work_jobs_queue on acr_connector_private.work_jobs(organization_id,state,created_at);
create index acr_work_jobs_requestor on acr_connector_private.work_jobs(document_id,requested_by,kind,created_at desc);
create unique index acr_work_one_pending_write on acr_connector_private.work_jobs(document_id) where kind='work_write' and state in ('queued','leased');
alter table acr_connector_private.work_files enable row level security;
alter table acr_connector_private.work_jobs enable row level security;
create policy "No direct client access" on acr_connector_private.work_files for all to anon,authenticated using(false) with check(false);
create policy "No direct client access" on acr_connector_private.work_jobs for all to anon,authenticated using(false) with check(false);
revoke all on acr_connector_private.work_files,acr_connector_private.work_jobs from public,anon,authenticated,service_role;

create function acr_connector_private.work_doc_readable(did uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and acr_private.has_platform_access(auth.uid()) and exists(select 1 from public.acr_work_documents d join public.acr_organizations o on o.id=d.organization_id and o.active where d.id=did and (acr_private.is_platform_admin(auth.uid()) or d.status='published' and acr_private.is_approved_member(d.organization_id,auth.uid())))
$$;
create function acr_connector_private.work_doc_activate(did uuid) returns void language plpgsql security definer set search_path='' as $$
declare d public.acr_work_documents;
begin
 select * into d from public.acr_work_documents where id=did;
 if not found or d.local_saved_at is null then raise exception 'El archivo aún no se ha guardado y verificado en el servidor de la empresa.';end if;
 perform pg_advisory_xact_lock(hashtextextended(d.organization_id::text||d.category||d.code,0));
 update public.acr_work_documents set status='withdrawn' where organization_id=d.organization_id and category=d.category and code=d.code and status='published' and id<>did;
 update public.acr_work_documents set status='published',published_at=now() where id=did;
end $$;
create function acr_connector_private.work_document_gc(oid uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin
 update acr_connector_private.work_jobs set state='expired',received=''::bytea,error_message='La transferencia venció. Solicita una nueva lectura o vuelve a seleccionar el archivo original.' where (oid is null or organization_id=oid) and state in ('queued','leased') and created_at<now()-interval '24 hours';
 update acr_connector_private.work_jobs set state='expired',received=''::bytea,error_message='La lectura temporal venció. Vuelve a abrir el documento desde el servidor.' where (oid is null or organization_id=oid) and kind='work_read' and state='verified' and verified_at<now()-interval '15 minutes';
 update acr_connector_private.work_files set upload_bytes=null where (oid is null or organization_id=oid) and upload_bytes is not null and upload_started_at<now()-interval '24 hours';
end $$;

create function acr_connector_private.work_document_api(op text,did uuid default null,oid uuid default null,jid uuid default null,off integer default 0,block text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.acr_work_documents;f acr_connector_private.work_files;j acr_connector_private.work_jobs;s acr_connector_private.settings;raw bytea;uid uuid:=auth.uid();newid uuid;
begin
 if uid is null or not acr_private.has_platform_access(uid) then raise exception 'Acceso no autorizado.' using errcode='42501';end if;
 if op='status' then
  if not exists(select 1 from public.acr_organizations o where o.id=oid and o.active and (acr_private.is_platform_admin(uid) or acr_private.is_approved_member(oid,uid))) then raise exception 'No puedes consultar esta compañía.' using errcode='42501';end if;
  perform acr_connector_private.work_document_gc(oid);
  select * into s from acr_connector_private.settings where organization_id=oid;
  return jsonb_build_object('configured',s.organization_id is not null,'connected',coalesce(s.document_worker_seen>now()-interval '90 seconds' and s.token_hash is not null and s.token_expires_at>now(),false),'last_seen_at',s.document_worker_seen,'version',3);
 end if;
 select * into d from public.acr_work_documents where id=did;
 if not found or not acr_connector_private.work_doc_readable(did) then raise exception 'No puedes consultar este documento.' using errcode='42501';end if;
 if d.storage_backend<>'local' then raise exception 'Este documento todavía no está enlazado al servidor local.';end if;
 perform acr_connector_private.work_document_gc(d.organization_id);
 if op in ('begin_upload','append_upload','queue_upload') then
  if not acr_private.is_platform_admin(uid) then raise exception 'Solo el administrador general puede enviar documentos al servidor.' using errcode='42501';end if;
  if op='begin_upload' then
   if d.local_saved_at is not null or d.status<>'draft' then raise exception 'El archivo verificado se conserva. Carga una nueva versión para cambiar su contenido.';end if;
   if not exists(select 1 from acr_connector_private.settings where organization_id=d.organization_id and document_worker_seen>now()-interval '90 seconds' and token_hash is not null and token_expires_at>now()) then raise exception 'Inicia el conector versión 3 de esta compañía antes de enviar archivos.';end if;
   if exists(select 1 from acr_connector_private.work_jobs where document_id=did and kind='work_write' and state in ('queued','leased')) then raise exception 'Este documento ya tiene un envío pendiente.';end if;
   insert into acr_connector_private.work_files(document_id,organization_id,relative_path,upload_bytes,upload_started_at,uploaded_by)
   values(d.id,d.organization_id,'ACR_Documentos/'||case d.category when 'protocolo' then 'Protocolos' else 'Procedimientos' end||'/'||to_char(d.created_at at time zone 'America/Santiago','YYYY/MM')||'/'||d.id::text||'/'||d.sha256||'/documento.'||split_part(d.storage_path,'.',2),''::bytea,now(),uid)
   on conflict(document_id) do update set upload_bytes=''::bytea,upload_started_at=now(),uploaded_by=uid;
   return jsonb_build_object('ready',true);
  end if;
  select * into f from acr_connector_private.work_files where document_id=did for update;
  if not found or f.upload_bytes is null or f.uploaded_by<>uid then raise exception 'Inicia nuevamente el envío del archivo original.';end if;
  if exists(select 1 from acr_connector_private.work_jobs where document_id=did and kind='work_write' and state in ('queued','leased')) then raise exception 'El envío ya está en la cola del servidor.';end if;
  if op='append_upload' then
   if block is null or length(block)>360000 then raise exception 'Bloque no válido.';end if;raw:=decode(block,'base64');
   if octet_length(raw)<1 or octet_length(raw)>262144 or off<0 or off+octet_length(raw)>d.byte_size then raise exception 'Bloque no válido.';end if;
   if off=octet_length(f.upload_bytes) then update acr_connector_private.work_files set upload_bytes=upload_bytes||raw where document_id=did;
   elsif off<octet_length(f.upload_bytes) and substring(f.upload_bytes from off+1 for octet_length(raw))=raw then null;
   else raise exception 'El bloque está fuera de secuencia.';end if;
   return jsonb_build_object('received',off+octet_length(raw));
  end if;
  if octet_length(f.upload_bytes)<>d.byte_size or encode(extensions.digest(f.upload_bytes,'sha256'),'hex')<>d.sha256 then raise exception 'El archivo no coincide con su tamaño y huella registrados.';end if;
  if (select count(*) from acr_connector_private.work_jobs where organization_id=d.organization_id and state in ('queued','leased'))>=100 then raise exception 'Hay demasiadas transferencias pendientes en esta compañía.';end if;
  insert into acr_connector_private.work_jobs(document_id,organization_id,kind,requested_by) values(d.id,d.organization_id,'work_write',uid) returning id into newid;
  return jsonb_build_object('id',newid,'state','queued');
 end if;
 if op='retrieve' then
  if d.local_saved_at is null then raise exception 'Este documento todavía no se ha guardado y verificado en el servidor.';end if;
  select * into j from acr_connector_private.work_jobs where document_id=did and kind='work_read' and requested_by=uid and (state in ('queued','leased') or state='verified' and verified_at>now()-interval '15 minutes') order by created_at desc,id desc limit 1;
  if not found then
   if not exists(select 1 from acr_connector_private.settings where organization_id=d.organization_id and token_hash is not null and token_expires_at>now()) then raise exception 'El administrador debe vincular nuevamente el conector de esta compañía.';end if;
   if (select count(*) from acr_connector_private.work_jobs where organization_id=d.organization_id and state in ('queued','leased'))>=100 then raise exception 'El servidor tiene demasiadas solicitudes pendientes.';end if;
   insert into acr_connector_private.work_jobs(document_id,organization_id,kind,requested_by) values(d.id,d.organization_id,'work_read',uid) returning * into j;
  end if;
  select * into s from acr_connector_private.settings where organization_id=d.organization_id;
  return jsonb_build_object('id',j.id,'state',j.state,'connected',coalesce(s.document_worker_seen>now()-interval '90 seconds' and s.token_hash is not null and s.token_expires_at>now(),false));
 end if;
 select * into j from acr_connector_private.work_jobs where id=jid and document_id=did and requested_by=uid and kind='work_read';
 if not found then raise exception 'Lectura no autorizada.' using errcode='42501';end if;
 if op='read_status' then return jsonb_build_object('id',j.id,'state',j.state,'error',j.error_message);end if;
 if op in ('read_chunk','consume') then
  if j.state<>'verified' or j.verified_at<now()-interval '15 minutes' then raise exception 'Solicita una nueva lectura desde el servidor.';end if;
  if op='consume' then update acr_connector_private.work_jobs set received=''::bytea,state='consumed' where id=j.id;return jsonb_build_object('cleared',true);end if;
  if off<0 or off>=d.byte_size or off%262144<>0 then raise exception 'Bloque no válido.';end if;
  return jsonb_build_object('data',encode(substring(j.received from off+1 for 262144),'base64'),'size',d.byte_size,'checksum',d.sha256);
 end if;
 raise exception 'Operación no permitida.';
end $$;

create function acr_connector_private.work_document_worker(cid uuid,secret text,op text,jid uuid default null,lease uuid default null,off integer default 0,block text default null,checksum text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare oid uuid;j acr_connector_private.work_jobs;d public.acr_work_documents;f acr_connector_private.work_files;raw bytea;newlease uuid;
begin
 oid:=acr_connector_private.worker(cid,secret);
 update acr_connector_private.settings set last_seen_at=now(),document_worker_seen=now() where organization_id=oid;
 perform acr_connector_private.work_document_gc(oid);
 if op='poll' then
  update acr_connector_private.work_jobs set state='error',received=''::bytea,error_message='Reintentos agotados.' where organization_id=oid and state='leased' and attempts>=5 and lease_until<now();
  select * into j from acr_connector_private.work_jobs where organization_id=oid and attempts<5 and (state='queued' or state='leased' and lease_until<now()) order by created_at,id for update skip locked limit 1;
  if not found then return jsonb_build_object('job',null);end if;
  newlease:=gen_random_uuid();update acr_connector_private.work_jobs set state='leased',lease_id=newlease,lease_until=now()+interval '10 minutes',attempts=attempts+1,received=''::bytea where id=j.id;
  select * into d from public.acr_work_documents where id=j.document_id;select * into f from acr_connector_private.work_files where document_id=j.document_id;
  return jsonb_build_object('job',jsonb_build_object('id',j.id,'lease_id',newlease,'document_id',d.id,'kind',j.kind,'relative_path',f.relative_path,'size',d.byte_size,'checksum',d.sha256));
 end if;
 select * into j from acr_connector_private.work_jobs where id=jid and organization_id=oid for update;
 if not found or j.state<>'leased' or j.lease_id is distinct from lease or j.lease_until<now() then raise exception 'La transferencia ya no está vigente.';end if;
 select * into d from public.acr_work_documents where id=j.document_id;select * into f from acr_connector_private.work_files where document_id=j.document_id;
 if j.kind='work_write' and (not acr_private.is_platform_admin(j.requested_by) or not acr_private.has_platform_access(j.requested_by)) then raise exception 'El envío ya no está autorizado.' using errcode='42501';end if;
 if j.kind='work_read' and (not acr_private.has_platform_access(j.requested_by) or not(acr_private.is_platform_admin(j.requested_by) or d.status='published' and acr_private.is_approved_member(oid,j.requested_by))) then raise exception 'La lectura ya no está autorizada.' using errcode='42501';end if;
 update acr_connector_private.work_jobs set lease_until=now()+interval '10 minutes' where id=j.id;
 if op='download' and j.kind='work_write' then
  if f.upload_bytes is null then raise exception 'El envío temporal venció; solicita nuevamente el archivo original al administrador.';end if;
  if off<0 or off>=d.byte_size or off%262144<>0 then raise exception 'Bloque no válido.';end if;
  return jsonb_build_object('data',encode(substring(f.upload_bytes from off+1 for 262144),'base64'));
 elsif op='upload' then
  if block is null or length(block)>360000 then raise exception 'Bloque no válido.';end if;raw:=decode(block,'base64');
  if octet_length(raw)<1 or octet_length(raw)>262144 or off<0 or off+octet_length(raw)>d.byte_size then raise exception 'Bloque no válido.';end if;
  if off=octet_length(j.received) then update acr_connector_private.work_jobs set received=received||raw where id=j.id;
  elsif off<octet_length(j.received) and substring(j.received from off+1 for octet_length(raw))=raw then null;
  else raise exception 'Bloque fuera de secuencia.';end if;
  return jsonb_build_object('received',off+octet_length(raw));
 elsif op='complete' then
  if octet_length(j.received)<>d.byte_size or checksum is distinct from d.sha256 or encode(extensions.digest(j.received,'sha256'),'hex')<>d.sha256 then raise exception 'La lectura del disco no coincide con el documento. No se confirmó la operación.';end if;
  update acr_connector_private.work_jobs set state='verified',verified_at=now(),received=case when kind='work_write' then ''::bytea else received end where id=j.id;
  if j.kind='work_write' then
   update public.acr_work_documents set local_saved_at=now() where id=d.id;
   update acr_connector_private.work_files set upload_bytes=null where document_id=d.id;
   if d.status='draft' then perform acr_connector_private.work_doc_activate(d.id);end if;
  else update public.acr_work_documents set local_read_at=now() where id=d.id;end if;
  return jsonb_build_object('verified',true);
 elsif op='fail' then update acr_connector_private.work_jobs set state='error',received=''::bytea,error_message=left(coalesce(block,'No se pudo acceder al archivo del servidor.'),300) where id=j.id;return jsonb_build_object('reported',true);
 end if;
 raise exception 'Operación no permitida.';
end $$;

revoke all on function acr_connector_private.work_doc_readable(uuid),acr_connector_private.work_doc_activate(uuid),acr_connector_private.work_document_gc(uuid),acr_connector_private.work_document_api(text,uuid,uuid,uuid,integer,text),acr_connector_private.work_document_worker(uuid,text,text,uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function acr_connector_private.work_document_api(text,uuid,uuid,uuid,integer,text) to authenticated;
grant execute on function acr_connector_private.work_document_worker(uuid,text,text,uuid,uuid,integer,text,text) to anon,authenticated;
create function public.acr_work_document_transfer(p_op text,p_id uuid default null,p_organization uuid default null,p_job uuid default null,p_offset integer default 0,p_data text default null) returns jsonb language sql security invoker set search_path='' as $$select acr_connector_private.work_document_api($1,$2,$3,$4,$5,$6)$$;
revoke all on function public.acr_work_document_transfer(text,uuid,uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.acr_work_document_transfer(text,uuid,uuid,uuid,integer,text) to authenticated;
create function public.acr_work_document_worker(p_connector uuid,p_token text,p_op text,p_job uuid default null,p_lease uuid default null,p_offset integer default 0,p_data text default null,p_checksum text default null) returns jsonb language sql security invoker set search_path='' as $$select acr_connector_private.work_document_worker($1,$2,$3,$4,$5,$6,$7,$8)$$;
revoke all on function public.acr_work_document_worker(uuid,text,text,uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.acr_work_document_worker(uuid,text,text,uuid,uuid,integer,text,text) to anon,authenticated;

-- Existing management RPC receives local-aware authorization below.
create or replace function acr_private.manage_work_document(op text,oid uuid default null,doc uuid default null,input jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.acr_work_documents;uid uuid:=auth.uid();key uuid:=gen_random_uuid();ext text;mime text;size integer;stored jsonb;
begin
 if uid is null or not acr_private.has_platform_access(uid) or not acr_private.is_platform_admin(uid) then raise exception 'Solo el administrador general puede cargar o gestionar estos documentos.' using errcode='42501';end if;
 if op='reserve' then
  if not exists(select 1 from public.acr_organizations where id=oid and active) then raise exception 'Selecciona una compañía activa.';end if;
  if not exists(select 1 from acr_connector_private.settings where organization_id=oid and document_worker_seen>now()-interval '90 seconds' and token_hash is not null and token_expires_at>now()) then raise exception 'Inicia el conector versión 3 de esta compañía antes de enviar archivos.';end if;
  ext:=lower(input->>'extension');mime:=case ext when 'pdf' then 'application/pdf' when 'png' then 'image/png' when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg' when 'webp' then 'image/webp' when 'doc' then 'application/msword' when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' when 'xls' then 'application/vnd.ms-excel' when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' else null end;
  if mime is null then raise exception 'Formato no admitido. Usa PDF, Word, Excel o una imagen PNG/JPG/WEBP.';end if;
  size:=(input->>'byte_size')::integer;
  if size is null or size<1 or size>10485760 then raise exception 'El archivo debe tener contenido y no superar 10 MB.';end if;
  insert into public.acr_work_documents(id,organization_id,category,code,title,revision,plant,area,sector,equipment,equipment_sap,description,original_name,storage_path,mime_type,byte_size,sha256,created_by)
  values(key,oid,input->>'category',upper(btrim(input->>'code')),btrim(input->>'title'),btrim(input->>'revision'),btrim(coalesce(input->>'plant','')),input->>'area',btrim(coalesce(input->>'sector','')),btrim(coalesce(input->>'equipment','')),btrim(coalesce(input->>'equipment_sap','')),btrim(coalesce(input->>'description','')),input->>'original_name',oid::text||'/'||key::text||'/documento.'||ext,mime,size,input->>'sha256',uid) returning * into d;
  return to_jsonb(d);
 end if;
 select * into d from public.acr_work_documents where id=doc;
 if not found or not exists(select 1 from public.acr_organizations where id=d.organization_id and active) then raise exception 'Documento no disponible.';end if;
 perform pg_advisory_xact_lock(hashtextextended(d.organization_id::text||d.category||d.code,0));
 select * into d from public.acr_work_documents where id=doc for update;
 if op in ('publish','restore') then
  if d.storage_backend='local' then
   perform acr_connector_private.work_doc_activate(d.id);
   select * into d from public.acr_work_documents where id=doc;
   return to_jsonb(d);
  end if;
  select metadata into stored from storage.objects where bucket_id='acr-work-documents' and name=d.storage_path;
  if not found or (stored->>'size')::bigint is distinct from d.byte_size::bigint or stored->>'mimetype' is distinct from d.mime_type then raise exception 'La carga del archivo no está completa o sus metadatos no coinciden.';end if;
  update public.acr_work_documents set status='withdrawn' where organization_id=d.organization_id and category=d.category and code=d.code and status='published' and id<>d.id;
  update public.acr_work_documents set status='published',published_at=now() where id=d.id returning * into d;
 elsif op='withdraw' then update public.acr_work_documents set status='withdrawn' where id=d.id returning * into d;
 else raise exception 'Operación no admitida.';end if;
 return to_jsonb(d);
end $$;

create or replace function acr_private.work_document_object_allowed(object_name text,writing boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and acr_private.has_platform_access(auth.uid()) and exists(
 select 1 from public.acr_work_documents d join public.acr_organizations o on o.id=d.organization_id and o.active
 where d.storage_backend='cloud' and d.storage_path=object_name and case when writing then d.status='draft' and acr_private.is_platform_admin(auth.uid())
 else acr_private.is_platform_admin(auth.uid()) or d.status='published' and acr_private.is_approved_member(d.organization_id,auth.uid()) end)
$$;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
select cron.schedule('acr-work-document-transfer-gc','*/5 * * * *', $cron$
 select acr_connector_private.work_document_gc(null);
 delete from cron.job_run_details where jobid=(select jobid from cron.job where jobname='acr-work-document-transfer-gc') and end_time<now()-interval '7 days';
$cron$);
notify pgrst,'reload schema';
commit;
