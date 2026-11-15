begin;
alter table acr_connector_private.settings add column archive_enabled boolean not null default false,add column archive_worker_seen timestamptz,add column archive_error text;
create table acr_connector_private.archives(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.acr_organizations(id),
 investigation_id uuid not null references public.acr_corporate_investigations(id) on delete cascade,owner_id uuid not null references auth.users(id),
 title text,equipment text,version_hash text not null,relative_path text not null,byte_size integer not null check(byte_size between 1 and 33554432),
 package_bytes bytea,created_at timestamptz not null default now(),write_verified_at timestamptz,read_verified_at timestamptz,
 unique(investigation_id,version_hash),check(package_bytes is null or octet_length(package_bytes)=byte_size)
);
create table acr_connector_private.archive_jobs(
 id uuid primary key default gen_random_uuid(),archive_id uuid not null references acr_connector_private.archives(id) on delete cascade,organization_id uuid not null,
 kind text not null check(kind in ('write_archive','read_archive')),state text not null default 'queued' check(state in ('queued','leased','verified','error')),
 requested_by uuid references auth.users(id),created_at timestamptz not null default now(),lease_id uuid,lease_until timestamptz,
 attempts integer not null default 0,received bytea not null default ''::bytea,verified_at timestamptz,error_message text,
 check(octet_length(received)<=33554432)
);
create index archive_jobs_queue on acr_connector_private.archive_jobs(organization_id,state,created_at);
create index archive_org_created on acr_connector_private.archives(organization_id,created_at desc);
alter table acr_connector_private.archives enable row level security;
alter table acr_connector_private.archive_jobs enable row level security;
create policy "No direct client access" on acr_connector_private.archives for all to anon,authenticated using(false) with check(false);
create policy "No direct client access" on acr_connector_private.archive_jobs for all to anon,authenticated using(false) with check(false);
revoke all on acr_connector_private.archives,acr_connector_private.archive_jobs from public,anon,authenticated,service_role;

