alter table public.acr_independent_subscriptions add column trial_extension_days integer not null default 0 check(trial_extension_days>=0), add column extended_trial_end date generated always as (trial_start+30+trial_extension_days) stored;
create table public.acr_trial_extensions(
 request_id uuid primary key,
 client_type text not null check(client_type in ('company','independent')),
 organization_id uuid references public.acr_organizations(id) on delete cascade,
 user_id uuid references auth.users(id) on delete cascade,
 granted_days integer not null default 30 check(granted_days=30),
 previous_end date,new_end date,
 reason text not null check(length(trim(reason)) between 1 and 2000),
 actor_id uuid not null references auth.users(id),
 actor_name text not null,
 created_at timestamptz not null default now(),
 check((client_type='company' and organization_id is not null and user_id is null) or(client_type='independent' and user_id is not null and organization_id is null)));
alter table public.acr_trial_extensions enable row level security;
revoke all on public.acr_trial_extensions from anon,authenticated;
grant select on public.acr_trial_extensions to authenticated;
create policy "platform reads trial extension history" on public.acr_trial_extensions for select to authenticated using(acr_private.is_platform_admin((select auth.uid())));
create or replace function acr_private.extend_client_trial(p_type text,p_id uuid,p_reason text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior date;finish date;start_date date;days_added integer;existing public.acr_trial_extensions;today date:=(now() at time zone 'America/Santiago')::date;
begin
 if auth.uid() is null or not acr_private.is_platform_admin(auth.uid()) then raise exception 'Solo administración general puede extender pruebas' using errcode='42501';end if;
 if p_type not in ('company','independent') or p_id is null or p_request is null or length(trim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'Indica cliente y motivo de la prórroga' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into existing from public.acr_trial_extensions where request_id=p_request;
 if found then
 if existing.client_type<>p_type or coalesce(existing.organization_id,existing.user_id)<>p_id then raise exception 'Solicitud incompatible' using errcode='23514';end if;
 return jsonb_build_object('new_end',existing.new_end,'granted_days',30,'already_applied',true);end if;
 if p_type='company' then
 select contract_end,contract_start into prior,start_date from public.acr_client_subscriptions where organization_id=p_id and subscription_status='trial' for update;
 if not found or prior is null then raise exception 'Primero configura una prueba gratuita con fecha de vencimiento para la compañía' using errcode='23514';end if;
 finish:=greatest(prior,today-1)+30;
 update public.acr_client_subscriptions set contract_end=finish,updated_at=now(),updated_by=auth.uid() where organization_id=p_id;
 else
 if not exists(select 1 from auth.users where id=p_id) then raise exception 'Cuenta no disponible' using errcode='23514';end if;
 insert into public.acr_independent_subscriptions(user_id,updated_by) values(p_id,auth.uid()) on conflict(user_id) do nothing;
 select trial_start,extended_trial_end,trial_extension_days into start_date,prior,days_added from public.acr_independent_subscriptions where user_id=p_id for update;
 if start_date is null then finish:=null;days_added:=days_added+30;
 else finish:=greatest(prior,today)+30;days_added:=finish-start_date-30;end if;
 update public.acr_independent_subscriptions set trial_extension_days=days_added,updated_at=now(),updated_by=auth.uid() where user_id=p_id;
 end if;
 insert into public.acr_trial_extensions(request_id,client_type,organization_id,user_id,previous_end,new_end,reason,actor_id,actor_name)
 values(p_request,p_type,case when p_type='company' then p_id end,case when p_type='independent' then p_id end,prior,finish,trim(p_reason),auth.uid(),coalesce(acr_private.current_reviewer_name(),'Nombre no registrado'));
 return jsonb_build_object('new_end',finish,'granted_days',30,'already_applied',false);
end $$;
revoke all on function acr_private.extend_client_trial(text,uuid,text,uuid) from public,anon;
grant execute on function acr_private.extend_client_trial(text,uuid,text,uuid) to authenticated;
create or replace function public.acr_extend_client_trial(p_type text,p_id uuid,p_reason text,p_request uuid) returns jsonb language sql security invoker set search_path='' as $$select acr_private.extend_client_trial(p_type,p_id,p_reason,p_request)$$;
revoke all on function public.acr_extend_client_trial(text,uuid,text,uuid) from public,anon;
grant execute on function public.acr_extend_client_trial(text,uuid,text,uuid) to authenticated;
do $patch$ declare definition text;begin
 select pg_get_functiondef(oid) into definition from pg_proc where pronamespace='acr_private'::regnamespace and proname='independent_client_directory';
 definition:=replace(definition,'s.trial_start,s.trial_end,s.monthly_amount','s.trial_start,s.extended_trial_end as trial_end,coalesce(s.trial_extension_days,0) as trial_extension_days,s.monthly_amount');
 execute definition;
end $patch$;
notify pgrst,'reload schema';