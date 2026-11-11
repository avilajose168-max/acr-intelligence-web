-- Access console. Database-owned events; clients cannot write the journal.
create table public.acr_access_audit (
 id uuid primary key default gen_random_uuid(),
 occurred_at timestamptz not null default now(),
 event_type text not null,
 organization_id uuid,
 organization_name text not null default '',
 target_user_id uuid not null,
 target_email text not null default '',
 actor_user_id uuid,
 actor_label text not null,
 old_state jsonb,
 new_state jsonb,
 source text not null default 'live' check(source in ('live','baseline'))
);
create index acr_access_audit_time_idx on public.acr_access_audit(occurred_at desc,id desc);
create index acr_access_audit_org_time_idx on public.acr_access_audit(organization_id,occurred_at desc);
alter table public.acr_access_audit enable row level security;
revoke all on public.acr_access_audit from public,anon,authenticated;
grant select on public.acr_access_audit to authenticated;
create policy "administrators read permitted access history" on public.acr_access_audit
 for select to authenticated using (
 acr_private.is_platform_admin((select auth.uid())) or
 (organization_id is not null and acr_private.is_org_admin(organization_id,(select auth.uid())))
 );

create function acr_private.capture_membership_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data public.acr_memberships; actor uuid:=auth.uid(); actor_name text; before_data jsonb; after_data jsonb;
begin
 if tg_op='UPDATE' and new.status is not distinct from old.status and new.role is not distinct from old.role
    and new.requested_role is not distinct from old.requested_role and new.approved_at is not distinct from old.approved_at then return new; end if;
 if tg_op='DELETE' then row_data:=old; else row_data:=new; end if;
 if tg_op<>'INSERT' then before_data:=jsonb_build_object('role',old.role,'status',old.status,'requested_role',old.requested_role,'approved_at',old.approved_at); end if;
 if tg_op<>'DELETE' then after_data:=jsonb_build_object('role',new.role,'status',new.status,'requested_role',new.requested_role,'approved_at',new.approved_at); end if;
 select u.email into actor_name from auth.users u where u.id=actor;
 insert into public.acr_access_audit(event_type,organization_id,organization_name,target_user_id,target_email,actor_user_id,actor_label,old_state,new_state)
 values(case tg_op when 'INSERT' then 'membership_requested' when 'DELETE' then 'membership_removed' else 'membership_updated' end,
 row_data.organization_id,coalesce((select o.name from public.acr_organizations o where o.id=row_data.organization_id),''),
 row_data.user_id,row_data.email,actor,coalesce(actor_name,'Sistema / operación de servidor'),before_data,after_data);
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function acr_private.capture_membership_audit() from public,anon,authenticated;
create trigger acr_capture_membership_audit after insert or update or delete on public.acr_memberships
 for each row execute function acr_private.capture_membership_audit();

create function acr_private.capture_user_access_audit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  insert into public.acr_access_audit(occurred_at,event_type,target_user_id,target_email,actor_user_id,actor_label)
  values(coalesce(new.created_at,now()),'registration',new.id,coalesce(new.email,''),new.id,coalesce(new.email,'Registro de cuenta'));
 elsif new.last_sign_in_at is not null and new.last_sign_in_at is distinct from old.last_sign_in_at then
  insert into public.acr_access_audit(occurred_at,event_type,target_user_id,target_email,actor_user_id,actor_label)
  values(new.last_sign_in_at,'login',new.id,coalesce(new.email,''),new.id,coalesce(new.email,'Inicio de sesión'));
 end if;
 return new;
end $$;
revoke all on function acr_private.capture_user_access_audit() from public,anon,authenticated;
create trigger acr_capture_user_registration after insert on auth.users
 for each row execute function acr_private.capture_user_access_audit();
create trigger acr_capture_user_login after update of last_sign_in_at on auth.users
 for each row execute function acr_private.capture_user_access_audit();

-- Recover known account timestamps without inventing historical access changes.
insert into public.acr_access_audit(occurred_at,event_type,target_user_id,target_email,actor_label,source)
select created_at,'registration',id,coalesce(email,''),'Registro existente recuperado','baseline' from auth.users;
insert into public.acr_access_audit(occurred_at,event_type,target_user_id,target_email,actor_label,source)
select last_sign_in_at,'login',id,coalesce(email,''),'Último ingreso existente recuperado','baseline' from auth.users where last_sign_in_at is not null;

