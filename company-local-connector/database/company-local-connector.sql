begin;
create schema if not exists acr_connector_private;
revoke all on schema acr_connector_private from public;
grant usage on schema acr_connector_private to anon,authenticated;
create table acr_connector_private.settings(
 organization_id uuid primary key references public.acr_organizations(id),
 connector_id uuid not null unique default gen_random_uuid(),server_name text not null,root_path text not null,
 configured_by uuid not null references auth.users(id),configured_at timestamptz not null default now(),
 pairing_hash bytea,pairing_expires_at timestamptz,token_hash bytea,token_expires_at timestamptz,last_seen_at timestamptz
);
create table acr_connector_private.jobs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references acr_connector_private.settings(organization_id),
 connector_id uuid not null,kind text not null check(kind in ('write_probe','read_probe')),
 state text not null default 'queued' check(state in ('queued','leased','verified','error','cancelled')),
 original_id uuid references acr_connector_private.jobs(id),relative_path text not null,expected_content text not null,
 expected_hash text not null,requested_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 lease_id uuid,lease_until timestamptz,attempts integer not null default 0,verified_at timestamptz,
 returned_content text,error_message text,check(octet_length(expected_content)<=65536),check(octet_length(returned_content)<=65536)
);
create index acr_local_jobs_org_created on acr_connector_private.jobs(organization_id,created_at desc);
alter table acr_connector_private.settings enable row level security;
alter table acr_connector_private.jobs enable row level security;
create policy "No direct client access" on acr_connector_private.settings for all to anon,authenticated using (false) with check (false);
create policy "No direct client access" on acr_connector_private.jobs for all to anon,authenticated using (false) with check (false);
revoke all on all tables in schema acr_connector_private from public,anon,authenticated,service_role;

