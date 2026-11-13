begin;
create table public.acr_platform_access (
 user_id uuid primary key references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 requested_at timestamptz not null default now(), decided_at timestamptz,
 decided_by uuid references auth.users(id), reason text not null default ''
);
alter table public.acr_platform_access enable row level security;
revoke all on public.acr_platform_access from anon,authenticated;
grant select on public.acr_platform_access to authenticated;
create policy "read own platform authorization or general admin" on public.acr_platform_access for select to authenticated
 using(user_id=(select auth.uid()) or acr_private.is_platform_admin((select auth.uid())));
insert into public.acr_platform_access(user_id,status,requested_at,decided_at,reason)
 select id,'approved',created_at,now(),'Cuenta existente antes del control de nuevos registros' from auth.users;
create function acr_private.has_platform_access(uid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select uid is not null and (acr_private.is_platform_admin(uid) or exists(select 1 from public.acr_platform_access a where a.user_id=uid and a.status='approved'))
$$;
revoke all on function acr_private.has_platform_access(uuid) from public;
grant execute on function acr_private.has_platform_access(uuid) to authenticated;
create function acr_private.queue_platform_access() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.acr_platform_access(user_id) values(new.id); return new; end $$;
revoke all on function acr_private.queue_platform_access() from public;
create trigger acr_queue_platform_access after insert on auth.users for each row execute function acr_private.queue_platform_access();
create function public.acr_platform_access_status() returns text language sql stable security invoker set search_path='' as $$
 select case when acr_private.has_platform_access(auth.uid()) then 'approved' else coalesce((select status from public.acr_platform_access where user_id=auth.uid()),'pending') end
$$;
revoke all on function public.acr_platform_access_status() from public;
grant execute on function public.acr_platform_access_status() to authenticated;
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='public' and tablename like 'acr_%' and tablename<>'acr_platform_access' loop
 execute format('create policy "platform authorization required" on public.%I as restrictive for all to authenticated using ((select acr_private.has_platform_access(auth.uid()))) with check ((select acr_private.has_platform_access(auth.uid())))',t.tablename);
 end loop;
end $$;
create or replace function acr_private.is_approved_member(oid uuid,uid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select acr_private.has_platform_access(uid) and exists(select 1 from public.acr_memberships m where m.organization_id=oid and m.user_id=uid and m.status='approved')
$$;
create or replace function acr_private.is_org_admin(oid uuid,uid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select acr_private.is_platform_admin(uid) or (acr_private.has_platform_access(uid) and exists(select 1 from public.acr_memberships m where m.organization_id=oid and m.user_id=uid and m.role='admin' and m.status='approved'))
$$;
create function acr_private.decide_platform_access(p_user uuid,p_status text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.acr_platform_access; u auth.users; actor text;
begin
 if not acr_private.is_platform_admin(auth.uid()) then raise insufficient_privilege using message='Solo el administrador general autoriza nuevos registros.';end if;
 if p_status not in ('approved','rejected') then raise exception 'Decisión inválida';end if;
 select * into a from public.acr_platform_access where user_id=p_user for update;
 if not found then raise exception 'Solicitud no encontrada';end if;
 if a.status<>'pending' then raise exception 'Esta solicitud ya fue resuelta. Actualiza la lista.';end if;
 update public.acr_platform_access set status=p_status,decided_at=now(),decided_by=auth.uid(),reason=left(coalesce(p_reason,''),1000) where user_id=p_user;
 select * into u from auth.users where id=p_user;
 select coalesce(nullif(raw_user_meta_data->>'display_name',''),email) into actor from auth.users where id=auth.uid();
 insert into public.acr_access_audit(event_type,target_user_id,target_email,actor_user_id,actor_label)
 values(case when p_status='approved' then 'platform_access_approved' else 'platform_access_rejected' end,p_user,u.email,auth.uid(),actor);
 return jsonb_build_object('status',p_status,'user_id',p_user);
end $$;
revoke all on function acr_private.decide_platform_access(uuid,text,text) from public;
grant execute on function acr_private.decide_platform_access(uuid,text,text) to authenticated;
create function public.acr_decide_platform_access(p_user uuid,p_status text,p_reason text default '') returns jsonb language sql security invoker set search_path='' as $$select acr_private.decide_platform_access(p_user,p_status,p_reason)$$;
revoke all on function public.acr_decide_platform_access(uuid,text,text) from public;
grant execute on function public.acr_decide_platform_access(uuid,text,text) to authenticated;
create function acr_private.platform_requests() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not acr_private.is_platform_admin(auth.uid()) then raise insufficient_privilege using message='Solo administración general.';end if;
 return coalesce((select jsonb_agg(x order by x.requested_at desc) from
 (select a.user_id,a.status,a.requested_at,a.decided_at,a.reason,u.email,left(coalesce(u.raw_user_meta_data->>'display_name',''),120) display_name,
 coalesce(o.name,'Independiente') company_name,u.email_confirmed_at is not null email_confirmed
 from public.acr_platform_access a join auth.users u on u.id=a.user_id left join public.acr_organizations o on o.id::text=u.raw_user_meta_data->>'acr_organization_id'
 where a.reason<>'Cuenta existente antes del control de nuevos registros' limit 500) x),'[]'::jsonb);
end $$;
revoke all on function acr_private.platform_requests() from public;
grant execute on function acr_private.platform_requests() to authenticated;
create function public.acr_platform_requests() returns jsonb language sql stable security invoker set search_path='' as $$select acr_private.platform_requests()$$;
revoke all on function public.acr_platform_requests() from public;
grant execute on function public.acr_platform_requests() to authenticated;
alter table public.acr_profiles add column contact_phone text not null default '' check(length(contact_phone)<=40),add column avatar_data text not null default '' check(length(avatar_data)<=150000 and (avatar_data='' or avatar_data like 'data:image/jpeg;base64,%'));
commit;