create function acr_connector_private.archive_can_read(rid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and acr_private.has_platform_access(auth.uid()) and exists(
 select 1 from public.acr_corporate_investigations r join public.acr_organizations o on o.id=r.organization_id and o.active
 where r.id=rid and (acr_private.is_org_admin(r.organization_id,auth.uid()) or r.owner_id=auth.uid() and acr_private.is_approved_member(r.organization_id,auth.uid())))
$$;
create function acr_connector_private.archive_complete(rid uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare p jsonb;a jsonb;i integer:=0;k text;n integer:=0;
begin
 select payload into p from public.acr_corporate_investigations where id=rid;
 if jsonb_typeof(p->'actions') is distinct from 'array' then return false;end if;
 for a in select value from jsonb_array_elements(p->'actions') loop
  if btrim(coalesce(a->>'description',''))<>'' then
   n:=n+1;
   k:=i::text||':'||btrim(regexp_replace(lower(translate(coalesce(a->>'description',''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),'[^a-z0-9]+',' ','g'));
   if a->>'status' is distinct from 'Completado' and not exists(select 1 from public.acr_followup_events e where e.investigation_id=rid and e.kind='execution' and e.action_key=k and btrim(coalesce(e.data->>'performed',''))<>'' and jsonb_array_length(coalesce(e.data->'files','[]'))>0) then return false;end if;
  end if;i:=i+1;
 end loop;
 return n>0;
end $$;
create function acr_connector_private.archive_enqueue(rid uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.acr_corporate_investigations;payload jsonb;bytes bytea;hash text;aid uuid;rel text;
begin
 select * into r from public.acr_corporate_investigations where id=rid;
 if not found then raise exception 'Informe no disponible.';end if;
 select jsonb_build_object('schema','acr-company-archive/1','report',to_jsonb(r)-'updated_at',
  'company',(select jsonb_build_object('id',id,'name',name,'logo_data',logo_data) from public.acr_organizations where id=r.organization_id),
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.acr_followup_events e where investigation_id=rid),'[]'::jsonb)) into payload;
 bytes:=convert_to(payload::text,'UTF8');
 if octet_length(bytes)>33554432 then raise exception 'El respaldo supera 32 MB. Se conserva íntegro en la nube; requiere revisión de almacenamiento.';end if;
 hash:=encode(extensions.digest(bytes,'sha256'),'hex');
 select id into aid from acr_connector_private.archives where investigation_id=rid and version_hash=hash;
 if aid is not null then
  if not exists(select 1 from acr_connector_private.archive_jobs where archive_id=aid and kind='write_archive' and state in ('queued','leased','verified')) then
   update acr_connector_private.archives set package_bytes=bytes where id=aid;
   insert into acr_connector_private.archive_jobs(archive_id,organization_id,kind,requested_by) values(aid,r.organization_id,'write_archive',auth.uid());
  end if;return aid;
 end if;
 if (select count(*) from acr_connector_private.archive_jobs where organization_id=r.organization_id and state in ('queued','leased'))>=100 then raise exception 'Hay 100 respaldos pendientes. Espera al conector antes de añadir más.';end if;
 aid:=gen_random_uuid();rel:='ACR_Informes/'||to_char(coalesce(r.created_at,now()) at time zone 'America/Santiago','YYYY/MM')||'/'||rid::text||'/'||hash||'/paquete.json';
 insert into acr_connector_private.archives(id,organization_id,investigation_id,owner_id,title,equipment,version_hash,relative_path,byte_size,package_bytes)
 values(aid,r.organization_id,rid,r.owner_id,r.title,r.equipment,hash,rel,octet_length(bytes),bytes);
 insert into acr_connector_private.archive_jobs(archive_id,organization_id,kind,requested_by) values(aid,r.organization_id,'write_archive',auth.uid());
 return aid;
end $$;
create function acr_connector_private.archive_trigger() returns trigger language plpgsql security definer set search_path='' as $$
declare rid uuid;oid uuid;
begin
 rid:=(case when tg_table_name='acr_corporate_investigations' then to_jsonb(new)->>'id' else to_jsonb(new)->>'investigation_id' end)::uuid;
 select organization_id into oid from public.acr_corporate_investigations where id=rid;
 if exists(select 1 from acr_connector_private.settings where organization_id=oid and archive_enabled) and acr_connector_private.archive_complete(rid) then
  begin perform acr_connector_private.archive_enqueue(rid);update acr_connector_private.settings set archive_error=null where organization_id=oid;
  exception when others then update acr_connector_private.settings set archive_error=left(sqlerrm,300) where organization_id=oid;end;
 end if;
 return new;
end $$;
create trigger acr_archive_report_change after insert or update on public.acr_corporate_investigations for each row execute function acr_connector_private.archive_trigger();
create trigger acr_archive_followup_change after insert or update on public.acr_followup_events for each row execute function acr_connector_private.archive_trigger();

create function acr_connector_private.archive_api(op text,oid uuid default null,ref uuid default null,off integer default 0,enabled boolean default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare a acr_connector_private.archives;j acr_connector_private.archive_jobs;result jsonb;rid uuid;counted integer:=0;
begin
 if auth.uid() is null or not acr_private.has_platform_access(auth.uid()) then raise exception 'Acceso no autorizado.' using errcode='42501';end if;
 if op in ('status','reports','copy','auto') then perform acr_connector_private.require_admin(oid);end if;
 if op='status' then
  select jsonb_build_object('enabled',archive_enabled,'worker_seen',archive_worker_seen,'error',archive_error) into result from acr_connector_private.settings where organization_id=oid;
  return coalesce(result,jsonb_build_object('enabled',false));
 elsif op='reports' then
  select coalesce(jsonb_agg(x),'[]') into result from(select id,title,equipment,acr_connector_private.archive_complete(id) as completed from public.acr_corporate_investigations where organization_id=oid order by updated_at desc limit 100 offset greatest(0,off))x;return result;
 elsif op='copy' then
  if not exists(select 1 from public.acr_corporate_investigations where id=ref and organization_id=oid) then raise exception 'Informe de otra compañía.' using errcode='42501';end if;
  if not exists(select 1 from acr_connector_private.settings where organization_id=oid and token_hash is not null and token_expires_at>now() and archive_worker_seen>now()-interval '2 minutes') then raise exception 'Actualiza e inicia el conector versión 2 antes de copiar informes reales.';end if;
  return jsonb_build_object('id',acr_connector_private.archive_enqueue(ref));
 elsif op='auto' then
  if enabled is null then raise exception 'Indica si deseas activar la copia automática.';end if;
  if enabled and not exists(select 1 from acr_connector_private.settings where organization_id=oid and archive_worker_seen>now()-interval '2 minutes' and token_hash is not null and token_expires_at>now()) then raise exception 'Primero inicia el conector versión 2.';end if;
  update acr_connector_private.settings set archive_enabled=enabled where organization_id=oid;
  if not found then raise exception 'Configura primero el servidor.';end if;
  if enabled then
   for rid in select id from public.acr_corporate_investigations where organization_id=oid order by updated_at desc limit 100 loop
    if acr_connector_private.archive_complete(rid) then perform acr_connector_private.archive_enqueue(rid);counted:=counted+1;end if;
   end loop;
  end if;return jsonb_build_object('enabled',enabled,'queued',counted);
 elsif op='list' then
  select coalesce(jsonb_agg(x),'[]') into result from(
   select ar.id,ar.investigation_id,ar.organization_id,ar.title,ar.equipment,ar.byte_size,ar.version_hash,ar.created_at,ar.write_verified_at,ar.read_verified_at,
   (select jsonb_build_object('id',jb.id,'state',jb.state,'kind',jb.kind,'error',jb.error_message,'requested_by',jb.requested_by,'expires_at',jb.verified_at+interval '15 minutes') from acr_connector_private.archive_jobs jb where jb.archive_id=ar.id and (jb.kind='write_archive' or jb.requested_by=auth.uid()) order by jb.created_at desc,jb.id desc limit 1) as job
   from acr_connector_private.archives ar where (oid is null or ar.organization_id=oid) and acr_connector_private.archive_can_read(ar.investigation_id)
   order by ar.created_at desc,ar.id limit 100 offset greatest(0,off)
  )x;return result;
 end if;
 select * into a from acr_connector_private.archives where id=ref;
 if op in ('retrieve','read') and (a.id is null or not acr_connector_private.archive_can_read(a.investigation_id)) then raise exception 'No puedes consultar este respaldo.' using errcode='42501';end if;
 if op='retrieve' then
  if a.write_verified_at is null then raise exception 'El respaldo todavía no está guardado y verificado.';end if;
  if not exists(select 1 from acr_connector_private.settings where organization_id=a.organization_id and token_hash is not null and token_expires_at>now()) then raise exception 'El administrador debe vincular nuevamente el conector.';end if;
  select * into j from acr_connector_private.archive_jobs where archive_id=a.id and kind='read_archive' and requested_by=auth.uid() and state in ('queued','leased') order by created_at desc limit 1;
  if found then return jsonb_build_object('id',j.id);end if;
  if (select count(*) from acr_connector_private.archive_jobs where organization_id=a.organization_id and state in ('queued','leased'))>=100 then raise exception 'El conector tiene demasiados trabajos pendientes.';end if;
  insert into acr_connector_private.archive_jobs(archive_id,organization_id,kind,requested_by) values(a.id,a.organization_id,'read_archive',auth.uid()) returning id into rid;
  return jsonb_build_object('id',rid);
 elsif op='read' then
  select * into j from acr_connector_private.archive_jobs where archive_id=a.id and kind='read_archive' and state='verified' and requested_by=auth.uid() and verified_at>now()-interval '15 minutes' order by verified_at desc limit 1;
  if not found then raise exception 'Solicita una nueva lectura desde el servidor.';end if;
  if off<0 or off>=a.byte_size or off%262144<>0 then raise exception 'Bloque no válido.';end if;
  return jsonb_build_object('data',encode(substring(j.received from off+1 for 262144),'base64'),'size',a.byte_size,'checksum',a.version_hash,'job',j.id);
 end if;
 raise exception 'Operación no permitida.';
end $$;

create function acr_connector_private.archive_worker(cid uuid,secret text,op text,jid uuid default null,lease uuid default null,off integer default 0,block text default null,checksum text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare oid uuid;j acr_connector_private.archive_jobs;a acr_connector_private.archives;raw bytea;newlease uuid;
begin
 oid:=acr_connector_private.worker(cid,secret);
 update acr_connector_private.settings set last_seen_at=now(),archive_worker_seen=now() where organization_id=oid;
 if op='poll' then
  update acr_connector_private.archive_jobs set received=''::bytea where organization_id=oid and kind='read_archive' and state='verified' and verified_at<now()-interval '15 minutes' and octet_length(received)>0;
  update acr_connector_private.archive_jobs set state='error',received=''::bytea,error_message='Trabajo vencido o reintentos agotados.' where organization_id=oid and state in ('queued','leased') and (created_at<now()-interval '24 hours' or attempts>=5 and lease_until<now());
  select * into j from acr_connector_private.archive_jobs where organization_id=oid and attempts<5 and (state='queued' or state='leased' and lease_until<now()) order by created_at,id for update skip locked limit 1;
  if not found then return jsonb_build_object('job',null);end if;
  newlease:=gen_random_uuid();update acr_connector_private.archive_jobs set state='leased',lease_id=newlease,lease_until=now()+interval '10 minutes',attempts=attempts+1,received=''::bytea where id=j.id;
  select * into a from acr_connector_private.archives where id=j.archive_id;
  return jsonb_build_object('job',jsonb_build_object('id',j.id,'lease_id',newlease,'archive_id',a.id,'kind',j.kind,'relative_path',a.relative_path,'size',a.byte_size,'checksum',a.version_hash));
 end if;
 select * into j from acr_connector_private.archive_jobs where id=jid and organization_id=oid for update;
 if not found or j.state<>'leased' or j.lease_id is distinct from lease or j.lease_until<now() then raise exception 'La solicitud ya no está vigente.';end if;
 select * into a from acr_connector_private.archives where id=j.archive_id;
 update acr_connector_private.archive_jobs set lease_until=now()+interval '10 minutes' where id=j.id;
 if op='download' and j.kind='write_archive' then
  if off<0 or off>=a.byte_size or off%262144<>0 then raise exception 'Bloque no válido.';end if;
  return jsonb_build_object('data',encode(substring(a.package_bytes from off+1 for 262144),'base64'));
 elsif op='upload' then
  if block is null or length(block)>360000 then raise exception 'Bloque demasiado grande.';end if;
  raw:=decode(block,'base64');
  if octet_length(raw)<1 or octet_length(raw)>262144 or off<0 or off+octet_length(raw)>a.byte_size then raise exception 'Bloque no válido.';end if;
  if off=octet_length(j.received) then update acr_connector_private.archive_jobs set received=received||raw where id=j.id;
  elsif off<octet_length(j.received) and substring(j.received from off+1 for octet_length(raw))=raw then null;
  else raise exception 'Bloque fuera de secuencia.';end if;
  return jsonb_build_object('received',off+octet_length(raw));
 elsif op='complete' then
  if octet_length(j.received)<>a.byte_size or checksum is distinct from a.version_hash or encode(extensions.digest(j.received,'sha256'),'hex')<>a.version_hash then raise exception 'La recuperación del disco no coincide. No se confirmó el respaldo.';end if;
  update acr_connector_private.archive_jobs set state='verified',verified_at=now(),received=case when kind='write_archive' then ''::bytea else received end where id=j.id;
  if j.kind='write_archive' then update acr_connector_private.archives set write_verified_at=now(),package_bytes=null where id=a.id;
  else update acr_connector_private.archives set read_verified_at=now() where id=a.id;end if;
  return jsonb_build_object('verified',true);
 elsif op='fail' then
  update acr_connector_private.archive_jobs set state='error',received=''::bytea,error_message=left(coalesce(block,'No se completó la operación.'),300) where id=j.id;
  return jsonb_build_object('reported',true);
 end if;raise exception 'Operación no permitida.';
end $$;

revoke all on function acr_connector_private.archive_can_read(uuid),acr_connector_private.archive_complete(uuid),acr_connector_private.archive_enqueue(uuid),acr_connector_private.archive_trigger(),acr_connector_private.archive_api(text,uuid,uuid,integer,boolean),acr_connector_private.archive_worker(uuid,text,text,uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function acr_connector_private.archive_api(text,uuid,uuid,integer,boolean) to authenticated;
grant execute on function acr_connector_private.archive_worker(uuid,text,text,uuid,uuid,integer,text,text) to anon,authenticated;
create function public.acr_real_archives(p_op text,p_organization uuid default null,p_ref uuid default null,p_offset integer default 0,p_enabled boolean default null) returns jsonb language sql security invoker set search_path='' as $$ select acr_connector_private.archive_api($1,$2,$3,$4,$5) $$;
revoke all on function public.acr_real_archives(text,uuid,uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.acr_real_archives(text,uuid,uuid,integer,boolean) to authenticated;
create function public.acr_archive_worker(p_connector uuid,p_token text,p_op text,p_job uuid default null,p_lease uuid default null,p_offset integer default 0,p_data text default null,p_checksum text default null) returns jsonb language sql security invoker set search_path='' as $$ select acr_connector_private.archive_worker($1,$2,$3,$4,$5,$6,$7,$8) $$;
revoke all on function public.acr_archive_worker(uuid,text,text,uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.acr_archive_worker(uuid,text,text,uuid,uuid,integer,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