create function acr_connector_private.require_admin(oid uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not acr_private.has_platform_access(auth.uid()) or not acr_private.is_org_admin(oid,auth.uid())
 or not exists(select 1 from public.acr_organizations o where o.id=oid and o.active) then
  raise exception 'Solo un administrador autorizado de esta compañía puede configurar su servidor.' using errcode='42501';
 end if;
end $$;

create function acr_connector_private.status(oid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s acr_connector_private.settings; result jsonb;
begin
 perform acr_connector_private.require_admin(oid);
 select * into s from acr_connector_private.settings where organization_id=oid;
 if not found then return jsonb_build_object('configured',false,'mode','probe');end if;
 select coalesce(jsonb_agg(j order by j.created_at desc),'[]'::jsonb) into result from(
  select id,kind,state,original_id,relative_path,created_at,verified_at,error_message,
   case when kind='read_probe' and state='verified' then returned_content else null end as returned_content
  from acr_connector_private.jobs where organization_id=oid order by created_at desc limit 12
 )j;
 return jsonb_build_object('configured',true,'mode','probe','server_name',s.server_name,'root_path',s.root_path,'connector_id',s.connector_id,
  'state',case when s.token_hash is null then 'unlinked' when s.token_expires_at<=now() then 'expired' when s.last_seen_at>now()-interval '90 seconds' then 'connected' else 'offline' end,
  'last_seen_at',s.last_seen_at,'token_expires_at',s.token_expires_at,'jobs',result);
end $$;

create function acr_connector_private.configure(oid uuid,label text,folder text) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_path text; linked boolean;
begin
 perform acr_connector_private.require_admin(oid);
 label:=btrim(label);folder:=btrim(folder);
 if length(label) not between 2 and 80 or length(folder) not between 5 and 500 or position('..' in folder)>0 or folder ~ '[\r\n]'
 or not ((substring(folder,1,2)~'^[A-Za-z]:$' and substring(folder,3,1)=chr(92)) or (left(folder,2)=chr(92)||chr(92) and position(chr(92) in substring(folder,3))>1))
 then raise exception 'Indica un nombre y una carpeta absoluta de Windows, por ejemplo C:\ACR\Empresa_Demo.';end if;
 select root_path,token_hash is not null into current_path,linked from acr_connector_private.settings where organization_id=oid for update;
 if linked and current_path<>folder then raise exception 'Desvincula el conector antes de cambiar su carpeta.';end if;
 insert into acr_connector_private.settings(organization_id,server_name,root_path,configured_by) values(oid,label,folder,auth.uid())
 on conflict(organization_id) do update set server_name=excluded.server_name,root_path=excluded.root_path,configured_by=excluded.configured_by,configured_at=now();
 return acr_connector_private.status(oid);
end $$;

create function acr_connector_private.pairing(oid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare code text;valid_until timestamptz:=now()+interval '10 minutes';
begin
 perform acr_connector_private.require_admin(oid);
 code:='ACR1-'||upper(encode(extensions.gen_random_bytes(24),'hex'));
 update acr_connector_private.settings set pairing_hash=extensions.digest(convert_to(code,'UTF8'),'sha256'),pairing_expires_at=valid_until,
 token_hash=null,token_expires_at=null,last_seen_at=null where organization_id=oid;
 if not found then raise exception 'Primero guarda la configuración del servidor.';end if;
 update acr_connector_private.jobs set state='cancelled',error_message='La vinculación fue renovada.' where organization_id=oid and state in ('queued','leased');
 return jsonb_build_object('code',code,'expires_at',valid_until);
end $$;

create function acr_connector_private.revoke_connector(oid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform acr_connector_private.require_admin(oid);
 update acr_connector_private.settings set pairing_hash=null,pairing_expires_at=null,token_hash=null,token_expires_at=null,last_seen_at=null where organization_id=oid;
 update acr_connector_private.jobs set state='cancelled',error_message='El administrador desvinculó el conector.' where organization_id=oid and state in ('queued','leased');
 return acr_connector_private.status(oid);
end $$;

create function acr_connector_private.pair(code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s acr_connector_private.settings; secret text;
begin
 code:=upper(btrim(code));
 if code!~'^ACR1-[A-F0-9]{48}$' then raise exception 'Código de vinculación inválido o vencido.' using errcode='28000';end if;
 select * into s from acr_connector_private.settings where pairing_hash=extensions.digest(convert_to(code,'UTF8'),'sha256') and pairing_expires_at>now() for update;
 if not found then raise exception 'Código de vinculación inválido, utilizado o vencido.' using errcode='28000';end if;
 if not acr_private.is_org_admin(s.organization_id,s.configured_by) or not acr_private.has_platform_access(s.configured_by)
 or not exists(select 1 from public.acr_organizations where id=s.organization_id and active) then raise exception 'La configuración ya no está autorizada.' using errcode='28000';end if;
 secret:=encode(extensions.gen_random_bytes(32),'hex');
 update acr_connector_private.settings set token_hash=extensions.digest(convert_to(secret,'UTF8'),'sha256'),token_expires_at=now()+interval '7 days',pairing_hash=null,pairing_expires_at=null,last_seen_at=now() where organization_id=s.organization_id;
 return jsonb_build_object('connector_id',s.connector_id,'organization_id',s.organization_id,'company_name',(select name from public.acr_organizations where id=s.organization_id),'server_name',s.server_name,'root_path',s.root_path,'token',secret,'expires_at',now()+interval '7 days');
end $$;

create function acr_connector_private.worker(cid uuid,secret text) returns uuid language plpgsql security definer set search_path='' as $$
declare oid uuid;
begin
 if secret is null or secret!~'^[a-f0-9]{64}$' then raise exception 'Vinculación no autorizada.' using errcode='28000';end if;
 select s.organization_id into oid from acr_connector_private.settings s join public.acr_organizations o on o.id=s.organization_id and o.active
 where s.connector_id=cid and s.token_hash=extensions.digest(convert_to(secret,'UTF8'),'sha256') and s.token_expires_at>now()
 and acr_private.has_platform_access(s.configured_by) and acr_private.is_org_admin(s.organization_id,s.configured_by);
 if oid is null then raise exception 'Vinculación vencida o revocada. Genera un nuevo código en la plataforma.' using errcode='28000';end if;
 return oid;
end $$;

create function acr_connector_private.probe(oid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s acr_connector_private.settings;jid uuid:=gen_random_uuid();html text;rel text;
begin
 perform acr_connector_private.require_admin(oid);
 select * into s from acr_connector_private.settings where organization_id=oid for update;
 if not found or s.token_hash is null or s.token_expires_at<=now() then raise exception 'Primero vincula el conector de esta empresa.';end if;
 if exists(select 1 from acr_connector_private.jobs where organization_id=oid and created_at>now()-interval '10 seconds') then raise exception 'Espera unos segundos antes de solicitar otra prueba.';end if;
 if (select count(*) from acr_connector_private.jobs where organization_id=oid)>=512 then raise exception 'Se alcanzó el límite de documentos de esta prueba piloto.';end if;
 rel:='ACR_Conexion_Prueba/'||to_char(now() at time zone 'America/Santiago','YYYY/MM')||'/'||jid::text||'/informe.html';
 html:='<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src ''none'';style-src ''unsafe-inline''"><title>Prueba de servidor ACR</title><style>body{font:16px Arial,sans-serif;color:#153047;max-width:850px;margin:35px auto;padding:20px;line-height:1.65}h1{color:#153047}.note{background:#fff2c5;padding:15px;border-left:5px solid #d2aa37}code{overflow-wrap:anywhere}</style><h1>ACR Integrity · Prueba de conexión</h1><p class="note">Documento de ejemplo. No contiene información de clientes ni investigaciones reales.</p><p>Este informe se generó en la plataforma para comprobar su guardado y recuperación desde el servidor configurado.</p><p><b>Identificador:</b> <code>'||jid::text||'</code></p><p><b>Fecha:</b> '||to_char(now() at time zone 'America/Santiago','DD-MM-YYYY HH24:MI:SS')||' · Chile</p><h2>Recorrido esperado</h2><p>Plataforma → Conector local → Carpeta de la empresa → Lectura desde el disco → Plataforma.</p></html>';
 insert into acr_connector_private.jobs(id,organization_id,connector_id,kind,relative_path,expected_content,expected_hash,requested_by)
 values(jid,oid,s.connector_id,'write_probe',rel,html,encode(extensions.digest(convert_to(html,'UTF8'),'sha256'),'hex'),auth.uid());
 return jsonb_build_object('id',jid,'state','queued');
end $$;

create function acr_connector_private.retrieve(oid uuid,original uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j acr_connector_private.jobs; s acr_connector_private.settings;newid uuid;
begin
 perform acr_connector_private.require_admin(oid);
 select * into s from acr_connector_private.settings where organization_id=oid for update;
 if s.token_hash is null or s.token_expires_at<=now() then raise exception 'El conector debe estar vinculado para recuperar el informe.';end if;
 select * into j from acr_connector_private.jobs where id=original and organization_id=oid and kind='write_probe' and state='verified';
 if not found then raise exception 'El archivo primero debe estar guardado y verificado en el servidor.';end if;
 if exists(select 1 from acr_connector_private.jobs where organization_id=oid and original_id=original and state in ('queued','leased')) then raise exception 'Ya hay una solicitud de lectura pendiente.';end if;
 if (select count(*) from acr_connector_private.jobs where organization_id=oid)>=512 then raise exception 'Se alcanzó el límite de pruebas.';end if;
 insert into acr_connector_private.jobs(organization_id,connector_id,kind,original_id,relative_path,expected_content,expected_hash,requested_by)
 values(oid,s.connector_id,'read_probe',original,j.relative_path,j.expected_content,j.expected_hash,auth.uid()) returning id into newid;
 return jsonb_build_object('id',newid,'state','queued');
end $$;

create function acr_connector_private.poll(cid uuid,secret text) returns jsonb language plpgsql security definer set search_path='' as $$
declare oid uuid; j acr_connector_private.jobs;lease uuid;
begin
 oid:=acr_connector_private.worker(cid,secret);
 update acr_connector_private.settings set last_seen_at=now() where organization_id=oid;
 update acr_connector_private.jobs set state='error',error_message='Prueba vencida o reintentos agotados.' where organization_id=oid and state in ('queued','leased') and (created_at<now()-interval '1 hour' or attempts>=5 and lease_until<now());
 select * into j from acr_connector_private.jobs where organization_id=oid and connector_id=cid and attempts<5 and (state='queued' or state='leased' and lease_until<now()) order by created_at for update skip locked limit 1;
 if not found then return jsonb_build_object('job',null);end if;
 lease:=gen_random_uuid();update acr_connector_private.jobs set state='leased',lease_id=lease,lease_until=now()+interval '2 minutes',attempts=attempts+1 where id=j.id;
 return jsonb_build_object('job',jsonb_build_object('id',j.id,'lease_id',lease,'kind',j.kind,'relative_path',j.relative_path,'expected_hash',j.expected_hash,
  'content_base64',case when j.kind='write_probe' then encode(convert_to(j.expected_content,'UTF8'),'base64') else null end));
end $$;

create function acr_connector_private.complete(cid uuid,secret text,jid uuid,lease uuid,readback text,checksum text) returns jsonb language plpgsql security definer set search_path='' as $$
declare oid uuid;j acr_connector_private.jobs;
begin
 oid:=acr_connector_private.worker(cid,secret);
 select * into j from acr_connector_private.jobs where id=jid and organization_id=oid and connector_id=cid for update;
 if not found or j.state<>'leased' or j.lease_id is distinct from lease or j.lease_until<now() then raise exception 'La solicitud ya no está vigente.';end if;
 if readback is null or octet_length(readback)>65536 or checksum is distinct from j.expected_hash or encode(extensions.digest(convert_to(readback,'UTF8'),'sha256'),'hex')<>j.expected_hash or readback<>j.expected_content
 then raise exception 'La lectura no coincide con el archivo esperado. No se confirmó el guardado.';end if;
 update acr_connector_private.jobs set state='verified',verified_at=now(),returned_content=case when kind='read_probe' then readback else null end where id=jid;
 return jsonb_build_object('verified',true,'id',jid);
end $$;

create function acr_connector_private.fail(cid uuid,secret text,jid uuid,lease uuid,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare oid uuid;
begin
 oid:=acr_connector_private.worker(cid,secret);
 update acr_connector_private.jobs set state='error',error_message=left(coalesce(reason,'No se pudo procesar el archivo.'),300)
 where id=jid and organization_id=oid and connector_id=cid and state='leased' and lease_id=lease and lease_until>now();
 if not found then raise exception 'La solicitud ya no está vigente.';end if;
 return jsonb_build_object('reported',true);
end $$;

revoke all on all functions in schema acr_connector_private from public,anon,authenticated,service_role;
-- Narrow RPC wrappers are appended below. Private tables have no client grants.

create function public.acr_local_storage_status(p_organization uuid) returns jsonb language sql security invoker set search_path='' as $$ select acr_connector_private.status($1) $$;
revoke all on function public.acr_local_storage_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.acr_local_storage_status(uuid) to authenticated;
grant execute on function acr_connector_private.status(uuid) to authenticated;

create function public.acr_local_storage_configure(p_organization uuid,p_server_name text,p_root_path text) returns jsonb language sql security invoker set search_path='' as $$ select acr_connector_private.configure($1,$2,$3) $$;
revoke all on function public.acr_local_storage_configure(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.acr_local_storage_configure(uuid,text,text) to authenticated;
grant execute on function acr_connector_private.configure(uuid,text,text) to authenticated;

create function public.acr_local_storage_pairing(p_organization uuid) returns jsonb language sql security invoker set search_path='' as $$ select acr_connector_private.pairing($1) $$;
revoke all on function public.acr_local_storage_pairing(uuid) from public,anon,authenticated,service_role;
grant execute on function public.acr_local_storage_pairing(uuid) to authenticated;
grant execute on function acr_connector_private.pairing(uuid) to authenticated;

create function public.acr_local_storage_revoke(p_organization uuid) returns jsonb language sql security invoker set search_path='' as $$ select acr_connector_private.revoke_connector($1) $$;
revoke all on function public.acr_local_storage_revoke(uuid) from public,anon,authenticated,service_role;
grant execute on function public.acr_local_storage_revoke(uuid) to authenticated;
grant execute on function acr_connector_private.revoke_connector(uuid) to authenticated;

create function public.acr_local_storage_probe(p_organization uuid) returns jsonb language sql security invoker set search_path='' as $$ select acr_connector_private.probe($1) $$;
revoke all on function public.acr_local_storage_probe(uuid) from public,anon,authenticated,service_role;
grant execute on function public.acr_local_storage_probe(uuid) to authenticated;
grant execute on function acr_connector_private.probe(uuid) to authenticated;

create function public.acr_local_storage_retrieve(p_organization uuid,p_original uuid) returns jsonb language sql security invoker set search_path='' as $$ select acr_connector_private.retrieve($1,$2) $$;
revoke all on function public.acr_local_storage_retrieve(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.acr_local_storage_retrieve(uuid,uuid) to authenticated;
grant execute on function acr_connector_private.retrieve(uuid,uuid) to authenticated;

create function public.acr_local_connector_pair(p_code text) returns jsonb language sql security invoker set search_path='' as $$ select acr_connector_private.pair($1) $$;
revoke all on function public.acr_local_connector_pair(text) from public,anon,authenticated,service_role;
grant execute on function public.acr_local_connector_pair(text) to anon,authenticated;
grant execute on function acr_connector_private.pair(text) to anon,authenticated;

create function public.acr_local_connector_poll(p_connector uuid,p_token text) returns jsonb language sql security invoker set search_path='' as $$ select acr_connector_private.poll($1,$2) $$;
revoke all on function public.acr_local_connector_poll(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.acr_local_connector_poll(uuid,text) to anon,authenticated;
grant execute on function acr_connector_private.poll(uuid,text) to anon,authenticated;

create function public.acr_local_connector_complete(p_connector uuid,p_token text,p_job uuid,p_lease uuid,p_readback text,p_checksum text) returns jsonb language sql security invoker set search_path='' as $$ select acr_connector_private.complete($1,$2,$3,$4,$5,$6) $$;
revoke all on function public.acr_local_connector_complete(uuid,text,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.acr_local_connector_complete(uuid,text,uuid,uuid,text,text) to anon,authenticated;
grant execute on function acr_connector_private.complete(uuid,text,uuid,uuid,text,text) to anon,authenticated;

create function public.acr_local_connector_fail(p_connector uuid,p_token text,p_job uuid,p_lease uuid,p_reason text) returns jsonb language sql security invoker set search_path='' as $$ select acr_connector_private.fail($1,$2,$3,$4,$5) $$;
revoke all on function public.acr_local_connector_fail(uuid,text,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.acr_local_connector_fail(uuid,text,uuid,uuid,text) to anon,authenticated;
grant execute on function acr_connector_private.fail(uuid,text,uuid,uuid,text) to anon,authenticated;

notify pgrst,'reload schema';
commit;
