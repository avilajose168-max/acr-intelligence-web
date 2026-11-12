create or replace function acr_private.current_reviewer_name() returns text language sql stable security definer set search_path='' as $$
select coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'),''),nullif(trim(u.raw_user_meta_data->>'full_name'),''),nullif(trim(u.raw_user_meta_data->>'name'),''),'Nombre no registrado') from auth.users u where u.id=auth.uid()
$$;
revoke all on function acr_private.current_reviewer_name() from public,anon;
grant execute on function acr_private.current_reviewer_name() to authenticated;
create or replace function acr_private.review_actor_names(p_investigation uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.acr_corporate_investigations;
begin
 select * into c from public.acr_corporate_investigations where id=p_investigation;
 if auth.uid() is null or c.id is null or not(acr_private.is_org_admin(c.organization_id,auth.uid()) or (c.owner_id=auth.uid() and acr_private.is_approved_member(c.organization_id,auth.uid()))) then raise exception 'No autorizado para consultar esta revisión' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',a.actor_id,'name',coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'),''),nullif(trim(u.raw_user_meta_data->>'full_name'),''),nullif(trim(u.raw_user_meta_data->>'name'),''),'Nombre no registrado'))) from (select distinct actor_id from public.acr_followup_events where investigation_id=p_investigation and kind='review') a join auth.users u on u.id=a.actor_id),'[]'::jsonb);
end $$;
revoke all on function acr_private.review_actor_names(uuid) from public,anon;
grant execute on function acr_private.review_actor_names(uuid) to authenticated;
create or replace function public.acr_review_actor_names(p_investigation uuid) returns jsonb language sql stable security invoker set search_path='' as $$select acr_private.review_actor_names(p_investigation)$$;
revoke all on function public.acr_review_actor_names(uuid) from public,anon;
grant execute on function public.acr_review_actor_names(uuid) to authenticated;

do $outer$ declare definition text;begin select pg_get_functiondef(oid) into definition from pg_proc where pronamespace='acr_private'::regnamespace and proname='guard_company_review_decision';definition:=replace(definition,'select x->>''label'' into label from jsonb_array_elements(acr_private.company_reviewers(org)) x where x->>''id''=auth.uid()::text;','label:=acr_private.current_reviewer_name();');definition:=replace(definition,'''Administrador general''','''Nombre no registrado''');execute definition;end $outer$;