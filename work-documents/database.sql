begin;
create table public.acr_work_documents(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.acr_organizations(id),
 category text not null check(category in ('protocolo','procedimiento')),
 code text not null check(length(code) between 1 and 60),title text not null check(length(title) between 3 and 180),
 revision text not null check(length(revision) between 1 and 30),plant text not null default '' check(length(plant)<=100),
 area text not null check(area in ('General','Área Seca','Área Húmeda')),sector text not null default '' check(length(sector)<=100),
 equipment text not null default '' check(length(equipment)<=180),equipment_sap text not null default '' check(length(equipment_sap)<=40),
 description text not null default '' check(length(description)<=2000),original_name text not null check(length(original_name) between 1 and 180),
 storage_path text not null unique,mime_type text not null,byte_size integer not null check(byte_size between 1 and 10485760),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),status text not null default 'draft' check(status in ('draft','published','withdrawn')),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),published_at timestamptz,
 unique(organization_id,category,code,revision)
);
create unique index acr_one_current_work_document on public.acr_work_documents(organization_id,category,code) where status='published';
create index acr_work_doc_lookup on public.acr_work_documents(organization_id,category,status,area,sector);
alter table public.acr_work_documents enable row level security;
revoke all on public.acr_work_documents from public,anon,authenticated;
grant select on public.acr_work_documents to authenticated;
create policy "Company members read current work documents" on public.acr_work_documents for select to authenticated using(
 acr_private.has_platform_access((select auth.uid())) and exists(select 1 from public.acr_organizations o where o.id=organization_id and o.active)
 and (acr_private.is_platform_admin((select auth.uid())) or status='published' and acr_private.is_approved_member(organization_id,(select auth.uid())))
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('acr-work-documents','acr-work-documents',false,10485760,
 array['application/pdf','image/png','image/jpeg','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

create function acr_private.work_document_object_allowed(object_name text,writing boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and acr_private.has_platform_access(auth.uid()) and exists(
 select 1 from public.acr_work_documents d join public.acr_organizations o on o.id=d.organization_id and o.active
 where d.storage_path=object_name and case when writing then d.status='draft' and acr_private.is_platform_admin(auth.uid())
 else acr_private.is_platform_admin(auth.uid()) or d.status='published' and acr_private.is_approved_member(d.organization_id,auth.uid()) end)
$$;
revoke all on function acr_private.work_document_object_allowed(text,boolean) from public,anon,authenticated,service_role;
grant execute on function acr_private.work_document_object_allowed(text,boolean) to authenticated;
create policy "Authorized work document downloads" on storage.objects for select to authenticated using(bucket_id='acr-work-documents' and acr_private.work_document_object_allowed(name,false));
create policy "Platform admin uploads reserved work documents" on storage.objects for insert to authenticated with check(bucket_id='acr-work-documents' and acr_private.work_document_object_allowed(name,true));

create function acr_private.manage_work_document(op text,oid uuid default null,doc uuid default null,input jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.acr_work_documents;uid uuid:=auth.uid();key uuid:=gen_random_uuid();ext text;mime text;size integer;stored jsonb;
begin
 if uid is null or not acr_private.has_platform_access(uid) or not acr_private.is_platform_admin(uid) then raise exception 'Solo el administrador general puede cargar o gestionar estos documentos.' using errcode='42501';end if;
 if op='reserve' then
  if not exists(select 1 from public.acr_organizations where id=oid and active) then raise exception 'Selecciona una compañía activa.';end if;
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
  select metadata into stored from storage.objects where bucket_id='acr-work-documents' and name=d.storage_path;
  if not found or (stored->>'size')::bigint is distinct from d.byte_size::bigint or stored->>'mimetype' is distinct from d.mime_type then raise exception 'La carga del archivo no está completa o sus metadatos no coinciden.';end if;
  update public.acr_work_documents set status='withdrawn' where organization_id=d.organization_id and category=d.category and code=d.code and status='published' and id<>d.id;
  update public.acr_work_documents set status='published',published_at=now() where id=d.id returning * into d;
 elsif op='withdraw' then update public.acr_work_documents set status='withdrawn' where id=d.id returning * into d;
 else raise exception 'Operación no admitida.';end if;
 return to_jsonb(d);
end $$;
revoke all on function acr_private.manage_work_document(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function acr_private.manage_work_document(text,uuid,uuid,jsonb) to authenticated;
create function public.acr_manage_work_document(p_op text,p_organization uuid default null,p_id uuid default null,p_data jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$select acr_private.manage_work_document($1,$2,$3,$4)$$;
revoke all on function public.acr_manage_work_document(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.acr_manage_work_document(text,uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