-- Only this narrow, guarded reader accesses auth.users; no credentials are returned.
create function acr_private.read_access_console(p_kind text,p_org uuid default null,p_search text default '',
 p_event text default '',p_from date default null,p_to date default null,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); platform boolean; result jsonb; start_offset integer:=greatest(coalesce(p_offset,0),0);
begin
 if actor is null then raise exception 'Debes iniciar sesión' using errcode='42501'; end if;
 platform:=acr_private.is_platform_admin(actor);
 if not platform and (p_org is null or not acr_private.is_org_admin(p_org,actor)) then
  raise exception 'No tienes permisos para consultar este ámbito' using errcode='42501'; end if;
 if p_kind='users' then
  with visible as (
   select u.id,u.email,coalesce(nullif(p.display_name,''),nullif(u.raw_user_meta_data->>'display_name',''),u.email) as name,
    u.created_at as registered_at,u.last_sign_in_at,u.email_confirmed_at is not null as confirmed,
    exists(select 1 from public.acr_platform_admins a where a.user_id=u.id) as platform_admin,
    coalesce((select jsonb_agg(jsonb_build_object('company',o.name,'role',m.role,'status',m.status,'affiliated_at',m.created_at,'approved_at',m.approved_at) order by o.name)
     from public.acr_memberships m join public.acr_organizations o on o.id=m.organization_id
     where m.user_id=u.id and (p_org is null or m.organization_id=p_org)), '[]'::jsonb) as memberships
   from auth.users u left join public.acr_profiles p on p.user_id=u.id
   where (p_org is null or exists(select 1 from public.acr_memberships m where m.user_id=u.id and m.organization_id=p_org))
    and (coalesce(p_search,'')='' or coalesce(u.email,'') ilike '%'||left(p_search,150)||'%' or coalesce(p.display_name,'') ilike '%'||left(p_search,150)||'%')
  ) select jsonb_build_object('total',(select count(*) from visible),'rows',coalesce((select jsonb_agg(to_jsonb(v)) from
   (select * from visible order by registered_at desc,id limit 50 offset start_offset)v),'[]'::jsonb)) into result;
 elsif p_kind='events' then
  with visible as (
   select a.* from public.acr_access_audit a where
    (platform or (a.organization_id=p_org and acr_private.is_org_admin(a.organization_id,actor)))
    and (p_org is null or a.organization_id=p_org)
    and (coalesce(p_event,'')='' or a.event_type=p_event)
    and (p_from is null or a.occurred_at >= p_from::timestamp at time zone 'America/Santiago')
    and (p_to is null or a.occurred_at < (p_to+1)::timestamp at time zone 'America/Santiago')
    and (coalesce(p_search,'')='' or a.target_email ilike '%'||left(p_search,150)||'%' or a.actor_label ilike '%'||left(p_search,150)||'%' or a.organization_name ilike '%'||left(p_search,150)||'%')
  ) select jsonb_build_object('total',(select count(*) from visible),'rows',coalesce((select jsonb_agg(to_jsonb(v)) from
   (select * from visible order by occurred_at desc,id desc limit 50 offset start_offset)v),'[]'::jsonb)) into result;
 else raise exception 'Consulta no válida'; end if;
 return result;
end $$;
revoke all on function acr_private.read_access_console(text,uuid,text,text,date,date,integer) from public,anon,authenticated;
grant execute on function acr_private.read_access_console(text,uuid,text,text,date,date,integer) to authenticated;
create function public.acr_read_access_console(p_kind text,p_org uuid default null,p_search text default '',
 p_event text default '',p_from date default null,p_to date default null,p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
 select acr_private.read_access_console(p_kind,p_org,p_search,p_event,p_from,p_to,p_offset)
$$;
revoke all on function public.acr_read_access_console(text,uuid,text,text,date,date,integer) from public,anon;
grant execute on function public.acr_read_access_console(text,uuid,text,text,date,date,integer) to authenticated;
comment on table public.acr_access_audit is 'Server-recorded account and company access events. No client writes. Baseline entries contain recovered account timestamps only.';
